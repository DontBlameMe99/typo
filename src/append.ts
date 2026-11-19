export type Heading = {
  level: number
  text: string
  line: number
}

const HEADING = /^\s*(={1,6})\s+(.+?)\s*$/u
const EMPTY_BULLET = /^([ \t]*)([-+*])\s*$/u
const BULLET = /^([ \t]*)([-+*])\s+\S/u

export function listHeadings(source: string): Heading[] {
  const headings: Heading[] = []
  let raw = false
  source.split(/\r?\n/u).forEach((line, index) => {
    if (line.trimStart().startsWith('```')) {
      raw = !raw
      return
    }
    if (raw) return
    const match = HEADING.exec(line)
    if (!match) return
    const text = headingText(match[2])
    if (!text) return
    headings.push({ level: match[1].length, text, line: index })
  })
  return headings
}

function headingText(value: string): string {
  return value
    .trim()
    .replace(/\s*=+\s*$/u, '')
    .trim()
}

function sectionLines(source: string, section: string): { start: number; end: number } {
  const headings = listHeadings(source)
  const matches = headings.filter((heading) => heading.text === section.trim())
  if (matches.length === 0) {
    throw new Error(`The section "${section}" was not found. The note was left unchanged.`)
  }
  if (matches.length > 1) {
    throw new Error(`More than one "${section}" section exists. The note was left unchanged.`)
  }
  const target = matches[0]
  const next = headings.find(
    (heading) => heading.line > target.line && heading.level <= target.level
  )
  const lines = source.split(/\r?\n/u)
  return { start: target.line + 1, end: next?.line ?? lines.length }
}

export function appendToSection(source: string, section: string, text: string): string {
  const entry = text.replace(/\r?\n$/u, '').trim()
  if (!entry) throw new Error('Write something to append first.')
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/u)
  const { start, end } = sectionLines(source, section)
  const content = lines.slice(start, end)
  let lastContent = -1
  for (let index = content.length - 1; index >= 0; index--) {
    if (content[index].trim()) {
      lastContent = index
      break
    }
  }

  const placeholder = lastContent >= 0 ? EMPTY_BULLET.exec(content[lastContent]) : null
  const existing = lastContent >= 0 ? BULLET.exec(content[lastContent]) : null
  const indent = placeholder?.[1] ?? existing?.[1] ?? ''
  const marker = placeholder?.[2] ?? existing?.[2] ?? '-'
  const [first, ...rest] = entry.split(/\r?\n/u)
  const added = [
    `${indent}${marker} ${first}`,
    ...rest.map((line) => (line ? `${indent}  ${line}` : '')),
  ]

  if (placeholder) lines.splice(start + lastContent, 1, ...added)
  else lines.splice(start + (lastContent < 0 ? 0 : lastContent + 1), 0, ...added)
  return lines.join(newline)
}
