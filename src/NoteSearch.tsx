import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { WebView } from 'react-native-webview'
import { inlineJson } from './editor/document'
import {
  clearDeadlineRestart,
  disarmDeadline,
  expireDeadline,
  markDeadlineArmed,
  searchDeadline,
  shouldArmDeadline,
} from './search/deadline-state'
import { type SearchHit, type SearchScope, SearchTransport } from './search/protocol'
import { parseSearchQuery } from './search/query'
import type { Note, SearchMode, SearchResult } from './types'
import { webRuntime } from './web-runtime'
import { useWebViewForegroundReload } from './webview-resume'

// The runtime lives in its own WebView process, which the OS can kill without
// telling anyone, and a killed runtime looks exactly like a slow one. A query
// that stays unanswered this long is lost, not slow.
const SEARCH_DEADLINE = 30_000
const QUERY_DEBOUNCE = 100
type PendingRequest = { at: number; query: string; mode: SearchMode; scope?: SearchScope }

const scopeKey = (scope?: SearchScope) =>
  `${scope?.folder ?? ''}|${scope?.favorites?.join('\u0000') ?? ''}`

function effectiveRequest(query: string, mode: SearchMode, scope?: SearchScope) {
  const parsed = parseSearchQuery(query)
  return {
    mode: parsed.mode ?? mode,
    scope:
      parsed.folder || scope?.folder ? { ...scope, folder: parsed.folder ?? scope?.folder } : scope,
  }
}

type Props = {
  notes: Note[]
  query: string
  mode: SearchMode
  scope?: SearchScope
  onResults(results: SearchResult[]): void
  onError(message: string): void
  onPending?(pending: boolean): void
}

