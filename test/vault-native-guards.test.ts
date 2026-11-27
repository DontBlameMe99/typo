import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { bundle, evaluate } from './helpers/vm-module'

type Bridge = {
  listVaultEntries(uri: string): Promise<unknown[] | null>
  readVaultText(uri: string): Promise<string> | null
  readVaultBase64(uri: string, maxBytes: number): Promise<string> | null
}

const source = await bundle('src/vault-native.ts', { external: ['expo-modules-core'] })
const documents =
  'content://com.android.externalstorage.documents/tree/primary%3ANotes/document/primary%3ANotes%2Fdemo.typ'

function nativeModule(contents: Record<string, string> = {}) {
  function guard(uri: string) {
    const parsed = new URL(uri)
    if (
      parsed.protocol !== 'content:' ||
      parsed.host !== 'com.android.externalstorage.documents' ||
      !parsed.pathname.includes('/tree/')
    )
      throw new Error('Expected a local external storage tree or tree document content URI.')
  }
  return {
    listChildren: async (uri: string) => {
      guard(uri)
      return []
    },
    readText: async (uri: string) => {
      guard(uri)
      return contents[uri] ?? ''
    },
    readBase64: async (uri: string, maxBytes: number) => {
      guard(uri)
      if (maxBytes < 0 || maxBytes > Number.MAX_SAFE_INTEGER)
        throw new Error('Invalid file read limit.')
      const text = contents[uri] ?? ''
      if (Buffer.byteLength(text, 'utf8') > maxBytes)
        throw Object.assign(new Error('The file exceeds its read limit.'), {
          code: 'ERR_TYPO_VAULT_FILE_LIMIT',
        })
      return Buffer.from(text, 'utf8').toString('base64')
    },
  }
}

function bridge(native: unknown): Bridge {
  return evaluate<Bridge>(source, {
    'expo-modules-core': { requireOptionalNativeModule: () => native },
  })
}

test('an oversized native read rejects with its limit code instead of returning partial data', async () => {
  const api = bridge(nativeModule({ [documents]: 'fabricated demo content' }))
  await expect(api.readVaultBase64(documents, 4)).rejects.toHaveProperty(
    'code',
    'ERR_TYPO_VAULT_FILE_LIMIT'
  )
  expect(await api.readVaultBase64(documents, 64)).toBe(
    Buffer.from('fabricated demo content').toString('base64')
  )
})

test('unsafe content URIs reject before any data is returned', async () => {
  const api = bridge(nativeModule({ [documents]: 'fabricated demo content' }))
  for (const uri of [
    'https://example.com/tree/primary%3ANotes',
    'content://com.example.cloud/tree/notes',
    'content://com.android.externalstorage.documents/document/primary%3ANotes',
    'file:///sdcard/notes/demo.typ',
  ]) {
    await expect(api.readVaultBase64(uri, 1024)).rejects.toThrow(
      'Expected a local external storage tree or tree document content URI.'
    )
    await expect(api.listVaultEntries(uri)).rejects.toThrow(
      'Expected a local external storage tree or tree document content URI.'
    )
  }
})

test('the Kotlin bridge keeps its read limit and URI guard in source', async () => {
  const kotlin = await readFile(
    new URL(
      '../modules/typo-vault/android/src/main/java/expo/modules/typovault/TypoVaultModule.kt',
      import.meta.url
    ),
    'utf8'
  )
  expect(kotlin).toContain('ERR_TYPO_VAULT_FILE_LIMIT')
  expect(kotlin).toContain('require(maxBytes in 0..Int.MAX_VALUE.toLong())')
  expect(kotlin).toContain('if (count > remaining)')
  expect(kotlin).toContain('uri.authority == "com.android.externalstorage.documents"')
  expect(kotlin).toContain('DocumentsContract.isTreeUri(uri)')
  expect(kotlin).toContain('segments[2] == "document"')
})
