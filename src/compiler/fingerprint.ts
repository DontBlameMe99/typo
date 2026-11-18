// Content keys for the compiler cache. They are not cryptographic, they only have
// to make unchanged content cheap to recognize.
//
// Bytes come from one `encodeInto` pass per 64 KB instead of a `charCodeAt` per
// character: the encoder converts the whole slice in native code, so the loop
// below only mixes 32-bit words. Every character still reaches the hash, as its
// UTF-8 bytes plus the code-unit length.
const SLICE = 1 << 16
// Slicing lives here so `fingerprint` and `fingerprintAsync` always hash a value
// in the same pieces, however often the async variant yields.
const CHUNK = 1 << 16

const encoder = new TextEncoder()
const scratch = new Uint8Array(SLICE)
const words = new Uint32Array(scratch.buffer)

class Hasher {
  private first = 0x811c9dc5
  private second = 0x9e3779b9
  private third = 0x85ebca6b
  private fourth = 0xc2b2ae35
  private length = 0

  add(value: string) {
    this.length += value.length
    let rest = value
    let first = this.first
    let second = this.second
    let third = this.third
    let fourth = this.fourth
    while (rest.length > 0) {
      const { read, written } = encoder.encodeInto(rest, scratch)
      const count = written >>> 2
      let word = 0
      // Four independent chains hide the multiply latency. The folds keep bits
      // that entered at the top of a word from staying there: multiplication only
      // carries upwards, so without them a change in the last byte of a word
      // would leave the rest of the key untouched.
      for (; word + 4 <= count; word += 4) {
        first = Math.imul(first ^ words[word], 0x01000193)
        second = Math.imul(second ^ words[word + 1], 0x5bd1e995)
        third = Math.imul(third ^ words[word + 2], 0x85ebca6b)
        fourth = Math.imul(fourth ^ words[word + 3], 0xc2b2ae35)
        first ^= first >>> 15
        second ^= second >>> 13
        third ^= third >>> 17
        fourth ^= fourth >>> 15
      }
      for (; word < count; word++) first = Math.imul(first ^ words[word], 0x01000193)
      for (let byte = count << 2; byte < written; byte++)
        first = Math.imul(first ^ scratch[byte], 0x01000193)
      rest = read === rest.length ? '' : rest.slice(read)
    }
    this.first = first
    this.second = second
    this.third = third
    this.fourth = fourth
  }

  // Fold the four chains into both halves, so a change in any of them moves every
  // bit of the result.
  value() {
    let first = this.first ^ Math.imul(this.third, 0x9e3779b1)
    let second = this.second ^ Math.imul(this.fourth, 0x85ebca77)
    first = Math.imul(first ^ (first >>> 15), 0x2c1b3c6d)
    second = Math.imul(second ^ (second >>> 13), 0x297a2d39)
    second = Math.imul(second ^ (first >>> 16), 0x85ebca6b)
    first = Math.imul(first ^ (second >>> 15), 0xc2b2ae35)
    return `${this.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`
  }
}

function slice(value: string, start: number, end: number) {
  return start === 0 && end === value.length ? value : value.slice(start, end)
}

// A cut between the halves of a surrogate pair encodes both halves as U+FFFD, so
// two different astral characters would hash alike.
function chunkEnd(value: string, start: number) {
  let end = Math.min(start + CHUNK, value.length)
  if (end < value.length) {
    const code = value.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) end++
  }
  return end
}

export function fingerprint(value: string): string {
  const hash = new Hasher()
  let start = 0
  while (start < value.length) {
    const end = chunkEnd(value, start)
    hash.add(slice(value, start, end))
    start = end
  }
  return hash.value()
}

// Same hash, sliced so the UI thread can pick up touches between slices.
export async function fingerprintAsync(value: string): Promise<string> {
  const hash = new Hasher()
  let lastYield = performance.now()
  let start = 0
  while (start < value.length) {
    const end = chunkEnd(value, start)
    hash.add(slice(value, start, end))
    start = end
    if (start < value.length && performance.now() - lastYield >= 8) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      lastYield = performance.now()
    }
  }
  return hash.value()
}
