export type WebViewResumeState = {
  backgrounded: boolean
  tileBackgroundSession: number | null
  handled: number
}

export function initialWebViewResumeState(session: number, state: string): WebViewResumeState {
  return { backgrounded: state !== 'active', tileBackgroundSession: null, handled: session }
}

// AppState events are shared with the quick tile activity. An active event can
// belong to that activity, while the main WebViews are still behind it. Reload
// only after the tile has gone back to the background and the app is foreground
// again, so the new native views survive and get painted.
export function nextWebViewResumeState(
  current: WebViewResumeState,
  state: string,
  session: number
): { state: WebViewResumeState; reload: boolean } {
  if (state !== 'active') {
    return {
      state: {
        backgrounded: true,
        tileBackgroundSession:
          session === current.handled ? current.tileBackgroundSession : session,
        handled: current.handled,
      },
      reload: false,
    }
  }
  if (!current.backgrounded) return { state: current, reload: false }
  if (session === current.handled || current.tileBackgroundSession !== session) {
    return {
      state: { ...current, backgrounded: false, tileBackgroundSession: null },
      reload: false,
    }
  }
  return {
    state: { backgrounded: false, tileBackgroundSession: null, handled: session },
    reload: true,
  }
}
