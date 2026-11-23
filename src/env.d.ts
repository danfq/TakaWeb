declare namespace App {
  interface Locals {
    user: import("@/lib/server/auth/session").User | null
    session: import("@/lib/server/auth/session").Session | null
  }
}

declare module "virtual:app" {
  const app: {
    name: string
    version: string
    license: string
    author: string
    url: string
  }
  export default app
}
