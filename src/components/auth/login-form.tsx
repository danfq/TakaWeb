import { actions } from "astro:actions"
import { CircleAlert, LockKeyhole } from "lucide-react"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useActionForm } from "@/components/auth/use-action-form"

/**
 * admin sign in form
 */
export default function LoginForm() {
  const { pending, error, fields, onSubmit } = useActionForm(actions.auth.login, "/")

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
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>{error}</AlertTitle>
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
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
