import { expect, test } from 'bun:test'
import { compilerMessage, ERROR_CODES } from '../src/compiler/message'

test('boot and crash messages do not need a job', () => {
  expect(compilerMessage('{"type":"boot"}')).toEqual({ type: 'boot' })
  expect(compilerMessage('{"type":"boot","id":1}')).toEqual({ type: 'boot' })
  expect(compilerMessage('{"type":"crash","message":"Worker died"}')).toEqual({
    type: 'crash',
    code: ERROR_CODES.crash,
    message: 'Worker died',
  })
  expect(compilerMessage('{"type":"crash","message":42}')).toEqual({
    type: 'crash',
    code: ERROR_CODES.crash,
    message: undefined,
  })
})

test('load errors are separated from compile errors by their id', () => {
  expect(compilerMessage('{"type":"error","message":"No bundle"}')).toEqual({
    type: 'error',
    code: ERROR_CODES.error,
    id: undefined,
    message: 'No bundle',
  })
  expect(compilerMessage('{"type":"error","id":null}')).toEqual({
    type: 'error',
    code: ERROR_CODES.error,
    id: undefined,
    message: undefined,
  })
  expect(compilerMessage('{"type":"error","id":3,"message":"Stopped"}')).toEqual({
    type: 'error',
    code: ERROR_CODES.error,
    id: 3,
    message: 'Stopped',
  })
  expect(compilerMessage('{"type":"error","id":"3"}')).toBeNull()
})

test('compiler messages carry a stable code and bounded local detail', () => {
  const long = `Failed at file:///private/cache/notes/secret.typ: ${'x'.repeat(500)}`
  const error = compilerMessage(JSON.stringify({ type: 'error', id: 7, message: long }))
  expect(error?.type).toBe('error')
  if (error?.type !== 'error') return
  expect(error.code).toBe('COMPILER_ERROR')
  expect(error.message?.length).toBe(200)
  expect(error.message).toContain('secret.typ')
  expect(error.message).not.toContain('/private/cache')

  const crash = compilerMessage(
    JSON.stringify({ type: 'crash', message: 'wasm trap at C:\\vault\\secret.typ\nframe two' })
  )
  expect(crash?.type).toBe('crash')
  if (crash?.type !== 'crash') return
  expect(crash.code).toBe('COMPILER_CRASH')
  expect(crash.message).toBe('wasm trap at secret.typ frame two')
})

test('a PDF must be a PDF with string dependencies and a numeric id', () => {
  const pdf = {
    type: 'pdf',
    id: 2,
    base64: 'JVBERi0x',
    dependencies: ['a.typ', 'b.typ'],
    issues: [],
  }
  expect(compilerMessage(JSON.stringify(pdf)) as unknown).toEqual(pdf)
  for (const invalid of [
    { ...pdf, base64: 'not a PDF' },
    { ...pdf, dependencies: 'a.typ' },
    { ...pdf, dependencies: ['a.typ', 2] },
    { ...pdf, id: undefined },
    { ...pdf, id: '2' },
  ])
    expect(compilerMessage(JSON.stringify(invalid))).toBeNull()
})

test('diagnostics keep valid issues, drop the rest, and bound issue messages', () => {
  const issues = [
    { path: 'a.typ', line: 1, column: 2, severity: 'error', message: 'bad' },
    { path: 'a.typ', line: 0, column: 0, severity: 'hint', message: 'note' },
    { path: 'a.typ', line: 1.5, column: 2, severity: 'warning', message: 'fraction' },
    { path: 2, line: 1, column: 2, severity: 'error', message: 'path' },
    { path: 'a.typ', line: 1, column: 2, severity: 'other', message: 'severity' },
    { path: 'a.typ', line: 1, column: 2, severity: 'error', message: 1 },
    null,
    'bad',
  ]
  const parsed = compilerMessage(
    JSON.stringify({ type: 'diagnostics', id: 4, message: 'Failed', issues })
  )
  expect(parsed?.type).toBe('diagnostics')
  if (parsed?.type !== 'diagnostics') return
  expect(parsed.id).toBe(4)
  expect(parsed.code).toBe('TYPST_DIAGNOSTICS')
  expect(parsed.message).toBe('Failed')
  expect(parsed.issues as unknown).toEqual(issues.slice(0, 2))

  const bounded = compilerMessage(
    JSON.stringify({
      type: 'diagnostics',
      id: 5,
      issues: [
        {
          path: 'a.typ',
          line: 1,
          column: 2,
          severity: 'error',
          message: 'x'.repeat(500),
        },
      ],
    })
  )
  expect(bounded?.type).toBe('diagnostics')
  if (bounded?.type !== 'diagnostics') return
  expect(bounded.issues[0]?.message.length).toBe(200)

  expect(compilerMessage('{"type":"diagnostics","id":4}')).toEqual({
    type: 'diagnostics',
    code: ERROR_CODES.diagnostics,
    id: 4,
    message: undefined,
    issues: [],
  })
  expect(compilerMessage('{"type":"diagnostics","issues":[]}')).toBeNull()
})

test('packages must use supported namespace, name, and version fields', () => {
  const packages = [
    { namespace: 'preview', name: 'foo', version: '1.0.0', key: 'preview/foo/1.0.0' },
  ]
  expect(compilerMessage(JSON.stringify({ type: 'packages', id: 5, packages }))).toEqual({
    type: 'packages',
    id: 5,
    packages,
  })
  for (const invalid of [
    {},
    { namespace: 'preview', name: 'foo' },
    { namespace: 'other', name: 'foo', version: '1.0.0' },
    { namespace: 'preview', name: '../foo', version: '1.0.0' },
    { namespace: 'preview', name: 'foo', version: 'main' },
    { namespace: 'preview', name: 'foo', version: 1 },
  ])
    expect(
      compilerMessage(JSON.stringify({ type: 'packages', id: 5, packages: [invalid] }))
    ).toBeNull()
  expect(compilerMessage('{"type":"packages","id":5,"packages":[{}]}')).toBeNull()
  expect(compilerMessage('{"type":"packages","id":5}')).toBeNull()
})

test('unrecognized messages are ignored', () => {
  for (const value of [1, 'boot', [], {}, { type: 'other' }])
    expect(compilerMessage(JSON.stringify(value))).toBeNull()
})

test('a payload that is not JSON still throws for the host to report', () => {
  expect(() => compilerMessage('{')).toThrow()
  expect(() => compilerMessage('null')).toThrow()
})
