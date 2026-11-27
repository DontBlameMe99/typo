import { noteFilename, notePreview } from '../core'
import type { Note } from '../types'
import { parentFolder } from './shared'

const MAX_FOLDER_BYTES = 120
const TRASH_STAMP = /\.(\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-\d+)?)(?=\.typ$|$)/u

export function notePathForName(title: string, currentPath: string): string {
  const filename = noteFilename(title)
  const parent = parentFolder(currentPath)
  if (!parent && filename.toLowerCase() === 'template.typ') {
    throw new Error('The name "template.typ" is reserved for the vault template.')
  }
  return parent ? `${parent}/${filename}` : filename
}

export function folderNameValue(value: string): string {
  const name = value.normalize('NFC').trim()
  if (!name) throw new Error('Give the folder a name.')
  if (
    name.startsWith('.') ||
    /[/\\:*?"<>|\p{Cc}]/u.test(name) ||
    name.endsWith('.') ||
    encodeURIComponent(name).replace(/%[A-F\d]{2}/gu, '_').length > MAX_FOLDER_BYTES
  ) {
    throw new Error('Use a folder name without slashes, hidden names, or filename punctuation.')
  }
  return name
}

export function folderPathForName(name: string, currentPath: string): string {
  const parent = parentFolder(currentPath)
  const next = folderNameValue(name)
  return parent ? `${parent}/${next}` : next
}

export function renameTitleInSource(source: string, title: string): string {
  const start = /#title\s*\[/u.exec(source)
  if (!start) return source
  let depth = 1
  let end = -1
  for (let index = start.index + start[0].length; index < source.length; index++) {
    if (source[index] === '\\') {
      index++
      continue
    }
    if (source[index] === '[') depth++
    if (source[index] === ']') depth--
    if (depth === 0) {
      end = index
      break
    }
  }
  if (end < 0) return source
  const escaped = title.trim().replace(/[\\#[\]*_$@<>`~]/gu, '\\$&')
  return `${source.slice(0, start.index + start[0].length)}${escaped}${source.slice(end)}`
}

export function noteMetadataKey(notes: readonly Note[]): string {
  let key = ''
  for (const note of notes) {
    // The card renders these fields. Raw source that changes outside the
    // preview and hidden PDF state does not invalidate the library rows.
    key += `${note.uri}\u0000${note.path}\u0000${note.title}\u0000${notePreview(note)}\u0000${note.modifiedAt ?? ''}\u0001`
  }
  return key
}

export function trashOriginalPath(path: string): string {
  const segments = path.split('/').filter((segment) => segment !== '.trash' && segment !== '')
  if (!segments.length) return ''
  segments[segments.length - 1] = segments[segments.length - 1].replace(TRASH_STAMP, '')
  return segments.join('/')
}

export function childName(uri: string): string {
  const encoded = uri.slice(uri.lastIndexOf('/') + 1)
  const decoded = decodeURIComponent(encoded)
  const name = decoded.includes('/')
    ? decoded.slice(decoded.lastIndexOf('/') + 1)
    : decoded.replace(/^[^:]*:/u, '')
  if (!name || name === '.' || name === '..' || /[/\\\p{Cc}]/u.test(name)) {
    throw new Error('The document provider returned an unsupported document name.')
  }
  return name
}
