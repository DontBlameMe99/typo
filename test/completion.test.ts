import { describe, expect, test } from 'bun:test'
import { type ChangeSet, EditorState, Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  commandCompletion,
  commandCompletionAt,
  commandPrefix,
  localSymbols,
} from '../src/editor/completion'
import { isSyntaxStale, mapSyntaxRanges, setSyntaxRanges } from '../src/editor/ghost'
import { isLiteralPosition } from '../src/editor/literal'

const suggestion = (lineBefore: string, context = '', lineAfter = '') =>
  commandCompletion({ lineBefore, lineAfter, context })

describe('Typst command completion', () => {
  test('suggests title for a bare hash and narrows as the user types', () => {
    expect(suggestion('#')).toBe('title')
    expect(suggestion('#t')).toBe('itle')
    expect(suggestion('#ti')).toBe('tle')
    expect(suggestion('#tit')).toBe('le')
    expect(suggestion('#title')).toBeNull()
  })

  test('picks the matching command as the prefix grows', () => {
    expect(suggestion('#te')).toBe('xt')
    expect(suggestion('#tex')).toBe('t')
    expect(suggestion('#text')).toBeNull()
    expect(suggestion('#fi')).toBe('gure')
    expect(suggestion('#figu')).toBe('re')
    expect(suggestion('#to-')).toBe('uppercase')
  })

  test('stays quiet when the caret is inside an existing name', () => {
    expect(suggestion('#ti', '', 'tle')).toBeNull()
    expect(suggestion('#te', '', 'xt("hello")')).toBeNull()
    expect(suggestion('#', '', 'title[Demo]')).toBeNull()
    expect(suggestion('#to', '', '-uppercase')).toBeNull()
  })

  test('still completes when the name ends at the caret', () => {
    expect(suggestion('#ti', '', ' ')).toBe('tle')
    expect(suggestion('#ti', '', '[')).toBe('tle')
    expect(suggestion('#ti', '', '\nBody')).toBe('tle')
  })

  test('slices the document around the caret before completing', () => {
    expect(commandCompletionAt(Text.of(['#title[Sample]']), 3, () => '')).toBeNull()
    expect(commandCompletionAt(Text.of(['#ti']), 3, () => '')).toBe('tle')
    expect(commandCompletionAt(Text.of(['#ti[Sample]']), 3, () => '')).toBe('tle')
  })

  test('reads the context only after the prefix check', () => {
    let reads = 0
    const context = () => {
      reads++
      return ''
    }
    expect(commandCompletionAt(Text.of(['plain text']), 5, context)).toBeNull()
    expect(reads).toBe(0)
  })

  test('only completes a command directly at the caret', () => {
    expect(suggestion('#set page(')).toBeNull()
    expect(suggestion('#set ')).toBeNull()
    expect(suggestion('#text("a") #ti')).toBe('tle')
    expect(suggestion('##tit')).toBeNull()
    expect(suggestion('foo\\#tit')).toBeNull()
  })

  test('stays quiet inside comments, strings, and raw text', () => {
    expect(suggestion('// #tit')).toBeNull()
    expect(suggestion('/* #tit')).toBeNull()
    expect(suggestion('#text("a #tit')).toBeNull()
    expect(suggestion('#text(`#tit')).toBeNull()
    expect(suggestion('#text("done") #tit')).toBe('le')
  })

  test('does not confuse a URL with a line comment', () => {
    expect(suggestion('https://example.com #tit')).toBe('le')
  })

  test('does not invent commands with the wrong case', () => {
    expect(suggestion('#Tit')).toBeNull()
    expect(suggestion('#Title')).toBeNull()
  })
})

