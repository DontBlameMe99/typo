import * as FileSystem from 'expo-file-system/legacy'
import { DEFAULT_TEMPLATE, extractTitle } from '../core'
import type { Note, Vault } from '../types'
import {
  createFolder,
  createNote,
  type MovedFolder,
  moveFolderToFolder,
  moveNoteToFolder,
  saveNote,
  trashFolder,
  trashNote,
} from '../vault'
import { listVaultEntries } from '../vault-native'
import { childName, folderPathForName, notePathForName, renameTitleInSource } from './lifecycle'
import { parentFolder } from './shared'

type Child = { uri: string; name: string; directory: boolean }

async function children(uri: string): Promise<Child[]> {
  const entries = await listVaultEntries(uri)
  if (entries) {
    return entries.map((entry) => ({
      uri: entry.uri,
      name: childName(entry.uri),
      directory: entry.isDirectory,
    }))
  }
  const uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(uri)
  return uris.map((uri) => ({ uri, name: childName(uri), directory: false }))
}

async function resolveFolder(vaultUri: string, path: string): Promise<Child> {
  let uri = vaultUri
  let found: Child | undefined
  for (const segment of path.split('/').filter(Boolean)) {
    found = (await children(uri)).find(
      (child) => child.name.toLowerCase() === segment.toLowerCase()
    )
    if (!found) throw new Error(`Cannot find the folder "${segment}" in this vault.`)
    uri = found.uri
  }
  if (!found) throw new Error('Cannot rename the vault root.')
  return found
}

async function assertFree(parent: string, name: string, exceptUri?: string): Promise<void> {
  const matches = (await children(parent)).some(
    (child) => child.uri !== exceptUri && child.name.toLowerCase() === name.toLowerCase()
  )
  if (matches) throw new Error(`"${name}" already exists here. Choose another name.`)
}

export async function renameVaultNote(vault: Vault, note: Note, title: string): Promise<Note> {
  const path = notePathForName(title, note.path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name === note.path.slice(note.path.lastIndexOf('/') + 1)) {
    throw new Error('Choose a different name.')
  }
  const parentPath = parentFolder(note.path)
  const parent = parentPath ? await resolveFolder(vault.uri, parentPath) : { uri: vault.uri }
  await assertFree(parent.uri, name, note.uri)
  const source = renameTitleInSource(note.source, title)
  const created = await createNote(vault, title, '', parentPath, DEFAULT_TEMPLATE)
  try {
    const saved = await saveNote(created, source)
    await trashNote(vault, note)
    return {
      ...saved,
      path,
      source,
      title: extractTitle(source, name),
      modifiedAt: null,
      pdfUri: undefined,
      pdfHash: undefined,
    }
  } catch (cause) {
    await FileSystem.deleteAsync(created.uri, { idempotent: true }).catch(() => {})
    throw cause
  }
}

export type RenamedFolder = { path: string; notes: MovedFolder['notes'] }

export async function renameVaultFolder(
  vault: Vault,
  path: string,
  name: string,
  notes: Note[],
  folders: string[]
): Promise<RenamedFolder> {
  const nextPath = folderPathForName(name, path)
  const nextName = nextPath.slice(nextPath.lastIndexOf('/') + 1)
  if (nextName === path.slice(path.lastIndexOf('/') + 1)) {
    throw new Error('Choose a different name.')
  }
  const source = await resolveFolder(vault.uri, path)
  const parentPath = parentFolder(nextPath)
  const parent = parentPath ? await resolveFolder(vault.uri, parentPath) : { uri: vault.uri }
  await assertFree(parent.uri, nextName, source.uri)
  await createFolder(vault, nextName, parentPath)
  // A failure mid-copy leaves the new folder in place: deleting it could
  // destroy notes that were already moved there.
  const renamed: MovedFolder['notes'] = []
  for (const note of notes) {
    if (parentFolder(note.path) !== path) continue
    const moved = await moveNoteToFolder(vault, note, nextPath)
    renamed.push({ uri: note.uri, nextUri: moved.uri })
  }
  for (const child of folders) {
    if (parentFolder(child) !== path) continue
    const moved = await moveFolderToFolder(vault, child, nextPath)
    renamed.push(...moved.notes)
  }
  await trashFolder(vault, path)
  return { path: nextPath, notes: renamed }
}
