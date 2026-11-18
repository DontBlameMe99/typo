import type { EditorTheme } from './document'
import type { EditorIssue } from './issues'

export type EditorConfig = {
  documentId: string
  source: string
  session: number
  theme: EditorTheme
  editable: boolean
  issues: EditorIssue[]
  template?: boolean
}

export type EditorChange = {
  from: number
  to: number
  insert: string
}

export type EditorMessage =
  | { type: 'boot' | 'ready' }
  | { type: 'back'; editing: boolean }
  | { type: 'change'; documentId: string; session: number; change: EditorChange }
  | { type: 'save'; documentId: string; session: number }
  | { type: 'painted'; documentId: string; session: number }
  | { type: 'focus'; documentId: string; session: number; focused: boolean }
  | { type: 'issue'; documentId: string; session: number; index: number }
  | { type: 'error' | 'warning'; message: string }

function session(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function change(value: unknown): value is EditorChange {
  if (!value || typeof value !== 'object') return false
  const { from, to, insert } = value as Record<string, unknown>
  return (
    typeof insert === 'string' &&
    Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    (from as number) >= 0 &&
    (to as number) >= (from as number)
  )
}

export function normalizeSource(source: string): string {
  return source.includes('\r') ? source.replace(/\r\n?/gu, '\n') : source
}

export function applyEditorChange(source: string, edit: EditorChange): string {
  if (!change(edit) || edit.to > source.length)
    throw new Error('The editor sent an invalid change.')
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
}

const fastHead = '{"type":"change","documentId":"'
const fastSession = '","session":'
const fastFrom = ',"change":{"from":'
const fastTo = ',"to":'
const fastInsert = ',"insert":"'

// Where readNumber leaves the value it read.
let digits = 0

// Reads the integer at `at` and returns the index after it, or -1 when it is
// not written the way JSON.stringify writes integers.
function readNumber(json: string, at: number): number {
  const start = at
  let code = json.charCodeAt(at)
  if (code < 48 || code > 57) return -1
  digits = 0
  do {
    digits = digits * 10 + (code - 48)
    code = json.charCodeAt(++at)
  } while (code > 47 && code < 58)
  if (at - start > 1 && json.charCodeAt(start) === 48) return -1
  return at
}

/**
 * The change message the editor sends for a plain edit, spelled the way the
 * editor writes it, or undefined for every other message: other types, escaped
 * values, other spellings of the same values, extra fields, another key order.
 * Those fall through to JSON.parse and the checks in editorMessage.
 */
function fastChange(json: string, documentId: string): EditorMessage | null | undefined {
  if (!json.startsWith(fastHead)) return undefined
  let at = fastHead.length
  if (!json.startsWith(documentId, at)) return undefined
  at += documentId.length
  if (!json.startsWith(fastSession, at)) return undefined
  at = readNumber(json, at + fastSession.length)
  if (at < 0) return undefined
  const current = digits
  if (!json.startsWith(fastFrom, at)) return undefined
  at = readNumber(json, at + fastFrom.length)
  if (at < 0) return undefined
  const from = digits
  if (!json.startsWith(fastTo, at)) return undefined
  at = readNumber(json, at + fastTo.length)
  if (at < 0) return undefined
  const to = digits
  if (!json.startsWith(fastInsert, at)) return undefined
  const start = at + fastInsert.length
  at = start
  for (;;) {
    const code = json.charCodeAt(at)
    if (code === 34) break
    if (code < 32 || code === 92 || at >= json.length) return undefined
    at++
  }
  if (at + 3 !== json.length || json.charCodeAt(at + 1) !== 125 || json.charCodeAt(at + 2) !== 125)
    return undefined
  if (!session(current)) throw new Error('Invalid editor message.')
  const edit = { from, to, insert: json.slice(start, at) }
  if (!change(edit)) throw new Error('Invalid editor message.')
  return { type: 'change', documentId, session: current, change: edit }
}

export function editorMessage(json: string, documentId: string): EditorMessage | null {
  const fast = fastChange(json, documentId)
  if (fast !== undefined) return fast
  const value: unknown = JSON.parse(json)
  if (!value || typeof value !== 'object' || !('type' in value))
    throw new Error('Invalid editor message.')
  if (value.type === 'boot' || value.type === 'ready') return { type: value.type }
  if (value.type === 'back') {
    if (!('editing' in value) || typeof value.editing !== 'boolean')
      throw new Error('Invalid editor message.')
    return { type: 'back', editing: value.editing }
  }
  if (
    (value.type === 'error' || value.type === 'warning') &&
    'message' in value &&
    typeof value.message === 'string'
  )
    return { type: value.type, message: value.message }
  if (value.type === 'issue') {
    if (
      !('documentId' in value) ||
      typeof value.documentId !== 'string' ||
      !('session' in value) ||
      !session(value.session) ||
      !('index' in value) ||
      !Number.isSafeInteger(value.index) ||
      (value.index as number) < -1
    )
      throw new Error('Invalid editor message.')
    if (value.documentId !== documentId) return null
    return {
      type: 'issue',
      documentId,
      session: value.session,
      index: value.index as number,
    }
  }
  if (
    (value.type === 'change' ||
      value.type === 'save' ||
      value.type === 'painted' ||
      value.type === 'focus') &&
    'documentId' in value &&
    typeof value.documentId === 'string' &&
    'session' in value &&
    session(value.session)
  ) {
    if (value.documentId !== documentId) return null
    if (value.type === 'change') {
      if (!('change' in value) || !change(value.change)) throw new Error('Invalid editor message.')
      return { type: 'change', documentId, session: value.session, change: value.change }
    }
    if (value.type === 'focus') {
      if (!('focused' in value) || typeof value.focused !== 'boolean')
        throw new Error('Invalid editor message.')
      return {
        type: 'focus',
        documentId,
        session: value.session,
        focused: value.focused,
      }
    }
    return { type: value.type, documentId, session: value.session }
  }
  throw new Error('Invalid editor message.')
}
