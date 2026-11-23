import { afterEach, expect, test } from "vitest"
import { createAdmin } from "@/lib/server/auth/admin"
import { createExport } from "@/lib/server/export"
import { importHeartbeats } from "@/lib/server/imports"
import type { ImportHeartbeat } from "@/lib/wakatime"

const warnings: Error[] = []

/**
 * collect process warnings, such as listener leaks
 *
 * @param warning warning
 */
const collect = (warning: Error) => warnings.push(warning)

afterEach(() => {
  process.off("warning", collect)
})

test("waits on a slow file without piling up listeners", async () => {
  const userId = createAdmin("hash")!

  // long paths, so writing them backs up the file stream many times over
  const heartbeats: ImportHeartbeat[] = Array.from({ length: 60_000 }, (_, index) => ({
    time: Date.UTC(2025, 0, 1) + index * 1000,
    file: `/src/${"nested/".repeat(30)}${index % 50}.ts`,
    project: "p",
    language: "l",
    branch: "",
    editor: "e",
    os: "o",
  }))

  for (let index = 0; index < heartbeats.length; index += 2000) {
    importHeartbeats(heartbeats.slice(index, index + 2000))
  }

  process.on("warning", collect)

  const { body } = await createExport("json", userId)
  const chunks: Uint8Array[] = []
  for await (const chunk of body) chunks.push(chunk)

  // warnings are emitted on the next tick
  await new Promise((resolve) => setTimeout(resolve, 20))

  expect(warnings.map((warning) => warning.name)).toEqual([])
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8")).imported.wakatime).toHaveLength(60_000)
}, 60_000)
