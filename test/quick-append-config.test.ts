import { expect, test } from 'bun:test'
import { bundle, evaluate } from './helpers/vm-module'

type Target = {
  vaultUri: string
  noteUri: string
  notePath: string
  section: string
  sectionLevel: number
}

const root = 'file:///docs/'
const config = `${root}typo-quick-append.json`

const moduleSource = await bundle('src/quick-append-config.ts', {
  external: ['expo-file-system', 'expo-file-system/legacy'],
})

function setup(initial?: string) {
  const files = new Map<string, string>()
  if (initial !== undefined) files.set(config, initial)
  const operations: string[] = []
  const failures = { write: false, move: false }

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
      operations.push(`write:${this.uri}`)
      if (failures.write) throw new Error('Storage is full')
      files.set(this.uri, text)
    }
    async move(target: File, options?: { overwrite?: boolean }) {
      operations.push(`move:${this.uri}:${target.uri}:${options?.overwrite === true}`)
      if (failures.move) throw new Error('Storage is busy')
      if (files.has(target.uri) && !options?.overwrite) throw new Error('Target exists')
      files.set(target.uri, files.get(this.uri) ?? '')
      files.delete(this.uri)
    }
  }

  const FileSystem = {
    documentDirectory: root,
    async deleteAsync(uri: string, options: { idempotent?: boolean }) {
      operations.push(`delete:${uri}:${options.idempotent === true}`)
      files.delete(uri)
    },
  }

  const api = evaluate<{
    readQuickAppendTarget(): Target | null
    storeQuickAppendTarget(target: Target): Promise<void>
    clearQuickAppendTarget(): Promise<void>
    quickAppendLabel(target: Target): string
    followQuickAppendTarget(
      target: Target,
      from: { uri: string; path: string },
      to: { uri: string; path: string }
    ): Target | null
  }>(moduleSource, { 'expo-file-system': { File }, 'expo-file-system/legacy': FileSystem })
  return { api, files, operations, failures }
}

const target: Target = {
  vaultUri: 'content://com.android.externalstorage.documents/tree/primary%3ANotes',
  noteUri:
    'content://com.android.externalstorage.documents/tree/primary%3ANotes/document/primary%3ANotes%2Fdemo.typ',
  notePath: 'notes/demo.typ',
  section: 'Inbox',
  sectionLevel: 1,
}

test('quick append target round-trips through the private config file', async () => {
  const { api, files, operations } = setup()
  expect(api.readQuickAppendTarget()).toBeNull()
  await api.storeQuickAppendTarget({ ...target, section: '  Inbox  ' })
  expect(api.readQuickAppendTarget()).toEqual(target)
  expect(JSON.parse(files.get(config) ?? 'null')).toEqual(target)
  expect(operations).toEqual([`write:${config}.writing`, `move:${config}.writing:${config}:true`])
  expect(files.has(`${config}.writing`)).toBe(false)
  expect(api.quickAppendLabel(target)).toBe('notes/demo.typ › = Inbox')
})

test('quick append migrates a target saved before URIs and heading levels', () => {
  const { api } = setup(
    JSON.stringify({
      vaultUri: target.vaultUri,
      notePath: target.notePath,
      section: target.section,
    })
  )
  expect(api.readQuickAppendTarget()).toEqual({
    ...target,
    noteUri: '',
    sectionLevel: 0,
  })
})

test('quick append rejects unsafe targets and leaves the saved target intact', async () => {
  const { api } = setup(JSON.stringify(target))
  const unsafe: Target[] = [
    { ...target, vaultUri: 'https://example.com/tree/notes' },
    { ...target, vaultUri: 'content://com.android.externalstorage.documents/notes' },
    { ...target, noteUri: 'content://elsewhere/tree/notes/document/demo.typ' },
    { ...target, notePath: '/notes/demo.typ' },
    { ...target, notePath: 'notes\\demo.typ' },
    { ...target, notePath: 'notes/../demo.typ' },
    { ...target, notePath: 'notes//demo.typ' },
    { ...target, notePath: 'notes/demo.md' },
    { ...target, section: '   ' },
    { ...target, section: 'Two\nlines' },
    { ...target, sectionLevel: 7 },
  ]
  for (const value of unsafe)
    await expect(api.storeQuickAppendTarget(value)).rejects.toThrow(
      'The quick append target is invalid. Choose it again in Typo.'
    )
  expect(api.readQuickAppendTarget()).toEqual(target)
})

test('a corrupt quick append config reports the cause instead of silently choosing a target', () => {
  const { api } = setup('{not json')
  expect(() => api.readQuickAppendTarget()).toThrow('Cannot load the quick append target:')
  const invalid = setup(JSON.stringify({ ...target, notePath: '../private.typ' }))
  expect(() => invalid.api.readQuickAppendTarget()).toThrow('Cannot load the quick append target:')
})

test('clearing the target removes only the config file', async () => {
  const { api, files, operations } = setup(JSON.stringify(target))
  await api.clearQuickAppendTarget()
  expect(files.has(config)).toBe(false)
  expect(operations).toEqual([`delete:${config}:true`])
})

test('a failed staging write does not replace the previous config', async () => {
  const { api, files, failures } = setup(JSON.stringify(target))
  failures.write = true
  await expect(api.storeQuickAppendTarget({ ...target, section: 'Later' })).rejects.toThrow(
    'Storage is full'
  )
  expect(files.get(config)).toBe(JSON.stringify(target))
})

test('quick append follows a note that moves to another folder', () => {
  const { api } = setup()
  const movedUri = `${target.vaultUri}/document/primary%3ANotes%2FArchive%2Fdemo.typ`
  expect(
    api.followQuickAppendTarget(
      target,
      { uri: target.noteUri, path: target.notePath },
      { uri: movedUri, path: 'notes/Archive/demo.typ' }
    )
  ).toEqual({ ...target, noteUri: movedUri, notePath: 'notes/Archive/demo.typ' })
  expect(
    api.followQuickAppendTarget(
      target,
      { uri: `${target.noteUri}-other`, path: 'notes/other.typ' },
      { uri: movedUri, path: 'notes/Archive/demo.typ' }
    )
  ).toBeNull()
})
