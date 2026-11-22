import { useState } from "react"
import { actions } from "astro:actions"
import { LogOut, Monitor } from "lucide-react"
import { useLocale } from "@/components/dashboard/locale"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { describeAgent, type SessionInfo } from "@/lib/account"

/**
 * when a session signed in, in the dashboard's locale and timezone
 *
 * @param ms epoch ms
 * @param locale locale
 * @param tz timezone
 * @param hour12 time format
 *
 * @returns {string} e.g. Nov 22, 2026, 9:30 PM
 */
const signedIn = (ms: number, locale: string, tz: string, hour12?: boolean): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: tz, hour12 }).format(
    ms
  )

/**
 * one session, with a way to sign it out unless it is this one
 */
function SessionRow({
  session,
  busy,
  onRevoke,
}: {
  session: SessionInfo
  busy: boolean
  onRevoke: () => void
}) {
  const { locale, tz, hour12 } = useLocale()

  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="bg-muted mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full">
        <Monitor className="size-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex items-center gap-2 font-medium">
          <span className="truncate">{describeAgent(session.userAgent)}</span>
          {session.current && (
            <span className="bg-primary/10 text-primary shrink-0 rounded-full px-2 py-0.5 text-[0.7rem]">
              This device
            </span>
          )}
        </p>
        <p className="text-muted-foreground text-xs">
          <span data-sensitive>{session.ip || "Unknown address"}</span> · Signed in{" "}
          <time dateTime={new Date(session.createdAt).toISOString()}>
            {signedIn(session.createdAt, locale, tz, hour12)}
          </time>
        </p>
        <p className="text-muted-foreground/80 truncate font-mono text-[0.7rem]" title={session.userAgent}>
          {session.userAgent || "No user agent"}
        </p>
      </div>

      {!session.current && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive shrink-0"
          aria-label={`Sign out ${describeAgent(session.userAgent)}`}
          title="Sign out this session"
          disabled={busy}
          onClick={onRevoke}>
          <LogOut />
        </Button>
      )}
    </li>
  )
}

/**
 * every signed in session, any but this one can be signed out
 */
export default function SessionList({
  sessions,
  onSessions,
}: {
  sessions: SessionInfo[]
  onSessions: (sessions: SessionInfo[]) => void
}) {
  // the session being signed out, or all of the others
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const others = sessions.filter((session) => !session.current).length

  /**
   * sign out sessions and show what is left
   *
   * @param target session id, or others for every other one
   */
  const revoke = async (target: string) => {
    setBusy(target)
    setError(null)

    try {
      const { data, error } =
        target === "others" ? await actions.auth.revokeOthers() : await actions.auth.revoke({ id: target })

      if (error) setError(error.message)
      else onSessions(data)
    } catch {
      setError("Could not reach TakaWeb, check your connection and try again")
    }

    setBusy(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-border flex flex-col divide-y">
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            busy={busy !== null}
            onRevoke={() => revoke(session.id)}
          />
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      {others > 0 && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={busy !== null}
          onClick={() => revoke("others")}>
          {busy === "others" ? <Spinner /> : <LogOut />}
          Sign out {others === 1 ? "the other session" : `all ${others} other sessions`}
        </Button>
      )}
    </div>
  )
}
