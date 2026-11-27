import type { SearchMode } from '../types'

const encoder = new TextEncoder()
let asciiScratch = new Uint8Array(0)

// UTF-8 encoding is a native pass, unlike a per-character scan over the source.
// A string is ASCII exactly when every character encodes to a single byte.
export function isAsciiText(text: string): boolean {
  if (asciiScratch.length < text.length) asciiScratch = new Uint8Array(text.length)
  const { read, written } = encoder.encodeInto(text, asciiScratch)
  return read === text.length && written === read
}

const UPPERCASE = /[A-Z]/u

export const FOLD_PADDING = '\u0000'

// A padded fold keeps every source code unit in place, so an index in the folded
// text still addresses the original note for highlighting.
export function foldSearchText(
  text: string,
  plain = isAsciiText(text),
  preserveLength = false
): string {
  if (plain) return UPPERCASE.test(text) ? text.toLowerCase() : text
  if (!preserveLength) return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  let result = ''
  for (const character of text) {
    const folded = character.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (folded.length === character.length) result += folded
    else if (folded.length < character.length)
      result += folded + FOLD_PADDING.repeat(character.length - folded.length)
    else result += folded.slice(0, character.length)
  }
  return result
}

export type ParsedQuery = { terms: string[]; mode?: SearchMode; folder?: string }

const MODE_PREFIXES: Record<string, SearchMode> = {
  all: 'all',
  name: 'names',
  names: 'names',
  content: 'content',
}

export function parseSearchQuery(query: string): ParsedQuery {
  const terms: string[] = []
  let mode: SearchMode | undefined
  let folder: string | undefined
  let pendingFolder = false
  let token = ''
  let quote: string | null = null
  let quotedToken = false
  const flush = () => {
    const quoted = quotedToken
    quotedToken = false
    if (!token) return
    const value = token
    token = ''
    if (pendingFolder) {
      folder = value
      pendingFolder = false
      return
    }
    if (quoted) {
      terms.push(value)
      return
    }
    const colon = value.indexOf(':')
    if (colon > 0) {
      const key = value.slice(0, colon).toLowerCase()
      const rest = value.slice(colon + 1)
      if (key === 'folder' || key === 'in') {
        if (rest) folder = rest
        else pendingFolder = true
      } else if (MODE_PREFIXES[key]) {
        mode = MODE_PREFIXES[key]
        if (rest) terms.push(rest)
      } else terms.push(value)
    } else terms.push(value)
  }
  for (let index = 0; index < query.length; index++) {
    const character = query[index]
    if (
      quote === character ||
      character === '"' ||
      (character === "'" && !quote && (!token || token.endsWith(':')))
    ) {
      if (quote === character) {
        quote = null
        flush()
      } else if (!quote) {
        flush()
        quote = character
        quotedToken = true
      } else token += character
      continue
    }
    if (!quote && isSpace(character.charCodeAt(0))) {
      flush()
      continue
    }
    token += character
  }
  flush()
  return { terms, mode, folder }
}

export function noteFolder(path: string): string {
  const end = path.lastIndexOf('/')
  return end < 0 ? '' : path.slice(0, end)
}

// Same whitespace set as String.prototype.trim.
export function isSpace(code: number): boolean {
  if (code > 32 && code < 0x7f) return false
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  )
}
