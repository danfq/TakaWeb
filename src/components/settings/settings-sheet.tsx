import { useEffect, useState, type ReactNode } from "react"
import { RotateCcw, Settings as SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
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
import { useSettings, useSettingsError, useSettingsStore } from "@/components/settings/settings-store"
import WakatimeImport from "@/components/settings/wakatime-import"
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
    section: "Privacy",
    title: "Hide names",
    description: "Blur projects, branches and files for screen sharing.",
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
      <FieldLegend variant="label" className="text-muted-foreground mb-4 text-xs tracking-wide uppercase">
        {title}
      </FieldLegend>
      <FieldGroup className="gap-5">{children}</FieldGroup>
    </FieldSet>
  )
}

/**
 * settings sidebar, also opens with cmd or ctrl + comma
 */
export default function SettingsSheet() {
  const [open, setOpen] = useState(false)
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
        <SheetHeader className="pr-36">
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

        {/* sized to fit, only scrolls as a last resort on very short screens */}
        <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-9 overflow-y-auto px-6 pt-2 pb-6">
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

          <Section title="Data">
            <WakatimeImport />
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
