const encode = new TextEncoder()

/** A two-page PDF with fabricated text, built without any binary fixture. */
export function syntheticPdf(): Uint8Array {
  const content = (line: string) => {
    const stream = `BT /F1 28 Tf 72 680 Td (${line}) Tj ET\n`
    return `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    content('Demo page one'),
    content('Demo page two'),
  ]
  let text = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(encode.encode(text).byteLength)
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const start = encode.encode(text).byteLength
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) text += `${String(offset).padStart(10, '0')} 00000 n \n`
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
  return encode.encode(text)
}
