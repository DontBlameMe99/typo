import { readFileSync } from 'node:fs'

type FontMetrics = { unitsPerEm: number; advances: number[]; cmap: Map<number, number> }

const fonts = new Map<string, FontMetrics>()

// Advance width in pixels of `text` set in `fontFile` at `sizePx`, summed over
// the glyphs the font's cmap maps. Unmapped code points measure as .notdef.
export function textWidth(fontFile: string, text: string, sizePx: number): number {
  const font = metrics(fontFile)
  let units = 0
  for (const char of text) units += advance(font, char.codePointAt(0) ?? 0)
  return (units * sizePx) / font.unitsPerEm
}

function advance(font: FontMetrics, code: number): number {
  const glyph = font.cmap.get(code) ?? 0
  return font.advances[glyph] ?? font.advances[font.advances.length - 1]
}

function metrics(fontFile: string): FontMetrics {
  const cached = fonts.get(fontFile)
  if (cached) return cached
  const bytes = readFileSync(fontFile)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const unitsPerEm = view.getUint16(tableOffset(view, 'head') + 18)
  const advanceCount = view.getUint16(tableOffset(view, 'hhea') + 34)
  const hmtx = tableOffset(view, 'hmtx')
  const advances: number[] = []
  for (let glyph = 0; glyph < advanceCount; glyph++) advances.push(view.getUint16(hmtx + glyph * 4))
  const font = { unitsPerEm, advances, cmap: readCmap(view, tableOffset(view, 'cmap')) }
  fonts.set(fontFile, font)
  return font
}

function tableOffset(view: DataView, tag: string): number {
  const count = view.getUint16(4)
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16
    const name = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3)
    )
    if (name === tag) return view.getUint32(record + 8)
  }
  throw new Error(`Font is missing a ${tag} table.`)
}

function readCmap(view: DataView, base: number): Map<number, number> {
  const count = view.getUint16(base + 2)
  let format4 = -1
  for (let index = 0; index < count; index++) {
    const record = base + 4 + index * 8
    const platform = view.getUint16(record)
    const encoding = view.getUint16(record + 2)
    if (platform !== 0 && platform !== 3) continue
    if (platform === 3 && encoding !== 1 && encoding !== 10) continue
    const offset = base + view.getUint32(record + 4)
    const format = view.getUint16(offset)
    if (format === 12) return readFormat12(view, offset)
    if (format === 4 && format4 === -1) format4 = offset
  }
  if (format4 === -1) throw new Error('Font has no Unicode cmap subtable in format 4 or 12.')
  return readFormat4(view, format4)
}

function readFormat4(view: DataView, offset: number): Map<number, number> {
  const glyphs = new Map<number, number>()
  const segments = view.getUint16(offset + 6) / 2
  const ends = offset + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const rangeOffsets = deltas + segments * 2
  for (let segment = 0; segment < segments; segment++) {
    const end = view.getUint16(ends + segment * 2)
    const start = view.getUint16(starts + segment * 2)
    const delta = view.getInt16(deltas + segment * 2)
    const rangeAt = rangeOffsets + segment * 2
    const rangeOffset = view.getUint16(rangeAt)
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph = rangeOffset === 0 ? (code + delta) & 0xffff : 0
      if (rangeOffset !== 0) {
        glyph = view.getUint16(rangeAt + rangeOffset + (code - start) * 2)
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff
      }
      if (glyph !== 0) glyphs.set(code, glyph)
    }
  }
  return glyphs
}

function readFormat12(view: DataView, offset: number): Map<number, number> {
  const glyphs = new Map<number, number>()
  const groups = view.getUint32(offset + 12)
  for (let group = 0; group < groups; group++) {
    const record = offset + 16 + group * 12
    const start = view.getUint32(record)
    const end = view.getUint32(record + 4)
    const first = view.getUint32(record + 8)
    for (let code = start; code <= end; code++) glyphs.set(code, first + code - start)
  }
  return glyphs
}
