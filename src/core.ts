import { Fzf } from 'fzf'
import type { Note, SearchMode, SearchResult } from './types'

export const DEFAULT_TEMPLATE = `#set page(margin: 2.5cm)
#set text(font: "Libertinus Serif")

#let title(body) = align(center,
    text(size: 22pt, weight: "bold", body))
#title[{{title}}]

{{body}}
`

const PLACEHOLDER = /\{\{([^{}]*)\}\}/gu

export function isRootTemplate(path: string): boolean {
  return path.toLowerCase() === 'template.typ'
}

export function noteFilename(title: string): string {
  const value = title.normalize('NFC').trim()
  if (!value) throw new Error('Give your note a title.')
  if (/[/\\:*?"<>|\p{Cc}]/u.test(value) || value.startsWith('.')) {
    throw new Error('Use a title without slashes, control characters, or filename punctuation.')
  }
  const stem = value
    .toLowerCase()
    .replace(/\s+/gu, '_')
    .replace(/\.typ$/u, '')
  if (
    !stem ||
    stem.endsWith('.') ||
    encodeURIComponent(stem).replace(/%[A-F\d]{2}/gu, '_').length > 180
  ) {
    throw new Error('Use a shorter title without a trailing period.')
  }
  return `${stem}.typ`
}

export function buildNoteSource(title: string, body: string, template = DEFAULT_TEMPLATE): string {
  noteFilename(title)
  const escaped = title.trim().replace(/[\\#[\]*_$@<>`~]/gu, '\\$&')
  return fillTemplate(template, escaped, body.trimEnd())
}

export function validateNoteTemplate(template: string): void {
  fillTemplate(template, '', '')
}

function fillTemplate(template: string, escapedTitle: string, body: string): string {
  let foundTitle = false
  const result = template.replace(PLACEHOLDER, (placeholder, field: string) => {
    if (field === 'title') {
      foundTitle = true
      return escapedTitle
    }
    if (field === 'body') return body
    throw new Error(
      `The note template uses an unknown placeholder ${placeholder}. Use only {{title}} and {{body}}.`
    )
  })
  if (!foundTitle) throw new Error('The note template must include {{title}}.')
  return result
}

export function foldersFromNotes(notes: readonly Note[]): string[] {
  const folders = new Set<string>([''])
  for (const note of notes) {
    const segments = note.path.split('/')
    segments.pop()
    let path = ''
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment
      folders.add(path)
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b))
}

// Card previews keep the note's prose and drop the Typst scaffolding: the
// title call, set/show/import rules, comments, and markup punctuation.
const DIRECTIVE = /^\s*#(?:set|show|import|include|let|title)\b/u
const COMMENT = /^\s*\/\//u
const HEADING = /^\s*=+\s*/u
const BULLET = /^\s*[-+]\s+/u
const PREVIEW_MARKUP = /#[A-Za-z][\w-]*(?:\([^)]*\))?\[|\\|[*_`#$[\]]/gu
const PLAIN_PREVIEW = /^[A-Za-z0-9]+(?: [A-Za-z0-9.,:;!?()'/-]+)*$/u
const previews = new WeakMap<Note, { source: string; limit: number; text: string }>()

export function notePreview(note: Note, limit = 220): string {
  const cached = previews.get(note)
  if (cached?.source === note.source && cached.limit === limit) return cached.text
  let preview = ''
  let directiveDepth = 0
  let fenced = false
  let blockComment = false
  let lineStart = 0
  let lineEnd = note.source.indexOf('\n')
  while (lineStart <= note.source.length) {
    const raw = note.source.slice(lineStart, lineEnd < 0 ? note.source.length : lineEnd)
    lineStart = lineEnd < 0 ? note.source.length + 1 : lineEnd + 1
    lineEnd = note.source.indexOf('\n', lineStart)
    if (directiveDepth > 0) {
      directiveDepth += (raw.match(/[[{(]/gu)?.length ?? 0) - (raw.match(/[\])}]/gu)?.length ?? 0)
      continue
    }
    if (!fenced && !blockComment && DIRECTIVE.test(raw)) {
      directiveDepth = Math.max(
        0,
        (raw.match(/[[{(]/gu)?.length ?? 0) - (raw.match(/[\])}]/gu)?.length ?? 0)
      )
      continue
    }
    if (!fenced && !blockComment && PLAIN_PREVIEW.test(raw)) {
      preview += `${preview ? ' ' : ''}${raw}`
      if (preview.length > limit) break
      continue
    }
    const trimmed = raw.trim()
    if (fenced) {
      if (trimmed.startsWith('```')) fenced = false
      continue
    }
    if (blockComment) {
      if (trimmed.includes('*/')) blockComment = false
      continue
    }
    if (trimmed.startsWith('```')) {
      fenced = true
      continue
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) blockComment = true
      continue
    }
    if (!trimmed || COMMENT.test(trimmed)) continue
    const text = trimmed
      .replace(HEADING, '')
      .replace(BULLET, '')
      .replace(PREVIEW_MARKUP, '')
      .replace(/\s+/gu, ' ')
      .trim()
    if (text) {
      preview += `${preview ? ' ' : ''}${text}`
      if (preview.length > limit) break
    }
  }
  const joined = preview
  const cut = joined.lastIndexOf(' ', limit)
  const text =
    joined.length > limit ? `${joined.slice(0, cut > 0 ? cut : limit).trimEnd()}…` : joined
  previews.set(note, { source: note.source, limit, text })
  return text
}

const WEEKDAY = { weekday: 'short' } as const
const MONTH_DAY = { month: 'short', day: 'numeric' } as const
const MONTH_DAY_YEAR = { month: 'short', day: 'numeric', year: 'numeric' } as const

function startOfDay(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

// Calendar days, not milliseconds: a DST change makes yesterday 23 or 25
// hours long.
function dayDistance(from: number, to: number): number {
  return Math.round((startOfDay(from) - startOfDay(to)) / 86_400_000)
}

// Library cards answer "when did I last touch this" at a glance instead of
// spelling out a timestamp.
export function noteTime(modifiedAt: number | null, now = Date.now()): string {
  if (modifiedAt === null) return ''
  const elapsed = now - modifiedAt
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`
  const days = dayDistance(now, modifiedAt)
  const date = new Date(modifiedAt)
  if (days === 1) return 'Yesterday'
  if (days < 6) return date.toLocaleDateString(undefined, WEEKDAY)
  if (date.getFullYear() === new Date(now).getFullYear())
    return date.toLocaleDateString(undefined, MONTH_DAY)
  return date.toLocaleDateString(undefined, MONTH_DAY_YEAR)
}

export function extractTitle(source: string, fallback: string): string {
  if (fallback.toLowerCase() === 'template.typ') return 'Template'
  const start = /#title\s*\[/u.exec(source)
  if (!start) return fallback.replace(/\.typ$/iu, '').replace(/_/gu, ' ')
  let depth = 1
  let title = ''
  for (let i = start.index + start[0].length; i < source.length; i++) {
    const character = source[i]
    if (character === '\\' && i + 1 < source.length) {
      title += source[++i]
      continue
    }
    if (character === '[') depth++
    if (character === ']') depth--
    if (depth === 0) return title.replace(/\s+/gu, ' ').trim() || fallback
    title += character
  }
  return fallback.replace(/\.typ$/iu, '').replace(/_/gu, ' ')
}

type NameEntry = {
  note: Note
  text: string
  folded: string
  // Lowercasing is folding for ASCII, so a plain entry can only match a query
  // whose characters appear in it in order.
  plain: boolean
  letters?: number
  digits?: number
}
type NameMatch = { item: NameEntry; score: number }

type ContentEntry = {
  note: Note
  text: string
  // Folding is cleared by an edit and paid for by the next query, so a burst of
  // keystrokes on one note folds it once instead of once per keystroke.
  folded: string | undefined
  // Line starts of the folded text, indexed once and dropped with the fold.
  starts: Int32Array | undefined
}

export type NoteSort = 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc'
export const noteSortValues: readonly NoteSort[] = [
  'name-asc',
  'name-desc',
  'modified-desc',
  'modified-asc',
]

type SortEntry = {
  title: string
  path: string
  modifiedAt: number | null
  pathKey?: string
  nameKey?: string
  modifiedAscDate?: string
  modifiedDescDate?: string
  // The sort key with the note's position appended, for the mode and position it
  // was built for.
  tagged: string
  taggedFor: number
}

const sortEntries = new WeakMap<Note, SortEntry>()
const DIGIT_RUN = /[0-9]+/gu
const MAX_MODIFIED = 99999999999999

// Every locale-aware compare is a native call on Hermes, so a few thousand notes
// block the UI for over a hundred milliseconds. Fold the text and encode number
// runs instead, letting a plain string sort order notes naturally.
function sortText(text: string): string {
  return foldSearchText(text).replace(DIGIT_RUN, (run) => {
    let start = 0
    while (start < run.length && run.charCodeAt(start) === 0x30) start++
    const digits = start === run.length ? '' : run.slice(start)
    // The length prefix puts "2" before "10"; long runs keep their digits after it.
    const length = Math.min(digits.length, 99)
    return String.fromCharCode(0x30 + Math.floor(length / 10), 0x30 + (length % 10)) + digits
  })
}

function sortEntry(note: Note): SortEntry {
  const entry: SortEntry = {
    title: note.title,
    path: note.path,
    modifiedAt: note.modifiedAt,
    tagged: '',
    taggedFor: -1,
  }
  sortEntries.set(note, entry)
  return entry
}

function pathKey(entry: SortEntry): string {
  entry.pathKey ??= sortText(entry.path)
  return entry.pathKey
}

function nameKey(entry: SortEntry): string {
  entry.nameKey ??= `${sortText(entry.title)}\u0000${pathKey(entry)}`
  return entry.nameKey
}

// Unknown dates stay last in both directions.
function modifiedDate(entry: SortEntry, desc: boolean): string {
  if (desc) {
    entry.modifiedDescDate ??=
      entry.modifiedAt === null
        ? String(MAX_MODIFIED)
        : String(MAX_MODIFIED - entry.modifiedAt).padStart(14, '0')
    return entry.modifiedDescDate
  }
  entry.modifiedAscDate ??=
    entry.modifiedAt === null ? String(MAX_MODIFIED) : String(entry.modifiedAt).padStart(14, '0')
  return entry.modifiedAscDate
}

// Keys are built for the requested sort only, so an import that never shows
// modification order does not pay for it. Each key carries the note's position as
// a trailing tag, which lets the native sort carry it through and removes the
// key to note map from every call.
//
// Sorting keys in a native string sort avoids a JavaScript comparator, which
// Hermes calls once per comparison.
export function sortNotes(notes: Note[], sort: NoteSort): Note[] {
  const name = sort.startsWith('name')
  const desc = sort.endsWith('-desc')
  const count = notes.length
  // Notes touched on the same days share most of their date key, and comparing
  // characters every key shares is what makes date sorts slow. Drop them.
  let shared = 0
  if (!name && count > 0) {
    let low = Infinity
    let high = -Infinity
    for (let index = 0; index < count; index++) {
      const at = notes[index].modifiedAt
      const value = at === null ? MAX_MODIFIED : desc ? MAX_MODIFIED - at : at
      if (value < low) low = value
      if (value > high) high = value
    }
    const from = String(low).padStart(14, '0')
    const to = String(high).padStart(14, '0')
    while (shared < 14 && from[shared] === to[shared]) shared++
  }
  const base = ((name ? 0 : desc ? 2 : 1) * 16 + (name ? 0 : shared)) * 0x1000000
  const keys = new Array<string>(count)
  for (let index = 0; index < count; index++) {
    const note = notes[index]
    const cached = sortEntries.get(note)
    const entry =
      cached &&
      cached.title === note.title &&
      cached.path === note.path &&
      cached.modifiedAt === note.modifiedAt
        ? cached
        : sortEntry(note)
    const state = base + index
    let key = entry.tagged
    if (entry.taggedFor !== state) {
      const body = name
        ? nameKey(entry)
        : `${modifiedDate(entry, desc).slice(shared)}\u0000${pathKey(entry)}`
      // Three single byte characters, so the key stays a one byte string: a wider
      // tag turns every comparison into a two byte one.
      key = `${body}\u0000${String.fromCharCode(
        index & 0xff,
        (index >>> 8) & 0xff,
        (index >>> 16) & 0xff
      )}`
      entry.tagged = key
      entry.taggedFor = state
    }
    keys[index] = key
  }
  keys.sort()
  if (name && desc) keys.reverse()
  const sorted = new Array<Note>(count)
  for (let index = 0; index < count; index++) {
    const key = keys[index]
    const at = key.length - 3
    sorted[index] =
      notes[key.charCodeAt(at) | (key.charCodeAt(at + 1) << 8) | (key.charCodeAt(at + 2) << 16)]
  }
  return sorted
}

export function reconcileNotes(previous: Note[], next: Note[]): Note[] {
  const byUri = new Map(previous.map((note) => [note.uri, note]))
  const result = next.map((note) => {
    const old = byUri.get(note.uri)
    return old &&
      old.path === note.path &&
      old.source === note.source &&
      old.title === note.title &&
      old.pdfUri === note.pdfUri &&
      old.pdfHash === note.pdfHash &&
      old.sharedHash === note.sharedHash &&
      old.modifiedAt === note.modifiedAt
      ? old
      : note
  })
  return result.length === previous.length && result.every((note, i) => note === previous[i])
    ? previous
    : result
}

type RankedResult = {
  result: SearchResult
  rank: number
  score: number
  length: number
}

const encoder = new TextEncoder()
let asciiScratch = new Uint8Array(0)

// UTF-8 encoding is a native pass, unlike a per-character scan over the source.
// A string is ASCII exactly when every character encodes to a single byte.
function isAsciiText(text: string): boolean {
  if (asciiScratch.length < text.length) asciiScratch = new Uint8Array(text.length)
  const { read, written } = encoder.encodeInto(text, asciiScratch)
  return read === text.length && written === read
}

const UPPERCASE = /[A-Z]/u

function foldSearchText(text: string, plain = isAsciiText(text)): string {
  if (plain) return UPPERCASE.test(text) ? text.toLowerCase() : text
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function nameEntry(note: Note, text: string): NameEntry {
  const plain = isAsciiText(text)
  return { note, text, folded: foldSearchText(text, plain), plain }
}

// Cooperative yielding: hand the frame back once a slide has run for 6ms.
function uiBudget() {
  let started = performance.now()
  return {
    over: () => performance.now() - started >= 6,
    yieldFrame: () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          // Reset once the timer has fired, so its delay is not counted against
          // the next slice and every entry after it yields again.
          started = performance.now()
          resolve()
        }, 0)
      ),
  }
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true
  const code = text.charCodeAt(index - 1)
  return !((code >= 48 && code <= 57) || (code >= 97 && code <= 122))
}

function literalScore(length: number, exact: boolean, at: number, boundary: boolean): number {
  return 10000 - length + (exact ? 5000 : 0) + (boundary ? 100 : 0) - Math.min(at, 100)
}

// A line can only match when every query character occurs somewhere in the note.
// This is one native scan per character instead of walking every line.
function containsAll(text: string, pattern: string): boolean {
  for (let index = 0; index < pattern.length; index++)
    if (text.indexOf(pattern[index]) < 0) return false
  return true
}

// The fuzzy score of `pattern` inside [start, end), or NaN when the pattern is
// not a subsequence of that range. Scoring against the source keeps long notes
// allocation free: only the winning line is ever sliced.
function fuzzyScoreInRange(text: string, pattern: string, start: number, end: number): number {
  let position = start - 1
  let first = 0
  let score = 0
  let run = 0
  for (let index = 0; index < pattern.length; index++) {
    const at = text.indexOf(pattern[index], position + 1)
    if (at < 0 || at >= end) return Number.NaN
    if (index === 0) first = at - start
    const gap = at - position - 1
    if (gap === 0) run++
    else {
      run = 0
      score -= Math.min(gap, 8)
    }
    score += 2 + Math.min(run, 3)
    position = at
  }
  score -= (end - start) * 0.02 + Math.min(first, 40) * 0.1
  return score
}

// Same whitespace set as String.prototype.trim.
function isSpace(code: number): boolean {
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

type LineInfo = { line: number; left: number; right: number }

let offsetScratch = new Int32Array(256)

function lineStarts(text: string): Int32Array {
  offsetScratch[0] = 0
  let count = 1
  let index = text.indexOf('\n')
  while (index !== -1) {
    if (count === offsetScratch.length) {
      const grown = new Int32Array(offsetScratch.length * 2)
      grown.set(offsetScratch)
      offsetScratch = grown
    }
    offsetScratch[count++] = index + 1
    index = text.indexOf('\n', index + 1)
  }
  return offsetScratch.slice(0, count)
}

// A note's line starts are indexed once and kept, so a query reads a line's
// bounds instead of scanning for them on every hit.
function lineOffsets(entry: ContentEntry, text: string): Int32Array {
  entry.starts ??= lineStarts(text)
  return entry.starts
}

// The line holding `at`, walked forward from `line` because occurrences arrive
// in order.
function lineOf(starts: Int32Array, at: number, line: number): number {
  while (line + 1 < starts.length && starts[line + 1] <= at) line++
  return line
}

function lineAt(text: string, starts: Int32Array, line: number): LineInfo {
  const start = starts[line]
  const end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length
  let left = start
  while (left < end && isSpace(text.charCodeAt(left))) left++
  let right = end
  while (right > left && isSpace(text.charCodeAt(right - 1))) right--
  return { line, left, right }
}

function trimmedLine(text: string, line: number): string {
  let start = 0
  for (let index = 0; index < line; index++) {
    const newline = text.indexOf('\n', start)
    if (newline < 0) return ''
    start = newline + 1
  }
  const newline = text.indexOf('\n', start)
  return text.slice(start, newline < 0 ? text.length : newline).trim()
}

function lineText(
  entry: ContentEntry,
  folded: string,
  line: number,
  left: number,
  right: number
): string {
  return folded.length === entry.text.length
    ? entry.text.slice(left, right)
    : trimmedLine(entry.text, line)
}

type ContentHit = { text: string; line: number; offset: number; score: number }

function contentHit(
  entry: ContentEntry,
  folded: string,
  lower: string,
  info: LineInfo,
  offset: number,
  score: number
): ContentHit {
  const text = lineText(entry, folded, info.line, info.left, info.right)
  // Folded offsets only address the source when folding kept every length.
  const at =
    folded.length === entry.text.length ? offset : Math.max(0, text.toLowerCase().indexOf(lower))
  return { text, line: info.line + 1, offset: at, score }
}

function snippetText(text: string, offset: number): string {
  const from = Math.max(0, offset - 50)
  return `${from ? '…' : ''}${text.slice(from, from + 180)}${text.length > from + 180 ? '…' : ''}`
}

// The best line containing `term`: short lines and matches at a word start rank
// first. Every matching line is scored, so the reported line and the score that
// orders results do not depend on how many times the term occurs. Bounds are
// kept in locals because this loop runs once per occurrence in the vault.
function literalHit(
  entry: ContentEntry,
  text: string,
  term: string,
  lower: string
): ContentHit | null {
  const length = term.length
  let at = text.indexOf(term)
  if (at < 0) return null
  const starts = lineOffsets(entry, text)
  let line = 0
  let best = -Infinity
  let bestAt = 0
  let bestLine = 0
  let bestLeft = 0
  let bestRight = 0
  while (at >= 0) {
    while (line + 1 < starts.length && starts[line + 1] <= at) line++
    const end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length
    let left = starts[line]
    while (left < end && isSpace(text.charCodeAt(left))) left++
    let right = end
    while (right > left && isSpace(text.charCodeAt(right - 1))) right--
    if (at >= left && at + length <= right) {
      const score = literalScore(
        right - left,
        right - left === length,
        at - left,
        at === left || isBoundary(text, at)
      )
      if (score > best) {
        best = score
        bestAt = at - left
        bestLine = line
        bestLeft = left
        bestRight = right
      }
    }
    at = text.indexOf(term, end + 1)
  }
  if (best === -Infinity) return null
  return contentHit(
    entry,
    text,
    lower,
    { line: bestLine, left: bestLeft, right: bestRight },
    bestAt,
    best
  )
}

// The best line whose characters hold `pattern` in order. Every line is scored,
// so the result does not depend on where in the note the best line sits.
function fuzzyHit(
  entry: ContentEntry,
  text: string,
  pattern: string,
  lower: string
): ContentHit | null {
  const starts = lineOffsets(entry, text)
  let best = -Infinity
  let bestLength = 0
  let bestLine = 0
  let bestLeft = 0
  let bestRight = 0
  for (let line = 0; line < starts.length; line++) {
    const end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length
    let left = starts[line]
    while (left < end && isSpace(text.charCodeAt(left))) left++
    let right = end
    while (right > left && isSpace(text.charCodeAt(right - 1))) right--
    if (right > left) {
      const score = fuzzyScoreInRange(text, pattern, left, right)
      const length = right - left
      if (score > best || (score === best && length < bestLength)) {
        best = score
        bestLength = length
        bestLine = line
        bestLeft = left
        bestRight = right
      }
    }
  }
  if (best === -Infinity) return null
  return contentHit(
    entry,
    text,
    lower,
    { line: bestLine, left: bestLeft, right: bestRight },
    text.indexOf(pattern[0], bestLeft) - bestLeft,
    best
  )
}

function lineHit(entry: ContentEntry, folded: string, term: string): ContentHit | null {
  const at = folded.indexOf(term)
  if (at < 0) return null
  const starts = lineOffsets(entry, folded)
  const info = lineAt(folded, starts, lineOf(starts, at, 0))
  return contentHit(entry, folded, term, info, at - info.left, 0)
}

const HIT_CACHE_LIMIT = 8

function dropOldest<K, V>(map: Map<K, V>): void {
  const oldest = map.keys().next()
  if (!oldest.done) map.delete(oldest.value)
}

export type NoteSearch = ((
  query: string,
  mode: SearchMode,
  cancelled?: () => boolean
) => Promise<SearchResult[]>) & {
  update(notes: readonly Note[]): void
  warm(): Promise<void>
}

export function createNoteSearch(initial: readonly Note[]): NoteSearch {
  let notes = initial
  let names = nameIndex(notes)
  let all: { note: Note }[] | null = null
  let entries: ContentEntry[] | null = null
  let content: Promise<ContentEntry[]> | undefined
  let version = 0
  let request = 0
  // Search-as-you-type repeats the same query across keystrokes. One map per
  // query keeps reuse cheap without allocating state for every note on the first
  // search after launch.
  const hitCache = new Map<string, Map<string, { text: string; hit: ContentHit | null }>>()
  const cachedHit = (
    key: string,
    entry: ContentEntry,
    text: string,
    term: string,
    lower: string,
    kind: 'literal' | 'fuzzy'
  ): ContentHit | null => {
    let byNote = hitCache.get(key)
    if (!byNote) {
      if (hitCache.size === HIT_CACHE_LIMIT) dropOldest(hitCache)
      byNote = new Map()
      hitCache.set(key, byNote)
    }
    const path = entry.note.path
    const cached = byNote.get(path)
    if (cached?.text === text) return cached.hit
    const hit =
      kind === 'literal' ? literalHit(entry, text, term, lower) : fuzzyHit(entry, text, term, lower)
    byNote.set(path, { text, hit })
    return hit
  }

  const entryFor = (note: Note): ContentEntry => ({
    note,
    text: note.source,
    folded: foldSearchText(note.source),
    starts: undefined,
  })

  const foldedOf = (entry: ContentEntry): string => (entry.folded ??= foldSearchText(entry.text))

  // Notes keep their object identity across scans, so an edit updates the entry in
  // place instead of copying the whole index.
  const refresh = (entry: ContentEntry, note: Note): ContentEntry => {
    if (entry.text !== note.source) {
      entry.text = note.source
      entry.folded = undefined
      entry.starts = undefined
    }
    entry.note = note
    return entry
  }

  const patch = (current: ContentEntry[], next: readonly Note[]): ContentEntry[] => {
    let sameOrder = next.length === current.length
    if (sameOrder) {
      for (let index = 0; index < next.length; index++) {
        const note = next[index]
        if (note !== current[index].note && note.path !== current[index].note.path) {
          sameOrder = false
          break
        }
      }
    }
    if (sameOrder) {
      for (let index = 0; index < next.length; index++) refresh(current[index], next[index])
      return current
    }
    const byPath = new Map(current.map((entry) => [entry.note.path, entry]))
    return next.map((note) => {
      const existing = byPath.get(note.path)
      return existing ? refresh(existing, note) : entryFor(note)
    })
  }

  const indexContent = async (snapshot: readonly Note[], builtVersion: number) => {
    const built: ContentEntry[] = []
    const budget = uiBudget()
    const started = performance.now()
    let yielded = false
    let size = 0
    for (const note of snapshot) {
      const source = note.source
      built.push({
        note,
        text: source,
        folded: foldSearchText(source),
        starts: undefined,
      })
      size += source.length
      if ((built.length & 63) === 0 && budget.over()) {
        // Handing the frame back costs a timer round trip, so only take it when
        // the rest of the index would hold the frame longer than that.
        const left = snapshot.length - built.length
        if (left > 0 && ((performance.now() - started) / built.length) * left > 2) {
          yielded = true
          await budget.yieldFrame()
        }
      }
    } // A large note can fold inside one budget slice, so let timers run once.
    if (!yielded && size >= 262144) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    entries = builtVersion === version ? built : patch(built, notes)
    content = Promise.resolve(entries)
    return entries
  }

  const search = async (
    query: string,
    mode: SearchMode,
    cancelled = () => false
  ): Promise<SearchResult[]> => {
    const current = ++request
    const budget = uiBudget()
    const value = query.trim()
    if (!value) {
      all ??= notes.map((note) => ({ note }))
      return all
    }
    const folded = foldSearchText(value)
    // A query made only of combining marks folds to nothing, and an empty pattern
    // would match every position. Treat it as no query rather than matching all.
    if (!folded) return []

    const searchTerms = async (terms: string[]): Promise<SearchResult[]> => {
      if (!content) content = indexContent(notes, version)
      const currentEntries = await content
      const namesOnly = mode === 'names'
      const contentOnly = mode === 'content'
      const hits: { result: SearchResult; matched: number; titleHits: number; score: number }[] = []
      for (const entry of currentEntries) {
        if (current !== request || cancelled()) return []
        const note = entry.note
        const name = foldedName(note)
        const title = name.foldedTitle
        const path = name.foldedPath
        const foldedText = namesOnly ? '' : foldedOf(entry)
        let matched = 0
        let titleHits = 0
        let score = 0
        let snippetTerm = ''
        for (const term of terms) {
          const inTitle = !contentOnly && title.includes(term)
          const inPath = !contentOnly && path.includes(term)
          const inContent = !namesOnly && foldedText.includes(term)
          if (!inTitle && !inPath && !inContent) continue
          matched++
          if (inTitle) {
            titleHits++
            score += 1000 + (title.startsWith(term) ? 200 : 0)
          } else if (inPath) score += 400
          else {
            score += 100
            if (!snippetTerm) snippetTerm = term
          }
        }
        if (matched === 0) continue
        score += matched * 5000 + (titleHits === terms.length ? 3000 : 0)
        score += Math.max(0, 100 - Math.min(title.length, 100))
        const result: SearchResult = { note }
        if (snippetTerm) {
          const hit = lineHit(entry, foldedText, snippetTerm)
          if (hit) {
            result.line = hit.line
            result.snippet = snippetText(hit.text, hit.offset)
          }
        }
        hits.push({ result, matched, titleHits, score })
        if (budget.over()) await budget.yieldFrame()
      }
      return hits
        .sort((a, b) => b.matched - a.matched || b.titleHits - a.titleHits || b.score - a.score)
        .map(({ result }) => result)
    }

    const lower = value.toLowerCase()
    const terms = folded.split(/\s+/u).filter(Boolean)
    if (terms.length > 1) return searchTerms(terms)
    const found = new Map<string, RankedResult>()
    const add = (
      note: Note,
      text: string,
      line: number | undefined,
      rank: number,
      score: number,
      offset: number
    ) => {
      const length = text.length
      const previous = found.get(note.path)
      if (
        previous &&
        (previous.rank < rank ||
          (previous.rank === rank &&
            (previous.score > score || (previous.score === score && previous.length <= length))))
      )
        return
      const result: SearchResult = { note }
      if (line !== undefined) {
        result.line = line
        result.snippet = snippetText(text, offset)
      }
      found.set(note.path, { result, rank, score, length })
    }

    const first = folded[0]
    const literalKey = JSON.stringify(['literal', folded, lower])
    const fuzzyKey = JSON.stringify(['fuzzy', folded, lower])
    if (mode !== 'content') {
      for (const { item, score } of names.find(value))
        add(item.note, item.text, undefined, item.folded.includes(folded) ? 0 : 2, score, 0)
    }
    if (mode !== 'names') {
      if (!content) content = indexContent(notes, version)
      const currentEntries = await content
      for (const entry of currentEntries) {
        if (current !== request || cancelled()) return []
        // Nothing in the content can outrank a name hit for the same note.
        if (found.get(entry.note.path)?.rank !== 0) {
          const foldedText = foldedOf(entry)
          // A note without the query's first character can match neither way.
          if (foldedText.indexOf(first) >= 0) {
            const literal = cachedHit(literalKey, entry, foldedText, folded, lower, 'literal')
            if (literal)
              add(entry.note, literal.text, literal.line, 1, literal.score, literal.offset)
            else if (containsAll(foldedText, folded)) {
              const fuzzy = cachedHit(fuzzyKey, entry, foldedText, folded, lower, 'fuzzy')
              if (fuzzy) add(entry.note, fuzzy.text, fuzzy.line, 3, fuzzy.score, fuzzy.offset)
            }
          }
        }
        if (budget.over()) await budget.yieldFrame()
      }
    }
    return [...found.values()]
      .sort((a, b) => a.rank - b.rank || b.score - a.score || a.length - b.length)
      .map(({ result }) => result)
  }

  search.warm = async () => {
    if (!content) content = indexContent(notes, version)
    await content
  }

  search.update = (next: readonly Note[]) => {
    let renamed = next.length !== notes.length
    if (!renamed) {
      for (let index = 0; index < next.length; index++) {
        const note = next[index]
        const previous = notes[index]
        if (note !== previous && (note.path !== previous.path || note.title !== previous.title)) {
          renamed = true
          break
        }
      }
    }
    notes = next
    if (renamed) names = nameIndex(next)
    all = null
    version++
    request++
    if (renamed) hitCache.clear()
    if (entries) {
      entries = patch(entries, next)
      content = Promise.resolve(entries)
    }
  }

  return search
}

type FoldedName = { title: string; path: string; foldedTitle: string; foldedPath: string }

const foldedNames = new WeakMap<Note, FoldedName>()

function foldedName(note: Note): FoldedName {
  const cached = foldedNames.get(note)
  if (cached && cached.title === note.title && cached.path === note.path) return cached
  const entry = {
    title: note.title,
    path: note.path,
    foldedTitle: foldSearchText(note.title),
    foldedPath: foldSearchText(note.path),
  }
  foldedNames.set(note, entry)
  return entry
}

const NAME_OPTIONS = {
  selector: (entry: NameEntry) => entry.text,
  casing: 'case-insensitive' as const,
  sort: false,
}

function cacheNameMasks(entry: NameEntry): void {
  if (entry.letters !== undefined && entry.digits !== undefined) return
  let letters = 0
  let digits = 0
  for (let index = 0; index < entry.folded.length; index++) {
    const code = entry.folded.charCodeAt(index)
    if (code >= 97 && code <= 122) letters |= 1 << (code - 97)
    else if (code >= 48 && code <= 57) digits |= 1 << (code - 48)
  }
  entry.letters = letters
  entry.digits = digits
}

function queryMasks(value: string): [number, number] | null {
  let letters = 0
  let digits = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 97 && code <= 122) letters |= 1 << (code - 97)
    else if (code >= 48 && code <= 57) digits |= 1 << (code - 48)
    else return null
  }
  return [letters, digits]
}

// A name can only match when the query's characters appear in it in order, and
// deciding that is much cheaper than the scoring pass FZF runs per entry. Only
// candidates reach it, so a query with few candidates never needs the index over
// every name at all.
function nameIndex(notes: readonly Note[]) {
  const entries: NameEntry[] = []
  for (const note of notes) {
    entries.push(nameEntry(note, note.title), nameEntry(note, note.path))
  }
  let index: Fzf<NameEntry[]> | undefined
  let digitIndex: Map<number, NameEntry[]> | undefined
  let digitIndexReady = false
  const cache = new Map<string, NameMatch[]>()
  const remember = (value: string, matches: NameMatch[]) => {
    if (cache.size === 8) dropOldest(cache)
    cache.set(value, matches)
    return matches
  }
  const allPlain = entries.every((entry) => entry.plain)
  const entriesForDigits = (mask: number): NameEntry[] | null => {
    if (!mask) return entries
    digitIndex ??= new Map()
    if (!digitIndexReady) {
      for (const entry of entries) {
        cacheNameMasks(entry)
        for (let digit = 0; digit < 10; digit++) {
          const bit = 1 << digit
          if (!((entry.digits ?? 0) & bit)) continue
          const bucket = digitIndex.get(bit)
          if (bucket) bucket.push(entry)
          else digitIndex.set(bit, [entry])
        }
      }
      digitIndexReady = true
    }
    let selected: NameEntry[] | null = null
    for (let digit = 0; digit < 10; digit++) {
      const bit = 1 << digit
      if (!(mask & bit)) continue
      const bucket = digitIndex.get(bit)
      if (!bucket) return null
      if (!selected || bucket.length < selected.length) selected = bucket
    }
    return selected
  }
  const everything = () => (index ??= new Fzf(entries, NAME_OPTIONS))
  return {
    find(value: string) {
      const cached = cache.get(value)
      if (cached) return cached
      if (entries.length === 0) return remember(value, [])
      // Normalization can map characters this prefilter does not, so leave those
      // queries to FZF alone.
      if (!isAsciiText(value)) return remember(value, everything().find(value))
      const needle = value.toLowerCase()
      const masks = queryMasks(needle)
      const pool = allPlain && masks?.[1] ? entriesForDigits(masks[1]) : entries
      if (!pool) return remember(value, [])
      const candidates: NameEntry[] = []
      for (const entry of pool) {
        if (!entry.plain) {
          candidates.push(entry)
          continue
        }
        if (masks) {
          cacheNameMasks(entry)
          if (
            ((entry.letters ?? 0) & masks[0]) !== masks[0] ||
            ((entry.digits ?? 0) & masks[1]) !== masks[1]
          )
            continue
        }
        if (isSubsequence(entry.folded, needle)) candidates.push(entry)
      }
      if (candidates.length === 0) return remember(value, [])
      if (candidates.length * 2 > entries.length) return remember(value, everything().find(value))
      return remember(value, new Fzf(candidates, NAME_OPTIONS).find(value))
    },
  }
}

function isSubsequence(text: string, needle: string): boolean {
  let position = -1
  for (let index = 0; index < needle.length; index++) {
    position = text.indexOf(needle[index], position + 1)
    if (position < 0) return false
  }
  return true
}
