import { ChevronDown, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { EXPORT_FORMATS } from "@/lib/export"

/**
 * download a backup of everything takaweb holds, the browser handles the download
 */
export default function DataExport() {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>Export</FieldTitle>
        <FieldDescription>A backup of all your data.</FieldDescription>
      </FieldContent>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="secondary" size="sm" />}>
          <Download />
          Export
          <ChevronDown className="opacity-60" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-80">
          {EXPORT_FORMATS.map((format) => (
            <DropdownMenuItem
              key={format.value}
              render={<a href={`/api/export?format=${format.value}`} download />}
              className="flex-col items-start gap-0.5">
              {format.label}
              <span className="text-muted-foreground text-xs font-normal">{format.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  )
}
