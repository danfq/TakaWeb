import { useEffect, useState, type ReactNode } from "react"
import { actions } from "astro:actions"
import { KeyRound, MonitorSmartphone, RotateCcw, Settings as SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { isApple } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import DataExport from "@/components/settings/data-export"
import PasswordDialog from "@/components/settings/password-dialog"
import SessionsDialog from "@/components/settings/sessions-dialog"
import { useSettings, useSettingsError, useSettingsStore } from "@/components/settings/settings-store"
import WakatimeImport from "@/components/settings/wakatime-import"
import type { Account, SessionInfo } from "@/lib/account"
import { keyboardMode } from "@/lib/focus"
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings"
import { RANGE_OPTIONS } from "@/lib/stats/view"

/**
 * settings options, grouped by section in order
 * a segmented choice sits on one line with its label, a switch unless choices are given
 */
const SETTINGS_OPTIONS: {
  id: keyof Settings
  section: string
  title: string
  // switches only, choices explain themselves through their titles
  description?: string
  // label is shown, title is read out and shown on hover
  choices?: { value: string; label: string; title: string }[]
}[] = [
  {
    id: "timeFormat",
    section: "Display",
    title: "Time format",
    choices: [
      { value: "auto", label: "Auto", title: "Follow your language" },
      { value: "12h", label: "12h", title: "12-hour clock" },
      { value: "24h", label: "24h", title: "24-hour clock" },
    ],
  },
  {
    id: "durations",
    section: "Display",
    title: "Durations",
    choices: [
      { value: "short", label: "3h 12m", title: "Hours and minutes" },
      { value: "decimal", label: "3.2h", title: "Decimal hours" },
    ],
  },
  {
    id: "defaultRange",
    section: "Dashboard",
    title: "Open on",
    choices: [
      { value: "last", label: "Last", title: "Wherever you left off" },
      ...RANGE_OPTIONS.map((range) => ({ value: range.value, label: range.short, title: range.label })),
    ],
  },
  {
    id: "tabTitle",
    section: "Dashboard",
    title: "Time in tab title",
    description: "Today's total, with a dot while you code.",
  },
  {
    id: "hideNames",
    section: "Dashboard",
    title: "Hide names",
    description: "Blur names for screen sharing.",
  },
]

const SECTIONS = [...new Set(SETTINGS_OPTIONS.map((option) => option.section))]

/**
 * one setting, a segmented choice or a switch
 */
function SettingField({
  option,
  value,
}: {
  option: (typeof SETTINGS_OPTIONS)[number]
  value: Settings[keyof Settings]
}) {
  const { update } = useSettingsStore()
  const id = `setting-${option.id}`

  return option.choices ? (
    // wraps below its label when the sheet is narrow
    <Field orientation="horizontal" className="flex-wrap justify-between gap-y-2">
      <FieldLabel id={id}>{option.title}</FieldLabel>

      <ToggleGroup
        aria-labelledby={id}
        spacing={0}
        className="bg-muted rounded-full p-1"
        value={[String(value)]}
        onValueChange={(next) => next[0] && update({ [option.id]: next[0] } as Partial<Settings>)}>
        {option.choices.map((choice) => (
          <ToggleGroupItem
            key={choice.value}
            value={choice.value}
            aria-label={choice.title}
            title={choice.title}
            className="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground dark:aria-pressed:bg-input/40 h-7! min-w-0 rounded-full! px-2.5! text-xs aria-pressed:shadow-sm">
            {choice.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  ) : (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{option.title}</FieldLabel>
        {option.description && <FieldDescription>{option.description}</FieldDescription>}
      </FieldContent>

      <Switch
        id={id}
        checked={value === true}
        onCheckedChange={(checked) => update({ [option.id]: checked } as Partial<Settings>)}
      />
    </Field>
  )
}

/**
 * a titled group of settings
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    // legends sit outside the fieldset's flex layout, so their spacing comes from a margin
    <FieldSet className="gap-0">
      <FieldLegend
        variant="label"
        className="text-muted-foreground short:mb-3 shortest:mb-2 mb-4 text-xs tracking-wide uppercase">
        {title}
      </FieldLegend>
      <FieldGroup className="short:gap-4 shorter:gap-3 shortest:gap-2 gap-5">{children}</FieldGroup>
    </FieldSet>
  )
}

/**
 * the account password and every signed in session
 */
function AccountSection({
  sessions,
  onSessions,
}: {
  sessions: SessionInfo[]
  onSessions: (sessions: SessionInfo[]) => void
}) {
  const [changing, setChanging] = useState(false)
  const [listing, setListing] = useState(false)

  /**
   * show the sessions left after a password change signed the others out
   */
  const refresh = async () => {
    try {
      const { data } = await actions.auth.sessions()
      if (data) onSessions(data)
    } catch {}
  }

  return (
    <Section title="Account">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>Password</FieldTitle>
          <FieldDescription>Signs out every other session.</FieldDescription>
        </FieldContent>

        <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
          <KeyRound />
          Change
        </Button>

        <PasswordDialog open={changing} onOpenChange={setChanging} onChanged={refresh} />
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>Sessions</FieldTitle>
          <FieldDescription>
            {sessions.length === 1 ? "Only this browser is" : `${sessions.length} browsers are`} signed in.
          </FieldDescription>
        </FieldContent>

        <Button variant="secondary" size="sm" onClick={() => setListing(true)}>
          <MonitorSmartphone />
          Manage
        </Button>

        <SessionsDialog
          open={listing}
          onOpenChange={setListing}
          sessions={sessions}
          onSessions={onSessions}
        />
      </Field>
    </Section>
  )
}

/**
 * settings sidebar, also opens with cmd or ctrl + comma
 */
export default function SettingsSheet({ account }: { account: Account }) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState(account.sessions)
  const settings = useSettings()
  const error = useSettingsError()
  const { reset } = useSettingsStore()
  // filled in after mount, the server cannot know the platform
  const [shortcut, setShortcut] = useState<{
    label: string
    keys: string
  } | null>(null)

  const changed = SETTINGS_OPTIONS.some((option) => settings[option.id] !== DEFAULT_SETTINGS[option.id])

  useEffect(() => {
    setShortcut(isApple() ? { label: "⌘,", keys: "Meta+Comma" } : { label: "Ctrl+,", keys: "Control+Comma" })

    /**
     * open on cmd + comma on apple platforms, ctrl + comma elsewhere
     *
     * @param event key press
     */
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = isApple() ? event.metaKey : event.ctrlKey

      if (modifier && !event.altKey && !event.shiftKey && event.key === ",") {
        event.preventDefault()
        // opened by keyboard, so focus inside the sheet should show
        keyboardMode()
        setOpen(true)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // the rendered list shows right away, sign ins elsewhere since then fill in quietly
  useEffect(() => {
    if (!open) return

    actions.auth
      .sessions()
      .then(({ data }) => data && setSessions(data))
      .catch(() => {})
  }, [open])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            aria-keyshortcuts={shortcut?.keys}
            title={shortcut ? `Settings (${shortcut.label})` : "Settings"}
          />
        }>
        <SettingsIcon />
      </SheetTrigger>

      <SheetContent resizable storageKey="takaweb-settings-width">
        <SheetHeader className="shortest:pt-4 shortest:pb-2 pr-36">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Synced across your devices.</SheetDescription>
        </SheetHeader>

        {/* lines up with the close button */}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground absolute top-4 right-14"
          disabled={!changed}
          title="Reset settings to their defaults"
          onClick={reset}>
          <RotateCcw />
          Reset
        </Button>

        {/* never scrolls, spacing tightens and descriptions give way on shorter screens instead */}
        <div className="short:gap-7 shorter:gap-5 shortest:gap-4 shortest:pb-4 shortest:[&_[data-slot=field-description]]:hidden shortest:[&_[data-slot=field]]:items-center flex min-h-0 flex-1 flex-col gap-9 overflow-hidden px-6 pt-2 pb-6">
          {error && (
            <p role="alert" className="text-destructive -mb-5">
              {error}
            </p>
          )}

          {SECTIONS.map((section) => (
            <Section key={section} title={section}>
              {SETTINGS_OPTIONS.filter((option) => option.section === section).map((option) => (
                <SettingField key={option.id} option={option} value={settings[option.id]} />
              ))}
            </Section>
          ))}

          <AccountSection sessions={sessions} onSessions={setSessions} />

          <Section title="Data">
            <WakatimeImport imported={account.imported} />
            <DataExport />
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
