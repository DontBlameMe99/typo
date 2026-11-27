const MAX_URL = 4096
const MAX_TEXT = 100_000
const MAX_NAME = 180
const MAX_PATH = 512
const TYPST_TYPES = new Set([
  'application/x-typst',
  'application/typst',
  'text/x-typst',
  'text/typst',
])
const UNSAFE_PATH = /[\\\p{Cc}]/u

export type IncomingIntent = {
  action?: string | null
  url?: string | null
  type?: string | null
  text?: string | null
  subject?: string | null
  name?: string | null
}

export type IntakeRoute =
  | { kind: 'import'; uri: string; name: string }
  | { kind: 'note'; path: string }
  | { kind: 'new'; title: string; body: string }

function text(value: unknown, limit: number): string {
  return typeof value === 'string' && value.length <= limit ? value : ''
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** Turns an Android intent into one of the intake routes Typo supports. */
export function parseIncomingIntent(value: unknown): IntakeRoute | null {
  if (!value || typeof value !== 'object') return null
  const intent = value as IncomingIntent
  const action = text(intent.action, 80).split('.').pop()
  const url = text(intent.url, MAX_URL)
  const type = text(intent.type, 120).toLowerCase()
  const body = text(intent.text, MAX_TEXT)
  const subject = text(intent.subject, MAX_TEXT)
  const rawName = text(intent.name, MAX_NAME) || nameFromUri(url)
  const name = safeImportName(rawName)

  if (action === 'VIEW') {
    if (url.startsWith('typo://')) return parseDeepLink(url)
    if (!isSourceUri(url, type, rawName)) return null
    return { kind: 'import', uri: url, name }
  }

  if (action === 'SEND') {
    if (body || subject) return { kind: 'new', title: sharedTitle(subject || body), body }
    if (!isSourceUri(url, type, rawName)) return null
    return { kind: 'import', uri: url, name }
  }

  return null
}

/** Parses the three typo:// routes the app handles. */
export function parseDeepLink(url: string): IntakeRoute | null {
  if (typeof url !== 'string' || !url.startsWith('typo://') || url.length > MAX_URL) return null
  const withoutHash = url.split('#', 1)[0]
  const rest = withoutHash.slice('typo://'.length)
  const slash = rest.indexOf('/')
  const host = (slash === -1 ? rest : rest.slice(0, slash)).split('?', 1)[0].toLowerCase()
  const path = slash === -1 ? null : decoded(rest.slice(slash + 1).split('?', 1)[0])
  const query = queryOf(rest)

  if (host === 'note' || host === 'open') {
    const target = path || query.get('path') || ''
    const safe = safeNotePath(target)
    return safe ? { kind: 'note', path: safe } : null
  }

  if (host === 'import') {
    const uri = query.get('uri') ?? ''
    if (!/^content:\/\//iu.test(uri) || uri.length > MAX_URL) return null
    const name = query.get('name') ?? ''
    return { kind: 'import', uri, name: safeImportName(name) }
  }

  if (host === 'new') {
    const body = query.get('text') ?? ''
    if (!body) return null
    return { kind: 'new', title: sharedTitle(query.get('subject') ?? body), body }
  }

  return null
}

function queryOf(value: string): Map<string, string> {
  const result = new Map<string, string>()
  const index = value.indexOf('?')
  if (index === -1) return result
  for (const pair of value.slice(index + 1).split('&')) {
    const separator = pair.indexOf('=')
    const key = separator === -1 ? pair : pair.slice(0, separator)
    const raw = separator === -1 ? '' : pair.slice(separator + 1)
    const decodedValue = decoded(raw.replace(/\+/gu, ' '))
    if (decodedValue !== null) result.set(key, decodedValue)
  }
  return result
}

/** Validates a vault-relative note path and gives it a .typ name. */
export function safeNotePath(value: string): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_PATH) return null
  if (value.startsWith('/') || UNSAFE_PATH.test(value)) return null
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' || part.startsWith('.')) return null
    parts.push(part)
  }
  if (!parts.length) return null
  const path = parts.join('/')
  return /\.typ$/iu.test(path) ? path : `${path}.typ`
}

/** Sanitizes an incoming document name without trusting the provider. */
export function safeImportName(value: unknown): string {
  let name = typeof value === 'string' ? value.slice(0, MAX_NAME * 2) : ''
  if (!name) return 'shared.typ'
  name = decoded(name) ?? name
  name = name.split(/[\\/]/u).pop() ?? ''
  name = name.replace(/^\.+/u, '')
  name = name.replace(/[^\p{L}\p{N}._ -]/gu, '_').trim()
  if (!name || name === '.' || name === '..') return 'shared.typ'
  const stem = name.replace(/\.typ$/iu, '').slice(0, MAX_NAME - 4)
  if (!stem) return 'shared.typ'
  return `${stem}.typ`
}

/** Turns shared text into a short, filename-safe title. */
export function sharedTitle(value: string): string {
  const firstLine = value.split(/\r?\n/u, 1)[0]
  const title = firstLine
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 60)
    .replace(/^\.+|[.]+$/gu, '')
    .trim()
  return title || 'Shared note'
}

function nameFromUri(uri: string): string {
  const last = uri.split(/[?#]/u, 1)[0].split('/').pop() ?? ''
  const name = decoded(last) ?? last
  return /\.typ$/iu.test(name) ? name : ''
}
function isSourceUri(uri: string, type: string, name: string): boolean {
  if (!/^(?:content|file):\/\//iu.test(uri)) return false
  const baseType = type.split(';', 1)[0].trim()
  if (TYPST_TYPES.has(baseType)) return true
  if (/\.typ$/iu.test(name) || /\.typ$/iu.test(uri.split(/[?#]/u, 1)[0])) return true
  return baseType === 'application/octet-stream'
}