describe('symbols in the note', () => {
  test('ranks commands the note already uses above generic ones', () => {
    const context = '#let width = 5\n#figure(image("chart.png"), caption: [Growth])\n'
    expect(suggestion('#', context)).toBe('figure')
    expect(suggestion('#f', context)).toBe('igure')
  })

  test('completes functions defined with #let', () => {
    const context = '#let widget(body) = box(body)\n'
    expect(suggestion('#wid', context)).toBe('get')
    expect(suggestion('#', context)).toBe('widget')
  })

  test('completes names and aliases from imports', () => {
    const context = '#import "lib.typ": helper, other as alias\n'
    expect(suggestion('#help', context)).toBe('er')
    expect(suggestion('#ali', context)).toBe('as')
    expect(suggestion('#oth', context)).toBeNull()
  })

  test('ignores literal text that looks like a command', () => {
    const symbols = localSymbols('// #comment\n#text("#string")\n#real')
    expect(symbols.has('comment')).toBe(false)
    expect(symbols.has('string')).toBe(false)
    expect(symbols.has('real')).toBe(true)
  })

  test('makes title the default when the note uses the Typo template', () => {
    const context =
      '#set page(margin: 2.5cm)\n\n#let title(body) = align(center, body)\n#title[Demo]\n\nBody text.'
    expect(suggestion('#', context)).toBe('title')
  })
})

describe('literal positions', () => {
  test('suppresses suggestions inside comments, strings, and raw spans', () => {
    expect(isLiteralPosition([{ from: 4, to: 20, style: 'comment' }], 5)).toBe(true)
    expect(isLiteralPosition([{ from: 0, to: 8, style: 'raw' }], 4)).toBe(true)
    expect(isLiteralPosition([{ from: 0, to: 20, style: 'string' }], 12)).toBe(true)
  })

  test('allows suggestions before and after a literal', () => {
    expect(isLiteralPosition([{ from: 4, to: 20, style: 'comment' }], 4)).toBe(false)
    expect(isLiteralPosition([{ from: 4, to: 20, style: 'comment' }], 20)).toBe(false)
    expect(isLiteralPosition([{ from: 0, to: 8, style: 'number' }], 4)).toBe(false)
  })
  test('preserves literal boundaries across inserts and deletions', () => {
    const source = 'a'.repeat(100)
    const ranges = [
      { from: 5, to: 12, style: 'number' },
      { from: 20, to: 30, style: 'string' },
      { from: 40, to: 50, style: 'raw' },
      { from: 60, to: 70, style: 'comment' },
    ]
    const steps: { changes: ChangeSet; inverse: ChangeSet }[] = []
    let mapped = ranges
    let state = EditorState.create({ doc: source })
    for (const edit of [
      { from: 25, to: 28, insert: ' replacement ' },
      { from: 42, to: 48, insert: 'x' },
      { from: 8, to: 8, insert: 'abc' },
    ]) {
      const transaction = state.update({ changes: edit })
      steps.push({
        changes: transaction.changes,
        inverse: transaction.changes.invert(transaction.startState.doc),
      })
      mapped = mapped.map(({ from, to, style }) => ({
        from: transaction.changes.mapPos(from, 1),
        to: transaction.changes.mapPos(to, -1),
        style,
      }))
      state = transaction.state
      for (let pos = 0; pos <= state.doc.length; pos++)
        expect(isLiteralPosition(ranges, pos, steps)).toBe(isLiteralPosition(mapped, pos))
    }
  })
  test('drops stale syntax history and recovers with fresh ranges', () => {
    const source = 'a'.repeat(100)
    const view = {} as EditorView
    let state = EditorState.create({ doc: source })
    setSyntaxRanges(view, state.doc, [{ from: 10, to: 20, style: 'string' }])
    for (let index = 0; index < 33; index++) {
      const transaction = state.update({ changes: { from: source.length + index, insert: 'x' } })
      state = transaction.state
      mapSyntaxRanges(view, transaction.startState.doc, state.doc, transaction.changes)
    }
    expect(isSyntaxStale(view)).toBe(true)
    setSyntaxRanges(view, state.doc, [{ from: 10, to: 20, style: 'string' }])
    expect(isSyntaxStale(view)).toBe(false)
  })
})

describe('command prefix gate', () => {
  test('only reports a trailing command prefix', () => {
    expect(commandPrefix('#')).toBe('')
    expect(commandPrefix('#tit')).toBe('tit')
    expect(commandPrefix('text')).toBeNull()
    expect(commandPrefix('##tit')).toBeNull()
    expect(commandPrefix('// #tit')).toBeNull()
  })
})
