import { useEffect, useRef } from 'react'
import * as ReactNative from 'react-native'

type AppStateLike = {
  currentState: string
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void }
}

const appState = (ReactNative as { AppState?: AppStateLike }).AppState

// An app resumed from a Quick Settings tile can come back with WebView native
// instances that were released while the main activity was behind the tile.
// React state still says they are ready, so their pages never boot again.
export function useWebViewForegroundReload(reload: () => void, enabled = true): void {
  const current = useRef(reload)
  current.current = reload
  useEffect(() => {
    if (!enabled || !appState) return
    let backgrounded = appState.currentState !== 'active'
    const subscription = appState.addEventListener('change', (state) => {
      if (state !== 'active') {
        backgrounded = true
        return
      }
      if (!backgrounded) return
      backgrounded = false
      current.current()
    })
    return () => subscription.remove()
  }, [enabled])
}
