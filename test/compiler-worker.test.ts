import { beforeAll, expect, test } from 'bun:test'
import type { CompileOutput } from '../src/compiler/engine'
import { compilerMessage } from '../src/compiler/message'
import type { CompileRequest } from '../src/compiler/protocol'
import { fromBase64, toBase64 } from '../src/editor/local'

type Message = { type: string; id?: number; message?: string; base64?: string }

const messages: Message[] = []
let wake: (() => void) | null = null
const endpoint = globalThis as unknown as {
  postMessage(value: Message): void
  onmessage(event: { data: unknown }): void
}
endpoint.postMessage = (value) => {
  messages.push(value)
  wake?.()
}
const { compileMessage, storeArchives } = await import('../src/compiler/worker')

const next = async () => {
  while (!messages.length) await new Promise<void>((resolve) => (wake = resolve))
  return messages.shift() as Message
}
const compile = async (request: CompileRequest) => {
  endpoint.onmessage({ data: { type: 'compile', request } })
  return next()
}

beforeAll(async () => {
  const wasm = new Uint8Array(
    await Bun.file(
      'node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm'
    ).arrayBuffer()
  )
  const fonts = await Promise.all(
    ['assets/fonts/typst/LibertinusSerif-Regular.otf'].map(
      async (path) => new Uint8Array(await Bun.file(path).arrayBuffer())
    )
  )
  endpoint.onmessage({ data: { type: 'init', wasm, fonts } })
  expect(await next()).toEqual({ type: 'ready' })
})

test('the worker reports Typst diagnostics apart from runtime failures', async () => {
  const request = { id: 1, path: 'bad.typ', source: '#unknown-function()', archives: [] }
  const diagnostics = await compile(request)
  expect(diagnostics.type).toBe('diagnostics')
  expect(diagnostics.message).toContain('unknown variable')

  // An unsafe path fails before Typst runs, so it is a runtime failure, not a diagnostic.
  const runtime = await compile({ ...request, id: 2, path: '../escape.typ' })
  expect(runtime.type).toBe('error')
  expect(runtime.id).toBe(2)
})

test('base64 decoding preserves bytes across lengths', () => {
  for (const length of [0, 1, 2, 3, 255, 256, 1000]) {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 251)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  }
})

test('warnings stay on a successful PDF message', () => {
  const warning = {
    path: 'warn.typ',
    line: 1,
    column: 2,
    severity: 'warning' as const,
    message: 'unnecessary import rename to same name',
  }
  const output: CompileOutput = {
    pdf: new TextEncoder().encode('%PDF-1.7'),
    diagnostics: [],
    issues: [warning],
    missing: [],
    dependencies: ['asset.svg'],
  }
  const message = compilerMessage(JSON.stringify(compileMessage(output, 7)))
  expect(message?.type).toBe('pdf')
  if (message?.type !== 'pdf') return
  expect(message.issues).toEqual([warning])
  expect(message.dependencies).toEqual(['asset.svg'])
})

test('session archives evict the least recently used entry past 100', () => {
  const archives = new Map<string, Uint8Array>()
  const incoming = Array.from({ length: 101 }, (_, index) => ({
    key: `preview/pkg-${index}/1.0.0`,
    base64: Buffer.from('H4sI').toString('base64'),
  }))
  storeArchives(archives, incoming)
  expect(archives.size).toBe(100)
  expect(archives.has(incoming[0].key)).toBe(false)
  expect(archives.has(incoming[100].key)).toBe(true)
  storeArchives(archives, [incoming[0]])
  expect(archives.size).toBe(100)
  expect(archives.has(incoming[1].key)).toBe(false)
})
