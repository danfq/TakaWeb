import { ActionError, defineAction, type ActionAPIContext } from "astro:actions";
import { z } from "astro/zod";
import {
  createAdmin,
  getAdmin,
  hasAdmin,
  verifySetupToken,
} from "@/lib/server/auth/admin";
import {
  clearFailures,
  isLimited,
  recordFailure,
} from "@/lib/server/auth/limiter";
import { hashPassword, verifyPassword } from "@/lib/server/auth/password";
import {
  createSession,
  deleteSessionCookie,
  invalidateSession,
  setSessionCookie,
} from "@/lib/server/auth/session";
import {
  importLogs,
  importedCount,
  removeImported,
} from "@/lib/server/imports";
import { importsChanged } from "@/lib/server/stats/store";
import { LookupError, lookupAgents } from "@/lib/server/wakatime";
import { IMPORT_BATCH, IMPORT_TIMEOUT } from "@/lib/wakatime";

/**
 * password policy, capped to keep hashing cheap
 */
const password = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters");

/**
 * a wakatime log as sent by the import, see ImportLog
 */
const importLog = z.object({
  id: z.string().min(1).max(256),
  file: z.string().min(1).max(4096),
  project: z.string().max(512),
  language: z.string().max(256),
  branch: z.string().max(512),
  editor: z.string().max(256),
  os: z.string().max(64),
  end: z.number().int().positive(),
  duration: z.number().positive().max(IMPORT_TIMEOUT),
});

/**
 * reject a request without a signed in admin
 *
 * @param context action context
 */
function assertUser(context: ActionAPIContext) {
  if (!context.locals.user) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "Sign in first" });
  }
}

/**
 * reject a request once its key ran out of attempts
 *
 * @param key limiter key
 */
function assertNotLimited(key: string) {
  if (isLimited(key)) {
    throw new ActionError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts, try again in a few minutes",
    });
  }
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
        const key = `setup:${context.clientAddress}`;
        assertNotLimited(key);

        if (hasAdmin()) {
          throw new ActionError({
            code: "CONFLICT",
            message: "The admin account already exists",
          });
        }

        if (!verifySetupToken(input.token)) {
          recordFailure(key);

          throw new ActionError({
            code: "UNAUTHORIZED",
            message: "Invalid setup token",
          });
        }

        // the unique username guards against concurrent setups
        const adminId = createAdmin(await hashPassword(input.password));

        if (adminId === null) {
          throw new ActionError({
            code: "CONFLICT",
            message: "The admin account already exists",
          });
        }

        clearFailures(key);
        console.log("[takaweb] admin account created");

        const { token, expiresAt } = createSession(adminId);
        setSessionCookie(context, token, expiresAt);
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
        const key = `login:${context.clientAddress}`;
        assertNotLimited(key);

        const admin = getAdmin();

        if (!admin || !(await verifyPassword(input.password, admin.passwordHash))) {
          recordFailure(key);

          throw new ActionError({
            code: "UNAUTHORIZED",
            message: "Incorrect password",
          });
        }

        clearFailures(key);

        const { token, expiresAt } = createSession(admin.id);
        setSessionCookie(context, token, expiresAt);
      },
    }),

    /**
     * end the current session
     */
    logout: defineAction({
      handler: (_, context) => {
        if (context.locals.session) invalidateSession(context.locals.session.id);
        deleteSessionCookie(context);
      },
    }),
  },

  wakatime: {
    /**
     * how many logs came from wakatime
     */
    status: defineAction({
      handler: (_, context) => {
        assertUser(context);

        return { imported: importedCount() };
      },
    }),

    /**
     * name the editors and systems behind wakatime user agents, the token is never stored
     */
    agents: defineAction({
      input: z.object({ token: z.string().trim().min(1).max(512) }),
      handler: async (input, context) => {
        assertUser(context);

        try {
          return await lookupAgents(input.token);
        } catch (error) {
          if (!(error instanceof LookupError)) throw error;

          throw new ActionError({
            code: error.rejected ? "BAD_REQUEST" : "BAD_GATEWAY",
            message: error.message,
          });
        }
      },
    }),

    /**
     * store a batch of logs converted from a wakatime export
     */
    import: defineAction({
      input: z.object({ logs: z.array(importLog).max(IMPORT_BATCH) }),
      handler: (input, context) => {
        assertUser(context);

        const result = importLogs(input.logs);
        if (result.added) importsChanged();

        return result;
      },
    }),

    /**
     * delete every log a wakatime import added
     */
    remove: defineAction({
      handler: (_, context) => {
        assertUser(context);

        const removed = removeImported();
        if (removed) importsChanged();

        return { removed };
      },
    }),
  },
};
