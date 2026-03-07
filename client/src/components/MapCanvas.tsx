import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { GeoJsonLayer, IconLayer, TextLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PathStyleExtension } from '@deck.gl/extensions'
import type { Feature as GeoJsonFeature, FeatureCollection as GeoJsonFeatureCollection, Geometry } from 'geojson'
import type { FeatureCollection, Layer, LayerIconLibrary } from '../types/gis'
import { iconifySvgUrl, resolveIconId } from '../utils/iconLibrary'
import { filterFeatureCollectionByLegend } from '../utils/legend'

interface ZoomRequest {
  layerId: string
  nonce: number
}

interface FitVisibleRequest {
  nonce: number
}

interface LocateRequest {
  lng: number
  lat: number
  zoom?: number
  bearing?: number
  pitch?: number
  nonce: number
}

export interface MapViewportState {
  center: { lng: number; lat: number }
  zoom: number
  bearing: number
  pitch: number
}

export type MeasurementMode = 'distance' | 'area' | null

export interface MeasurementSummary {
  mode: Exclude<MeasurementMode, null>
  value: number
  formatted: string
  vertexCount: number
}

interface MapCanvasProps {
  layers: Layer[]
  visibleByLayerId: Record<string, boolean>
  featureCollections: Record<string, FeatureCollection | undefined>
  legendFilters?: Record<string, string[]>
  analysisOverlay?: FeatureCollection | null
  zoomRequest: ZoomRequest | null
  fitVisibleRequest?: FitVisibleRequest | null
  locateRequest?: LocateRequest | null
  measurementMode?: MeasurementMode
  measurementResetNonce?: number
  activeEditLayerId?: string | null
  editLayerFeatures?: FeatureCollection | null
  onFeatureCreated?: (layerId: string, geometry: Geometry, properties?: Record<string, unknown>) => void
  onFeatureUpdated?: (
    layerId: string,
    featureId: string,
    geometry: Geometry,
    properties?: Record<string, unknown>,
    version?: number,
  ) => void
  onFeatureDeleted?: (layerId: string, featureId: string) => void
  onMeasurementChange?: (summary: MeasurementSummary | null) => void
  onViewStateChange?: (view: MapViewportState) => void
}

const palette = ['#136f63', '#3f88c5', '#ff9f1c', '#a4243b', '#0f4c5c', '#8e44ad', '#6ab04c']

type RgbColor = [number, number, number]
type RgbaColor = [number, number, number, number]

interface LayerStyleEvaluator {
  getFillColor: (feature: unknown) => RgbaColor
  getLineColor: (feature: unknown) => RgbaColor
  getPointColor: (feature: unknown) => RgbaColor
  getPointRadius: (feature: unknown) => number
  pointShape: 'circle' | 'square' | 'icon'
  iconLibrary: LayerIconLibrary
  iconifyPrefix: string
  iconAllowOverlap: boolean
  getIconToken: (feature: unknown) => string
  getIconSize: (feature: unknown) => number
  getIconRotation: (feature: unknown) => number
  getLineWidth: (feature: unknown) => number
  getDashArray: () => [number, number]
  lineDashEnabled: boolean
  getLabelText: (feature: GeoJsonFeature) => string | null
  getLabelPriority: (feature: GeoJsonFeature) => number
  labelColor: RgbaColor
  labelSize: number
  labelHaloColor: RgbaColor
  labelHaloWidth: number
  labelMinZoom: number
  labelMaxZoom: number
  labelTextAnchor: 'start' | 'middle' | 'end'
  labelAlignmentBaseline: 'top' | 'center' | 'bottom'
  labelMaxCount: number
}

function clampOpacity(value: unknown, fallback = 0.8): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return Math.max(0.05, Math.min(1, value))
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return fallback
}

function asHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const token = value.trim()
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(token)) {
    return token
  }
  return fallback
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '')
  const chunk = cleaned.length === 3 ? cleaned.split('').map((c) => `${c}${c}`).join('') : cleaned
  const value = Number.parseInt(chunk, 16)

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function withAlpha(rgb: RgbColor, opacity: number): RgbaColor {
  return [rgb[0], rgb[1], rgb[2], Math.round(clampOpacity(opacity) * 255)]
}

function toNormalizedNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return Math.max(0, Math.min(1, parsed))
}

function featureProperty(feature: unknown, field: string): unknown {
  if (!field) {
    return undefined
  }

  if (typeof feature === 'object' && feature !== null && 'properties' in feature) {
    const props = (feature as { properties?: Record<string, unknown> }).properties
    return props?.[field]
  }

  return undefined
}

