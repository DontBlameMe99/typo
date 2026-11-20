import { useEffect, useRef } from 'react'
import * as ReactNative from 'react-native'
import { quickTileSession } from './quick-tile-session'

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
    let backgrounded = appState.currentState !== 'active'
    let handled = quickTileSession()
    const subscription = appState.addEventListener('change', (state) => {
      if (state !== 'active') {
        backgrounded = true
        return
      }
      if (!backgrounded) return
      backgrounded = false
      const opened = quickTileSession()
      if (opened === handled) return
      handled = opened
      current.current()
    })
    return () => subscription.remove()
  }, [enabled])
}
