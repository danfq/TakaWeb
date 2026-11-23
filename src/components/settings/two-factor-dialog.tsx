import { useMemo, useState } from "react"
import { actions } from "astro:actions"
import { CircleAlert, CircleCheck, ShieldCheck, ShieldOff } from "lucide-react"
import { encode } from "uqr"
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
import CodeInput from "@/components/auth/code-input"
import { useActionForm } from "@/components/auth/use-action-form"
import { useNamesHidden } from "@/components/settings/settings-store"

/**
 * where setup is at, turning it off takes a single step
 */
type Step =
  { name: "password" } | { name: "scan"; secret: string; uri: string } | { name: "done"; message: string }

/**
 * a qr code as an svg, drawn dark on light so every app can read it in either theme
 */
function QrCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const { data } = encode(value, { ecc: "M", border: 0 })
    let path = ""

    data.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x} ${y}h1v1h-1z`)))

    return { size: data.length, path }
  }, [value])

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code to scan with your authenticator app"
      className="size-44 rounded-2xl bg-white p-3 text-black">
      <path d={path} fill="currentColor" />
    </svg>
  )
}

/**
 * an error that is not about a single field
 */
function FormError({ error }: { error: string | null }) {
  if (!error) return null

  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{error}</AlertTitle>
    </Alert>
  )
}

/**
 * the admin password, for the step that needs it
 */
function PasswordField({ errors }: { errors?: { message: string }[] }) {
  return (
    <Field data-invalid={!!errors}>
      <FieldLabel htmlFor="two-factor-password">Password</FieldLabel>
      <Input
        id="two-factor-password"
        name="password"
        type="password"
        autoComplete="current-password"
        aria-invalid={!!errors}
        autoFocus
        required
      />
      <FieldError errors={errors} />
    </Field>
  )
}

/**
 * confirm the password, then scan the secret and prove it with a code
 */
function EnableFlow({
  step,
  onStep,
  onEnabled,
}: {
  step: Exclude<Step, { name: "done" }>
  onStep: (step: Step) => void
  onEnabled: (revoked: number) => void
}) {
  const hidden = useNamesHidden()

  const enable = useActionForm(
    actions.twoFactor.enable,
    (data) => onEnabled(data.revoked),
    (error) => {
      // the secret expired, so a new one has to be scanned
      if (error.code !== "PRECONDITION_FAILED") return false

      onStep({ name: "password" })
      return false
    }
  )
  const start = useActionForm(actions.twoFactor.start, (data) => {
    // a timeout from the last setup no longer applies to the new secret
    enable.clear()
    onStep({ name: "scan", ...data })
  })

  if (step.name === "password") {
    return (
      <form onSubmit={start.onSubmit} className="flex flex-col gap-6">
        <input type="text" name="username" value="admin" autoComplete="username" readOnly hidden />

        <FieldGroup className="gap-4">
          <FormError error={start.error ?? enable.error} />
          <PasswordField errors={start.fields.password} />
        </FieldGroup>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={start.pending} />}>Cancel</DialogClose>
          <Button type="submit" disabled={start.pending}>
            {start.pending && <Spinner />}
            Continue
          </Button>
        </DialogFooter>
      </form>
    )
  }

  return (
    <form onSubmit={enable.onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3">
        {/* the secret is as good as the password, so it blurs for screen sharing like names do */}
        <div data-sensitive>
          <QrCode value={step.uri} />
        </div>

        <p className="text-muted-foreground text-center text-xs">
          Can't scan it? Enter this key instead:
          <br />
          <code data-sensitive className="text-foreground font-mono text-sm break-all select-all">
            {step.secret.match(/.{1,4}/g)?.join(" ")}
          </code>
        </p>

        {hidden && (
          <p className="text-muted-foreground text-center text-xs">
            Turn off <span className="text-foreground">Hide private details</span> to see it.
          </p>
        )}
      </div>

      <FieldGroup className="gap-4">
        <FormError error={enable.error} />

        <Field data-invalid={!!enable.fields.code}>
          <FieldLabel htmlFor="two-factor-code">Code from your app</FieldLabel>
          <CodeInput id="two-factor-code" aria-invalid={!!enable.fields.code} autoFocus />
          <FieldError errors={enable.fields.code} />
        </Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" disabled={enable.pending} />}>Cancel</DialogClose>
        <Button type="submit" disabled={enable.pending}>
          {enable.pending ? <Spinner /> : <ShieldCheck />}
          Turn on
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * the password and a current code turn it off
 */
function DisableFlow({ onDisabled }: { onDisabled: () => void }) {
  const { pending, error, fields, onSubmit } = useActionForm(actions.twoFactor.disable, onDisabled)

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="text" name="username" value="admin" autoComplete="username" readOnly hidden />

      <FieldGroup className="gap-4">
        <FormError error={error} />
        <PasswordField errors={fields.password} />

        <Field data-invalid={!!fields.code}>
          <FieldLabel htmlFor="two-factor-code">Code from your app</FieldLabel>
          <CodeInput id="two-factor-code" aria-invalid={!!fields.code} />
          <FieldError errors={fields.code} />
        </Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" disabled={pending} />}>Cancel</DialogClose>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? <Spinner /> : <ShieldOff />}
          Turn off
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * turn two-factor authentication on or off
 */
export default function TwoFactorDialog({
  open,
  onOpenChange,
  enabled,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  enabled: boolean
  // after it turned on or off, other sessions may have been signed out
  onChanged: (enabled: boolean) => void
}) {
  const [step, setStep] = useState<Step>({ name: "password" })

  /**
   * open or close, starting over each time
   *
   * @param next whether it is open
   */
  const toggle = (next: boolean) => {
    onOpenChange(next)
    setStep({ name: "password" })
  }

  let description = "Sign ins will also ask for a code from an authenticator app."
  let content

  if (step.name === "scan")
    description = "Scan this with your authenticator app, then enter the code it shows."
  else if (step.name === "done")
    description = enabled ? "Sign ins now ask for a code too." : "Sign ins only ask for your password."
  else if (enabled) description = "Enter your password and a code from your app to turn it off."

  if (step.name === "done") {
    content = (
      <>
        <div role="status" className="flex items-center gap-3 py-2">
          <CircleCheck className="size-5 shrink-0 text-emerald-500" />
          <p>{step.message}</p>
        </div>

        <DialogFooter>
          <Button onClick={() => toggle(false)}>Done</Button>
        </DialogFooter>
      </>
    )
  } else if (enabled) {
    content = (
      <DisableFlow
        onDisabled={() => {
          setStep({ name: "done", message: "Two-factor authentication is off." })
          onChanged(false)
        }}
      />
    )
  } else {
    content = (
      <EnableFlow
        step={step}
        onStep={setStep}
        onEnabled={(revoked) => {
          setStep({
            name: "done",
            message: `Two-factor authentication is on. ${
              revoked
                ? `${revoked} other session${revoked === 1 ? " was" : "s were"} signed out.`
                : "No other sessions were signed in."
            }`,
          })
          onChanged(true)
        }}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={toggle}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Two-factor authentication</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {content}
      </DialogContent>
    </Dialog>
  )
}
