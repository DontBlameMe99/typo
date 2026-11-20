import { expect, test } from 'bun:test'
import { EditorState, Text } from '@codemirror/state'
import {
  HighlightQueue,
  type HighlightRequest,
  type HighlightResponse,
} from '../src/editor/highlight-queue'
import type { Highlight } from '../src/editor/syntax'

const range = { from: 0, to: 10 }

test('highlighting waits for worker startup and keeps only the latest document', () => {
  const sent: HighlightRequest[] = []
  const queue = new HighlightQueue((request) => sent.push(request))
  queue.request(Text.of(['old']), range, () => {})
  queue.request(Text.of(['new 📝']), range, () => {})
  expect(sent).toHaveLength(0)
  queue.ready()
  expect(sent).toEqual([{ type: 'highlight', id: 2, source: 'new 📝', range }])
})

test('highlighting allows one active request, coalesces edits, and ignores stale results', () => {
  const sent: HighlightRequest[] = []
  const applied: Highlight[][] = []
  const queue = new HighlightQueue((request) => sent.push(request))
  queue.ready()
  queue.request(Text.of(['first']), range, (ranges) => applied.push(ranges))
  queue.request(Text.of(['skipped']), range, (ranges) => applied.push(ranges))
  queue.request(Text.of(['latest']), range, (ranges) => applied.push(ranges))
  expect(sent).toHaveLength(1)
  queue.complete(1, [{ from: 0, to: 2, style: 'number' }])
  expect(applied).toEqual([])
  expect(sent.map((request) => request.source)).toEqual(['first', 'latest'])
  queue.complete(1, [])
  expect(sent).toHaveLength(2)
  queue.complete(3, [])
  expect(applied).toEqual([[]])
})

test('scrolling does not transfer the same document again', () => {
  const sent: HighlightRequest[] = []
  const queue = new HighlightQueue((request) => sent.push(request))
  const doc = Text.of(['#let x = 42', '// comment'])
  queue.ready()
  queue.request(doc, range, () => {})
  queue.complete(1, [])
  queue.request(doc, { from: 10, to: doc.length }, () => {})
  expect(sent[1]).toEqual({
    type: 'highlight',
    id: 2,
    range: { from: 10, to: doc.length },
  })
})

test('edits transfer only the change after the first document', () => {
  const sent: HighlightRequest[] = []
  const queue = new HighlightQueue((request) => sent.push(request))
  const before = Text.of(['hello'])
  const after = Text.of(['hello!'])
  const changes = EditorState.create({ doc: before }).update({
    changes: { from: 5, insert: '!' },
  }).changes
  queue.ready()
  queue.request(before, range, () => {})
  queue.complete(1, [])
  queue.request(after, range, () => {}, changes)
  expect(sent[1]).toEqual({
    type: 'highlight',
    id: 2,
    range,
    changes: [{ from: 5, to: 5, insert: '!' }],
  })
})

test('coalesced edits send one change list in reverse order', () => {
  const sent: HighlightRequest[] = []
  const queue = new HighlightQueue((request) => sent.push(request))
  const before = Text.of(['abc'])
  const first = EditorState.create({ doc: before }).update({ changes: { from: 1, insert: 'X' } })
  const second = first.state.update({ changes: { from: 4, insert: 'Y' } })
  queue.ready()
  queue.request(before, range, () => {})
  queue.request(first.state.doc, range, () => {}, first.changes)
  queue.request(second.state.doc, range, () => {}, second.changes)
  queue.complete(1, [])
  const changes = sent[1].changes ?? []
  let source = before.toString()
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index]
    source = source.slice(0, change.from) + change.insert + source.slice(change.to)
  }
  expect(source).toBe('aXbcY')
})

test('disposed highlighting drops callbacks and queued work', () => {
  const sent: HighlightRequest[] = []
  const queue = new HighlightQueue((request) => sent.push(request))
  queue.ready()
  queue.request(Text.of(['first']), range, () => {
    throw new Error('stale callback')
  })
  queue.request(Text.of(['next']), range, () => {
    throw new Error('stale callback')
  })
  queue.dispose()
  queue.complete(1, [])
  queue.request(Text.of(['closed']), range, () => {})
  queue.ready()
  expect(sent).toHaveLength(1)
})

test('the real editor worker parses edits and reuses source for viewport-only requests', async () => {
  const worker = new Worker(new URL('../src/editor/worker.ts', import.meta.url).href)
  const ask = (request: object) => {
    const response = new Promise<HighlightResponse>((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data)
      worker.onerror = (event) => reject(new Error(event.message))
    })
    worker.postMessage(request)
    return response
  }
  try {
    expect(
      await ask({
        type: 'init',
        runtime: new Uint8Array(
          await Bun.file('node_modules/web-tree-sitter/web-tree-sitter.wasm').arrayBuffer()
        ),
        grammar: new Uint8Array(
          await Bun.file('node_modules/@lumis-sh/wasm-typst/tree-sitter-typst.wasm').arrayBuffer()
        ),
      })
    ).toEqual({ type: 'ready' })
    const source = '#let emoji = "📝"\n// A comment\n#let x = 42'
    const first = await ask({
      type: 'highlight',
      id: 1,
      source,
      range: { from: 0, to: source.length },
    })
    if (first.type !== 'highlights') throw new Error(`Unexpected response: ${first.type}`)
    for (const style of ['keyword', 'string', 'comment', 'number'])
      expect(first.ranges.some((item) => item.style === style)).toBe(true)
    const viewport = { from: 20, to: source.length }
    const scrolled = await ask({ type: 'highlight', id: 2, range: viewport })
    if (scrolled.type !== 'highlights') throw new Error(`Unexpected response: ${scrolled.type}`)
    expect(scrolled.ranges).toEqual(
      first.ranges
        .map((item) => ({ ...item, from: Math.max(item.from, viewport.from) }))
        .filter((item) => item.from < item.to)
    )
    const edited = `${source.slice(0, -2)}// Changed`
    const editedRange = { from: 0, to: edited.length }
    const viaChange = await ask({
      type: 'highlight',
      id: 3,
      changes: [{ from: source.length - 2, to: source.length, insert: '// Changed' }],
      range: editedRange,
    })
    if (viaChange.type !== 'highlights') throw new Error(`Unexpected response: ${viaChange.type}`)
    const fresh = await ask({ type: 'highlight', id: 4, source: edited, range: editedRange })
    if (fresh.type !== 'highlights') throw new Error(`Unexpected response: ${fresh.type}`)
    expect(viaChange.ranges).toEqual(fresh.ranges)
    const changed = await ask({
      type: 'highlight',
      id: 5,
      source: '// New note 📝',
      range: { from: 0, to: 14 },
    })
    if (changed.type !== 'highlights') throw new Error(`Unexpected response: ${changed.type}`)
    expect(changed.ranges).toEqual([{ from: 0, to: 14, style: 'comment' }])
  } finally {
    worker.terminate()
  }
}, 10000)
