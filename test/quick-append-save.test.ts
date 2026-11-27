import { expect, test } from 'bun:test'
import { bundle, evaluate } from './helpers/vm-module'

const vaultUri = 'content://com.android.externalstorage.documents/tree/primary%3ANotes'
const noteUri = `${vaultUri}/document/primary%3ANotes%2Fdemo.typ`
const source = await bundle('src/vault.ts', {
  external: ['expo-file-system', 'expo-file-system/legacy', 'expo-modules-core'],
})

function setup(initial = '= Inbox\n-\n') {
  const files = new Map<string, string>([[noteUri, initial]])
  const operations: string[] = []

  class Directory {
    constructor(readonly uri: string) {}
    get exists() {
      return false
    }
  }
  class File {
    constructor(readonly uri: string) {}
    get exists() {
      return files.has(this.uri)
    }
    get size() {
      const text = files.get(this.uri)
      return text === undefined ? null : Buffer.byteLength(text)
    }
    info() {
      return { exists: this.exists, modificationTime: 1700000000000, size: this.size }
    }
    async bytes() {
      return Buffer.from(files.get(this.uri) ?? '', 'utf8')
    }
    async copy(target: File, options?: { overwrite?: boolean }) {
      if (files.has(target.uri) && !options?.overwrite) throw new Error('Target exists')
      files.set(target.uri, files.get(this.uri) ?? '')
    }
    async move(target: File, options?: { overwrite?: boolean }) {
      if (files.has(target.uri) && !options?.overwrite) throw new Error('Target exists')
      files.set(target.uri, files.get(this.uri) ?? '')
      files.delete(this.uri)
    }
    open() {
      const path = this.uri
      return {
        async writeBytes(bytes: Uint8Array) {
          operations.push(`truncate:${path}`)
          files.set(path, Buffer.from(bytes).toString('utf8'))
        },
        close() {
          operations.push(`close:${path}`)
        },
      }
    }
  }
  const FileMode = { Truncate: 'truncate' }
  const FileSystem = {
    documentDirectory: 'file:///docs/',
    cacheDirectory: 'file:///cache/',
    StorageAccessFramework: {
      async readDirectoryAsync(uri: string) {
        operations.push(`list:${uri}`)
        return uri === vaultUri ? [noteUri] : []
      },
    },
    async makeDirectoryAsync(uri: string, _options?: { intermediates?: boolean }) {
      operations.push(`mkdir:${uri}`)
    },
    async writeAsStringAsync(uri: string, text: string) {
      operations.push(`stage:${uri}`)
      files.set(uri, text)
    },
    async deleteAsync(uri: string, _options?: { idempotent?: boolean }) {
      operations.push(`unlink:${uri}`)
      files.delete(uri)
    },
  }
  const native = {
    listChildren: async () => null,
    readText: async (uri: string) => files.get(uri) ?? '',
    readBase64: async () => '',
  }
  const api = evaluate<{
    appendToNoteAtPath(
      vault: { uri: string; name: string },
      path: string,
      section: string,
      text: string
    ): Promise<{ source: string; path: string; modifiedAt: number | null }>
  }>(source, {
    'expo-file-system': { Directory, File, FileMode },
    'expo-file-system/legacy': FileSystem,
    'expo-modules-core': { requireOptionalNativeModule: () => native },
    Buffer,
  })
  return { api, files, operations }
}

const vault = { uri: vaultUri, name: 'Notes' }

test('quick append writes the merged note through a staged replacement', async () => {
  const { api, files, operations } = setup()
  const note = await api.appendToNoteAtPath(vault, 'demo.typ', 'Inbox', 'First entry')
  expect(note.path).toBe('demo.typ')
  expect(note.source).toBe('= Inbox\n- First entry\n')
  expect(files.get(noteUri)).toBe('= Inbox\n- First entry\n')
  expect(operations.filter((call) => call.startsWith('stage:'))).toHaveLength(1)
  expect(operations).toContain('mkdir:file:///cache/typo-backups/')
  expect(
    operations.some(
      (call) => call.startsWith('unlink:file:///cache/typo-backups/') && call.endsWith('.bak')
    )
  ).toBe(true)
  expect(operations.some((call) => call.startsWith('unlink:file:///cache/typo-save-'))).toBe(true)
})

test('concurrent quick append saves keep both entries', async () => {
  const { api, files } = setup()
  const [first, second] = await Promise.all([
    api.appendToNoteAtPath(vault, 'demo.typ', 'Inbox', 'First entry'),
    api.appendToNoteAtPath(vault, 'demo.typ', 'Inbox', 'Second entry'),
  ])
  expect(first.source).toBe('= Inbox\n- First entry\n')
  expect(second.source).toBe('= Inbox\n- First entry\n- Second entry\n')
  expect(files.get(noteUri)).toBe(second.source)
})

test('a quick append to an unknown section leaves the saved note untouched', async () => {
  const { api, files, operations } = setup()
  await expect(api.appendToNoteAtPath(vault, 'demo.typ', 'Archive', 'Lost entry')).rejects.toThrow(
    'The section "Archive" was not found. The note was left unchanged.'
  )
  expect(files.get(noteUri)).toBe('= Inbox\n-\n')
  expect(operations.filter((call) => call.startsWith('truncate:'))).toEqual([])
})
