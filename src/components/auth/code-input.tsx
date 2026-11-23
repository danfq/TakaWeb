import type { ComponentProps } from "react"
import { cn } from "cn"
import { Input } from "@/components/ui/input"
import { CODE_LENGTH } from "@/lib/account"

/**
 * an authenticator app code, phones offer to fill it in from the app
 */
export default function CodeInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      name="code"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder={"0".repeat(CODE_LENGTH)}
      // room for a space or dash in the middle, as some apps show it
      maxLength={CODE_LENGTH + 2}
      className={cn("text-center font-mono tracking-[0.3em]", className)}
      required
      {...props}
    />
  )
}
