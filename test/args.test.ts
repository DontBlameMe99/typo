import { expect, test } from 'bun:test'
import { parseArgs } from '../scripts/args'

test('parseArgs reads the token after each flag as its value', () => {
  const args = parseArgs(['node', 'script', '--apk', 'app.apk', '--runs', '3'])
  expect(args.get('apk')).toBe('app.apk')
  expect(args.get('runs')).toBe('3')
})

test('parseArgs treats a following flag as true and keeps that flag', () => {
  const args = parseArgs(['--verbose', '--runs', '2'])
  expect(args.get('verbose')).toBe('true')
  expect(args.get('runs')).toBe('2')
})

test('parseArgs ignores positionals, treats empty values as true, and keeps the last flag', () => {
  const args = parseArgs(['positional', '--empty', '', '--runs', '2', '--runs', '4'])
  expect(args.size).toBe(2)
  expect(args.get('empty')).toBe('true')
  expect(args.get('runs')).toBe('4')
})
