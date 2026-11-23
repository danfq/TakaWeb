/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config"

// astro's vite config, so astro:env and the @ alias resolve in tests
export default getViteConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // every file starts with fresh modules and an empty database, see tests/setup.ts
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    // reuses workers across files instead of one per file
    isolate: false,
  },
})
