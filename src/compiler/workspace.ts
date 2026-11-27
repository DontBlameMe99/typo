import { hasCurrentPdf, type Note } from '../types'
import type { Diagnostic } from './diagnostics'
import { fingerprint, fingerprintAsync } from './fingerprint'
import { CompilerInputs } from './inputs'
import { type CompileInput, type CompileResult, isDiagnosticsFailure } from './protocol'
import { sharedStamp } from './shared'

export type PdfRecord = {
  sourceHash: string
  sharedHash: string
  fontsHash: string
  dependencies: Record<string, string | null>
  issues?: Diagnostic[]
  uri: string
  output?: { uri: string; stamp: string }
}
export type PdfPreview = {
  source: string
  record: PdfRecord
  uri: string
  issues: Diagnostic[]
  stale?: boolean
}
type Files = CompileInput['files']
type Snapshot = {
  files: Files
  contents: Map<string, string>
  hashes: Map<string, string>
  sharedHash: string
  fontsHash: string
}
type Job = { key: string; run(): Promise<void> }

const FONT_FILE = /\.(ttf|otf|ttc)$/iu

// Reads are cached by the input loader, so identical arrays are the common case.
// Equality is transitive, so when both sides of an entry repeat a pair that
// already matched, the answer is known. Vaults hold many files with identical
// content, and comparing their base64 one by one is what makes an unchanged
// refresh cost a full string comparison per file.
function sameFiles(previous: Files, files: Files) {
  if (previous === files) return true
  if (previous.length !== files.length) return false
  let newBase: string | null = null
  let knownBase: string | null = null
  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    const known = previous[index]
    if (file === known) continue
    if (file.path !== known.path) return false
    if (file.base64 === newBase && known.base64 === knownBase) continue
    if (file.base64 !== known.base64) return false
    newBase = file.base64
    knownBase = known.base64
  }
  return true
}

type Storage = {
  read(path: string): Promise<PdfRecord | null>
  save(path: string, record: PdfRecord): Promise<void>
  cache(key: string, base64: string): Promise<string>
  base64(uri: string): Promise<string>
  stamp(uri: string): Promise<string | null>
  write(note: Note, base64: string, sharedHash: string): Promise<string>
  hash(note: Note, sharedHash: string): Promise<void>
}

export class PdfWorkspace {
  private inputs: CompilerInputs
  private snapshot: Snapshot | null = null
  private refreshing: Promise<void> | null = null
  private notes = new Map<string, Note>()
  private records = new Map<string, PdfRecord>()
  private persisted = new WeakSet<PdfRecord>()
  private invalidated = new Set<string>()
  private revision = 0
  private failures = new Map<string, { source: string; snapshot: Snapshot; error: unknown }>()
  private pending = new Map<string, { job: Job; promise: Promise<PdfPreview> }>()
  private foreground: Job[] = []
  private background: Job[] = []
  private running = false
  private disposed = false
  private active = true
  private inputListeners = new Set<() => void>()
  private statusListeners = new Set<() => void>()
  private errors = new Map<string, string>()

  constructor(
    private options: {
      readFiles(): Promise<Files>
      compile(input: CompileInput): Promise<CompileResult>
      storage: Storage
      onPdf?(note: Note): void
    }
  ) {
    this.inputs = new CompilerInputs(options.readFiles)
  }

  get status() {
    return { pending: this.pending.size, errors: this.errors.size }
  }

  storageError(path: string) {
    const error = this.errors.get(path)
    return error?.startsWith('Cannot store') ? error : null
  }

  subscribe(listener: () => void) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  subscribeInputs(listener: () => void) {
    this.inputListeners.add(listener)
    return () => this.inputListeners.delete(listener)
  }

  private notify() {
    for (const listener of this.statusListeners) listener()
  }

  setActive(active: boolean) {
    this.active = active
    if (active) void this.pump()
  }

