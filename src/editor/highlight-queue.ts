import type { ChangeSet, Text } from '@codemirror/state'
import type { EditorChange } from './protocol'
import type { Highlight } from './syntax'

export type HighlightRequest = {
  type: 'highlight'
  id: number
  source?: string
  changes?: EditorChange[]
  range: { from: number; to: number }
}

export type HighlightResponse =
  | { type: 'ready' }
  | { type: 'highlights'; id: number; ranges: Highlight[] }
  | { type: 'error'; message: string }

type Pending = {
  id: number
  doc: Text
  range: { from: number; to: number }
  changes: ChangeSet | null
  apply(ranges: Highlight[]): void
}

function changeList(set: ChangeSet, doc: Text): EditorChange[] {
  const changes: EditorChange[] = []
  set.iterChanges((fromA, toA, fromB, toB) =>
    changes.push({ from: fromA, to: toA, insert: doc.sliceString(fromB, toB) })
  )
  return changes
}

export class HighlightQueue {
  private sequence = 0
  private booted = false
  private disposed = false
  private active: Pending | null = null
  private pending: Pending | null = null
  private sent: Text | null = null

  constructor(private send: (request: HighlightRequest) => void) {}

  ready() {
    this.booted = true
    this.pump()
  }

  request(doc: Text, range: Pending['range'], apply: Pending['apply'], changes?: ChangeSet) {
    if (this.disposed) return
    let carried = changes ?? null
    if (this.pending) {
      if (this.pending.changes && carried) carried = this.pending.changes.compose(carried)
      else if (!carried && doc !== this.pending.doc) carried = null
      else carried = this.pending.changes
    }
    this.pending = { id: ++this.sequence, doc, range, changes: carried, apply }
    this.pump()
  }

  complete(id: number, ranges: Highlight[]) {
    if (this.disposed || this.active?.id !== id) return
    const active = this.active
    this.active = null
    if (id === this.sequence) active.apply(ranges)
    this.pump()
  }

  dispose() {
    this.disposed = true
    this.pending = null
    this.active = null
    this.sent = null
  }

  private pump() {
    if (this.disposed || !this.booted || this.active || !this.pending) return
    const next = this.pending
    this.pending = null
    this.active = next
    const request: HighlightRequest = {
      type: 'highlight',
      id: next.id,
      range: next.range,
    }
    if (next.doc !== this.sent) {
      if (next.changes && this.sent) request.changes = changeList(next.changes, next.doc)
      else request.source = next.doc.toString()
    }
    this.send(request)
    this.sent = next.doc
  }
}
