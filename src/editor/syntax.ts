import { Edit, Language, Parser, Query, type Tree } from 'web-tree-sitter'
import { typstHighlights } from './highlights'

export type Highlight = { from: number; to: number; style: string }

// Row/column lookups need every line start of the note. Keeping them in a sorted
// array turns each lookup into a binary search instead of a walk from index 0,
// which is what typing near the end of a long note spends its time on.
function lineStarts(source: string) {
  const starts = [0]
  let index = source.indexOf('\n')
  while (index !== -1) {
    starts.push(index + 1)
    index = source.indexOf('\n', index + 1)
  }
  return starts
}

// Index of the first element greater than `index`.
function firstAfter(starts: number[], index: number) {
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (starts[middle] <= index) low = middle + 1
    else high = middle
  }
  return low
}

// Only the lines the edit touches can move. Everything before it is byte for
// byte the same text, and everything after it shifts by one constant.
function updateStarts(
  starts: number[],
  source: string,
  start: number,
  oldEnd: number,
  newEnd: number
) {
  const kept = firstAfter(starts, start)
  const tail = firstAfter(starts, oldEnd)
  const shifted = newEnd - oldEnd
  const added: number[] = []
  let index = source.indexOf('\n', start)
  while (index !== -1 && index < newEnd) {
    added.push(index + 1)
    index = source.indexOf('\n', index + 1)
  }
  const tailStart = kept + added.length
  const tailCount = starts.length - tail
  // The tail moves right when the edit adds lines, and copyWithin cannot grow an
  // array, so the shift is written element by element in the safe direction.
  if (tailStart + tailCount > starts.length) starts.length = tailStart + tailCount
  if (tailStart >= tail) {
    for (let i = tailCount - 1; i >= 0; i--) starts[tailStart + i] = starts[tail + i] + shifted
  } else {
    for (let i = 0; i < tailCount; i++) starts[tailStart + i] = starts[tail + i] + shifted
  }
  starts.length = tailStart + tailCount
  for (let i = 0; i < added.length; i++) starts[kept + i] = added[i]
}

function pointAt(starts: number[], index: number) {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle] <= index) low = middle
    else high = middle - 1
  }
  return { row: low, column: index - starts[low] }
}

// Chunks let the runtime compare whole spans at once. Comparing code units one by
// one costs milliseconds when a keystroke shares the whole prefix with the note.
const DIFF_CHUNK = 8192

function sharedStart(before: string, after: string) {
  const limit = Math.min(before.length, after.length)
  let index = 0
  while (
    index + DIFF_CHUNK <= limit &&
    before.slice(index, index + DIFF_CHUNK) === after.slice(index, index + DIFF_CHUNK)
  )
    index += DIFF_CHUNK
  while (index < limit && before.charCodeAt(index) === after.charCodeAt(index)) index++
  return index
}

function sharedEnd(before: string, after: string, start: number) {
  let oldEnd = before.length
  let newEnd = after.length
  while (
    oldEnd - DIFF_CHUNK >= start &&
    newEnd - DIFF_CHUNK >= start &&
    before.slice(oldEnd - DIFF_CHUNK, oldEnd) === after.slice(newEnd - DIFF_CHUNK, newEnd)
  ) {
    oldEnd -= DIFF_CHUNK
    newEnd -= DIFF_CHUNK
  }
  while (
    oldEnd > start &&
    newEnd > start &&
    before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)
  ) {
    oldEnd--
    newEnd--
  }
  return { oldEnd, newEnd }
}

// An offset inside a surrogate pair would make tree-sitter points invalid, so an
// edit that lands there is widened to cover the whole pair. The old text decides
// when it still has a character at that offset.
function insidePair(before: string, after: string, oldIndex: number, newIndex: number) {
  const code = oldIndex < before.length ? before.charCodeAt(oldIndex) : after.charCodeAt(newIndex)
  return code >= 0xdc00 && code <= 0xdfff
}

function changedSpan(before: string, after: string) {
  let start = sharedStart(before, after)
  if (start > 0 && insidePair(before, after, start, start)) start--
  let { oldEnd, newEnd } = sharedEnd(before, after, start)
  if (insidePair(before, after, oldEnd, newEnd)) {
    oldEnd++
    newEnd++
  }
  return { startIndex: start, oldEndIndex: oldEnd, newEndIndex: newEnd }
}

