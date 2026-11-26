import { expect, mock, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import type { ComponentProps } from 'react'
import type { NoteSearch } from '../src/NoteSearch'
import { makeNote } from './helpers/note'

const bundle = await Bun.build({
  entrypoints: ['src/NoteSearch.tsx'],
  target: 'node',
  format: 'cjs',
  external: ['react', 'react-native', 'react-native-webview'],
  plugins: [
    {
      name: 'search-host-stubs',
      setup(build) {
        build.onResolve({ filter: /(?:editor\/document|web-runtime)$/u }, (args) => ({
          path: args.path,
          external: true,
        }))
      },
    },
  ],
})
if (!bundle.success) throw new AggregateError(bundle.logs, 'Cannot bundle note search')
const source = await bundle.outputs[0].text()

type Props = ComponentProps<typeof NoteSearch>
type Element = { type: unknown; props: Record<string, unknown> }
type Scope = { props: Record<string, unknown> }

function callbacks() {
  return { onResults: mock(), onError: mock(), onPending: mock() }
}

function search(initial: Omit<Props, 'onResults' | 'onError' | 'onPending'>, failRuntime = false) {
  const hooks = callbacks()
  let props: Props = { ...initial, ...hooks }
  let cursor = 0
  let dirty = false
  let view: Element | null = null
  const cleanups: (undefined | (() => void))[] = []
  const deps: (unknown[] | undefined)[] = []
  const effects: { deps?: unknown[]; run(): undefined | (() => void) }[] = []
  const memo: { deps?: unknown[]; value?: unknown }[] = []
  const refs: { current: unknown }[] = []
  const states: unknown[] = []
  const runtime = { calls: 0, fail: failRuntime }
  const injected: string[] = []
  const host = {
    injectJavaScript(script: string) {
      injected.push(script)
    },
  }

  const react = {
    useRef(value: unknown) {
      const index = cursor++
      refs[index] ??= { current: value }
      return refs[index]
    },
    useState(value: unknown) {
      const index = cursor++
      if (!(index in states)) states[index] = value
      return [
        states[index],
        (next: unknown) => {
          const resolved =
            typeof next === 'function' ? (next as (old: unknown) => unknown)(states[index]) : next
          if (resolved !== states[index]) {
            states[index] = resolved
            dirty = true
          }
        },
      ]
    },
    useEffect(run: () => undefined | (() => void), next?: unknown[]) {
      effects[cursor++] = { deps: next, run }
    },
    useCallback(callback: unknown, next?: unknown[]) {
      const index = cursor++
      const previous = memo[index]
      if (previous?.deps?.every((value, position) => value === next?.[position]))
        return previous.value
      memo[index] = { deps: next, value: callback }
      return callback
    },
  }

  // The search deadline is measured against virtual time so a test does not
  // wait for it.
  const timers = new Map<number, { at: number; run(): void }>()
  let clock = 0
  let nextTimer = 1
  const module = { exports: {} }
  runInNewContext(source, {
    module,
    exports: module.exports,
    __DEV__: false,
    performance,
    setTimeout(run: () => void, delay = 0) {
      const id = nextTimer++
      timers.set(id, { at: clock + Number(delay), run })
      return id
    },
    clearTimeout(id: number) {
      timers.delete(id)
    },
    require(name: string) {
      if (name === 'react') return react
      if (name === 'react-native') return { View: 'View' }
      if (name === 'react-native-webview') return { WebView: 'WebView' }
      if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') {
        const element = (type: unknown, props: unknown, key?: unknown) => ({ type, props, key })
        return { jsx: element, jsxDEV: element }
      }
      if (name.endsWith('/editor/document')) return { inlineJson: JSON.stringify }
      if (name.endsWith('/web-runtime'))
        return {
          webRuntime: async () => {
            runtime.calls++
            if (runtime.fail) throw new Error('Missing bundle')
            return 'file:///search.html'
          },
        }
      throw new Error(`Unexpected import: ${name}`)
    },
  })

  const { NoteSearch: Component } = module.exports as {
    NoteSearch: (props: Props) => Element
  }
  const render = () => {
    cursor = 0
    view = Component(props)
    const children = (view as Element).props.children as Scope | undefined
    if (children?.props.ref) (children.props.ref as { current: unknown }).current = host
    for (const [index, effect] of effects.entries()) {
      if (!effect) continue
      const previous = deps[index]
      if (previous && effect.deps?.every((value, position) => value === previous[position]))
        continue
      cleanups[index]?.()
      deps[index] = effect.deps
      cleanups[index] = effect.run()
    }
  }
  const settle = async () => {
    for (let pass = 0; pass < 10; pass++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (!dirty) return
      dirty = false
      render()
    }
  }
  const advance = async (ms: number) => {
    const target = clock + ms
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      clock = due[1].at
      due[1].run()
      await settle()
    }
    clock = target
  }
  render()

  const child = () => {
    const children = (view as Element).props.children
    if (!children) throw new Error('No search WebView')
    return (children as Scope).props as {
      source: { uri: string }
      onMessage(event: unknown): void
      onError(): void
      onRenderProcessGone(): void
    }
  }
  // Remounting is the only way to replace a runtime that stopped answering.
  const webviewKey = () => {
    const children = (view as Element).props.children as (Element & { key?: unknown }) | undefined
    if (!children) throw new Error('No search WebView')
    return children.key
  }
  return {
    ...hooks,
    runtime,
    settle,
    advance,
    setProps(next: Partial<Props>) {
      props = { ...props, ...next }
      dirty = true
      render()
    },
    child,
    boot() {
      this.message({ type: 'boot' })
    },
    requestId() {
      return this.request().id
    },
    request() {
      const script = injected.at(-1)
      if (!script) throw new Error('No search request was sent')
      return JSON.parse(script.replace(/^window\.typoSearch\(/u, '').replace(/\);true;$/u, '')) as {
        id: number
        query: string
      }
    },
    message(data: unknown) {
      child().onMessage({ nativeEvent: { data: JSON.stringify(data) } })
    },
    webviewKey,
  }
}

