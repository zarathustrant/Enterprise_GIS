import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Button, Chip, Slider, IconButton } from '@mui/material'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import CloseIcon from '@mui/icons-material/Close'
import EditIcon from '@mui/icons-material/Edit'
import maplibregl from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { GeoJsonLayer, IconLayer, TextLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { FillStyleExtension, PathStyleExtension } from '@deck.gl/extensions'
import type { Feature as GeoJsonFeature, FeatureCollection as GeoJsonFeatureCollection, Geometry } from 'geojson'
import type { FeatureCollection, Layer, LayerIconLibrary, PolygonPatternLibrary } from '../types/gis'
import { iconifySvgUrl, resolveIconId } from '../utils/iconLibrary'
import { geometryFamilyFromType, type GeometryFamily } from '../utils/geometry'
import { filterFeatureCollectionByLegend } from '../utils/legend'
import {
  getPatternAtlasSpec,
  normalizePolygonPattern,
  normalizePolygonPatternLibrary,
  resolvePolygonPatternName,
} from '../utils/polygonPatterns'

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

export type AdvancedEditMode =
  | 'split'
  | 'reshape'
  | 'trace'
  | 'rotate-scale'
  | 'rectangular-constraints'
  | 'grid-lock'
  | 'align'

export type AlignTarget = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'

export interface AdvancedEditOptions {
  rotateDegrees: number
  scaleFactor: number
  reshapeStrength: number
  gridSizeMeters: number
  alignTarget: AlignTarget
}

export interface EditCommand {
  action: 'apply' | 'undo' | 'redo'
  nonce: number
}

export interface EditState {
  selectedCount: number
  canUndo: boolean
  canRedo: boolean
}

export interface EditUiState {
  cursor: string
  drawMode: string
  advancedMode: AdvancedEditMode
  snapEnabled: boolean
  snapTemporarilyDisabled: boolean
  snapCandidate: boolean
  snapTolerancePixels: number
}

interface FeatureZoomRequest {
  layerId: string
  featureIds: string[]
  nonce: number
}

interface FlashFeatureRequest {
  layerId: string
  featureId: string
  nonce: number
}

interface MapCanvasProps {
  layers: Layer[]
  visibleByLayerId: Record<string, boolean>
  featureCollections: Record<string, FeatureCollection | undefined>
  legendFilters?: Record<string, string[]>
  analysisOverlay?: FeatureCollection | null
  utilityOverlay?: {
    networkName?: string | null
    utilityType?: string | null
    nodes?: FeatureCollection | null
    edges?: FeatureCollection | null
    servicePoints?: FeatureCollection | null
  } | null
  zoomRequest: ZoomRequest | null
  fitVisibleRequest?: FitVisibleRequest | null
  locateRequest?: LocateRequest | null
  measurementMode?: MeasurementMode
  measurementResetNonce?: number
  activeEditLayerId?: string | null
  editLayerFeatures?: FeatureCollection | null
  advancedEditMode?: AdvancedEditMode
  advancedEditOptions?: AdvancedEditOptions
  editCommand?: EditCommand | null
  activeShapeType?: ShapeType | null
  shapeSize?: number
  selectedFeaturesByLayer?: Record<string, string[]>
  featureZoomRequest?: FeatureZoomRequest | null
  flashFeatureRequest?: FlashFeatureRequest | null
  onFeatureCreated?: (layerId: string, geometry: Geometry, properties?: Record<string, unknown>) => void
  onFeatureUpdated?: (
    layerId: string,
    featureId: string,
    geometry: Geometry,
    properties?: Record<string, unknown>,
    version?: number,
  ) => void
  onFeatureDeleted?: (layerId: string, featureId: string) => void
  onEditValidationError?: (message: string) => void
  onEditInfo?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error') => void
  onEditStateChange?: (state: EditState) => void
  onEditUiStateChange?: (state: EditUiState) => void
  onMeasurementChange?: (summary: MeasurementSummary | null) => void
  onViewStateChange?: (view: MapViewportState) => void
}

const palette = ['#136f63', '#3f88c5', '#ff9f1c', '#a4243b', '#0f4c5c', '#8e44ad', '#6ab04c']

function resolveUtilityOverlayTheme(utilityType?: string | null) {
  switch (utilityType) {
    case 'electric':
      return {
        edge: [247, 181, 0, 255] as RgbaColor,
        node: [28, 100, 242, 255] as RgbaColor,
        servicePoint: [245, 101, 101, 255] as RgbaColor,
        label: [33, 37, 41, 255] as RgbaColor,
      }
    case 'water':
    case 'wastewater':
    case 'stormwater':
      return {
        edge: [8, 126, 164, 255] as RgbaColor,
        node: [14, 116, 144, 255] as RgbaColor,
        servicePoint: [99, 179, 237, 255] as RgbaColor,
        label: [15, 23, 42, 255] as RgbaColor,
      }
    case 'gas':
      return {
        edge: [234, 88, 12, 255] as RgbaColor,
        node: [180, 83, 9, 255] as RgbaColor,
        servicePoint: [251, 191, 36, 255] as RgbaColor,
        label: [67, 20, 7, 255] as RgbaColor,
      }
    case 'telecom':
    case 'district_energy':
      return {
        edge: [109, 40, 217, 255] as RgbaColor,
        node: [147, 51, 234, 255] as RgbaColor,
        servicePoint: [244, 114, 182, 255] as RgbaColor,
        label: [49, 46, 129, 255] as RgbaColor,
      }
    default:
      return {
        edge: [22, 101, 52, 255] as RgbaColor,
        node: [21, 128, 61, 255] as RgbaColor,
        servicePoint: [217, 119, 6, 255] as RgbaColor,
        label: [17, 24, 39, 255] as RgbaColor,
      }
  }
}

function utilityFeatureLabel(feature: GeoJsonFeature): string | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>
  const raw = properties.name ?? properties.asset_id ?? feature.id
  if (raw == null) {
    return null
  }
  const label = String(raw).trim()
  return label || null
}

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
  polygonPatternLibrary: PolygonPatternLibrary
  polygonPattern: string
  polygonPatternScale: number
  polygonPatternColor: RgbaColor
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

function withUnitAlpha(rgb: RgbColor, opacity: number): RgbaColor {
  const alpha = Math.max(0, Math.min(1, opacity))
  return [rgb[0], rgb[1], rgb[2], Math.round(alpha * 255)]
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

function isLineGeometryType(type: Geometry['type']): boolean {
  return type === 'LineString' || type === 'MultiLineString'
}

function isPolygonGeometryType(type: Geometry['type']): boolean {
  return type === 'Polygon' || type === 'MultiPolygon'
}

function geometryFamilyFromGeometry(type: Geometry['type']): GeometryFamily | null {
  if (isPointGeometryType(type)) {
    return 'point'
  }
  if (isLineGeometryType(type)) {
    return 'line'
  }
  if (isPolygonGeometryType(type)) {
    return 'polygon'
  }
  return null
}

function geometryMatchesLayerFamily(type: Geometry['type'], family: GeometryFamily): boolean {
  if (family === 'mixed') {
    return true
  }
  return geometryFamilyFromGeometry(type) === family
}

function geometryFamilyLabel(family: GeometryFamily): string {
  if (family === 'point') {
    return 'point'
  }
  if (family === 'line') {
    return 'line'
  }
  if (family === 'polygon') {
    return 'polygon'
  }
  return 'mixed'
}

// Shape geometry generators
type ShapeType = 'circle' | 'rectangle' | 'square' | 'triangle' | 'pentagon' | 'hexagon' | 'star'

/**
 * Generate polygon coordinates for a circle
 * @param center - [lng, lat]
 * @param radiusMeters - radius in meters
 * @param numPoints - number of points to approximate the circle
 */
function generateCirclePolygon(center: [number, number], radiusMeters: number, numPoints: number = 64): number[][] {
  const [lng, lat] = center
  const coords: number[][] = []

  // Convert radius from meters to degrees (approximate)
  const kmPerDegree = 111.32 // at equator
  const radiusDegrees = radiusMeters / (kmPerDegree * 1000)

  // Account for latitude distortion
  const latRadians = (lat * Math.PI) / 180
  const lngRadius = radiusDegrees / Math.cos(latRadians)
  const latRadius = radiusDegrees

  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI
    const pointLng = lng + lngRadius * Math.cos(angle)
    const pointLat = lat + latRadius * Math.sin(angle)
    coords.push([pointLng, pointLat])
  }

  return coords
}

/**
 * Generate polygon coordinates for a rectangle
 * @param center - [lng, lat]
 * @param widthMeters - width in meters
 * @param heightMeters - height in meters
 * @param rotationDegrees - rotation angle in degrees (0 = north-aligned)
 */
function generateRectanglePolygon(
  center: [number, number],
  widthMeters: number,
  heightMeters: number,
  rotationDegrees: number = 0
): number[][] {
  const [lng, lat] = center
  const kmPerDegree = 111.32
  const latRadians = (lat * Math.PI) / 180

  const halfWidth = widthMeters / (kmPerDegree * 1000 * 2)
  const halfHeight = heightMeters / (kmPerDegree * 1000 * 2)

  const lngHalfWidth = halfWidth / Math.cos(latRadians)
  const latHalfHeight = halfHeight

  // Define corners (before rotation)
  const corners = [
    [-lngHalfWidth, -latHalfHeight],
    [lngHalfWidth, -latHalfHeight],
    [lngHalfWidth, latHalfHeight],
    [-lngHalfWidth, latHalfHeight],
  ]

  // Apply rotation
  const rotationRadians = (rotationDegrees * Math.PI) / 180
  const rotatedCorners = corners.map(([dx, dy]) => {
    const rotatedX = dx * Math.cos(rotationRadians) - dy * Math.sin(rotationRadians)
    const rotatedY = dx * Math.sin(rotationRadians) + dy * Math.cos(rotationRadians)
    return [lng + rotatedX, lat + rotatedY]
  })

  // Close the polygon
  rotatedCorners.push(rotatedCorners[0])

  return rotatedCorners
}

/**
 * Generate polygon coordinates for a regular polygon (triangle, pentagon, hexagon, etc.)
 * @param center - [lng, lat]
 * @param radiusMeters - distance from center to vertices
 * @param numSides - number of sides (3 = triangle, 5 = pentagon, 6 = hexagon, etc.)
 * @param rotationDegrees - rotation angle in degrees
 */
function generateRegularPolygon(
  center: [number, number],
  radiusMeters: number,
  numSides: number,
  rotationDegrees: number = 0
): number[][] {
  const [lng, lat] = center
  const coords: number[][] = []

  const kmPerDegree = 111.32
  const radiusDegrees = radiusMeters / (kmPerDegree * 1000)

  const latRadians = (lat * Math.PI) / 180
  const lngRadius = radiusDegrees / Math.cos(latRadians)
  const latRadius = radiusDegrees

  const rotationRadians = (rotationDegrees * Math.PI) / 180

  for (let i = 0; i <= numSides; i++) {
    const angle = (i / numSides) * 2 * Math.PI + rotationRadians - Math.PI / 2
    const pointLng = lng + lngRadius * Math.cos(angle)
    const pointLat = lat + latRadius * Math.sin(angle)
    coords.push([pointLng, pointLat])
  }

  return coords
}

/**
 * Generate polygon coordinates for a star
 * @param center - [lng, lat]
 * @param outerRadiusMeters - distance from center to outer vertices
 * @param innerRadiusMeters - distance from center to inner vertices
 * @param numPoints - number of star points (5 = pentagram, 6 = hexagram, etc.)
 * @param rotationDegrees - rotation angle in degrees
 */
function generateStarPolygon(
  center: [number, number],
  outerRadiusMeters: number,
  innerRadiusMeters: number,
  numPoints: number = 5,
  rotationDegrees: number = 0
): number[][] {
  const [lng, lat] = center
  const coords: number[][] = []

  const kmPerDegree = 111.32
  const outerRadiusDegrees = outerRadiusMeters / (kmPerDegree * 1000)
  const innerRadiusDegrees = innerRadiusMeters / (kmPerDegree * 1000)

  const latRadians = (lat * Math.PI) / 180
  const outerLngRadius = outerRadiusDegrees / Math.cos(latRadians)
  const outerLatRadius = outerRadiusDegrees
  const innerLngRadius = innerRadiusDegrees / Math.cos(latRadians)
  const innerLatRadius = innerRadiusDegrees

  const rotationRadians = (rotationDegrees * Math.PI) / 180

  for (let i = 0; i <= numPoints * 2; i++) {
    const isOuter = i % 2 === 0
    const lngRadius = isOuter ? outerLngRadius : innerLngRadius
    const latRadius = isOuter ? outerLatRadius : innerLatRadius

    const angle = (i / (numPoints * 2)) * 2 * Math.PI + rotationRadians - Math.PI / 2
    const pointLng = lng + lngRadius * Math.cos(angle)
    const pointLat = lat + latRadius * Math.sin(angle)
    coords.push([pointLng, pointLat])
  }

  return coords
}

function drawControlsForGeometryFamily(family: GeometryFamily): {
  point: boolean
  line_string: boolean
  polygon: boolean
  trash: boolean
} {
  if (family === 'point') {
    return { point: true, line_string: false, polygon: false, trash: true }
  }
  if (family === 'line') {
    // Enable line_string for line editing and split mode
    return { point: false, line_string: true, polygon: false, trash: true }
  }
  if (family === 'polygon') {
    // Enable line_string for split mode (drawing split lines across polygons)
    return { point: false, line_string: true, polygon: true, trash: true }
  }
  // Mixed geometry - enable all controls
  return { point: true, line_string: true, polygon: true, trash: true }
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
  const polygonPatternLibrary = normalizePolygonPatternLibrary(style.polygonPatternLibrary)
  const polygonPattern = resolvePolygonPatternName(
    polygonPatternLibrary,
    typeof style.polygonPattern === 'string'
      ? style.polygonPattern
      : normalizePolygonPattern(style.polygonPattern),
  )
  const polygonPatternScale = Math.max(0.25, Math.min(6, asNumber(style.polygonPatternScale, 1)))
  const polygonPatternColorHex = asHexColor(style.polygonPatternColor, strokeColorHex)
  const polygonPatternOpacity = Math.max(0, Math.min(1, asNumber(style.polygonPatternOpacity, 0.65)))
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
  const polygonPatternRgb = hexToRgb(polygonPatternColorHex)

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
    polygonPatternLibrary,
    polygonPattern,
    polygonPatternScale,
    polygonPatternColor: withUnitAlpha(polygonPatternRgb, polygonPatternOpacity),
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

const DEFAULT_ADVANCED_EDIT_OPTIONS: AdvancedEditOptions = {
  rotateDegrees: 15,
  scaleFactor: 1,
  reshapeStrength: 0.45,
  gridSizeMeters: 2,
  alignTarget: 'center-x',
}

const TEMP_FEATURE_ID_PREFIX = 'tmp-edit-'
const ROTATE_HANDLE_OFFSET_PX = 34
const ROTATE_HANDLE_HIT_RADIUS_PX = 14
const ROTATE_HANDLE_MIN_RADIUS_PX = 12
const ROTATE_SCALE_MIN_FACTOR = 0.05
const ROTATE_SCALE_MAX_FACTOR = 20
const MAX_GUIDE_VERTICES = 2000

interface ModeColors {
  primary: [number, number, number]
  accent: [number, number, number]
  label: string
  icon: typeof EditIcon
  cursorType: string
}

function getModeColors(mode: AdvancedEditMode): ModeColors {
  switch (mode) {
    case 'split':
      return {
        primary: [255, 165, 0],
        accent: [255, 140, 0],
        label: 'Split',
        icon: CallSplitIcon,
        cursorType: 'crosshair',
      }
    case 'reshape':
      return {
        primary: [34, 197, 94],
        accent: [22, 163, 74],
        label: 'Reshape',
        icon: AutoFixHighIcon,
        cursorType: 'cell',
      }
    case 'rotate-scale':
      return {
        primary: [245, 158, 11],
        accent: [217, 119, 6],
        label: 'Rotate & Scale',
        icon: EditIcon,
        cursorType: 'move',
      }
    case 'trace':
      return {
        primary: [139, 92, 246],
        accent: [124, 58, 237],
        label: 'Trace',
        icon: EditIcon,
        cursorType: 'alias',
      }
    case 'align':
      return {
        primary: [59, 130, 246],
        accent: [37, 99, 235],
        label: 'Align',
        icon: EditIcon,
        cursorType: 'all-scroll',
      }
    case 'rectangular-constraints':
      return {
        primary: [168, 85, 247],
        accent: [147, 51, 234],
        label: 'Rectangle',
        icon: EditIcon,
        cursorType: 'nesw-resize',
      }
    case 'grid-lock':
      return {
        primary: [20, 184, 166],
        accent: [13, 148, 136],
        label: 'Grid Lock',
        icon: EditIcon,
        cursorType: 'crosshair',
      }
  }
}

function cloneGeometry(geometry: Geometry): Geometry {
  return JSON.parse(JSON.stringify(geometry)) as Geometry
}

function cloneProperties(properties: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!properties) {
    return undefined
  }
  return JSON.parse(JSON.stringify(properties)) as Record<string, unknown>
}

