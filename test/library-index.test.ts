import { describe, expect, test } from 'bun:test'
import {
  migrateLegacyVaultIndex,
  parseSource,
  parseVaultIndex,
  parseVaultMetadata,
  serializeVaultIndex,
  serializeVaultMetadata,
  vaultSources,
} from '../src/library-index'
import type { Note, Vault } from '../src/types'

const vault: Vault = {
  uri: 'content://com.android.externalstorage.documents/tree/primary%3AVault',
  name: 'Vault',
}

const VERSION = 4

function note(path: string, source = '#title[Note]\n'): Note {
  return {
    uri: `${vault.uri}/document/${encodeURIComponent(`primary:Vault/${path}`)}`,
    path,
    title: 'Note',
    source,
    modifiedAt: 1,
  }
}

// The cache is a JSON header line followed by the raw sources. Building the
// header by hand lets a test reach the field checks that a valid file passes.
function cache(header: Record<string, unknown>, sources = ''): string {
  return `${JSON.stringify(header)}\n${sources}`
}

function header(notes: unknown, folders: unknown, sourceLengths: unknown) {
  return { version: VERSION, vault: vault.uri, notes, folders, sourceLengths }
}

// Notes arrive from the header without their source, which the tail supplies.
function bare(path: string): Note {
  return { ...note(path, ''), source: '' }
}

describe('vault index', () => {
  test('round trips notes with their sources, folders, and PDF metadata', () => {
    const library = {
      notes: [
        note('a.typ', '#title[A]'),
        { ...note('b.typ', '#title[B]'), pdfUri: 'content://pdf', pdfHash: 'abc' },
      ],
      folders: ['', 'data', 'uni'],
    }
    expect(parseVaultIndex(serializeVaultIndex(vault, library), vault)).toEqual(library)
  })

  test('round trips sources that are not JSON-safe', () => {
    const source = '"quoted" \\backslash\\ \ttab\nnewline 📝 \u0000 nul\r\n'
    const library = { notes: [note('a.typ', source)], folders: [''] }
    const parsed = parseVaultIndex(serializeVaultIndex(vault, library), vault)
    expect(parsed?.notes[0].source).toBe(source)
  })

  test('rejects another format version or vault', () => {
    const text = serializeVaultIndex(vault, { notes: [note('a.typ')], folders: [''] })
    expect(
      parseVaultIndex(text.replace(`"version":${VERSION}`, `"version":${VERSION - 1}`), vault)
    ).toBeNull()
    expect(parseVaultIndex(text, { ...vault, uri: `${vault.uri}/other` })).toBeNull()
  })

  test('rejects a cache written before the header format', () => {
    const older = JSON.stringify({
      version: 3,
      vault: vault.uri,
      notes: [note('a.typ')],
      folders: [''],
    })
    expect(parseVaultIndex(older, vault)).toBeNull()
  })

  test('rejects notes from another vault and malformed entries', () => {
    const foreign = { ...bare('a.typ'), uri: 'content://other/document/a.typ' }
    expect(parseVaultIndex(cache(header([foreign], [''], [0])), vault)).toBeNull()
    expect(
      parseVaultIndex(cache(header([{ ...bare('a.typ'), source: 1 }], [''], [0])), vault)
    ).toBeNull()
    expect(
      parseVaultIndex(cache(header([{ ...bare('a.typ'), path: 1 }], [''], [0])), vault)
    ).toBeNull()
    expect(
      parseVaultIndex(cache(header([{ ...bare('a.typ'), title: null }], [''], [0])), vault)
    ).toBeNull()
    expect(parseVaultIndex(cache(header([null], [''], [0])), vault)).toBeNull()
    expect(parseVaultIndex(cache(header(null, [''], [0])), vault)).toBeNull()
    expect(parseVaultIndex(cache(header([], null, [])), vault)).toBeNull()
    expect(parseVaultIndex(cache(header([], [1], [])), vault)).toBeNull()
    expect(parseVaultIndex(cache(header([], [null], [])), vault)).toBeNull()
  })

  test('rejects lengths that do not describe the sources exactly', () => {
    const one = [bare('a.typ')]
    const check = (lengths: unknown, sources: string) =>
      parseVaultIndex(cache(header(one, [''], lengths), sources), vault)
    expect(check(undefined, '')).toBeNull()
    expect(check(null, '')).toBeNull()
    expect(check([], '')).toBeNull()
    expect(check([0, 0], '')).toBeNull()
    expect(check([-1], '')).toBeNull()
    expect(check([1.5], 'ab')).toBeNull()
    expect(check(['0'], '')).toBeNull()
    expect(check([0], 'extra')).toBeNull()
    expect(check([2], 'a')).toBeNull()
    expect(check([0], '')).toEqual({ notes: [note('a.typ', '')], folders: [''] })
  })

  test('rejects invalid JSON and an empty library', () => {
    expect(parseVaultIndex('not JSON', vault)).toBeNull()
    expect(parseVaultIndex('', vault)).toBeNull()
    expect(parseVaultIndex('null', vault)).toBeNull()
    expect(parseVaultIndex('5', vault)).toBeNull()
    expect(parseVaultIndex(`${JSON.stringify({ version: VERSION })}\n`, vault)).toBeNull()
    expect(
      parseVaultIndex(serializeVaultIndex(vault, { notes: [], folders: [''] }), vault)
    ).toEqual({ notes: [], folders: [''] })
  })
})

describe('split launch metadata', () => {
  const library = { notes: [note('a.typ', '#title[A]\n')], folders: [''] }

  test('keeps source text out of metadata and loads it from a separate file', () => {
    const text = serializeVaultMetadata(vault, library)
    expect(text).not.toContain('#title[A]')
    const metadata = parseVaultMetadata(text, vault)
    expect(metadata?.notes).toEqual([note('a.typ', '')])
    expect(metadata?.folders).toEqual([''])
    const keys = [...vaultSources(library).keys()]
    expect(keys).toHaveLength(1)
    expect(parseSource('#title[A]\n', metadata?.sourceLengths[0] ?? -1)).toBe('#title[A]\n')
    expect(parseSource('short', metadata?.sourceLengths[0] ?? -1)).toBeNull()
  })

  test('rejects an old cache and metadata that carries source text', () => {
    const legacy = serializeVaultIndex(vault, library)
    expect(parseVaultMetadata(legacy, vault)).toBeNull()
    const text = serializeVaultMetadata(vault, library)
    expect(parseVaultMetadata(text.replace('"version":5', '"version":4'), vault)).toBeNull()
    expect(parseVaultMetadata(text, { ...vault, uri: `${vault.uri}/other` })).toBeNull()
    expect(
      parseVaultMetadata(
        JSON.stringify({
          version: 5,
          vault: vault.uri,
          folders: [''],
          notes: [{ ...note('a.typ', ''), source: '#title[A]' }],
          stamps: [null],
          sourceKeys: ['key'],
          sourceLengths: [0],
        }),
        vault
      )
    ).toBeNull()
  })

  test('migrates the old single-file cache with source stamps', () => {
    const migrated = migrateLegacyVaultIndex(serializeVaultIndex(vault, library), vault)
    expect(migrated?.notes).toEqual(library.notes)
    expect(migrated?.stamps).toEqual(['1:10'])
  })
})
