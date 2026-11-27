export type SectionTarget = { level: number; text: string }

export type Heading = {
  level: number
  text: string
  line: number
}

const HEADING = /^\s*(={1,6})\s+(.+?)\s*$/u
const EMPTY_BULLET = /^([ \t]*)([-+*])\s*$/u
const BULLET = /^([ \t]*)([-+*])\s+\S/u

function headingsFromLines(lines: string[]): Heading[] {
  const headings: Heading[] = []
  let raw = false
  lines.forEach((line, index) => {
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

export function headingKey(heading: SectionTarget): string {
  return `${heading.level}:${heading.text}`
}

export function headingMatches(heading: Heading, section: string | SectionTarget): boolean {
  const target = typeof section === 'string' ? { level: 0, text: section.trim() } : section
  return heading.text === target.text && (target.level === 0 || heading.level === target.level)
}

function sectionText(section: string | SectionTarget): string {
  return typeof section === 'string' ? section.trim() : section.text
}

function sourceLines(source: string): string[] {
  return source.split(/\r?\n/u)
}

function sourceNewline(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

export function listHeadings(source: string): Heading[] {
  return headingsFromLines(sourceLines(source))
}

function headingText(value: string): string {
  return value
    .trim()
    .replace(/\s*=+\s*$/u, '')
    .trim()
}

function sectionLines(
  lines: string[],
  section: string | SectionTarget
): { start: number; end: number } {
  const headings = headingsFromLines(lines)
  const matches = headings.filter((heading) => headingMatches(heading, section))
  if (matches.length === 0) {
    throw new Error(
      `The section "${sectionText(section)}" was not found. The note was left unchanged.`
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `More than one "${sectionText(section)}" section exists. The note was left unchanged.`
    )
  }
  const target = matches[0]
  const next = headings.find(
    (heading) => heading.line > target.line && heading.level <= target.level
  )
  return { start: target.line + 1, end: next?.line ?? lines.length }
}

export function appendToSection(
  source: string,
  section: string | SectionTarget,
  text: string
): string {
  const entry = text.replace(/\r?\n$/u, '').trim()
  if (!entry) throw new Error('Write something to append first.')
  const lines = sourceLines(source)
  const newline = sourceNewline(source)
  const { start, end } = sectionLines(lines, section)
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
