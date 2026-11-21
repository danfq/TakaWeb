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
 * settings sidebar, empty for now
 */
export default function SettingsSheet() {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            title="Settings"
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
