export type SearchDeadline = {
  armed: string | null
  restarted: string | null
}

export function searchDeadline(): SearchDeadline {
  return { armed: null, restarted: null }
}

export function shouldArmDeadline(state: SearchDeadline, query: string): boolean {
  return state.armed !== query
}

export function markDeadlineArmed(state: SearchDeadline, query: string): void {
  state.armed = query
}

export function disarmDeadline(state: SearchDeadline): void {
  state.armed = null
}

export function clearDeadlineRestart(state: SearchDeadline): void {
  state.restarted = null
}

export function expireDeadline(state: SearchDeadline, query: string): 'restart' | 'fail' {
  state.armed = null
  if (state.restarted === query) return 'fail'
  state.restarted = query
  return 'restart'
}
