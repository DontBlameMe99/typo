import { Buffer } from 'node:buffer'
import { runInNewContext } from 'node:vm'

export type Modules = Record<string, unknown>

export async function bundle(
  entry: string,
  options: {
    external?: string[]
    define?: Record<string, string>
    plugins?: Bun.BuildConfig['plugins']
  } = {}
): Promise<string> {
  const build = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'cjs',
    external: options.external ?? [],
    ...(options.define ? { define: options.define } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
  })
  if (!build.success) throw new AggregateError(build.logs, `Cannot bundle ${entry}`)
  return await build.outputs[0].text()
}

export function evaluate<T>(
  source: string,
  modules: Modules = {},
  sandbox: Record<string, unknown> = {}
): T {
  const module: { exports: T } = { exports: {} as T }
  const context: Record<string, unknown> = {
    module,
    exports: module.exports,
    require(name: string) {
      if (!(name in modules)) throw new Error(`Unexpected require: ${name}`)
      return modules[name]
    },
    console,
    Buffer,
    performance,
    process,
    setTimeout,
    clearTimeout,
    setImmediate,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    ...sandbox,
  }
  runInNewContext(source, context)
  return module.exports
}