test('stale search failures do not reject a current response', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.boot()
  await api.settle()
  const id = api.requestId()
  api.message({ type: 'error', id: id - 1, message: 'Stale' })
  api.message({ type: 'results', id, results: [] })
  expect(api.onError).not.toHaveBeenCalled()
  expect(api.onResults).toHaveBeenCalledWith([])
})

test('search failures reject without reporting a successful empty search or accepting late results', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.boot()
  await api.settle()
  const id = api.requestId()
  api.message({ type: 'error', id, message: 'Broken' })
  api.message({ type: 'results', id, results: [] })
  expect(api.onError).toHaveBeenCalledWith('Broken')
  expect(api.onResults).not.toHaveBeenCalled()
})

test('a stopped search process cannot publish its last response', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.boot()
  await api.settle()
  const id = api.requestId()
  api.child().onRenderProcessGone()
  api.message({ type: 'results', id, results: [] })
  expect(api.onError).toHaveBeenCalledWith('The note search stopped and is restarting.')
  expect(api.onResults).not.toHaveBeenCalled()
})

test('a runtime load failure retries after the next query', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' }, true)
  await api.settle()
  expect(api.onError).toHaveBeenCalledWith('Error: Missing bundle')
  expect(api.runtime.calls).toBe(1)
  api.runtime.fail = false
  api.setProps({ query: 'next' })
  await api.settle()
  expect(api.runtime.calls).toBe(2)
  expect(api.child().source.uri).toBe('file:///search.html')
})

test('a WebView load error remounts after the next query', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.child().onError()
  expect(api.onError).toHaveBeenCalledWith('The note search could not load.')
  await api.settle()
  expect(() => api.child()).toThrow()
  api.setProps({ query: 'next' })
  await api.settle()
  expect(api.child().source.uri).toBe('file:///search.html')
})

test('a page that boots again resends the query the first page never answered', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.boot()
  await api.settle()
  const first = api.request()
  // A renderer respawn reloads the page and loses the index with it.
  api.boot()
  await api.settle()
  expect(api.request()).toEqual({ ...first, id: first.id + 1 })
  expect(api.onError).not.toHaveBeenCalled()
})