function parseExpression(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) {
    return raw
  }
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function mixNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function evaluateExpression(expression: unknown, feature: unknown): unknown {
  if (!Array.isArray(expression)) {
    return expression
  }

  if (!expression.length) {
    return null
  }

  const op = expression[0]
  if (typeof op !== 'string') {
    return null
  }

  const args = expression.slice(1)

  if (op === 'literal') {
    return args[0]
  }

  if (op === 'get') {
    const field = evaluateExpression(args[0], feature)
    return typeof field === 'string' ? featureProperty(feature, field) : undefined
  }

  if (op === 'coalesce') {
    for (const arg of args) {
      const value = evaluateExpression(arg, feature)
      if (value !== null && value !== undefined && value !== '') {
        return value
      }
    }
    return null
  }

  if (op === 'to-number') {
    const value = Number(evaluateExpression(args[0], feature))
    if (Number.isFinite(value)) {
      return value
    }
    if (args.length > 1) {
      const fallback = Number(evaluateExpression(args[1], feature))
      return Number.isFinite(fallback) ? fallback : 0
    }
    return 0
  }

  if (op === 'to-string') {
    const value = evaluateExpression(args[0], feature)
    return value === null || value === undefined ? '' : String(value)
  }

  if (op === 'case') {
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (evaluateExpression(args[i], feature)) {
        return evaluateExpression(args[i + 1], feature)
      }
    }
    return args.length % 2 === 1 ? evaluateExpression(args[args.length - 1], feature) : null
  }

  if (op === 'match') {
    const input = evaluateExpression(args[0], feature)
    for (let i = 1; i + 2 <= args.length; i += 2) {
      const matcher = args[i]
      const output = args[i + 1]
      const isMatch = Array.isArray(matcher)
        ? matcher.some((token) => Object.is(input, token))
        : Object.is(input, matcher)
      if (isMatch) {
        return evaluateExpression(output, feature)
      }
    }
    return args.length >= 2 ? evaluateExpression(args[args.length - 1], feature) : null
  }

  if (op === 'step') {
    const input = Number(evaluateExpression(args[0], feature))
    if (!Number.isFinite(input) || args.length < 2) {
      return null
    }
    let output = evaluateExpression(args[1], feature)
    for (let i = 2; i + 1 < args.length; i += 2) {
      const stop = Number(evaluateExpression(args[i], feature))
      if (Number.isFinite(stop) && input >= stop) {
        output = evaluateExpression(args[i + 1], feature)
      }
    }
    return output
  }

  if (op === 'interpolate') {
    if (args.length < 4) {
      return null
    }
    const input = Number(evaluateExpression(args[1], feature))
    if (!Number.isFinite(input)) {
      return null
    }

    const stops: Array<{ input: number; output: unknown }> = []
    for (let i = 2; i + 1 < args.length; i += 2) {
      const stopInput = Number(evaluateExpression(args[i], feature))
      if (!Number.isFinite(stopInput)) {
        continue
      }
      stops.push({ input: stopInput, output: evaluateExpression(args[i + 1], feature) })
    }

    if (!stops.length) {
      return null
    }
    if (input <= stops[0].input) {
      return stops[0].output
    }
    if (input >= stops[stops.length - 1].input) {
      return stops[stops.length - 1].output
    }

    for (let i = 1; i < stops.length; i += 1) {
      const previous = stops[i - 1]
      const next = stops[i]
      if (input < next.input) {
        const t = (input - previous.input) / (next.input - previous.input)
        const a = previous.output
        const b = next.output

        if (typeof a === 'number' && typeof b === 'number') {
          return mixNumber(a, b, t)
        }

        if (typeof a === 'string' && typeof b === 'string') {
          const ca = hexToRgb(asHexColor(a, '#000000'))
          const cb = hexToRgb(asHexColor(b, '#000000'))
          return [
            Math.round(mixNumber(ca[0], cb[0], t)),
            Math.round(mixNumber(ca[1], cb[1], t)),
            Math.round(mixNumber(ca[2], cb[2], t)),
          ]
        }

        return a
      }
    }
  }

  const unary = args.length ? evaluateExpression(args[0], feature) : null
  const binaryA = args.length ? evaluateExpression(args[0], feature) : null
  const binaryB = args.length > 1 ? evaluateExpression(args[1], feature) : null

  if (op === '!') {
    return !unary
  }
  if (op === 'all') {
    return args.every((arg) => Boolean(evaluateExpression(arg, feature)))
  }
  if (op === 'any') {
    return args.some((arg) => Boolean(evaluateExpression(arg, feature)))
  }
  if (op === '==' || op === '!=') {
    const matches = Object.is(binaryA, binaryB)
    return op === '==' ? matches : !matches
  }
  if (op === '>' || op === '>=' || op === '<' || op === '<=') {
    const a = Number(binaryA)
    const b = Number(binaryB)
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return false
    }
    if (op === '>') {
      return a > b
    }
    if (op === '>=') {
      return a >= b
    }
    if (op === '<') {
      return a < b
    }
    return a <= b
  }
  if (op === '+' || op === '-' || op === '*' || op === '/') {
    const numbers = args.map((arg) => Number(evaluateExpression(arg, feature)))
    if (numbers.some((value) => !Number.isFinite(value))) {
      return 0
    }
    if (op === '+') {
      return numbers.reduce((sum, value) => sum + value, 0)
    }
    if (op === '*') {
      return numbers.reduce((product, value) => product * value, 1)
    }
    if (op === '-') {
      if (numbers.length === 1) {
        return -numbers[0]
      }
      return numbers.slice(1).reduce((result, value) => result - value, numbers[0] ?? 0)
    }
    if (numbers.length < 2 || numbers[1] === 0) {
      return 0
    }
    return numbers[0] / numbers[1]
  }

  return null
}

function parseColorResult(value: unknown): { rgb: RgbColor; opacity?: number } | null {
  if (typeof value === 'string') {
    return { rgb: hexToRgb(asHexColor(value, '#000000')) }
  }

  if (Array.isArray(value) && value.length >= 3) {
    const r = Number(value[0])
    const g = Number(value[1])
    const b = Number(value[2])
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return null
    }
    const result: { rgb: RgbColor; opacity?: number } = {
      rgb: [
        Math.max(0, Math.min(255, Math.round(r))),
        Math.max(0, Math.min(255, Math.round(g))),
        Math.max(0, Math.min(255, Math.round(b))),
      ],
    }
    if (value.length > 3) {
      const rawOpacity = Number(value[3])
      if (Number.isFinite(rawOpacity)) {
        result.opacity = rawOpacity > 1 ? rawOpacity / 255 : rawOpacity
      }
    }
    return result
  }

  return null
}

function isPointGeometryType(type: Geometry['type']): boolean {
  return type === 'Point' || type === 'MultiPoint'
}

