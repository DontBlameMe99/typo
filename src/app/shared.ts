import type { NoteSort } from '../core'
import type { IconName } from '../icons'
import type { FolderRowItem } from '../library-rows'
import type { Note, SearchResult } from '../types'
import type { TrashedNote } from '../vault'

export type NoteSession = SearchResult & {
  session: number
  opening?: boolean
  openError?: string
  created?: boolean
}
export type FolderEntry = { path: string; name: string }
export type LibraryNotice = {
  id: number
  icon: IconName
  title: string
  body?: string
}
export type MovingItem =
  | { kind: 'note'; result: SearchResult }
  | { kind: 'folder'; entry: FolderEntry }
export type TrashUndo = {
  noticeId: number
  item: MovingItem
  favorites: string[]
  notes: Note[]
  folders: string[]
  result: Promise<TrashedNote | null>
}
export type RowAction = 'favorite' | 'trash'
export const warmNote: Note = { uri: '', path: '', title: '', source: '', modifiedAt: null }
export const EMPTY_NOTES: Note[] = []
export const EMPTY_FOLDERS: FolderRowItem[] = []

export const noteSorts = [
  {
    key: 'name',
    label: 'Name',
    ascending: 'A → Z',
    descending: 'Z → A',
    ascValue: 'name-asc',
    descValue: 'name-desc',
    defaultValue: 'name-asc',
  },
  {
    key: 'modified',
    label: 'Modified',
    ascending: 'Oldest first',
    descending: 'Newest first',
    ascValue: 'modified-asc',
    descValue: 'modified-desc',
    defaultValue: 'modified-desc',
  },
] as const satisfies readonly {
  key: string
  label: string
  ascending: string
  descending: string
  ascValue: NoteSort
  descValue: NoteSort
  defaultValue: NoteSort
}[]
export const SWIPE_SPRING = { damping: 26, mass: 0.7, overshootClamping: true, stiffness: 330 }
// The pane tucks this far under the row so its colour fills the rounded
// corner notch instead of leaving a plain strip of the row surface.
export const PANE_OVERLAP = 16

// The library list starts this far down, and inside a folder the parent row
// comes first. getItemLayout has to count both.
export const LIBRARY_LIST_TOP = 16
export const LIBRARY_PARENT_HEIGHT = 44
// The settings button's frame, which the logo's swap also fills.
export const MARK_SIZE = 60

export const keyboardBehavior = 'padding'

export function parentFolder(path: string): string {
  const end = path.lastIndexOf('/')
  return end === -1 ? '' : path.slice(0, end)
}

export function folderName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function folderPathLabel(path: string, vaultName: string): string {
  if (!path) return vaultName
  const parts = path.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

export function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'
