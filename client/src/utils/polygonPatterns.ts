import type { PolygonPatternStyle } from '../types/gis'

export const POLYGON_PATTERN_OPTIONS: Array<{ value: PolygonPatternStyle; label: string }> = [
  { value: 'solid', label: 'Solid fill' },
  { value: 'hatch', label: 'Hatch' },
  { value: 'crosshatch', label: 'Crosshatch' },
  { value: 'diagonal', label: 'Diagonal hatch' },
  { value: 'diagonalCross', label: 'Diagonal cross' },
  { value: 'dots', label: 'Dotted' },
  { value: 'grid', label: 'Grid' },
]

const PATTERN_LOOKUP = new Set<PolygonPatternStyle>(POLYGON_PATTERN_OPTIONS.map((item) => item.value))

export function normalizePolygonPattern(value: unknown): PolygonPatternStyle {
  if (typeof value === 'string' && PATTERN_LOOKUP.has(value as PolygonPatternStyle)) {
    return value as PolygonPatternStyle
  }
  return 'solid'
}

export function polygonPatternLabel(pattern: PolygonPatternStyle): string {
  return POLYGON_PATTERN_OPTIONS.find((item) => item.value === pattern)?.label ?? 'Solid fill'
}

function asHexColor(value: string, fallback: string): string {
  const token = value.trim()
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(token) ? token : fallback
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '')
  const chunk = cleaned.length === 3 ? cleaned.split('').map((c) => `${c}${c}`).join('') : cleaned
  const value = Number.parseInt(chunk, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.max(0, Math.min(1, value))
}

export function polygonPatternCss(
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

export interface PolygonPatternAtlas {
  atlas: HTMLCanvasElement
  mapping: Record<PolygonPatternStyle, { x: number; y: number; width: number; height: number; mask: boolean }>
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

function drawPatternTile(
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

let atlasCache: PolygonPatternAtlas | null = null

export function getPolygonPatternAtlas(): PolygonPatternAtlas | null {
  if (typeof document === 'undefined') {
    return null
  }
  if (atlasCache) {
    return atlasCache
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

  const mapping: Partial<Record<PolygonPatternStyle, { x: number; y: number; width: number; height: number; mask: boolean }>> = {}
  patterns.forEach((pattern, index) => {
    const x = index * tileSize
    drawPatternTile(ctx, pattern, x, tileSize)
    mapping[pattern] = {
      x,
      y: 0,
      width: tileSize,
      height: tileSize,
      mask: true,
    }
  })

  atlasCache = {
    atlas: canvas,
    mapping: mapping as Record<PolygonPatternStyle, { x: number; y: number; width: number; height: number; mask: boolean }>,
  }
  return atlasCache
}
