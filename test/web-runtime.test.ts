import { expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { bundle, evaluate } from './helpers/vm-module'

const cache = 'file:///cache/'

type Runtime = {
  webRuntime(kind: 'editor' | 'compiler' | 'pdf' | 'search'): Promise<string>
}

const source = await bundle('src/web-runtime.ts', {
  external: ['expo-asset', 'expo-file-system/legacy'],
  plugins: [
    {
      name: 'web-runtime-test-assets',
      setup(builder: Bun.PluginBuilder) {
        const stub = (args: { path: string }) => ({ path: args.path, namespace: 'runtime-asset' })
        builder.onResolve({ filter: /\.\.\/dist\/.*/u }, stub)
        builder.onResolve({ filter: /\.(?:wasm|ttf|otf)$/u }, stub)
        builder.onLoad({ filter: /.*/u, namespace: 'runtime-asset' }, () => ({
          contents: 'module.exports = "fabricated asset"',
          loader: 'js',
        }))
      },
    },
  ],
})

function setup(missing: (uri: string) => boolean = () => false) {
  const calls: string[] = []
  const files = new Set<string>()
  const FileSystem = {
    cacheDirectory: cache,
    async getInfoAsync(uri: string) {
      calls.push(`info:${uri}`)
      return { exists: !missing(uri), uri, isDirectory: false }
    },
    async makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }) {
      calls.push(`mkdir:${uri}:${options?.intermediates === true}`)
      files.add(uri)
    },
    async deleteAsync(uri: string, options?: { idempotent?: boolean }) {
      calls.push(`delete:${uri}:${options?.idempotent === true}`)
      files.delete(uri)
    },
    async copyAsync({ from, to }: { from: string; to: string }) {
      calls.push(`copy:${from}:${to}`)
      files.add(to)
    },
    async writeAsStringAsync(uri: string, _text: string) {
      calls.push(`write:${uri}`)
      files.add(uri)
    },
    async moveAsync({ from, to }: { from: string; to: string }) {
      calls.push(`move:${from}:${to}`)
      files.add(to)
    },
  }
  const Asset = {
    fromModule(module: number | string) {
      const name = String(module).split('/').at(-1) ?? String(module)
      return {
        hash: `hash-${name}`,
        uri: `asset://${name}`,
        localUri: `asset://${name}`,
        async downloadAsync() {
          calls.push(`download:${name}`)
        },
      }
    },
  }
  const api = evaluate<Runtime>(source, {
    'expo-asset': { Asset },
    'expo-file-system/legacy': FileSystem,
    fs,
    path,
    url,
  })
  return { api, calls, files }
}

test('a complete offline runtime is reused without copying any asset', async () => {
  const { api, calls } = setup()
  const uri = await api.webRuntime('pdf')
  expect(uri).toStartWith(`${cache}typo-runtime/pdf-`)
  expect(uri).toEndWith('/pdf.html')
  expect(calls.filter((call) => call.startsWith('copy:') || call.startsWith('write:'))).toEqual([])
  expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([])
})

test('a missing page marker repairs the runtime with fresh assets and a staged move', async () => {
  const { api, calls } = setup((uri) => uri.endsWith('.html'))
  await api.webRuntime('pdf')
  expect(
    calls.some(
      (call) => call.startsWith('mkdir:') && call.includes('/pdf-') && call.endsWith('/:true')
    )
  ).toBe(true)
  expect(calls.some((call) => call.startsWith('delete:') && call.endsWith('/pdf.html:true'))).toBe(
    true
  )
  const copies = calls.filter((call) => call.startsWith('copy:'))
  expect(copies).toHaveLength(3)
  expect(copies.map((call) => call.split('/').at(-1))).toEqual([
    'pdf.bundle.js',
    'pdf-worker.bundle.js',
    'pdf-renderer.bundle.js',
  ])
  const staging = calls.find((call) => call.startsWith('write:')) ?? ''
  expect(staging).toContain('.html.tmp')
  expect(calls).toContain(`move:${staging.slice(6)}:${staging.slice(6, -4)}`)
})

test('a missing individual asset triggers repair even when the page marker exists', async () => {
  const { api, calls } = setup((uri) => uri.endsWith('pdf-worker.bundle.js'))
  await api.webRuntime('pdf')
  expect(calls.filter((call) => call.startsWith('download:'))).toHaveLength(3)
  expect(calls.filter((call) => call.startsWith('copy:'))).toHaveLength(3)
})

test('concurrent requests share one provisioning pass', async () => {
  const { api, calls } = setup((uri) => uri.endsWith('.html'))
  const [one, two] = await Promise.all([api.webRuntime('pdf'), api.webRuntime('pdf')])
  expect(one).toBe(two)
  expect(calls.filter((call) => call.startsWith('mkdir:'))).toHaveLength(1)
})
