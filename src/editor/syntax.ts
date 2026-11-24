import { Edit, Language, type Node, Parser, Query, type Range, type Tree } from 'web-tree-sitter'
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
  private viewTree: Tree | null = null
  private viewRange = { from: 0, to: 0 }
  private dirtyFrom = Infinity
  private dirtyTo = Infinity
  private source = ''
  private starts = [0]
  private parser: Parser
  private query: Query
  constructor(language: Language) {
    this.parser = parserFor(language)
    this.query = queryFor(language)
  }
  private updateSource(source: string): void {
    if (source === this.source) return
    if (this.tree) {
      const span = changedSpan(this.source, source)
      const oldEndPosition = pointAt(this.starts, span.oldEndIndex)
      updateStarts(this.starts, source, span.startIndex, span.oldEndIndex, span.newEndIndex)
      this.tree.edit(
        new Edit({
          ...span,
          startPosition: pointAt(this.starts, span.startIndex),
          oldEndPosition,
          newEndPosition: pointAt(this.starts, span.newEndIndex),
        })
      )
      const shifted = span.newEndIndex - span.oldEndIndex
      const map = (at: number) =>
        at <= span.startIndex ? at : at >= span.oldEndIndex ? at + shifted : span.newEndIndex
      this.dirtyFrom = Math.min(map(this.dirtyFrom), span.startIndex)
      this.dirtyTo = Math.max(map(this.dirtyTo), span.newEndIndex)
    } else {
      if (this.viewTree) {
        const span = changedSpan(this.source, source)
        updateStarts(this.starts, source, span.startIndex, span.oldEndIndex, span.newEndIndex)
      } else this.starts = lineStarts(source)
    }
    this.viewTree?.delete()
    this.viewTree = null
    this.source = source
  }

  private parse(source: string, range?: { from: number; to: number }): Tree {
    const includedRanges: Range[] | undefined = range
      ? [
          {
            startIndex: range.from,
            endIndex: range.to,
            startPosition: pointAt(this.starts, range.from),
            endPosition: pointAt(this.starts, range.to),
          },
        ]
      : undefined
    const tree = this.parser.parse(
      (index) => parseChunk(source, index, this.starts),
      null,
      includedRanges ? { includedRanges } : undefined
    )
    if (!tree) throw new Error('Unable to parse this note.')
    return tree
  }

  private setFullTree(tree: Tree): Tree {
    this.viewTree?.delete()
    this.viewTree = null
    this.tree?.delete()
    this.tree = tree
    this.dirtyFrom = Infinity
    this.dirtyTo = Infinity
    return tree
  }

  // A full tree supplies safe top-level boundaries. Parsing between two of them
  // keeps viewport colors identical without reparsing the rest of a huge note.
  private windowRange(
    tree: Tree,
    range: { from: number; to: number }
  ): { from: number; to: number } {
    const children = tree.rootNode.children
    const overlaps = (node: Node) =>
      node.startIndex < this.dirtyTo && node.endIndex > this.dirtyFrom
    let first = 0
    while (first < children.length && children[first].endIndex <= range.from) first++
    while (first >= 0 && first < children.length && overlaps(children[first])) first--
    let last = children.length - 1
    while (last >= 0 && children[last].startIndex >= range.to) last--
    while (last < children.length && last >= 0 && overlaps(children[last])) last++
    const from = first < 0 ? 0 : children[first].startIndex
    const to =
      last >= children.length || children.length === 0
        ? this.source.length
        : children[last].endIndex
    return { from, to }
  }

  private treeFor(source: string, range: { from: number; to: number }): Tree {
    this.updateSource(source)
    if (this.viewTree && range.from >= this.viewRange.from && range.to <= this.viewRange.to)
      return this.viewTree
    if (this.tree && this.dirtyFrom === Infinity) return this.tree
    if (!this.tree) {
      if (range.from === 0 || (this.viewTree && range.from < this.viewRange.to)) {
        const to = Math.min(source.length, range.to + 4096)
        const tree = this.parse(source, { from: 0, to })
        if (to === source.length) return this.setFullTree(tree)
        this.viewTree = tree
        this.viewRange = { from: 0, to }
        return tree
      }
      return this.setFullTree(this.parse(source))
    }
    const window = this.windowRange(this.tree, range)
    if (window.from === 0 && window.to === source.length)
      return this.setFullTree(this.parse(source))
    const tree = this.parse(source, window)
    this.viewTree?.delete()
    this.viewTree = tree
    this.viewRange = window
    return tree
  }

  highlights(source: string, range = { from: 0, to: source.length }): Highlight[] {
    if (range.from === range.to) return []
    const tree = this.treeFor(source, range)
    const captures = this.query.captures(tree.rootNode, {
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
    this.viewTree?.delete()
    this.tree?.delete()
  }
}

// Tree-sitter asks for text at the position it is parsing, a token at a time.
// Returning whole lines keeps each copy close to what the lexer consumes. Line
// starts come from the caller, so a long line needs no repeated newline scan;
// the wasm callback buffer still caps how much one line can copy.
const MAX_CHUNK = 4096

function parseChunk(source: string, index: number, starts: number[]) {
  const next = firstAfter(starts, index)
  let end = next < starts.length ? starts[next] : source.length
  if (end - index > MAX_CHUNK) end = index + MAX_CHUNK
  if (end < source.length) {
    const code = source.charCodeAt(end)
    if (code >= 0xdc00 && code <= 0xdfff) end++
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
