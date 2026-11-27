import type { Diagnostic } from './diagnostics'
import type { PackageSpec } from './protocol'

export type CompilerMessage =
  | { type: 'boot' }
  | { type: 'crash'; message?: string }
  | { type: 'error'; id?: number; message?: string }
  | { type: 'pdf'; id: number; base64: string; dependencies: string[]; issues: Diagnostic[] }
  | { type: 'diagnostics'; id: number; message?: string; issues: Diagnostic[] }
  | { type: 'packages'; id: number; packages: PackageSpec[] }

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
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
      message,
    })
  }
  return issues
}

export function compilerMessage(json: string): CompilerMessage | null {
  const value: unknown = JSON.parse(json)
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'boot':
      return { type: 'boot' }
    case 'crash':
      return { type: 'crash', message: text(record.message) }
    case 'error': {
      if (record.id != null && typeof record.id !== 'number') return null
      const id = typeof record.id === 'number' ? record.id : undefined
      return { type: 'error', id, message: text(record.message) }
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
        id: record.id,
        message: text(record.message),
        issues: readIssues(record.issues),
      }
    }
    case 'packages': {
      if (typeof record.id !== 'number' || !Array.isArray(record.packages)) return null
      return { type: 'packages', id: record.id, packages: record.packages as PackageSpec[] }
    }
    default:
      return null
  }
}
