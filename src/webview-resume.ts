import { useEffect, useRef } from 'react'
import * as ReactNative from 'react-native'
import { quickTileSession } from './quick-tile-session'
import { initialWebViewResumeState, nextWebViewResumeState } from './webview-resume-state'

type AppStateLike = {
  currentState: string
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void }
}

const appState = (ReactNative as { AppState?: AppStateLike }).AppState

// A tile opens a second activity while the main one is behind it. Its WebViews
// can come back with released native instances, so those sessions need a fresh
// page. Ordinary app switches must keep the existing editor state.
export function useWebViewForegroundReload(reload: () => void, enabled = true): void {
  const current = useRef(reload)
  current.current = reload
  useEffect(() => {
    if (!enabled || !appState) return
    let state = initialWebViewResumeState(quickTileSession(), appState.currentState)
    const subscription = appState.addEventListener('change', (next) => {
      const transition = nextWebViewResumeState(state, next, quickTileSession())
      state = transition.state
      if (transition.reload) current.current()
    })
    return () => subscription.remove()
  }, [enabled])
}
