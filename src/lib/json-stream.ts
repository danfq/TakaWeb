/**
 * where a value sits in a document, keys and array indexes from the root
 */
export type JsonPath = readonly (string | number)[]

export type JsonKind = "object" | "array" | "string" | "number" | "literal"

/**
 * what to do with a value as it starts
 * capture parses it whole, descend walks into it, skip passes over it
 */
export type Visit = "capture" | "descend" | "skip"

type Frame = {
  kind: "object" | "array"
  // key or index of the child being read
  key: string | number
  // object: 0 key or end, 1 colon, 2 value, 3 comma or end
  // array: 0 value or end, 1 comma or end
  state: number
}

const enum Char {
  Quote = 34,
  Backslash = 92,
  Comma = 44,
  Colon = 58,
  OpenBrace = 123,
  CloseBrace = 125,
  OpenBracket = 91,
  CloseBracket = 93,
  Space = 32,
  Tab = 9,
  Newline = 10,
  Return = 13,
}

/**
 * whether a char code is json whitespace
 *
 * @param code char code
 *
 * @returns {boolean} whitespace
 */
const isSpace = (code: number): boolean =>
  code === Char.Space || code === Char.Newline || code === Char.Return || code === Char.Tab

/**
 * whether a char code ends a number or literal
 *
 * @param code char code
 *
 * @returns {boolean} delimiter
 */
const isDelimiter = (code: number): boolean =>
  isSpace(code) || code === Char.Comma || code === Char.CloseBrace || code === Char.CloseBracket

/**
 * reads a json document in chunks and parses only the values asked for
 * a file far larger than memory allows can be read as long as each captured value is small
 */
export class JsonScanner {
  private readonly stack: Frame[] = []
  private done = false

  // string state, shared by keys, skipped and captured strings
  private inString = false
  private escaped = false
  private key: string[] | null = null
  private keyStart = 0

  // a number or literal outside a capture
  private primitive = false

  // a value being captured or skipped, it ends once the stack drops back to depth
  private mode: "capture" | "skip" | null = null
  private depth = 0
  private nested = 0
  private buffer: string[] = []
  private start = 0
  private path: JsonPath = []
  private scalar = false

  /**
   * @param visit decides what happens to each value as it starts
   * @param emit receives every captured value
   */
  constructor(
    private readonly visit: (path: JsonPath, kind: JsonKind) => Visit,
    private readonly emit: (path: JsonPath, value: unknown) => void
  ) {}

  /**
   * path of the value about to start
   *
   * @returns {JsonPath} path
   */
  private currentPath(): JsonPath {
    return this.stack.map((frame) => frame.key)
  }

  /**
   * fail on input that is not json
   *
   * @param reason what was wrong
   *
   * @returns {never} never
   */
  private fail(reason: string): never {
    throw new SyntaxError(`Invalid JSON: ${reason}`)
  }

  /**
   * a value starts, decide whether to capture, skip or walk into it
   *
   * @param kind value kind
   * @param index where the value starts in the chunk
   *
   * @returns {boolean} whether the value is now captured or skipped
   */
  private begin(kind: JsonKind, index: number): boolean {
    if (this.done) this.fail("more than one value")

    const parent = this.stack.at(-1)

    if (parent) {
      if (parent.kind === "object" && parent.state !== 2) this.fail("expected a key")
      if (parent.kind === "array" && parent.state !== 0) this.fail("expected a comma")
    }

    const path = this.currentPath()
    const action = this.visit(path, kind)

    if (action === "descend") return false

    this.mode = action
    this.depth = this.stack.length
    this.nested = 0
    this.buffer = []
    this.start = index
    this.path = path
    this.scalar = kind !== "object" && kind !== "array"

    return true
  }

  /**
   * a value ended, move its parent on
   */
  private settle() {
    const parent = this.stack.at(-1)

    if (!parent) {
      this.done = true
      return
    }

    parent.state = parent.kind === "object" ? 3 : 1
  }

  /**
   * a captured or skipped value ended at an index
   *
   * @param chunk current chunk
   * @param end index just past the value
   */
  private finish(chunk: string, end: number) {
    if (this.mode === "capture") {
      this.buffer.push(chunk.slice(this.start, end))

      let value: unknown

      try {
        value = JSON.parse(this.buffer.join(""))
      } catch {
        this.fail(`malformed value at ${this.path.join(".") || "root"}`)
      }

      this.emit(this.path, value)
    }

    this.mode = null
    this.buffer = []
    this.settle()
  }

