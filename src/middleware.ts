import { defineMiddleware } from "astro:middleware";
import { bootstrap, hasAdmin } from "@/lib/server/auth/admin";
import {
  SESSION_COOKIE,
  deleteSessionCookie,
  setSessionCookie,
  validateSession,
} from "@/lib/server/auth/session";

// no-op once the boot integration ran, kept as a fallback
bootstrap();

export const onRequest = defineMiddleware((context, next) => {
  context.locals.user = null;
  context.locals.session = null;

  // resolve the session
  const token = context.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    const result = validateSession(token);

    if (result) {
      context.locals.user = result.user;
      context.locals.session = result.session;

      if (result.renewed) {
        setSessionCookie(context, token, result.session.expiresAt);
      }
    } else {
      deleteSessionCookie(context);
    }
  }

  // actions guard themselves
  if (context.url.pathname.startsWith("/_actions/")) return next();

  const { pathname } = context.url;
  const { user } = context.locals;

  // api clients cannot follow a login redirect
  if (pathname.startsWith("/api/")) {
    return user ? next() : new Response(null, { status: 401 });
  }

  // force setup until the admin exists
  if (!hasAdmin()) {
    return pathname === "/setup" ? next() : context.redirect("/setup");
  }

  if (pathname === "/setup") return context.redirect(user ? "/" : "/login");
  if (pathname === "/login") return user ? context.redirect("/") : next();

  return user ? next() : context.redirect("/login");
});
