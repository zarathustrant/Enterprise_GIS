import * as heroPatterns from 'hero-patterns'
import type { PolygonPatternLibrary, PolygonPatternStyle } from '../types/gis'

export interface PatternOption {
  name: string
  label: string
  keywords: string[]
}

export interface PatternAtlasSpec {
  atlas: HTMLCanvasElement | string
  mapping: Record<string, { x: number; y: number; width: number; height: number; mask: boolean }>
}

export const POLYGON_PATTERN_LIBRARY_OPTIONS: Array<{ value: PolygonPatternLibrary; label: string }> = [
  { value: 'builtin', label: 'Built-in Hatch Library' },
  { value: 'hero', label: 'Hero Patterns (MIT)' },
]

export const BUILTIN_PATTERN_OPTIONS: Array<{ value: PolygonPatternStyle; label: string; keywords: string[] }> = [
  { value: 'solid', label: 'Solid fill', keywords: ['solid', 'plain'] },
  { value: 'hatch', label: 'Hatch', keywords: ['hatch', 'line', 'horizontal'] },
  { value: 'crosshatch', label: 'Crosshatch', keywords: ['cross', 'grid', 'hatch'] },
  { value: 'diagonal', label: 'Diagonal hatch', keywords: ['diagonal', 'slash'] },
  { value: 'diagonalCross', label: 'Diagonal cross', keywords: ['diagonal', 'cross', 'x'] },
  { value: 'dots', label: 'Dotted', keywords: ['dot', 'point', 'stipple'] },
  { value: 'grid', label: 'Grid', keywords: ['grid', 'square', 'net'] },
]

const BUILTIN_PATTERN_LOOKUP = new Set<PolygonPatternStyle>(BUILTIN_PATTERN_OPTIONS.map((item) => item.value))

function toTitleCase(token: string): string {
  return token
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

type HeroPatternFn = (color?: string, opacity?: number) => string

const HERO_PATTERNS: Array<{ name: string; fn: HeroPatternFn; label: string; keywords: string[] }> = Object.entries(
  heroPatterns as Record<string, unknown>,
)
  .filter((entry): entry is [string, HeroPatternFn] => typeof entry[1] === 'function')
  .map(([name, fn]) => {
    const normalized = name.trim()
    const label = toTitleCase(normalized)
    const keywords = label
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    return { name: normalized, fn, label, keywords }
  })
  .sort((a, b) => a.label.localeCompare(b.label))

const HERO_PATTERN_MAP = new Map(HERO_PATTERNS.map((item) => [item.name, item]))

function asHexColor(value: string, fallback: string): string {
  const token = value.trim()
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(token) ? token : fallback
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '')
  const chunk = cleaned.length === 3 ? cleaned.split('').map((char) => `${char}${char}`).join('') : cleaned
  const value = Number.parseInt(chunk, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.max(0, Math.min(1, value))
}

export function normalizePolygonPatternLibrary(value: unknown): PolygonPatternLibrary {
  if (value === 'hero') {
    return 'hero'
  }
  return 'builtin'
}

export function inferPolygonPatternLibraryFromName(name: string): PolygonPatternLibrary {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'builtin'
  }
  if (BUILTIN_PATTERN_LOOKUP.has(trimmed as PolygonPatternStyle)) {
    return 'builtin'
  }
  if (HERO_PATTERN_MAP.has(trimmed)) {
    return 'hero'
  }
  return 'builtin'
}

export function normalizePolygonPattern(value: unknown): PolygonPatternStyle {
  if (typeof value === 'string' && BUILTIN_PATTERN_LOOKUP.has(value as PolygonPatternStyle)) {
    return value as PolygonPatternStyle
  }
  return 'solid'
}

export function resolvePolygonPatternName(library: PolygonPatternLibrary, patternName: string): string {
  const trimmed = patternName.trim()
  if (!trimmed) {
    return library === 'hero' ? HERO_PATTERNS[0]?.name ?? 'jigsaw' : 'solid'
  }

  if (library === 'hero') {
    return HERO_PATTERN_MAP.has(trimmed) ? trimmed : HERO_PATTERNS[0]?.name ?? 'jigsaw'
  }

  return normalizePolygonPattern(trimmed)
}

export function polygonPatternLabel(library: PolygonPatternLibrary, patternName: string): string {
  if (library === 'hero') {
    const hero = HERO_PATTERN_MAP.get(patternName)
    return hero?.label ?? toTitleCase(patternName || 'Hero pattern')
  }

  const builtin = BUILTIN_PATTERN_OPTIONS.find((item) => item.value === normalizePolygonPattern(patternName))
  return builtin?.label ?? 'Solid fill'
}

