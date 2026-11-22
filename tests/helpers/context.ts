import type { Session, User } from "@/lib/server/auth/session"

/**
 * a minimal astro api context, enough for takaweb's routes and middleware
 *
 * @param path request path and query
 * @param options request, cookies and who is signed in
 *
 * @returns context
 */
export function context(
  path: string,
  options: {
    init?: RequestInit
    cookies?: Record<string, string>
    user?: User | null
    session?: Session | null
  } = {}
) {
  const url = new URL(path, "http://takaweb.test")
  const jar = new Map(Object.entries(options.cookies ?? {}))
  const controller = new AbortController()

  return {
    url,
    request: new Request(url, { ...options.init, signal: controller.signal }),
    clientAddress: "192.0.2.10",
    abort: () => controller.abort(),
    locals: { user: options.user ?? null, session: options.session ?? null } as App.Locals,
    cookies: {
      get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
      set: (name: string, value: string) => void jar.set(name, value),
      delete: (name: string) => void jar.delete(name),
      jar,
    },
    redirect: (location: string) => new Response(null, { status: 302, headers: { Location: location } }),
  }
}
