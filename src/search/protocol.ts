import type { Note, SearchMode } from '../types'

export type SearchScope = { folder?: string; favorites?: readonly string[] }
export type SearchNote = Pick<Note, 'path' | 'title'> & { source?: string }
export type SearchHit = { path: string; line?: number; snippet?: string }
export type SearchRequest = {
  id: number
  query: string
  mode: SearchMode
  updated: SearchNote[]
  removed: string[]
  scope?: SearchScope
}

function sameScope(a: SearchScope | undefined, b: SearchScope | undefined): boolean {
  if (a?.folder !== b?.folder) return false
  const left = a?.favorites
  const right = b?.favorites
  if (left?.length !== right?.length) return false
  return !left || left.every((path, index) => path === right?.[index])
}

export class SearchTransport {
  private notes = new Map<string, SearchNote>()
  private input: readonly Note[] | null = null
  private sourcesReady = false
  private query: string | undefined
  private mode: SearchMode | undefined
  private scope: SearchScope | undefined

  request(
    notes: readonly Note[],
    query: string,
    mode: SearchMode,
    scope?: SearchScope
  ): Omit<SearchRequest, 'id'> | null {
    const inputChanged = this.input !== notes
    if (inputChanged) this.sourcesReady = false
    const updated: SearchNote[] = []
    let removed: string[] = []
    // Library note arrays are immutable. Query changes can reuse the previous
    // scan unless Everywhere still needs sources that Names did not transfer.
    if (inputChanged || (mode !== 'names' && !this.sourcesReady)) {
      const paths = new Set<string>()
      for (const note of notes) {
        paths.add(note.path)
        const previous = this.notes.get(note.path)
        if (
          !previous ||
          previous.title !== note.title ||
          (mode !== 'names' && previous.source !== note.source)
        )
          updated.push({
            path: note.path,
            title: note.title,
            ...(mode !== 'names' && { source: note.source }),
          })
      }
      removed = [...this.notes.keys()].filter((path) => !paths.has(path))
      for (const note of updated)
        this.notes.set(note.path, { ...this.notes.get(note.path), ...note })
      for (const path of removed) this.notes.delete(path)
    }
    const scopeChanged = !sameScope(this.scope, scope)
    this.input = notes
    this.scope = scope
    if (mode !== 'names') this.sourcesReady = true
    if (
      !updated.length &&
      !removed.length &&
      query === this.query &&
      mode === this.mode &&
      !scopeChanged
    )
      return null
    this.query = query
    this.mode = mode
    return { query, mode, updated, removed, ...(scope && { scope }) }
  }
}
