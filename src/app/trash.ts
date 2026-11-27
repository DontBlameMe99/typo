import * as FileSystem from 'expo-file-system/legacy'
import type { Vault } from '../types'
import { listVaultEntries } from '../vault-native'
import { childName, trashOriginalPath } from './lifecycle'

export type TrashedItem = {
  uri: string
  path: string
  name: string
  originalPath: string
  directory: boolean
}

type Entry = { uri: string; name: string; directory: boolean }

async function entries(uri: string): Promise<Entry[]> {
  const listed = await listVaultEntries(uri)
  if (listed) {
    return listed.map((entry) => ({
      uri: entry.uri,
      name: childName(entry.uri),
      directory: entry.isDirectory,
    }))
  }
  const uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(uri)
  return uris.map((child) => ({
    uri: child,
    name: childName(child),
    directory: false,
  }))
}

export async function trashRoot(vault: Vault): Promise<string | null> {
  const match = (await entries(vault.uri)).find((entry) => entry.name === '.trash')
  return match?.uri ?? null
}

export async function listTrashedItems(vault: Vault): Promise<TrashedItem[]> {
  const root = await trashRoot(vault)
  if (!root) return []
  const found: TrashedItem[] = []
  const walk = async (uri: string, path: string, depth: number) => {
    if (depth > 8 || found.length >= 200) return
    for (const entry of await entries(uri)) {
      if (entry.name.startsWith('.') || found.length >= 200) continue
      const childPath = path ? `${path}/${entry.name}` : entry.name
      if (entry.directory) {
        // Mirrored folders hold a trashed item's old location. A stamped folder
        // is itself the trashed item.
        if (trashOriginalPath(childPath) !== childPath) {
          found.push({
            uri: entry.uri,
            path: childPath,
            name: trashOriginalPath(entry.name),
            originalPath: trashOriginalPath(childPath),
            directory: true,
          })
        } else await walk(entry.uri, childPath, depth + 1)
      } else if (/\.typ$/iu.test(entry.name)) {
        found.push({
          uri: entry.uri,
          path: childPath,
          name: trashOriginalPath(entry.name),
          originalPath: trashOriginalPath(childPath),
          directory: false,
        })
      }
    }
  }
  await walk(root, '', 0)
  return found.sort((a, b) => a.originalPath.localeCompare(b.originalPath))
}

export async function emptyTrash(vault: Vault): Promise<void> {
  const root = await trashRoot(vault)
  if (!root) return
  await FileSystem.deleteAsync(root, { idempotent: true })
}
