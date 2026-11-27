export const WEBVIEW_RUNTIME_ERROR = 'WEBVIEW_RUNTIME_ERROR'

export function runtimeErrorScript(component: string): string {
  return `(${String.raw`function reportRuntimeErrors(component) {
  const LIMIT = 200
  const CODE = ${JSON.stringify(WEBVIEW_RUNTIME_ERROR)}
  const basename = (path) => {
    const parts = path.split(/[\\/]/u).filter(Boolean)
    return parts[parts.length - 1] || ''
  }
  const stripPaths = (value) =>
    value.replace(/(?:file:\/\/)?(?:[A-Za-z]:)?(?:[\\/][^\s:'"()]+)+/gu, basename)
  const describe = (cause) => {
    const name =
      cause && typeof cause === 'object' && typeof cause.name === 'string'
        ? cause.name
        : 'Error'
    const raw =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
          ? cause
          : cause == null
            ? 'No error details were provided.'
            : String(cause)
    const first = String(raw).split('\n', 1)[0].trim() || 'Unknown error'
    return name + ': ' + stripPaths(first)
  }
  const send = (cause) =>
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({
        type: 'error',
        code: CODE,
        message: (component + ' failed: ' + describe(cause)).slice(0, LIMIT),
      })
    )
  window.addEventListener(
    'error',
    (event) => {
      if (event.error) {
        send(event.error)
        return
      }
      const target = event.target
      if (target?.tagName === 'SCRIPT') {
        send('Cannot load bundled script: ' + target.src.split('/').pop())
        return
      }
      const location = event.filename
        ? ' ' + event.filename.split('/').pop() + ', line ' + event.lineno + ', column ' + event.colno
        : ''
      const detail =
        !event.message || /^script error\.?$/iu.test(event.message)
          ? 'Android did not provide script error details. Close and reopen the note to retry.'
          : event.message
      send(detail + location)
    },
    true
  )
  window.addEventListener('unhandledrejection', (event) => send(event.reason))
}`})(${JSON.stringify(component)})`
}
