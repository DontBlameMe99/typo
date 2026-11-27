// Device check for the quick note and quick append tiles. Uses fabricated vault
// data only. The vault folder must already be selected in Typo once, because
// Android grants SAF access through the system folder picker.
//
//   ANDROID_SERIAL=emulator-5560 AGENT_DEVICE=<device CLI> \
//     bun test/helpers/quick-tile-e2e.ts
//
// Screenshots go to .tmp/.

import { mkdir } from 'node:fs/promises'
import { adb, tryAdb, wait } from '../../scripts/android'

const device = process.env.AGENT_DEVICE
if (!device) throw new Error('AGENT_DEVICE must point to the pinned agent-device CLI.')
const pkg = 'org.dontblameme.typo'
const folder = '/sdcard/Documents/TypoAuditDemo'
const tree =
  'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FTypoAuditDemo'

const quickNoteTile = `${pkg}/expo.modules.typoquicknote.QuickNoteTileService`
const quickAppendTile = `${pkg}/expo.modules.typoquicknote.QuickAppendTileService`

function agent(...args: string[]) {
  const result = Bun.spawnSync([device, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(`agent-device ${args.join(' ')} failed:\n${output}`)
  return output
}

async function writeRemote(path: string, text: string, app = false) {
  const encoded = Buffer.from(text, 'utf8').toString('base64')
  const shell = `printf %s ${encoded} | base64 -d > ${path}`
  if (app) await adb('shell', `run-as ${pkg} sh -c '${shell}'`)
  else await adb('shell', `sh -c '${shell}'`)
}

async function tileRef(label: string) {
  const raw = agent('snapshot', '--raw')
  const line = raw
    .split('\n')
    .find((row) => row.includes(`"label":"${label}"`) && row.includes('com.android.systemui'))
  const ref = line?.match(/"ref":"(e\d+)"/)?.[1]
  if (!ref) throw new Error(`Quick Settings tile "${label}" is not visible.\n${raw}`)
  return `@${ref}`
}

async function waitForText(text: string, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (agent('snapshot', '-i').includes(text)) return
    await wait(500)
  }
  throw new Error(`Tile screen did not show "${text}" within ${timeout} ms.`)
}

async function waitForMain() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const focus = await adb('shell', 'dumpsys', 'window')
    if (focus.includes(`${pkg}/${pkg}.MainActivity`)) return
    await wait(500)
  }
  throw new Error('The tile did not return to the app after saving.')
}

await mkdir('.tmp', { recursive: true })
await adb('wait-for-device')
await tryAdb('shell', 'mkdir', folder)
await writeRemote(`${folder}/Inbox.typ`, '= Inbox\n-\n')
await writeRemote(
  'files/typo-vault.json',
  JSON.stringify({ uri: tree, name: 'TypoAuditDemo' }),
  true
)
await writeRemote(
  'files/typo-quick-append.json',
  JSON.stringify({ vaultUri: tree, notePath: 'Inbox.typ', section: 'Inbox' }),
  true
)
for (const tile of [quickNoteTile, quickAppendTile])
  await adb('shell', 'cmd', 'statusbar', 'add-tile', tile)

try {
  adb('shell', 'cmd', 'statusbar', 'expand-settings')
  await wait(2000)
  agent('press', await tileRef('New note'), '--settle')
  await waitForText('Give it a title')
  agent('screenshot', '.tmp/quick-note-tile-e2e.png')
  agent('fill', 'text="Give it a title" editable=true', 'Demo tile note')
  agent(
    'fill',
    'text="Start anywhere. A sentence, a thought, a possibility…" editable=true',
    'Fabricated demo entry from the quick tile.'
  )
  agent('press', 'text="Create note"', '--settle')
  await waitForMain()
  const created = await adb('shell', 'cat', `${folder}/demo_tile_note.typ`)
  if (!created.includes('Demo tile note')) throw new Error('The quick tile note was not saved.')
  console.info('PASS: quick note tile saved and returned to the app')

  adb('shell', 'cmd', 'statusbar', 'expand-settings')
  await wait(2000)
  agent('press', await tileRef('Append note'), '--settle')
  await waitForText('Write a quick note…')
  agent('screenshot', '.tmp/quick-append-tile-e2e.png')
  agent('fill', 'text="Write a quick note…" editable=true', 'Fabricated append from the tile.')
  agent('press', 'text="Append to note"', '--settle')
  await waitForMain()
  const appended = await adb('shell', 'cat', `${folder}/Inbox.typ`)
  if (!appended.includes('Fabricated append from the tile.'))
    throw new Error('The quick append tile did not save its entry.')
  console.info('PASS: quick append tile saved and returned to the app')
  console.info('Screenshots: .tmp/quick-note-tile-e2e.png, .tmp/quick-append-tile-e2e.png')
} finally {
  await adb('shell', 'cmd', 'statusbar', 'collapse')
}
