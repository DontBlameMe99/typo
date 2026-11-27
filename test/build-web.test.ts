import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const output = await mkdtemp(join(tmpdir(), 'typo-web-build-'))
const build = Bun.spawn([process.execPath, 'scripts/build-web.ts'], {
  env: { ...process.env, TYPO_WEB_OUT: output },
  stdout: 'pipe',
  stderr: 'pipe',
})
const status = await build.exited
const log = await new Response(build.stderr).text()

test('the offline web build emits every runtime the app loads', async () => {
  expect({ status, log }).toEqual({ status: 0, log: '' })
  const bundles = [
    'editor.bundle.txt',
    'editor-worker.bundle.txt',
    'compiler.bundle.txt',
    'compiler-worker.bundle.txt',
    'pdf.bundle.txt',
    'pdf-worker.bundle.txt',
    'pdf-renderer.bundle.txt',
    'search.bundle.txt',
  ]
  for (const name of bundles) {
    const text = await readFile(join(output, name), 'utf8')
    expect(text.length).toBeGreaterThan(100)
    expect(text).toContain('/*!\n')
  }
  const compiler = await readFile(join(output, 'compiler.wasm'))
  expect(compiler.byteLength).toBeGreaterThan(1000)
})

afterAll(async () => {
  await rm(output, { recursive: true, force: true })
})
