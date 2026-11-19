import { File } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'

export type QuickAppendTarget = {
  vaultUri: string
  notePath: string
  section: string
}

function configPath(): string {
  if (!FileSystem.documentDirectory) throw new Error('Private document storage is unavailable.')
  return `${FileSystem.documentDirectory}typo-quick-append.json`
}

function validate(value: unknown): QuickAppendTarget {
  if (!value || typeof value !== 'object') throw new Error('The quick append target is invalid.')
  const target = value as Partial<QuickAppendTarget>
  if (
    typeof target.vaultUri !== 'string' ||
    !target.vaultUri.startsWith('content://') ||
    !target.vaultUri.includes('/tree/') ||
    typeof target.notePath !== 'string' ||
    target.notePath.startsWith('/') ||
    target.notePath.includes('\\') ||
    target.notePath.split('/').some((part) => !part || part === '.' || part === '..') ||
    !/\.typ$/iu.test(target.notePath) ||
    typeof target.section !== 'string' ||
    !target.section.trim() ||
    /[\r\n]/u.test(target.section)
  ) {
    throw new Error('The quick append target is invalid. Choose it again in Typo.')
  }
  return { vaultUri: target.vaultUri, notePath: target.notePath, section: target.section.trim() }
}

export function readQuickAppendTarget(): QuickAppendTarget | null {
  const file = new File(configPath())
  if (!file.exists) return null
  try {
    return validate(JSON.parse(file.textSync()))
  } catch (error) {
    throw new Error(
      `Cannot load the quick append target: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function storeQuickAppendTarget(target: QuickAppendTarget): Promise<void> {
  const next = validate(target)
  await FileSystem.writeAsStringAsync(configPath(), JSON.stringify(next))
}

export async function clearQuickAppendTarget(): Promise<void> {
  await FileSystem.deleteAsync(configPath(), { idempotent: true })
}

export function quickAppendLabel(target: QuickAppendTarget): string {
  return `${target.notePath} › ${target.section}`
}
