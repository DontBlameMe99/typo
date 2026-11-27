import { describe, expect, test } from 'bun:test'
import { buildFavoriteView, buildLibraryViews, folderStackFor } from '../src/app/library-view'
import type { FolderRowsCache } from '../src/library-rows'
import { makeNote } from './helpers/note'

const notes = [
  makeNote({ uri: 'content://one', path: 'notes/one.typ', title: 'One', source: '= One' }),
  makeNote({ uri: 'content://two', path: 'archive/two.typ', title: 'Two', source: '= Two' }),
  makeNote({ uri: 'content://three', path: 'plain.typ', title: 'Three', source: '= Three' }),
]

const foldersByParent = new Map([
  ['', [{ kind: 'folder' as const, path: 'notes', name: 'notes' }]],
  ['notes', [{ kind: 'folder' as const, path: 'notes/archive', name: 'archive' }]],
])
const notesByFolder = new Map([
  ['notes', [notes[0]]],
  ['archive', [notes[1]]],
  ['', [notes[2]]],
])

describe('buildFavoriteView', () => {
  test('collects pinned notes and folders from across the vault', () => {
    const favorites = new Set(['notes/one.typ', 'archive/two.typ', 'notes'])
    const view = buildFavoriteView(
      ['', 'notes', 'notes/archive'],
      notes,
      favorites,
      new Map() as FolderRowsCache,
      'name-asc'
    )
    const folderRows = view.rows.filter((row) => row.kind === 'folders')
    const noteRows = view.rows.filter((row) => row.kind === 'note')
    expect(folderRows).toHaveLength(1)
    expect(folderRows[0]).toMatchObject({ items: [{ path: 'notes' }] })
    expect(noteRows.map((row) => row.kind === 'note' && row.result.note.path)).toEqual([
      'notes/one.typ',
      'archive/two.typ',
    ])
    expect(view.empty).toBe(false)
  })

  test('is empty when nothing is pinned and keeps layouts in sync', () => {
    const cache: FolderRowsCache = new Map()
    const view = buildFavoriteView([], notes, new Set(), cache, 'name-asc')
    expect(view.empty).toBe(true)
    expect(view.rows).toEqual([])
  })
})
describe('folderStackFor', () => {
  test('builds a stack from a globally picked folder', () => {
    expect(folderStackFor('')).toEqual([''])
    expect(folderStackFor('notes/archive')).toEqual(['', 'notes', 'notes/archive'])
  })
})

describe('buildLibraryViews', () => {
  test('keeps unpinned notes in their folders when favorites are set', () => {
    const views = buildLibraryViews(
      ['', 'notes'],
      'notes',
      foldersByParent,
      notesByFolder,
      new Set(['notes']),
      new Map() as FolderRowsCache,
      'name-asc'
    )
    const current = views.find((view) => view.path === 'notes')
    const notePaths = current?.rows
      .filter((row) => row.kind === 'note')
      .map((row) => row.kind === 'note' && row.result.note.path)
    expect(notePaths).toEqual(['notes/one.typ'])
    expect(views.map((view) => view.current)).toEqual([false, true])
  })
})
