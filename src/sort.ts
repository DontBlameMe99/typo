import { File } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import { type NoteSort, noteSortValues } from './core'

const path = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}typo-sort.json` : null

const defaultSort: NoteSort = 'name-asc'

export function loadSortSync(): NoteSort {
  try {
    if (!path) return defaultSort
    const saved = JSON.parse(new File(path).textSync())
    return noteSortValues.find((sort) => sort === saved?.sort) ?? defaultSort
  } catch {
    return defaultSort
  }
}

export async function storeSort(sort: NoteSort): Promise<void> {
  if (!path) throw new Error('Sort storage is unavailable.')
  await FileSystem.writeAsStringAsync(path, JSON.stringify({ version: 1, sort }))
}
