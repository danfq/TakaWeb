import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { isRunnableDevEnvironment, type ViteDevServer } from "vite";

const BOOT_MODULE = fileURLToPath(
  new URL("../lib/server/boot.ts", import.meta.url),
);

/**
 * run the server boot module on startup instead of on first request
 * astro loads middleware lazily, so first-boot work would otherwise wait for a visitor
 *
 * @returns {AstroIntegration} integration
 */
export default function boot(): AstroIntegration {
  let server: ViteDevServer | undefined;

  return {
    name: "takaweb:boot",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        if (command !== "build") return;

        updateConfig({
          vite: {
            plugins: [
              {
                name: "takaweb:boot",
                applyToEnvironment: (environment) => environment.name === "ssr",

                // append to the node adapter entry, after astro:env is initialized
                transform(code, id) {
                  if (!/@astrojs[\\/]node[\\/]dist[\\/]server\.js$/.test(id)) {
                    return;
                  }

                  return `${code}\nawait import(${JSON.stringify(BOOT_MODULE)});\n`;
                },
              },
            ],
          },
        });
      },

      "astro:server:setup": (options) => {
        server = options.server;
      },

      "astro:server:start": async ({ logger }) => {
        const ssr = server?.environments.ssr;

        if (!ssr || !isRunnableDevEnvironment(ssr)) {
          logger.warn("ssr environment is not runnable, boot deferred to first request");
          return;
        }

        await ssr.runner.import(BOOT_MODULE);
      },
    },
  };
}
