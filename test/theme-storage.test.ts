import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { defaultThemeSettings } from '../src/theme-data'

const uri = 'file:///documents/typo-appearance.json'
const pendingUri = `${uri}.writing`
const files = new Map<string, string>()
let failWrite = false
let failMove = false

class FakeFile {
  constructor(private readonly path: string) {}

  get exists() {
    return files.has(this.path)
  }

  textSync() {
    const source = files.get(this.path)
    if (source === undefined) throw new Error(`No such file: ${this.path}`)
    return source
  }

  async write(source: string) {
    if (failWrite) throw new Error('Disk full')
    files.set(this.path, source)
  }

  async move(destination: FakeFile, options?: { overwrite?: boolean }) {
    if (failMove) throw new Error('Move failed')
    if (files.has(destination.path) && !options?.overwrite) throw new Error('Already exists')
    const source = files.get(this.path)
    if (source === undefined) throw new Error(`No such file: ${this.path}`)
    files.set(destination.path, source)
    files.delete(this.path)
  }
}

mock.module('../src/theme-storage-io', () => ({
  fileAt: (path: string) => new FakeFile(path),
  path: uri,
}))

const { readTheme, restoreError, writeTheme } = await import('../src/theme-storage')

const settings = { ...defaultThemeSettings, accent: 'yellow' as const }

beforeEach(() => {
  files.clear()
  failWrite = false
  failMove = false
})

describe('theme persistence', () => {
  test('writes through a pending file and replaces the saved settings', async () => {
    await writeTheme(settings)
    expect(files.get(pendingUri)).toBeUndefined()
    expect(JSON.parse(files.get(uri) ?? '')).toEqual(settings)
    expect(readTheme().settings).toEqual(settings)
  })

  test('failed writes leave the previous settings readable', async () => {
    await writeTheme(defaultThemeSettings)
    const saved = files.get(uri)

    failWrite = true
    await expect(writeTheme(settings)).rejects.toThrow('Disk full')
    expect(files.get(uri)).toBe(saved)
    expect(readTheme().settings).toEqual(defaultThemeSettings)

    failWrite = false
    await writeTheme(settings)
    expect(files.get(pendingUri)).toBeUndefined()
    expect(readTheme().settings).toEqual(settings)
  })

  test('a failed move does not corrupt the saved settings', async () => {
    await writeTheme(defaultThemeSettings)
    const saved = files.get(uri)

    failMove = true
    await expect(writeTheme(settings)).rejects.toThrow('Move failed')
    expect(files.get(uri)).toBe(saved)
    expect(JSON.parse(files.get(pendingUri) ?? '')).toEqual(settings)

    failMove = false
    await writeTheme(settings)
    expect(files.get(pendingUri)).toBeUndefined()
    expect(readTheme().settings).toEqual(settings)
  })

  test('reports an unreadable settings file', () => {
    files.set(uri, '{not json')
    expect(readTheme()).toEqual({ settings: defaultThemeSettings, error: restoreError })
  })
})