  /**
   * read the next chunk of the document
   *
   * @param chunk text
   */
  write(chunk: string) {
    let index = 0
    this.start = 0
    this.keyStart = 0

    while (index < chunk.length) {
      const code = chunk.charCodeAt(index)

      // inside a captured or skipped value only strings and nesting matter
      if (this.mode) {
        if (this.inString) {
          if (this.escaped) this.escaped = false
          else if (code === Char.Backslash) this.escaped = true
          else if (code === Char.Quote) {
            this.inString = false
            if (this.scalar && this.nested === 0) {
              this.finish(chunk, index + 1)
            }
          }
        } else if (this.scalar) {
          // a number or literal, ends right before a delimiter
          if (isDelimiter(code)) {
            this.finish(chunk, index)
            continue
          }
        } else if (code === Char.Quote) {
          this.inString = true
        } else if (code === Char.OpenBrace || code === Char.OpenBracket) {
          this.nested++
        } else if (code === Char.CloseBrace || code === Char.CloseBracket) {
          if (--this.nested === 0) this.finish(chunk, index + 1)
        }

        index++
        continue
      }

      // a key being read
      if (this.key) {
        if (this.escaped) this.escaped = false
        else if (code === Char.Backslash) this.escaped = true
        else if (code === Char.Quote) {
          this.key.push(chunk.slice(this.keyStart, index))

          const frame = this.stack.at(-1)!
          frame.key = JSON.parse(`"${this.key.join("")}"`) as string
          frame.state = 1
          this.key = null
        }

        index++
        continue
      }

      // a number or literal nobody captures
      if (this.primitive) {
        if (!isDelimiter(code)) {
          index++
          continue
        }

        this.primitive = false
        this.settle()
      }

      if (isSpace(code)) {
        index++
        continue
      }

      const frame = this.stack.at(-1)

      switch (code) {
        case Char.OpenBrace:
        case Char.OpenBracket: {
          const kind = code === Char.OpenBrace ? "object" : "array"

          if (this.begin(kind, index)) {
            this.nested = 1
          } else {
            this.stack.push({ kind, key: kind === "array" ? 0 : "", state: 0 })
          }

          break
        }

        case Char.CloseBrace:
        case Char.CloseBracket: {
          const kind = code === Char.CloseBrace ? "object" : "array"

          if (!frame || frame.kind !== kind) this.fail(`unexpected ${String.fromCharCode(code)}`)

          // an empty container, or one after its last value
          const empty = frame.state === 0
          const ended = kind === "object" ? frame.state === 3 : frame.state === 1
          if (!empty && !ended) this.fail(`unexpected ${String.fromCharCode(code)}`)

          this.stack.pop()
          this.settle()
          break
        }

        case Char.Quote: {
          if (frame?.kind === "object" && frame.state === 0) {
            this.key = []
            this.keyStart = index + 1
          } else if (this.begin("string", index)) {
            this.inString = true
          } else {
            // a string nobody captures, skipped the same way
            this.mode = "skip"
            this.depth = this.stack.length
            this.nested = 0
            this.scalar = true
            this.inString = true
          }

          break
        }

        case Char.Colon: {
          if (frame?.kind !== "object" || frame.state !== 1) this.fail("unexpected :")
          frame.state = 2
          break
        }

        case Char.Comma: {
          if (frame?.kind === "object" && frame.state === 3) frame.state = 0
          else if (frame?.kind === "array" && frame.state === 1) {
            frame.state = 0
            frame.key = (frame.key as number) + 1
          } else this.fail("unexpected ,")

          break
        }

        default: {
          const kind = (code >= 48 && code <= 57) || code === 45 ? "number" : "literal"

          if (!this.begin(kind, index)) {
            this.primitive = true
          }
        }
      }

      index++
    }

    // carry an unfinished capture, key or primitive into the next chunk
    if (this.mode === "capture") this.buffer.push(chunk.slice(this.start))
    if (this.key) this.key.push(chunk.slice(this.keyStart))
  }

  /**
   * the document ended, fail when it was cut short
   */
  end() {
    // a number or literal running to the very end
    if (this.mode && this.scalar && !this.inString) this.finish("", 0)
    if (this.primitive) {
      this.primitive = false
      this.settle()
    }

    if (this.mode || this.key || this.inString || this.stack.length || !this.done) {
      this.fail("the file ends early")
    }
  }
}
