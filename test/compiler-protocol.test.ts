import { expect, test } from 'bun:test'
import { isPdfBase64 } from '../src/compiler/protocol'

const samples: unknown[] = [
  'JVBERi0xLjQK',
  'JVBERi0',
  'JVBERi0\n',
  ' JVBERi0',
  'JVBE Ri0',
  'jvberi0xLjQK',
  'not a PDF',
  '',
  null,
  undefined,
  42,
  { base64: 'JVBERi0' },
]

test('isPdfBase64 matches the vault check after its whitespace compaction', () => {
  for (const value of samples) {
    // Mirrors assertPdfBase64 in vault.ts, which compacts before checking.
    const compact =
      typeof value === 'string' && /\s/u.test(value) ? value.replace(/\s+/gu, '') : value
    const existing = typeof compact === 'string' && compact.startsWith('JVBERi0')
    expect(isPdfBase64(compact)).toBe(existing)
  }
})

test('isPdfBase64 matches the compiler message check', () => {
  for (const value of samples) {
    const existing = !(typeof value !== 'string' || !value.startsWith('JVBERi0'))
    expect(isPdfBase64(value)).toBe(existing)
  }
})

test('isPdfBase64 matches the PDF storage check for strings', () => {
  for (const value of samples.filter((item): item is string => typeof item === 'string')) {
    const existing = value.startsWith('JVBERi0')
    expect(isPdfBase64(value)).toBe(existing)
  }
})
