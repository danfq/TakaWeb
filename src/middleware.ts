import type { APIContext, MiddlewareNext } from "astro"
import { defineMiddleware } from "astro:middleware"
import { bootstrap, hasAdmin } from "@/lib/server/auth/admin"
import {
  SESSION_COOKIE,
  deleteSessionCookie,
  setSessionCookie,
  validateSession,
} from "@/lib/server/auth/session"
import { secure } from "@/lib/server/headers"
import { isClosing, track } from "@/lib/server/shutdown"

// no-op once the boot integration ran, kept as a fallback
bootstrap()

export const onRequest = defineMiddleware(async (context, next) => {
  // shutting down, a restarted server answers instead
  if (isClosing()) {
    return new Response("TakaWeb is restarting, try again shortly", {
      status: 503,
      headers: { "Retry-After": "5", Connection: "close" },
    })
  }

  return secure(await track(() => route(context, next)), context.url)
})

/**
 * resolve the session and send visitors where they may go
 *
 * @param context request context
 * @param next renders the route
 *
 * @returns {Promise<Response>} response
 */
async function route(context: APIContext, next: MiddlewareNext): Promise<Response> {
  context.locals.user = null
  context.locals.session = null

  // resolve the session
  const token = context.cookies.get(SESSION_COOKIE)?.value

  if (token) {
    const result = validateSession(token)

    if (result) {
      context.locals.user = result.user
      context.locals.session = result.session

      if (result.renewed) {
        setSessionCookie(context, token, result.session.expiresAt)
      }
    } else {
      deleteSessionCookie(context)
    }
  }

  // actions guard themselves
  if (context.url.pathname.startsWith("/_actions/")) return next()

  const { pathname } = context.url
  const { user } = context.locals

  // api clients cannot follow a login redirect
  if (pathname.startsWith("/api/")) {
    return user ? next() : new Response(null, { status: 401 })
  }

  // force setup until the admin exists
  if (!hasAdmin()) {
    return pathname === "/setup" ? next() : context.redirect("/setup")
  }

  if (pathname === "/setup") return context.redirect(user ? "/" : "/login")
  if (pathname === "/login") return user ? context.redirect("/") : next()

  return user ? next() : context.redirect("/login")
}
