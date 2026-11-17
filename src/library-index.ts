import type { Note, Vault } from './types'

// The launch cache stores the whole library, sources and folders included, so
// the first frame matches the vault before the first scan finishes. Keep the
// format pure and free of native imports so benchmarks can measure the launch
// path.
//
// The first line is a JSON header: the library without sources plus the
// character length of every source. The sources follow it as raw text in note
// order, so the header holds every field the first frame sorts and paints, and
// each source is a slice of the text that was read anyway. Escaping and
// re-parsing megabytes of source on launch is most of the cost of that frame.
const VERSION = 4

export type VaultIndex = {
  notes: Note[]
  folders: string[]
}

export function parseVaultIndex(text: string, vault: Vault): VaultIndex | null {
  const end = text.indexOf('\n')
  // A header line always precedes the sources. Anything else is a cache written
  // by another build or a truncated file, which reads as no cache and rebuilds
  // by scanning the vault.
  if (end < 0) return null
  try {
    const value = JSON.parse(text.slice(0, end))
    if (value.version !== VERSION || value.vault !== vault.uri) return null
    const notes: Note[] = value.notes
    const folders: string[] = value.folders
    const lengths: number[] = value.sourceLengths
    if (!Array.isArray(notes) || !Array.isArray(folders) || !Array.isArray(lengths)) return null
    if (lengths.length !== notes.length) return null
    for (let index = 0; index < folders.length; index++)
      if (typeof folders[index] !== 'string') return null
    const prefix = `${vault.uri}/document/`
    let offset = end + 1
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index]
      const length = lengths[index]
      if (
        !note ||
        typeof note.path !== 'string' ||
        typeof note.uri !== 'string' ||
        !note.uri.startsWith(prefix) ||
        typeof note.source !== 'string' ||
        typeof note.title !== 'string' ||
        !Number.isInteger(length) ||
        length < 0
      )
        return null
      note.source = text.slice(offset, offset + length)
      offset += length
    }
    // The lengths must describe the sources exactly. A shorter or longer tail
    // means the file was written by something that does not share this format.
    if (offset !== text.length) return null
    return { notes, folders }
  } catch {
    return null
  }
}

export function serializeVaultIndex(vault: Vault, library: VaultIndex): string {
  const lengths = new Array<number>(library.notes.length)
  let sources = ''
  for (let index = 0; index < library.notes.length; index++) {
    const source = library.notes[index].source
    lengths[index] = source.length
    sources += source
  }
  const header = JSON.stringify({
    version: VERSION,
    vault: vault.uri,
    folders: library.folders,
    notes: library.notes.map((note) => ({ ...note, source: '' })),
    sourceLengths: lengths,
  })
  return `${header}\n${sources}`
}
