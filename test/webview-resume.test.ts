import { expect, test } from 'bun:test'
import { initialWebViewResumeState, nextWebViewResumeState } from '../src/webview-resume-state'

test('ordinary app switches keep the WebView state', () => {
  let state = initialWebViewResumeState(0, 'active')
  const background = nextWebViewResumeState(state, 'background', 0)
  expect(background.reload).toBe(false)
  state = background.state
  const foreground = nextWebViewResumeState(state, 'active', 0)
  expect(foreground.reload).toBe(false)
})

test('a tile reload waits for the tile to close before returning to the app', () => {
  let state = initialWebViewResumeState(0, 'active')
  state = nextWebViewResumeState(state, 'background', 0).state

  const tile = nextWebViewResumeState(state, 'active', 1)
  expect(tile.reload).toBe(false)
  state = tile.state

  const tileClosed = nextWebViewResumeState(state, 'background', 1)
  expect(tileClosed.reload).toBe(false)
  state = tileClosed.state

  const app = nextWebViewResumeState(state, 'active', 1)
  expect(app.reload).toBe(true)
  state = app.state

  state = nextWebViewResumeState(state, 'background', 1).state
  expect(nextWebViewResumeState(state, 'active', 1).reload).toBe(false)
})

test('a second tile cannot reuse the first tile background event', () => {
  let state = initialWebViewResumeState(0, 'active')
  state = nextWebViewResumeState(state, 'background', 0).state
  state = nextWebViewResumeState(state, 'active', 1).state
  state = nextWebViewResumeState(state, 'background', 1).state

  const secondTile = nextWebViewResumeState(state, 'active', 2)
  expect(secondTile.reload).toBe(false)
  state = secondTile.state
  state = nextWebViewResumeState(state, 'background', 2).state

  const app = nextWebViewResumeState(state, 'active', 2)
  expect(app.reload).toBe(true)
})

test('a session opened before the hook mounts is already handled', () => {
  const state = initialWebViewResumeState(1, 'active')
  expect(nextWebViewResumeState(state, 'background', 1).reload).toBe(false)
  expect(nextWebViewResumeState(state, 'active', 1).reload).toBe(false)
})
