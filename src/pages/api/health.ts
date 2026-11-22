import type { APIRoute } from "astro"

/**
 * liveness for container healthchecks, public and cheap
 * the takatime database being down is shown on the dashboard, restarting takaweb would not fix it
 */
export const GET: APIRoute = () =>
  Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } })
