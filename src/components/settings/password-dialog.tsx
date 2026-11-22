import { useState } from "react"
import { actions } from "astro:actions"
import { CircleAlert, CircleCheck, KeyRound } from "lucide-react"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useActionForm } from "@/components/auth/use-action-form"
import { PASSWORD_MIN } from "@/lib/account"

/**
 * change the admin password, which signs out every other session
 */
export default function PasswordDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // after other sessions were signed out
  onChanged: () => void
}) {
  const [revoked, setRevoked] = useState<number | null>(null)

  const { pending, error, fields, onSubmit, clear } = useActionForm(
    actions.auth.changePassword,
    (data, form) => {
      form.reset()
      setRevoked(data.revoked)
      onChanged()
    }
  )

  /**
   * open or close, starting over each time
   *
   * @param next whether it is open
   */
  const toggle = (next: boolean) => {
    if (pending) return

    onOpenChange(next)
    clear()
    setRevoked(null)
  }

  return (
    <Dialog open={open} onOpenChange={toggle}>
      <DialogContent className="sm:max-w-sm" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Every other session is signed out once it changes.</DialogDescription>
        </DialogHeader>

        {revoked !== null ? (
          <>
            <div role="status" className="flex items-center gap-3 py-2">
              <CircleCheck className="size-5 shrink-0 text-emerald-500" />
              <p>
                Password changed.{" "}
                {revoked
                  ? `${revoked} other session${revoked === 1 ? " was" : "s were"} signed out.`
                  : "No other sessions were signed in."}
              </p>
            </div>

            <DialogFooter>
              <Button onClick={() => toggle(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-6">
            {/* lets password managers update the credential */}
            <input type="text" name="username" value="admin" autoComplete="username" readOnly hidden />

            <FieldGroup className="gap-4">
              {error && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>{error}</AlertTitle>
                </Alert>
              )}

              <Field data-invalid={!!fields.current}>
                <FieldLabel htmlFor="password-current">Current password</FieldLabel>
                <Input
                  id="password-current"
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!fields.current}
                  required
                />
                <FieldError errors={fields.current} />
              </Field>

              <Field data-invalid={!!fields.password}>
                <FieldLabel htmlFor="password-new">New password</FieldLabel>
                <Input
                  id="password-new"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!fields.password}
                  minLength={PASSWORD_MIN}
                  required
                />
                {fields.password ? (
                  <FieldError errors={fields.password} />
                ) : (
                  <FieldDescription>At least {PASSWORD_MIN} characters.</FieldDescription>
                )}
              </Field>

              <Field data-invalid={!!fields.confirm}>
                <FieldLabel htmlFor="password-confirm">Confirm new password</FieldLabel>
                <Input
                  id="password-confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!fields.confirm}
                  required
                />
                <FieldError errors={fields.confirm} />
              </Field>
            </FieldGroup>

            <p className="text-muted-foreground text-xs">
              Forgot it? It can only be reset from the server, with <code>takaweb reset-password</code>.
            </p>

            <DialogFooter>
              <DialogClose render={<Button variant="ghost" disabled={pending} />}>Cancel</DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : <KeyRound />}
                Change password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
