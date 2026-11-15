import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { textWidth } from './helpers/text-width'

const mono = join(import.meta.dir, '../assets/fonts/JetBrainsMono-Regular.ttf')
const serif = join(import.meta.dir, '../assets/fonts/typst/LibertinusSerif-Regular.otf')

test('scales linearly with the size', () => {
  const width = textWidth(mono, 'Typst', 16)
  expect(textWidth(mono, 'Typst', 32)).toBeCloseTo(width * 2, 5)
  expect(textWidth(mono, 'Typst', 64)).toBeCloseTo(width * 4, 5)
})

test('measures a known string', () => {
  // JetBrains Mono advances every glyph by 600 of its 1000 units per em.
  expect(textWidth(mono, 'Typst', 16)).toBeCloseTo(5 * 9.6, 1)
})

test('reads the width of each glyph from the cmap', () => {
  expect(textWidth(serif, 'i', 16)).toBeCloseTo(4.336, 3)
  expect(textWidth(serif, 'W', 16)).toBeCloseTo(15.216, 3)
})

test('measures a glyph missing from the font as .notdef', () => {
  expect(textWidth(serif, '\u{10FFFD}', 16)).toBeCloseTo(8, 5)
  expect(textWidth(serif, 'i\u{10FFFD}', 16)).toBeCloseTo(textWidth(serif, 'i', 16) + 8, 5)
})
