// Compares a startup measurement with the recorded floor from main.
//
// The floor is one number from one runner class, so it is a regression gate,
// not a target: pull requests only fail when startup grows past the floor by
// more than the margin below. Phase timings are reported for context.

import { parseArgs } from './args'
import type { StartupReport } from './startup'

// Bumping the method invalidates every recorded floor, which is required
// whenever the measurement itself changes.
// The emulator configuration is part of the measurement: 2 cores instead of 4
// so the guest keeps up with the host and stops throwing launcher ANRs.
export const METHOD = 2
export const FAIL_MARGIN = 0.25
export const WARN_MARGIN = 0.15
// The emulator cannot resolve better than this, and an unchanged app still
// moves by tens of milliseconds between runner instances.
export const FLOOR_MS = 50

export type Floor = {
  method: number
  sha: string
  bestMs: number
  medianMs: number
  phases: Record<string, number>
}

export type Row = {
  name: string
  headMs: number
  floorMs: number | null
  delta: string
}

export type PhaseBudget = {
  name: string
  headMs: number
  floorMs: number | null
  budgetMs: number | null
  status: 'ok' | 'warn' | 'fail' | 'pending'
}

export type Comparison = {
  status: 'ok' | 'warn' | 'fail' | 'pending'
  rows: Row[]
  phaseBudgets: PhaseBudget[]
  note: string
}

function percent(value: number, reference: number) {
  const change = (value / reference - 1) * 100
  const rounded = Math.round(change)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

function phaseBudgets(head: StartupReport, floor: Floor | null): PhaseBudget[] {
  const names = [
    ...new Set([...Object.keys(head.phases), ...Object.keys(floor?.phases ?? {})]),
  ].sort()
  return names.map((name) => {
    const headMs = head.phases[name] ?? 0
    const floorMs = floor?.phases[name] ?? null
    const budgetMs = floorMs === null ? null : Math.round(floorMs * (1 + FAIL_MARGIN) + FLOOR_MS)
    const warnMs = floorMs === null ? null : Math.round(floorMs * (1 + WARN_MARGIN) + FLOOR_MS)
    return {
      name,
      headMs,
      floorMs,
      budgetMs,
      status:
        budgetMs === null
          ? 'pending'
          : headMs > budgetMs
            ? 'fail'
            : headMs > (warnMs ?? 0)
              ? 'warn'
              : 'ok',
    }
  })
}

function phaseRows(budgets: PhaseBudget[]): Row[] {
  return budgets.map(({ name, headMs, floorMs }) => ({
    name,
    headMs,
    floorMs,
    delta: floorMs === null ? 'new' : percent(headMs, floorMs),
  }))
}

export function compareStartup(head: StartupReport, floor: Floor | null): Comparison {
  const coldStart = (delta: string, reference: number | null): Row => ({
    name: 'Cold start',
    headMs: head.bestMs,
    floorMs: reference,
    delta,
  })
  const budgets = phaseBudgets(head, floor)
  const phaseStatus = budgets.some((budget) => budget.status === 'fail')
    ? 'fail'
    : budgets.some((budget) => budget.status === 'warn')
      ? 'warn'
      : 'ok'
  const failedPhases = budgets
    .filter((budget) => budget.status === 'fail')
    .map((budget) => budget.name)
  if (floor === null)
    return {
      status: 'pending',
      rows: [coldStart('new', null), ...phaseRows(budgets)],
      phaseBudgets: budgets,
      note: 'No floor is recorded for this method yet. This run becomes the floor once it lands on main.',
    }
  if (floor.method !== METHOD)
    return {
      status: 'pending',
      rows: [coldStart('new method', null), ...phaseRows(budgets)],
      phaseBudgets: budgets,
      note: `The floor was recorded with method ${floor.method}, not ${METHOD}. This run becomes the new floor once it lands on main.`,
    }
  const limit = floor.bestMs * (1 + FAIL_MARGIN) + FLOOR_MS
  const warn = floor.bestMs * (1 + WARN_MARGIN) + FLOOR_MS
  const coldStatus = head.bestMs > limit ? 'fail' : head.bestMs > warn ? 'warn' : 'ok'
  const status =
    coldStatus === 'fail' || phaseStatus === 'fail'
      ? 'fail'
      : coldStatus === 'warn' || phaseStatus === 'warn'
        ? 'warn'
        : 'ok'
  const note =
    status === 'fail'
      ? `Cold start grew by more than ${FAIL_MARGIN * 100}% + ${FLOOR_MS} ms over the floor.`
      : status === 'warn'
        ? 'Cold start is above the floor. Check the phase timings for the cause.'
        : 'Cold start is within the floor.'
  return {
    status,
    rows: [coldStart(percent(head.bestMs, floor.bestMs), floor.bestMs), ...phaseRows(budgets)],
    phaseBudgets: budgets,
    note: failedPhases.length ? `${note} Phases over budget: ${failedPhases.join(', ')}.` : note,
  }
}

export function renderComment(head: StartupReport, comparison: Comparison) {
  const lines = [
    '<!-- startup-report -->',
    '### Startup',
    '',
    `Cold start to the first library frame: **${head.bestMs} ms** best of ${head.runs} launches on an Android emulator (median ${head.medianMs} ms).`,
    '',
  ]
  lines.push(comparison.note, '')
  lines.push('| Phase | This run | Floor | Change |', '| --- | --- | --- | --- |')
  for (const row of comparison.rows)
    lines.push(
      `| ${row.name} | ${row.headMs} ms | ${row.floorMs === null ? '-' : `${row.floorMs} ms`} | ${row.delta} |`
    )
  const budgets = comparison.phaseBudgets
    .filter((budget) => budget.budgetMs !== null)
    .map(
      (budget) => `\`${budget.name}\` ${budget.headMs} / ${budget.budgetMs} ms (${budget.status})`
    )
  lines.push(
    '',
    'Phases are marks from the first line of the JS bundle: `bundle` is module evaluation, `theme` and `library` are the saved appearance and library reads, `commit` is the first library commit behind the launch screen, `reveal` is the layout-effect handoff, and `paint` is the first frame the user can see.',
    budgets.length ? `Phase budgets: ${budgets.join(', ')}.` : 'Phase budgets: pending.',
    '',
    `Samples: ${head.samples.join(', ')} ms`
  )
  return `${lines.join('\n')}\n`
}

if (import.meta.main) {
  const args = parseArgs(process.argv)
  const headPath = args.get('head')
  if (!headPath) throw new Error('--head is required')
  const head = (await Bun.file(headPath).json()) as StartupReport
  const floorPath = args.get('floor')
  const floor =
    floorPath && (await Bun.file(floorPath).exists())
      ? ((await Bun.file(floorPath).json()) as Floor)
      : null
  const recordPath = args.get('record')
  if (recordPath) {
    const sha = args.get('sha')
    if (!sha) throw new Error('--sha is required with --record')
    const recorded: Floor = {
      method: METHOD,
      sha,
      bestMs: head.bestMs,
      medianMs: head.medianMs,
      phases: head.phases,
    }
    await Bun.write(recordPath, `${JSON.stringify(recorded, null, 2)}\n`)
  }
  const comparison = compareStartup(head, floor)
  const comment = renderComment(head, comparison)
  const commentPath = args.get('comment')
  if (commentPath) await Bun.write(commentPath, comment)
  const resultPath = args.get('result')
  if (resultPath) await Bun.write(resultPath, `${comparison.status}\n`)
  // The workflow only reads the files, but a local run should still explain itself.
  console.info(comment)
}
