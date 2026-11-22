import { ActionError, defineAction, type ActionAPIContext } from "astro:actions"
import { z } from "astro/zod"
import { createAdmin, getAdmin, hasAdmin, verifySetupToken } from "@/lib/server/auth/admin"
import { hashPassword, verifyPassword } from "@/lib/server/auth/password"
import {
  createSession,
  deleteSessionCookie,
  invalidateSession,
  setSessionCookie,
  type Session,
  type User,
} from "@/lib/server/auth/session"
import { clientIp } from "@/lib/server/client"
import { importHeartbeats, importedCount, removeImported } from "@/lib/server/imports"
import { limits, type Limiter } from "@/lib/server/limiter"
import { resetSettings, updateSettings } from "@/lib/server/settings"
import { importsChanged } from "@/lib/server/stats/store"
import { LookupError, lookupAgents } from "@/lib/server/wakatime"
import { CHOICES } from "@/lib/settings"
import { IMPORT_BATCH, IMPORT_LIMITS } from "@/lib/wakatime"

/**
 * password policy, capped to keep hashing cheap
 */
const password = z.string().min(12, "Use at least 12 characters").max(128, "Use at most 128 characters")

/**
 * a wakatime heartbeat as sent by the import, see ImportHeartbeat
 * times outside the range are skipped rather than rejected, so clock skew never stalls a whole batch
 */
const importHeartbeat = z.object({
  time: z.number().int(),
  file: z.string().min(1).max(IMPORT_LIMITS.file),
  project: z.string().max(IMPORT_LIMITS.project),
  language: z.string().max(IMPORT_LIMITS.language),
  branch: z.string().max(IMPORT_LIMITS.branch),
  editor: z.string().max(IMPORT_LIMITS.editor),
  os: z.string().max(IMPORT_LIMITS.os),
})

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
 * sign a user in on this browser
 *
 * @param context action context
 * @param userId user id
 */
function signIn(context: ActionAPIContext, userId: number) {
  const { token, expiresAt } = createSession(userId)
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

        signIn(context, adminId)
      },
    }),

    /**
     * sign in as the admin
     */
    login: defineAction({
      accept: "form",
      input: z.object({
        password: z.string().min(1, "Enter your password").max(128),
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

        limits.authFailures.reset(ip)
        signIn(context, admin.id)
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
     * store a batch of heartbeats read from a wakatime export
     */
    import: defineAction({
      input: z.object({ heartbeats: z.array(importHeartbeat).max(IMPORT_BATCH) }),
      handler: (input, context) => {
        const { session } = assertUser(context)
        assertNotLimited(limits.importBatches, session.id, true)

        const result = importHeartbeats(input.heartbeats)
        if (result.added) importsChanged()

        return result
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
