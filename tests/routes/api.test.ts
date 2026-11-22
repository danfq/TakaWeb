import { describe, expect, test } from "vitest"
import { createAdmin } from "@/lib/server/auth/admin"
import { createSession, validateSession } from "@/lib/server/auth/session"
import { importedCount } from "@/lib/server/imports"
import { MAX_STREAMS_PER_OWNER, openStreams } from "@/lib/server/streams"
import { GET as exportRoute } from "@/pages/api/export"
import { GET as health } from "@/pages/api/health"
import { POST as importRoute } from "@/pages/api/import/wakatime"
import { GET as stream } from "@/pages/api/stream"
import { context } from "../helpers/context"

const userId = createAdmin("hash")!
const { user, session } = validateSession(createSession(userId, { ip: "", userAgent: "" }).token)!

/**
 * call a route as the signed in admin
 *
 * @param route route handler
 * @param path request path
 * @param init request options
 *
 * @returns {Promise<Response>} response
 */
const call = async (route: (context: never) => unknown, path: string, init?: RequestInit) =>
  (await route(context(path, { init, user, session }) as never)) as Response

const BEAT = {
  time: Date.UTC(2025, 0, 1),
  file: "/a.ts",
  project: "p",
  language: "l",
  branch: "",
  editor: "e",
  os: "o",
}

describe("api routes", () => {
  test("health answers ok", async () => {
    const response = (await health(context("/api/health") as never)) as Response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  test("import stores a json batch", async () => {
    const response = await call(importRoute, "/api/import/wakatime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heartbeats: [BEAT, { ...BEAT, time: BEAT.time + 1000 }] }),
    })

    expect(await response.json()).toEqual({ added: 2, skipped: 0 })
    expect(importedCount()).toBe(2)
  })

  test("import refuses anything but valid json batches", async () => {
    const post = (body: string, type = "application/json") =>
      call(importRoute, "/api/import/wakatime", { method: "POST", headers: { "Content-Type": type }, body })

    expect((await post(JSON.stringify({ heartbeats: [BEAT] }), "text/plain")).status).toBe(415)
    expect((await post("{nope")).status).toBe(400)
    expect((await post(JSON.stringify({ heartbeats: [{ ...BEAT, file: "" }] }))).status).toBe(400)
    expect((await post("x".repeat(1024 * 1024 + 1))).status).toBe(413)
  })

  test("export checks its format", async () => {
    expect((await call(exportRoute, "/api/export?format=rar")).status).toBe(400)

    const response = await call(exportRoute, "/api/export?format=json")
    expect(response.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="takaweb-export-.*\.json"/
    )
    expect(JSON.parse(await response.text()).imported.wakatime).toHaveLength(2)
  })

  test("stream sends settings first, then the data status", async () => {
    const ctx = context("/api/stream?tz=Europe/Lisbon", { user, session })
    const response = (await stream(ctx as never)) as Response
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()

    let text = ""
    while (!text.includes("event: status")) text += (await reader.read()).value

    expect(response.headers.get("Content-Type")).toMatch(/text\/event-stream/)
    expect(text.indexOf("event: settings")).toBeLessThan(text.indexOf("event: status"))
    expect(text).toContain('"state":"unconfigured"')

    // a closed tab ends the stream on the server too
    const before = openStreams()
    ctx.abort()
    expect(openStreams()).toBe(before - 1)
  })

  test("stream caps how many one session holds open", async () => {
    const open = []

    for (let index = 0; index < MAX_STREAMS_PER_OWNER; index++) {
      const ctx = context("/api/stream", { user, session })
      open.push(ctx)
      expect(((await stream(ctx as never)) as Response).status).toBe(200)
    }

    expect(((await stream(context("/api/stream", { user, session }) as never)) as Response).status).toBe(429)

    for (const ctx of open) ctx.abort()
    expect(((await stream(context("/api/stream", { user, session }) as never)) as Response).status).toBe(200)
  })
})
