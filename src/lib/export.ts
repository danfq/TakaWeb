/**
 * ways to download a backup
 * json carries the data alone, archives add a copy of the database for restoring
 */
export const EXPORT_FORMATS = [
  { value: "json", label: "JSON", title: "Your data as one JSON file", type: "application/json" },
  { value: "zip", label: "ZIP", title: "Your data and a database copy, as a ZIP archive", type: "application/zip" },
  {
    value: "tar.gz",
    label: "TAR.GZ",
    title: "Your data and a database copy, as a gzipped tarball",
    type: "application/gzip",
  },
] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]["value"]

/**
 * check a value is a known export format
 *
 * @param value raw value
 *
 * @returns {boolean} whether it is a format
 */
export const isExportFormat = (value: unknown): value is ExportFormat =>
  EXPORT_FORMATS.some((format) => format.value === value)

/**
 * version of the export layout, bumped whenever it changes shape
 */
export const EXPORT_VERSION = 1
