import { useEffect, useRef, useState, type ReactNode } from "react"
import { actions } from "astro:actions"
import { CircleCheck, FileJson, Upload } from "lucide-react"
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
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { UNKNOWN, importBatches, parseExport, type Agents } from "@/lib/wakatime"

/**
 * how long the remove button waits for its confirming click
 */
const CONFIRM_WINDOW = 4000

type Names = "skip" | "token"

type Phase =
  | { state: "form"; error?: string }
  | { state: "working"; message: string }
  | { state: "done"; message: string }

/**
 * format a count for the current locale
 *
 * @param value count
 *
 * @returns {string} e.g. 12,345
 */
const count = (value: number): string => value.toLocaleString()

/**
 * link to a wakatime page, opened in a new tab
 */
function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="hover:text-foreground underline underline-offset-3">
      {children}
    </a>
  )
}

/**
 * explains the import, then runs it once confirmed
 */
function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [names, setNames] = useState<Names>("skip")
  const [token, setToken] = useState("")
  const [phase, setPhase] = useState<Phase>({ state: "form" })

  const working = phase.state === "working"
  const ready = !!file && (names === "skip" || !!token.trim())

  // start over each time it opens, the token never outlives the dialog
  useEffect(() => {
    if (!open) return

    setFile(null)
    setNames("skip")
    setToken("")
    setPhase({ state: "form" })
  }, [open])

  /**
   * look up names if asked, convert the export and send it over in batches
   */
  const run = async () => {
    if (!file) return

    let agents: Agents = {}

    if (names === "token") {
      setPhase({ state: "working", message: "Looking up editors and systems" })

      try {
        const { data, error } = await actions.wakatime.agents({ token: token.trim() })
        if (error) return setPhase({ state: "form", error: error.message })

        agents = data
      } catch {
        return setPhase({
          state: "form",
          error: "Could not reach TakaWeb, check your connection and try again",
        })
      }
    }

    setPhase({ state: "working", message: "Reading export" })

    let heartbeats
    try {
      heartbeats = parseExport(JSON.parse(await file.text()), agents)
    } catch (error) {
      return setPhase({
        state: "form",
        error: error instanceof SyntaxError ? "This file is not valid JSON" : (error as Error).message,
      })
    }

    if (!heartbeats.length) {
      return setPhase({ state: "done", message: "Nothing to import, the export has no heartbeats." })
    }

    let added = 0
    let skipped = 0
    let sent = 0

    /**
     * back to the form after a failed batch, earlier batches stay saved
     *
     * @param reason what went wrong
     */
    const stopped = (reason: string) => {
      onImported()
      setPhase({
        state: "form",
        error: `${reason}. ${count(added)} heartbeats were saved before it stopped, importing again picks up the rest.`,
      })
    }

    for (const batch of importBatches(heartbeats)) {
      setPhase({
        state: "working",
        message: `Importing ${count(sent)} of ${count(heartbeats.length)} heartbeats`,
      })

      try {
        const { data, error } = await actions.wakatime.import({ heartbeats: batch })
        if (error) return stopped(error.message)

        added += data.added
        skipped += data.skipped
        sent += batch.length
      } catch {
        return stopped("Could not reach TakaWeb")
      }
    }

    const unnamed = heartbeats.filter((beat) => beat.editor === UNKNOWN).length

    onImported()
    setPhase({
      state: "done",
      message: [
        `Added ${count(added)} heartbeats to your dashboard.`,
        skipped && `${count(skipped)} were already imported.`,
        unnamed && `${count(unnamed)} have no editor name.`,
      ]
        .filter(Boolean)
        .join(" "),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      {/* a single shrinkable column, so long file names truncate instead of widening the dialog */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-5 sm:max-w-lg" showCloseButton={!working}>
        <DialogHeader>
          <DialogTitle>Import from WakaTime</DialogTitle>
          <DialogDescription>Bring your past coding time over from WakaTime.</DialogDescription>
        </DialogHeader>

        {phase.state === "form" ? (
          <div className="flex flex-col gap-4">
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              <li>
                On WakaTime, open{" "}
                <External href="https://wakatime.com/settings/account">account settings</External> and export
                your <strong className="font-medium">Heartbeats</strong>.
              </li>
              <li>
                Choose that file below. It is read in your browser and saved to TakaWeb&apos;s own database.
              </li>
            </ol>

            <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
              <li>
                Your TakaTime database is never written to, TakaWeb keeps its read-only access. Imported time
                shows here only, not in TakaTime&apos;s own tools.
              </li>
              <li>
                Importing again skips what is already here, and you can remove imported time from settings.
              </li>
              <li>Time both WakaTime and TakaTime tracked only counts once.</li>
            </ul>

            <div className="flex min-w-0 items-center gap-3">
              <input
                ref={input}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  event.target.value = ""
                }}
              />
              <Button variant="secondary" className="shrink-0" onClick={() => input.current?.click()}>
                <FileJson />
                {file ? "Change file" : "Choose export"}
              </Button>
              <span className="text-muted-foreground truncate" title={file?.name}>
                {file?.name ?? "No file chosen"}
              </span>
            </div>

            <div className="bg-muted/50 flex flex-col gap-3 rounded-2xl p-4">
              <p>
                <span className="font-medium">Editors and systems.</span>{" "}
                <span className="text-muted-foreground">
                  WakaTime exports only refer to them by an internal ID, so imported time shows them as
                  Unknown.
                </span>
              </p>

              <RadioGroup
                value={names}
                onValueChange={(value) => setNames(value as Names)}
                className="gap-2.5">
                <Field orientation="horizontal">
                  <RadioGroupItem value="skip" id="wakatime-names-skip" />
                  <FieldLabel htmlFor="wakatime-names-skip" className="font-normal">
                    Import without them, and accept Unknown
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <RadioGroupItem value="token" id="wakatime-names-token" />
                  <FieldLabel htmlFor="wakatime-names-token" className="font-normal">
                    Look them up with a WakaTime token
                  </FieldLabel>
                </Field>
              </RadioGroup>

              {names === "token" && (
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="password"
                    autoComplete="off"
                    aria-label="WakaTime token"
                    placeholder="waka_tok_…"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Copy it from <External href="https://wakatime.com/oauth">wakatime.com/oauth</External>,
                    plugin API keys can only send data. It is used once for this import and never stored.
                  </p>
                </div>
              )}

              <p className="text-muted-foreground text-xs">
                On WakaTime&apos;s free plan the API only reaches recent history, which is why your time
                always comes from the export. The token only names editors and systems, so any WakaTime no
                longer lists stay Unknown.
              </p>
            </div>

            {phase.error && (
              <p role="alert" className="text-destructive">
                {phase.error}
              </p>
            )}
          </div>
        ) : (
          <div role="status" className="flex items-center gap-3 py-4">
            {phase.state === "working" ? (
              <Spinner className="size-5" />
            ) : (
              <CircleCheck className="size-5 shrink-0 text-emerald-500" />
            )}
            <p>{phase.message}</p>
          </div>
        )}

        <DialogFooter>
          {phase.state === "form" ? (
            <>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button disabled={!ready} onClick={run}>
                <Upload />
                Import
              </Button>
            </>
          ) : (
            <Button disabled={working} onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * wakatime import entry in settings, with a way to remove what was imported
 */
export default function WakatimeImport() {
  const [open, setOpen] = useState(false)
  const [imported, setImported] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  /**
   * refresh how many heartbeats came from wakatime
   */
  const refresh = async () => {
    try {
      const { data } = await actions.wakatime.status()
      if (data) setImported(data.imported)
    } catch {
      // keeps the last known count, the next refresh tries again
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // the confirming click has to come soon after the first
  useEffect(() => {
    if (!confirming) return

    const timer = setTimeout(() => setConfirming(false), CONFIRM_WINDOW)
    return () => clearTimeout(timer)
  }, [confirming])

  /**
   * delete imported heartbeats, asking for a second click first
   */
  const remove = async () => {
    if (!confirming) return setConfirming(true)

    setConfirming(false)
    setRemoving(true)

    try {
      const { data, error } = await actions.wakatime.remove()
      setNotice(error ? error.message : `Removed ${count(data.removed)} heartbeats`)
    } catch {
      setNotice("Could not reach TakaWeb, the heartbeats may not have been removed")
    } finally {
      setRemoving(false)
      // the outcome may be unknown, so read back what is actually left
      refresh()
    }
  }

  return (
    <Field orientation="horizontal">
      <FieldContent className="min-w-0">
        <FieldTitle>WakaTime</FieldTitle>
        <FieldDescription role="status">
          {notice ??
            (imported ? `${count(imported)} heartbeats imported` : "Bring in your past coding time.")}
        </FieldDescription>
      </FieldContent>

      <div className="flex shrink-0 items-center gap-1.5">
        {!!imported && (
          <Button variant="ghost" size="sm" className="text-destructive" disabled={removing} onClick={remove}>
            {removing && <Spinner />}
            {confirming ? "Confirm" : "Remove"}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setNotice(null)
            setOpen(true)
          }}>
          <Upload />
          Import
        </Button>
      </div>

      <ImportDialog open={open} onOpenChange={setOpen} onImported={refresh} />
    </Field>
  )
}
