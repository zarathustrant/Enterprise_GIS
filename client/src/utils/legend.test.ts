import { describe, expect, it } from 'vitest'
import type { FeatureCollection, Layer } from '../types/gis'
import { buildLayerLegendModel, getFeatureLegendKey } from './legend'

const lineLayer: Layer = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Primary roads',
  description: null,
  geometry_type: 'LineString',
  crs: 'EPSG:4326',
  style: {
    rendererType: 'simple',
    color: '#f59e0b',
    lineCasingEnabled: true,
    lineCasingColor: '#1f2937',
    lineCasingWidth: 3,
  },
  min_zoom: 0,
  max_zoom: 24,
  is_public: true,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const collection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    id: 'road-1',
    geometry: { type: 'LineString', coordinates: [[3, 7], [4, 8]] },
    properties: {},
  }],
}

describe('buildLayerLegendModel', () => {
  it('carries line casing into the legend model', () => {
    const model = buildLayerLegendModel(lineLayer, collection)

    expect(model.geometryFamily).toBe('line')
    expect(model.lineCasingEnabled).toBe(true)
    expect(model.lineCasingColor).toBe('#1f2937')
    expect(model.lineCasingWidth).toBe(3)
    expect(model.items[0]?.count).toBe(1)
  })

  it('keeps casing disabled for legacy styles', () => {
    const model = buildLayerLegendModel({ ...lineLayer, style: {} }, collection)

    expect(model.lineCasingEnabled).toBe(false)
  })

  it('uses the last matching scale override at the current map zoom', () => {
    const layer: Layer = {
      ...lineLayer,
      style: {
        rendererType: 'simple',
        color: '#111111',
        scaleOverrides: [
          { minZoom: 5, maxZoom: 12, color: '#2563eb', opacity: 0.8, strokeWidth: 3, pointRadius: 6 },
          { minZoom: 10, maxZoom: 16, color: '#dc2626', opacity: 1, strokeWidth: 5, pointRadius: 8 },
        ],
      },
    }

    expect(buildLayerLegendModel(layer, collection, 8).items[0]?.color).toBe('#2563eb')
    expect(buildLayerLegendModel(layer, collection, 11).items[0]?.color).toBe('#dc2626')
    expect(buildLayerLegendModel(layer, collection, 18).items[0]?.color).toBe('#111111')
  })

  it('keeps configured, other, and null unique values in stable categories', () => {
    const layer: Layer = {
      ...lineLayer,
      style: {
        rendererType: 'uniqueValue',
        uniqueValueField: 'class',
        uniqueValueStops: [{ value: 'primary', color: '#dc2626', opacity: 1 }],
        uniqueDefaultColor: '#2563eb',
        uniqueNullColor: '#9ca3af',
      },
    }
    const features: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { class: 'primary' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { class: 'local' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 2] }, properties: { class: null } },
      ],
    }

    expect(getFeatureLegendKey(layer, features.features[0])).toBe('uv:primary')
    expect(getFeatureLegendKey(layer, features.features[1])).toBe('uv:__other')
    expect(getFeatureLegendKey(layer, features.features[2])).toBe('uv:__null')

    const model = buildLayerLegendModel(layer, features)
    expect(model.items.find((item) => item.key === 'uv:primary')?.count).toBe(1)
    expect(model.items.find((item) => item.key === 'uv:__other')?.count).toBe(1)
    expect(model.items.find((item) => item.key === 'uv:__null')?.count).toBe(1)
  })
})
