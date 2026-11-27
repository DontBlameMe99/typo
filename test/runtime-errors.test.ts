import { expect, test } from 'bun:test'
import { runtimeErrorScript } from '../src/runtime-errors'

type Message = { type: string; code?: string; message: string }

function runtime(component = 'Source editor') {
  const listeners = new Map<string, (event: object) => void>()
  const messages: Message[] = []
  const window = {
    addEventListener: (type: string, listener: (event: object) => void) =>
      listeners.set(type, listener),
    ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) },
  }
  new Function('window', runtimeErrorScript(component))(window)
  return {
    emit: (type: string, event: object) => listeners.get(type)?.(event),
    messages,
  }
}

test('runtime reporting does not depend on Hermes preserving function source', () => {
  const original = Function.prototype.toString
  Function.prototype.toString = () => 'function reportRuntimeErrors() { [bytecode] }'
  try {
    const { emit, messages } = runtime('PDF viewer')
    emit('error', { message: 'Startup failed' })
    expect(messages[0]).toEqual({
      type: 'error',
      code: 'WEBVIEW_RUNTIME_ERROR',
      message: 'PDF viewer failed: Error: Startup failed',
    })
  } finally {
    Function.prototype.toString = original
  }
})

test('stacks are reduced to an error class and the first line with no file paths', () => {
  const { emit, messages } = runtime()
  const error = new TypeError('Parser failed in /private/cache/notes/secret.typ')
  error.stack = [
    'TypeError: Parser failed in /private/cache/notes/secret.typ',
    '    at parse (file:///private/cache/editor.bundle.js:12:8)',
    '    at file:///private/cache/worker.js:3:1',
  ].join('\n')
  emit('error', { error })
  expect(messages[0]).toEqual({
    type: 'error',
    code: 'WEBVIEW_RUNTIME_ERROR',
    message: 'Source editor failed: TypeError: Parser failed in secret.typ',
  })
})

test('runtime details are capped before they cross the bridge', () => {
  const { emit, messages } = runtime('PDF compiler')
  emit('unhandledrejection', { reason: `Failure: ${'x'.repeat(500)}` })
  const message = messages[0]?.message ?? ''
  expect(message.length).toBe(200)
  expect(message.startsWith('PDF compiler failed: Error: Failure:')).toBe(true)
  expect(message).not.toContain('x\n')
})

test('message-only failures keep a bounded location without the full path', () => {
  const { emit, messages } = runtime('PDF compiler')
  emit('error', {
    message: 'Unexpected token',
    filename: 'file:///private/cache/compiler.bundle.js',
    lineno: 12,
    colno: 8,
  })
  expect(messages[0]?.message).toBe(
    'PDF compiler failed: Error: Unexpected token compiler.bundle.js, line 12, column 8'
  )
})

test('opaque script errors explain the missing details and give a retry step', () => {
  const { emit, messages } = runtime()
  emit('error', { message: 'Script error.' })
  expect(messages[0]?.message).toContain('Android did not provide script error details.')
  expect(messages[0]?.message).toContain('Close and reopen the note to retry.')
})

test('failed script loads identify the bundled resource', () => {
  const { emit, messages } = runtime()
  emit('error', { target: { tagName: 'SCRIPT', src: 'file:///cache/editor.bundle.js' } })
  expect(messages[0]?.message).toBe(
    'Source editor failed: Error: Cannot load bundled script: editor.bundle.js'
  )
})

test('unhandled async failures report their class and first line', () => {
  const { emit, messages } = runtime('PDF viewer')
  emit('unhandledrejection', { reason: new Error('Cannot decode PDF') })
  emit('unhandledrejection', { reason: 'Resource unavailable' })
  expect(messages[0]?.message).toBe('PDF viewer failed: Error: Cannot decode PDF')
  expect(messages[1]?.message).toBe('PDF viewer failed: Error: Resource unavailable')
})