function resolveLayerStyle(layer: Layer, index: number): LayerStyleEvaluator {
  const fallbackColor = palette[index % palette.length]
  const style = (layer.style ?? {}) as Record<string, unknown>
  const rendererType = style.rendererType === 'uniqueValue' || style.rendererType === 'classBreaks'
    ? style.rendererType
    : 'simple'

  const baseColorHex = asHexColor(style.color, fallbackColor)
  const baseOpacity = clampOpacity(style.opacity, 0.8)
  const strokeColorHex = asHexColor(style.strokeColor, baseColorHex)
  const lineWidth = Math.max(1, asNumber(style.strokeWidth, 2))
  const pointRadius = Math.max(2, asNumber(style.pointRadius, 6))
  const pointShape =
    style.pointShape === 'square' || style.pointShape === 'icon'
      ? style.pointShape
      : 'circle'
  const iconLibrary: LayerIconLibrary =
    style.iconLibrary === 'maki' ||
    style.iconLibrary === 'tabler' ||
    style.iconLibrary === 'lucide' ||
    style.iconLibrary === 'heroicons_outline' ||
    style.iconLibrary === 'heroicons_solid' ||
    style.iconLibrary === 'material_symbols' ||
    style.iconLibrary === 'iconify'
      ? style.iconLibrary
      : 'maki'
  const iconifyPrefix = typeof style.iconifyPrefix === 'string' ? style.iconifyPrefix : 'maki'
  const iconName = typeof style.iconName === 'string' ? style.iconName : 'marker'
  const iconField = typeof style.iconField === 'string' ? style.iconField : ''
  const iconSizeScale = Math.max(0.2, asNumber(style.iconSize, 1))
  const iconRotation = asNumber(style.iconRotation, 0)
  const iconRotationField = typeof style.iconRotationField === 'string' ? style.iconRotationField : ''
  const iconAllowOverlap = typeof style.iconAllowOverlap === 'boolean' ? style.iconAllowOverlap : true
  const lineDashArray =
    Array.isArray(style.lineDashArray) &&
    style.lineDashArray.length >= 2 &&
    typeof style.lineDashArray[0] === 'number' &&
    typeof style.lineDashArray[1] === 'number'
      ? ([Math.max(0, style.lineDashArray[0]), Math.max(0, style.lineDashArray[1])] as [number, number])
      : ([1, 0] as [number, number])

  const sizeField = typeof style.sizeField === 'string' ? style.sizeField : ''
  const sizeMin = Math.max(1, asNumber(style.sizeMin, pointRadius))
  const sizeMax = Math.max(sizeMin, asNumber(style.sizeMax, pointRadius))
  const opacityField = typeof style.opacityField === 'string' ? style.opacityField : ''
  const opacityMin = clampOpacity(style.opacityMin, 0.2)
  const opacityMax = Math.max(opacityMin, clampOpacity(style.opacityMax, 1))
  const fillColorExpression = parseExpression(style.fillColorExpression)
  const lineColorExpression = parseExpression(style.lineColorExpression)
  const pointRadiusExpression = parseExpression(style.pointRadiusExpression)
  const opacityExpression = parseExpression(style.opacityExpression)

  const labelField = typeof style.labelField === 'string' ? style.labelField : ''
  const labelTextExpression = parseExpression(style.labelTextExpression)
  const labelPriorityField = typeof style.labelPriorityField === 'string' ? style.labelPriorityField : ''
  const labelAnchor =
    style.labelAnchor === 'top' ||
    style.labelAnchor === 'bottom' ||
    style.labelAnchor === 'left' ||
    style.labelAnchor === 'right'
      ? style.labelAnchor
      : 'center'
  const labelMaxCount = Math.max(10, Math.min(20_000, asNumber(style.labelMaxCount, 2000)))
  const labelColor = withAlpha(hexToRgb(asHexColor(style.labelColor, '#1b1f24')), 1)
  const labelSize = Math.max(8, asNumber(style.labelSize, 14))
  const labelHaloColor = withAlpha(hexToRgb(asHexColor(style.labelHaloColor, '#ffffff')), 1)
  const labelHaloWidth = Math.max(0, asNumber(style.labelHaloWidth, 1))
  const labelMinZoom = Math.max(0, asNumber(style.labelMinZoom, 0))
  const labelMaxZoom = Math.max(labelMinZoom, asNumber(style.labelMaxZoom, 24))
  const labelTextAnchor: 'start' | 'middle' | 'end' =
    labelAnchor === 'left' ? 'end' : labelAnchor === 'right' ? 'start' : 'middle'
  const labelAlignmentBaseline: 'top' | 'center' | 'bottom' =
    labelAnchor === 'top' ? 'bottom' : labelAnchor === 'bottom' ? 'top' : 'center'

  const baseRgb = hexToRgb(baseColorHex)
  const strokeRgb = hexToRgb(strokeColorHex)

  const resolvedOpacity = (feature: unknown, fallbackOpacity: number): number => {
    let opacity = fallbackOpacity
    if (opacityField) {
      const normalized = toNormalizedNumber(featureProperty(feature, opacityField))
      if (normalized !== null) {
        opacity = opacityMin + normalized * (opacityMax - opacityMin)
      }
    }
    if (opacityExpression) {
      const fromExpression = Number(evaluateExpression(opacityExpression, feature))
      if (Number.isFinite(fromExpression)) {
        opacity = fromExpression
      }
    }
    return clampOpacity(opacity, baseOpacity)
  }

  const resolvedPointRadius = (feature: unknown): number => {
    let radius = pointRadius
    if (sizeField) {
      const normalized = toNormalizedNumber(featureProperty(feature, sizeField))
      if (normalized !== null) {
        radius = sizeMin + normalized * (sizeMax - sizeMin)
      }
    }
    if (pointRadiusExpression) {
      const fromExpression = Number(evaluateExpression(pointRadiusExpression, feature))
      if (Number.isFinite(fromExpression)) {
        radius = fromExpression
      }
    }
    return Math.max(1, radius)
  }

  const resolveColorExpression = (
    feature: unknown,
    expression: unknown[] | null,
    fallbackRgb: RgbColor,
    fallbackOpacity: number,
  ): RgbaColor => {
    if (!expression) {
      return withAlpha(fallbackRgb, fallbackOpacity)
    }
    const parsed = parseColorResult(evaluateExpression(expression, feature))
    if (!parsed) {
      return withAlpha(fallbackRgb, fallbackOpacity)
    }
    return withAlpha(parsed.rgb, parsed.opacity ?? fallbackOpacity)
  }

  const getLabelText = (feature: GeoJsonFeature): string | null => {
    if (labelTextExpression) {
      const value = evaluateExpression(labelTextExpression, feature)
      if (value === null || value === undefined || value === '') {
        return null
      }
      return String(value)
    }

    if (!labelField) {
      return null
    }
    const value = (feature.properties ?? {})[labelField]
    if (value === null || value === undefined || value === '') {
      return null
    }
    return String(value)
  }

  const getLabelPriority = (feature: GeoJsonFeature): number => {
    if (!labelPriorityField) {
      return 0
    }
    const value = Number((feature.properties ?? {})[labelPriorityField])
    return Number.isFinite(value) ? value : 0
  }

  const buildEvaluator = (getBaseSymbol: (feature: unknown) => { color: RgbColor; opacity: number }): LayerStyleEvaluator => ({
    getFillColor: (feature) => {
      const baseSymbol = getBaseSymbol(feature)
      const opacity = resolvedOpacity(feature, baseSymbol.opacity)
      return resolveColorExpression(feature, fillColorExpression, baseSymbol.color, opacity)
    },
    getLineColor: (feature) => {
      const opacity = resolvedOpacity(feature, baseOpacity)
      return resolveColorExpression(feature, lineColorExpression, strokeRgb, opacity)
    },
    getPointColor: (feature) => {
      const baseSymbol = getBaseSymbol(feature)
      const opacity = resolvedOpacity(feature, baseSymbol.opacity)
      return resolveColorExpression(feature, fillColorExpression, baseSymbol.color, opacity)
    },
    getPointRadius: resolvedPointRadius,
    pointShape,
    iconLibrary,
    iconifyPrefix,
    iconAllowOverlap,
    getIconToken: (feature) => {
      const fieldValue = iconField ? featureProperty(feature, iconField) : null
      if (fieldValue !== null && fieldValue !== undefined && String(fieldValue).trim()) {
        return String(fieldValue)
      }
      return iconName
    },
    getIconSize: (feature) => Math.max(8, resolvedPointRadius(feature) * iconSizeScale * 3),
    getIconRotation: (feature) => {
      if (!iconRotationField) {
        return iconRotation
      }
      const fromField = Number(featureProperty(feature, iconRotationField))
      return Number.isFinite(fromField) ? fromField : iconRotation
    },
    getLineWidth: () => lineWidth,
    getDashArray: () => lineDashArray,
    lineDashEnabled: lineDashArray[1] > 0,
    getLabelText,
    getLabelPriority,
    labelColor,
    labelSize,
    labelHaloColor,
    labelHaloWidth,
    labelMinZoom,
    labelMaxZoom,
    labelTextAnchor,
    labelAlignmentBaseline,
    labelMaxCount,
  })

  if (rendererType === 'uniqueValue') {
    const field = typeof style.uniqueValueField === 'string' ? style.uniqueValueField : ''
    const defaultColor = hexToRgb(asHexColor(style.uniqueDefaultColor, baseColorHex))
    const defaultOpacity = clampOpacity(style.uniqueDefaultOpacity, baseOpacity)
    const stopMap = new Map<string, { color: RgbColor; opacity: number }>()

    const stops = Array.isArray(style.uniqueValueStops) ? style.uniqueValueStops : []
    for (const stop of stops) {
      if (typeof stop !== 'object' || stop === null) {
        continue
      }

      const token = stop as { value?: unknown; color?: unknown; opacity?: unknown }
      if (token.value === undefined || token.value === null) {
        continue
      }

      stopMap.set(String(token.value), {
        color: hexToRgb(asHexColor(token.color, baseColorHex)),
        opacity: clampOpacity(token.opacity, baseOpacity),
      })
    }

    return buildEvaluator((feature) => {
      const key = String(featureProperty(feature, field) ?? '')
      const matched = stopMap.get(key)
      return {
        color: matched?.color ?? defaultColor,
        opacity: matched?.opacity ?? defaultOpacity,
      }
    })
  }

  if (rendererType === 'classBreaks') {
    const field = typeof style.classBreakField === 'string' ? style.classBreakField : ''
    const defaultColor = hexToRgb(asHexColor(style.classBreakDefaultColor, baseColorHex))
    const defaultOpacity = clampOpacity(style.classBreakDefaultOpacity, baseOpacity)
    const breaks = (Array.isArray(style.classBreakStops) ? style.classBreakStops : [])
      .map((stop) => {
        if (typeof stop !== 'object' || stop === null) {
          return null
        }

        const token = stop as { min?: unknown; max?: unknown; color?: unknown; opacity?: unknown }
        if (typeof token.min !== 'number' || typeof token.max !== 'number') {
          return null
        }

        return {
          min: token.min,
          max: token.max,
          color: hexToRgb(asHexColor(token.color, baseColorHex)),
          opacity: clampOpacity(token.opacity, baseOpacity),
        }
      })
      .filter((stop): stop is { min: number; max: number; color: RgbColor; opacity: number } => Boolean(stop))
      .sort((a, b) => a.min - b.min)

    return buildEvaluator((feature) => {
      const rawValue = featureProperty(feature, field)
      const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue)
      if (!Number.isFinite(numeric)) {
        return { color: defaultColor, opacity: defaultOpacity }
      }

      for (let index = 0; index < breaks.length; index += 1) {
        const stop = breaks[index]
        const isLast = index === breaks.length - 1
        if (numeric >= stop.min && (numeric < stop.max || (isLast && numeric <= stop.max))) {
          return { color: stop.color, opacity: stop.opacity }
        }
      }

      return { color: defaultColor, opacity: defaultOpacity }
    })
  }

  return buildEvaluator(() => ({ color: baseRgb, opacity: baseOpacity }))
}

