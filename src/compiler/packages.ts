import * as FileSystem from 'expo-file-system/legacy'
import { sha256 } from '../hash'
import { type PackageSpec, packageKey } from './protocol'

// The package server publishes no digest for a package archive, so a download
// cannot be checked against the server. The local digest and size verify that a
// cached archive is the complete file we downloaded.
export const PACKAGE_DOWNLOAD_TIMEOUT_MS = 30_000
const ARCHIVE_LIMIT = 32 * 1024 * 1024
let sequence = 0

type Metadata = { key: string; digest: string; size: number }

async function readArchive(uri: string): Promise<{ base64: string; size: number }> {
  const info = await FileSystem.getInfoAsync(uri)
  if (!info.exists || info.size > ARCHIVE_LIMIT)
    throw new Error('A Typst package is missing or exceeds the 32 MiB archive limit.')
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' })
  if (!base64.startsWith('H4sI'))
    throw new Error('The package server returned an invalid archive. Try generating the PDF again.')
  return { base64, size: info.size }
}

async function readCached(uri: string, metadataUri: string, key: string): Promise<string | null> {
  if (!(await FileSystem.getInfoAsync(uri)).exists) return null
  try {
    const { base64, size } = await readArchive(uri)
    const metadata: Metadata = JSON.parse(await FileSystem.readAsStringAsync(metadataUri))
    if (metadata.key !== key || metadata.size !== size || metadata.digest !== sha256(base64))
      throw new Error('The cached archive does not match its metadata.')
    return base64
  } catch {
    await Promise.all([
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}),
      FileSystem.deleteAsync(metadataUri, { idempotent: true }).catch(() => {}),
    ])
    return null
  }
}

async function download(url: string, staging: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = FileSystem.downloadAsync(url, staging)
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // FileSystem has no download cancellation. Remove a late write as well.
      void attempt.then(() => FileSystem.deleteAsync(staging, { idempotent: true })).catch(() => {})
      reject(
        new Error(`The package download timed out after ${PACKAGE_DOWNLOAD_TIMEOUT_MS / 1000}s.`)
      )
    }, PACKAGE_DOWNLOAD_TIMEOUT_MS)
  })
  try {
    return await Promise.race([attempt, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function packageArchive(spec: PackageSpec): Promise<string> {
  const key = packageKey(spec)
  if (spec.namespace !== 'preview')
    throw new Error(
      `Place @${spec.namespace}/${spec.name}:${spec.version} in packages/${key} inside your notes folder.`
    )
  if (!FileSystem.documentDirectory) throw new Error('Private package storage is unavailable.')
  const directory = `${FileSystem.documentDirectory}typo-packages/`
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
  const uri = `${directory}${spec.name}-${spec.version}.tar.gz`
  const metadataUri = `${uri}.json`
  const cached = await readCached(uri, metadataUri, key)
  if (cached) return cached
  const staging = `${uri}.${Date.now()}-${++sequence}.tmp`
  try {
    const result = await download(
      `https://packages.typst.org/preview/${spec.name}-${spec.version}.tar.gz`,
      staging
    )
    if (result.status !== 200) throw new Error(`Package server returned ${result.status}.`)
    const { base64, size } = await readArchive(staging)
    if (!(await FileSystem.getInfoAsync(uri)).exists)
      await FileSystem.moveAsync({ from: staging, to: uri })
    const metadata: Metadata = { key, digest: sha256(base64), size }
    await FileSystem.writeAsStringAsync(metadataUri, JSON.stringify(metadata))
    return base64
  } catch (cause) {
    throw new Error(
      `Cannot download @preview/${spec.name}:${spec.version}. Connect to the internet for its first use. ${cause instanceof Error ? cause.message : ''}`
    )
  } finally {
    await FileSystem.deleteAsync(staging, { idempotent: true }).catch(() => {})
    await FileSystem.deleteAsync(`${staging}.json`, { idempotent: true }).catch(() => {})
  }
}
