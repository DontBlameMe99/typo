import { normalizeSource } from '../editor/protocol'

export type FindSelection = { start: number; end: number }

import { foldSearchText, sourceOffset } from '../search/query'

let cachedSource: string | null = null
let cachedFold = ''

// Case folds one code point without shifting later offsets. Default lowercase
// mapping can grow (İ becomes i + combining dot), so keep its first code point
// when the mapping is longer than the original.
function fold(text: string): string {
  let result = ''
  for (let at = 0; at < text.length; ) {
    const codePoint = text.codePointAt(at) ?? 0
    const original = String.fromCodePoint(codePoint)
    const lower = original.toLowerCase()
    if (lower.length === original.length) result += lower
    else {
      const first = lower.codePointAt(0) ?? codePoint
      const replacement = String.fromCodePoint(first)
      result += replacement.length === original.length ? replacement : original
    }
    at += original.length
  }
  return result
}

function foldSource(source: string): string {
  if (source === cachedSource) return cachedFold
  cachedSource = source
  cachedFold = fold(source)
  return cachedFold
}

function find(source: string, query: string): { haystack: string; needle: string } {
  return { haystack: foldSource(normalizeSource(source)), needle: fold(normalizeSource(query)) }
}

export function findMatches(source: string, query: string): number[] {
  if (!query) return []
  const { haystack, needle } = find(source, query)
  if (!needle) return []
  const found: number[] = []
  let offset = 0
  while (offset <= haystack.length) {
    const at = haystack.indexOf(needle, offset)
    if (at < 0) break
    found.push(at)
    offset = at + Math.max(1, needle.length)
  }
  return found
}

export function findFirst(source: string, query: string): FindSelection | undefined {
  if (!query) return undefined
  const { haystack, needle } = find(source, query)
  if (!needle) return undefined
  const start = haystack.indexOf(needle)
  return start >= 0 ? { start, end: start + needle.length } : undefined
}

function replacementSpans(source: string, query: string): FindSelection[] {
  if (!query) return []
  const normalized = normalizeSource(source)
  const haystack = foldSearchText(normalized)
  const needle = foldSearchText(normalizeSource(query))
  if (!needle) return []
  const spans: FindSelection[] = []
  let at = 0
  while (at <= haystack.length) {
    const start = haystack.indexOf(needle, at)
    if (start < 0) break
    const end = start + needle.length
    spans.push({ start: sourceOffset(normalized, start), end: sourceOffset(normalized, end) })
    at = end
  }
  return spans
}

export function replaceMatches(source: string, query: string, replacement: string, at = 0): string {
  const spans = replacementSpans(source, query)
  const span = spans[at] ?? spans[0]
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
    const haystack = foldSource(normalized)
    const lines = normalized.split('\n')
    const line = lines[initialLine - 1] || ''
    const offset =
      lines.slice(0, Math.max(0, initialLine - 1)).join('\n').length + (initialLine > 1 ? 1 : 0)
    const needle = initialQuery ? fold(normalizeSource(initialQuery)) : ''
    const match = needle ? haystack.indexOf(needle, offset) : -1
    const onLine =
      match >= offset && match <= offset + line.length - needle.length ? match - offset : -1
    const start = offset + Math.max(0, onLine)
    const selection = {
      start,
      end: onLine >= 0 ? start + needle.length : offset + line.length,
    }
    let matchIndex: number | undefined
    if (onLine >= 0) {
      matchIndex = 0
      const step = Math.max(1, needle.length)
      for (
        let at = haystack.indexOf(needle);
        at >= 0 && at < start;
        at = haystack.indexOf(needle, at + step)
      )
        matchIndex++
    }
    return { selection, matchIndex }
  }
  if (initialQuery) {
    const selection = findFirst(normalized, initialQuery)
    return selection ? { selection } : undefined
  }
  return undefined
}
