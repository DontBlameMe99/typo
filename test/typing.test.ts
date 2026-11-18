import { describe, expect, test } from 'bun:test'
import { autoEdit } from '../src/editor/typing'

const next = (line: string) => {
  const edit = autoEdit(line, line.length, '\n')
  if (!edit) throw new Error(`No list edit for ${line}`)
  expect(edit.cursor).toBe(edit.from + edit.insert.length)
  return line.slice(0, edit.from) + edit.insert + line.slice(edit.to)
}

describe('Typst typing', () => {
  test('continues a list item with its indentation', () => {
    expect(autoEdit('  - first', 9, '\n')).toEqual({
      from: 9,
      to: 9,
      insert: '\n  - ',
      cursor: 14,
    })
  })

  test('continues and increments an ordered item', () => {
    for (const [line, result] of [
      ['1. first', '1. first\n2. '],
      ['9. ninth', '9. ninth\n10. '],
      ['  3. third', '  3. third\n  4. '],
      ['+ plus', '+ plus\n+ '],
    ] as const)
      expect(next(line)).toBe(result)
  })

  test('ends the list on an empty item', () => {
    expect(autoEdit('  - ', 4, '\n')).toEqual({ from: 2, to: 4, insert: '', cursor: 2 })
  })

  test('ignores lines that are not list items', () => {
    for (const line of ['', 'text', '#let x = 1', '-not a list', '1.no space', '  '])
      expect(autoEdit(line, line.length, '\n')).toBeNull()
  })

  test('leaves the caret inside a marker alone', () => {
    expect(autoEdit('- item', 1, '\n')).toBeNull()
    expect(autoEdit('10. item', 2, '\n')).toBeNull()
  })

  test('pairs backticks and quotes around the caret', () => {
    expect(autoEdit('code ', 5, '`')).toEqual({ from: 5, to: 5, insert: '``', cursor: 6 })
    expect(autoEdit('say ', 4, '"')).toEqual({ from: 4, to: 4, insert: '""', cursor: 5 })
  })

  test('types over the closing half of a pair', () => {
    expect(autoEdit('`x`', 2, '`')).toEqual({ from: 2, to: 3, insert: '`', cursor: 3 })
    expect(autoEdit('"x"', 2, '"')).toEqual({ from: 2, to: 3, insert: '"', cursor: 3 })
  })

  test('turns a backtick pair into a fence on the second backtick', () => {
    expect(autoEdit('``', 1, '`')).toEqual({ from: 0, to: 2, insert: '``````', cursor: 3 })
    expect(autoEdit('see `` here', 5, '`')).toEqual({
      from: 4,
      to: 6,
      insert: '``````',
      cursor: 7,
    })
    // Past the pair, another tick stays alone instead of opening a code span.
    expect(autoEdit('``', 2, '`')).toEqual({ from: 2, to: 2, insert: '`', cursor: 3 })
  })

  test('ignores other input', () => {
    for (const text of ['a', ' ', '``', '""', '\t']) expect(autoEdit('text', 4, text)).toBeNull()
  })
})
