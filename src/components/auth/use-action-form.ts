import { useState, type FormEvent } from "react"
import { isInputError, type ActionError } from "astro:actions"

type FormAction<T> = (input: FormData) => Promise<{ data?: T; error?: ActionError }>

type FieldErrors = Record<string, { message: string }[] | undefined>

/**
 * submit a form to an astro action and track its state
 *
 * @param action form action to call
 * @param done path to go to on success, or a callback given the result and form
 *
 * @returns form state and submit handler
 */
export function useActionForm<T>(action: FormAction<T>, done: string | ((data: T, form: HTMLFormElement) => void)) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldErrors>({})

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const form = event.currentTarget

    setPending(true)
    setError(null)
    setFields({})

    let result: Awaited<ReturnType<FormAction<T>>>

    try {
      result = await action(new FormData(form))
    } catch {
      setPending(false)
      setError("Could not reach TakaWeb, check your connection and try again")
      return
    }

    const { data, error } = result

    if (!error) {
      if (typeof done === "string") return window.location.assign(done)

      setPending(false)
      done(data as T, form)
      return
    }

    setPending(false)

    if (isInputError(error)) {
      setFields(
        Object.fromEntries(
          Object.entries(error.fields).map(([field, messages]) => [
            field,
            messages?.map((message) => ({ message })),
          ])
        )
      )
    } else {
      setError(error.message)
    }
  }

  /**
   * clear errors, e.g. when the form is closed
   */
  const clear = () => {
    setError(null)
    setFields({})
  }

  return { pending, error, fields, onSubmit, clear }
}