  setNotes(notes: Note[]) {
    const previous = this.notes
    let changedNotes: Note[] = []
    let structural = notes.length !== previous.size
    if (!structural) {
      const seen = new Set<string>()
      const updates: Note[] = []
      for (const note of notes) {
        const saved = previous.get(note.uri)
        if (
          !saved ||
          seen.has(note.uri) ||
          saved.path !== note.path ||
          saved.pdfUri !== note.pdfUri ||
          saved.pdfHash !== note.pdfHash ||
          saved.sharedHash !== note.sharedHash
        ) {
          structural = true
          break
        }
        seen.add(note.uri)
        if (saved.source !== note.source) updates.push(note)
      }
      if (!structural) {
        for (const note of updates) previous.set(note.uri, note)
        changedNotes = updates
      }
    }
    if (structural) {
      this.notes = new Map(notes.map((note) => [note.uri, note]))
      changedNotes = notes.filter((note) => {
        const saved = previous.get(note.uri)
        return (
          saved?.source !== note.source ||
          saved?.pdfHash !== note.pdfHash ||
          saved?.sharedHash !== note.sharedHash
        )
      })
    }
    const paths = new Set(notes.map((note) => note.path))
    for (const path of this.errors.keys())
      if (path !== 'inputs' && !paths.has(path)) this.errors.delete(path)
    for (const note of this.notes.values()) if (this.current(note)) this.errors.delete(note.path)
    if (structural || changedNotes.length > 0) {
      if (this.snapshot)
        for (const note of changedNotes)
          if (!this.current(note)) void this.render(note, note.source, false).catch(() => {})
      // An autosave changes one note. The compiler receives that source directly,
      // so a full vault read can wait for the periodic refresh.
      if (structural) void this.refresh()
    }
    return structural
  }