function extendBoundsFromCoordinates(bounds: maplibregl.LngLatBounds, coordinates: unknown): void {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return
  }

  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    bounds.extend([coordinates[0], coordinates[1]])
    return
  }

  for (const nested of coordinates) {
    extendBoundsFromCoordinates(bounds, nested)
  }
}

function extendBoundsFromGeometry(bounds: maplibregl.LngLatBounds, geometry: Geometry): void {
  if (geometry.type === 'GeometryCollection') {
    for (const nested of geometry.geometries) {
      extendBoundsFromGeometry(bounds, nested)
    }
    return
  }

  extendBoundsFromCoordinates(bounds, geometry.coordinates)
}

function centroidFromPolygonCoordinates(coordinates: unknown): [number, number] | null {
  if (!Array.isArray(coordinates) || !coordinates.length || !Array.isArray(coordinates[0])) {
    return null
  }

  const ring = coordinates[0]
  if (!Array.isArray(ring) || !ring.length) {
    return null
  }

  let sumX = 0
  let sumY = 0
  let count = 0
  for (const point of ring) {
    if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') {
      continue
    }
    sumX += point[0]
    sumY += point[1]
    count += 1
  }

  if (!count) {
    return null
  }
  return [sumX / count, sumY / count]
}

function labelPosition(feature: GeoJsonFeature): [number, number] | null {
  const geometry = feature.geometry
  if (!geometry) {
    return null
  }

  if (geometry.type === 'Point') {
    return [geometry.coordinates[0], geometry.coordinates[1]]
  }

  if (geometry.type === 'MultiPoint' && geometry.coordinates[0]) {
    return [geometry.coordinates[0][0], geometry.coordinates[0][1]]
  }

  if (geometry.type === 'LineString' && geometry.coordinates[0]) {
    const mid = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)]
    return [mid[0], mid[1]]
  }

  if (geometry.type === 'MultiLineString' && geometry.coordinates[0]?.length) {
    const line = geometry.coordinates[0]
    const mid = line[Math.floor(line.length / 2)]
    return [mid[0], mid[1]]
  }

  if (geometry.type === 'Polygon') {
    return centroidFromPolygonCoordinates(geometry.coordinates)
  }

  if (geometry.type === 'MultiPolygon' && geometry.coordinates[0]) {
    return centroidFromPolygonCoordinates(geometry.coordinates[0])
  }

  return null
}

