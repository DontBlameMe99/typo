import { markStartup } from './startup'
import type { ThemeSettings } from './theme-data'
import { defaultThemeSettings, parseThemeSettings } from './theme-data'
import { fileAt, path } from './theme-storage-io'

export const restoreError = 'Could not restore appearance. Choose your settings again to save them.'
export const saveError =
  'Appearance could not be saved. Your selection still applies for this session.'

type ThemeSnapshot = { settings: ThemeSettings; error: string | null }

export function readTheme(): ThemeSnapshot {
  markStartup('theme')
  try {
    if (!path) throw new Error('Appearance storage is unavailable.')
    const file = fileAt(path)
    if (!file.exists) return { settings: defaultThemeSettings, error: null }
    return { settings: parseThemeSettings(JSON.parse(file.textSync())), error: null }
  } catch {
    return { settings: defaultThemeSettings, error: restoreError }
  }
}

async function persist(settings: ThemeSettings): Promise<void> {
  if (!path) throw new Error('Appearance storage is unavailable.')
  // Keep the last good settings readable until the new file is fully written.
  const pending = fileAt(`${path}.writing`)
  await pending.write(JSON.stringify(settings))
  await pending.move(fileAt(path), { overwrite: true })
}

let pendingWrite: Promise<void> = Promise.resolve()

export function writeTheme(settings: ThemeSettings): Promise<void> {
  pendingWrite = pendingWrite.then(
    () => persist(settings),
    () => persist(settings)
  )
  return pendingWrite
}