function backgroundFromBuiltin(
  pattern: PolygonPatternStyle,
  patternColor: string,
  opacity = 0.65,
): { backgroundImage?: string; backgroundSize?: string } {
  if (pattern === 'solid') {
    return {}
  }

  const [r, g, b] = hexToRgb(asHexColor(patternColor, '#111827'))
  const alpha = clamp01(opacity)
  const line = `rgba(${r}, ${g}, ${b}, ${alpha})`

  if (pattern === 'hatch') {
    return {
      backgroundImage: `repeating-linear-gradient(0deg, ${line} 0px, ${line} 1px, transparent 1px, transparent 6px)`,
      backgroundSize: '100% 100%',
    }
  }

  if (pattern === 'crosshatch') {
    return {
      backgroundImage: `repeating-linear-gradient(0deg, ${line} 0px, ${line} 1px, transparent 1px, transparent 6px), repeating-linear-gradient(90deg, ${line} 0px, ${line} 1px, transparent 1px, transparent 6px)`,
      backgroundSize: '100% 100%',
    }
  }

  if (pattern === 'diagonal') {
    return {
      backgroundImage: `repeating-linear-gradient(45deg, ${line} 0px, ${line} 1px, transparent 1px, transparent 8px)`,
      backgroundSize: '100% 100%',
    }
  }

  if (pattern === 'diagonalCross') {
    return {
      backgroundImage: `repeating-linear-gradient(45deg, ${line} 0px, ${line} 1px, transparent 1px, transparent 8px), repeating-linear-gradient(-45deg, ${line} 0px, ${line} 1px, transparent 1px, transparent 8px)`,
      backgroundSize: '100% 100%',
    }
  }

  if (pattern === 'dots') {
    return {
      backgroundImage: `radial-gradient(${line} 1px, transparent 1.2px)`,
      backgroundSize: '6px 6px',
    }
  }

  return {
    backgroundImage: `repeating-linear-gradient(0deg, ${line} 0px, ${line} 1px, transparent 1px, transparent 4px), repeating-linear-gradient(90deg, ${line} 0px, ${line} 1px, transparent 1px, transparent 4px)`,
    backgroundSize: '100% 100%',
  }
}

export function polygonPatternCss(
  library: PolygonPatternLibrary,
  patternName: string,
  patternColor: string,
  opacity = 0.65,
): { backgroundImage?: string; backgroundSize?: string } {
  if (library === 'hero') {
    const hero = HERO_PATTERN_MAP.get(patternName)
    if (!hero) {
      return {}
    }
    return {
      backgroundImage: hero.fn(patternColor, clamp01(opacity)),
      backgroundSize: 'auto',
    }
  }

  return backgroundFromBuiltin(normalizePolygonPattern(patternName), patternColor, opacity)
}

export function listPatternOptions(library: PolygonPatternLibrary, search = ''): PatternOption[] {
  const query = search.trim().toLowerCase()

  if (library === 'hero') {
    const options = HERO_PATTERNS.map((item) => ({
      name: item.name,
      label: item.label,
      keywords: item.keywords,
    }))

    if (!query) {
      return options
    }

    return options.filter((option) => {
      const hay = `${option.name} ${option.label} ${option.keywords.join(' ')}`.toLowerCase()
      return hay.includes(query)
    })
  }

  const options = BUILTIN_PATTERN_OPTIONS.map((item) => ({
    name: item.value,
    label: item.label,
    keywords: item.keywords,
  }))

  if (!query) {
    return options
  }

  return options.filter((option) => {
    const hay = `${option.name} ${option.label} ${option.keywords.join(' ')}`.toLowerCase()
    return hay.includes(query)
  })
}