function fitCollectionBounds(map: maplibregl.Map, collection: GeoJsonFeatureCollection | null | undefined): boolean {
  if (!collection?.features?.length) {
    return false
  }

  const bounds = new maplibregl.LngLatBounds()

  for (const feature of collection.features) {
    if (!feature.geometry) {
      continue
    }

    extendBoundsFromGeometry(bounds, feature.geometry)
  }

  if (bounds.isEmpty()) {
    return false
  }

  map.fitBounds(bounds, { padding: 60, duration: 700 })
  return true
}

function mapboxDrawWithMapLibreClasses(): typeof MapboxDraw {
  const draw = MapboxDraw as unknown as {
    constants?: {
      classes: Record<string, string>
    }
  }

  if (draw.constants?.classes) {
    draw.constants.classes.CANVAS = 'maplibregl-canvas'
    draw.constants.classes.CONTROL_BASE = 'maplibregl-ctrl'
    draw.constants.classes.CONTROL_PREFIX = 'maplibregl-ctrl-'
    draw.constants.classes.CONTROL_GROUP = 'maplibregl-ctrl-group'
    draw.constants.classes.ATTRIBUTION = 'maplibregl-ctrl-attrib'
  }

  return MapboxDraw
}

const EARTH_RADIUS_METERS = 6_371_008.8

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function segmentDistanceMeters(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const sLat1 = toRadians(lat1)
  const sLat2 = toRadians(lat2)

  const root =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(root)))
}

function lineDistanceMeters(vertices: Array<[number, number]>): number {
  if (vertices.length < 2) {
    return 0
  }

  let sum = 0
  for (let index = 1; index < vertices.length; index += 1) {
    sum += segmentDistanceMeters(vertices[index - 1], vertices[index])
  }

  return sum
}

function polygonAreaSqMeters(vertices: Array<[number, number]>): number {
  if (vertices.length < 3) {
    return 0
  }

  let sum = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const [lng1, lat1] = vertices[index]
    const [lng2, lat2] = vertices[(index + 1) % vertices.length]
    sum += (toRadians(lng2) - toRadians(lng1)) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)))
  }

  return Math.abs(sum) * ((EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2)
}

function formatDistanceMeters(value: number): string {
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)} km`
  }
  return `${value.toFixed(1)} m`
}

function formatAreaSqMeters(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} km²`
  }
  return `${value.toFixed(1)} m²`
}