function cloneFeatureCollection(collection: GeoJsonFeatureCollection): GeoJsonFeatureCollection {
  return JSON.parse(JSON.stringify(collection)) as GeoJsonFeatureCollection
}

type Position = [number, number]

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

function toPositionArray(value: unknown): Position[] {
  if (!Array.isArray(value)) {
    return []
  }

  const result: Position[] = []
  for (const token of value) {
    if (isPosition(token)) {
      result.push([token[0], token[1]])
    }
  }
  return result
}

function mapNestedCoordinates(value: unknown, mapper: (position: Position) => Position): unknown {
  if (isPosition(value)) {
    return mapper([value[0], value[1]])
  }

  if (!Array.isArray(value)) {
    return value
  }

  return value.map((token) => mapNestedCoordinates(token, mapper))
}

function transformGeometry(geometry: Geometry, mapper: (position: Position) => Position): Geometry {
  if (geometry.type === 'GeometryCollection') {
    return {
      ...geometry,
      geometries: geometry.geometries.map((nested) => transformGeometry(nested, mapper)),
    }
  }

  return {
    ...geometry,
    coordinates: mapNestedCoordinates(geometry.coordinates, mapper) as never,
  } as Geometry
}

interface GeometryBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function extendBBoxFromCoordinates(value: unknown, bbox: GeometryBBox): void {
  if (isPosition(value)) {
    bbox.minX = Math.min(bbox.minX, value[0])
    bbox.maxX = Math.max(bbox.maxX, value[0])
    bbox.minY = Math.min(bbox.minY, value[1])
    bbox.maxY = Math.max(bbox.maxY, value[1])
    return
  }

  if (!Array.isArray(value)) {
    return
  }

  for (const nested of value) {
    extendBBoxFromCoordinates(nested, bbox)
  }
}

function bboxFromGeometry(geometry: Geometry): GeometryBBox | null {
  const bbox: GeometryBBox = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  }

  if (geometry.type === 'GeometryCollection') {
    for (const nested of geometry.geometries) {
      const nestedBBox = bboxFromGeometry(nested)
      if (!nestedBBox) {
        continue
      }
      bbox.minX = Math.min(bbox.minX, nestedBBox.minX)
      bbox.maxX = Math.max(bbox.maxX, nestedBBox.maxX)
      bbox.minY = Math.min(bbox.minY, nestedBBox.minY)
      bbox.maxY = Math.max(bbox.maxY, nestedBBox.maxY)
    }
  } else {
    extendBBoxFromCoordinates(geometry.coordinates, bbox)
  }

  if (!Number.isFinite(bbox.minX) || !Number.isFinite(bbox.minY) || !Number.isFinite(bbox.maxX) || !Number.isFinite(bbox.maxY)) {
    return null
  }

  return bbox
}

function bboxFromSelectedFeatures(collection: GeoJsonFeatureCollection, selectedIds: Set<string>): GeometryBBox | null {
  if (!selectedIds.size) {
    return null
  }

  let combined: GeometryBBox | null = null
  for (const feature of collection.features) {
    const featureId = normalizeFeatureId(feature)
    if (!featureId || !selectedIds.has(featureId)) {
      continue
    }
    const featureBBox = bboxFromGeometry(feature.geometry)
    if (!featureBBox) {
      continue
    }
    if (!combined) {
      combined = { ...featureBBox }
      continue
    }
    combined.minX = Math.min(combined.minX, featureBBox.minX)
    combined.minY = Math.min(combined.minY, featureBBox.minY)
    combined.maxX = Math.max(combined.maxX, featureBBox.maxX)
    combined.maxY = Math.max(combined.maxY, featureBBox.maxY)
  }

  return combined
}

function geometryCenter(geometry: Geometry): Position | null {
  const bbox = bboxFromGeometry(geometry)
  if (!bbox) {
    return null
  }
  return [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2]
}

function translateGeometry(geometry: Geometry, dx: number, dy: number): Geometry {
  return transformGeometry(geometry, (position) => [position[0] + dx, position[1] + dy])
}

function rotateScaleGeometry(geometry: Geometry, angleDegrees: number, scaleFactor: number): Geometry {
  const center = geometryCenter(geometry)
  if (!center) {
    return geometry
  }

  const angle = toRadians(angleDegrees)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const scale = Number.isFinite(scaleFactor) ? Math.max(0.01, scaleFactor) : 1

  return transformGeometry(geometry, (position) => {
    const dx = position[0] - center[0]
    const dy = position[1] - center[1]
    const rx = dx * cos - dy * sin
    const ry = dx * sin + dy * cos
    return [center[0] + rx * scale, center[1] + ry * scale]
  })
}

function rectangleGeometryFromBBox(bbox: GeometryBBox): Geometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [bbox.minX, bbox.minY],
      [bbox.maxX, bbox.minY],
      [bbox.maxX, bbox.maxY],
      [bbox.minX, bbox.maxY],
      [bbox.minX, bbox.minY],
    ]],
  }
}

function constrainGeometryToRectangle(geometry: Geometry): Geometry {
  if (!isPolygonGeometryType(geometry.type)) {
    return geometry
  }
  const bbox = bboxFromGeometry(geometry)
  if (!bbox) {
    return geometry
  }
  return rectangleGeometryFromBBox(bbox)
}

function metersToDegreeSteps(meters: number, latitude: number): { lngStep: number; latStep: number } {
  const safeMeters = Math.max(0.1, meters)
  const latStep = safeMeters / 111_320
  const cosLat = Math.max(0.08, Math.abs(Math.cos(toRadians(latitude))))
  const lngStep = safeMeters / (111_320 * cosLat)
  return { lngStep, latStep }
}

function snapToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return value
  }
  return Math.round(value / step) * step
}

function snapGeometryToGrid(geometry: Geometry, meters: number, latitude: number): Geometry {
  const { lngStep, latStep } = metersToDegreeSteps(meters, latitude)
  return transformGeometry(geometry, (position) => [
    snapToStep(position[0], lngStep),
    snapToStep(position[1], latStep),
  ])
}

function collectCoordinatesFromUnknown(value: unknown, target: Position[]): void {
  if (isPosition(value)) {
    target.push([value[0], value[1]])
    return
  }
  if (!Array.isArray(value)) {
    return
  }
  for (const nested of value) {
    collectCoordinatesFromUnknown(nested, target)
  }
}

function collectGeometryVertices(geometry: Geometry): Position[] {
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap((nested) => collectGeometryVertices(nested))
  }

  const positions: Position[] = []
  collectCoordinatesFromUnknown(geometry.coordinates, positions)
  return positions
}

function collectCollectionVertices(
  collection: GeoJsonFeatureCollection,
  excludedIds: Set<string> = new Set(),
): Position[] {
  const vertices: Position[] = []
  for (const feature of collection.features) {
    const featureId = normalizeFeatureId(feature)
    if (featureId && excludedIds.has(featureId)) {
      continue
    }
    vertices.push(...collectGeometryVertices(feature.geometry))
  }
  return vertices
}

interface EditGuideCollections {
  vertices: GeoJsonFeatureCollection | null
  bounds: GeoJsonFeatureCollection | null
}

interface RotateScaleHandleGeometry {
  center: Position
  anchor: Position
  handle: Position
}

function buildEditGuideCollections(
  collection: GeoJsonFeatureCollection,
  selectedIds: Set<string>,
): EditGuideCollections {
  if (!selectedIds.size) {
    return { vertices: null, bounds: null }
  }

  const vertexFeatures: GeoJsonFeature[] = []
  const boundsFeatures: GeoJsonFeature[] = []
  let vertexCount = 0

  for (const feature of collection.features) {
    const featureId = normalizeFeatureId(feature)
    if (!featureId || !selectedIds.has(featureId)) {
      continue
    }

    const bbox = bboxFromGeometry(feature.geometry)
    if (bbox) {
      boundsFeatures.push({
        type: 'Feature',
        properties: { featureId, guide: 'bbox' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [bbox.minX, bbox.minY],
            [bbox.maxX, bbox.minY],
            [bbox.maxX, bbox.maxY],
            [bbox.minX, bbox.maxY],
            [bbox.minX, bbox.minY],
          ],
        },
      })
    }

    const vertices = collectGeometryVertices(feature.geometry)
    // Adaptive sampling if too many vertices
    if (vertexCount + vertices.length > MAX_GUIDE_VERTICES && vertexCount < MAX_GUIDE_VERTICES) {
      // Calculate sampling rate for remaining vertices
      const remaining = MAX_GUIDE_VERTICES - vertexCount
      const step = Math.max(1, Math.floor(vertices.length / remaining))
      for (let i = 0; i < vertices.length && vertexCount < MAX_GUIDE_VERTICES; i += step) {
        vertexFeatures.push({
          type: 'Feature',
          properties: { featureId, guide: 'vertex', sampled: true },
          geometry: { type: 'Point', coordinates: [vertices[i][0], vertices[i][1]] },
        })
        vertexCount += 1
      }
    } else {
      // Add all vertices if under limit
      for (const vertex of vertices) {
        if (vertexCount >= MAX_GUIDE_VERTICES) {
          break
        }
        vertexFeatures.push({
          type: 'Feature',
          properties: { featureId, guide: 'vertex' },
          geometry: { type: 'Point', coordinates: [vertex[0], vertex[1]] },
        })
        vertexCount += 1
      }
    }
  }

  return {
    vertices: vertexFeatures.length
      ? {
        type: 'FeatureCollection',
        features: vertexFeatures,
      }
      : null,
    bounds: boundsFeatures.length
      ? {
        type: 'FeatureCollection',
        features: boundsFeatures,
      }
      : null,
  }
}

function buildRotateScaleHandleGeometry(
  map: maplibregl.Map,
  collection: GeoJsonFeatureCollection,
  selectedIds: Set<string>,
): RotateScaleHandleGeometry | null {
  const bbox = bboxFromSelectedFeatures(collection, selectedIds)
  if (!bbox) {
    return null
  }

  const center: Position = [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2]
  const anchor: Position = [center[0], bbox.maxY]
  const centerPoint = map.project([center[0], center[1]])
  const anchorPoint = map.project([anchor[0], anchor[1]])

  let handleY = anchorPoint.y - ROTATE_HANDLE_OFFSET_PX
  if (Math.abs(handleY - centerPoint.y) < ROTATE_HANDLE_MIN_RADIUS_PX) {
    handleY = centerPoint.y - ROTATE_HANDLE_MIN_RADIUS_PX
  }

  const handleLngLat = map.unproject([anchorPoint.x, handleY])
  const handle: Position = [handleLngLat.lng, handleLngLat.lat]
  return { center, anchor, handle }
}

function buildRotateScaleGuideCollection(handleGeometry: RotateScaleHandleGeometry): GeoJsonFeatureCollection {
  const { center, anchor, handle } = handleGeometry
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { guide: 'rotate-scale', role: 'connector' },
        geometry: { type: 'LineString', coordinates: [anchor, handle] },
      },
      {
        type: 'Feature',
        properties: { guide: 'rotate-scale', role: 'center' },
        geometry: { type: 'Point', coordinates: center },
      },
      {
        type: 'Feature',
        properties: { guide: 'rotate-scale', role: 'handle' },
        geometry: { type: 'Point', coordinates: handle },
      },
    ],
  }
}

interface RotateScaleDragSession {
  startCollection: GeoJsonFeatureCollection
  selectedIds: Set<string>
  center: Position
  startAngle: number
  startRadius: number
}

function metersToPixelsAtLatitude(meters: number, latitude: number, zoom: number): number {
  const safeMeters = Math.max(0.1, meters)
  const safeZoom = Number.isFinite(zoom) ? zoom : 0
  const cosLat = Math.max(0.08, Math.abs(Math.cos(toRadians(latitude))))
  const metersPerPixel = (156543.03392 * cosLat) / (2 ** safeZoom)
  return Math.max(1, safeMeters / Math.max(0.000001, metersPerPixel))
}

function findNearestVertex(
  map: maplibregl.Map,
  point: Position,
  vertices: Position[],
  tolerancePixels: number,
): Position | null {
  if (!vertices.length || !Number.isFinite(tolerancePixels) || tolerancePixels <= 0) {
    return null
  }

  const projectedPoint = map.project([point[0], point[1]])
  const toleranceSquared = tolerancePixels * tolerancePixels
  let nearest: Position | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const candidate of vertices) {
    const projectedCandidate = map.project([candidate[0], candidate[1]])
    const dx = projectedPoint.x - projectedCandidate.x
    const dy = projectedPoint.y - projectedCandidate.y
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared > toleranceSquared || distanceSquared >= nearestDistance) {
      continue
    }
    nearestDistance = distanceSquared
    nearest = candidate
  }

  return nearest
}

function snapGeometryToVertices(
  geometry: Geometry,
  map: maplibregl.Map,
  vertices: Position[],
  tolerancePixels: number,
): Geometry {
  if (!vertices.length || tolerancePixels <= 0) {
    return geometry
  }

  return transformGeometry(geometry, (position) => {
    const nearest = findNearestVertex(map, position, vertices, tolerancePixels)
    if (!nearest) {
      return position
    }
    return [nearest[0], nearest[1]]
  })
}

