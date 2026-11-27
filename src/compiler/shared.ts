import { sha256 } from '../hash'

// Everything except note sources is shared state: images, data files and fonts can
// change any note's PDF. Typ files under style and assets are shared as well.
export function sharedStamp(hashes: Map<string, string>): string {
  const shared = [...hashes]
    .filter(
      ([path]) =>
        !path.startsWith('packages/') && (!/\.typ$/iu.test(path) || /^(style|assets)\//u.test(path))
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${hash}  ${path}\n`)
    .join('')
  return sha256(shared)
}
