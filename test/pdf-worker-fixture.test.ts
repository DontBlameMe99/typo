import { expect, test } from 'bun:test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { syntheticPdf } from './helpers/synthetic-pdf'

test('the device fixture is a real two-page PDF with fabricated content', async () => {
  const task = getDocument({ data: syntheticPdf(), useSystemFonts: false })
  const pdf = await task.promise
  expect(pdf.numPages).toBe(2)
  const page = await pdf.getPage(1)
  expect(page.getViewport({ scale: 1 }).width).toBe(612)
  page.cleanup()
  await task.destroy()
})
