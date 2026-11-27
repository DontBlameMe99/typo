import { describe, expect, mock, test } from 'bun:test'

const finish = mock((_component: string) => {})

mock.module('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({ finish }),
}))

const { finishQuickNote } = await import('../src/quick-note-native')

describe('quick sheet native finish', () => {
  test('passes the sheet component to the native module', () => {
    finishQuickNote('quickNote')
    finishQuickNote('quickAppend')

    expect(finish.mock.calls).toEqual([['quickNote'], ['quickAppend']])
  })
})
