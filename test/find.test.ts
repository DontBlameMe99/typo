import { describe, expect, test } from 'bun:test'
import { findFirst, findMatches, initialFindSelection } from '../src/app/find'

describe('findMatches', () => {
  test('returns no matches for an empty query', () => {
    expect(findMatches('anything', '')).toEqual([])
    expect(findFirst('anything', '')).toBeUndefined()
  })

  test('advances past each match without overlapping', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([0, 2])
    expect(findMatches('aXaXa', 'a')).toEqual([0, 2, 4])
  })

  test('folds case with locale lowercasing', () => {
    expect(findMatches('AbA aBa', 'aB')).toEqual([0, 4])
    expect(findFirst('AbA aBa', 'aB')).toEqual({ start: 0, end: 2 })
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