interface LayerSnapSettings {
  enabled: boolean
  toleranceMeters: number
}

function readLayerSnapSettings(layer: Layer | null | undefined): LayerSnapSettings {
  const style = layer?.style as Record<string, unknown> | undefined
  const enabled = Boolean(style?.snap_enabled ?? style?.snapEnabled)
  const toleranceRaw =
    typeof style?.snap_tolerance_m === 'number'
      ? style.snap_tolerance_m
      : typeof style?.snapToleranceMeters === 'number'
        ? style.snapToleranceMeters
        : 8

  const toleranceMeters = Number.isFinite(toleranceRaw) ? Math.max(1, Math.min(1000, toleranceRaw)) : 8
  return { enabled, toleranceMeters }
}

function maybeConstrainLineToRectilinear(geometry: Geometry): Geometry {
  if (geometry.type === 'LineString') {
    const coords = toPositionArray(geometry.coordinates)
    if (coords.length < 2) {
      return geometry
    }
    const start = coords[0]
    const end = coords[coords.length - 1]
    const dx = Math.abs(end[0] - start[0])
    const dy = Math.abs(end[1] - start[1])
    const constrainedEnd: Position = dx >= dy ? [end[0], start[1]] : [start[0], end[1]]
    return {
      type: 'LineString',
      coordinates: [start, constrainedEnd],
    }
  }

  if (geometry.type === 'MultiLineString') {
    const lines = Array.isArray(geometry.coordinates) ? geometry.coordinates.map((line) => toPositionArray(line)) : []
    const constrained = lines
      .map((line) => {
        if (line.length < 2) {
          return null
        }
        const start = line[0]
        const end = line[line.length - 1]
        const dx = Math.abs(end[0] - start[0])
        const dy = Math.abs(end[1] - start[1])
        const constrainedEnd: Position = dx >= dy ? [end[0], start[1]] : [start[0], end[1]]
        return [start, constrainedEnd]
      })
      .filter((line): line is Position[] => Boolean(line))

    if (!constrained.length) {
      return geometry
    }

    return {
      type: 'MultiLineString',
      coordinates: constrained,
    }
  }

  return geometry
}

function dedupeConsecutive(points: Position[]): Position[] {
  if (!points.length) {
    return []
  }

  const deduped: Position[] = [points[0]]
  for (let index = 1; index < points.length; index += 1) {
    const previous = deduped[deduped.length - 1]
    const current = points[index]
    if (Math.abs(previous[0] - current[0]) < 1e-12 && Math.abs(previous[1] - current[1]) < 1e-12) {
      continue
    }
    deduped.push(current)
  }
  return deduped
}

function closeRing(points: Position[]): Position[] {
  if (!points.length) {
    return []
  }

  const cleaned = dedupeConsecutive(points)
  if (!cleaned.length) {
    return []
  }

  const first = cleaned[0]
  const last = cleaned[cleaned.length - 1]
  if (Math.abs(first[0] - last[0]) > 1e-12 || Math.abs(first[1] - last[1]) > 1e-12) {
    cleaned.push([first[0], first[1]])
  }
  return cleaned
}

function chaikinLine(points: Position[], passes: number): Position[] {
  let line = points
  for (let pass = 0; pass < passes; pass += 1) {
    if (line.length < 2) {
      break
    }
    const next: Position[] = [line[0]]
    for (let index = 0; index < line.length - 1; index += 1) {
      const current = line[index]
      const following = line[index + 1]
      next.push([0.75 * current[0] + 0.25 * following[0], 0.75 * current[1] + 0.25 * following[1]])
      next.push([0.25 * current[0] + 0.75 * following[0], 0.25 * current[1] + 0.75 * following[1]])
    }
    next.push(line[line.length - 1])
    line = dedupeConsecutive(next)
  }
  return line
}

function chaikinRing(points: Position[], passes: number): Position[] {
  let ring = points
  for (let pass = 0; pass < passes; pass += 1) {
    if (ring.length < 3) {
      break
    }
    const next: Position[] = []
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index]
      const following = ring[(index + 1) % ring.length]
      next.push([0.75 * current[0] + 0.25 * following[0], 0.75 * current[1] + 0.25 * following[1]])
      next.push([0.25 * current[0] + 0.75 * following[0], 0.25 * current[1] + 0.75 * following[1]])
    }
    ring = dedupeConsecutive(next)
  }
  return closeRing(ring)
}

function reshapeGeometry(geometry: Geometry, strength: number): Geometry {
  const passes = Math.max(1, Math.min(3, Math.round(strength * 3)))

  if (geometry.type === 'LineString') {
    const line = toPositionArray(geometry.coordinates)
    if (line.length < 3) {
      return geometry
    }
    return { type: 'LineString', coordinates: chaikinLine(line, passes) }
  }

  if (geometry.type === 'MultiLineString') {
    const lines = Array.isArray(geometry.coordinates) ? geometry.coordinates.map((line) => toPositionArray(line)) : []
    return {
      type: 'MultiLineString',
      coordinates: lines.map((line) => (line.length < 3 ? line : chaikinLine(line, passes))),
    }
  }

  if (geometry.type === 'Polygon') {
    const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates.map((ring) => toPositionArray(ring)) : []
    if (!rings.length) {
      return geometry
    }
    const outer = closeRing(rings[0])
    if (outer.length < 4) {
      return geometry
    }
    return {
      type: 'Polygon',
      coordinates: [chaikinRing(outer.slice(0, -1), passes)],
    }
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = Array.isArray(geometry.coordinates)
      ? geometry.coordinates.map((polygon) => {
        const ring = toPositionArray(Array.isArray(polygon) ? polygon[0] : [])
        if (ring.length < 4) {
          return null
        }
        return [chaikinRing(closeRing(ring).slice(0, -1), passes)]
      })
      : []

    const cleaned = polygons.filter((polygon): polygon is Position[][] => Boolean(polygon))
    if (!cleaned.length) {
      return geometry
    }
    return {
      type: 'MultiPolygon',
      coordinates: cleaned,
    }
  }

  return geometry
}

function verticalIntersection(a: Position, b: Position, xBoundary: number): Position {
  const dx = b[0] - a[0]
  if (Math.abs(dx) < 1e-12) {
    return [xBoundary, a[1]]
  }
  const t = (xBoundary - a[0]) / dx
  return [xBoundary, a[1] + t * (b[1] - a[1])]
}

function clipRingByVerticalBoundary(points: Position[], xBoundary: number, keepLeft: boolean): Position[] {
  if (points.length < 3) {
    return []
  }

  const ring = closeRing(points)
  const openRing = ring.length > 1 ? ring.slice(0, -1) : ring
  if (openRing.length < 3) {
    return []
  }

  const inside = (point: Position) => (keepLeft ? point[0] <= xBoundary : point[0] >= xBoundary)
  const output: Position[] = []

  for (let index = 0; index < openRing.length; index += 1) {
    const current = openRing[index]
    const previous = openRing[(index - 1 + openRing.length) % openRing.length]
    const currentInside = inside(current)
    const previousInside = inside(previous)

    if (currentInside) {
      if (!previousInside) {
        output.push(verticalIntersection(previous, current, xBoundary))
      }
      output.push(current)
    } else if (previousInside) {
      output.push(verticalIntersection(previous, current, xBoundary))
    }
  }

  const closed = closeRing(output)
  return closed.length >= 4 ? closed : []
}

function ringArea(points: Position[]): number {
  if (points.length < 4) {
    return 0
  }
  let area = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area / 2)
}

function largestPolygonRing(geometry: Geometry): Position[] | null {
  if (geometry.type === 'Polygon') {
    const ring = closeRing(toPositionArray(geometry.coordinates[0] ?? []))
    return ring.length >= 4 ? ring : null
  }

  if (geometry.type !== 'MultiPolygon') {
    return null
  }

  let best: Position[] | null = null
  let bestArea = 0
  for (const polygon of geometry.coordinates) {
    const ring = closeRing(toPositionArray(polygon[0] ?? []))
    if (ring.length < 4) {
      continue
    }
    const area = ringArea(ring)
    if (area > bestArea) {
      bestArea = area
      best = ring
    }
  }
  return best
}

function splitLineGeometry(geometry: Geometry): Geometry[] | null {
  const splitCoords = (coords: Position[]): Geometry[] | null => {
    if (coords.length < 3) {
      return null
    }
    const splitIndex = Math.max(1, Math.min(coords.length - 2, Math.floor(coords.length / 2)))
    const first = coords.slice(0, splitIndex + 1)
    const second = coords.slice(splitIndex)
    if (first.length < 2 || second.length < 2) {
      return null
    }
    return [
      { type: 'LineString', coordinates: first },
      { type: 'LineString', coordinates: second },
    ]
  }

  if (geometry.type === 'LineString') {
    return splitCoords(toPositionArray(geometry.coordinates))
  }

  if (geometry.type !== 'MultiLineString') {
    return null
  }

  const candidates = geometry.coordinates
    .map((line) => toPositionArray(line))
    .filter((line) => line.length >= 3)
    .sort((a, b) => b.length - a.length)

  if (!candidates.length) {
    return null
  }

  return splitCoords(candidates[0])
}

function splitPolygonGeometry(geometry: Geometry): Geometry[] | null {
  const ring = largestPolygonRing(geometry)
  if (!ring) {
    return null
  }

  const bbox = bboxFromGeometry(geometry)
  if (!bbox) {
    return null
  }

  const splitX = (bbox.minX + bbox.maxX) / 2
  const leftRing = clipRingByVerticalBoundary(ring, splitX, true)
  const rightRing = clipRingByVerticalBoundary(ring, splitX, false)
  if (leftRing.length < 4 || rightRing.length < 4) {
    return null
  }

  return [
    { type: 'Polygon', coordinates: [leftRing] },
    { type: 'Polygon', coordinates: [rightRing] },
  ]
}

function splitGeometryByFamily(geometry: Geometry): Geometry[] | null {
  if (isLineGeometryType(geometry.type)) {
    return splitLineGeometry(geometry)
  }
  if (isPolygonGeometryType(geometry.type)) {
    return splitPolygonGeometry(geometry)
  }
  return null
}

/**
 * Split geometry using a drawn line
 * TODO: Implement proper line-based splitting using turf.js lineSplit/polygonCut
 * For now, this is a placeholder that validates the split line exists
 * and falls back to midpoint splitting with user notification
 */
function splitGeometryByLine(geometry: Geometry, splitLine: Geometry): Geometry[] | null {
  // Validate we have a line to split with
  if (!isLineGeometryType(splitLine.type)) {
    console.warn('[Split] Invalid split line geometry type:', splitLine.type)
    return splitGeometryByFamily(geometry)
  }

  // Extract line coordinates
  const lineCoords = splitLine.type === 'LineString'
    ? toPositionArray(splitLine.coordinates)
    : splitLine.type === 'MultiLineString' && Array.isArray(splitLine.coordinates) && splitLine.coordinates.length > 0
    ? toPositionArray(splitLine.coordinates[0])
    : []

  if (lineCoords.length < 2) {
    console.warn('[Split] Split line has insufficient points:', lineCoords.length)
    return splitGeometryByFamily(geometry)
  }

  console.info(`[Split] Attempting to split ${geometry.type} with line of ${lineCoords.length} points`)

  // TODO: Implement actual geometric split using the line
  // For proper implementation, we need to:
  // 1. Find intersection points between split line and feature geometry
  // 2. Cut the geometry at those intersection points
  // 3. Group the resulting segments into separate geometries
  //
  // Libraries that can do this:
  // - @turf/line-split (for LineStrings)
  // - @turf/polygon-split or custom polygon cutting algorithm (for Polygons)
  // -  martinez-polygon-clipping (for complex polygon operations)
  //
  // For now, fall back to midpoint splitting
  console.warn('[Split] Line-based splitting not yet implemented - using fallback midpoint split')
  console.warn('[Split] To fix: Install @turf/turf and implement geometric intersection logic')

  return splitGeometryByFamily(geometry)
}

function alignFeatureGeometries(
  features: Array<{ id: string; geometry: Geometry }>,
  alignTarget: AlignTarget,
): Map<string, Geometry> {
  const bboxes = features
    .map((feature) => {
      const bbox = bboxFromGeometry(feature.geometry)
      if (!bbox) {
        return null
      }
      return { id: feature.id, geometry: feature.geometry, bbox }
    })
    .filter((feature): feature is { id: string; geometry: Geometry; bbox: GeometryBBox } => Boolean(feature))

  if (bboxes.length < 2) {
    return new Map()
  }

  const minX = Math.min(...bboxes.map((token) => token.bbox.minX))
  const maxX = Math.max(...bboxes.map((token) => token.bbox.maxX))
  const minY = Math.min(...bboxes.map((token) => token.bbox.minY))
  const maxY = Math.max(...bboxes.map((token) => token.bbox.maxY))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  const updates = new Map<string, Geometry>()
  for (const feature of bboxes) {
    const currentCenterX = (feature.bbox.minX + feature.bbox.maxX) / 2
    const currentCenterY = (feature.bbox.minY + feature.bbox.maxY) / 2
    let dx = 0
    let dy = 0

    if (alignTarget === 'left') {
      dx = minX - feature.bbox.minX
    } else if (alignTarget === 'right') {
      dx = maxX - feature.bbox.maxX
    } else if (alignTarget === 'top') {
      dy = maxY - feature.bbox.maxY
    } else if (alignTarget === 'bottom') {
      dy = minY - feature.bbox.minY
    } else if (alignTarget === 'center-x') {
      dx = centerX - currentCenterX
    } else if (alignTarget === 'center-y') {
      dy = centerY - currentCenterY
    }

    if (Math.abs(dx) > 1e-12 || Math.abs(dy) > 1e-12) {
      updates.set(feature.id, translateGeometry(feature.geometry, dx, dy))
    }
  }

  return updates
}

function geometryOrPropertiesChanged(
  a: GeoJsonFeature,
  b: GeoJsonFeature,
): boolean {
  return JSON.stringify(a.geometry) !== JSON.stringify(b.geometry) || JSON.stringify(a.properties ?? {}) !== JSON.stringify(b.properties ?? {})
}

function normalizeFeatureId(feature: GeoJsonFeature): string | null {
  if (feature.id === undefined || feature.id === null) {
    return null
  }
  return String(feature.id)
}

function featureVersionFromProperties(properties: Record<string, unknown> | undefined): number | undefined {
  const value = properties?._version
  return typeof value === 'number' ? value : undefined
}

function isTempFeatureId(featureId: string): boolean {
  return featureId.startsWith(TEMP_FEATURE_ID_PREFIX)
}

