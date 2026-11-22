import { Download } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { FieldContent, FieldDescription, FieldTitle, Field } from "@/components/ui/field"
import { EXPORT_FORMATS } from "@/lib/export"

/**
 * download a backup of everything takaweb holds, the browser handles the download
 */
export default function DataExport() {
  return (
    <Field orientation="horizontal" className="flex-wrap gap-y-3">
      <FieldContent className="min-w-48">
        <FieldTitle>Export</FieldTitle>
        <FieldDescription>
          TakaTime logs, imported heartbeats and settings. Archives also hold a copy of the database.
        </FieldDescription>
      </FieldContent>

      <div className="flex shrink-0 items-center gap-1.5">
        {EXPORT_FORMATS.map((format) => (
          <a
            key={format.value}
            href={`/api/export?format=${format.value}`}
            download
            title={format.title}
            className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Download />
            {format.label}
          </a>
        ))}
      </div>
    </Field>
  )
}
