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
const previews = new WeakMap<Note, { source: string; limit: number; text: string }>()

export function notePreview(note: Note, limit = 220): string {
  const cached = previews.get(note)
  if (cached?.source === note.source && cached.limit === limit) return cached.text
  const lines: string[] = []
  let directiveDepth = 0
  let fenced = false
  let blockComment = false
  for (const line of note.source.split('\n')) {
    const trimmed = line.trim()
    if (directiveDepth > 0) {
      directiveDepth +=
        (trimmed.match(/[[{(]/gu)?.length ?? 0) - (trimmed.match(/[\])}]/gu)?.length ?? 0)
      continue
    }
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
    if (DIRECTIVE.test(trimmed)) {
      directiveDepth = Math.max(
        0,
        (trimmed.match(/[[{(]/gu)?.length ?? 0) - (trimmed.match(/[\])}]/gu)?.length ?? 0)
      )
      continue
    }
    const text = trimmed
      .replace(HEADING, '')
      .replace(BULLET, '')
      .replace(/#[A-Za-z][\w-]*(?:\([^)]*\))?\[/gu, '')
      .replace(/\\/gu, '')
      .replace(/[*_`#$[\]]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
    if (text) lines.push(text)
    if (lines.join(' ').length > limit) break
  }
  const joined = lines.join(' ').trim()
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
}

type ContentEntry = {
  note: Note
  text: string
  folded: string
  starts: Int32Array | undefined
}

export type NoteSort = 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc'

type SortEntry = {
  title: string
  path: string
  modifiedAt: number | null
  pathKey?: string
  nameKey?: string
  modifiedAscKey?: string
  modifiedDescKey?: string
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
  const cached = sortEntries.get(note)
  if (
    cached &&
    cached.title === note.title &&
    cached.path === note.path &&
    cached.modifiedAt === note.modifiedAt
  )
    return cached
  const entry: SortEntry = { title: note.title, path: note.path, modifiedAt: note.modifiedAt }
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

function modifiedKey(entry: SortEntry, desc: boolean): string {
  if (desc) {
    // Unknown dates stay last in both directions.
    entry.modifiedDescKey ??= `${
      entry.modifiedAt === null
        ? MAX_MODIFIED
        : String(MAX_MODIFIED - entry.modifiedAt).padStart(14, '0')
    }\u0000${pathKey(entry)}`
    return entry.modifiedDescKey
  }
  entry.modifiedAscKey ??= `${
    entry.modifiedAt === null ? MAX_MODIFIED : String(entry.modifiedAt).padStart(14, '0')
  }\u0000${pathKey(entry)}`
  return entry.modifiedAscKey
}

// Keys are built for the requested sort only, so an import that never shows
// modification order does not pay for it.
function sortKeyFor(note: Note, name: boolean, desc: boolean): string {
  const entry = sortEntry(note)
  return name ? nameKey(entry) : modifiedKey(entry, desc)
}

// Sorting keys in a native string sort avoids a JavaScript comparator, which
// Hermes calls once per comparison. The map turns the sorted keys back into notes.
export function sortNotes(notes: Note[], sort: NoteSort): Note[] {
  const name = sort.startsWith('name')
  const desc = sort.endsWith('-desc')
  const keys = new Array<string>(notes.length)
  const byKey = new Map<string, Note>()
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index]
    const key = sortKeyFor(note, name, desc)
    keys[index] = key
    byKey.set(key, note)
  }
  // Duplicate paths are not expected, but they must not drop a note from the list.
  if (byKey.size !== notes.length) {
    const direction = name && desc ? -1 : 1
    return [...notes].sort((a, b) => {
      const left = sortKeyFor(a, name, desc)
      const right = sortKeyFor(b, name, desc)
      return (left < right ? -1 : left > right ? 1 : 0) * direction
    })
  }
  keys.sort()
  if (name && desc) keys.reverse()
  const sorted = new Array<Note>(notes.length)
  for (let index = 0; index < keys.length; index++) sorted[index] = byKey.get(keys[index]) as Note
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

function foldSearchText(text: string): string {
  if (isAsciiText(text)) return text.toLowerCase()
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function nameEntry(note: Note, text: string): NameEntry {
  return { note, text, folded: foldSearchText(text) }
}

function searchBudget() {
  let started = performance.now()
  return async () => {
    if (performance.now() - started < 6) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    started = performance.now()
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

// A line can only match when every query character occurs somewhere in the note.
// This is one native scan per character instead of walking every line.
function containsAll(text: string, pattern: string): boolean {
  for (let index = 0; index < pattern.length; index++)
    if (text.indexOf(pattern[index]) < 0) return false
  return true
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

function lineOffsets(entry: ContentEntry): Int32Array {
  entry.starts ??= lineStarts(entry.folded)
  return entry.starts
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

function lineText(entry: ContentEntry, line: number, left: number, right: number): string {
  return entry.folded.length === entry.text.length
    ? entry.text.slice(left, right)
    : trimmedLine(entry.text, line)
}

function lineHit(entry: ContentEntry, term: string): { line: number; snippet: string } | null {
  const at = entry.folded.indexOf(term)
  if (at < 0) return null
  const starts = lineOffsets(entry)
  let line = 0
  while (line + 1 < starts.length && starts[line + 1] <= at) line++
  const lineStart = starts[line]
  const end = line + 1 < starts.length ? starts[line + 1] - 1 : entry.folded.length
  let left = lineStart
  while (left < end && isSpace(entry.folded.charCodeAt(left))) left++
  let right = end
  while (right > left && isSpace(entry.folded.charCodeAt(right - 1))) right--
  const text = lineText(entry, line, left, right)
  const index = Math.max(0, text.toLocaleLowerCase().indexOf(term))
  const from = Math.max(0, index - 50)
  return {
    line: line + 1,
    snippet: `${from ? '…' : ''}${text.slice(from, from + 180)}${text.length > from + 180 ? '…' : ''}`,
  }
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

  const entryFor = (note: Note): ContentEntry => ({
    note,
    text: note.source,
    folded: foldSearchText(note.source),
    starts: undefined,
  })

  // Notes keep their object identity across scans, so an edit updates the entry in
  // place instead of copying the whole index.
  const refresh = (entry: ContentEntry, note: Note): ContentEntry => {
    if (entry.text !== note.source) {
      entry.text = note.source
      entry.folded = foldSearchText(note.source)
      entry.starts = undefined
    }
    entry.note = note
    return entry
  }

  const patch = (current: ContentEntry[], next: readonly Note[]): ContentEntry[] => {
    const sameOrder =
      next.length === current.length && next.every((note, i) => note.path === current[i].note.path)
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
    const pause = searchBudget()
    let size = 0
    for (const note of snapshot) {
      const source = note.source
      built.push({ note, text: source, folded: foldSearchText(source), starts: undefined })
      size += source.length
      if ((built.length & 63) === 0) await pause()
    } // A large note can fold inside one budget slice, so always let timers run once.
    if (size >= 262144) await new Promise<void>((resolve) => setTimeout(resolve, 0))
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
    const pause = searchBudget()
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
        const title = foldSearchText(note.title)
        const path = foldSearchText(note.path)
        let matched = 0
        let titleHits = 0
        let score = 0
        let snippetTerm = ''
        for (const term of terms) {
          const inTitle = !contentOnly && title.includes(term)
          const inPath = !contentOnly && path.includes(term)
          const inContent = !namesOnly && entry.folded.includes(term)
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
          const hit = lineHit(entry, snippetTerm)
          if (hit) {
            result.line = hit.line
            result.snippet = hit.snippet
          }
        }
        hits.push({ result, matched, titleHits, score })
        await pause()
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
      start: number
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
        const literal = text.toLowerCase().indexOf(lower)
        const from = Math.max(0, (literal >= 0 ? literal : start) - 50)
        result.line = line
        result.snippet = `${from ? '…' : ''}${text.slice(from, from + 180)}${text.length > from + 180 ? '…' : ''}`
      }
      found.set(note.path, { result, rank, score, length })
    }

    if (mode !== 'content') {
      for (const { item, score, start } of names.find(value))
        add(item.note, item.text, undefined, item.folded.includes(folded) ? 0 : 2, score, start)
    }
    if (mode !== 'names') {
      if (!content) content = indexContent(notes, version)
      const currentEntries = await content
      for (const entry of currentEntries) {
        if (current !== request || cancelled()) return []
        // Nothing in the content can outrank a name hit for the same note.
        if (found.get(entry.note.path)?.rank !== 0) {
          const foldedText = entry.folded
          let literal = -1
          let literalAt = 0
          let bestLine = 0
          let bestLeft = 0
          let bestRight = 0
          let at = foldedText.indexOf(folded)
          if (at >= 0) {
            const starts = lineOffsets(entry)
            let line = 0
            while (at >= 0) {
              while (line + 1 < starts.length && starts[line + 1] <= at) line++
              const lineStart = starts[line]
              const end = line + 1 < starts.length ? starts[line + 1] - 1 : foldedText.length
              let left = lineStart
              while (left < end && isSpace(foldedText.charCodeAt(left))) left++
              let right = end
              while (right > left && isSpace(foldedText.charCodeAt(right - 1))) right--
              if (at >= left && at + folded.length <= right) {
                const score = literalScore(
                  right - left,
                  right - left === folded.length,
                  at - left,
                  at === left || isBoundary(foldedText, at)
                )
                if (literal < 0 || score > literal) {
                  literal = score
                  literalAt = at
                  bestLine = line
                  bestLeft = left
                  bestRight = right
                }
              }
              at = foldedText.indexOf(folded, end + 1)
            }
          }
          if (literal >= 0)
            add(
              entry.note,
              lineText(entry, bestLine, bestLeft, bestRight),
              bestLine + 1,
              1,
              literal,
              literalAt - bestLeft
            )
          else if (containsAll(foldedText, folded)) {
            const starts = lineOffsets(entry)
            let fuzzy = -Infinity
            let fuzzyLength = 0
            for (let line = 0; line < starts.length; line++) {
              const lineStart = starts[line]
              const end = line + 1 < starts.length ? starts[line + 1] - 1 : foldedText.length
              let left = lineStart
              while (left < end && isSpace(foldedText.charCodeAt(left))) left++
              let right = end
              while (right > left && isSpace(foldedText.charCodeAt(right - 1))) right--
              if (right > left) {
                const score = fuzzyScoreInRange(foldedText, folded, left, right)
                const length = right - left
                if (score > fuzzy || (score === fuzzy && length < fuzzyLength)) {
                  fuzzy = score
                  fuzzyLength = length
                  bestLine = line
                  bestLeft = left
                  bestRight = right
                }
              }
            }
            if (fuzzy > -Infinity)
              add(
                entry.note,
                lineText(entry, bestLine, bestLeft, bestRight),
                bestLine + 1,
                3,
                fuzzy,
                foldedText.indexOf(folded[0], bestLeft) - bestLeft
              )
          }
        }
        await pause()
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
    const renamed =
      next.length !== notes.length ||
      next.some((note, i) => note.path !== notes[i].path || note.title !== notes[i].title)
    notes = next
    if (renamed) names = nameIndex(next)
    all = null
    version++
    request++
    if (entries) {
      entries = patch(entries, next)
      content = Promise.resolve(entries)
    }
  }

  return search
}

function nameIndex(notes: readonly Note[]) {
  return new Fzf(
    notes.flatMap((note) => [nameEntry(note, note.title), nameEntry(note, note.path)]),
    {
      selector: (entry: NameEntry) => entry.text,
      casing: 'case-insensitive' as const,
      sort: false,
    }
  )
}
