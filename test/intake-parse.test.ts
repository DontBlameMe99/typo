import { expect, test } from 'bun:test'
import {
  parseDeepLink,
  parseIncomingIntent,
  safeImportName,
  safeNotePath,
  sharedTitle,
} from '../src/intake-parse'

test('a file manager VIEW intent imports a .typ file with a safe name', () => {
  expect(
    parseIncomingIntent({
      action: 'android.intent.action.VIEW',
      url: 'content://com.example.provider/document/42/../../Invoice%20.typ',
      type: 'application/x-typst',
      name: '../../Invoice .typ',
    })
  ).toEqual({
    kind: 'import',
    uri: 'content://com.example.provider/document/42/../../Invoice%20.typ',
    name: 'Invoice .typ',
  })
})

test('a VIEW intent for a file URI relies on the .typ suffix', () => {
  const route = parseIncomingIntent({
    action: 'VIEW',
    url: 'file:///sdcard/Download/fabricated.typ',
    type: 'application/octet-stream',
  })
  expect(route?.kind).toBe('import')
  expect(route).toMatchObject({ name: 'fabricated.typ' })
})

test('SEND text creates a note with a fabricated title', () => {
  expect(
    parseIncomingIntent({
      action: 'android.intent.action.SEND',
      type: 'text/plain',
      subject: 'Outside/idea:',
      text: 'Fabricated body\nsecond line',
    })
  ).toEqual({ kind: 'new', title: 'Outside idea', body: 'Fabricated body\nsecond line' })
})

test('SEND streams accept octet-stream and synthesize a name', () => {
  expect(
    parseIncomingIntent({
      action: 'SEND',
      type: 'application/octet-stream',
      url: 'content://com.example.provider/document/shared',
    })
  ).toEqual({
    kind: 'import',
    uri: 'content://com.example.provider/document/shared',
    name: 'shared.typ',
  })
})

test('unsupported intents and deep links are ignored', () => {
  expect(
    parseIncomingIntent({ action: 'SEND', type: 'image/png', url: 'content://x/y.png' })
  ).toBeNull()
  expect(parseIncomingIntent({ action: 'PICK', url: 'typo://note/a.typ' })).toBeNull()
  expect(parseDeepLink('http://example.com/note/a.typ')).toBeNull()
  expect(parseDeepLink('typo://note/../secret.typ')).toBeNull()
  expect(parseDeepLink('typo://import?uri=https://example.com/a.typ')).toBeNull()
  expect(parseDeepLink('typo://import?uri=file%3A%2F%2Fsdcard%2Fsecret.typ')).toBeNull()
})

test('typo deep links route to import, note, and new note', () => {
  expect(
    parseDeepLink('typo://import?uri=content%3A%2F%2Fprovider%2Fdoc%2F9&name=Demo.typ')
  ).toEqual({
    kind: 'import',
    uri: 'content://provider/doc/9',
    name: 'Demo.typ',
  })
  expect(parseDeepLink('typo://note/folder%2Fdraft.typ')).toEqual({
    kind: 'note',
    path: 'folder/draft.typ',
  })
  expect(parseDeepLink('typo://note?path=a.typ')).toEqual({ kind: 'note', path: 'a.typ' })
  expect(parseDeepLink('typo://new?subject=Demo&text=Hello%20world')).toEqual({
    kind: 'new',
    title: 'Demo',
    body: 'Hello world',
  })
})

test('MIME parameters and percent signs do not change intake routing', () => {
  expect(
    parseIncomingIntent({
      action: 'VIEW',
      url: 'content://provider/document/9',
      type: 'application/x-typst; charset=utf-8',
    })?.kind
  ).toBe('import')
  expect(safeImportName('100%.typ')).toBe('100_.typ')
  expect(sharedTitle('Buy milk.')).toBe('Buy milk')
  expect(
    parseIncomingIntent({ action: 'SEND', type: 'text/plain', text: 'Buy milk.' })
  ).toMatchObject({
    title: 'Buy milk',
  })
})

test('long shared names keep their .typ extension', () => {
  const name = safeImportName('a'.repeat(300))
  expect(name).toHaveLength(180)
  expect(name.endsWith('.typ')).toBe(true)
  expect(safeNotePath('/absolute.typ')).toBeNull()
})
