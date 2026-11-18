export type LineEdit = {
  from: number
  to: number
  insert: string
  cursor: number
}

const listItem = /^([ \t]*)(?:([-+])|(\d+)\.)[ \t]+/u

// A typed character that changes the line around the caret. Offsets are
// absolute positions in the line.
export function autoEdit(line: string, at: number, text: string): LineEdit | null {
  if (text === '\n') return listBreak(line, at)
  if (text !== '`' && text !== '"') return null
  // A second backtick turns the pair into a fence around the caret.
  if (text === '`' && isPair(line, at))
    return { from: at - 1, to: at + 1, insert: '``````', cursor: at + 2 }
  if (line[at] === text) return { from: at, to: at + 1, insert: text, cursor: at + 1 }
  // The third backtick of a fence stays alone, it does not open a code span.
  if (text === '`' && line.slice(at - 2, at) === '``')
    return { from: at, to: at, insert: text, cursor: at + 1 }
  return { from: at, to: at, insert: text + text, cursor: at + 1 }
}

const isPair = (line: string, at: number) =>
  line[at - 1] === '`' && line[at] === '`' && line[at - 2] !== '`' && line[at + 1] !== '`'

function listBreak(line: string, at: number): LineEdit | null {
  const match = listItem.exec(line)
  if (!match || at < match[0].length) return null
  const [, indent, bullet, number] = match
  // An empty item ends the list instead of starting another one.
  if (line.length === match[0].length)
    return { from: indent.length, to: line.length, insert: '', cursor: indent.length }
  const marker = bullet ?? `${Number(number) + 1}.`
  const insert = `\n${indent}${marker} `
  return { from: at, to: at, insert, cursor: at + insert.length }
}
