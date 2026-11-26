import { expect, test } from 'bun:test'
import {
  clearDeadlineRestart,
  disarmDeadline,
  expireDeadline,
  markDeadlineArmed,
  searchDeadline,
  shouldArmDeadline,
} from '../src/search/deadline-state'

test('a deadline is armed once per query and disarmed independently of the restart budget', () => {
  const state = searchDeadline()
  expect(state).toEqual({ armed: null, restarted: null })
  expect(shouldArmDeadline(state, 'one')).toBe(true)
  markDeadlineArmed(state, 'one')
  expect(shouldArmDeadline(state, 'one')).toBe(false)
  expect(shouldArmDeadline(state, 'two')).toBe(true)
  markDeadlineArmed(state, 'two')
  disarmDeadline(state)
  expect(state).toEqual({ armed: null, restarted: null })
})

test('one query only gets one fresh runtime', () => {
  const state = searchDeadline()
  markDeadlineArmed(state, 'one')
  expect(expireDeadline(state, 'one')).toBe('restart')
  expect(state.armed).toBeNull()
  expect(expireDeadline(state, 'one')).toBe('fail')
  expect(state.restarted).toBe('one')
})

test('a different query gets its own restart', () => {
  const state = searchDeadline()
  expireDeadline(state, 'one')
  expect(expireDeadline(state, 'two')).toBe('restart')
  expect(state.restarted).toBe('two')
})

test('ending a search clears the restart budget', () => {
  const state = searchDeadline()
  expireDeadline(state, 'one')
  clearDeadlineRestart(state)
  expect(state.restarted).toBeNull()
  expect(expireDeadline(state, 'one')).toBe('restart')
})