  async refresh() {
    if (this.disposed || !this.active) return
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        const files = await this.inputs.get(true)
        const previous = this.snapshot
        if (previous && sameFiles(previous.files, files)) {
          if (this.errors.delete('inputs')) for (const listener of this.inputListeners) listener()
        } else {
          const hashes = new Map<string, string>()
          const contentHashes = new Map<string, string>()
          let lastYield = performance.now()
          for (const file of files) {
            const previousHash = previous?.hashes.get(file.path)
            const unchanged = previousHash && previous?.contents.get(file.path) === file.base64
            let hash = unchanged ? previousHash : contentHashes.get(file.base64)
            if (!hash) {
              hash = await fingerprintAsync(file.base64)
              contentHashes.set(file.base64, hash)
            }
            hashes.set(file.path, hash)
            if (performance.now() - lastYield >= 8) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0))
              lastYield = performance.now()
            }
            if (this.disposed) return
          }
          const sharedHash = sharedStamp(hashes)
          const fontsHash = fingerprint(
            JSON.stringify([...hashes].filter(([path]) => FONT_FILE.test(path)))
          )
          this.snapshot = {
            files,
            contents: new Map(files.map((file) => [file.path, file.base64])),
            hashes,
            sharedHash,
            fontsHash,
          }
          this.revision++
          this.errors.delete('inputs')
          for (const listener of this.inputListeners) listener()
        }
        for (const note of this.notes.values())
          if (!this.current(note)) void this.render(note, note.source, false).catch(() => {})
      } catch (cause) {
        // A vault-wide read failure must not count against notes that need no compile.
        if ([...this.notes.values()].every((note) => this.current(note)))
          this.errors.delete('inputs')
        else this.errors.set('inputs', String(cause))
        for (const listener of this.inputListeners) listener()
      } finally {
        this.notify()
      }
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  async previous(note: Note): Promise<PdfPreview | null> {
    const record = await this.options.storage.read(note.path)
    const sourceHash = fingerprint(note.source)
    // A record from another draft would show a stale page while the editor opens.
    if (!record || this.disposed || record.sourceHash !== sourceHash) return null
    this.records.set(note.path, record)
    this.persisted.add(record)
    // Recorded dependencies can change while the app is running. Return the page anyway, so
    // it shows at once, and flag it so the caller revalidates it in the background.
    const stale = !!this.snapshot && !this.matches(record, sourceHash, this.snapshot)
    return {
      source: note.source,
      record,
      uri: record.uri,
      issues: record.issues ?? [],
      stale,
    }
  }

  render(note: Note, source: string, priority = true): Promise<PdfPreview> {
    const sourceHash = fingerprint(source)
    if (!priority) return this.enqueue(note, source, false, sourceHash)
    return this.cachedPreview(note, source, sourceHash).then(
      (preview) => preview ?? this.enqueue(note, source, true, sourceHash)
    )
  }

  private current(note: Note) {
    return hasCurrentPdf(note) && (!this.snapshot || note.sharedHash === this.snapshot.sharedHash)
  }

  private matches(record: PdfRecord, sourceHash: string, snapshot: Snapshot) {
    return (
      record.sourceHash === sourceHash &&
      record.sharedHash === snapshot.sharedHash &&
      record.fontsHash === snapshot.fontsHash &&
      Object.entries(record.dependencies).every(
        ([path, hash]) => (snapshot.hashes.get(path) ?? null) === hash
      )
    )
  }

  private async cachedPreview(
    note: Note,
    source: string,
    sourceHash: string
  ): Promise<PdfPreview | null> {
    const snapshot = this.snapshot
    if (!snapshot || this.errors.has('inputs') || this.invalidated.has(note.path)) return null
    const failed = this.failures.get(note.path)
    if (failed?.source === source && failed.snapshot === snapshot) return null
    let record = this.records.get(note.path)
    if (!record || record.sourceHash !== sourceHash) {
      record = (await this.options.storage.read(note.path)) ?? undefined
      if (record) this.persisted.add(record)
    }
    if (
      !record ||
      !this.matches(record, sourceHash, snapshot) ||
      (await this.options.storage.stamp(record.uri)) === null
    )
      return null
    if (this.disposed) throw new Error('The workspace was closed.')
    this.records.set(note.path, record)
    return { source, record, uri: record.uri, issues: record.issues ?? [] }
  }

  private async readRecord(
    note: Note,
    sourceHash: string,
    snapshot: Snapshot
  ): Promise<PdfRecord | undefined> {
    let record = this.records.get(note.path)
    if (!record || record.sourceHash !== sourceHash) {
      record = (await this.options.storage.read(note.path)) ?? undefined
      if (record) this.persisted.add(record)
    }
    if (this.invalidated.delete(note.path)) record = undefined
    if (!record || !this.matches(record, sourceHash, snapshot)) return undefined
    if ((await this.options.storage.stamp(record.uri)) === null) return undefined
    return record
  }

  private async compileRecord(
    note: Note,
    source: string,
    sourceHash: string,
    snapshot: Snapshot
  ): Promise<PdfRecord> {
    let result: CompileResult
    try {
      result = await this.options.compile({
        path: note.path,
        source,
        files: snapshot.files,
      })
    } catch (error) {
      // Only Typst diagnostics describe the note. A package download, a timeout, or a
      // recycled compiler can clear on its own, so the next render must try again.
      if (isDiagnosticsFailure(error)) this.failures.set(note.path, { source, snapshot, error })
      throw error
    }
    this.failures.delete(note.path)
    this.errors.delete(note.path)
    const dependencies = Object.fromEntries(
      result.dependencies
        .filter((path) => path !== note.path)
        .map((path) => [path, snapshot.hashes.get(path) ?? null])
    )
    const cacheKey = fingerprint(
      JSON.stringify([note.path, sourceHash, snapshot.sharedHash, snapshot.fontsHash, dependencies])
    )
    return {
      sourceHash,
      sharedHash: snapshot.sharedHash,
      fontsHash: snapshot.fontsHash,
      dependencies,
      issues: result.issues ?? [],
      uri: await this.options.storage.cache(cacheKey, result.base64),
    }
  }

  private async persistRecord(
    note: Note,
    source: string,
    snapshot: Snapshot,
    record: PdfRecord
  ): Promise<void> {
    const saved = this.notes.get(note.uri)
    if (!saved || saved.source !== source || this.snapshot !== snapshot) return
    try {
      const output = record.output
      if (!output || (await this.options.storage.stamp(output.uri)) !== output.stamp) {
        const base64 = await this.options.storage.base64(record.uri)
        if (this.disposed || this.notes.get(note.uri)?.source !== source) return
        const uri = await this.options.storage.write(saved, base64, snapshot.sharedHash)
        const stamp = await this.options.storage.stamp(uri)
        if (!stamp) throw new Error('Cannot verify the stored PDF.')
        record.output = { uri, stamp }
        this.persisted.delete(record)
      }
      if (this.disposed || this.notes.get(note.uri)?.source !== source) return
      if (!this.persisted.has(record)) {
        await this.options.storage.save(note.path, record)
        this.persisted.add(record)
      }
      if (this.disposed || this.notes.get(note.uri)?.source !== source) return
      await this.options.storage.hash(saved, snapshot.sharedHash)
      if (record.output && saved.pdfUri !== record.output.uri)
        this.options.onPdf?.({ ...saved, pdfUri: record.output.uri })
      this.errors.delete(note.path)
    } catch (cause) {
      this.errors.set(note.path, `Cannot store the current PDF: ${String(cause)}`)
    }
  }

  private enqueue(
    note: Note,
    source: string,
    priority: boolean,
    sourceHash: string
  ): Promise<PdfPreview> {
    if (this.disposed) return Promise.reject(new Error('The workspace was closed.'))
    const key = `${this.revision}:${note.uri}:${sourceHash}`
    const existing = this.pending.get(key)
    if (existing) {
      if (priority) {
        const index = this.background.indexOf(existing.job)
        if (index >= 0) {
          this.background.splice(index, 1)
          this.foreground.push(existing.job)
        }
      }
      return existing.promise
    }
    const job: Job = {
      key,
      run: async () => {},
    }
    const promise = new Promise<PdfPreview>((resolve, reject) => {
      job.run = async () => {
        try {
          if (this.disposed) throw new Error('The workspace was closed.')
          if (!priority && this.notes.get(note.uri)?.source !== source)
            throw new Error('Superseded compilation.')
          if (!this.snapshot) await this.refresh()
          const snapshot = this.snapshot
          if (!snapshot || this.errors.has('inputs'))
            throw new Error(this.errors.get('inputs') || 'Cannot read compiler inputs.')
          const failed = this.failures.get(note.path)
          if (failed?.source === source && failed.snapshot === snapshot) throw failed.error
          let record = await this.readRecord(note, sourceHash, snapshot)
          if (!record) record = await this.compileRecord(note, source, sourceHash, snapshot)
          if (this.disposed) throw new Error('The workspace was closed.')
          this.records.set(note.path, record)
          resolve({ source, record, uri: record.uri, issues: record.issues ?? [] })
          await this.persistRecord(note, source, snapshot, record)
        } catch (error) {
          if (!this.disposed && this.notes.get(note.uri)?.source === source)
            this.errors.set(note.path, String(error))
          reject(error)
        }
      }
    })
    this.pending.set(key, { job, promise })
    const jobs = priority ? this.foreground : this.background
    jobs.push(job)
    this.notify()
    void this.pump()
    return promise
  }

  retry(path: string) {
    this.failures.delete(path)
    this.records.delete(path)
    this.invalidated.add(path)
  }

  dispose() {
    this.disposed = true
    this.active = true
    void this.pump()
    this.inputListeners.clear()
    this.statusListeners.clear()
  }

  private async pump() {
    if (this.running || !this.active) return
    this.running = true
    let lastYield = performance.now()
    try {
      while (this.active) {
        const job = this.foreground.shift() ?? this.background.shift()
        if (!job) break
        await job.run()
        this.pending.delete(job.key)
        this.notify()
        if (performance.now() - lastYield >= 8) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          lastYield = performance.now()
        }
      }
    } finally {
      this.running = false
    }
  }
}
