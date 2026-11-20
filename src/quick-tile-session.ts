let session = 0

export function markQuickTileOpened(): void {
  session += 1
}

export function quickTileSession(): number {
  return session
}