export function MapCanvas({
  layers,
  visibleByLayerId,
  featureCollections,
  legendFilters = {},
  analysisOverlay = null,
  zoomRequest,
  fitVisibleRequest,
  locateRequest,
  measurementMode = null,
  measurementResetNonce = 0,
  activeEditLayerId = null,
  editLayerFeatures = null,
  onFeatureCreated,
  onFeatureUpdated,
  onFeatureDeleted,
  onMeasurementChange,
  onViewStateChange,
}: MapCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const drawRef = useRef<MapboxDraw | null>(null)
  const syncingDrawRef = useRef(false)
  const [mapInitError, setMapInitError] = useState<string | null>(null)
  const [mapZoom, setMapZoom] = useState(12)
  const [measurementVertices, setMeasurementVertices] = useState<Array<[number, number]>>([])

  const activeEditLayerIdRef = useRef<string | null>(activeEditLayerId)
  const onFeatureCreatedRef = useRef(onFeatureCreated)
  const onFeatureUpdatedRef = useRef(onFeatureUpdated)
  const onFeatureDeletedRef = useRef(onFeatureDeleted)
  const measurementModeRef = useRef<MeasurementMode>(measurementMode)
  const onMeasurementChangeRef = useRef(onMeasurementChange)

  useEffect(() => {
    activeEditLayerIdRef.current = activeEditLayerId
    onFeatureCreatedRef.current = onFeatureCreated
    onFeatureUpdatedRef.current = onFeatureUpdated
    onFeatureDeletedRef.current = onFeatureDeleted
  }, [activeEditLayerId, onFeatureCreated, onFeatureUpdated, onFeatureDeleted])

  useEffect(() => {
    measurementModeRef.current = measurementMode
    onMeasurementChangeRef.current = onMeasurementChange
  }, [measurementMode, onMeasurementChange])

  const measurementSummary = useMemo<MeasurementSummary | null>(() => {
    if (!measurementMode || !measurementVertices.length) {
      return null
    }

    if (measurementMode === 'distance') {
      const value = lineDistanceMeters(measurementVertices)
      if (!value) {
        return null
      }

      return {
        mode: 'distance',
        value,
        formatted: formatDistanceMeters(value),
        vertexCount: measurementVertices.length,
      }
    }

    const value = polygonAreaSqMeters(measurementVertices)
    if (!value) {
      return null
    }

    return {
      mode: 'area',
      value,
      formatted: formatAreaSqMeters(value),
      vertexCount: measurementVertices.length,
    }
  }, [measurementMode, measurementVertices])

  const measurementOverlay = useMemo<GeoJsonFeatureCollection | null>(() => {
    if (!measurementMode || !measurementVertices.length) {
      return null
    }

    const pointFeatures: GeoJsonFeature[] = measurementVertices.map((vertex, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: vertex },
      properties: { index: index + 1 },
    }))

    let geometry: Geometry

    if (measurementMode === 'distance') {
      geometry =
        measurementVertices.length >= 2
          ? { type: 'LineString', coordinates: measurementVertices }
          : { type: 'Point', coordinates: measurementVertices[0] }
    } else if (measurementVertices.length >= 3) {
      geometry = {
        type: 'Polygon',
        coordinates: [[...measurementVertices, measurementVertices[0]]],
      }
    } else if (measurementVertices.length === 2) {
      geometry = { type: 'LineString', coordinates: measurementVertices }
    } else {
      geometry = { type: 'Point', coordinates: measurementVertices[0] }
    }

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry,
          properties: { measurement: true, mode: measurementMode },
        },
        ...pointFeatures,
      ],
    }
  }, [measurementMode, measurementVertices])

  const deckLayers = useMemo(() => {
    const builtLayers: Array<GeoJsonLayer | IconLayer | TextLayer> = []

    for (const [index, layer] of layers.entries()) {
      if (!visibleByLayerId[layer.id]) {
        continue
      }

      if (activeEditLayerId && layer.id === activeEditLayerId) {
        continue
      }

      const data = featureCollections[layer.id]
      if (!data) {
        continue
      }
      const hiddenLegendKeys = new Set(legendFilters[layer.id] ?? [])
      const filteredData = filterFeatureCollectionByLegend(layer, data, hiddenLegendKeys)
      if (!filteredData.features.length) {
        continue
      }

      const evaluator = resolveLayerStyle(layer, index)
      const dashExtensions = evaluator.lineDashEnabled ? [new PathStyleExtension({ dash: true })] : []
      const iconMode = evaluator.pointShape === 'icon'

      if (iconMode) {
        const nonPointFeatures = filteredData.features.filter((feature) => {
          const geometry = feature.geometry
          return geometry ? !isPointGeometryType(geometry.type) : false
        })

        if (nonPointFeatures.length) {
          builtLayers.push(
            new GeoJsonLayer({
              id: `layer-${layer.id}-non-points`,
              data: { ...filteredData, features: nonPointFeatures },
              pickable: true,
              autoHighlight: true,
              stroked: true,
              filled: true,
              pointRadiusMinPixels: 0,
              lineWidthMinPixels: 1,
              getLineColor: evaluator.getLineColor,
              getFillColor: evaluator.getFillColor,
              getDashArray: evaluator.getDashArray,
              dashJustified: true,
              getLineWidth: evaluator.getLineWidth,
              getPointRadius: () => 0,
              getPointColor: evaluator.getPointColor,
              extensions: dashExtensions,
              highlightColor: [255, 255, 255, 140],
            }),
          )
        }

        const iconPoints = filteredData.features.flatMap((feature, featureIndex) => {
          const geometry = feature.geometry
          if (!geometry) {
            return []
          }

          if (geometry.type === 'Point') {
            return [{
              id: `${layer.id}-${feature.id ?? featureIndex}-p`,
              feature,
              position: [geometry.coordinates[0], geometry.coordinates[1]] as [number, number],
            }]
          }

          if (geometry.type === 'MultiPoint') {
            return geometry.coordinates.map((point, pointIndex) => ({
              id: `${layer.id}-${feature.id ?? featureIndex}-mp-${pointIndex}`,
              feature,
              position: [point[0], point[1]] as [number, number],
            }))
          }

          return []
        })

        if (iconPoints.length) {
          const iconDefinitionCache = new Map<
            string,
            { url: string; width: number; height: number; anchorY: number; mask: boolean }
          >()

          builtLayers.push(
            new IconLayer({
              id: `layer-${layer.id}-icons`,
              data: iconPoints,
              pickable: true,
              autoHighlight: true,
              billboard: true,
              sizeUnits: 'pixels',
              sizeScale: 1,
              sizeMinPixels: 8,
              sizeMaxPixels: 96,
              getPosition: (d) => d.position,
              getColor: (d) => evaluator.getPointColor(d.feature),
              getSize: (d) => evaluator.getIconSize(d.feature),
              getAngle: (d) => evaluator.getIconRotation(d.feature),
              getIcon: (d) => {
                const iconToken = evaluator.getIconToken(d.feature)
                const iconId = resolveIconId(iconToken, evaluator.iconLibrary, evaluator.iconifyPrefix)
                const cached = iconDefinitionCache.get(iconId)
                if (cached) {
                  return cached
                }
                const created = {
                  url: iconifySvgUrl(iconId),
                  width: 128,
                  height: 128,
                  anchorY: 120,
                  mask: true,
                }
                iconDefinitionCache.set(iconId, created)
                return created
              },
              alphaCutoff: 0.05,
              iconAllowOverlap: evaluator.iconAllowOverlap,
              highlightColor: [255, 255, 255, 140],
            }),
          )
        }
      } else {
        builtLayers.push(
          new GeoJsonLayer({
            id: `layer-${layer.id}`,
            data: filteredData,
            pickable: true,
            autoHighlight: true,
            stroked: true,
            filled: true,
            pointRadiusMinPixels: 2,
            lineWidthMinPixels: 1,
            getLineColor: evaluator.getLineColor,
            getFillColor: evaluator.getFillColor,
            getDashArray: evaluator.getDashArray,
            dashJustified: true,
            getLineWidth: evaluator.getLineWidth,
            getPointRadius: evaluator.getPointRadius,
            getPointColor: evaluator.getPointColor,
            extensions: dashExtensions,
            highlightColor: [255, 255, 255, 140],
          }),
        )
      }

      if (mapZoom >= evaluator.labelMinZoom && mapZoom <= evaluator.labelMaxZoom) {
        const labelData = filteredData.features
          .map((feature) => {
            const text = evaluator.getLabelText(feature)
            if (!text) {
              return null
            }

            const position = labelPosition(feature)
            if (!position) {
              return null
            }

            return {
              text,
              position,
              priority: evaluator.getLabelPriority(feature),
            }
          })
          .filter((item): item is { text: string; position: [number, number]; priority: number } => Boolean(item))
          .sort((a, b) => b.priority - a.priority)
          .slice(0, evaluator.labelMaxCount)

        if (labelData.length) {
          builtLayers.push(
            new TextLayer({
              id: `layer-label-${layer.id}`,
              data: labelData,
              pickable: false,
              billboard: true,
              getPosition: (d) => d.position,
              getText: (d) => d.text,
              getColor: evaluator.labelColor,
              getSize: evaluator.labelSize,
              getTextAnchor: evaluator.labelTextAnchor,
              getAlignmentBaseline: evaluator.labelAlignmentBaseline,
              getOutlineColor: evaluator.labelHaloColor,
              getOutlineWidth: evaluator.labelHaloWidth,
              outlineWidthMaxPixels: 3,
              characterSet: 'auto',
            }),
          )
        }
      }
    }

    if (analysisOverlay?.features?.length) {
      builtLayers.push(
        new GeoJsonLayer({
          id: 'analysis-overlay',
          data: analysisOverlay,
          pickable: true,
          stroked: true,
          filled: true,
          pointRadiusMinPixels: 6,
          lineWidthMinPixels: 2,
          getLineColor: [170, 28, 59, 255],
          getFillColor: [255, 165, 0, 100],
          getPointRadius: 6,
          getPointColor: [170, 28, 59, 255],
        }),
      )
    }

    if (measurementOverlay?.features?.length) {
      builtLayers.push(
        new GeoJsonLayer({
          id: 'measurement-overlay',
          data: measurementOverlay,
          pickable: false,
          stroked: true,
          filled: true,
          pointRadiusMinPixels: 5,
          lineWidthMinPixels: 3,
          getLineColor: [8, 81, 156, 255],
          getFillColor: [8, 81, 156, 60],
          getPointRadius: 6,
          getPointColor: [8, 81, 156, 255],
        }),
      )
    }

    return builtLayers
  }, [layers, visibleByLayerId, featureCollections, legendFilters, analysisOverlay, activeEditLayerId, measurementOverlay, mapZoom])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    let map: maplibregl.Map | null = null
    let overlay: MapboxOverlay | null = null

    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [5.593, 6.297],
        zoom: 12,
        attributionControl: false,
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      // Keep credits away from the legend panel zone.
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')

      overlay = new MapboxOverlay({
        interleaved: true,
        layers: [],
      })

      map.addControl(overlay as unknown as maplibregl.IControl)
    } catch (error) {
      console.error('Map initialization failed', error)
      queueMicrotask(() => {
        setMapInitError('Map preview unavailable in this environment (WebGL required).')
      })
      return
    }

    const onCreate = (event: { features: Array<{ geometry: Geometry; properties?: Record<string, unknown> }> }) => {
      if (syncingDrawRef.current) {
        return
      }

      const layerId = activeEditLayerIdRef.current
      if (!layerId) {
        return
      }

      for (const feature of event.features) {
        onFeatureCreatedRef.current?.(layerId, feature.geometry, feature.properties)
      }
    }

    const onUpdate = (event: {
      features: Array<{ id?: string | number; geometry: Geometry; properties?: Record<string, unknown> }>
    }) => {
      if (syncingDrawRef.current) {
        return
      }

      const layerId = activeEditLayerIdRef.current
      if (!layerId) {
        return
      }

      for (const feature of event.features) {
        const featureId = String(feature.id ?? '')
        if (!featureId) {
          continue
        }

        const version =
          typeof feature.properties?._version === 'number'
            ? (feature.properties._version as number)
            : undefined

        onFeatureUpdatedRef.current?.(layerId, featureId, feature.geometry, feature.properties, version)
      }
    }

    const onDelete = (event: { features: Array<{ id?: string | number }> }) => {
      if (syncingDrawRef.current) {
        return
      }

      const layerId = activeEditLayerIdRef.current
      if (!layerId) {
        return
      }

      for (const feature of event.features) {
        const featureId = String(feature.id ?? '')
        if (!featureId) {
          continue
        }

        onFeatureDeletedRef.current?.(layerId, featureId)
      }
    }

    map.on('draw.create', onCreate)
    map.on('draw.update', onUpdate)
    map.on('draw.delete', onDelete)
    const onMoveEnd = () => {
      const center = map?.getCenter()
      const zoom = map?.getZoom() ?? 12
      setMapZoom(zoom)
      if (center) {
        onViewStateChange?.({
          center: { lng: center.lng, lat: center.lat },
          zoom,
          bearing: map?.getBearing() ?? 0,
          pitch: map?.getPitch() ?? 0,
        })
      }
    }
    map.on('moveend', onMoveEnd)
    onMoveEnd()

    mapRef.current = map
    overlayRef.current = overlay

    return () => {
      if (drawRef.current) {
        map.removeControl(drawRef.current as unknown as maplibregl.IControl)
        drawRef.current = null
      }
      map.off('draw.create', onCreate)
      map.off('draw.update', onUpdate)
      map.off('draw.delete', onDelete)
      map.off('moveend', onMoveEnd)
      overlay.finalize()
      map.remove()
      overlayRef.current = null
      mapRef.current = null
    }
  }, [onViewStateChange])

  useEffect(() => {
    queueMicrotask(() => {
      setMeasurementVertices([])
    })
    onMeasurementChangeRef.current?.(null)
  }, [measurementMode, measurementResetNonce])

  useEffect(() => {
    onMeasurementChangeRef.current?.(measurementSummary)
  }, [measurementSummary])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const onMapClick = (event: maplibregl.MapMouseEvent) => {
      if (!measurementModeRef.current || activeEditLayerIdRef.current) {
        return
      }

      setMeasurementVertices((current) => [...current, [event.lngLat.lng, event.lngLat.lat]])
    }

    map.on('click', onMapClick)
    return () => {
      map.off('click', onMapClick)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const canvas = map.getCanvas()
    const shouldCrosshair = Boolean(measurementMode) && !activeEditLayerId
    canvas.style.cursor = shouldCrosshair ? 'crosshair' : ''

    return () => {
      canvas.style.cursor = ''
    }
  }, [measurementMode, activeEditLayerId])

  useEffect(() => {
    overlayRef.current?.setProps({ layers: deckLayers })
  }, [deckLayers])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    if (!activeEditLayerId) {
      if (drawRef.current) {
        map.removeControl(drawRef.current as unknown as maplibregl.IControl)
        drawRef.current = null
      }
      return
    }

    if (!drawRef.current) {
      const DrawCtor = mapboxDrawWithMapLibreClasses()
      drawRef.current = new DrawCtor({
        displayControlsDefault: false,
        controls: {
          point: true,
          line_string: true,
          polygon: true,
          trash: true,
        },
        defaultMode: 'simple_select',
      })
      map.addControl(drawRef.current as unknown as maplibregl.IControl, 'top-left')
    }

    if (!drawRef.current) {
      return
    }

    syncingDrawRef.current = true
    drawRef.current.deleteAll()

    if (editLayerFeatures?.features?.length) {
      for (const feature of editLayerFeatures.features) {
        if (!feature.geometry) {
          continue
        }

        drawRef.current.add({
          type: 'Feature',
          geometry: feature.geometry,
          properties: (feature.properties ?? {}) as Record<string, unknown>,
          ...(feature.id ? { id: String(feature.id) } : {}),
        })
      }
    }

    syncingDrawRef.current = false
  }, [activeEditLayerId, editLayerFeatures])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !zoomRequest) {
      return
    }

    fitCollectionBounds(map, featureCollections[zoomRequest.layerId])
  }, [zoomRequest, featureCollections])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitVisibleRequest) {
      return
    }

    const merged: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: [] }
    for (const layer of layers) {
      if (!visibleByLayerId[layer.id]) {
        continue
      }

      const collection = featureCollections[layer.id]
      if (!collection) {
        continue
      }

      merged.features.push(...collection.features)
    }

    fitCollectionBounds(map, merged)
  }, [fitVisibleRequest, layers, visibleByLayerId, featureCollections])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !locateRequest) {
      return
    }

    map.flyTo({
      center: [locateRequest.lng, locateRequest.lat],
      zoom: locateRequest.zoom ?? 14,
      bearing: locateRequest.bearing ?? map.getBearing(),
      pitch: locateRequest.pitch ?? map.getPitch(),
      essential: true,
      speed: 0.9,
    })
  }, [locateRequest])

  if (mapInitError) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          background: '#f5f7fb',
          color: '#2e3a59',
          fontSize: 14,
        }}
      >
        {mapInitError}
      </div>
    )
  }

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
}
