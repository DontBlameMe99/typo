import { expect, test } from 'bun:test'
import { hasSearchMatch, highlightRanges } from '../src/search/highlight'

test('accent-insensitive search highlights the original text', () => {
  expect(hasSearchMatch('Café Notes', 'cafe')).toBe(true)
  expect(highlightRanges('Café Notes', 'cafe')).toEqual([{ start: 0, end: 4 }])
  expect(highlightRanges('e\u0301cole here', 'école')).toEqual([{ start: 0, end: 6 }])
  expect(highlightRanges('e\u0301cole here', 'cole')).toEqual([{ start: 2, end: 6 }])
  expect(highlightRanges('Nothing here', 'cafe')).toEqual([])
})

test('quoted phrases and prefixes highlight only the phrase', () => {
  expect(highlightRanges('Plan weekly goals today', '"weekly goals"')).toEqual([
    { start: 5, end: 17 },
  ])
  expect(highlightRanges('folder:work weekly goals', 'folder:work "weekly goals"')).toEqual([
    { start: 12, end: 24 },
  ])
  expect(highlightRanges('Test', 'tesg', true)).toEqual([{ start: 0, end: 3 }])
})
