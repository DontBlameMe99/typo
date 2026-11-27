import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { markQuickTileOpened, quickTileSession } from '../src/quick-tile-session'

test('every tile open starts a separate WebView session', () => {
  const before = quickTileSession()
  markQuickTileOpened()
  expect(quickTileSession()).toBe(before + 1)
  markQuickTileOpened()
  expect(quickTileSession()).toBe(before + 2)
})

test('tile availability, launch targets, and background close stay wired', async () => {
  const service = await readFile(
    new URL(
      '../modules/typo-quick-note/android/src/main/java/expo/modules/typoquicknote/QuickTileService.kt',
      import.meta.url
    ),
    'utf8'
  )
  const append = await readFile(
    new URL(
      '../modules/typo-quick-note/android/src/main/java/expo/modules/typoquicknote/QuickAppendTileService.kt',
      import.meta.url
    ),
    'utf8'
  )
  const noteActivity = await readFile(
    new URL(
      '../modules/typo-quick-note/android/src/main/java/expo/modules/typoquicknote/QuickNoteActivity.kt',
      import.meta.url
    ),
    'utf8'
  )
  const sheet = await readFile(new URL('../src/quick-sheet.tsx', import.meta.url), 'utf8')
  expect(service).toContain('override fun onTileAdded()')
  expect(service).toContain('override fun onStartListening()')
  expect(service).toContain('if (!available()) return')
  expect(service).toContain('QuickAppendActivity::class.java else QuickNoteActivity::class.java')
  expect(append).toContain(
    'QuickConfig.availability(filesDir, QuickConfig.persistedGrants(this)).canAppend'
  )
  expect(noteActivity).toContain('QuickSheets.register(getMainComponentName(), this)')
  expect(sheet).toContain('markQuickTileOpened()')
  expect(sheet).toContain("if (active && state === 'background') close()")
})
