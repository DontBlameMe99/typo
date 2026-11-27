import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

const modules: Record<string, string> = {
  react: `export const {forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState}=globalThis.hooks`,
  'react/jsx-runtime': 'export const jsx=globalThis.jsx,jsxs=globalThis.jsx',
  'react-native': 'export const View="View"',
  'react-native-webview': 'export const WebView="WebView"',
  './compiler/packages': 'export const packageArchive=async()=>""',
  './editor/document': 'export const inlineJson=JSON.stringify',
  './web-runtime': 'export const webRuntime=async()=>"file:///runtime/compiler.html"',
  './webview-resume': `export const useWebViewForegroundReload=globalThis.foregroundReload`,
}
const build = await Bun.build({
  entrypoints: [`${import.meta.dir}/../src/CompilerHost.tsx`],
  target: 'browser',
  format: 'cjs',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'compiler-host-test',
      setup(builder) {
        builder.onResolve({ filter: /^(react|expo-file-system|\.\/)/ }, (args) =>
          modules[args.path] ? { path: args.path, namespace: 'host-test' } : undefined
        )
        builder.onLoad({ filter: /.*/, namespace: 'host-test' }, (args) => ({
          contents: modules[args.path],
          loader: 'js',
        }))
      },
    },
  ],
})
if (!build.success) throw new AggregateError(build.logs, 'Cannot build the compiler host test.')
const code = await build.outputs[0].text()

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void }
type CompileResult = { base64: string; dependencies: string[]; issues?: unknown[] }
type Handle = {
  compile(input: { path: string; source: string; files: [] }): Promise<CompileResult>
  retry(): void
}

async function host() {
  const slots: Slot[] = []
  const effects: (() => void)[] = []
  const injections: string[] = []
  const timers = new Map<number, () => void>()
  let cursor = 0
  let timerId = 0
  let dirty = true
  let web:
    | {
        key?: number | string
        onMessage(event: { nativeEvent: { data: string } }): void
      }
    | undefined
  let reload: (() => void) | undefined
  const slot = () => {
    const index = cursor++
    slots[index] ??= {}
    return slots[index]
  }
  const module = { exports: {} }
  runInNewContext(code, {
    module,
    hooks: {
      forwardRef(render: (props: object, ref: { current: Handle }) => unknown) {
        return (props: object, ref: { current: Handle }) => render(props, ref)
      },
      useRef(initial: unknown) {
        const current = slot()
        current.value ??= { current: initial }
        return current.value
      },
      useState(initial: unknown) {
        const current = slot()
        if (!('value' in current)) current.value = initial
        return [
          current.value,
          (value: unknown) => {
            const next = typeof value === 'function' ? value(current.value) : value
            if (Object.is(current.value, next)) return
            current.value = next
            dirty = true
          },
        ]
      },
      useCallback(callback: unknown, deps: unknown[]) {
        const current = slot()
        if (current.deps?.every((value, index) => Object.is(value, deps[index])))
          return current.value
        current.deps = deps
        current.value = callback
        return callback
      },
      useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
        const current = slot()
        if (current.deps?.every((value, index) => Object.is(value, deps[index]))) return
        current.deps = deps
        effects.push(() => {
          current.cleanup?.()
          current.cleanup = effect()
        })
      },
      useImperativeHandle(ref: { current: Handle }, factory: () => Handle) {
        ref.current = factory()
      },
    },
    jsx(type: string, properties: Record<string, unknown>, key?: string) {
      if (type === 'WebView') {
        const value = properties as NonNullable<typeof web>
        web = value
        value.key = key
        const ref = properties.ref as { current: { injectJavaScript(script: string): void } }
        ref.current = { injectJavaScript: (script: string) => injections.push(script) }
      }
      return { type, properties }
    },
    foregroundReload(callback: () => void) {
      reload = callback
    },
    setTimeout(callback: () => void) {
      timers.set(++timerId, callback)
      return timerId
    },
    clearTimeout(id: number) {
      timers.delete(id)
    },
  })
  const render = (
    module.exports as { CompilerHost: (props: object, ref: { current: Handle }) => unknown }
  ).CompilerHost
  const ref: { current: Handle } = { current: undefined as unknown as Handle }
  const flush = () => {
    let renders = 0
    while (dirty) {
      if (++renders > 20) throw new Error('Compiler host did not settle')
      dirty = false
      cursor = 0
      render({}, ref)
      for (const effect of effects.splice(0)) effect()
    }
  }
  flush()
  await new Promise((resolve) => setImmediate(resolve))
  flush()
  return {
    handle: ref.current,
    injections,
    key: () => web?.key,
    message(value: object) {
      if (!web) throw new Error('WebView did not mount')
      web.onMessage({ nativeEvent: { data: JSON.stringify(value) } })
      flush()
    },
    reload() {
      if (!reload) throw new Error('No reload hook')
      reload()
      flush()
    },
    flush,
  }
}

test('a foreground reload retries the job with a fresh id and keeps warnings', async () => {
  const h = await host()
  const warning = {
    path: 'warn.typ',
    line: 1,
    column: 2,
    severity: 'warning',
    message: 'unnecessary import rename to same name',
  }
  const pending = h.handle.compile({ path: 'warn.typ', source: '= Warning', files: [] })
  h.flush()
  await new Promise((resolve) => setImmediate(resolve))
  h.flush()
  h.message({ type: 'boot' })
  expect(h.injections).toHaveLength(1)
  expect(h.injections[0]).toContain('"id":1')

  h.reload()
  expect(h.key()).toBe(1)
  expect(h.injections).toHaveLength(1)
  h.message({ type: 'boot' })
  expect(h.injections).toHaveLength(2)
  expect(h.injections[1]).toContain('"id":2')

  h.message({
    type: 'pdf',
    id: 2,
    base64: 'JVBERi0x',
    dependencies: ['asset.svg'],
    issues: [warning],
  })
  expect(await pending).toEqual({
    base64: 'JVBERi0x',
    dependencies: ['asset.svg'],
    issues: [warning],
  })
})
