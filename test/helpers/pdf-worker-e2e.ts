// Device check: serve a fabricated two-page PDF to the offline viewer, open it
// in Chrome on an emulator, and assert that the real PDF worker posted a
// rendered message.
//
//   ANDROID_SERIAL=emulator-5560 AGENT_DEVICE=<device CLI> \
//     bun test/helpers/pdf-worker-e2e.ts
//
// Requires a built `dist/` (bun run build:web). Screenshots go to .tmp/.

import { mkdir } from 'node:fs/promises'
import { adb, wait } from '../../scripts/android'
import { pdfHtml } from '../../src/pdf/document'
import { syntheticPdf } from './synthetic-pdf'

const device = process.env.AGENT_DEVICE
if (!device) throw new Error('AGENT_DEVICE must point to the pinned agent-device CLI.')
const port = Number(process.env.PDF_E2E_PORT ?? 8097)
const url = `http://10.0.2.2:${port}/`
const marker = 'PDF_E2E rendered'

function agent(...args: string[]) {
  const result = Bun.spawnSync([device, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(`agent-device ${args.join(' ')} failed:\n${output}`)
  return output
}

await mkdir('.tmp', { recursive: true })
const bundles = {
  '/pdf.bundle.js': 'dist/pdf.bundle.txt',
  '/pdf-worker.bundle.js': 'dist/pdf-worker.bundle.txt',
  '/pdf-renderer.bundle.js': 'dist/pdf-renderer.bundle.txt',
}
const sources = new Map<string, string>()
for (const [route, file] of Object.entries(bundles))
  sources.set(
    route,
    route === '/pdf-worker.bundle.js' && process.env.PDF_E2E_BREAK_WORKER === '1'
      ? '/* deliberately broken worker for the negative check */'
      : await Bun.file(file).text()
  )

const html = pdfHtml().replace(
  '</body>',
  `<script>const status=document.getElementById('status');const show=(text)=>{status.textContent=text;document.title=text};window.onerror=(message)=>show('PDF_E2E error '+message);window.onunhandledrejection=(event)=>show('PDF_E2E rejection '+event.reason);window.ReactNativeWebView={postMessage(message){const data=JSON.parse(message);if(data.type==='rendered')show('${marker} '+data.page+'/'+data.pages);else if(data.type==='error')show('PDF_E2E error '+data.message)}};const NativeXHR=window.XMLHttpRequest;window.XMLHttpRequest=class extends NativeXHR{open(method,uri,...rest){return super.open(method,String(uri).startsWith('file:///typo-e2e/')?location.origin+'/'+String(uri).split('/').pop():uri,...rest)}};window.typoPdf.load('file:///typo-e2e/demo.pdf');</script></body>`
)

const server = Bun.serve({
  hostname: '0.0.0.0',
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/') return new Response(html, { headers: { 'content-type': 'text/html' } })
    if (path === '/demo.pdf')
      return new Response(syntheticPdf().buffer as ArrayBuffer, {
        headers: { 'content-type': 'application/pdf' },
      })
    const source = sources.get(path)
    if (source) return new Response(source, { headers: { 'content-type': 'text/javascript' } })
    return new Response('Not found', { status: 404 })
  },
})

let last = ''
try {
  await adb('wait-for-device')
  console.info(`Opening ${url} on ${process.env.ANDROID_SERIAL ?? 'the default device'}`)
  agent('open', 'com.android.chrome', url, '--foreground')
  const deadline = Date.now() + Number(process.env.PDF_E2E_TIMEOUT_MS ?? 120_000)
  while (Date.now() < deadline) {
    last = agent('snapshot', '-i')
    if (new RegExp(`${marker} [12]/2`).test(last)) break
    await wait(1000)
  }
  if (!new RegExp(`${marker} [12]/2`).test(last)) {
    throw new Error(`The viewer never posted a rendered message.\nLast snapshot:\n${last}`)
  }
  const shot = '.tmp/pdf-worker-e2e.png'
  agent('screenshot', shot)
  console.info(`PASS: ${last.match(new RegExp(`${marker} [12]/2`))?.[0]}`)
  console.info(`Screenshot: ${shot}`)
} finally {
  server.stop(true)
}
