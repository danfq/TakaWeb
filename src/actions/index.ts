import { ActionError, defineAction, type ActionAPIContext } from "astro:actions"
import { z } from "astro/zod"
import { CODE_LENGTH, PASSWORD_MAX, PASSWORD_MIN, normalizeCode } from "@/lib/account"
import { createAdmin, getAdmin, hasAdmin, setPasswordHash, verifySetupToken } from "@/lib/server/auth/admin"
import { hashPassword, verifyPassword } from "@/lib/server/auth/password"
import {
  createSession,
  deleteSessionCookie,
  invalidateSession,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  setSessionCookie,
  type Session,
  type User,
} from "@/lib/server/auth/session"
import {
  checkTotp,
  disableTotp,
  endChallenge,
  failChallenge,
  finishEnrollment,
  hasTotp,
  readChallenge,
  startChallenge,
  startEnrollment,
} from "@/lib/server/auth/two-factor"
import { clientIp, userAgent } from "@/lib/server/client"
import { importedCount, removeImported } from "@/lib/server/imports"
import { limits, type Limiter } from "@/lib/server/limiter"
import { sealFilter } from "@/lib/server/seal"
import { resetSettings, updateSettings } from "@/lib/server/settings"
import { importsChanged } from "@/lib/server/stats/store"
import { LookupError, lookupAgents } from "@/lib/server/wakatime"
import { CHOICES } from "@/lib/settings"
import { FILTERABLE } from "@/lib/stats/types"

/**
 * password policy, capped to keep hashing cheap
 */
const password = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`)

/**
 * a code from an authenticator app, spaces and dashes are fine
 */
const code = z
  .string()
  .max(32)
  .transform(normalizeCode)
  .pipe(
    z.string().regex(new RegExp(`^\\d{${CODE_LENGTH}}$`), `Enter the ${CODE_LENGTH}-digit code from your app`)
  )

/**
 * settings a change may carry, any subset of them
 */
const settingsChanges = z
  .object({
    timeFormat: z.enum(CHOICES.timeFormat),
    durations: z.enum(CHOICES.durations),
    defaultRange: z.enum(CHOICES.defaultRange),
    hideNames: z.boolean(),
    tabTitle: z.boolean(),
  })
  .partial()

/**
 * reject a request without a signed in admin
 *
 * @param context action context
 *
 * @returns {{ user: User; session: Session }} user and session
 */
function assertUser(context: ActionAPIContext): { user: User; session: Session } {
  const { user, session } = context.locals

  if (!user || !session) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "Sign in first" })
  }

  return { user, session }
}

/**
 * describe a wait for people
 *
 * @param wait ms to wait
 *
 * @returns {string} e.g. in 3 minutes
 */
function waitFor(wait: number): string {
  const minutes = Math.ceil(wait / 60_000)

  if (wait < 60_000) return "in a moment"

  return `in ${minutes} minute${minutes === 1 ? "" : "s"}`
}

/**
 * reject a request once its key ran out of hits
 *
 * @param limiter limiter
 * @param key limiter key
 * @param count whether this request counts as a hit
 */
function assertNotLimited(limiter: Limiter, key: string, count = false) {
  const wait = count ? limiter.take(key) : limiter.wait(key)

  if (wait) {
    throw new ActionError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many attempts, try again ${waitFor(wait)}`,
    })
  }
}

/**
 * gate a sign in style attempt by client address, and by everyone at once
 *
 * @param context action context
 *
 * @returns {string} client address
 */
function assertCanAttempt(context: ActionAPIContext): string {
  const ip = clientIp(context)

  assertNotLimited(limits.authFailures, ip)
  assertNotLimited(limits.authAttempts, ip, true)
  assertNotLimited(limits.authGlobal, "all", true)

  return ip
}

/**
 * reject a request unless it carries the admin's current password
 *
 * @param context action context
 * @param user signed in user
 * @param session session making the request
 * @param password password to check
 * @param message error shown when it is wrong
 */
async function assertPassword(
  context: ActionAPIContext,
  user: User,
  session: Session,
  password: string,
  message = "Your password is incorrect"
) {
  const ip = clientIp(context)

  assertNotLimited(limits.passwordFailures, session.id)
  assertNotLimited(limits.authFailures, ip)

  const admin = getAdmin()

  if (!admin || admin.id !== user.id || !(await verifyPassword(password, admin.passwordHash))) {
    limits.passwordFailures.hit(session.id)
    limits.authFailures.hit(ip)

    throw new ActionError({ code: "UNAUTHORIZED", message })
  }

  limits.passwordFailures.reset(session.id)
}

/**
 * count a wrong code against the address and the account it was meant for
 *
 * @param context action context
 * @param userId account the code was for
 */
function codeFailed(context: ActionAPIContext, userId: number) {
  limits.authFailures.hit(clientIp(context))
  limits.codeFailures.hit(String(userId))
}

/**
 * sign a user in on this browser
 *
 * @param context action context
 * @param userId user id
 * @param ip client address
 */
