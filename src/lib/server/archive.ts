import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { crc32, createDeflateRaw } from "node:zlib"

/**
 * a file to put in an archive
 */
export type ArchiveFile = { name: string; path: string; modified?: Date }

/**
 * largest file and archive size the classic zip format can describe
 */
const ZIP_LIMIT = 0xffffffff

/**
 * date and time in ms-dos format, as zip headers store them
 *
 * @param date date
 *
 * @returns {{ time: number; day: number }} packed time and date
 */
function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(date.getFullYear(), 1980)

  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * stream a zip archive of files, deflated, sizes written after each file so nothing is buffered
 *
 * @param files files to add
 *
 * @returns {AsyncGenerator<Buffer>} archive bytes
 */
export async function* zip(files: ArchiveFile[]): AsyncGenerator<Buffer> {
  const central: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8")
    const { time, day } = dosTime(file.modified ?? new Date())
    // sizes follow the data, names are utf-8
    const flags = 0x0008 | 0x0800

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt16LE(name.length, 26)

    yield local
    yield name

    let crc = 0
    let size = 0
    let compressed = 0

    const deflate = createDeflateRaw()
    const source = createReadStream(file.path)

    source.on("data", (chunk) => {
      const bytes = chunk as Buffer
      crc = crc32(bytes, crc)
      size += bytes.length
    })
    source.on("error", (error) => deflate.destroy(error))
    source.pipe(deflate)

    for await (const chunk of deflate) {
      compressed += (chunk as Buffer).length
      yield chunk as Buffer
    }

    if (size > ZIP_LIMIT || compressed > ZIP_LIMIT)
      throw new Error(`${file.name} is too large for a zip archive`)

    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50, 0)
    descriptor.writeUInt32LE(crc, 4)
    descriptor.writeUInt32LE(compressed, 8)
    descriptor.writeUInt32LE(size, 12)

    yield descriptor

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    // made on unix, so the permissions below apply
    entry.writeUInt16LE((3 << 8) | 20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(flags, 8)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt16LE(time, 12)
    entry.writeUInt16LE(day, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(compressed, 20)
    entry.writeUInt32LE(size, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    entry.writeUInt32LE(offset, 42)

    central.push(entry, name)
    offset += local.length + name.length + compressed + descriptor.length

    if (offset > ZIP_LIMIT) throw new Error("The archive is too large for the zip format")
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  yield directory
  yield end
}

/**
 * write a value into a tar header field
 *
 * @param header header block
 * @param value text
 * @param offset field offset
 * @param length field length
 */
function field(header: Buffer, value: string, offset: number, length: number) {
  header.write(value.slice(0, length), offset, length, "utf8")
}

/**
 * an octal number field, zero padded and null terminated
 *
 * @param value number
 * @param length field length
 *
 * @returns {string} field text
 */
const octal = (value: number, length: number): string => `${value.toString(8).padStart(length - 1, "0")}\0`

/**
 * stream an uncompressed ustar archive of files, pipe it through gzip for a .tar.gz
 *
 * @param files files to add
 *
 * @returns {AsyncGenerator<Buffer>} archive bytes
 */
export async function* tar(files: ArchiveFile[]): AsyncGenerator<Buffer> {
  for (const file of files) {
    const { size, mtime } = await stat(file.path)
    const header = Buffer.alloc(512)

    if (Buffer.byteLength(file.name) > 100) throw new Error(`${file.name} is too long for a tar header`)

    field(header, file.name, 0, 100)
    field(header, octal(0o644, 8), 100, 8)
    field(header, octal(0, 8), 108, 8)
    field(header, octal(0, 8), 116, 8)
    field(header, octal(size, 12), 124, 12)
    field(header, octal(Math.floor((file.modified ?? mtime).getTime() / 1000), 12), 136, 12)
    // the checksum counts its own field as spaces
    field(header, "        ", 148, 8)
    field(header, "0", 156, 1)
    field(header, "ustar\0", 257, 6)
    field(header, "00", 263, 2)

    let sum = 0
    for (const byte of header) sum += byte
    field(header, `${sum.toString(8).padStart(6, "0")}\0 `, 148, 8)

    yield header

    for await (const chunk of createReadStream(file.path)) yield chunk as Buffer

    // data is padded to whole blocks
    const padding = (512 - (size % 512)) % 512
    if (padding) yield Buffer.alloc(padding)
  }

  // two empty blocks end the archive
  yield Buffer.alloc(1024)
}
