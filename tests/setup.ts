import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "vitest"

const globals = globalThis as typeof globalThis & { __takawebTestDir?: string } & Record<string, unknown>

// one data dir per worker, files share it since workers are reused across them
const dir = (globals.__takawebTestDir ??= mkdtempSync(join(tmpdir(), "takaweb-test-")))

// astro inlines env values when its config loads, so tests swap the module for their own
vi.mock("astro:env/server", () => ({
  TAKAWEB_DATA_DIR: dir,
  TAKAWEB_URL: undefined,
  TAKAWEB_TRUSTED_PROXIES: 0,
  MONGO_URI: undefined,
}))

// every file starts from fresh modules, so its own mocks apply and no state leaks in from the last one
vi.resetModules()

// state kept on globalThis outlives the modules, only the database handle is worth keeping
for (const key of [
  "__takawebAdmin",
  "__takawebLimits",
  "__takawebSettings",
  "__takawebStreams",
  "__takawebTwoFactor",
]) {
  delete globals[key]
}

const { db } = await import("@/lib/server/db")

db.exec(`
  DELETE FROM session;
  DELETE FROM setting;
  DELETE FROM user;
  DELETE FROM imported_heartbeat;
`)