function signIn(context: ActionAPIContext, userId: number, ip: string) {
  const { token, expiresAt } = createSession(userId, { ip, userAgent: userAgent(context) })
  setSessionCookie(context, token, expiresAt)
}

export const server = {
  auth: {
    /**
     * create the admin account using the one-time setup token
     */
    setup: defineAction({
      accept: "form",
      input: z
        .object({
          token: z.string().trim().min(1, "Enter the setup token"),
          password,
          confirm: z.string(),
        })
        .refine((input) => input.password === input.confirm, {
          message: "Passwords do not match",
          path: ["confirm"],
        }),
      handler: async (input, context) => {
        const ip = assertCanAttempt(context)

        if (hasAdmin()) {
          throw new ActionError({
            code: "CONFLICT",
            message: "The admin account already exists",
          })
        }

        if (!verifySetupToken(input.token)) {
          limits.authFailures.hit(ip)

          throw new ActionError({
            code: "UNAUTHORIZED",
            message: "Invalid setup token",
          })
        }

        // the unique username guards against concurrent setups
        const adminId = createAdmin(await hashPassword(input.password))

        if (adminId === null) {
          throw new ActionError({
            code: "CONFLICT",
            message: "The admin account already exists",
          })
        }

        limits.authFailures.reset(ip)
        console.log("[takaweb] admin account created")

        signIn(context, adminId, ip)
      },
    }),

    /**
     * sign in as the admin
     */
    login: defineAction({
      accept: "form",
      input: z.object({
        password: z.string().min(1, "Enter your password").max(PASSWORD_MAX),
      }),
      handler: async (input, context) => {
        const ip = assertCanAttempt(context)
        const admin = getAdmin()

        if (!admin || !(await verifyPassword(input.password, admin.passwordHash))) {
          limits.authFailures.hit(ip)

          throw new ActionError({
            code: "UNAUTHORIZED",
            message: "Incorrect password",
          })
        }

        // the password alone is not enough, a code from the app finishes the sign in
        if (hasTotp(admin.id)) {
          startChallenge(context, admin.id)

          return { twoFactor: true }
        }

        limits.authFailures.reset(ip)
        signIn(context, admin.id, ip)

        return { twoFactor: false }
      },
    }),

    /**
     * end the current session
     */
    logout: defineAction({
      handler: (_, context) => {
        if (context.locals.session) invalidateSession(context.locals.session.id)
        deleteSessionCookie(context)
      },
    }),

    /**
     * change the admin password, which signs out every other session
     * a forgotten password can only be reset from the command line
     */
    changePassword: defineAction({
      accept: "form",
      input: z
        .object({
          current: z.string().min(1, "Enter your current password").max(PASSWORD_MAX),
          password,
          confirm: z.string(),
        })
        .refine((input) => input.password === input.confirm, {
          message: "Passwords do not match",
          path: ["confirm"],
        }),
      handler: async (input, context) => {
        const { user, session } = assertUser(context)

        await assertPassword(context, user, session, input.current, "Your current password is incorrect")

        if (input.current === input.password) {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: "Choose a password that differs from the current one",
          })
        }

        setPasswordHash(user.id, await hashPassword(input.password))

        const revoked = revokeOtherSessions(user.id, session.id)
        console.log("[takaweb] admin password changed")

        return { revoked }
      },
    }),

    /**
     * every signed in session
     */
    sessions: defineAction({
      handler: (_, context) => {
        const { user, session } = assertUser(context)
        assertNotLimited(limits.requests, session.id, true)

        return listSessions(user.id, session.id)
      },
    }),

    /**
     * sign out another session
     */
    revoke: defineAction({
      input: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
      handler: (input, context) => {
        const { user, session } = assertUser(context)
        assertNotLimited(limits.requests, session.id, true)

        if (input.id === session.id) {
          throw new ActionError({ code: "BAD_REQUEST", message: "Sign out of this session instead" })
        }

        revokeSession(user.id, input.id, session.id)

        return listSessions(user.id, session.id)
      },
    }),

    /**
     * sign out every session but this one
     */
    revokeOthers: defineAction({
      handler: (_, context) => {
        const { user, session } = assertUser(context)
        assertNotLimited(limits.requests, session.id, true)

        revokeOtherSessions(user.id, session.id)

        return listSessions(user.id, session.id)
      },
    }),
  },

  twoFactor: {
    /**
     * finish a sign in held by login with a code from the app
     */
    verify: defineAction({
      accept: "form",
      input: z.object({ code }),
      handler: (input, context) => {
        const ip = assertCanAttempt(context)
        const challenge = readChallenge(context)

        if (!challenge) {
          endChallenge(context)

          throw new ActionError({
            code: "PRECONDITION_FAILED",
            message: "Your sign in timed out, enter your password again",
          })
        }

        assertNotLimited(limits.codeFailures, String(challenge.userId))

        if (!checkTotp(challenge.userId, input.code)) {
          codeFailed(context, challenge.userId)

          if (!failChallenge(challenge.id)) {
            endChallenge(context)

            throw new ActionError({
              code: "PRECONDITION_FAILED",
              message: "Too many incorrect codes, enter your password again",
            })
          }

          throw new ActionError({ code: "UNAUTHORIZED", message: "Incorrect code" })
        }

        endChallenge(context, challenge.id)
        limits.authFailures.reset(ip)
        signIn(context, challenge.userId, ip)
      },
    }),

    /**
     * make a secret to add to an authenticator app, after checking the password
     */
    start: defineAction({
      accept: "form",
      input: z.object({
        password: z.string().min(1, "Enter your password").max(PASSWORD_MAX),
      }),
      handler: async (input, context) => {
        const { user, session } = assertUser(context)

        await assertPassword(context, user, session, input.password)

        // checked after the password, so a setup that finished meanwhile counts
        if (hasTotp(user.id)) {
          throw new ActionError({ code: "CONFLICT", message: "Two-factor authentication is already on" })
        }

        return startEnrollment(session.id, user.id)
      },
    }),

    /**
     * turn two-factor on once a code proves the app has the secret, which signs out every other session
     */
    enable: defineAction({
      accept: "form",
      input: z.object({ code }),
      handler: (input, context) => {
        const { user, session } = assertUser(context)

        assertNotLimited(limits.passwordFailures, session.id)
        assertNotLimited(limits.authFailures, clientIp(context))

        const outcome = finishEnrollment(session.id, user.id, input.code)

        if (outcome === "expired") {
          throw new ActionError({
            code: "PRECONDITION_FAILED",
            message: "Setup timed out, start over",
          })
        }

        if (outcome === "enabled") {
          throw new ActionError({ code: "CONFLICT", message: "Two-factor authentication is already on" })
        }

        if (outcome === "invalid") {
          limits.passwordFailures.hit(session.id)
          limits.authFailures.hit(clientIp(context))

          throw new ActionError({
            code: "UNAUTHORIZED",
            message: "Incorrect code, check the time on your device and try again",
          })
        }

        const revoked = revokeOtherSessions(user.id, session.id)
        console.log("[takaweb] two-factor authentication turned on")

        return { revoked }
      },
    }),

    /**
     * turn two-factor off, with the password and a current code
     */
    disable: defineAction({
      accept: "form",
      input: z.object({
        password: z.string().min(1, "Enter your password").max(PASSWORD_MAX),
        code,
      }),
      handler: async (input, context) => {
        const { user, session } = assertUser(context)

        await assertPassword(context, user, session, input.password)
        assertNotLimited(limits.codeFailures, String(user.id))

        if (!checkTotp(user.id, input.code)) {
          codeFailed(context, user.id)
          limits.passwordFailures.hit(session.id)

          throw new ActionError({ code: "UNAUTHORIZED", message: "Incorrect code" })
        }

        disableTotp(user.id)
        console.log("[takaweb] two-factor authentication turned off")
      },
    }),
  },

  view: {
    /**
     * seal a filter for the address bar, so hidden names never show in it
     */
    seal: defineAction({
      input: z.object({
        dimension: z.enum(FILTERABLE),
        value: z.string().max(512),
      }),
      handler: (input, context) => {
        const { session } = assertUser(context)
        assertNotLimited(limits.requests, session.id, true)

        return sealFilter(input)
      },
    }),
  },

  settings: {
    /**
     * change some settings, every open dashboard picks them up
     */
    update: defineAction({
      input: settingsChanges,
      handler: (input, context) => {
        const { user, session } = assertUser(context)
        assertNotLimited(limits.requests, session.id, true)

        return updateSettings(user.id, input)
      },
    }),

    /**
     * put every setting back to its default
     */
    reset: defineAction({
      handler: (_, context) => {
        const { user, session } = assertUser(context)
        assertNotLimited(limits.requests, session.id, true)

        return resetSettings(user.id)
      },
    }),
  },

  wakatime: {
    /**
     * how many heartbeats came from wakatime
     */
    status: defineAction({
      handler: (_, context) => {
        const { session } = assertUser(context)
        assertNotLimited(limits.requests, session.id, true)

        return { imported: importedCount() }
      },
    }),

    /**
     * name the editors and systems behind wakatime user agents, the token is never stored
     */
    agents: defineAction({
      input: z.object({ token: z.string().trim().min(1).max(512) }),
      handler: async (input, context) => {
        const { session } = assertUser(context)
        assertNotLimited(limits.wakatimeLookups, session.id, true)

        try {
          return await lookupAgents(input.token)
        } catch (error) {
          if (!(error instanceof LookupError)) throw error

          throw new ActionError({
            code: error.rejected ? "BAD_REQUEST" : "BAD_GATEWAY",
            message: error.message,
          })
        }
      },
    }),

    /**
     * delete every heartbeat a wakatime import added
     */
    remove: defineAction({
      handler: (_, context) => {
        const { session } = assertUser(context)
        assertNotLimited(limits.heavy, session.id, true)

        const removed = removeImported()
        if (removed) importsChanged()

        return { removed }
      },
    }),
  },
}
