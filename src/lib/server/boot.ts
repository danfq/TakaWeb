import { bootstrap } from "@/lib/server/auth/admin"
import { installShutdown } from "@/lib/server/shutdown"

bootstrap()

// the dev server handles its own signals and reloads modules in place
if (import.meta.env.PROD) installShutdown()
