import type { Diagnostic } from './diagnostics'
import { type PackageSpec, packageKey } from './protocol'

export const ERROR_CODES = {
  crash: 'COMPILER_CRASH',
  error: 'COMPILER_ERROR',
  diagnostics: 'TYPST_DIAGNOSTICS',
} as const

export type CompilerMessage =
  | { type: 'boot' }
  | { type: 'crash'; code: typeof ERROR_CODES.crash; message?: string }
  | { type: 'error'; code: typeof ERROR_CODES.error; id?: number; message?: string }
  | { type: 'pdf'; id: number; base64: string; dependencies: string[]; issues: Diagnostic[] }
  | {
      type: 'diagnostics'
      code: typeof ERROR_CODES.diagnostics
      id: number
      message?: string
      issues: Diagnostic[]
    }
  | { type: 'packages'; id: number; packages: PackageSpec[] }

const MESSAGE_LIMIT = 200
const PATH = /(?:file:\/\/)?(?:[A-Za-z]:)?(?:[\\/][^\s:'"()]+)+/gu

function bound(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(PATH, (path) => {
      const parts = path.split(/[\\/]/u).filter(Boolean)
      return parts[parts.length - 1] || ''
    })
    .trim()
    .slice(0, MESSAGE_LIMIT)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? bound(value) : undefined
}

export function readIssues(value: unknown): Diagnostic[] {
  if (!Array.isArray(value)) return []
  const issues: Diagnostic[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { path, line, column, severity, message } = item as Record<string, unknown>
    if (
      typeof path !== 'string' ||
      !Number.isSafeInteger(line) ||
      !Number.isSafeInteger(column) ||
      (severity !== 'error' && severity !== 'warning' && severity !== 'hint') ||
      typeof message !== 'string'
    )
      continue
    issues.push({
      path,
      line: line as number,
      column: column as number,
      severity,
      message: bound(message),
    })
  }
  return issues
}

function readPackages(value: unknown): PackageSpec[] | null {
  if (!Array.isArray(value)) return null
  const packages: PackageSpec[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const { namespace, name, version } = item as Record<string, unknown>
    if (typeof namespace !== 'string' || typeof name !== 'string' || typeof version !== 'string')
      return null
    try {
      packageKey({ namespace, name, version })
    } catch {
      return null
    }
    packages.push(item as PackageSpec)
  }
  return packages
}

export function compilerMessage(json: string): CompilerMessage | null {
  const value: unknown = JSON.parse(json)
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'boot':
      return { type: 'boot' }
    case 'crash':
      return { type: 'crash', code: ERROR_CODES.crash, message: text(record.message) }
    case 'error': {
      if (record.id != null && typeof record.id !== 'number') return null
      const id = typeof record.id === 'number' ? record.id : undefined
      return { type: 'error', code: ERROR_CODES.error, id, message: text(record.message) }
    }
    case 'pdf': {
      if (
        typeof record.id !== 'number' ||
        typeof record.base64 !== 'string' ||
        !record.base64.startsWith('JVBERi0') ||
        !Array.isArray(record.dependencies) ||
        !record.dependencies.every((path: unknown) => typeof path === 'string')
      )
        return null
      return {
        type: 'pdf',
        id: record.id,
        base64: record.base64,
        dependencies: record.dependencies as string[],
        issues: readIssues(record.issues),
      }
    }
    case 'diagnostics': {
      if (typeof record.id !== 'number') return null
      return {
        type: 'diagnostics',
        code: ERROR_CODES.diagnostics,
        id: record.id,
        message: text(record.message),
        issues: readIssues(record.issues),
      }
    }
    case 'packages': {
      if (typeof record.id !== 'number') return null
      const packages = readPackages(record.packages)
      if (!packages) return null
      return { type: 'packages', id: record.id, packages }
    }
    default:
      return null
  }
}
