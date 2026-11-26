import type { NoteSort } from '../core'
import {
  type FolderRowItem,
  type FolderRowsCache,
  type LibraryRow,
  layoutRows,
  ROW_GAP,
  type RowLayout,
  rowLayout,
  sortedNoteRows,
} from '../library-rows'
import type { Note } from '../types'
import { EMPTY_FOLDERS, EMPTY_NOTES, LIBRARY_LIST_TOP, LIBRARY_PARENT_HEIGHT } from './shared'

export type LibraryView = {
  path: string
  current: boolean
  rows: LibraryRow[]
  getItemLayout: (_: unknown, index: number) => RowLayout & { index: number }
  empty: boolean
}

export function buildLibraryViews(
  folderStack: string[],
  folder: string,
  foldersByParent: Map<string, FolderRowItem[]>,
  notesByFolder: Map<string, Note[]>,
  favoritePaths: Set<string>,
  folderRows: FolderRowsCache,
  sort: NoteSort
): LibraryView[] {
  return folderStack.map((path) => {
    const current = path === folder
    const childFolders = foldersByParent.get(path) ?? EMPTY_FOLDERS
    const favoriteFolders = childFolders.filter((entry) => favoritePaths.has(entry.path))
    const restFolders = childFolders.filter((entry) => !favoritePaths.has(entry.path))
    const sorted = sortedNoteRows(folderRows, path, notesByFolder.get(path) ?? EMPTY_NOTES, sort)
    const pinned = sorted.filter((row) => favoritePaths.has(row.result.note.path))
    const notes = sorted.filter((row) => !favoritePaths.has(row.result.note.path))
    const rows: LibraryRow[] = []
    const orderedFolders = [...favoriteFolders, ...restFolders]
    if (orderedFolders.length > 0 || sorted.length > 0) {
      rows.push({ kind: 'space', key: 'space:top', height: 6 })
    }
    let separated = false
    if (orderedFolders.length > 0) {
      for (let index = 0; index < orderedFolders.length; index += 2) {
        rows.push({
          kind: 'folders',
          key: `folders:${path}:${index}`,
          items: orderedFolders.slice(index, index + 2),
        })
      }
      separated = true
    }
    if (pinned.length > 0) {
      if (separated) rows.push({ kind: 'space', key: 'space:pinned', height: 14 })
      for (const row of pinned) {
        rows.push({ kind: 'note', key: `pinned:${row.result.note.uri}`, result: row.result })
      }
      separated = true
    }
    if (notes.length > 0) {
      if (separated) rows.push({ kind: 'space', key: 'space:notes', height: 14 })
      for (const row of notes) {
        rows.push({ kind: 'note', key: `note:${row.result.note.uri}`, result: row.result })
      }
    }
    const layout = layoutRows(rows)
    const above = LIBRARY_LIST_TOP + (path ? LIBRARY_PARENT_HEIGHT + ROW_GAP : 0)
    return {
      path,
      current,
      rows,
      getItemLayout: (_: unknown, index: number) => {
        const frame = rowLayout(layout, index)
        return { ...frame, offset: frame.offset + above }
      },
      empty: orderedFolders.length === 0 && sorted.length === 0,
    }
  })
}
