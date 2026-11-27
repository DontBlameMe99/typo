// Points the app at a fixture vault so the startup measurement covers the real
// launch path: a saved folder, a cached library, and a list on screen.
//
// Usage:
//   bun scripts/startup-seed.ts --folder Download/typo-startup --notes 200
//
// The folder is written to shared storage, then installed as the app's saved
// folder with a persisted SAF grant. Seeding the saved state directly keeps the
// cold-start probe independent of the system picker's layout and labels.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { adb, hasText, screenSummary, tryAdb, wait, waitForApp, waitForBoot } from './android'
import { parseArgs } from './args'

const args = parseArgs(process.argv)

const FOLDER = args.get('folder') ?? 'Download/typo-startup'
const NOTES = Number(args.get('notes') ?? 200)
const PACKAGE = args.get('package') ?? 'org.dontblameme.typo'
const FIXTURE = 'startup-fixture-note-001'
const PROVIDER = 'com.android.externalstorage'
const PART_PATTERN = /^[_a-zA-Z0-9.-]+$/u

if (FOLDER.split('/').some((part) => !PART_PATTERN.test(part) || part === '.' || part === '..'))
  throw new Error('folder must be a safe relative path under /sdcard')

function vaultUri() {
  return `content://${PROVIDER}.documents/tree/${encodeURIComponent(`primary:${FOLDER}`)}`
}

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function grantXml(uri: string) {
  return (
    `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n` +
    `<uri-grants>\n` +
    `  <uri-grant sourceUserId="0" targetUserId="0" sourcePkg="${xml(PROVIDER)}" ` +
    `targetPkg="${xml(PACKAGE)}" uri="${xml(uri)}" prefix="true" modeFlags="3" ` +
    `createdTime="${Date.now()}" />\n` +
    `</uri-grants>\n`
  )
}

async function packageUid(packageName: string) {
  const list = await adb('shell', 'pm', 'list', 'packages', '-U')
  const line = list.split('\n').find((value) => value.includes(`package:${packageName} uid:`))
  const uid = /uid:(\d+)/u.exec(line ?? '')?.[1]
  if (!uid) throw new Error(`cannot find the uid of ${packageName}`)
  return uid
}

async function reboot() {
  await adb('reboot')
  // waitForBoot can see the old boot complete before adb drops the device, so
  // wait for the first offline reading before waiting for the new boot.
  const offline = Date.now() + 60_000
  while (
    Date.now() < offline &&
    (await tryAdb('shell', 'getprop', 'sys.boot_completed')).stdout.trim() === '1'
  )
    await wait(500)
  await waitForBoot()
}

function note(index: number) {
  const body = Array.from(
    { length: 12 },
    (_, line) => `Paragraph ${line} of note ${index}: a plain sentence with ordinary words.`
  ).join('\n')
  return `#set page(width: 12cm, height: auto)\n#set text(size: 10pt)\n\n${body}\n`
}

await waitForBoot()
// Persisted grants and the app's private selection file both need root. CI uses
// the rootable google_apis image, not a Play Store build.
await adb('root')
await waitForBoot()

// Shared storage can take a moment to come back after adbd restarts.
const storageDeadline = Date.now() + 60_000
while (Date.now() < storageDeadline) {
  if ((await tryAdb('shell', 'ls', '/sdcard')).exitCode === 0) break
  await wait(1000)
}
await tryAdb('shell', 'rm', '-rf', `/sdcard/${FOLDER}`)
await adb('shell', 'mkdir', '-p', `/sdcard/${FOLDER}`)

const scratch = `${process.env.TMPDIR ?? '/tmp'}/typo-startup-fixture`
await rm(scratch, { recursive: true, force: true })
await mkdir(scratch, { recursive: true })
for (let index = 1; index <= NOTES; index++) {
  const name = `startup-fixture-note-${String(index).padStart(3, '0')}.typ`
  await writeFile(`${scratch}/${name}`, note(index))
}
await adb('push', `${scratch}/.`, `/sdcard/${FOLDER}/`)

const uri = vaultUri()
await writeFile(`${scratch}/urigrants.xml`, grantXml(uri))
await writeFile(
  `${scratch}/typo-vault.json`,
  `${JSON.stringify({ uri, name: FOLDER.split('/').at(-1) })}\n`
)
await adb('push', `${scratch}/urigrants.xml`, '/data/local/tmp/typo-urigrants.xml')
await adb('push', `${scratch}/typo-vault.json`, '/data/local/tmp/typo-vault.json')

// Clearing the app removes its old selection and the grants that came with it.
await adb('shell', 'pm', 'clear', PACKAGE)
await adb('shell', 'cp', '/data/local/tmp/typo-urigrants.xml', '/data/system/urigrants.xml')
await adb('shell', 'chown', 'system:system', '/data/system/urigrants.xml')
await adb('shell', 'chmod', '600', '/data/system/urigrants.xml')

// UriGrantsManagerService reads the grant file during boot.
await reboot()
await adb('root')
await waitForBoot()

const uid = await packageUid(PACKAGE)
const selection = `/data/data/${PACKAGE}/files/typo-vault.json`
await adb('shell', 'mkdir', '-p', `/data/data/${PACKAGE}/files`)
await adb('shell', 'cp', '/data/local/tmp/typo-vault.json', selection)
await adb('shell', 'chown', `${uid}:${uid}`, selection)
await adb('shell', 'chmod', '600', selection)
await adb(
  'shell',
  'rm',
  '-f',
  '/data/local/tmp/typo-urigrants.xml',
  '/data/local/tmp/typo-vault.json'
)
await rm(scratch, { recursive: true, force: true })

await adb('shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`)
await waitForApp(PACKAGE)

// The library paints the fixture's preview once the saved vault is scanned.
// A folder chip or caption in the app chrome cannot stand in for this, since it
// moves with the layout.
const granted = Date.now() + 60_000
while (Date.now() < granted && !(await hasText('Paragraph 0 of note'))) await wait(1000)
if (!(await hasText('Paragraph 0 of note')))
  throw new Error(`the app never opened the saved folder\nlast screen: ${await screenSummary()}`)

// The first launch indexes the vault in the background. Wait for a row to
// appear, then give the library index time to reach the cache the next launch
// reads instead of rescanning.
const deadline = Date.now() + 180_000
while (Date.now() < deadline && !(await hasText(FIXTURE))) await wait(1000)
if (!(await hasText(FIXTURE)))
  throw new Error(
    `the fixture vault never appeared in the library\nlast screen: ${await screenSummary()}`
  )
await wait(4000)
await adb('shell', 'am', 'force-stop', PACKAGE)
console.info(`startup-seed: ${NOTES} fixture notes are indexed at /sdcard/${FOLDER}.`)