test('a query that is never answered reports a failure and restarts the runtime', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.boot()
  await api.settle()
  const first = api.request()
  const mounted = api.webviewKey()
  await api.advance(29_999)
  expect(api.onError).not.toHaveBeenCalled()
  await api.advance(1)
  expect(api.onError).toHaveBeenCalledWith('The note search stopped responding and is restarting.')
  expect(api.onPending).toHaveBeenLastCalledWith(false)
  expect(api.webviewKey()).not.toBe(mounted)
  // The restarted runtime is empty, so the boot asks for the whole vault again.
  api.boot()
  await api.settle()
  const retry = api.request()
  expect(retry.query).toBe(first.query)
  expect(retry.id).not.toBe(first.id)
  expect(api.onResults).not.toHaveBeenCalled()
})

test('a runtime that keeps failing is restarted once per query, not forever', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.boot()
  await api.settle()
  await api.advance(30_000)
  api.boot()
  await api.settle()
  const remounted = api.webviewKey()
  await api.advance(30_000)
  expect(api.onError).toHaveBeenLastCalledWith(
    'The note search is not responding. Clear the search and try again.'
  )
  expect(api.webviewKey()).toBe(remounted)
})

test('a query typed before the first boot still gets a deadline', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  expect(api.onPending).toHaveBeenLastCalledWith(true)
  await api.advance(30_000)
  expect(api.onError).toHaveBeenCalledWith('The note search stopped responding and is restarting.')
  expect(api.onPending).toHaveBeenLastCalledWith(false)
  // The replacement page gets its own deadline, and a second silence is final.
  const mounted = api.webviewKey()
  await api.advance(30_000)
  expect(api.onError).toHaveBeenLastCalledWith(
    'The note search is not responding. Clear the search and try again.'
  )
  expect(api.webviewKey()).toBe(mounted)
})

test('a note change during a search does not push the deadline back', async () => {
  const note = makeNote()
  const api = search({ notes: [note], query: 'query', mode: 'all' })
  await api.settle()
  api.boot()
  await api.settle()
  await api.advance(20_000)
  api.setProps({ notes: [{ ...note, source: '= One, edited' }] })
  await api.settle()
  await api.advance(9_999)
  expect(api.onError).not.toHaveBeenCalled()
  await api.advance(1)
  expect(api.onError).toHaveBeenCalledWith('The note search stopped responding and is restarting.')
})

test('clearing the query before the runtime boots cancels the deadline', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.setProps({ query: '' })
  await api.settle()
  await api.advance(60_000)
  expect(api.onError).not.toHaveBeenCalled()
  expect(api.onPending).toHaveBeenLastCalledWith(false)
})

test('the one restart per query is available again once the search ends', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.boot()
  await api.settle()
  await api.advance(30_000)
  api.boot()
  await api.settle()
  await api.advance(30_000)
  expect(api.onError).toHaveBeenLastCalledWith(
    'The note search is not responding. Clear the search and try again.'
  )
  api.setProps({ query: '' })
  await api.settle()
  api.setProps({ query: 'query' })
  await api.settle()
  const mounted = api.webviewKey()
  await api.advance(30_000)
  expect(api.onError).toHaveBeenLastCalledWith(
    'The note search stopped responding and is restarting.'
  )
  expect(api.webviewKey()).not.toBe(mounted)
})

test('a page that never boots is retried after the search is cleared and typed again', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  await api.advance(30_000)
  const mounted = api.webviewKey()
  expect(api.onError).toHaveBeenLastCalledWith(
    'The note search stopped responding and is restarting.'
  )
  api.setProps({ query: '' })
  await api.settle()
  api.setProps({ query: 'query' })
  await api.settle()
  await api.advance(30_000)
  expect(api.onError).toHaveBeenLastCalledWith(
    'The note search stopped responding and is restarting.'
  )
  expect(api.webviewKey()).not.toBe(mounted)
})

test('an answered query never reaches the deadline', async () => {
  const api = search({ notes: [], query: 'query', mode: 'names' })
  await api.settle()
  api.boot()
  await api.settle()
  const id = api.requestId()
  api.message({ type: 'results', id, results: [] })
  await api.advance(60_000)
  expect(api.onError).not.toHaveBeenCalled()
  expect(api.onResults).toHaveBeenCalledWith([])
})
