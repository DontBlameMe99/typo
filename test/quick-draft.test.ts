import { describe, expect, mock, test } from 'bun:test'

const files = new Map<string, string>()

mock.module('expo-file-system', () => ({
  FileMode: { Truncate: 'wt' },
  Directory: class {
    get exists() {
      return false
    }
  },
  File: class {
    constructor(private uri: string) {}
    get exists() {
      return files.has(this.uri)
    }
    textSync() {
      const value = files.get(this.uri)
      if (value === undefined) throw new Error(`No such file: ${this.uri}`)
      return value
    }
    async write(source: string) {
      files.set(this.uri, source)
    }
    async move(destination: { uri: string }, options?: { overwrite?: boolean }) {
      if (files.has(destination.uri) && !options?.overwrite) throw new Error('Already exists')
      files.set(destination.uri, files.get(this.uri) ?? '')
      files.delete(this.uri)
    }
  },
}))

mock.module('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///private/documents/',
  deleteAsync: async (uri: string) => {
    files.delete(uri)
  },
}))

const { clearQuickDraft, readQuickDraft, saveQuickDraft } = await import('../src/quick-draft')

describe('quick sheet drafts', () => {
  test('restores a draft written on another mount', async () => {
    files.clear()
    expect(readQuickDraft('note')).toEqual({})

    await saveQuickDraft('note', { title: 'Ideas', body: 'A thought' })

    expect(readQuickDraft('note')).toEqual({ title: 'Ideas', body: 'A thought' })
    expect(files.has('file:///private/documents/typo-quick-note-draft.json.writing')).toBe(false)
  })

  test('keeps the last write when keystrokes overlap', async () => {
    files.clear()
    const first = saveQuickDraft('append', { text: 'First' })
    const second = saveQuickDraft('append', { text: 'Second' })
    await Promise.all([first, second])

    expect(readQuickDraft('append')).toEqual({ text: 'Second' })
  })

  test('clears the draft after a successful save', async () => {
    files.clear()
    await saveQuickDraft('append', { text: 'Temporary' })
    await clearQuickDraft('append')

    expect(readQuickDraft('append')).toEqual({})
  })
})
