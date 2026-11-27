import { FOLD_PADDING, foldSearchText, parseSearchQuery } from './query'

export type HighlightRange = { start: number; end: number }

function foldedMatch(haystack: string, needle: string, from: number): HighlightRange | null {
  if (!needle) return null
  for (let start = from; start < haystack.length; start++) {
    if (haystack[start] === FOLD_PADDING) continue
    let at = start
    let matched = 0
    while (at < haystack.length && matched < needle.length) {
      if (haystack[at] === FOLD_PADDING) {
        at++
        continue
      }
      if (haystack[at] !== needle[matched]) break
      at++
      matched++
    }
    if (matched === needle.length) return { start, end: at }
  }
  return null
}

function queryTerms(query: string): string[] {
  return parseSearchQuery(query)
    .terms.map((term) => foldSearchText(term))
    .filter(Boolean)
}

export function hasSearchMatch(text: string, query: string): boolean {
  const haystack = foldSearchText(text, false, true)
  return queryTerms(query).some((term) => foldedMatch(haystack, term, 0) !== null)
}

export function highlightRanges(text: string, query: string, fuzzy = false): HighlightRange[] {
  const needles = queryTerms(query)
  const haystack = foldSearchText(text, false, true)
  const found: HighlightRange[] = []
  for (const needle of needles) {
    let from = 0
    for (;;) {
      const match = foldedMatch(haystack, needle, from)
      if (!match) break
      found.push(match)
      from = match.end || match.start + 1
    }
  }
  if (!found.length && fuzzy && needles.length) {
    const needle = needles[0]
    let at = 0
    let matched = 0
    while (at < haystack.length && matched < needle.length) {
      if (haystack[at] === FOLD_PADDING) {
        at++
        continue
      }
      if (haystack[at] !== needle[matched]) break
      at++
      matched++
    }
    if (matched) found.push({ start: 0, end: at })
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: HighlightRange[] = []
  for (const range of found) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}
