import { expect, test } from 'bun:test'
import { bundle, evaluate } from './helpers/vm-module'

type QuickDraft = Record<string, string>

const root = 'file:///docs/'
const moduleSource = await bundle('src/quick-draft.ts', {
  external: ['expo-file-system', 'expo-file-system/legacy'],
})

function setup() {
  const files = new Map<string, string>()

  class File {
    constructor(readonly uri: string) {}
    get exists() {
      return files.has(this.uri)
    }
    textSync() {
      const text = files.get(this.uri)
      if (text === undefined) throw new Error(`No such file: ${this.uri}`)
      return text
    }
    async write(text: string) {
      files.set(this.uri, text)
    }
    async move(target: File, options?: { overwrite?: boolean }) {
      if (files.has(target.uri) && !options?.overwrite) throw new Error('Target exists')
      files.set(target.uri, files.get(this.uri) ?? '')
      files.delete(this.uri)
    }
  }

  const FileSystem = {
    documentDirectory: root,
    async deleteAsync(uri: string, _options: { idempotent?: boolean }) {
      files.delete(uri)
    },
  }

  const api = evaluate<{
    readQuickDraft(kind: string): QuickDraft
    saveQuickDraft(kind: string, draft: QuickDraft): Promise<void>
    clearQuickDraft(kind: string): Promise<void>
  }>(moduleSource, { 'expo-file-system': { File }, 'expo-file-system/legacy': FileSystem })
  return { api, files }
}

test('quick sheet draft restores a write from another mount', async () => {
  const { api } = setup()
  expect(api.readQuickDraft('note')).toEqual({})

  const draft = { title: 'Ideas', body: 'A thought' }
  await api.saveQuickDraft('note', draft)

  expect(api.readQuickDraft('note')).toEqual(draft)
  expect(api.readQuickDraft('append')).toEqual({})
})

test('quick sheet draft keeps the last write when keystrokes overlap', async () => {
  const { api } = setup()
  const first = api.saveQuickDraft('append', { text: 'First' })
  const second = api.saveQuickDraft('append', { text: 'Second' })
  await Promise.all([first, second])

  expect(api.readQuickDraft('append')).toEqual({ text: 'Second' })
})

test('quick sheet draft clears after a successful save', async () => {
  const { api } = setup()
  await api.saveQuickDraft('append', { text: 'Temporary' })
  await api.clearQuickDraft('append')

  expect(api.readQuickDraft('append')).toEqual({})
})