export function MapCanvas({
  layers,
  visibleByLayerId,
  featureCollections,
  legendFilters = {},
  analysisOverlay = null,
  utilityOverlay = null,
  zoomRequest,
  fitVisibleRequest,
  locateRequest,
  measurementMode = null,
  measurementResetNonce = 0,
  activeEditLayerId = null,
  editLayerFeatures = null,
  advancedEditMode = 'reshape',
  advancedEditOptions = DEFAULT_ADVANCED_EDIT_OPTIONS,
  editCommand = null,
  activeShapeType = null,
  shapeSize = 100,
  selectedFeaturesByLayer = {},
  featureZoomRequest = null,
  flashFeatureRequest = null,
  onFeatureCreated,
  onFeatureUpdated,
  onFeatureDeleted,
  onEditValidationError,
  onEditInfo,
  onEditStateChange,
  onEditUiStateChange,
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
  const [cursor, setCursor] = useState('default')
  const [drawMode, setDrawMode] = useState('simple_select')
  const [snapTemporarilyDisabled, setSnapTemporarilyDisabled] = useState(false)
  const [snapCandidate, setSnapCandidate] = useState<Position | null>(null)
  const [selectedVertexGuides, setSelectedVertexGuides] = useState<GeoJsonFeatureCollection | null>(null)
  const [selectedBoundsGuides, setSelectedBoundsGuides] = useState<GeoJsonFeatureCollection | null>(null)
  const [rotateScaleGuides, setRotateScaleGuides] = useState<GeoJsonFeatureCollection | null>(null)
  const [measurementVertices, setMeasurementVertices] = useState<Array<[number, number]>>([])
  const [reshapeStrength, setReshapeStrength] = useState(0.45)
  const [showReshapePreview, setShowReshapePreview] = useState(false)
  const [shapePreview, setShapePreview] = useState<GeoJsonFeatureCollection | null>(null)
  const [shapeDrawingSession, setShapeDrawingSession] = useState<{
    startPoint: [number, number]
    currentPoint: [number, number]
  } | null>(null)

  // Phase 1: Feature selection & highlighting
  const [flashingFeatures, setFlashingFeatures] = useState<Set<string>>(new Set())

  const activeEditGeometryFamily = useMemo<GeometryFamily>(() => {
    if (!activeEditLayerId) {
      return 'mixed'
    }
    const activeLayer = layers.find((layer) => layer.id === activeEditLayerId)
    return geometryFamilyFromType(activeLayer?.geometry_type)
  }, [layers, activeEditLayerId])
  const activeEditLayer = useMemo(
    () => (activeEditLayerId ? layers.find((layer) => layer.id === activeEditLayerId) ?? null : null),
    [layers, activeEditLayerId],
  )
  const activeSnapSettings = useMemo(() => readLayerSnapSettings(activeEditLayer), [activeEditLayer])
  const activeSnapTolerancePixels = useMemo(() => {
    if (!activeSnapSettings.enabled) {
      return 0
    }
    const map = mapRef.current
    const latitude = map?.getCenter().lat ?? 0
    return metersToPixelsAtLatitude(
      activeSnapSettings.toleranceMeters,
      latitude,
      mapZoom,
    )
  }, [activeSnapSettings.enabled, activeSnapSettings.toleranceMeters, mapZoom])

  const activeEditLayerIdRef = useRef<string | null>(activeEditLayerId)
  const activeEditGeometryFamilyRef = useRef<GeometryFamily>(activeEditGeometryFamily)
  const onFeatureCreatedRef = useRef(onFeatureCreated)
  const onFeatureUpdatedRef = useRef(onFeatureUpdated)
  const onFeatureDeletedRef = useRef(onFeatureDeleted)
  const onEditValidationErrorRef = useRef(onEditValidationError)
  const onEditInfoRef = useRef(onEditInfo)
  const onEditStateChangeRef = useRef(onEditStateChange)
  const onEditUiStateChangeRef = useRef(onEditUiStateChange)
  const measurementModeRef = useRef<MeasurementMode>(measurementMode)
  const onMeasurementChangeRef = useRef(onMeasurementChange)
  const drawControlGeometryFamilyRef = useRef<GeometryFamily | null>(null)
  const selectedEditFeatureIdsRef = useRef<string[]>([])
  const editHistoryRef = useRef<GeoJsonFeatureCollection[]>([])
  const editHistoryIndexRef = useRef(-1)
  const historyLayerIdRef = useRef<string | null>(null)
  const applyingHistoryRef = useRef(false)
  const lastEditCommandNonceRef = useRef<number | null>(null)
  const advancedEditModeRef = useRef<AdvancedEditMode>(advancedEditMode)
  const advancedEditOptionsRef = useRef<AdvancedEditOptions>(advancedEditOptions)
  const activeSnapSettingsRef = useRef<LayerSnapSettings>(activeSnapSettings)
  const snapTemporarilyDisabledRef = useRef(snapTemporarilyDisabled)
  const snapCandidateRef = useRef<Position | null>(snapCandidate)
  const desiredCursorRef = useRef('default')
  const rotateScaleHandleRef = useRef<RotateScaleHandleGeometry | null>(null)
  const rotateScaleDragSessionRef = useRef<RotateScaleDragSession | null>(null)
  const rotateScaleSelectionSignatureRef = useRef('')
  const splitTargetFeatureIdsRef = useRef<string[]>([])
  const splitLineGeometryRef = useRef<Geometry | null>(null)
  const reshapeDirectFeatureIdRef = useRef<string | null>(null)
  const activeShapeTypeRef = useRef<ShapeType | null>(activeShapeType)
  const shapeSizeRef = useRef<number>(shapeSize)
  const lastHandledZoomRequestNonceRef = useRef<number | null>(null)
  const lastHandledFitVisibleRequestNonceRef = useRef<number | null>(null)
  const lastHandledLocateRequestNonceRef = useRef<number | null>(null)
  const lastHandledFeatureZoomRequestNonceRef = useRef<number | null>(null)
  const lastHandledFlashFeatureRequestNonceRef = useRef<number | null>(null)

  useEffect(() => {
    activeEditLayerIdRef.current = activeEditLayerId
    activeEditGeometryFamilyRef.current = activeEditGeometryFamily
    onFeatureCreatedRef.current = onFeatureCreated
    onFeatureUpdatedRef.current = onFeatureUpdated
    onFeatureDeletedRef.current = onFeatureDeleted
    onEditValidationErrorRef.current = onEditValidationError
    onEditInfoRef.current = onEditInfo
    onEditStateChangeRef.current = onEditStateChange
    onEditUiStateChangeRef.current = onEditUiStateChange
    advancedEditModeRef.current = advancedEditMode
    advancedEditOptionsRef.current = advancedEditOptions
    activeSnapSettingsRef.current = activeSnapSettings
    activeShapeTypeRef.current = activeShapeType
    shapeSizeRef.current = shapeSize
    snapTemporarilyDisabledRef.current = snapTemporarilyDisabled
  }, [
    activeEditLayerId,
    activeEditGeometryFamily,
    onFeatureCreated,
    onFeatureUpdated,
    onFeatureDeleted,
    onEditValidationError,
    onEditInfo,
    onEditStateChange,
    onEditUiStateChange,
    advancedEditMode,
    advancedEditOptions,
    activeSnapSettings,
    snapTemporarilyDisabled,
    activeShapeType,
    shapeSize,
  ])

  useEffect(() => {
    snapCandidateRef.current = snapCandidate
  }, [snapCandidate])

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

  const publishEditState = () => {
    onEditStateChangeRef.current?.({
      selectedCount: selectedEditFeatureIdsRef.current.length,
      canUndo: editHistoryIndexRef.current > 0,
      canRedo:
        editHistoryIndexRef.current >= 0 &&
        editHistoryIndexRef.current < editHistoryRef.current.length - 1,
    })
  }

  const refreshSelectionGuides = (collection?: GeoJsonFeatureCollection) => {
    if (!activeEditLayerIdRef.current) {
      setSelectedVertexGuides(null)
      setSelectedBoundsGuides(null)
      setRotateScaleGuides(null)
      rotateScaleHandleRef.current = null
      return
    }

    const selectedIds = new Set(selectedEditFeatureIdsRef.current)
    if (!selectedIds.size) {
      setSelectedVertexGuides(null)
      setSelectedBoundsGuides(null)
      setRotateScaleGuides(null)
      rotateScaleHandleRef.current = null
      return
    }

    const source = collection ?? getCurrentDrawCollection()
    const guides = buildEditGuideCollections(source, selectedIds)
    setSelectedVertexGuides(guides.vertices)
    setSelectedBoundsGuides(guides.bounds)

    if (advancedEditModeRef.current !== 'rotate-scale' || !mapRef.current) {
      setRotateScaleGuides(null)
      rotateScaleHandleRef.current = null
      return
    }

    const handleGeometry = buildRotateScaleHandleGeometry(mapRef.current, source, selectedIds)
    if (!handleGeometry) {
      setRotateScaleGuides(null)
      rotateScaleHandleRef.current = null
      return
    }
    rotateScaleHandleRef.current = handleGeometry
    setRotateScaleGuides(buildRotateScaleGuideCollection(handleGeometry))
  }

  const setDrawCollection = (collection: GeoJsonFeatureCollection) => {
    if (!drawRef.current) {
      return
    }

    const drawAny = drawRef.current as MapboxDraw & {
      set?: (data: GeoJsonFeatureCollection) => void
      changeMode?: (mode: string, options?: Record<string, unknown>) => void
    }

    syncingDrawRef.current = true
    if (typeof drawAny.set === 'function') {
      drawAny.set(collection)
    } else {
      drawRef.current.deleteAll()
      if (collection.features.length) {
        drawRef.current.add(collection as unknown as GeoJsonFeature)
      }
    }
    syncingDrawRef.current = false

    const selectedIds = selectedEditFeatureIdsRef.current
    if (selectedIds.length && typeof drawAny.changeMode === 'function') {
      const modeOptions: Record<string, unknown> = { featureIds: selectedIds }
      if (advancedEditModeRef.current === 'rotate-scale') {
        modeOptions.dragMove = false
      }
      drawAny.changeMode('simple_select', modeOptions)
    }
    refreshSelectionGuides(collection)
  }

  const getCurrentDrawCollection = (): GeoJsonFeatureCollection => {
    if (!drawRef.current) {
      return { type: 'FeatureCollection', features: [] }
    }
    const raw = drawRef.current.getAll() as GeoJsonFeatureCollection
    return cloneFeatureCollection(raw)
  }

  const pushHistorySnapshot = (collection: GeoJsonFeatureCollection) => {
    const snapshot = cloneFeatureCollection(collection)
    const current = editHistoryRef.current[editHistoryIndexRef.current]
    if (current && JSON.stringify(current) === JSON.stringify(snapshot)) {
      publishEditState()
      return
    }

    const trimmed = editHistoryRef.current.slice(0, editHistoryIndexRef.current + 1)
    trimmed.push(snapshot)
    if (trimmed.length > 80) {
      trimmed.splice(0, trimmed.length - 80)
    }
    editHistoryRef.current = trimmed
    editHistoryIndexRef.current = trimmed.length - 1
    publishEditState()
  }

  const resetHistory = (collection: GeoJsonFeatureCollection) => {
    editHistoryRef.current = [cloneFeatureCollection(collection)]
    editHistoryIndexRef.current = 0
    publishEditState()
  }

  const diffAndEmitPersistence = (previous: GeoJsonFeatureCollection, next: GeoJsonFeatureCollection) => {
    const layerId = activeEditLayerIdRef.current
    if (!layerId) {
      return
    }

    const previousById = new Map<string, GeoJsonFeature>()
    const nextById = new Map<string, GeoJsonFeature>()

    for (const feature of previous.features) {
      const featureId = normalizeFeatureId(feature)
      if (!featureId) {
        continue
      }
      previousById.set(featureId, feature)
    }

    for (const feature of next.features) {
      const featureId = normalizeFeatureId(feature)
      if (!featureId) {
        continue
      }
      nextById.set(featureId, feature)
    }

    for (const [featureId, previousFeature] of previousById.entries()) {
      const nextFeature = nextById.get(featureId)
      if (!nextFeature) {
        if (!isTempFeatureId(featureId)) {
          onFeatureDeletedRef.current?.(layerId, featureId)
        }
        continue
      }
      if (geometryOrPropertiesChanged(previousFeature, nextFeature)) {
        onFeatureUpdatedRef.current?.(
          layerId,
          featureId,
          cloneGeometry(nextFeature.geometry),
          cloneProperties((nextFeature.properties ?? {}) as Record<string, unknown>),
          featureVersionFromProperties((nextFeature.properties ?? {}) as Record<string, unknown>),
        )
      }
    }

    for (const [featureId, nextFeature] of nextById.entries()) {
      if (previousById.has(featureId)) {
        continue
      }
      onFeatureCreatedRef.current?.(
        layerId,
        cloneGeometry(nextFeature.geometry),
        cloneProperties((nextFeature.properties ?? {}) as Record<string, unknown>),
      )
    }
  }

  const applyCollectionMutation = (
    mutator: (collection: GeoJsonFeatureCollection) => GeoJsonFeatureCollection | null,
    successMessage: string,
    emptySelectionMessage: string,
  ) => {
    if (!drawRef.current || !activeEditLayerIdRef.current) {
      return
    }

    const selectedIds = selectedEditFeatureIdsRef.current
    if (!selectedIds.length) {
      onEditInfoRef.current?.(emptySelectionMessage, 'warning')
      return
    }

    const before = getCurrentDrawCollection()
    const next = mutator(before)
    if (!next) {
      onEditInfoRef.current?.('No eligible features selected for this edit operation.', 'warning')
      return
    }

    if (JSON.stringify(before) === JSON.stringify(next)) {
      onEditInfoRef.current?.('No geometry changes were produced by this operation.', 'info')
      return
    }

    setDrawCollection(next)
    diffAndEmitPersistence(before, next)
    pushHistorySnapshot(next)
    onEditInfoRef.current?.(successMessage, 'success')
  }

  const applyConstraintsToGeometry = (geometry: Geometry, excludedFeatureIds: Set<string> = new Set()): Geometry => {
    let nextGeometry = cloneGeometry(geometry)
    const map = mapRef.current
    const options = advancedEditOptionsRef.current
    const mode = advancedEditModeRef.current

    if (mode === 'rectangular-constraints') {
      if (isPolygonGeometryType(nextGeometry.type)) {
        nextGeometry = constrainGeometryToRectangle(nextGeometry)
      } else if (isLineGeometryType(nextGeometry.type)) {
        nextGeometry = maybeConstrainLineToRectilinear(nextGeometry)
      }
    }

    if (mode === 'grid-lock') {
      const latitude = map?.getCenter().lat ?? 0
      nextGeometry = snapGeometryToGrid(nextGeometry, options.gridSizeMeters, latitude)
    }

    const snapSettings = activeSnapSettingsRef.current
    if (map && snapSettings.enabled && !snapTemporarilyDisabledRef.current) {
      const drawCollection = getCurrentDrawCollection()
      const snapVertices = collectCollectionVertices(drawCollection, excludedFeatureIds)
      if (snapVertices.length) {
        const latitude = map.getCenter().lat
        const tolerancePixels = metersToPixelsAtLatitude(snapSettings.toleranceMeters, latitude, map.getZoom())
        nextGeometry = snapGeometryToVertices(nextGeometry, map, snapVertices, tolerancePixels)
      }
    }

    return nextGeometry
  }

  const runModeCommand = (mode: AdvancedEditMode) => {
    const options = advancedEditOptionsRef.current
    const map = mapRef.current

    if (mode === 'split') {
      applyCollectionMutation(
        (collection) => {
          const selectedSet = new Set(selectedEditFeatureIdsRef.current)
          const nextFeatures: GeoJsonFeature[] = []
          let createdCount = 0
          let deletedCount = 0

          for (const feature of collection.features) {
            const featureId = normalizeFeatureId(feature)
            if (!featureId || !selectedSet.has(featureId)) {
              nextFeatures.push(feature)
              continue
            }

            const splitLine = splitLineGeometryRef.current
            const splitGeometries = splitLine
              ? splitGeometryByLine(feature.geometry, splitLine)
              : splitGeometryByFamily(feature.geometry)
            if (!splitGeometries || splitGeometries.length < 2) {
              nextFeatures.push(feature)
              continue
            }

            deletedCount += 1
            splitGeometries.forEach((geometry, index) => {
              createdCount += 1
              const candidateProperties = cloneProperties((feature.properties ?? {}) as Record<string, unknown>) ?? {}
              delete candidateProperties._version
              nextFeatures.push({
                type: 'Feature',
                id: `${TEMP_FEATURE_ID_PREFIX}${Date.now()}-${createdCount}-${index}`,
                properties: candidateProperties,
                geometry,
              })
            })
          }

          if (!createdCount || !deletedCount) {
            return null
          }

          selectedEditFeatureIdsRef.current = []
          return {
            type: 'FeatureCollection',
            features: nextFeatures,
          }
        },
        'Split complete.',
        'Select one or more line/polygon features to split.',
      )
      return
    }

    if (mode === 'reshape') {
      applyCollectionMutation(
        (collection) => {
          const selectedSet = new Set(selectedEditFeatureIdsRef.current)
          let changed = false
          const nextFeatures = collection.features.map((feature) => {
            const featureId = normalizeFeatureId(feature)
            if (!featureId || !selectedSet.has(featureId)) {
              return feature
            }

            if (!isLineGeometryType(feature.geometry.type) && !isPolygonGeometryType(feature.geometry.type)) {
              return feature
            }

            const geometry = reshapeGeometry(feature.geometry, options.reshapeStrength)
            if (JSON.stringify(feature.geometry) === JSON.stringify(geometry)) {
              return feature
            }
            changed = true
            return { ...feature, geometry }
          })

          if (!changed) {
            return null
          }

          return { type: 'FeatureCollection', features: nextFeatures }
        },
        'Reshape complete.',
        'Select one or more line/polygon features to reshape.',
      )
      return
    }

    if (mode === 'trace') {
      applyCollectionMutation(
        (collection) => {
          const selectedIds = selectedEditFeatureIdsRef.current
          if (selectedIds.length < 2) {
            return null
          }

          const sourceId = selectedIds[0]
          const targetId = selectedIds[selectedIds.length - 1]
          if (sourceId === targetId) {
            return null
          }

          const sourceFeature = collection.features.find((feature) => normalizeFeatureId(feature) === sourceId)
          const targetFeature = collection.features.find((feature) => normalizeFeatureId(feature) === targetId)
          if (!sourceFeature || !targetFeature) {
            return null
          }

          if (geometryFamilyFromGeometry(sourceFeature.geometry.type) !== geometryFamilyFromGeometry(targetFeature.geometry.type)) {
            onEditInfoRef.current?.('Trace requires source and reference features with matching geometry families.', 'warning')
            return null
          }

          let changed = false
          const nextFeatures = collection.features.map((feature) => {
            if (normalizeFeatureId(feature) !== sourceId) {
              return feature
            }
            changed = true
            return {
              ...feature,
              geometry: cloneGeometry(targetFeature.geometry),
            }
          })

          if (!changed) {
            return null
          }

          return { type: 'FeatureCollection', features: nextFeatures }
        },
        'Trace complete.',
        'Select at least two features (first = source, last = reference).',
      )
      return
    }

    if (mode === 'rotate-scale') {
      applyCollectionMutation(
        (collection) => {
          const selectedSet = new Set(selectedEditFeatureIdsRef.current)
          let changed = false

          const nextFeatures = collection.features.map((feature) => {
            const featureId = normalizeFeatureId(feature)
            if (!featureId || !selectedSet.has(featureId)) {
              return feature
            }

            const rotated = rotateScaleGeometry(feature.geometry, options.rotateDegrees, options.scaleFactor)
            if (JSON.stringify(feature.geometry) === JSON.stringify(rotated)) {
              return feature
            }
            changed = true
            return { ...feature, geometry: rotated }
          })

          if (!changed) {
            return null
          }

          return { type: 'FeatureCollection', features: nextFeatures }
        },
        'Rotate/Scale complete.',
        'Select one or more features to rotate/scale.',
      )
      return
    }

    if (mode === 'rectangular-constraints') {
      applyCollectionMutation(
        (collection) => {
          const selectedSet = new Set(selectedEditFeatureIdsRef.current)
          let changed = false

          const nextFeatures = collection.features.map((feature) => {
            const featureId = normalizeFeatureId(feature)
            if (!featureId || !selectedSet.has(featureId)) {
              return feature
            }
            const constrained = applyConstraintsToGeometry(feature.geometry)
            if (JSON.stringify(feature.geometry) === JSON.stringify(constrained)) {
              return feature
            }
            changed = true
            return { ...feature, geometry: constrained }
          })

          if (!changed) {
            return null
          }
          return { type: 'FeatureCollection', features: nextFeatures }
        },
        'Rectangular constraints applied.',
        'Select one or more polygon/line features to constrain.',
      )
      return
    }

    if (mode === 'grid-lock') {
      applyCollectionMutation(
        (collection) => {
          const selectedSet = new Set(selectedEditFeatureIdsRef.current)
          const latitude = map?.getCenter().lat ?? 0
          let changed = false

          const nextFeatures = collection.features.map((feature) => {
            const featureId = normalizeFeatureId(feature)
            if (!featureId || !selectedSet.has(featureId)) {
              return feature
            }

            const snapped = snapGeometryToGrid(feature.geometry, options.gridSizeMeters, latitude)
            if (JSON.stringify(feature.geometry) === JSON.stringify(snapped)) {
              return feature
            }
            changed = true
            return { ...feature, geometry: snapped }
          })

          if (!changed) {
            return null
          }

          return { type: 'FeatureCollection', features: nextFeatures }
        },
        'Grid lock applied.',
        'Select one or more features to snap to grid.',
      )
      return
    }

    if (mode === 'align') {
      applyCollectionMutation(
        (collection) => {
          const selectedSet = new Set(selectedEditFeatureIdsRef.current)
          const selected = collection.features
            .map((feature) => {
              const featureId = normalizeFeatureId(feature)
              if (!featureId || !selectedSet.has(featureId)) {
                return null
              }
              return { id: featureId, geometry: feature.geometry }
            })
            .filter((feature): feature is { id: string; geometry: Geometry } => Boolean(feature))

          const updates = alignFeatureGeometries(selected, options.alignTarget)
          if (!updates.size) {
            return null
          }

          const nextFeatures = collection.features.map((feature) => {
            const featureId = normalizeFeatureId(feature)
            if (!featureId) {
              return feature
            }
            const geometry = updates.get(featureId)
            if (!geometry) {
              return feature
            }
            return { ...feature, geometry }
          })

          return { type: 'FeatureCollection', features: nextFeatures }
        },
        'Alignment complete.',
        'Select at least two features to align.',
      )
    }
  }

  const runHistoryCommand = (action: 'undo' | 'redo') => {
    if (!drawRef.current || !activeEditLayerIdRef.current) {
      return
    }

    const targetIndex = action === 'undo' ? editHistoryIndexRef.current - 1 : editHistoryIndexRef.current + 1
    if (targetIndex < 0 || targetIndex >= editHistoryRef.current.length) {
      onEditInfoRef.current?.(
        action === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.',
        'info',
      )
      publishEditState()
      return
    }

    const before = getCurrentDrawCollection()
    const next = cloneFeatureCollection(editHistoryRef.current[targetIndex])
    applyingHistoryRef.current = true
    setDrawCollection(next)
    applyingHistoryRef.current = false
    editHistoryIndexRef.current = targetIndex
    diffAndEmitPersistence(before, next)
    onEditInfoRef.current?.(action === 'undo' ? 'Undo complete.' : 'Redo complete.', 'success')
    publishEditState()
  }

  useEffect(() => {
    if (!editCommand || !activeEditLayerId) {
      return
    }
    if (lastEditCommandNonceRef.current === editCommand.nonce) {
      return
    }

    lastEditCommandNonceRef.current = editCommand.nonce
    if (editCommand.action === 'undo') {
      runHistoryCommand('undo')
      return
    }
    if (editCommand.action === 'redo') {
      runHistoryCommand('redo')
      return
    }

    runModeCommand(advancedEditModeRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCommand, activeEditLayerId])

  useEffect(() => {
    publishEditState()
  }, [activeEditLayerId])

  useEffect(() => {
    const map = mapRef.current
    const drawAny = drawRef.current as (MapboxDraw & {
      changeMode?: (mode: string, options?: Record<string, unknown>) => void
    }) | null

    const restoreDragPan = () => {
      if (map && !map.dragPan.isEnabled()) {
        map.dragPan.enable()
      }
    }

    const finishRotateScaleSession = (cancel = false) => {
      const session = rotateScaleDragSessionRef.current
      if (!session) {
        return
      }
      rotateScaleDragSessionRef.current = null
      restoreDragPan()

      if (cancel) {
        setDrawCollection(session.startCollection)
        refreshSelectionGuides(session.startCollection)
        publishEditState()
        return
      }

      const nextCollection = getCurrentDrawCollection()
      if (JSON.stringify(session.startCollection) === JSON.stringify(nextCollection)) {
        refreshSelectionGuides(nextCollection)
        publishEditState()
        return
      }

      diffAndEmitPersistence(session.startCollection, nextCollection)
      pushHistorySnapshot(nextCollection)
      onEditInfoRef.current?.('Rotate/Scale complete.', 'success')
      refreshSelectionGuides(nextCollection)
      publishEditState()
    }

    if (!map || !drawAny || !activeEditLayerId || advancedEditMode !== 'rotate-scale') {
      rotateScaleSelectionSignatureRef.current = ''
      finishRotateScaleSession(false)
      return () => {
        restoreDragPan()
      }
    }

    const enforceSimpleSelectNoDrag = () => {
      if (typeof drawAny.changeMode !== 'function') {
        return
      }
      const selectedIds = selectedEditFeatureIdsRef.current
      const signature = selectedIds.join('|')
      if (!selectedIds.length) {
        rotateScaleSelectionSignatureRef.current = ''
        return
      }
      if (signature === rotateScaleSelectionSignatureRef.current) {
        return
      }
      rotateScaleSelectionSignatureRef.current = signature
      drawAny.changeMode('simple_select', { featureIds: selectedIds, dragMove: false })
    }

    const applyDragPreview = (event: maplibregl.MapMouseEvent) => {
      const session = rotateScaleDragSessionRef.current
      if (!session) {
        return
      }

      const centerPoint = map.project([session.center[0], session.center[1]])
      const dx = event.point.x - centerPoint.x
      const dy = event.point.y - centerPoint.y
      const currentAngle = Math.atan2(dy, dx)
      const angleDegrees = ((currentAngle - session.startAngle) * 180) / Math.PI
      const rawScale = Math.hypot(dx, dy) / Math.max(ROTATE_HANDLE_MIN_RADIUS_PX, session.startRadius)
      const shiftHeld = Boolean((event.originalEvent as MouseEvent | undefined)?.shiftKey)
      const scaleFactor = shiftHeld
        ? Math.max(ROTATE_SCALE_MIN_FACTOR, Math.min(ROTATE_SCALE_MAX_FACTOR, rawScale))
        : 1

      const nextFeatures = session.startCollection.features.map((feature) => {
        const featureId = normalizeFeatureId(feature)
        if (!featureId || !session.selectedIds.has(featureId)) {
          return feature
        }
        return {
          ...feature,
          geometry: rotateScaleGeometry(feature.geometry, angleDegrees, scaleFactor),
        }
      })

      const transformedCollection: GeoJsonFeatureCollection = {
        type: 'FeatureCollection',
        features: nextFeatures,
      }
      setDrawCollection(transformedCollection)
    }

    const onMouseDown = (event: maplibregl.MapMouseEvent) => {
      const nativeEvent = event.originalEvent as MouseEvent | undefined
      if (!nativeEvent || nativeEvent.button !== 0) {
        return
      }

      const handleGeometry = rotateScaleHandleRef.current
      if (!handleGeometry) {
        return
      }

      const selectedIds = selectedEditFeatureIdsRef.current
      if (!selectedIds.length) {
        return
      }

      const handlePoint = map.project([handleGeometry.handle[0], handleGeometry.handle[1]])
      const hitDistance = Math.hypot(event.point.x - handlePoint.x, event.point.y - handlePoint.y)
      if (hitDistance > ROTATE_HANDLE_HIT_RADIUS_PX) {
        return
      }

      const centerPoint = map.project([handleGeometry.center[0], handleGeometry.center[1]])
      const startDx = event.point.x - centerPoint.x
      const startDy = event.point.y - centerPoint.y
      const startRadius = Math.max(ROTATE_HANDLE_MIN_RADIUS_PX, Math.hypot(startDx, startDy))
      const startAngle = Math.atan2(startDy, startDx)

      rotateScaleDragSessionRef.current = {
        startCollection: getCurrentDrawCollection(),
        selectedIds: new Set(selectedIds),
        center: handleGeometry.center,
        startAngle,
        startRadius,
      }

      if (map.dragPan.isEnabled()) {
        map.dragPan.disable()
      }
      nativeEvent.preventDefault()
      nativeEvent.stopPropagation()
    }

    const onMouseMove = (event: maplibregl.MapMouseEvent) => {
      applyDragPreview(event)
    }

    const onMouseUp = () => {
      finishRotateScaleSession(false)
    }

    const onWindowMouseUp = () => {
      finishRotateScaleSession(false)
    }

    const onMapMove = () => {
      if (!rotateScaleDragSessionRef.current) {
        refreshSelectionGuides()
      }
    }

    const onSelectionChange = () => {
      if (rotateScaleDragSessionRef.current) {
        return
      }
      enforceSimpleSelectNoDrag()
      refreshSelectionGuides()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finishRotateScaleSession(true)
      }
    }

    enforceSimpleSelectNoDrag()
    refreshSelectionGuides()

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    map.on('move', onMapMove)
    map.on('draw.selectionchange', onSelectionChange)
    window.addEventListener('mouseup', onWindowMouseUp)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      map.off('move', onMapMove)
      map.off('draw.selectionchange', onSelectionChange)
      window.removeEventListener('mouseup', onWindowMouseUp)
      window.removeEventListener('keydown', onKeyDown)
      rotateScaleSelectionSignatureRef.current = ''
      finishRotateScaleSession(false)
      restoreDragPan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditLayerId, advancedEditMode])

  useEffect(() => {
    const map = mapRef.current
    const drawAny = drawRef.current as (MapboxDraw & {
      changeMode?: (mode: string, options?: Record<string, unknown>) => void
      getMode?: () => string
    }) | null

    if (!map || !drawAny || !activeEditLayerId) {
      splitTargetFeatureIdsRef.current = []
      return
    }

    if (advancedEditMode !== 'split' && advancedEditMode !== 'reshape') {
      splitTargetFeatureIdsRef.current = []
      reshapeDirectFeatureIdRef.current = null
      return
    }

    const enforceMode = () => {
      const selectedIds = selectedEditFeatureIdsRef.current
      const currentMode = drawAny.getMode?.() ?? 'simple_select'

      if (advancedEditMode === 'reshape') {
        splitTargetFeatureIdsRef.current = []
        if (!selectedIds.length) {
          reshapeDirectFeatureIdRef.current = null
          if (currentMode !== 'simple_select') {
            drawAny.changeMode?.('simple_select', { dragMove: false })
          }
          return
        }

        const primaryId = selectedIds[0]
        if (!primaryId) {
          return
        }
        if (currentMode !== 'direct_select' || reshapeDirectFeatureIdRef.current !== primaryId) {
          drawAny.changeMode?.('direct_select', { featureId: primaryId })
          reshapeDirectFeatureIdRef.current = primaryId
        }
        return
      }

      if (advancedEditMode === 'split') {
        reshapeDirectFeatureIdRef.current = null
        if (!selectedIds.length) {
          splitTargetFeatureIdsRef.current = []
          if (currentMode !== 'simple_select') {
            drawAny.changeMode?.('simple_select', { dragMove: false })
          }
          return
        }

        splitTargetFeatureIdsRef.current = [...selectedIds]
        if (currentMode !== 'draw_line_string') {
          drawAny.changeMode?.('draw_line_string')
        }
      }
    }

    const onSelectionOrModeChange = () => {
      enforceMode()
      refreshSelectionGuides()
      publishEditState()
    }

    enforceMode()
    refreshSelectionGuides()
    publishEditState()

    map.on('draw.selectionchange', onSelectionOrModeChange)
    map.on('draw.modechange', onSelectionOrModeChange)

    return () => {
      map.off('draw.selectionchange', onSelectionOrModeChange)
      map.off('draw.modechange', onSelectionOrModeChange)
      if (advancedEditMode === 'split') {
        splitTargetFeatureIdsRef.current = []
      }
      if (advancedEditMode === 'reshape') {
        reshapeDirectFeatureIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditLayerId, advancedEditMode])

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

      const polygonPatternAtlas = getPatternAtlasSpec(evaluator.polygonPatternLibrary, evaluator.polygonPattern)
      const polygonPatternDisabled = evaluator.polygonPatternLibrary === 'builtin' && evaluator.polygonPattern === 'solid'
      if (polygonPatternAtlas && !polygonPatternDisabled) {
        const polygonFeatures = filteredData.features.filter((feature) => {
          const geometry = feature.geometry
          return geometry ? isPolygonGeometryType(geometry.type) : false
        })

        if (polygonFeatures.length) {
          builtLayers.push(
            new GeoJsonLayer({
              id: `layer-${layer.id}-pattern`,
              data: { ...filteredData, features: polygonFeatures },
              pickable: false,
              stroked: false,
              filled: true,
              pointRadiusMinPixels: 0,
              lineWidthMinPixels: 0,
              getLineColor: [0, 0, 0, 0],
              getFillColor: evaluator.polygonPatternColor,
              getPointRadius: () => 0,
              extensions: [new FillStyleExtension({ pattern: true })],
              fillPatternAtlas: polygonPatternAtlas.atlas,
              fillPatternMapping: polygonPatternAtlas.mapping,
              fillPatternMask: true,
              getFillPattern: () => evaluator.polygonPattern,
              getFillPatternScale: () => evaluator.polygonPatternScale,
              getFillPatternOffset: () => [0, 0],
              parameters: { depthTest: false },
            }),
          )
        }
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

    const utilityTheme = resolveUtilityOverlayTheme(utilityOverlay?.utilityType)

    if (utilityOverlay?.edges?.features?.length) {
      builtLayers.push(
        new GeoJsonLayer({
          id: 'utility-overlay-edges',
          data: utilityOverlay.edges,
          pickable: true,
          autoHighlight: true,
          stroked: true,
          filled: false,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 2,
          getLineColor: utilityTheme.edge,
          getLineWidth: (feature: unknown) => {
            const assetType = featureProperty(feature, 'asset_type')
            return assetType === 'transmission' || assetType === 'main' ? 4 : 3
          },
          highlightColor: [255, 255, 255, 140],
          parameters: { depthTest: false },
        }),
      )
    }

    if (utilityOverlay?.nodes?.features?.length) {
      builtLayers.push(
        new GeoJsonLayer({
          id: 'utility-overlay-nodes',
          data: utilityOverlay.nodes,
          pickable: true,
          autoHighlight: true,
          stroked: true,
          filled: true,
          pointRadiusUnits: 'pixels',
          pointRadiusMinPixels: 6,
          lineWidthMinPixels: 1,
          getPointRadius: (feature: unknown) => {
            const assetType = featureProperty(feature, 'asset_type')
            return assetType === 'source' || assetType === 'substation' ? 7 : 5
          },
          getPointColor: utilityTheme.node,
          getFillColor: utilityTheme.node,
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 1.5,
          highlightColor: [255, 255, 255, 160],
          parameters: { depthTest: false },
        }),
      )
    }

    if (utilityOverlay?.servicePoints?.features?.length) {
      builtLayers.push(
        new GeoJsonLayer({
          id: 'utility-overlay-service-points',
          data: utilityOverlay.servicePoints,
          pickable: true,
          autoHighlight: true,
          stroked: true,
          filled: true,
          pointRadiusUnits: 'pixels',
          pointRadiusMinPixels: 5,
          lineWidthMinPixels: 1,
          getPointRadius: 4,
          getPointColor: utilityTheme.servicePoint,
          getFillColor: utilityTheme.servicePoint,
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 1,
          highlightColor: [255, 255, 255, 160],
          parameters: { depthTest: false },
        }),
      )
    }

    if (mapZoom >= 13) {
      const utilityLabels = [
        ...(utilityOverlay?.nodes?.features ?? []).slice(0, 30),
        ...(utilityOverlay?.servicePoints?.features ?? []).slice(0, 30),
      ]
        .map((feature) => {
          const text = utilityFeatureLabel(feature)
          const position = labelPosition(feature)
          if (!text || !position) {
            return null
          }
          return { text, position }
        })
        .filter((item): item is { text: string; position: [number, number] } => Boolean(item))

      if (utilityLabels.length) {
        builtLayers.push(
          new TextLayer({
            id: 'utility-overlay-labels',
            data: utilityLabels,
            pickable: false,
            billboard: true,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getColor: utilityTheme.label,
            getSize: 13,
            getTextAnchor: 'start',
            getAlignmentBaseline: 'bottom',
            getOutlineColor: [255, 255, 255, 220],
            getOutlineWidth: 2,
            outlineWidthMaxPixels: 3,
            characterSet: 'auto',
            parameters: { depthTest: false },
          }),
        )
      }
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

    if (activeEditLayerId && selectedBoundsGuides?.features?.length) {
      const modeColors = getModeColors(advancedEditMode)
      builtLayers.push(
        new GeoJsonLayer({
          id: 'edit-selected-bounds',
          data: selectedBoundsGuides,
          pickable: false,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 2,
          getLineColor: [...modeColors.primary, 230],
          getLineWidth: 2,
          getDashArray: [6, 3],
          dashJustified: true,
          extensions: [new PathStyleExtension({ dash: true })],
          parameters: { depthTest: false },
        }),
      )
    }

    if (activeEditLayerId && rotateScaleGuides?.features?.length) {
      builtLayers.push(
        new GeoJsonLayer({
          id: 'edit-rotate-scale-guides',
          data: rotateScaleGuides,
          pickable: false,
          stroked: true,
          filled: true,
          pointRadiusMinPixels: 4,
          lineWidthMinPixels: 2,
          getPointRadius: (feature: unknown) => (featureProperty(feature, 'role') === 'handle' ? 7 : 4),
          getPointColor: (feature: unknown) => (
            featureProperty(feature, 'role') === 'handle'
              ? [245, 158, 11, 255]
              : [20, 94, 170, 240]
          ),
          getLineColor: [245, 158, 11, 225],
          getLineWidth: 2,
          getFillColor: [245, 158, 11, 255],
          parameters: { depthTest: false },
        }),
      )
    }

    if (activeEditLayerId && selectedVertexGuides?.features?.length) {
      const modeColors = getModeColors(advancedEditMode)
      builtLayers.push(
        new GeoJsonLayer({
          id: 'edit-selected-vertices',
          data: selectedVertexGuides,
          pickable: false,
          stroked: true,
          filled: true,
          pointRadiusMinPixels: 3,
          lineWidthMinPixels: 1,
          getPointRadius: 4,
          getPointColor: [255, 255, 255, 220],
          getLineColor: [...modeColors.primary, 255],
          getLineWidth: 1.5,
          getFillColor: [255, 255, 255, 220],
          parameters: { depthTest: false },
        }),
      )
    }

    // Add reshape preview layer
    if (activeEditLayerId && advancedEditMode === 'reshape' && showReshapePreview && selectedEditFeatureIdsRef.current.length) {
      const previewFeatures = getCurrentDrawCollection().features
        .filter(f => selectedEditFeatureIdsRef.current.includes(String(f.id)))
        .map(feature => {
          const reshaped = reshapeGeometry(feature.geometry, reshapeStrength)
          return {
            ...feature,
            geometry: reshaped,
            properties: { ...feature.properties, preview: true }
          }
        })

      if (previewFeatures.length) {
        const modeColors = getModeColors('reshape')
        builtLayers.push(
          new GeoJsonLayer({
            id: 'reshape-preview',
            data: { type: 'FeatureCollection', features: previewFeatures },
            pickable: false,
            stroked: true,
            filled: true,
            getLineColor: [...modeColors.primary, 200],
            getFillColor: [...modeColors.primary, 40],
            getLineWidth: 3,
            getDashArray: [8, 4],
            dashJustified: true,
            extensions: [new PathStyleExtension({ dash: true })],
            parameters: { depthTest: false },
          }),
        )
      }
    }

    // Add shape preview layer
    if (activeEditLayerId && shapePreview?.features?.length) {
      builtLayers.push(
        new GeoJsonLayer({
          id: 'shape-preview',
          data: shapePreview,
          pickable: false,
          stroked: true,
          filled: true,
          getLineColor: [33, 150, 243, 220], // Blue
          getFillColor: [33, 150, 243, 60],
          getLineWidth: 2,
          getDashArray: [5, 3],
          dashJustified: true,
          extensions: [new PathStyleExtension({ dash: true })],
          parameters: { depthTest: false },
        }),
      )

      // Add size label during interactive drawing
      const feature = shapePreview.features[0]
      if (feature?.properties?.size && shapeDrawingSession) {
        const sizeMeters = feature.properties.size as number
        const center = shapeDrawingSession.startPoint

        builtLayers.push(
          new TextLayer({
            id: 'shape-size-label',
            data: [
              {
                position: [center[0], center[1]],
                text: `${sizeMeters}m`,
              },
            ],
            pickable: false,
            getPosition: (d: { position: [number, number] }) => d.position,
            getText: (d: { text: string }) => d.text,
            getSize: 16,
            getColor: [33, 150, 243, 255],
            getBackgroundColor: [255, 255, 255, 220],
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'center',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            background: true,
            backgroundPadding: [4, 2],
            parameters: { depthTest: false },
          }),
        )
      }
    }

    if (activeEditLayerId && activeSnapSettings.enabled && !snapTemporarilyDisabled && snapCandidate) {
      const snapGuideCollection: GeoJsonFeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [snapCandidate[0], snapCandidate[1]] },
            properties: { guide: 'snap-target' },
          },
        ],
      }

      builtLayers.push(
        new GeoJsonLayer({
          id: 'edit-snap-guide',
          data: snapGuideCollection,
          pickable: false,
          stroked: true,
          filled: true,
          pointRadiusMinPixels: 7,
          lineWidthMinPixels: 2,
          getPointRadius: 8,
          getPointColor: [16, 110, 190, 255],
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2,
          getFillColor: [16, 110, 190, 180],
        }),
      )
    }

    // Phase 1: Add highlight layer for selected features
    const allSelectedFeatures: GeoJsonFeature[] = []
    for (const [layerId, selectedIds] of Object.entries(selectedFeaturesByLayer)) {
      if (!selectedIds.length) {
        continue
      }
      const collection = featureCollections[layerId]
      if (!collection) {
        continue
      }
      const selectedFeats = collection.features.filter((f) => selectedIds.includes(String(f.id)))
      allSelectedFeatures.push(...selectedFeats)
    }

    if (allSelectedFeatures.length > 0) {
      builtLayers.push(
        new GeoJsonLayer({
          id: 'selected-features-highlight',
          data: {
            type: 'FeatureCollection',
            features: allSelectedFeatures,
          },
          getFillColor: (f: unknown) => {
            const feature = f as GeoJsonFeature
            const isFlashing = flashingFeatures.has(String(feature.id))
            return isFlashing ? [255, 255, 0, 120] : [0, 255, 255, 80]
          },
          getLineColor: (f: unknown) => {
            const feature = f as GeoJsonFeature
            const isFlashing = flashingFeatures.has(String(feature.id))
            return isFlashing ? [255, 255, 0, 255] : [0, 255, 255, 255]
          },
          getLineWidth: 4,
          lineWidthMinPixels: 3,
          pickable: false,
          updateTriggers: {
            getFillColor: flashingFeatures,
            getLineColor: flashingFeatures,
          },
        }),
      )
    }

    return builtLayers
  }, [
    layers,
    visibleByLayerId,
    featureCollections,
    legendFilters,
    analysisOverlay,
    utilityOverlay,
    activeEditLayerId,
    measurementOverlay,
    mapZoom,
    selectedVertexGuides,
    selectedBoundsGuides,
    rotateScaleGuides,
    activeSnapSettings.enabled,
    snapTemporarilyDisabled,
    snapCandidate,
    advancedEditMode,
    showReshapePreview,
    reshapeStrength,
    shapePreview,
    shapeDrawingSession,
    selectedFeaturesByLayer,
    flashingFeatures,
  ])

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

    const applyGeometryOverrides = (overrides: Map<string, Geometry>) => {
      if (!overrides.size || !drawRef.current) {
        return
      }

      const before = getCurrentDrawCollection()
      let changed = false
      const nextFeatures = before.features.map((feature) => {
        const featureId = normalizeFeatureId(feature)
        if (!featureId) {
          return feature
        }
        const geometry = overrides.get(featureId)
        if (!geometry) {
          return feature
        }
        changed = true
        return { ...feature, geometry }
      })

      if (!changed) {
        return
      }

      setDrawCollection({ type: 'FeatureCollection', features: nextFeatures })
    }

    const onCreate = (event: { features: Array<{ id?: string | number; geometry: Geometry; properties?: Record<string, unknown> }> }) => {
      if (syncingDrawRef.current) {
        return
      }

      const layerId = activeEditLayerIdRef.current
      if (!layerId) {
        return
      }

      if (advancedEditModeRef.current === 'split') {
        const splitTargets = splitTargetFeatureIdsRef.current.length
          ? splitTargetFeatureIdsRef.current
          : selectedEditFeatureIdsRef.current
        const splitLineFeature = event.features.find((feature) => isLineGeometryType(feature.geometry.type))
        if (splitLineFeature) {
          // Store the split line geometry before deleting it
          splitLineGeometryRef.current = cloneGeometry(splitLineFeature.geometry)

          const sketchIds = event.features
            .map((feature) => (feature.id === undefined || feature.id === null ? null : String(feature.id)))
            .filter((featureId): featureId is string => Boolean(featureId))
          if (sketchIds.length && drawRef.current) {
            syncingDrawRef.current = true
            drawRef.current.delete(sketchIds)
            syncingDrawRef.current = false
          }

          if (!splitTargets.length) {
            onEditInfoRef.current?.('Select one or more line/polygon features before drawing a split line.', 'warning')
            splitLineGeometryRef.current = null
            return
          }

          selectedEditFeatureIdsRef.current = [...splitTargets]
          runModeCommand('split')

          // Clear split state and return to selection mode
          splitTargetFeatureIdsRef.current = []
          selectedEditFeatureIdsRef.current = []
          splitLineGeometryRef.current = null

          queueMicrotask(() => {
            const drawAny = drawRef.current as (MapboxDraw & {
              changeMode?: (mode: string, options?: Record<string, unknown>) => void
            }) | null
            // Return to simple_select so user can select new features or do other operations
            drawAny?.changeMode?.('simple_select', { dragMove: false })
            publishEditState()
            refreshSelectionGuides()
          })
          return
        }
      }

      const expectedGeometryFamily = activeEditGeometryFamilyRef.current
      const invalidFeatureIds: string[] = []
      const constrainedGeometries = new Map<string, Geometry>()
      const excludedIds = new Set(
        event.features
          .map((feature) => (feature.id === undefined || feature.id === null ? null : String(feature.id)))
          .filter((featureId): featureId is string => Boolean(featureId)),
      )
      let invalidCount = 0
      let createdCount = 0
      for (const feature of event.features) {
        const constrainedGeometry = applyConstraintsToGeometry(feature.geometry, excludedIds)
        if (!geometryMatchesLayerFamily(constrainedGeometry.type, expectedGeometryFamily)) {
          invalidCount += 1
          if (feature.id !== undefined && feature.id !== null) {
            invalidFeatureIds.push(String(feature.id))
          }
          continue
        }

        if (feature.id !== undefined && feature.id !== null && JSON.stringify(feature.geometry) !== JSON.stringify(constrainedGeometry)) {
          constrainedGeometries.set(String(feature.id), constrainedGeometry)
        }

        createdCount += 1
        onFeatureCreatedRef.current?.(layerId, constrainedGeometry, feature.properties)
      }

      if (invalidFeatureIds.length && drawRef.current) {
        syncingDrawRef.current = true
        drawRef.current.delete(invalidFeatureIds)
        syncingDrawRef.current = false
      }
      applyGeometryOverrides(constrainedGeometries)

      if (invalidCount) {
        onEditValidationErrorRef.current?.(
          `Only ${geometryFamilyLabel(expectedGeometryFamily)} geometry is allowed for this layer.`,
        )
      }

      if (createdCount && !applyingHistoryRef.current) {
        pushHistorySnapshot(getCurrentDrawCollection())
      }
      publishEditState()
      refreshSelectionGuides()
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

      const expectedGeometryFamily = activeEditGeometryFamilyRef.current
      const constrainedGeometries = new Map<string, Geometry>()
      const excludedIds = new Set(
        event.features
          .map((feature) => (feature.id === undefined || feature.id === null ? null : String(feature.id)))
          .filter((featureId): featureId is string => Boolean(featureId)),
      )
      let invalidCount = 0
      let updatedCount = 0
      for (const feature of event.features) {
        const constrainedGeometry = applyConstraintsToGeometry(feature.geometry, excludedIds)
        if (!geometryMatchesLayerFamily(constrainedGeometry.type, expectedGeometryFamily)) {
          invalidCount += 1
          continue
        }

        const featureId = String(feature.id ?? '')
        if (!featureId) {
          continue
        }

        const version =
          typeof feature.properties?._version === 'number'
            ? (feature.properties._version as number)
            : undefined

        if (JSON.stringify(feature.geometry) !== JSON.stringify(constrainedGeometry)) {
          constrainedGeometries.set(featureId, constrainedGeometry)
        }

        updatedCount += 1
        onFeatureUpdatedRef.current?.(layerId, featureId, constrainedGeometry, feature.properties, version)
      }

      applyGeometryOverrides(constrainedGeometries)

      if (invalidCount) {
        onEditValidationErrorRef.current?.(
          `Only ${geometryFamilyLabel(expectedGeometryFamily)} geometry is allowed for this layer.`,
        )
      }

      if (updatedCount && !applyingHistoryRef.current) {
        pushHistorySnapshot(getCurrentDrawCollection())
      }
      publishEditState()
      refreshSelectionGuides()
    }

    const onDelete = (event: { features: Array<{ id?: string | number }> }) => {
      if (syncingDrawRef.current) {
        return
      }

      const layerId = activeEditLayerIdRef.current
      if (!layerId) {
        return
      }

      let deletedCount = 0
      for (const feature of event.features) {
        const featureId = String(feature.id ?? '')
        if (!featureId || isTempFeatureId(featureId)) {
          continue
        }

        deletedCount += 1
        onFeatureDeletedRef.current?.(layerId, featureId)
      }

      if (deletedCount && !applyingHistoryRef.current) {
        pushHistorySnapshot(getCurrentDrawCollection())
      }
      publishEditState()
      refreshSelectionGuides()
    }

    const onSelectionChange = (event: { features: Array<{ id?: string | number }> }) => {
      const nextIds = event.features
        .map((feature) => (feature.id === undefined || feature.id === null ? null : String(feature.id)))
        .filter((featureId): featureId is string => Boolean(featureId))

      if (advancedEditModeRef.current === 'split') {
        const drawAny = drawRef.current as (MapboxDraw & { getMode?: () => string }) | null
        const drawMode = drawAny?.getMode?.() ?? ''
        if (drawMode === 'draw_line_string' && !nextIds.length && splitTargetFeatureIdsRef.current.length) {
          publishEditState()
          refreshSelectionGuides()
          return
        }
        splitTargetFeatureIdsRef.current = [...nextIds]
      }

      selectedEditFeatureIdsRef.current = nextIds
      publishEditState()
      refreshSelectionGuides()
    }

    map.on('draw.create', onCreate)
    map.on('draw.update', onUpdate)
    map.on('draw.delete', onDelete)
    map.on('draw.selectionchange', onSelectionChange)
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
        drawControlGeometryFamilyRef.current = null
      }
      map.off('draw.create', onCreate)
      map.off('draw.update', onUpdate)
      map.off('draw.delete', onDelete)
      map.off('draw.selectionchange', onSelectionChange)
      map.off('moveend', onMoveEnd)
      overlay.finalize()
      map.remove()
      overlayRef.current = null
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const onMapMouseDown = (event: maplibregl.MapMouseEvent) => {
      // Handle shape drawing start
      if (activeShapeType && activeEditLayerId) {
        const startPoint: [number, number] = [event.lngLat.lng, event.lngLat.lat]
        setShapeDrawingSession({
          startPoint,
          currentPoint: startPoint,
        })
        event.preventDefault()
        return
      }
    }

    const onMapMouseMove = (event: maplibregl.MapMouseEvent) => {
      // Update shape drawing session
      if (shapeDrawingSession) {
        setShapeDrawingSession({
          ...shapeDrawingSession,
          currentPoint: [event.lngLat.lng, event.lngLat.lat],
        })
        return
      }
    }

    const onMapMouseUp = (event: maplibregl.MapMouseEvent) => {
      // Handle shape placement after drag
      if (activeShapeType && activeEditLayerId && drawRef.current && shapeDrawingSession) {
        const center = shapeDrawingSession.startPoint
        const endPoint: [number, number] = [event.lngLat.lng, event.lngLat.lat]

        // Calculate distance between start and end points to determine size
        const dx = endPoint[0] - center[0]
        const dy = endPoint[1] - center[1]
        const distanceDegrees = Math.sqrt(dx * dx + dy * dy)

        // Convert to meters (rough approximation)
        const kmPerDegree = 111.32
        const distanceMeters = distanceDegrees * kmPerDegree * 1000

        // Use dragged distance if > 10m, otherwise use default size
        const effectiveSize = distanceMeters > 10 ? distanceMeters : shapeSize

        let coordinates: number[][]

        switch (activeShapeType) {
          case 'circle':
            coordinates = generateCirclePolygon(center, effectiveSize)
            break
          case 'rectangle':
            coordinates = generateRectanglePolygon(center, effectiveSize * 1.5, effectiveSize)
            break
          case 'square':
            coordinates = generateRectanglePolygon(center, effectiveSize, effectiveSize)
            break
          case 'triangle':
            coordinates = generateRegularPolygon(center, effectiveSize, 3)
            break
          case 'pentagon':
            coordinates = generateRegularPolygon(center, effectiveSize, 5)
            break
          case 'hexagon':
            coordinates = generateRegularPolygon(center, effectiveSize, 6)
            break
          case 'star':
            coordinates = generateStarPolygon(center, effectiveSize, effectiveSize * 0.4, 5)
            break
          default:
            setShapeDrawingSession(null)
            return
        }

        // Create the polygon feature
        const feature: GeoJsonFeature<Geometry> = {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [coordinates],
          },
        }

        // Add to draw
        const featureIds = drawRef.current.add(feature)
        if (featureIds.length > 0 && activeEditLayerId) {
          // Trigger feature creation
          onFeatureCreatedRef.current?.(activeEditLayerId, feature.geometry, feature.properties ?? {})
        }

        // Clear shape preview and session
        setShapePreview(null)
        setShapeDrawingSession(null)
        return
      }

      // Clear drawing session if no shape was created
      if (shapeDrawingSession) {
        setShapeDrawingSession(null)
        return
      }
    }

    const onMapClick = (event: maplibregl.MapMouseEvent) => {
      // Handle measurement mode
      if (!measurementModeRef.current || activeEditLayerIdRef.current) {
        return
      }

      setMeasurementVertices((current) => [...current, [event.lngLat.lng, event.lngLat.lat]])
    }

    map.on('mousedown', onMapMouseDown)
    map.on('mousemove', onMapMouseMove)
    map.on('mouseup', onMapMouseUp)
    map.on('click', onMapClick)
    return () => {
      map.off('mousedown', onMapMouseDown)
      map.off('mousemove', onMapMouseMove)
      map.off('mouseup', onMapMouseUp)
      map.off('click', onMapClick)
    }
  }, [activeShapeType, shapeSize, activeEditLayerId, shapeDrawingSession])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Alt') {
        return
      }
      setSnapTemporarilyDisabled(true)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Alt') {
        return
      }
      setSnapTemporarilyDisabled(false)
    }

    const onBlur = () => {
      setSnapTemporarilyDisabled(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    if (!activeEditLayerId || !activeSnapSettings.enabled) {
      snapCandidateRef.current = null
      setSnapCandidate(null)
    }
  }, [activeEditLayerId, activeSnapSettings.enabled, measurementMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const canvas = map.getCanvas()
    const canvasContainer = map.getCanvasContainer()
    const mapContainer = map.getContainer()

    const resolveDrawMode = (): string => {
      const drawAny = drawRef.current as (MapboxDraw & { getMode?: () => string }) | null
      if (!drawAny || typeof drawAny.getMode !== 'function') {
        return 'simple_select'
      }
      try {
        return String(drawAny.getMode() ?? 'simple_select')
      } catch {
        return 'simple_select'
      }
    }

    const resolveCursor = (mode: string, hasSnapTarget: boolean): string => {
      if (measurementModeRef.current && !activeEditLayerIdRef.current) {
        return 'crosshair'
      }
      if (!activeEditLayerIdRef.current) {
        return 'default'
      }
      if (mode.startsWith('draw_')) {
        return 'crosshair'
      }
      if (hasSnapTarget && activeSnapSettingsRef.current.enabled && !snapTemporarilyDisabledRef.current) {
        return 'copy'
      }
      if (mode === 'direct_select') {
        return 'cell'
      }
      if (selectedEditFeatureIdsRef.current.length) {
        const advancedMode = advancedEditModeRef.current
        if (advancedMode === 'split') {
          return 'cell'
        }
        if (advancedMode === 'rotate-scale') {
          return 'move'
        }
        if (advancedMode === 'trace') {
          return 'alias'
        }
        if (advancedMode === 'align') {
          return 'all-scroll'
        }
        if (advancedMode === 'reshape') {
          return 'cell'
        }
        if (advancedMode === 'rectangular-constraints') {
          return 'nesw-resize'
        }
        if (advancedMode === 'grid-lock') {
          return 'crosshair'
        }
        return 'pointer'
      }
      return 'default'
    }

    const applyCursorStyle = (value: string) => {
      desiredCursorRef.current = value
      canvas.style.setProperty('cursor', value, 'important')
      canvasContainer.style.setProperty('cursor', value, 'important')
      mapContainer.style.setProperty('cursor', value, 'important')
    }

    const updateCursor = (modeOverride?: string, snapOverride?: Position | null) => {
      const nextMode = modeOverride ?? resolveDrawMode()
      const activeSnapTarget = snapOverride === undefined ? snapCandidateRef.current : snapOverride
      const nextCursor = resolveCursor(nextMode, Boolean(activeSnapTarget))
      setDrawMode((current) => (current === nextMode ? current : nextMode))
      setCursor((current) => (current === nextCursor ? current : nextCursor))
      applyCursorStyle(nextCursor)
    }

    const onMouseMove = (event: maplibregl.MapMouseEvent) => {
      if (!activeEditLayerIdRef.current || !drawRef.current) {
        updateCursor(undefined, null)
        return
      }

      // Handle shape preview
      const currentShapeType = activeShapeTypeRef.current
      const currentShapeSize = shapeSizeRef.current

      if (currentShapeType) {
        // Check if we're in a drawing session
        let center: [number, number]
        let effectiveSize = currentShapeSize

        if (shapeDrawingSession) {
          // Use the start point as center during drag
          center = shapeDrawingSession.startPoint
          const currentPoint: [number, number] = [event.lngLat.lng, event.lngLat.lat]

          // Calculate distance to determine size
          const dx = currentPoint[0] - center[0]
          const dy = currentPoint[1] - center[1]
          const distanceDegrees = Math.sqrt(dx * dx + dy * dy)

          // Convert to meters
          const kmPerDegree = 111.32
          const distanceMeters = distanceDegrees * kmPerDegree * 1000

          // Use dragged distance if > 10m, otherwise use default
          effectiveSize = distanceMeters > 10 ? distanceMeters : currentShapeSize
        } else {
          // No drawing session, show preview at cursor position
          center = [event.lngLat.lng, event.lngLat.lat]
        }

        let coordinates: number[][]

        switch (currentShapeType) {
          case 'circle':
            coordinates = generateCirclePolygon(center, effectiveSize)
            break
          case 'rectangle':
            coordinates = generateRectanglePolygon(center, effectiveSize * 1.5, effectiveSize)
            break
          case 'square':
            coordinates = generateRectanglePolygon(center, effectiveSize, effectiveSize)
            break
          case 'triangle':
            coordinates = generateRegularPolygon(center, effectiveSize, 3)
            break
          case 'pentagon':
            coordinates = generateRegularPolygon(center, effectiveSize, 5)
            break
          case 'hexagon':
            coordinates = generateRegularPolygon(center, effectiveSize, 6)
            break
          case 'star':
            coordinates = generateStarPolygon(center, effectiveSize, effectiveSize * 0.4, 5)
            break
          default:
            coordinates = []
        }

        if (coordinates.length > 0) {
          setShapePreview({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {
                  preview: true,
                  size: Math.round(effectiveSize),
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [coordinates],
                },
              },
            ],
          })
        }

        updateCursor('crosshair', null)
        return
      } else {
        setShapePreview(null)
      }

      const snapSettings = activeSnapSettingsRef.current
      if (!snapSettings.enabled || snapTemporarilyDisabledRef.current) {
        if (snapCandidateRef.current !== null) {
          snapCandidateRef.current = null
          setSnapCandidate(null)
        }
        updateCursor(undefined, null)
        return
      }

      const current = getCurrentDrawCollection()
      const excludedIds = new Set(selectedEditFeatureIdsRef.current)
      const vertices = collectCollectionVertices(current, excludedIds)
      if (!vertices.length) {
        if (snapCandidateRef.current !== null) {
          snapCandidateRef.current = null
          setSnapCandidate(null)
        }
        updateCursor(undefined, null)
        return
      }

      const cursorPoint: Position = [event.lngLat.lng, event.lngLat.lat]
      const tolerance = metersToPixelsAtLatitude(snapSettings.toleranceMeters, event.lngLat.lat, map.getZoom())
      const nearest = findNearestVertex(map, cursorPoint, vertices, tolerance)
      const nextSnap = nearest ? [nearest[0], nearest[1]] as Position : null

      const previous = snapCandidateRef.current
      const unchanged =
        (previous === null && nextSnap === null) ||
        (Boolean(previous && nextSnap) &&
          Math.abs((previous as Position)[0] - (nextSnap as Position)[0]) < 1e-12 &&
          Math.abs((previous as Position)[1] - (nextSnap as Position)[1]) < 1e-12)
      if (!unchanged) {
        snapCandidateRef.current = nextSnap
        setSnapCandidate(nextSnap)
      }

      updateCursor(undefined, nextSnap)
    }

    const onMouseOut = () => {
      snapCandidateRef.current = null
      setSnapCandidate(null)
      updateCursor(undefined, null)
    }

    const onSelectionOrModeChange = () => {
      updateCursor()
    }

    const cursorObserverTargets: HTMLElement[] = [canvas, canvasContainer, mapContainer]
    const cursorObserver = new MutationObserver(() => {
      const desired = desiredCursorRef.current
      const shouldReapply = cursorObserverTargets.some((target) => (target.style.cursor || '') !== desired)
      if (shouldReapply) {
        applyCursorStyle(desired)
      }
    })
    for (const target of cursorObserverTargets) {
      cursorObserver.observe(target, { attributes: true, attributeFilter: ['style', 'class'] })
    }

    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseOut)
    map.on('draw.selectionchange', onSelectionOrModeChange)
    map.on('draw.modechange', onSelectionOrModeChange)
    updateCursor()

    return () => {
      map.off('mousemove', onMouseMove)
      map.off('mouseout', onMouseOut)
      map.off('draw.selectionchange', onSelectionOrModeChange)
      map.off('draw.modechange', onSelectionOrModeChange)
      cursorObserver.disconnect()
      canvas.style.removeProperty('cursor')
      canvasContainer.style.removeProperty('cursor')
      mapContainer.style.removeProperty('cursor')
    }
  }, [activeEditLayerId, activeSnapSettings.enabled, measurementMode, advancedEditMode, shapeDrawingSession])

  useEffect(() => {
    const snapEnabled = Boolean(activeEditLayerId && activeSnapSettings.enabled)
    onEditUiStateChangeRef.current?.({
      cursor,
      drawMode,
      advancedMode: advancedEditMode,
      snapEnabled,
      snapTemporarilyDisabled: snapEnabled ? snapTemporarilyDisabled : false,
      snapCandidate: snapEnabled ? Boolean(snapCandidate) : false,
      snapTolerancePixels: snapEnabled ? Math.round(activeSnapTolerancePixels) : 0,
    })
  }, [
    cursor,
    drawMode,
    activeEditLayerId,
    advancedEditMode,
    activeSnapSettings.enabled,
    snapTemporarilyDisabled,
    snapCandidate,
    activeSnapTolerancePixels,
  ])

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
        drawControlGeometryFamilyRef.current = null
      }
      selectedEditFeatureIdsRef.current = []
      editHistoryRef.current = []
      editHistoryIndexRef.current = -1
      historyLayerIdRef.current = null
      lastEditCommandNonceRef.current = null
      setSelectedVertexGuides(null)
      setSelectedBoundsGuides(null)
      setRotateScaleGuides(null)
      rotateScaleHandleRef.current = null
      rotateScaleDragSessionRef.current = null
      rotateScaleSelectionSignatureRef.current = ''
      splitTargetFeatureIdsRef.current = []
      reshapeDirectFeatureIdRef.current = null
      publishEditState()
      return
    }

    if (drawRef.current && drawControlGeometryFamilyRef.current !== activeEditGeometryFamily) {
      map.removeControl(drawRef.current as unknown as maplibregl.IControl)
      drawRef.current = null
      drawControlGeometryFamilyRef.current = null
    }

    if (!drawRef.current) {
      const DrawCtor = mapboxDrawWithMapLibreClasses()
      drawRef.current = new DrawCtor({
        displayControlsDefault: false,
        controls: drawControlsForGeometryFamily(activeEditGeometryFamily),
        defaultMode: 'simple_select',
        styles: [
          // Active line being drawn - bright orange, thick, highly visible
          {
            id: 'gl-draw-line-active',
            type: 'line',
            filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#FF6B35',
              'line-width': 4,
            },
          },
          // Vertices of active line - large dots
          {
            id: 'gl-draw-polygon-and-line-vertex-active',
            type: 'circle',
            filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
            paint: {
              'circle-radius': 7,
              'circle-color': '#FF6B35',
              'circle-stroke-color': '#FFFFFF',
              'circle-stroke-width': 2,
            },
          },
          // Midpoint vertices (for adding points)
          {
            id: 'gl-draw-polygon-midpoint',
            type: 'circle',
            filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
            paint: {
              'circle-radius': 4,
              'circle-color': '#fbb03b',
            },
          },
          // Inactive lines (already drawn, not selected)
          {
            id: 'gl-draw-line-inactive',
            type: 'line',
            filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'false']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#3388ff',
              'line-width': 2,
            },
          },
          // Polygons - fill
          {
            id: 'gl-draw-polygon-fill-inactive',
            type: 'fill',
            filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            paint: {
              'fill-color': '#3388ff',
              'fill-outline-color': '#3388ff',
              'fill-opacity': 0.1,
            },
          },
          {
            id: 'gl-draw-polygon-fill-active',
            type: 'fill',
            filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
            paint: {
              'fill-color': '#fbb03b',
              'fill-outline-color': '#fbb03b',
              'fill-opacity': 0.1,
            },
          },
          // Polygons - stroke
          {
            id: 'gl-draw-polygon-stroke-inactive',
            type: 'line',
            filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#3388ff',
              'line-width': 2,
            },
          },
          {
            id: 'gl-draw-polygon-stroke-active',
            type: 'line',
            filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#fbb03b',
              'line-width': 2,
            },
          },
          // Points
          {
            id: 'gl-draw-point-inactive',
            type: 'circle',
            filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']],
            paint: {
              'circle-radius': 5,
              'circle-color': '#3388ff',
            },
          },
          {
            id: 'gl-draw-point-active',
            type: 'circle',
            filter: ['all', ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint'], ['==', 'active', 'true']],
            paint: {
              'circle-radius': 7,
              'circle-color': '#fbb03b',
            },
          },
        ],
      })
      map.addControl(drawRef.current as unknown as maplibregl.IControl, 'top-left')
      drawControlGeometryFamilyRef.current = activeEditGeometryFamily
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
        if (!geometryMatchesLayerFamily(feature.geometry.type, activeEditGeometryFamily)) {
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
    selectedEditFeatureIdsRef.current = []

    if (historyLayerIdRef.current !== activeEditLayerId || !editHistoryRef.current.length) {
      historyLayerIdRef.current = activeEditLayerId
      resetHistory(getCurrentDrawCollection())
    } else {
      publishEditState()
    }
    refreshSelectionGuides(getCurrentDrawCollection())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditLayerId, activeEditGeometryFamily, editLayerFeatures])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !zoomRequest) {
      return
    }

    if (lastHandledZoomRequestNonceRef.current === zoomRequest.nonce) {
      return
    }
    lastHandledZoomRequestNonceRef.current = zoomRequest.nonce
    fitCollectionBounds(map, featureCollections[zoomRequest.layerId])
  }, [zoomRequest, featureCollections])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitVisibleRequest) {
      return
    }

    if (lastHandledFitVisibleRequestNonceRef.current === fitVisibleRequest.nonce) {
      return
    }
    lastHandledFitVisibleRequestNonceRef.current = fitVisibleRequest.nonce
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

    if (lastHandledLocateRequestNonceRef.current === locateRequest.nonce) {
      return
    }
    lastHandledLocateRequestNonceRef.current = locateRequest.nonce
    map.flyTo({
      center: [locateRequest.lng, locateRequest.lat],
      zoom: locateRequest.zoom ?? 14,
      bearing: locateRequest.bearing ?? map.getBearing(),
      pitch: locateRequest.pitch ?? map.getPitch(),
      essential: true,
      speed: 0.9,
    })
  }, [locateRequest])

  // Phase 1: Handle feature zoom request
  useEffect(() => {
    const map = mapRef.current
    if (!map || !featureZoomRequest) {
      return
    }

    if (lastHandledFeatureZoomRequestNonceRef.current === featureZoomRequest.nonce) {
      return
    }
    lastHandledFeatureZoomRequestNonceRef.current = featureZoomRequest.nonce

    const collection = featureCollections[featureZoomRequest.layerId]
    if (!collection) {
      return
    }

    const selectedFeatures = collection.features.filter((f) =>
      featureZoomRequest.featureIds.includes(String(f.id)),
    )

    if (selectedFeatures.length === 0) {
      return
    }

    const selectedCollection: GeoJsonFeatureCollection = {
      type: 'FeatureCollection',
      features: selectedFeatures,
    }

    fitCollectionBounds(map, selectedCollection)
  }, [featureZoomRequest, featureCollections])

  // Phase 1: Handle flash feature request
  useEffect(() => {
    if (!flashFeatureRequest) {
      return
    }

    if (lastHandledFlashFeatureRequestNonceRef.current === flashFeatureRequest.nonce) {
      return
    }
    lastHandledFlashFeatureRequestNonceRef.current = flashFeatureRequest.nonce

    // Add feature to flashing set
    setFlashingFeatures((prev) => new Set([...prev, flashFeatureRequest.featureId]))

    // Remove after 1 second
    setTimeout(() => {
      setFlashingFeatures((prev) => {
        const next = new Set(prev)
        next.delete(flashFeatureRequest.featureId)
        return next
      })
    }, 1000)
  }, [flashFeatureRequest])

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

  const modeColors = activeEditLayerId && advancedEditMode ? getModeColors(advancedEditMode) : null
  const ModeIcon = modeColors?.icon ?? EditIcon

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Mode indicator badge */}
      {activeEditLayerId && advancedEditMode && modeColors && (
        <Chip
          icon={<ModeIcon />}
          label={modeColors.label}
          sx={{
            position: 'absolute',
            top: 120,
            left: 16,
            bgcolor: `rgb(${modeColors.primary.join(',')})`,
            color: 'white',
            fontWeight: 'bold',
            zIndex: 1000,
            boxShadow: 2,
          }}
        />
      )}

      {/* Split mode instruction overlay */}
      {activeEditLayerId && advancedEditMode === 'split' && selectedEditFeatureIdsRef.current.length > 0 && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: `rgb(${getModeColors('split').primary.join(',')})`,
            color: 'white',
            px: 3,
            py: 1.5,
            borderRadius: 2,
            boxShadow: 3,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            maxWidth: '90%',
          }}
        >
          <CallSplitIcon />
          <Box>
            <Typography variant="body2" fontWeight="medium">
              Draw a line across the feature to split it
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.9, display: 'block', mt: 0.5 }}>
              Click points to create the split line, then double-click or press Enter to finish
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => {
              selectedEditFeatureIdsRef.current = []
              publishEditState()
              refreshSelectionGuides()
            }}
            sx={{ color: 'white', ml: 1 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Reshape mode control panel */}
      {activeEditLayerId && advancedEditMode === 'reshape' && selectedEditFeatureIdsRef.current.length > 0 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 100,
            right: 16,
            bgcolor: 'white',
            p: 2,
            borderRadius: 2,
            boxShadow: 3,
            minWidth: 240,
            zIndex: 1000,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <AutoFixHighIcon sx={{ color: `rgb(${getModeColors('reshape').primary.join(',')})` }} />
            <Typography variant="subtitle2" fontWeight="bold">
              Reshape Tool
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" gutterBottom display="block">
            Smoothing Strength
          </Typography>
          <Slider
            value={reshapeStrength}
            onChange={(_, value) => {
              setReshapeStrength(value as number)
              setShowReshapePreview(true)
            }}
            onChangeCommitted={() => setShowReshapePreview(false)}
            min={0.15}
            max={0.85}
            step={0.05}
            marks={[
              { value: 0.15, label: 'Subtle' },
              { value: 0.45, label: 'Medium' },
              { value: 0.85, label: 'Smooth' },
            ]}
            sx={{
              '& .MuiSlider-markLabel': {
                fontSize: '0.7rem',
              },
            }}
          />

          <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
            <Button
              fullWidth
              variant="contained"
              size="small"
              onClick={() => {
                const options = advancedEditOptionsRef.current
                advancedEditOptionsRef.current = { ...options, reshapeStrength }
                runModeCommand('reshape')
                setShowReshapePreview(false)
              }}
              sx={{
                bgcolor: `rgb(${getModeColors('reshape').primary.join(',')})`,
                '&:hover': {
                  bgcolor: `rgb(${getModeColors('reshape').accent.join(',')})`,
                },
              }}
            >
              Apply
            </Button>
            <Button
              fullWidth
              variant="outlined"
              size="small"
              onClick={() => {
                setShowReshapePreview(false)
                setReshapeStrength(0.45)
              }}
            >
              Reset
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            Adjust vertices directly, then apply smoothing
          </Typography>
        </Box>
      )}
    </Box>
  )
}
