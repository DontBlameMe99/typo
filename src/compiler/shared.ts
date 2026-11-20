import { sha256 } from '../hash'

// Mirrors the notes vault's sharedHash: every .typ file under style and the
// root bibliography are part of every note's rendered result.
export function sharedStamp(hashes: Map<string, string>): string {
  const shared = [...hashes]
    .filter(
      ([path]) =>
        path === 'bibliography.yml' || (path.startsWith('style/') && path.endsWith('.typ'))
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${hash}  ${path}\n`)
    .join('')
  return sha256(shared)
}
