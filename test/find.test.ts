import { describe, expect, test } from 'bun:test'
import {
  findFirst,
  findMatches,
  initialFindSelection,
  replaceAllMatches,
  replaceMatches,
} from '../src/app/find'

describe('findMatches', () => {
  test('returns no matches for an empty query', () => {
    expect(findMatches('anything', '')).toEqual([])
    expect(findFirst('anything', '')).toBeUndefined()
  })

  test('advances past each match without overlapping', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([0, 2])
    expect(findMatches('aXaXa', 'a')).toEqual([0, 2, 4])
  })

  test('folds case without locale-dependent offsets', () => {
    expect(findMatches('AbA abA', 'aB')).toEqual([0, 4])
    expect(findFirst('AbA abA', 'aB')).toEqual({ start: 0, end: 2 })
  })
})

describe('initialFindSelection', () => {
  test('selects a match on the requested line and counts earlier matches', () => {
    const source = 'Three one\ntwo THREE'
    expect(initialFindSelection(source, 2, 'three')).toEqual({
      selection: { start: 14, end: 19 },
      matchIndex: 1,
    })
  })

  test('selects the line when the query is missing from it', () => {
    expect(initialFindSelection('first\nsecond', 2, 'none')).toEqual({
      selection: { start: 6, end: 12 },
      matchIndex: undefined,
    })
  })

  test('selects the first match in the source without a requested line', () => {
    expect(initialFindSelection('Alpha Beta', undefined, 'beta')).toEqual({
      selection: { start: 6, end: 10 },
    })
    expect(initialFindSelection('Alpha', undefined, 'beta')).toBeUndefined()
  })
})

describe('case folding and line endings', () => {
  test('CRLF matches use normalized offsets', () => {
    const source = 'İlk\r\nIkinci\r\nÜçüncü'
    expect(findMatches(source, 'ikinci')).toEqual([4])
    expect(findFirst(source, 'ikinci')).toEqual({ start: 4, end: 10 })
    expect(initialFindSelection(source, 3, 'üçüncü')).toEqual({
      selection: { start: 11, end: 17 },
      matchIndex: 0,
    })
  })

  test('Turkish dotted and dotless I fold without changing offsets', () => {
    const source = 'İstanbul ıstanbul Istanbul'
    expect(findMatches(source, 'istanbul')).toEqual([0, 18])
    expect(findMatches(source, 'İSTANBUL')).toEqual([0, 18])
    expect(findMatches(source, 'ıstanbul')).toEqual([9])
    expect(findFirst(source, 'İ')).toEqual({ start: 0, end: 1 })
    expect(findMatches('A𝔸B İ', 'b')).toEqual([3])
  })
})

describe('replacements', () => {
  test('replaces the first folded match or every match', () => {
    expect(replaceMatches('AbA abA', 'aB', 'X')).toBe('XA abA')
    expect(replaceAllMatches('AbA abA', 'aB', 'X')).toBe('XA XA')
    expect(replaceMatches('aaaa', 'a', 'x', 1)).toBe('axaa')
  })

  test('advances past overlapping matches', () => {
    expect(replaceAllMatches('aaaa', 'aa', 'x')).toBe('xx')
  })

  test('maps folded Unicode matches back to source offsets', () => {
    const source = 'İstanbul ıstanbul Istanbul'
    expect(replaceMatches(source, 'İSTANBUL', 'Demo')).toBe('Demo ıstanbul Istanbul')
    expect(replaceAllMatches(source, 'istanbul', 'Demo')).toBe('Demo ıstanbul Demo')
  })

  test('keeps the source when the query is empty', () => {
    expect(replaceMatches('anything', '', 'x')).toBe('anything')
    expect(replaceAllMatches('anything', '', 'x')).toBe('anything')
  })

  test('find and replacement use the same folded matches', () => {
    const source = 'café cafe'
    expect(findMatches(source, 'cafe')).toEqual([0, 5])
    expect(replaceAllMatches(source, 'cafe', 'X')).toBe('X X')
    expect(replaceMatches(source, 'cafe', 'X', 1)).toBe('café X')
  })
})
