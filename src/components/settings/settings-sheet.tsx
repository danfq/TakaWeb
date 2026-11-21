import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * whether the browser runs on an apple platform, where shortcuts use cmd
 *
 * @returns {boolean} whether it is apple
 */
const isApple = (): boolean =>
  /mac|iphone|ipad|ipod/i.test(
    (navigator as Navigator & { userAgentData?: { platform: string } })
      .userAgentData?.platform ?? navigator.platform,
  );

/**
 * settings sidebar, empty for now, also opens with cmd or ctrl + comma
 */
export default function SettingsSheet() {
  const [open, setOpen] = useState(false);
  // filled in after mount, the server cannot know the platform
  const [shortcut, setShortcut] = useState<{
    label: string;
    keys: string;
  } | null>(null);

  useEffect(() => {
    setShortcut(
      isApple()
        ? { label: "⌘,", keys: "Meta+Comma" }
        : { label: "Ctrl+,", keys: "Control+Comma" },
    );

    /**
     * open on cmd + comma on apple platforms, ctrl + comma elsewhere
     *
     * @param event key press
     */
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = isApple() ? event.metaKey : event.ctrlKey;

      if (modifier && !event.altKey && !event.shiftKey && event.key === ",") {
        event.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
        }
      >
        <Settings />
      </SheetTrigger>

      <SheetContent resizable storageKey="takaweb-settings-width">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Nothing to configure yet.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
