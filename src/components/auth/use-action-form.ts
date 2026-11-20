import { useState, type FormEvent } from "react";
import { isInputError, type ActionError } from "astro:actions";

type FormAction = (input: FormData) => Promise<{ error?: ActionError }>;

type FieldErrors = Record<string, { message: string }[] | undefined>;

/**
 * submit a form to an astro action and track its state
 *
 * @param action form action to call
 * @param redirect path to go to on success
 *
 * @returns form state and submit handler
 */
export function useActionForm(action: FormAction, redirect: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setPending(true);
    setError(null);
    setFields({});

    const { error } = await action(new FormData(event.currentTarget));

    if (!error) {
      window.location.assign(redirect);
      return;
    }

    setPending(false);

    if (isInputError(error)) {
      setFields(
        Object.fromEntries(
          Object.entries(error.fields).map(([field, messages]) => [
            field,
            messages?.map((message) => ({ message })),
          ]),
        ),
      );
    } else {
      setError(error.message);
    }
  }

  return { pending, error, fields, onSubmit };
}
