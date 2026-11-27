// Builds a fictional demo vault for emulator audits. Nothing here comes from a
// real user vault. Every run writes a fresh directory under .tmp and, with
// --push, replaces only /sdcard/Download/typo-audit-demo on the selected device.
//
// Usage:
//   bun scripts/audit-demo-seed.ts
//   ANDROID_SERIAL=emulator-5556 bun scripts/audit-demo-seed.ts --push
//   ... --push --rename-title 'NIMBUS-DEMO Renamed Beacon'
//
// Prints DEMO_DIR and DEVICE_FOLDER for the capture script.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { adb } from './android'
import { parseArgs } from './args'

const args = parseArgs(process.argv)
const DEVICE_FOLDER = args.get('device-folder') ?? 'Download/typo-audit-demo'

if (!/^[\w-]+\/[\w-]+$/u.test(DEVICE_FOLDER))
  throw new Error('device-folder must be two simple path segments')

function pdfPage(text: string): string {
  return `BT /F1 20 Tf 72 760 Td (${text.replace(/[()\\]/gu, '\\$&')}) Tj ET`
}

function multiPagePdf(pages: string[]): string {
  const objects: string[] = []
  const pageIds = pages.map((_, index) => 4 + index * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  for (const [index, text] of pages.entries()) {
    const id = 4 + index * 2
    const stream = pdfPage(text)
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  }
  let output = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = output.length
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = output.length
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++)
    output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return output
}

await mkdir('.tmp', { recursive: true })
const scratch = (await Bun.$`mktemp -d -p .tmp audit-demo-XXXXXX`.text()).trim()
const vault = join(scratch, 'vault')
await mkdir(join(vault, 'Inbox'), { recursive: true })
await mkdir(join(vault, 'Projects'), { recursive: true })
await mkdir(join(vault, 'Archive'), { recursive: true })
await mkdir(join(vault, 'out'), { recursive: true })

const files: Record<string, string> = {
  'template.typ': `#set page(margin: 2.5cm)
#set text(font: "Libertinus Serif")
#let title(body) = align(center, text(size: 22pt, weight: "bold", body))
#title[{{title}}]
{{body}}
`,
  'Inbox/Welcome to Nimbus.typ': `#title[Welcome to Nimbus]
#set text(size: 11pt)

NIMBUS-DEMO note created for repeatable emulator audits. Cloud Harbor is fictional. NIMBUS-DEMO-REDACTION-CHECK.
`,
  'Projects/Moon Relay.typ': `#title[Moon Relay]
#set text(size: 11pt)

NIMBUS-DEMO relay log. The map below is fabricated.

#image("moon-map.svg", width: 10cm)

= Uplink
Beacon Wren sends fictional postcards from the crater.
`,
  'Projects/moon-map.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<rect width="640" height="360" fill="#1e1e2e"/>
<circle cx="320" cy="180" r="110" fill="#eff1f5"/>
<circle cx="280" cy="150" r="18" fill="#a6adc8"/>
<circle cx="360" cy="205" r="26" fill="#a6adc8"/>
<text x="24" y="336" fill="#89b4fa" font-family="sans-serif" font-size="24">NIMBUS-DEMO Moon Map</text>
</svg>
`,
  'Projects/Nimbus Atlas.typ': `#title[Nimbus Atlas]
#set text(size: 13pt)

NIMBUS-DEMO atlas page one.

#pagebreak()

NIMBUS-DEMO atlas page two.

#pagebreak()

NIMBUS-DEMO atlas page three.
`,
  'out/Nimbus Atlas.pdf': multiPagePdf([
    'NIMBUS-DEMO atlas page one',
    'NIMBUS-DEMO atlas page two',
    'NIMBUS-DEMO atlas page three',
  ]),
}

const paragraphs = Array.from(
  { length: 240 },
  (_, index) =>
    `NIMBUS-DEMO long note paragraph ${index + 1}. Field notes from the imaginary island of Vellum.`
)
files['Archive/Long Field Notes.typ'] =
  `#title[Long Field Notes]\n#set text(size: 10pt)\n\n${paragraphs.join('\n\n')}\n`

files['Inbox/Ümlaut Harbour — 東京.typ'] =
  `#title[Ümlaut Harbour — 東京]\r\n#set text(size: 11pt)\r\n\r\n` +
  `NIMBUS-DEMO CRLF note. Crème brûlée, façade, 東京, naïve, café.\r\n`

for (const [name, content] of Object.entries(files)) await writeFile(join(vault, name), content)

const destination = `/sdcard/${DEVICE_FOLDER}`
const renamePath = args.get('rename-path') ?? 'Inbox/Welcome to Nimbus.typ'
const renameTitle = args.get('rename-title')
if (renameTitle) {
  if (renamePath.includes('..') || !(renamePath in files))
    throw new Error('rename-path must name a file in this demo vault')
  const target = join(vault, renamePath)
  const source = await readFile(target, 'utf8')
  await writeFile(target, source.replace(/^#title\[[^\]]*\]/u, `#title[${renameTitle}]`))
}
if (args.has('push')) {
  await adb('shell', 'rm', '-rf', destination)
  await adb('shell', 'mkdir', '-p', destination)
  await adb('push', `${vault}/.`, `${destination}/`)
  console.info(`DEVICE_FOLDER=${destination}`)
}
console.info(`DEMO_DIR=${vault}`)
