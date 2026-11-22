declare namespace App {
  interface Locals {
    user: import("@/lib/server/auth/session").User | null
    session: import("@/lib/server/auth/session").Session | null
  }
}
