export type FindSelection = { start: number; end: number }

export function findMatches(source: string, query: string): number[] {
  if (!query) return []
  const haystack = source.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
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
  const start = source.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  return start >= 0 ? { start, end: start + query.length } : undefined
}

export function initialFindSelection(
  source: string,
  initialLine: number | undefined,
  initialQuery: string
): { selection: FindSelection; matchIndex?: number } | undefined {
  if (initialLine) {
    const lines = source.split('\n')
    const line = lines[initialLine - 1] || ''
    const offset =
      lines.slice(0, Math.max(0, initialLine - 1)).join('\n').length + (initialLine > 1 ? 1 : 0)
    const match = initialQuery
      ? line.toLocaleLowerCase().indexOf(initialQuery.toLocaleLowerCase())
      : -1
    const start = offset + Math.max(0, match)
    const selection = {
      start,
      end: match >= 0 ? start + initialQuery.length : offset + line.length,
    }
    const matchIndex =
      match >= 0
        ? source.slice(0, start).toLocaleLowerCase().split(initialQuery.toLocaleLowerCase())
            .length - 1
        : undefined
    return { selection, matchIndex }
  }
  if (initialQuery) {
    const selection = findFirst(source, initialQuery)
    return selection ? { selection } : undefined
  }
  return undefined
}
