import { useState } from "react"
import { actions } from "astro:actions"
import { ArrowLeft, CircleAlert, LockKeyhole, ShieldCheck } from "lucide-react"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import CodeInput from "@/components/auth/code-input"
import { useActionForm } from "@/components/auth/use-action-form"

/**
 * the password, the only step unless two-factor is on
 */
function PasswordStep({ notice, onCode }: { notice: string | null; onCode: () => void }) {
  const { pending, error, fields, onSubmit } = useActionForm(actions.auth.login, (data) =>
    data.twoFactor ? onCode() : window.location.assign("/")
  )

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="bg-muted mb-2 flex size-10 items-center justify-center rounded-full">
          <LockKeyhole className="size-5" />
        </div>
        <CardTitle className="text-lg">Welcome back</CardTitle>
        <CardDescription>Enter the admin password to continue.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit}>
          {/* lets password managers fill the credential */}
          <input type="text" name="username" value="admin" autoComplete="username" readOnly hidden />

          <FieldGroup>
            {(error ?? notice) && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>{error ?? notice}</AlertTitle>
              </Alert>
            )}

            <Field data-invalid={!!fields.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!fields.password}
                autoFocus
                required
              />
              <FieldError errors={fields.password} />
            </Field>

            <Field>
              <Button type="submit" size="lg" disabled={pending}>
                {pending && <Spinner />}
                Sign in
              </Button>
              <FieldDescription className="text-center text-xs">
                Forgot it? Run <code>takaweb reset-password</code> on the server.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * a code from the authenticator app, once the password checked out
 */
function CodeStep({ onRestart }: { onRestart: (notice: string | null) => void }) {
  const { pending, error, fields, onSubmit } = useActionForm(actions.twoFactor.verify, "/", (error) => {
    // the held sign in is gone, so the password is needed again
    if (error.code !== "PRECONDITION_FAILED") return false

    onRestart(error.message)
    return true
  })

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="bg-muted mb-2 flex size-10 items-center justify-center rounded-full">
          <ShieldCheck className="size-5" />
        </div>
        <CardTitle className="text-lg">Two-factor authentication</CardTitle>
        <CardDescription>Enter the code from your authenticator app.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            <Field data-invalid={!!fields.code}>
              <FieldLabel htmlFor="code">Code</FieldLabel>
              <CodeInput id="code" aria-invalid={!!fields.code} autoFocus />
              <FieldError errors={fields.code} />
            </Field>

            <Field>
              <Button type="submit" size="lg" disabled={pending}>
                {pending && <Spinner />}
                Verify
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => onRestart(null)}>
                <ArrowLeft />
                Back
              </Button>
              <FieldDescription className="text-center text-xs">
                Lost your device? Run <code>takaweb disable-2fa</code> on the server.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * admin sign in form, asks for a code after the password when two-factor is on
 */
export default function LoginForm() {
  const [step, setStep] = useState<"password" | "code">("password")
  // why the code step sent the visitor back
  const [notice, setNotice] = useState<string | null>(null)

  if (step === "code") {
    return (
      <CodeStep
        onRestart={(next) => {
          setNotice(next)
          setStep("password")
        }}
      />
    )
  }

  return (
    <PasswordStep
      notice={notice}
      onCode={() => {
        setNotice(null)
        setStep("code")
      }}
    />
  )
}
