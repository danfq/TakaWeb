import { defineConfig, envField } from "astro/config"
import react from "@astrojs/react"

import tailwindcss from "@tailwindcss/vite"

import node from "@astrojs/node"

import boot from "./src/integrations/boot"

// https://astro.build/config
export default defineConfig({
  output: "server",

  integrations: [react(), boot()],

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: node({
    mode: "standalone",
  }),

  env: {
    schema: {
      // read at runtime so compose can override them
      TAKAWEB_URL: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      TAKAWEB_DATA_DIR: envField.string({
        context: "server",
        access: "secret",
        default: "data",
      }),
      // proxies in front of takaweb, client addresses are read from x-forwarded-for past them
      TAKAWEB_TRUSTED_PROXIES: envField.number({
        context: "server",
        access: "secret",
        int: true,
        min: 0,
        default: 0,
      }),
      // takatime mongo, ideally as a read-only user
      MONGO_URI: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
    },
  },
})