function parseCssUrl(value: string): string | null {
  const match = value.trim().match(/^url\((['"]?)(.+)\1\)$/)
  if (!match) {
    return null
  }
  return match[2] ?? null
}

function parseSvgSize(dataUrl: string): { width: number; height: number } {
  const fallback = { width: 80, height: 80 }
  const prefix = 'data:image/svg+xml,'
  if (!dataUrl.startsWith(prefix)) {
    return fallback
  }

  const encoded = dataUrl.slice(prefix.length)
  let decoded = ''
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    return fallback
  }

  const widthToken = decoded.match(/\bwidth=["']([0-9.]+)["']/i)?.[1]
  const heightToken = decoded.match(/\bheight=["']([0-9.]+)["']/i)?.[1]
  const width = widthToken ? Number(widthToken) : NaN
  const height = heightToken ? Number(heightToken) : NaN

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    const viewBoxToken = decoded.match(/\bviewBox=["']([0-9.\s-]+)["']/i)?.[1]
    if (viewBoxToken) {
      const parts = viewBoxToken
        .trim()
        .split(/\s+/)
        .map((item) => Number(item))
      if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[2] > 0 && parts[3] > 0) {
        return { width: parts[2], height: parts[3] }
      }
    }
    return fallback
  }

  return { width, height }
}

function drawHorizontal(ctx: CanvasRenderingContext2D, size: number, step: number): void {
  for (let y = 0; y <= size; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y)
    ctx.stroke()
  }
}

function drawVertical(ctx: CanvasRenderingContext2D, size: number, step: number): void {
  for (let x = 0; x <= size; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, size)
    ctx.stroke()
  }
}

function drawDiagonal(ctx: CanvasRenderingContext2D, size: number, step: number, reverse = false): void {
  for (let offset = -size; offset <= size * 2; offset += step) {
    ctx.beginPath()
    if (reverse) {
      ctx.moveTo(offset, 0)
      ctx.lineTo(offset + size, size)
    } else {
      ctx.moveTo(offset, 0)
      ctx.lineTo(offset - size, size)
    }
    ctx.stroke()
  }
}

function drawBuiltinPatternTile(
  ctx: CanvasRenderingContext2D,
  pattern: PolygonPatternStyle,
  offsetX: number,
  tileSize: number,
): void {
  ctx.save()
  ctx.translate(offsetX, 0)
  ctx.clearRect(0, 0, tileSize, tileSize)
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'

  if (pattern === 'solid') {
    ctx.fillRect(0, 0, tileSize, tileSize)
    ctx.restore()
    return
  }

  if (pattern === 'hatch') {
    drawHorizontal(ctx, tileSize, 6)
    ctx.restore()
    return
  }

  if (pattern === 'crosshatch') {
    drawHorizontal(ctx, tileSize, 6)
    drawVertical(ctx, tileSize, 6)
    ctx.restore()
    return
  }

  if (pattern === 'diagonal') {
    drawDiagonal(ctx, tileSize, 8, false)
    ctx.restore()
    return
  }

  if (pattern === 'diagonalCross') {
    drawDiagonal(ctx, tileSize, 8, false)
    drawDiagonal(ctx, tileSize, 8, true)
    ctx.restore()
    return
  }

  if (pattern === 'dots') {
    for (let y = 2; y < tileSize; y += 6) {
      for (let x = 2; x < tileSize; x += 6) {
        ctx.beginPath()
        ctx.arc(x, y, 1.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
    return
  }

  drawHorizontal(ctx, tileSize, 4)
  drawVertical(ctx, tileSize, 4)
  ctx.restore()
}

let builtinAtlasCache: PatternAtlasSpec | null = null

function getBuiltinPatternAtlas(): PatternAtlasSpec | null {
  if (typeof document === 'undefined') {
    return null
  }
  if (builtinAtlasCache) {
    return builtinAtlasCache
  }

  const patterns: PolygonPatternStyle[] = ['solid', 'hatch', 'crosshatch', 'diagonal', 'diagonalCross', 'dots', 'grid']
  const tileSize = 24
  const canvas = document.createElement('canvas')
  canvas.width = tileSize * patterns.length
  canvas.height = tileSize

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  const mapping: Record<string, { x: number; y: number; width: number; height: number; mask: boolean }> = {}
  patterns.forEach((pattern, index) => {
    const x = index * tileSize
    drawBuiltinPatternTile(ctx, pattern, x, tileSize)
    mapping[pattern] = {
      x,
      y: 0,
      width: tileSize,
      height: tileSize,
      mask: true,
    }
  })

  builtinAtlasCache = {
    atlas: canvas,
    mapping,
  }

  return builtinAtlasCache
}

export function getPatternAtlasSpec(
  library: PolygonPatternLibrary,
  patternName: string,
): PatternAtlasSpec | null {
  if (library === 'hero') {
    const hero = HERO_PATTERN_MAP.get(patternName)
    if (!hero) {
      return null
    }

    const background = hero.fn('#ffffff', 1)
    const dataUrl = parseCssUrl(background)
    if (!dataUrl) {
      return null
    }

    const size = parseSvgSize(dataUrl)
    return {
      atlas: dataUrl,
      mapping: {
        [hero.name]: {
          x: 0,
          y: 0,
          width: Math.max(8, Math.round(size.width)),
          height: Math.max(8, Math.round(size.height)),
          mask: true,
        },
      },
    }
  }

  return getBuiltinPatternAtlas()
}
