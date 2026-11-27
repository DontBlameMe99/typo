import { fingerprint } from './compiler/fingerprint'
import type { Note, Vault } from './types'

// Metadata and sources live in separate files. The launch reads only metadata,
// so a large vault does not put every source into a synchronous native read.
const VERSION = 5
const LEGACY_VERSION = 4

export type VaultIndex = {
  notes: Note[]
  folders: string[]
  stamps?: (string | null)[]
}

export type VaultMetadata = {
  notes: Note[]
  folders: string[]
  stamps: (string | null)[]
  sourceKeys: string[]
  sourceLengths: number[]
}

const encoder = new TextEncoder()

export function sourceKey(uri: string): string {
  return fingerprint(uri)
}

// A provider stamp includes both the modification time and the byte size, so a
// same-length rewrite with the same time still reads as unchanged only when the
// size is also unchanged.
export function sourceStamp(modifiedAt: number | null, source: string): string | null {
  if (modifiedAt === null || !Number.isFinite(modifiedAt)) return null
  return `${modifiedAt}:${encoder.encode(source).length}`
}

function validNote(value: unknown, vault: Vault): value is Note {
  if (!value || typeof value !== 'object') return false
  const note = value as Partial<Note>
  return (
    typeof note.path === 'string' &&
    typeof note.uri === 'string' &&
    note.uri.startsWith(`${vault.uri}/document/`) &&
    typeof note.title === 'string' &&
    (note.modifiedAt === null ||
      (typeof note.modifiedAt === 'number' && Number.isFinite(note.modifiedAt))) &&
    (note.pdfUri === undefined || typeof note.pdfUri === 'string') &&
    (note.pdfHash === undefined || typeof note.pdfHash === 'string') &&
    (note.sharedHash === undefined || typeof note.sharedHash === 'string')
  )
}

export function parseVaultMetadata(text: string, vault: Vault): VaultMetadata | null {
  try {
    const value = JSON.parse(text) as {
      version?: unknown
      vault?: unknown
      notes?: unknown
      folders?: unknown
      stamps?: unknown
      sourceKeys?: unknown
      sourceLengths?: unknown
    }
    if (value.version !== VERSION || value.vault !== vault.uri) return null
    const { notes, folders, stamps, sourceKeys, sourceLengths } = value
    if (
      !Array.isArray(notes) ||
      !Array.isArray(folders) ||
      !Array.isArray(stamps) ||
      !Array.isArray(sourceKeys) ||
      !Array.isArray(sourceLengths) ||
      notes.length !== stamps.length ||
      notes.length !== sourceKeys.length ||
      notes.length !== sourceLengths.length
    )
      return null
    for (let index = 0; index < folders.length; index++)
      if (typeof folders[index] !== 'string') return null
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index]
      if (!validNote(note, vault)) return null
      // Metadata must never carry source text: it is the file the launch parses.
      if (note.source !== '' && note.source !== undefined) return null
      note.source = ''
      if (typeof sourceKeys[index] !== 'string') return null
      if (!Number.isInteger(sourceLengths[index]) || (sourceLengths[index] as number) < 0)
        return null
      const stamp = stamps[index]
      if (stamp !== null && typeof stamp !== 'string') return null
    }
    return {
      notes: notes as Note[],
      folders: folders as string[],
      stamps: stamps as (string | null)[],
      sourceKeys: sourceKeys as string[],
      sourceLengths: sourceLengths as number[],
    }
  } catch {
    return null
  }
}

export function serializeVaultMetadata(vault: Vault, library: VaultIndex): string {
  return JSON.stringify({
    version: VERSION,
    vault: vault.uri,
    folders: library.folders,
    notes: library.notes.map((note) => ({ ...note, source: '' })),
    stamps: library.notes.map((note) => sourceStamp(note.modifiedAt, note.source)),
    sourceKeys: library.notes.map((note) => sourceKey(note.uri)),
    sourceLengths: library.notes.map((note) => note.source.length),
  })
}

export function vaultSources(library: VaultIndex): Map<string, string> {
  const sources = new Map<string, string>()
  for (const note of library.notes) sources.set(sourceKey(note.uri), note.source)
  return sources
}

export function parseSource(text: string, length: number): string | null {
  return text.length === length ? text : null
}

// The previous cache kept sources in one file behind a header line. It is only
// read to migrate an existing launch cache, never on the cold-start path.
type LegacyHeader = {
  notes: Note[]
  folders: string[]
  lengths: number[]
  offset: number
}

function readLegacyHeader(text: string, vault: Vault): LegacyHeader | null {
  const end = text.indexOf('\n')
  if (end < 0) return null
  try {
    const value = JSON.parse(text.slice(0, end)) as Record<string, unknown>
    if (value.version !== LEGACY_VERSION || value.vault !== vault.uri) return null
    const notes = value.notes
    const folders = value.folders
    const lengths = value.sourceLengths
    if (!Array.isArray(notes) || !Array.isArray(folders) || !Array.isArray(lengths)) return null
    if (lengths.length !== notes.length) return null
    for (let index = 0; index < folders.length; index++)
      if (typeof folders[index] !== 'string') return null
    return {
      notes: notes as Note[],
      folders: folders as string[],
      lengths: lengths as number[],
      offset: end + 1,
    }
  } catch {
    return null
  }
}

export function parseVaultIndex(text: string, vault: Vault): VaultIndex | null {
  const header = readLegacyHeader(text, vault)
  if (!header) return null
  const prefix = `${vault.uri}/document/`
  let offset = header.offset
  try {
    for (let index = 0; index < header.notes.length; index++) {
      const note = header.notes[index]
      const length = header.lengths[index]
      if (
        !validNote(note, vault) ||
        !note.uri.startsWith(prefix) ||
        typeof note.source !== 'string' ||
        !Number.isInteger(length) ||
        (length as number) < 0
      )
        return null
      note.source = text.slice(offset, offset + (length as number))
      offset += length as number
    }
    if (offset !== text.length) return null
    return { notes: header.notes, folders: header.folders }
  } catch {
    return null
  }
}

export function migrateLegacyVaultIndex(text: string, vault: Vault): VaultIndex | null {
  const library = parseVaultIndex(text, vault)
  if (!library) return null
  return {
    ...library,
    stamps: library.notes.map((note) => sourceStamp(note.modifiedAt, note.source)),
  }
}

export function serializeVaultIndex(vault: Vault, library: VaultIndex): string {
  const lengths = library.notes.map((note) => note.source.length)
  const header = JSON.stringify({
    version: LEGACY_VERSION,
    vault: vault.uri,
    folders: library.folders,
    notes: library.notes.map((note) => ({ ...note, source: '' })),
    sourceLengths: lengths,
  })
  return `${header}\n${library.notes.map((note) => note.source).join('')}`
}
