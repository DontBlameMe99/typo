import { File } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'

export type QuickDraftKind = 'note' | 'append'
export type QuickDraft = Record<string, string>

function draftPath(kind: QuickDraftKind): string {
  if (!FileSystem.documentDirectory) throw new Error('Private document storage is unavailable.')
  return `${FileSystem.documentDirectory}typo-quick-${kind}-draft.json`
}

export function readQuickDraft(kind: QuickDraftKind): QuickDraft {
  const file = new File(draftPath(kind))
  if (!file.exists) return {}
  try {
    const value: unknown = JSON.parse(file.textSync())
    if (!value || typeof value !== 'object') return {}
    const draft: QuickDraft = {}
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') draft[key] = item
    }
    return draft
  } catch {
    return {}
  }
}

let writes = Promise.resolve()

export function saveQuickDraft(kind: QuickDraftKind, draft: QuickDraft): Promise<void> {
  const write = writes.then(async () => {
    const target = new File(draftPath(kind))
    const pending = new File(`${draftPath(kind)}.writing`)
    await pending.write(JSON.stringify(draft))
    await pending.move(target, { overwrite: true })
  })
  writes = write.catch(() => {})
  return write
}
export async function clearQuickDraft(kind: QuickDraftKind): Promise<void> {
  const clear = writes.then(() => FileSystem.deleteAsync(draftPath(kind), { idempotent: true }))
  writes = clear.catch(() => {})
  await clear
}
