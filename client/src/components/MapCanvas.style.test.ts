import type { Feature as GeoJsonFeature, Geometry } from 'geojson'
import type { Layer } from '../types/gis'
import {
  evaluateExpression,
  filterLabelCollisions,
  labelPosition,
  polygonMarkerPosition,
  resolveLayerStyle,
} from './MapCanvas'

function layer(geometryType: string, style: Record<string, unknown>): Layer {
  return {
    id: 'style-test-layer',
    name: 'Style test',
    description: null,
    geometry_type: geometryType,
    crs: 'EPSG:4326',
    style,
    min_zoom: 0,
    max_zoom: 24,
    is_public: true,
    created_by: 'tester',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function feature(geometry: Geometry, properties: Record<string, unknown>): GeoJsonFeature {
  return { type: 'Feature', geometry, properties }
}

describe('layer style evaluation', () => {
  it('uses unique-value colors for line strokes and preserves true transparency', () => {
    const evaluator = resolveLayerStyle(layer('LineString', {
      rendererType: 'uniqueValue',
      uniqueValueField: 'class',
      uniqueValueStops: [{ value: 'primary', color: '#ff0000', opacity: 1 }],
      uniqueDefaultColor: '#0000ff',
      uniqueDefaultOpacity: 0,
      uniqueNullColor: '#999999',
      uniqueNullOpacity: 0.5,
      strokeColor: '#000000',
    }), 0, 10)

    expect(evaluator.getLineColor(feature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { class: 'primary' }))).toEqual([255, 0, 0, 255])
    expect(evaluator.getLineColor(feature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { class: 'other' }))).toEqual([0, 0, 255, 0])
    expect(evaluator.getLineColor(feature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { class: null }))).toEqual([153, 153, 153, 128])
  })

  it('multiplies category opacity by the map-layer opacity', () => {
    const evaluator = resolveLayerStyle(layer('Polygon', {
      rendererType: 'uniqueValue',
      uniqueValueField: 'zone',
      uniqueValueStops: [{ value: 'residential', color: '#00ff00', opacity: 0.8 }],
      layerOpacity: 0.5,
    }), 0, 10)
    const polygon: Geometry = {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    }

    expect(evaluator.getFillColor(feature(polygon, { zone: 'residential' }))).toEqual([0, 255, 0, 102])
  })

  it('sorts class breaks and assigns shared boundaries exactly once', () => {
    const evaluator = resolveLayerStyle(layer('Point', {
      rendererType: 'classBreaks',
      classBreakField: 'score',
      classBreakStops: [
        { min: 10, max: 20, color: '#ff0000', opacity: 1 },
        { min: 0, max: 10, color: '#00ff00', opacity: 1 },
      ],
    }), 0, 10)
    const point: Geometry = { type: 'Point', coordinates: [0, 0] }

    expect(evaluator.getPointColor(feature(point, { score: 9.999 }))).toEqual([0, 255, 0, 255])
    expect(evaluator.getPointColor(feature(point, { score: 10 }))).toEqual([255, 0, 0, 255])
    expect(evaluator.getPointColor(feature(point, { score: 20 }))).toEqual([255, 0, 0, 255])
  })

  it('uses the highest-priority matching label class and wraps long tokens', () => {
    const styledLayer = layer('Point', {
      labelField: 'name',
      labelWrapLength: 4,
      labelClasses: [
        { id: 'low', filterField: 'kind', filterValue: 'city', labelField: 'name', color: '#0000ff', size: 10, minZoom: 0, maxZoom: 24, priority: 2 },
        { id: 'high', filterField: 'kind', filterValue: 'city', labelField: 'capital', color: '#ff0000', size: 16, minZoom: 0, maxZoom: 24, priority: 20 },
      ],
    })
    const evaluator = resolveLayerStyle(styledLayer, 0, 10)
    const city = feature({ type: 'Point', coordinates: [0, 0] }, {
      kind: 'city', name: 'Ignored', capital: 'ABCDEFGHIJ',
    })

    expect(evaluator.getLabelText(city)).toBe('ABCD\nEFGH\nIJ')
    expect(evaluator.getLabelColor(city)).toEqual([255, 0, 0, 255])
    expect(evaluator.getLabelSize(city)).toBe(16)
    expect(evaluator.getLabelPriority(city)).toBe(20)
  })

  it('evaluates data-driven label and symbol expressions safely', () => {
    const item = feature({ type: 'Point', coordinates: [0, 0] }, { status: 'open', score: 75 })
    expect(evaluateExpression(['match', ['get', 'status'], 'open', '#00ff00', '#ff0000'], item)).toBe('#00ff00')
    expect(evaluateExpression(['interpolate', ['linear'], ['get', 'score'], 0, 2, 100, 12], item)).toBe(9.5)
    expect(evaluateExpression(['coalesce', ['get', 'missing'], ['get', 'status']], item)).toBe('open')
  })

  it('places line labels at the length midpoint, not the middle vertex', () => {
    const line = feature({
      type: 'LineString',
      coordinates: [[0, 0], [1, 0], [1, 9]],
    }, {})
    const position = labelPosition(line)

    expect(position).not.toBeNull()
    expect(position?.[0]).toBeCloseTo(1, 2)
    expect(position?.[1]).toBeGreaterThan(3)
  })

  it('keeps interior polygon labels out of holes', () => {
    const donut: Geometry = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
      ],
    }
    const position = polygonMarkerPosition(donut, 'interior')

    expect(position).not.toBeNull()
    const insideHole = position![0] > 4 && position![0] < 6 && position![1] > 4 && position![1] < 6
    expect(insideHole).toBe(false)
  })

  it('keeps the highest-priority colliding label and preserves collision-disabled labels', () => {
    const candidates = [
      { text: 'Low', position: [0, 0] as [number, number], size: 12, angle: 0, priority: 1, collisionEnabled: true },
      { text: 'High', position: [0, 0] as [number, number], size: 12, angle: 0, priority: 10, collisionEnabled: true },
      { text: 'Always', position: [0, 0] as [number, number], size: 12, angle: 0, priority: 0, collisionEnabled: false },
    ]
    const accepted = filterLabelCollisions(candidates, ([x, y]) => ({ x, y }))

    expect(accepted.map((item) => item.text)).toEqual(['High', 'Always'])
  })

  it('accounts for projected positions and rotated label bounds', () => {
    const candidates = [
      { text: 'Long label', position: [0, 0] as [number, number], size: 12, angle: 90, priority: 2, collisionEnabled: true },
      { text: 'Nearby', position: [0, 1] as [number, number], size: 12, angle: 0, priority: 1, collisionEnabled: true },
      { text: 'Far', position: [10, 10] as [number, number], size: 12, angle: 0, priority: 0, collisionEnabled: true },
    ]
    const accepted = filterLabelCollisions(candidates, ([x, y]) => ({ x: x * 20, y: y * 20 }))

    expect(accepted.map((item) => item.text)).toEqual(['Long label', 'Far'])
  })
})
