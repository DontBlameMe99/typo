import type { ChangeSet } from '@codemirror/state'

export type LiteralRange = {
  from: number
  to: number
  style: string
}

function literalStyle(style: string): boolean {
  return style === 'comment' || style === 'raw' || style === 'string'
}

type LiteralStep = { changes: ChangeSet; inverse: ChangeSet }

export function isLiteralPosition(
  ranges: readonly LiteralRange[],
  pos: number,
  steps?: readonly LiteralStep[]
): boolean {
  if (!steps?.length) return literalPosition(ranges, pos)
  const sourcePositions = [pos, pos]
  for (let index = steps.length - 1; index >= 0; index--) {
    const { inverse } = steps[index]
    sourcePositions[0] = inverse.mapPos(sourcePositions[0], -1)
    sourcePositions[1] = inverse.mapPos(sourcePositions[1], 1)
  }
  for (const sourcePos of sourcePositions) {
    const first = firstAfter(ranges, sourcePos)
    // Edits can collapse a range at the caret. Map neighboring source ranges
    // through every edit instead of scanning all highlights in the note.
    for (
      let index = Math.max(0, first - 1);
      index <= Math.min(ranges.length - 1, first + 1);
      index++
    ) {
      const range = ranges[index]
      let from = range.from
      let to = range.to
      for (const step of steps) {
        from = step.changes.mapPos(from, 1)
        to = step.changes.mapPos(to, -1)
      }
      if (from < pos && to > pos && literalStyle(range.style)) return true
    }
  }
  return false
}

function firstAfter(ranges: readonly LiteralRange[], pos: number): number {
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (ranges[middle].to <= pos) low = middle + 1
    else high = middle
  }
  return low
}

function literalPosition(ranges: readonly LiteralRange[], pos: number): boolean {
  const range = ranges[firstAfter(ranges, pos)]
  return !!range && range.from < pos && literalStyle(range.style)
}
