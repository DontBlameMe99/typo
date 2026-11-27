import { describe, expect, test } from 'bun:test'
import {
  childName,
  folderNameValue,
  folderPathForName,
  noteMetadataKey,
  notePathForName,
  renameTitleInSource,
  trashOriginalPath,
} from '../src/app/lifecycle'
import { makeNote } from './helpers/note'

describe('rename paths', () => {
  test('uses a safe filename in the same parent', () => {
    expect(notePathForName('A Fresh Plan', 'notes/old_plan.typ')).toBe('notes/a_fresh_plan.typ')
    expect(notePathForName('Renamed', 'old.typ')).toBe('renamed.typ')
  })

  test('keeps the vault template reserved at the root', () => {
    expect(() => notePathForName('template', 'old.typ')).toThrow(/reserved/u)
    expect(notePathForName('template', 'notes/old.typ')).toBe('notes/template.typ')
  })

  test('moves a folder name inside its parent', () => {
    expect(folderPathForName('New Name', 'projects/old')).toBe('projects/New Name')
    expect(() => folderNameValue('../escape')).toThrow()
    expect(() => folderNameValue('hidden')).not.toThrow()
  })

  test('reads a child name from an encoded SAF document id', () => {
    expect(childName('content://vault/document/primary%3AVault%2Fnotes%2Fold.typ')).toBe('old.typ')
  })
})

describe('renameTitleInSource', () => {
  test('changes the title heading and leaves the body alone', () => {
    const source = '#set page(margin: 2cm)\n#title[Old Name]\n\n= Section\nBody text\n'
    expect(renameTitleInSource(source, 'New & Better')).toBe(
      '#set page(margin: 2cm)\n#title[New & Better]\n\n= Section\nBody text\n'
    )
  })

  test('handles brackets inside the old title and leaves untitled notes alone', () => {
    expect(renameTitleInSource('#title[A [nested] title]\nBody', 'Next')).toBe('#title[Next]\nBody')
    expect(renameTitleInSource('= Just a heading\nBody', 'Next')).toBe('= Just a heading\nBody')
  })
})

describe('noteMetadataKey', () => {
  const before = [makeNote({ uri: 'content://one', path: 'one.typ', source: 'one', modifiedAt: 1 })]

  test('ignores saves that do not change displayed fields', () => {
    const after = [{ ...before[0], source: 'one', pdfUri: 'file://pdf', pdfHash: 'abc' }]
    expect(noteMetadataKey(after)).toBe(noteMetadataKey(before))
  })

  test('changes when a displayed title, path, uri, preview, or date changes', () => {
    expect(noteMetadataKey([{ ...before[0], title: 'Changed' }])).not.toBe(noteMetadataKey(before))
    expect(noteMetadataKey([{ ...before[0], path: 'two.typ' }])).not.toBe(noteMetadataKey(before))
    expect(noteMetadataKey([{ ...before[0], uri: 'content://two' }])).not.toBe(
      noteMetadataKey(before)
    )
    expect(noteMetadataKey([{ ...before[0], source: 'two' }])).not.toBe(noteMetadataKey(before))
    expect(noteMetadataKey([{ ...before[0], modifiedAt: 2 }])).not.toBe(noteMetadataKey(before))
  })

  test('distinguishes note boundaries', () => {
    expect(
      noteMetadataKey([makeNote({ path: 'a', uri: 'b' }), makeNote({ path: 'c', uri: 'd' })])
    ).not.toBe(noteMetadataKey([makeNote({ path: 'ab', uri: 'cd' })]))
  })
})

describe('trashOriginalPath', () => {
  test('strips trash stamps from notes and folders', () => {
    expect(trashOriginalPath('.trash/notes/Plan.2026-02-14T09-30-00-000Z.typ')).toBe(
      'notes/Plan.typ'
    )
    expect(trashOriginalPath('.trash/Old.2026-02-14T09-30-00-000Z-2')).toBe('Old')
    expect(trashOriginalPath('.trash/notes/Plain.typ')).toBe('notes/Plain.typ')
  })
})
