import { type NoteSort, sortNotes } from './core'
import type { Note, SearchResult } from './types'

export type NoteRowItem = { kind: 'note'; result: SearchResult }
export type FolderRowItem = { kind: 'folder'; path: string; name: string }

export type LibraryRow =
  | { kind: 'space'; key: string; height: number }
  | { kind: 'folders'; key: string; items: FolderRowItem[] }
  | { kind: 'note'; key: string; result: SearchResult }
export type RowLayout = { length: number; offset: number }

export const SWIPE_CHIP_REVEAL = 96
export const SWIPE_CARD_REVEAL = 120
export const CHIP_HEIGHT = 54
export const CARD_HEIGHT = 96
export const ROW_GAP = 8

function rowLength(row: LibraryRow): number {
  if (row.kind === 'space') return row.height
  if (row.kind === 'folders') return CHIP_HEIGHT + ROW_GAP
  return CARD_HEIGHT + ROW_GAP
}

export function layoutRows(rows: LibraryRow[]): RowLayout[] {
  const layout: RowLayout[] = []
  let offset = 0
  for (const row of rows) {
    const length = rowLength(row)
    layout.push({ length, offset })
    offset += length
  }
  return layout
}

// The shape FlatList asks getItemLayout for: the row's layout plus its index.
export function rowLayout(layout: RowLayout[], index: number): RowLayout & { index: number } {
  return { ...layout[index], index }
}

const noteResults = new WeakMap<Note, SearchResult>()
const noteRows = new WeakMap<SearchResult, NoteRowItem>()

function noteResult(note: Note): SearchResult {
  let result = noteResults.get(note)
  if (!result) {
    result = { note }
    noteResults.set(note, result)
  }
  return result
}

// Rows keep their identity while their note does, so an edited source does not
// recreate every row and FlatList can skip cells that did not change.
export function noteRow(result: SearchResult): NoteRowItem {
  let row = noteRows.get(result)
  if (!row) {
    row = { kind: 'note', result }
    noteRows.set(result, row)
  }
  return row
}

type FolderRows = { notes: Note[]; sort: NoteSort; rows: NoteRowItem[] }

export type FolderRowsCache = Map<string, FolderRows>

// Reuses the previous rows while a folder's notes are unchanged, so toggling a
// favorite or running a search does not re-sort the folder.
export function sortedNoteRows(
  cache: FolderRowsCache,
  key: string,
  notes: Note[],
  sort: NoteSort
): NoteRowItem[] {
  const cached = cache.get(key)
  if (cached && cached.sort === sort && sameNotes(cached.notes, notes)) {
    cached.notes = notes
    return cached.rows
  }
  const rows = sortNotes(notes, sort).map((note) => noteRow(noteResult(note)))
  cache.set(key, { notes, sort, rows })
  return rows
}

function sameNotes(previous: Note[], next: Note[]): boolean {
  if (previous.length !== next.length) return false
  for (let index = 0; index < next.length; index++)
    if (previous[index] !== next[index]) return false
  return true
}
