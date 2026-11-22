import { useState } from "react"
import { actions } from "astro:actions"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

/**
 * end the session and go back to sign in, once confirmed
 */
export default function LogoutButton() {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function logout() {
    setPending(true)
    setError(null)

    try {
      const { error: failure } = await actions.auth.logout()
      if (!failure) return window.location.assign("/login")

      setError(failure.message)
    } catch {
      // the request never completed, so the session is likely still active
      setError("Could not reach TakaWeb, check your connection and try again")
    }

    setPending(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return

        setOpen(next)
        setError(null)
      }}>
      <DialogTrigger render={<Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" />}>
        <LogOut />
      </DialogTrigger>

      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Sign out?</DialogTitle>
          <DialogDescription>You will need your password to sign back in.</DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={logout}>
            {pending ? <Spinner /> : <LogOut />}
            Sign out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
