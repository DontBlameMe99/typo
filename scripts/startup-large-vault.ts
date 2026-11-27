// Local, reproducible launch-cache check for a large vault. It writes a
// fabricated vault into a scratch directory, exercises the split metadata and
// source files, and removes the directory when it finishes. No fixture is
// committed.
//
//   nix develop -c bun scripts/startup-large-vault.ts --notes 2000

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import {
  parseSource,
  parseVaultMetadata,
  serializeVaultMetadata,
  sourceKey,
  vaultSources,
} from '../src/library-index'
import type { Note, Vault } from '../src/types'
import { parseArgs } from './args'

const args = parseArgs(process.argv)
const COUNT = Number(args.get('notes') ?? 2000)
if (!Number.isInteger(COUNT) || COUNT < 1) throw new Error('--notes must be a positive integer')

const vault: Vault = {
  uri: 'content://com.android.externalstorage.documents/tree/primary%3ALargeVault',
  name: 'LargeVault',
}

function fabricatedSource(index: number): string {
  return `= Benchmark note ${index}\n\nA fabricated paragraph used only for launch-cache measurement.\n`
}

await mkdir('.tmp', { recursive: true })
const root = await mkdtemp('.tmp/typo-large-vault-')
try {
  const sourcesDirectory = `${root}/sources`
  await mkdir(sourcesDirectory, { recursive: true })
  const notes: Note[] = []
  for (let index = 1; index <= COUNT; index++) {
    const path = `note-${String(index).padStart(5, '0')}.typ`
    const source = fabricatedSource(index)
    const note: Note = {
      uri: `${vault.uri}/document/${encodeURIComponent(`primary:LargeVault/${path}`)}`,
      path,
      title: `Benchmark note ${index}`,
      source,
      modifiedAt: 1_700_000_000_000 + index,
    }
    notes.push(note)
    await writeFile(`${sourcesDirectory}/${sourceKey(note.uri)}.txt`, source)
  }

  const metadata = serializeVaultMetadata(vault, { notes, folders: [''] })
  if (metadata.includes('A fabricated paragraph'))
    throw new Error('metadata must not contain source text')
  const metadataUri = `${root}/metadata.json`
  await writeFile(metadataUri, metadata)

  const timings: number[] = []
  for (let run = 0; run < 5; run++) {
    const started = performance.now()
    const parsed = parseVaultMetadata(await Bun.file(metadataUri).text(), vault)
    if (!parsed || parsed.notes.length !== COUNT) throw new Error('invalid launch metadata')
    timings.push(performance.now() - started)
  }
  const parsed = parseVaultMetadata(await Bun.file(metadataUri).text(), vault)
  if (!parsed || parsed.notes.length !== COUNT) throw new Error('invalid launch metadata')
  const hydrationStarted = performance.now()
  const keys = [...vaultSources({ notes, folders: [''] }).keys()]
  for (let index = 0; index < Math.min(100, COUNT); index++) {
    const source = parseSource(
      await Bun.file(`${sourcesDirectory}/${keys[index]}.txt`).text(),
      parsed.sourceLengths[index]
    )
    if (source !== notes[index].source) throw new Error('source hydration mismatch')
  }
  const hydrationMs = performance.now() - hydrationStarted
  const bestMs = Math.min(...timings)
  console.info(
    `startup-large-vault: ${COUNT} notes, metadata ${bestMs.toFixed(1)} ms best of ${timings.length}, ` +
      `100 sources ${hydrationMs.toFixed(1)} ms, ${(metadata.length / 1024).toFixed(1)} KiB metadata`
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
