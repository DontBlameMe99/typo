export const MAX_CANVAS_PIXELS = 4_000_000
export const MAX_CANVAS_SIDE = 4096
export const MAX_PDF_BYTES = 100 * 1024 * 1024
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4
// Recently rendered pages kept outside the viewport, bounded by the pixels they hold
// so a scroll back is cheap without keeping more canvases than a phone can afford.
export const MAX_CACHED_PAGES = 4
export const MAX_CACHED_PIXELS = 6_000_000

export function clampPage(page: number, count: number): number {
  return Math.min(Math.max(1, Math.round(Number.isFinite(page) ? page : 1)), count)
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1))
}

export function viewportPages(firstVisible: number, lastVisible: number, count: number) {
  const first = Math.max(0, firstVisible - 1)
  const last = Math.min(count - 1, lastVisible + 1)
  const order: number[] = []
  for (let index = firstVisible; index <= lastVisible; index++) order.push(index)
  if (first < firstVisible) order.push(first)
  if (last > lastVisible) order.push(last)
  return { first, last, order }
}

// Splits published pages into the visible range plus the newest cached pages that
// still fit the cache, so a small scroll back does not raster the same page again.
// A page reports the pixels it would cost to keep, or 0 when it cannot be kept.
export function retainPages(
  published: number[],
  first: number,
  last: number,
  cached: (index: number) => number,
  extra = MAX_CACHED_PAGES,
  budget = MAX_CACHED_PIXELS
) {
  const keep: number[] = []
  const candidates: number[] = []
  const drop: number[] = []
  for (const index of published) {
    if (index >= first && index <= last) keep.push(index)
    else if (cached(index) > 0) candidates.push(index)
    else drop.push(index)
  }
  // The newest pages win, and the first one is always kept so a scroll back is never empty.
  const kept = new Set<number>()
  let total = 0
  for (let position = candidates.length - 1; position >= 0 && kept.size < extra; position--) {
    const index = candidates[position]
    const pixels = cached(index)
    if (kept.size > 0 && total + pixels > budget) continue
    kept.add(index)
    total += pixels
  }
  for (const index of candidates) {
    if (kept.has(index)) keep.push(index)
    else drop.push(index)
  }
  return { keep, drop }
}

// Pages stack with a fixed gap inside the padded page column, so their offsets
// follow from the sizes PDF.js reports. Reading offsetTop would force a reflow of
// every page during a scroll, which is what this geometry replaces.
export const PAGE_GAP = 16
export const PAGE_PADDING = 24

export type PageGeometry = { tops: number[]; bottoms: number[] }

export function pageGeometry(ratios: number[], pageWidth: number): PageGeometry {
  const tops: number[] = []
  const bottoms: number[] = []
  let top = PAGE_PADDING
  for (const ratio of ratios) {
    const height = pageWidth * ratio
    tops.push(top)
    bottoms.push(top + height)
    top += height + PAGE_GAP
  }
  return { tops, bottoms }
}

export const RANGE_HYSTERESIS = 0.25

export type PageRange = { first: number; last: number }

// Page positions keep the fraction inside a page so a range can move only after
// the viewport has settled into the next page, not on every scroll frame.
export function pagePosition(geometry: PageGeometry, y: number): number {
  const index = pageAtOffset(geometry, y)
  const top = geometry.tops[index] ?? y
  const height = Math.max(1, (geometry.bottoms[index] ?? top + 1) - top)
  return index + Math.min(1, Math.max(0, (y - top) / height))
}

export function quantizeRange(
  first: number,
  last: number,
  previous: PageRange | null,
  count = Number.POSITIVE_INFINITY
): PageRange {
  const clamp = (value: number) => Math.min(Math.max(0, value), Math.max(0, count - 1))
  const nextFirst = clamp(Math.floor(first))
  const nextLast = clamp(Math.floor(last))
  if (!previous) return { first: nextFirst, last: Math.max(nextFirst, nextLast) }
  const edge = (desired: number, held: number, position: number) => {
    if (desired > held) return position >= held + 1 ? desired : held
    if (desired < held) return position <= held - RANGE_HYSTERESIS ? desired : held
    return held
  }
  const start = edge(nextFirst, previous.first, first)
  const end = edge(Math.max(nextFirst, nextLast), previous.last, last)
  return { first: Math.min(start, end), last: Math.max(start, end) }
}

// The first page whose bottom is at or below the point, which is the page under it.
export function pageAtOffset(geometry: PageGeometry, y: number): number {
  const { bottoms } = geometry
  let low = 0
  let high = bottoms.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (bottoms[mid] < y) low = mid + 1
    else high = mid
  }
  return low
}

export function pageLeft(viewport: number, pageWidth: number): number {
  return (Math.max(viewport, pageWidth + 2 * PAGE_PADDING) - pageWidth) / 2
}

export function pageLayout(
  width: number,
  height: number,
  availableWidth: number,
  zoom: number,
  pixelRatio: number
) {
  if (![width, height, availableWidth].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('The PDF page has invalid dimensions.')
  const scale = (Math.max(1, availableWidth - 48) / width) * clampZoom(zoom)
  const cssWidth = width * scale
  const cssHeight = height * scale
  if (!Number.isFinite(cssWidth * cssHeight))
    throw new Error('The PDF page has invalid dimensions.')
  const ratio = Math.min(
    Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1),
    Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)),
    MAX_CANVAS_SIDE / cssWidth,
    MAX_CANVAS_SIDE / cssHeight
  )
  return {
    scale,
    cssWidth,
    cssHeight,
    width: Math.max(1, Math.floor(cssWidth * ratio)),
    height: Math.max(1, Math.floor(cssHeight * ratio)),
    ratio,
  }
}