export function replacementEdit(
  before: string,
  after: string,
  beforeStarts = lineStarts(before),
  afterStarts = lineStarts(after)
) {
  const span = changedSpan(before, after)
  return {
    ...span,
    startPosition: pointAt(beforeStarts, span.startIndex),
    oldEndPosition: pointAt(beforeStarts, span.oldEndIndex),
    newEndPosition: pointAt(afterStarts, span.newEndIndex),
  }
}

// A capture with the pattern that produced it, which breaks ties between spans
// that cover the same text.
type Span = Highlight & { patternIndex: number }

const byPrecedence = (a: Span, b: Span) =>
  a.from - b.from || b.to - a.to || a.patternIndex - b.patternIndex

export class TypstSyntax {
  private tree: Tree | null = null
  private source = ''
  private starts = [0]
  private parser: Parser
  private query: Query

  constructor(language: Language) {
    this.parser = parserFor(language)
    this.query = queryFor(language)
  }

  highlights(source: string, range = { from: 0, to: source.length }): Highlight[] {
    if (!this.tree || source !== this.source) {
      let starts: number[]
      let tree: Tree | null
      if (this.tree) {
        const span = changedSpan(this.source, source)
        starts = this.starts
        // The end of the change is a position in the old text, so it is read
        // before the starts array is patched to describe the new one.
        const oldEndPosition = pointAt(starts, span.oldEndIndex)
        updateStarts(starts, source, span.startIndex, span.oldEndIndex, span.newEndIndex)
        this.tree.edit(
          new Edit({
            ...span,
            startPosition: pointAt(starts, span.startIndex),
            oldEndPosition,
            newEndPosition: pointAt(starts, span.newEndIndex),
          })
        )
        tree = this.parser.parse((index) => parseChunk(source, index), this.tree)
      } else {
        starts = lineStarts(source)
        tree = this.parser.parse((index) => parseChunk(source, index), null)
      }
      if (!tree) throw new Error('Unable to parse this note.')
      this.tree?.delete()
      this.tree = tree
      this.source = source
      this.starts = starts
    }
    if (range.from === range.to) return []
    const captures = this.query.captures(this.tree.rootNode, {
      startPosition: pointAt(this.starts, range.from),
      endPosition: pointAt(this.starts, range.to),
    })
    const spans: Span[] = new Array(captures.length)
    for (let i = 0; i < captures.length; i++) {
      const { name, node, patternIndex } = captures[i]
      spans[i] = { from: node.startIndex, to: node.endIndex, style: name, patternIndex }
    }
    // Outer spans provide a base color. Inner nodes and later query patterns take precedence.
    spans.sort(byPrecedence)
    const result: Highlight[] = []
    const stack: Span[] = []
    let position = range.from
    const flush = (end: number) => {
      while (stack.length) {
        const active = stack[stack.length - 1]
        const to = Math.min(end, active.to)
        if (position < to) {
          const previous = result[result.length - 1]
          if (previous?.to === position && previous.style === active.style) previous.to = to
          else result.push({ from: position, to, style: active.style })
          position = to
        }
        if (active.to > end) break
        stack.pop()
      }
      position = end
    }
    for (const span of spans) {
      const from = Math.max(range.from, span.from)
      const to = Math.min(range.to, span.to)
      if (from >= to) continue
      flush(from)
      stack.push(span)
    }
    flush(range.to)
    return result
  }

  destroy() {
    this.tree?.delete()
  }
}

// The wasm side copies a chunk into a fixed 10 KB UTF-16 buffer, so a chunk must
// stay well under 5 K characters. Small chunks also keep the copy proportional to
// the text the lexer actually consumes.
const CHUNK = 64

function parseChunk(source: string, index: number) {
  const end = Math.min(index + CHUNK, source.length)
  if (end < source.length) {
    const code = source.charCodeAt(end)
    if (code >= 0xdc00 && code <= 0xdfff) return source.slice(index, end + 1)
  }
  return source.slice(index, end)
}

const parsers = new WeakMap<Language, Parser>()
const queries = new WeakMap<Language, Query>()

function parserFor(language: Language) {
  let parser = parsers.get(language)
  if (!parser) {
    parser = new Parser()
    parser.setLanguage(language)
    parsers.set(language, parser)
  }
  return parser
}

function queryFor(language: Language) {
  let query = queries.get(language)
  if (!query) {
    query = new Query(language, typstHighlights)
    queries.set(language, query)
  }
  return query
}

export async function typstLanguage(runtime: Uint8Array, grammar: Uint8Array) {
  // Blob workers cannot resolve the default relative WASM URL, even with wasmBinary.
  await Parser.init({ wasmBinary: runtime, locateFile: (name: string) => name })
  return Language.load(grammar)
}
