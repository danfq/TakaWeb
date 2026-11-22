import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "vitest"

// every test file runs in its own worker with a fresh data dir, so databases never leak between files
const dir = mkdtempSync(join(tmpdir(), "takaweb-test-"))

// astro inlines env values when its config loads, so tests swap the module for their own
vi.mock("astro:env/server", () => ({
  TAKAWEB_DATA_DIR: dir,
  TAKAWEB_URL: undefined,
  TAKAWEB_TRUSTED_PROXIES: 0,
  MONGO_URI: undefined,
}))
