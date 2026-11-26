import type { Note } from '../../src/types'

export function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    uri: 'content://one',
    path: 'one.typ',
    title: 'One',
    source: '= One',
    modifiedAt: null,
    ...overrides,
  }
}
