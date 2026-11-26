import { describe, expect, test } from 'bun:test'
import {
  allowedFolders,
  folderActionLabel,
  folderChildren,
  folderCrumbs,
  folderPreview,
  newFolderParts,
} from '../src/app/folder-picker'

function label(
  busy = false,
  busyLabel: string | undefined = undefined,
  newFolderOpen = false,
  move = true,
  sameFolder = false,
  current = 'notes',
  chosenName = 'notes'
): string {
  return folderActionLabel(busy, busyLabel, newFolderOpen, move, sameFolder, current, chosenName)
}

describe('allowedFolders', () => {
  test('removes the excluded tree and its descendants only', () => {
    const folders = ['', 'notes', 'notes/archived', 'notes-archive', 'archive/notes']
    expect(allowedFolders(folders, 'notes')).toEqual(['', 'notes-archive', 'archive/notes'])
  })

  test('keeps every folder without an excluded tree', () => {
    const folders = ['', 'notes', 'notes/archived']
    expect(allowedFolders(folders)).toEqual(folders)
  })
})

describe('folderChildren', () => {
  test('lists direct children sorted by name', () => {
    const allowed = ['', 'zeta', 'alpha/nested', 'beta', 'alpha/another', 'alpha']
    expect(folderChildren(allowed, '')).toEqual([
      { path: 'alpha', name: 'alpha' },
      { path: 'beta', name: 'beta' },
      { path: 'zeta', name: 'zeta' },
    ])
    expect(folderChildren(allowed, 'alpha')).toEqual([
      { path: 'alpha/another', name: 'another' },
      { path: 'alpha/nested', name: 'nested' },
    ])
  })
})

describe('folderCrumbs', () => {
  test('builds cumulative paths for each segment', () => {
    expect(folderCrumbs('')).toEqual([])
    expect(folderCrumbs('notes/projects/2026')).toEqual([
      { name: 'notes', path: 'notes' },
      { name: 'projects', path: 'notes/projects' },
      { name: '2026', path: 'notes/projects/2026' },
    ])
  })
})

describe('newFolderParts', () => {
  test('trims and drops empty segments', () => {
    expect(newFolderParts('  New / deep / ')).toEqual(['New', 'deep'])
    expect(newFolderParts('')).toEqual([])
  })
})

describe('folderActionLabel', () => {
  test('nests the busy, create, and move labels', () => {
    expect(label()).toBe('Move to notes')
    expect(label(true)).toBe('Moving…')
    expect(label(true, 'Saving…')).toBe('Saving…')
    expect(label(false, undefined, true)).toBe('Create and move here')
    expect(label(false, undefined, true, false)).toBe('Create here')
    expect(label(false, undefined, false, false)).toBe('Create in notes')
  })

  test('names the current folder or the vault root', () => {
    expect(label(false, undefined, false, true, true)).toBe('Already in notes')
    expect(label(false, undefined, false, true, true, '')).toBe('Already at the vault root')
  })
})

describe('folderPreview', () => {
  test('appends nested segments to the current folder', () => {
    expect(folderPreview('notes/deep', ['New', 'Folder'])).toEqual([
      'notes',
      'deep',
      'New',
      'Folder',
    ])
  })

  test('uses only the new segments at the vault root', () => {
    const parts = ['New']
    expect(folderPreview('', parts)).toBe(parts)
  })
})
