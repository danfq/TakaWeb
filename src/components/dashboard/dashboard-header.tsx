import type { ReactNode } from "react";
import { cn } from "cn";
import {
  Code2,
  FolderGit2,
  Laptop,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import LogoutButton from "@/components/auth/logout-button";
import Brand from "@/components/layout/brand";
import SettingsSheet from "@/components/settings/settings-sheet";
import ThemePicker from "@/components/theme/theme-picker";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNamesHidden } from "@/lib/settings";
import { ago, label, sensitive } from "@/lib/stats/format";
import type { Filter, Latest, Range, Status } from "@/lib/stats/types";
import { RANGE_OPTIONS } from "@/lib/stats/view";

const FILTER_ICONS: Record<Filter["dimension"], LucideIcon> = {
  project: FolderGit2,
  language: Code2,
  editor: SquarePen,
  os: Laptop,
};

type LiveProps = {
  status: Status;
  connected: boolean;
  loading: boolean;
  latest: Latest | null;
  live: boolean;
  now: number;
};

/**
 * what takatime is seeing right now, or why it cannot tell
 */
function LiveIndicator({
  status,
  connected,
  loading,
  latest,
  live,
  now,
}: LiveProps) {
  const hideNames = useNamesHidden();
  let dot = "bg-muted-foreground/50";
  let text: string;
  let detail: ReactNode = null;

  if (!connected) {
    dot = "bg-amber-500";
    text = "Reconnecting";
  } else if (status.state === "unconfigured") {
    dot = "bg-amber-500";
    text = "No database configured";
  } else if (status.state === "error") {
    dot = "bg-destructive";
    text = status.message;
  } else if (status.state === "unsupported") {
    dot = "bg-amber-500";
    text = "Live updates off";
    detail = "MongoDB must run as a replica set";
  } else if (loading) {
    text = "Connecting";
  } else if (latest && live) {
    dot = "bg-emerald-500";
    text = "Coding now";
    detail = (
      <>
        <span data-sensitive>{label("project", latest.project)}</span> ·{" "}
        {label("language", latest.language)}
      </>
    );
  } else if (latest) {
    text = `Last active ${ago(latest.end, now)}`;
  } else {
    text = "Waiting for activity";
  }

  return (
    <div
      role="status"
      className="flex h-8 min-w-0 items-center gap-2 rounded-full bg-muted/60 px-3 text-xs"
      title={
        !latest
          ? undefined
          : hideNames
            ? label("editor", latest.editor)
            : `${latest.file}\n${label("editor", latest.editor)}${latest.branch ? ` on ${latest.branch}` : ""}`
      }
    >
      {loading && connected ? (
        <Spinner className="size-3" />
      ) : (
        <span className="relative flex size-2 shrink-0">
          {live && connected && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          )}
          <span className={cn("relative size-2 rounded-full", dot)} />
        </span>
      )}

      <span className="truncate">
        <span className="font-medium">{text}</span>
        {detail && (
          <span className="hidden text-muted-foreground sm:inline">
            {" "}
            · {detail}
          </span>
        )}
      </span>
    </div>
  );
}

type DashboardHeaderProps = LiveProps & {
  // a new filter is loading
  pending: boolean;
  range: Range;
  onRange: (range: Range) => void;
  filter: Filter | null;
  onFilter: (filter: Filter | null) => void;
};

/**
 * brand, live status and the view controls
 */
export default function DashboardHeader({
  range,
  onRange,
  filter,
  onFilter,
  pending,
  ...live
}: DashboardHeaderProps) {
  const FilterIcon = filter ? FILTER_ICONS[filter.dimension] : null;

  // mobile stacks brand and actions over status and range,
  // wider screens use one row with the range centered between equal sides
  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 pt-4 pb-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4 lg:px-6 lg:pt-5 lg:pb-4">
      <div className="flex min-w-0 items-center gap-4 max-sm:contents">
        <div className="max-sm:col-start-1 max-sm:row-start-1">
          <Brand />
        </div>

        <div className="flex min-w-0 items-center gap-2 max-sm:col-start-1 max-sm:row-start-2">
          <LiveIndicator {...live} />

          {filter && FilterIcon && (
            <Button
              variant="secondary"
              size="sm"
              className="min-w-0"
              title="Clear filter"
              onClick={() => onFilter(null)}
            >
              <FilterIcon />
              <span
                className="truncate"
                data-sensitive={sensitive(filter.dimension)}
              >
                {label(filter.dimension, filter.value)}
              </span>
              {pending ? <Spinner /> : <X className="opacity-60" />}
            </Button>
          )}
        </div>
      </div>

      <ToggleGroup
        aria-label="Range"
        spacing={0}
        className="shrink-0 justify-self-center rounded-full bg-muted p-1 max-sm:col-start-2 max-sm:row-start-2"
        value={[range]}
        onValueChange={(value) => value[0] && onRange(value[0] as Range)}
      >
        {RANGE_OPTIONS.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            aria-label={option.label}
            className="h-7! min-w-0 rounded-full! px-2.5! text-xs text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm dark:aria-pressed:bg-input/40"
          >
            <span className="lg:hidden">{option.short}</span>
            <span className="hidden lg:inline">{option.label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex items-center justify-self-end gap-1 max-sm:col-start-2 max-sm:row-start-1">
        <ThemePicker />
        <SettingsSheet />
        <LogoutButton />
      </div>
    </header>
  );
}
