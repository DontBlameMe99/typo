import { expect, test } from 'bun:test'
import { parseMarks } from '../scripts/startup'
import { bundle, evaluate } from './helpers/vm-module'

type Probe = {
  markStartup(name: string): void
  reportStartup(): void
}

type Mode = 'on' | 'off' | 'unset'

async function probe(mode: Mode) {
  let now = 0
  const logs: string[] = []
  const source = await bundleProbe(mode)
  const api = evaluate<Probe>(
    source,
    {},
    {
      performance: { now: () => now },
      console: { info: (line: string) => logs.push(line) },
      ...(mode === 'unset' ? { process: { env: {} } } : {}),
    }
  )
  return {
    api,
    logs,
    advance(ms: number) {
      now += ms
    },
  }
}

const built = new Map<Mode, Promise<string>>()
function bundleProbe(mode: Mode) {
  let result = built.get(mode)
  if (!result) {
    result =
      mode === 'unset'
        ? bundle('src/startup.ts')
        : bundle('src/startup.ts', {
            define: {
              'process.env.EXPO_PUBLIC_TYPO_STARTUP': mode === 'on' ? '"1"' : '"0"',
            },
          })
    built.set(mode, result)
  }
  return result
}

test('startup is silent when the probe environment is unset', async () => {
  const { api, advance, logs } = await probe('unset')
  advance(50)
  api.markStartup('bundle')
  api.markStartup('paint')
  api.reportStartup()
  expect(logs).toEqual([])
})

test('startup is silent when the probe is explicitly disabled', async () => {
  const { api, advance, logs } = await probe('off')
  advance(50)
  api.markStartup('bundle')
  api.reportStartup()
  expect(logs).toEqual([])
})

test('the probe logs every phase once, on one line', async () => {
  const { api, advance, logs } = await probe('on')
  advance(80)
  api.markStartup('bundle')
  advance(180)
  api.markStartup('theme')
  advance(42)
  api.reportStartup()
  expect(logs).toHaveLength(1)
  expect(logs[0]).toStartWith('[startup] ')
  expect(parseMarks(logs[0] as string)).toEqual({ bundle: 80, theme: 260 })
  api.reportStartup()
  expect(logs).toHaveLength(1)
})

test('a phase regression stays visible in the parsed startup line', async () => {
  const { api, advance, logs } = await probe('on')
  advance(100)
  api.markStartup('bundle')
  advance(500)
  api.markStartup('paint')
  api.reportStartup()
  const phases = parseMarks(logs[0] as string)
  expect(phases?.bundle).toBe(100)
  expect(phases?.paint).toBe(600)
  expect((phases?.paint ?? 0) - (phases?.bundle ?? 0)).toBe(500)
})
