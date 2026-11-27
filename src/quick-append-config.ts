import { File } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'

export type QuickAppendTarget = {
  vaultUri: string
  noteUri: string
  notePath: string
  section: string
  sectionLevel: number
}

type TargetFile = Partial<QuickAppendTarget> & { [key: string]: unknown }

function configPath(): string {
  if (!FileSystem.documentDirectory) throw new Error('Private document storage is unavailable.')
  return `${FileSystem.documentDirectory}typo-quick-append.json`
}

function safeNotePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((part) => part && part !== '.' && part !== '..') &&
    /\.typ$/iu.test(path)
  )
}

// Targets saved before notes carried a URI or a heading level get empty
// markers. The sheet fills them in from the note it resolves and writes the
// upgraded target back.
function validate(value: unknown): QuickAppendTarget {
  if (!value || typeof value !== 'object') throw new Error('The quick append target is invalid.')
  const target = value as TargetFile
  const section = typeof target.section === 'string' ? target.section.trim() : ''
  if (
    typeof target.vaultUri !== 'string' ||
    !target.vaultUri.startsWith('content://') ||
    !target.vaultUri.includes('/tree/') ||
    (typeof target.noteUri !== 'undefined' &&
      (typeof target.noteUri !== 'string' ||
        (!!target.noteUri &&
          (!target.noteUri.startsWith(`${target.vaultUri}/document/`) ||
            target.noteUri === target.vaultUri)) ||
        /[\r\n]/u.test(target.noteUri))) ||
    !safeNotePath(target.notePath) ||
    !section ||
    /[\r\n]/u.test(section) ||
    (typeof target.sectionLevel !== 'undefined' &&
      (!Number.isInteger(target.sectionLevel) ||
        target.sectionLevel < 0 ||
        target.sectionLevel > 6))
  ) {
    throw new Error('The quick append target is invalid. Choose it again in Typo.')
  }
  return {
    vaultUri: target.vaultUri,
    noteUri: target.noteUri ?? '',
    notePath: target.notePath,
    section,
    sectionLevel: target.sectionLevel ?? 0,
  }
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
  const pending = new File(`${configPath()}.writing`)
  await pending.write(JSON.stringify(next))
  await pending.move(new File(configPath()), { overwrite: true })
}

export async function clearQuickAppendTarget(): Promise<void> {
  await FileSystem.deleteAsync(configPath(), { idempotent: true })
}

export function quickAppendLabel(target: QuickAppendTarget): string {
  const level = target.sectionLevel > 0 ? `${'='.repeat(target.sectionLevel)} ` : ''
  return `${target.notePath} › ${level}${target.section}`
}

export function followQuickAppendTarget(
  target: QuickAppendTarget,
  from: { uri: string; path: string },
  to: { uri: string; path: string }
): QuickAppendTarget | null {
  const matches = target.noteUri
    ? target.noteUri === from.uri || target.notePath === from.path
    : target.notePath === from.path
  return matches ? { ...target, noteUri: to.uri, notePath: to.path } : null
}
