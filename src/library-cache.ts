import { File } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import { fingerprint } from './compiler/fingerprint'
import {
  migrateLegacyVaultIndex,
  parseSource,
  parseVaultMetadata,
  serializeVaultMetadata,
  sourceKey,
  type VaultIndex,
  vaultSources,
} from './library-index'
import type { Vault } from './types'

const STRUCTURAL_DELAY = 300
const SOURCE_DELAY = 1500

function location(vault: Vault) {
  if (!FileSystem.cacheDirectory) throw new Error('Private cache storage is unavailable.')
  const directory = `${FileSystem.cacheDirectory}typo-library/`
  const key = fingerprint(vault.uri)
  return {
    directory,
    metadata: `${directory}${key}.json`,
    sources: `${directory}${key}-sources/`,
  }
}

function sourceLocation(vault: Vault, key: string) {
  return `${location(vault).sources}${key}.txt`
}

async function atomicWrite(uri: string, text: string): Promise<void> {
  // A launch killed mid-write must still find the previous file. The pending
  // copy is replaced by one move, so no reader sees half a cache entry.
  const pending = new File(`${uri}.writing`)
  await pending.write(text)
  await pending.move(new File(uri), { overwrite: true })
}

async function readSources(vault: Vault, keys: string[], lengths: number[]): Promise<string[]> {
  return Promise.all(
    keys.map(async (key, index) => {
      const source = parseSource(await new File(sourceLocation(vault, key)).text(), lengths[index])
      if (source === null) throw new Error(`Invalid library source cache for "${key}".`)
      return source
    })
  )
}

// The synchronous launch read touches metadata only. Sources are loaded after
// the first paint, either by loadVaultIndex or by loadVaultIndexSources.
export function loadVaultIndexSync(vault: Vault): VaultIndex | null {
  try {
    const metadata = parseVaultMetadata(new File(location(vault).metadata).textSync(), vault)
    if (!metadata) return null
    return {
      notes: metadata.notes,
      folders: metadata.folders,
      stamps: metadata.stamps,
    }
  } catch {
    return null
  }
}

export async function loadVaultIndex(vault: Vault): Promise<VaultIndex | null> {
  try {
    const text = await new File(location(vault).metadata).text()
    const metadata = parseVaultMetadata(text, vault)
    if (metadata) {
      const sources = await readSources(vault, metadata.sourceKeys, metadata.sourceLengths)
      return {
        notes: metadata.notes.map((note, index) => ({ ...note, source: sources[index] })),
        folders: metadata.folders,
        stamps: metadata.stamps,
      }
    }
    // A cache from the old single-file format is migrated by the next write.
    return migrateLegacyVaultIndex(text, vault)
  } catch {
    return null
  }
}

export async function loadVaultIndexSources(
  vault: Vault,
  index: VaultIndex
): Promise<VaultIndex | null> {
  try {
    const notes = await Promise.all(
      index.notes.map(async (note) =>
        note.source
          ? note
          : {
              ...note,
              source: await new File(sourceLocation(vault, sourceKey(note.uri))).text(),
            }
      )
    )
    return { ...index, notes }
  } catch {
    return null
  }
}

type Stored = { metadata: string; sources: Map<string, string> }
const stored = new Map<string, Stored>()

export async function storeVaultIndex(vault: Vault, library: VaultIndex): Promise<void> {
  const { directory, metadata, sources } = location(vault)
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
  await FileSystem.makeDirectoryAsync(sources, { intermediates: true })

  const metadataText = serializeVaultMetadata(vault, library)
  const sourceFiles = vaultSources(library)
  const previous = stored.get(vault.uri)
  for (const [key, source] of sourceFiles) {
    if (previous?.sources.get(key) === source && new File(`${sources}${key}.txt`).exists) continue
    await atomicWrite(`${sources}${key}.txt`, source)
  }
  await atomicWrite(metadata, metadataText)
  stored.set(vault.uri, { metadata: metadataText, sources: sourceFiles })
}

type PendingWrite = {
  library: VaultIndex
  structural: boolean
  work: () => Promise<void>
  timer: ReturnType<typeof setTimeout>
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

const pending = new Map<string, PendingWrite>()

async function runPending(key: string): Promise<void> {
  const entry = pending.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(key)
  try {
    await entry.work()
    entry.resolve()
  } catch (error) {
    entry.reject(error)
  }
}

// Structural changes go out quickly so a new folder is not lost; source-only
// edits wait longer and write only the changed source files.
export function scheduleVaultIndexWrite(
  vault: Vault,
  library: VaultIndex,
  options: { structural?: boolean } = {}
): Promise<void> {
  const key = vault.uri
  const existing = pending.get(key)
  let entry: PendingWrite
  if (existing) {
    entry = existing
  } else {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    entry = {
      library,
      structural: options.structural ?? true,
      work: () => storeVaultIndex(vault, library),
      timer: setTimeout(() => void runPending(key), 0),
      promise,
      resolve,
      reject,
    }
    pending.set(key, entry)
  }
  clearTimeout(entry.timer)
  entry.library = library
  entry.structural ||= options.structural ?? true
  entry.work = () => storeVaultIndex(vault, library)
  entry.timer = setTimeout(
    () => void runPending(key),
    entry.structural ? STRUCTURAL_DELAY : SOURCE_DELAY
  )
  return entry.promise
}

export async function flushVaultIndexWrites(): Promise<void> {
  await Promise.all([...pending.keys()].map((key) => runPending(key)))
}