export function NoteSearch(props: Props) {
  const latest = useRef(props)
  latest.current = props
  const web = useRef<WebView<object>>(null)
  const transport = useRef(new SearchTransport())
  const sequence = useRef(0)
  const requested = useRef<PendingRequest | null>(null)
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deadlineState = useRef(searchDeadline())
  const [debouncedQuery, setDebouncedQuery] = useState(props.query)
  useEffect(() => {
    if (props.query === debouncedQuery) return
    clearDeadlineRestart(deadlineState.current)
    const timer = setTimeout(() => setDebouncedQuery(props.query), QUERY_DEBOUNCE)
    return () => clearTimeout(timer)
  }, [props.query, debouncedQuery])
  const [uri, setUri] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [session, setSession] = useState(0)
  // Each boot is a fresh, empty runtime, and a new object makes every boot
  // resend the query the previous page never answered.
  const [booted, setBooted] = useState<{ session: number } | null>(null)
  const disarm = useCallback(() => {
    disarmDeadline(deadlineState.current)
    if (deadline.current !== null) {
      clearTimeout(deadline.current)
      deadline.current = null
    }
  }, [])
  const restart = useCallback(() => setSession((value) => value + 1), [])
  useWebViewForegroundReload(() => {
    if (booted) {
      disarm()
      restart()
    }
  }, !!uri)
  const fail = useCallback(
    (message: string) => {
      disarm()
      sequence.current++
      requested.current = null
      latest.current.onPending?.(false)
      latest.current.onError(message)
    },
    [disarm]
  )
  const arm = useCallback(
    (query: string) => {
      // A note change sends another request for the same wait, which must not
      // push the deadline back.
      if (!shouldArmDeadline(deadlineState.current, query)) return
      disarm()
      markDeadlineArmed(deadlineState.current, query)
      deadline.current = setTimeout(() => {
        deadline.current = null
        const failed = latest.current.query
        // A runtime that keeps dying would reload the whole vault every deadline,
        // so each query only gets one fresh runtime to try.
        const outcome = expireDeadline(deadlineState.current, failed)
        if (outcome === 'fail') {
          fail('The note search is not responding. Clear the search and try again.')
          return
        }
        fail('The note search stopped responding and is restarting.')
        restart()
      }, SEARCH_DEADLINE)
    },
    [disarm, fail, restart]
  )

  useEffect(() => disarm, [disarm])
  useEffect(() => {
    // A query waiting on a page that has not booted is the state that can hang
    // silently, because no request exists to answer it.
    if (!started || booted?.session === session) return
    if (props.query.trim()) arm(props.query)
    else {
      disarm()
      clearDeadlineRestart(deadlineState.current)
    }
  }, [started, booted, session, props.query, arm, disarm])
  useEffect(() => {
    props.onPending?.(!!props.query.trim())
    if (props.notes.length || props.query.trim()) setStarted(true)
  }, [props.notes.length, props.query, props.onPending])
  useEffect(() => {
    if (!started) return
    let cancelled = false
    void webRuntime('search').then(
      (path) => {
        if (!cancelled) setUri(path)
      },
      (cause) => {
        if (!cancelled) {
          setStarted(false)
          fail(String(cause))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [started, fail])
  useEffect(() => {
    if (booted?.session !== session) return
    if (props.query.trim()) arm(props.query)
    else {
      disarm()
      clearDeadlineRestart(deadlineState.current)
    }
    if (props.query !== debouncedQuery) return
    const { mode, scope } = effectiveRequest(debouncedQuery, props.mode, props.scope)
    const request = transport.current.request(props.notes, debouncedQuery, mode, scope)
    const view = web.current
    if (!request || !view) return
    requested.current = { at: performance.now(), query: debouncedQuery, mode, scope }
    latest.current.onPending?.(!!latest.current.query.trim())
    view.injectJavaScript(
      `window.typoSearch(${inlineJson({ ...request, id: ++sequence.current })});true;`
    )
  }, [
    props.notes,
    props.query,
    debouncedQuery,
    props.mode,
    props.scope,
    booted,
    session,
    arm,
    disarm,
  ])

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
    >
      {uri && (
        <WebView<object>
          key={session}
          ref={web}
          source={{ uri }}
          originWhitelist={['file://*']}
          allowFileAccess
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(request) =>
            request.url === uri || request.url === 'about:blank'
          }
          onError={() => {
            setBooted(null)
            setStarted(false)
            setUri(null)
            fail('The note search could not load.')
          }}
          onRenderProcessGone={() => {
            fail('The note search stopped and is restarting.')
            restart()
          }}
          onMessage={(event) => {
            try {
              const message = JSON.parse(event.nativeEvent.data)
              const fresh = (id: number) => {
                const pending = requested.current
                if (id !== sequence.current || !pending) return false
                const current = effectiveRequest(
                  latest.current.query,
                  latest.current.mode,
                  latest.current.scope
                )
                return (
                  pending.query === latest.current.query &&
                  pending.mode === current.mode &&
                  scopeKey(pending.scope) === scopeKey(current.scope)
                )
              }
              if (message.type === 'boot') {
                disarm()
                transport.current = new SearchTransport()
                setBooted({ session })
              } else if (message.type === 'error') {
                if (message.id == null || fresh(message.id)) fail(String(message.message))
              } else if (message.type === 'results' && fresh(message.id)) {
                disarm()
                clearDeadlineRestart(deadlineState.current)
                if (!Array.isArray(message.results)) throw new Error('Invalid search results')
                const notes = new Map(latest.current.notes.map((note) => [note.path, note]))
                const results: SearchResult[] = []
                for (const hit of message.results as SearchHit[]) {
                  const note = notes.get(hit.path)
                  if (note) results.push({ note, line: hit.line, snippet: hit.snippet })
                }
                if (__DEV__ && requested.current && latest.current.query.trim())
                  console.info(
                    `[performance] ${requested.current.mode === 'names' ? 'Names' : 'Everywhere'} search round trip: ${(performance.now() - requested.current.at).toFixed(1)} ms`
                  )
                latest.current.onPending?.(false)
                latest.current.onResults(results)
              }
            } catch {
              fail('The note search sent an invalid response.')
            }
          }}
        />
      )}
    </View>
  )
}
