import { describe, expect, test } from 'bun:test'
import { appendToSection, listHeadings } from '../src/append'

const source = `#title[Ideas]

= Quick Note

-

= Hosting
- Local AI via Framework desktop
`

describe('quick append insertion', () => {
  test('lists headings outside raw blocks', () => {
    expect(
      listHeadings(`${source}\`\`\`typst
= Not a heading
\`\`\`
== Child
`)
    ).toEqual([
      { level: 1, text: 'Quick Note', line: 2 },
      { level: 1, text: 'Hosting', line: 6 },
      { level: 2, text: 'Child', line: 11 },
    ])
  })

  test('replaces an empty bullet with the first entry', () => {
    expect(appendToSection(source, 'Quick Note', 'Check the append tile')).toBe(`#title[Ideas]

= Quick Note

- Check the append tile

= Hosting
- Local AI via Framework desktop
`)
  })

  test('keeps the existing bullet marker and adds after the last item', () => {
    const withItems = `= Quick Note
+ First thought
+ Second thought

= Hosting
`
    expect(appendToSection(withItems, 'Quick Note', 'Third thought')).toBe(`= Quick Note
+ First thought
+ Second thought
+ Third thought

= Hosting
`)
  })

  test('indents continuation lines into the same list item', () => {
    expect(appendToSection(source, 'Quick Note', 'Buy milk\nCall Ana')).toBe(`#title[Ideas]

= Quick Note

- Buy milk
  Call Ana

= Hosting
- Local AI via Framework desktop
`)
  })

  test('stays before the next heading of the same level', () => {
    const nested = `= Quick Note
== Today
- Old
== Later
- Keep

= Hosting
`
    expect(appendToSection(nested, 'Quick Note', 'New')).toBe(`= Quick Note
== Today
- Old
== Later
- Keep
- New

= Hosting
`)
  })

  test('preserves CRLF line endings', () => {
    const crlf = '= Quick Note\r\n-\r\n\r\n= Hosting\r\n'
    expect(appendToSection(crlf, 'Quick Note', 'Hi')).toBe(
      '= Quick Note\r\n- Hi\r\n\r\n= Hosting\r\n'
    )
  })

  test('reports a missing section', () => {
    expect(() => appendToSection(source, 'Inbox', 'Hi')).toThrow(
      'The section "Inbox" was not found. The note was left unchanged.'
    )
  })

  test('reports a duplicate section', () => {
    const duplicate = `${source}\n= Quick Note\n-\n`
    expect(() => appendToSection(duplicate, 'Quick Note', 'Hi')).toThrow(
      'More than one "Quick Note" section exists. The note was left unchanged.'
    )
  })

  test('rejects empty text', () => {
    expect(() => appendToSection(source, 'Quick Note', '  \n')).toThrow(
      'Write something to append first.'
    )
  })
})
