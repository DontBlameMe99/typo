import { normalizeSource } from '../editor/protocol'
import { foldSearchText } from '../search/query'

export type FindSelection = { start: number; end: number }

type FoldedSource = { haystack: string; offsets: number[] }

let cachedSource: string | null = null
let cachedFold: FoldedSource | null = null

function fold(text: string): string {
  return foldSearchText(text)
}

function foldedSource(source: string): FoldedSource {
  if (source === cachedSource && cachedFold) return cachedFold
  const haystack = fold(source)
  const offsets = new Array<number>(haystack.length + 1)
  let folded = 0
  let at = 0
  for (const character of source) {
    const width = foldSearchText(character).length
    for (let index = 0; index < width; index++) offsets[folded + index] = at
    folded += width
    at += character.length
  }
  offsets[folded] = at
  cachedSource = source
  cachedFold = { haystack, offsets }
  return cachedFold
}

function sourceAt(folded: FoldedSource, index: number): number {
  return folded.offsets[index] ?? folded.haystack.length
}

function find(source: string, query: string): { folded: FoldedSource; needle: string } {
  const normalized = normalizeSource(source)
  return { folded: foldedSource(normalized), needle: fold(normalizeSource(query)) }
}

function foldedMatches(haystack: string, needle: string, limit = Infinity): number[] {
  if (!needle) return []
  const found: number[] = []
  let offset = 0
  while (offset <= haystack.length) {
    const at = haystack.indexOf(needle, offset)
    if (at < 0) break
    found.push(at)
    if (found.length >= limit) break
    offset = at + Math.max(1, needle.length)
  }
  return found
}

export function findMatches(source: string, query: string): number[] {
  const { folded, needle } = find(source, query)
  return foldedMatches(folded.haystack, needle).map((at) => sourceAt(folded, at))
}

export function findFirst(source: string, query: string): FindSelection | undefined {
  if (!query) return undefined
  const { folded, needle } = find(source, query)
  const start = needle ? folded.haystack.indexOf(needle) : -1
  return start >= 0
    ? { start: sourceAt(folded, start), end: sourceAt(folded, start + needle.length) }
    : undefined
}

function replacementSpans(source: string, query: string, limit = Infinity): FindSelection[] {
  const { folded, needle } = find(source, query)
  return foldedMatches(folded.haystack, needle, limit).map((start) => ({
    start: sourceAt(folded, start),
    end: sourceAt(folded, start + needle.length),
  }))
}

export function replaceMatches(source: string, query: string, replacement: string, at = 0): string {
  const span = replacementSpans(source, query, at + 1)[at]
  if (!span) return source
  const normalized = normalizeSource(source)
  return normalized.slice(0, span.start) + replacement + normalized.slice(span.end)
}

export function replaceAllMatches(source: string, query: string, replacement: string): string {
  const spans = replacementSpans(source, query)
  if (!spans.length) return source
  let result = normalizeSource(source)
  for (const span of [...spans].reverse())
    result = result.slice(0, span.start) + replacement + result.slice(span.end)
  return result
}

export function initialFindSelection(
  source: string,
  initialLine: number | undefined,
  initialQuery: string
): { selection: FindSelection; matchIndex?: number } | undefined {
  const normalized = normalizeSource(source)
  if (initialLine) {
    const { folded, needle } = find(normalized, initialQuery)
    const lines = normalized.split('\n')
    const lineStart =
      lines.slice(0, Math.max(0, initialLine - 1)).join('\n').length + (initialLine > 1 ? 1 : 0)
    const lineEnd = lineStart + (lines[initialLine - 1] || '').length
    const foldedStart = fold(normalized.slice(0, lineStart)).length
    const foldedEnd = fold(normalized.slice(0, lineEnd)).length
    const match = needle ? folded.haystack.indexOf(needle, foldedStart) : -1
    const onLine = match >= foldedStart && match >= 0 && match + needle.length <= foldedEnd
    const selection = {
      start: sourceAt(folded, onLine ? match : foldedStart),
      end: onLine ? sourceAt(folded, match + needle.length) : lineEnd,
    }
    let matchIndex: number | undefined
    if (onLine) {
      matchIndex = foldedMatches(folded.haystack, needle).filter((at) => at < match).length
    }
    return { selection, matchIndex }
  }
  if (initialQuery) {
    const selection = findFirst(normalized, initialQuery)
    return selection ? { selection } : undefined
  }
  return undefined
}
