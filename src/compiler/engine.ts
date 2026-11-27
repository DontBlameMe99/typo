import init, {
  type ProxyContext,
  TypstCompilerBuilder,
  type TypstFontResolver,
  TypstFontResolverBuilder,
} from '@myriaddreamin/typst-ts-web-compiler'

import { type Diagnostic, formatDiagnostic, parseDiagnostics } from './diagnostics'
import { type PackageSpec, packageKey, vaultPath } from './protocol'

const VAULT = '/vault/'
const SHARED = ['style/', 'assets/', 'bibliography.yml']
const DEPENDENCY_LIMIT = 100 * 1024 * 1024
const FILE_LIMIT = 10000

export type CompileOutput = {
  pdf?: Uint8Array
  diagnostics: string[]
  issues: Diagnostic[]
  missing: PackageSpec[]
  dependencies: string[]
}

export function failedCompile(
  message: string,
  missing: PackageSpec[],
  dependencies: string[]
): CompileOutput {
  return {
    diagnostics: [message],
    issues: parseDiagnostics([message]),
    missing,
    dependencies,
  }
}

export async function initializeCompiler(wasm: Uint8Array) {
  await init({ module_or_path: wasm as Uint8Array<ArrayBuffer> })
}

// Reading fonts costs more than compiling a short note, and the same bytes arrive for every
// compiler until the user adds a font, so the parsed result is kept for the exact list of font
// buffers we were handed.
let fontsRead: { fonts: Uint8Array[]; resolver: Promise<TypstFontResolver> } | null = null

function fontResolver(fonts: Uint8Array[]): Promise<TypstFontResolver> {
  const kept = fontsRead
  if (
    kept &&
    kept.fonts.length === fonts.length &&
    fonts.every((font, i) => font === kept.fonts[i])
  )
    return kept.resolver
  const builder = new TypstFontResolverBuilder()
  for (const font of fonts) builder.add_raw_font(font)
  const resolver = builder.build()
  // The replaced resolver is dropped rather than freed: a compiler that already received it may
  // still be awaiting it, and wasm-bindgen releases it once it is unreachable.
  fontsRead = { fonts: [...fonts], resolver }
  return resolver
}

export async function createCompiler(
  files: Map<string, Uint8Array>,
  fonts: Uint8Array[],
  archives: Map<string, Uint8Array>
) {
  const missing = new Map<string, PackageSpec>()
  const dependencies = new Set<string>()
  const track = (name: string) => {
    if (name.startsWith(VAULT)) dependencies.add(name.slice(VAULT.length))
    return name
  }
  // The vault is only sized once a package actually needs to be unpacked.
  let total = 0
  let sized = false
  const size = () => {
    if (sized) return total
    sized = true
    for (const bytes of files.values()) total += bytes.length
    return total
  }
  // A note reaches shared style, asset and bibliography resources at the vault root.
  const canonical = (name: string): string => {
    track(name)
    if (files.has(name) || !name.startsWith(VAULT)) return name
    for (const shared of SHARED) {
      const index = name.indexOf(`/${shared}`, VAULT.length)
      if (index < 0) continue
      const root = track(`/vault${name.slice(index)}`)
      if (files.has(root)) return root
    }
    return name
  }
  const builder = new TypstCompilerBuilder()
  let built = false
  try {
    await builder.set_access_model(
      files,
      () => Date.now(),
      (name: string) => files.has(canonical(name)),
      canonical,
      (name: string) => files.get(canonical(name))
    )
    await builder.set_package_registry(files, function (this: ProxyContext, spec: PackageSpec) {
      const key = packageKey(spec)
      const portable = `/vault/packages/${key}`
      if (files.has(track(`${portable}/typst.toml`))) return portable
      const archive = archives.get(key)
      if (!archive) {
        missing.set(key, spec)
        return undefined
      }
      const root = `/packages/${key}`
      if (files.has(`${root}/typst.toml`)) return root
      this.untar(archive, (name: string, bytes: Uint8Array) => {
        const relative = name.replace(/^(\.\/)+/u, '')
        if (
          !relative ||
          relative.startsWith('/') ||
          relative.split('/').some((part) => part === '..') ||
          /[\\\p{Cc}]/u.test(relative)
        )
          throw new Error('A package contains an unsafe file path.')
        if (size() + bytes.length > DEPENDENCY_LIMIT || files.size >= FILE_LIMIT)
          throw new Error('Compiler dependencies exceed the 100 MiB limit.')
        total += bytes.length
        files.set(`${root}/${relative}`, bytes)
      })
      return root
    })
    // Reusing the parsed fonts keeps the compiler's font database stable, so Typst can reuse the
    // compilation of any source and dependency that did not change since the last compiler.
    const resolver = fonts.length ? await fontResolver(fonts) : null
    const compiler = await builder.build()
    built = true
    if (resolver) compiler.set_fonts(resolver)
    return {
      compile(path: string): CompileOutput {
        missing.clear()
        dependencies.clear()
        // Keep the font database and package files, but invalidate previous source reads.
        compiler.reset()
        const world = compiler.snapshot('/vault', vaultPath(path), [])
        try {
          const result = world.get_artifact(1, 2) as { result?: Uint8Array; diagnostics?: string[] }
          const diagnostics = result.diagnostics ?? []
          return {
            pdf: result.result,
            diagnostics: diagnostics.map(formatDiagnostic),
            issues: parseDiagnostics(diagnostics),
            missing: [...missing.values()],
            dependencies: [...dependencies],
          }
        } catch (cause) {
          return failedCompile(
            cause instanceof Error ? cause.message : String(cause),
            [...missing.values()],
            [...dependencies]
          )
        } finally {
          world.free()
        }
      },
      dispose: () => compiler.free(),
    }
  } finally {
    if (!built) builder.free()
  }
}

export async function compilePdf(
  path: string,
  input: Map<string, Uint8Array>,
  fonts: Uint8Array[],
  archives: Map<string, Uint8Array>
): Promise<CompileOutput> {
  const compiler = await createCompiler(new Map(input), fonts, archives)
  try {
    return compiler.compile(path)
  } finally {
    compiler.dispose()
  }
}
