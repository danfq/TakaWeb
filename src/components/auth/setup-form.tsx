import { actions } from "astro:actions";
import { CircleAlert, KeyRound } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useActionForm } from "@/components/auth/use-action-form";

/**
 * first-boot form to claim the admin account
 */
export default function SetupForm() {
  const { pending, error, fields, onSubmit } = useActionForm(
    actions.auth.setup,
    "/",
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
          <KeyRound className="size-5" />
        </div>
        <CardTitle className="text-lg">Create admin account</CardTitle>
        <CardDescription>
          Paste the one-time setup token printed to the server console, then
          choose a password.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit}>
          {/* lets password managers save the credential */}
          <input
            type="text"
            name="username"
            value="admin"
            autoComplete="username"
            readOnly
            hidden
          />

          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            <Field data-invalid={!!fields.token}>
              <FieldLabel htmlFor="token">Setup token</FieldLabel>
              <Input
                id="token"
                name="token"
                placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={!!fields.token}
                required
              />
              <FieldError errors={fields.token} />
            </Field>

            <Field data-invalid={!!fields.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!fields.password}
                required
              />
              {fields.password ? (
                <FieldError errors={fields.password} />
              ) : (
                <FieldDescription>At least 12 characters.</FieldDescription>
              )}
            </Field>

            <Field data-invalid={!!fields.confirm}>
              <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!fields.confirm}
                required
              />
              <FieldError errors={fields.confirm} />
            </Field>

            <Field>
              <Button type="submit" size="lg" disabled={pending}>
                {pending && <Spinner />}
                Create account
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
