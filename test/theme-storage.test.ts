import { beforeEach, expect, mock, test } from 'bun:test'
import { defaultThemeSettings } from '../src/theme-data'

const documentDirectory = 'file:///private/documents/'
const path = `${documentDirectory}typo-appearance.json`
let stored: string | null = null
let writeError: Error | undefined
let writeGate: Promise<void> | null = null
let releaseGate: (() => void) | undefined
const opened: string[] = []
const writes: string[] = []

mock.module('expo-file-system', () => ({
  FileMode: { Truncate: 'wt' },
  File: class {
    constructor(private uri: string) {
      opened.push(uri)
    }
    get exists() {
      return stored !== null
    }
    textSync() {
      return stored ?? ''
    }
  },
  Directory: class {
    constructor(private uri: string) {}
    get exists() {
      return this.uri === documentDirectory
    }
  },
}))

mock.module('expo-file-system/legacy', () => ({
  documentDirectory,
  writeAsStringAsync: mock(async (uri: string, source: string) => {
    expect(uri).toBe(path)
    writes.push(source)
    if (writeGate) await writeGate
    if (writeError) throw writeError
  }),
}))

const { readTheme, restoreError, saveError, writeTheme } = await import('../src/theme-storage')

beforeEach(() => {
  stored = null
  writeError = undefined
  writeGate = null
  releaseGate = undefined
  opened.length = 0
  writes.length = 0
})

test('returns defaults when the appearance file is missing', () => {
  expect(readTheme()).toEqual({ settings: defaultThemeSettings, error: null })
  expect(opened).toEqual([path])
})

test('reads and migrates saved settings', () => {
  stored = JSON.stringify({
    mode: 'dark',
    accent: 'teal',
    lightFlavor: 'frappe',
    darkFlavor: 'latte',
  })
  expect(readTheme()).toEqual({
    settings: {
      ...defaultThemeSettings,
      mode: 'dark',
      accent: 'teal',
      darkFlavor: 'mocha',
    },
    error: null,
  })
})

test('reports a corrupt appearance file', () => {
  stored = '{'
  expect(readTheme()).toEqual({ settings: defaultThemeSettings, error: restoreError })
  expect(restoreError).toBe(
    'Could not restore appearance. Choose your settings again to save them.'
  )
})

test('rejects when the write fails', async () => {
  writeError = new Error('denied')
  await expect(writeTheme({ ...defaultThemeSettings, accent: 'teal' })).rejects.toThrow('denied')
  expect(saveError).toBe(
    'Appearance could not be saved. Your selection still applies for this session.'
  )
})

test('writes serialized settings in call order', async () => {
  writeGate = new Promise<void>((resolve) => {
    releaseGate = resolve
  })
  const teal = { ...defaultThemeSettings, accent: 'teal' as const }
  const blue = { ...defaultThemeSettings, accent: 'blue' as const }

  const first = writeTheme(teal)
  await Bun.sleep(0)
  expect(writes).toHaveLength(1)
  const second = writeTheme(blue)
  await Bun.sleep(0)
  expect(writes).toHaveLength(1)

  releaseGate?.()
  await Promise.all([first, second])
  expect(writes).toEqual([JSON.stringify(teal), JSON.stringify(blue)])
})
