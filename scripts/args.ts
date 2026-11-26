export function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith('--')) continue
    const next = argv[index + 1]
    args.set(value.slice(2), next && !next.startsWith('--') ? next : 'true')
  }
  return args
}
