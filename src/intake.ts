import * as FileSystem from 'expo-file-system/legacy'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { noteFilename } from './core'
import {
  type IncomingIntent,
  type IntakeRoute,
  parseIncomingIntent,
  safeImportName,
} from './intake-parse'
import type { Vault } from './types'
import { createNote, readSavedVault, readTemplate } from './vault'

const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const SAF = FileSystem.StorageAccessFramework

type TypoIntakeModule = {
  getInitialIntent(): IncomingIntent | null
  readText(uri: string, maxBytes: number): Promise<string>
  addListener(event: 'onIntent', listener: (intent: IncomingIntent) => void): { remove(): void }
}

const nativeModule = requireOptionalNativeModule<TypoIntakeModule>('TypoIntake')

export function subscribeNativeIntents(listener: (intent: IncomingIntent) => void) {
  const subscription = nativeModule?.addListener('onIntent', listener)
  return subscription ?? { remove: () => {} }
}

export function parseNativeIntent(value: unknown): IntakeRoute | null {
  return parseIncomingIntent(value)
}

export async function initialNativeIntent(): Promise<IntakeRoute | null> {
  if (!nativeModule) return null
  try {
    return parseIncomingIntent(nativeModule.getInitialIntent())
  } catch {
    return null
  }
}

async function readSource(uri: string): Promise<string> {
  if (nativeModule) return nativeModule.readText(uri, MAX_SOURCE_BYTES)
  if (uri.startsWith('file://')) return FileSystem.readAsStringAsync(uri)
  throw new Error('This build cannot read the shared file. Share its text instead.')
}

function createdName(uri: string): string {
  const last = decodeURIComponent(uri.slice(uri.lastIndexOf('/') + 1))
  return last.includes('/') ? last.slice(last.lastIndexOf('/') + 1) : last.replace(/^[^:]*:/u, '')
}

/** Writes a shared .typ source into the vault root under a sanitized name. */
export async function importSource(vault: Vault, uri: string, name: string): Promise<string> {
  const filename = safeImportName(name)
  const existing = await SAF.readDirectoryAsync(vault.uri)
  if (existing.some((child) => createdName(child).toLowerCase() === filename.toLowerCase())) {
    throw new Error(`A note named "${filename}" already exists in the vault.`)
  }
  const source = await readSource(uri)
  const created = await SAF.createFileAsync(vault.uri, filename, 'application/octet-stream')
  if (createdName(created).toLowerCase() !== filename.toLowerCase()) {
    await FileSystem.deleteAsync(created, { idempotent: true }).catch(() => {})
    throw new Error('The file provider would not create the requested note name.')
  }
  try {
    await FileSystem.writeAsStringAsync(created, source)
  } catch (cause) {
    await FileSystem.deleteAsync(created, { idempotent: true }).catch(() => {})
    throw cause
  }
  return filename
}

/** Creates a note from shared text using the vault template. */
export async function createSharedNote(vault: Vault, title: string, body: string): Promise<string> {
  const safeTitle = !title || title.toLowerCase() === 'template' ? 'Shared note' : title
  const filename = noteFilename(safeTitle)
  const template = await readTemplate(vault).catch(() => undefined)
  const note = await createNote(vault, safeTitle, body, '', template)
  return note.path || filename
}

/** Carries a route to the library's one-line intake hook. */
const listeners = new Set<(route: IntakeRoute) => void>()

export function subscribeIntake(listener: (route: IntakeRoute) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishIntake(route: IntakeRoute): void {
  for (const listener of [...listeners]) listener(route)
}

/** Applies a parsed route to the saved vault, then notifies the library. */
export async function applyIntakeRoute(route: IntakeRoute): Promise<void> {
  if (route.kind === 'note') {
    publishIntake(route)
    return
  }
  const vault = await readSavedVault()
  if (!vault) throw new Error('Choose a notes folder in Typo first.')
  if (route.kind === 'new') await createSharedNote(vault, route.title, route.body)
  else await importSource(vault, route.uri, route.name)
  publishIntake(route)
}
