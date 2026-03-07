import type { Feature as GeoJsonFeature } from 'geojson'
import type { FeatureCollection, Layer, LayerIconLibrary } from '../types/gis'
import { resolveIconId } from './iconLibrary'
import { geometryFamilyFromType, type GeometryFamily } from './geometry'

export type LegendMode = 'professional' | 'minimal' | 'analyst' | 'interactive' | 'presentation'

export type LayerRendererType = 'simple' | 'uniqueValue' | 'classBreaks'

export interface LegendItemModel {
  key: string
  label: string
  color: string
  count: number
  isDefault?: boolean
  iconId?: string
}

export interface LayerLegendModel {
  layerId: string
  layerName: string
  geometryFamily: GeometryFamily
  renderer: LayerRendererType
  field?: string
  pointShape: 'circle' | 'square' | 'icon'
  iconLibrary: LayerIconLibrary
  iconName: string
  iconId: string
  totalCount: number
  items: LegendItemModel[]
}

interface ParsedUniqueStop {
  key: string
  value: string
  color: string
}

interface ParsedClassBreakStop {
  key: string
  min: number
  max: number
  color: string
}

interface ParsedStyle {
  renderer: LayerRendererType
  baseColor: string
  uniqueField: string
  uniqueStops: ParsedUniqueStop[]
  uniqueDefaultColor: string
  classBreakField: string
  classBreakStops: ParsedClassBreakStop[]
  classBreakDefaultColor: string
  pointShape: 'circle' | 'square' | 'icon'
  iconLibrary: LayerIconLibrary
  iconName: string
  iconifyPrefix: string
}

function asStyle(layer: Layer): Record<string, unknown> {
  return (layer.style ?? {}) as Record<string, unknown>
}

export function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const token = value.trim()
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(token) ? token : fallback
}

function normalizeRenderer(value: unknown): LayerRendererType {
  if (value === 'uniqueValue' || value === 'classBreaks') {
    return value
  }
  return 'simple'
}

function normalizePointShape(value: unknown): 'circle' | 'square' | 'icon' {
  if (value === 'square' || value === 'icon') {
    return value
  }
  return 'circle'
}

function normalizeIconLibrary(value: unknown): LayerIconLibrary {
  if (
    value === 'maki' ||
    value === 'tabler' ||
    value === 'lucide' ||
    value === 'heroicons_outline' ||
    value === 'heroicons_solid' ||
    value === 'material_symbols' ||
    value === 'iconify'
  ) {
    return value
  }
  return 'maki'
}

function parseStyle(layer: Layer): ParsedStyle {
  const style = asStyle(layer)

  const uniqueStops: ParsedUniqueStop[] = (Array.isArray(style.uniqueValueStops) ? style.uniqueValueStops : [])
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const token = item as { value?: unknown; color?: unknown }
      if (token.value === undefined || token.value === null) {
        return null
      }
      const value = String(token.value)
      return {
        key: `uv:${value}`,
        value,
        color: normalizeColor(token.color, '#3f88c5'),
      }
    })
    .filter((item): item is ParsedUniqueStop => Boolean(item))

  const classBreakStops: ParsedClassBreakStop[] = (Array.isArray(style.classBreakStops) ? style.classBreakStops : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const token = item as { min?: unknown; max?: unknown; color?: unknown }
      if (typeof token.min !== 'number' || typeof token.max !== 'number') {
        return null
      }
      return {
        key: `cb:${index}`,
        min: token.min,
        max: token.max,
        color: normalizeColor(token.color, '#3f88c5'),
      }
    })
    .filter((item): item is ParsedClassBreakStop => Boolean(item))

  return {
    renderer: normalizeRenderer(style.rendererType),
    baseColor: normalizeColor(style.color, '#136f63'),
    uniqueField: typeof style.uniqueValueField === 'string' ? style.uniqueValueField : '',
    uniqueStops,
    uniqueDefaultColor: normalizeColor(style.uniqueDefaultColor, '#3f88c5'),
    classBreakField: typeof style.classBreakField === 'string' ? style.classBreakField : '',
    classBreakStops,
    classBreakDefaultColor: normalizeColor(style.classBreakDefaultColor, '#3f88c5'),
    pointShape: normalizePointShape(style.pointShape),
    iconLibrary: normalizeIconLibrary(style.iconLibrary),
    iconName: typeof style.iconName === 'string' ? style.iconName : 'marker',
    iconifyPrefix: typeof style.iconifyPrefix === 'string' ? style.iconifyPrefix : 'maki',
  }
}

function featureProperty(feature: GeoJsonFeature, field: string): unknown {
  if (!field) {
    return undefined
  }
  return (feature.properties ?? {})[field]
}

function classifyClassBreak(style: ParsedStyle, value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return 'cb:__default'
  }

  const breaks = style.classBreakStops
  for (let index = 0; index < breaks.length; index += 1) {
    const stop = breaks[index]
    const isLast = index === breaks.length - 1
    if (numeric >= stop.min && (numeric < stop.max || (isLast && numeric <= stop.max))) {
      return stop.key
    }
  }

  return 'cb:__default'
}

export function getFeatureLegendKey(layer: Layer, feature: GeoJsonFeature): string {
  const style = parseStyle(layer)

  if (style.renderer === 'uniqueValue') {
    if (!style.uniqueField) {
      return 'uv:__default'
    }
    const raw = featureProperty(feature, style.uniqueField)
    if (raw === undefined || raw === null || raw === '') {
      return 'uv:__default'
    }
    const key = `uv:${String(raw)}`
    const exists = style.uniqueStops.some((item) => item.key === key)
    return exists ? key : key
  }

  if (style.renderer === 'classBreaks') {
    if (!style.classBreakField) {
      return 'cb:__default'
    }
    return classifyClassBreak(style, featureProperty(feature, style.classBreakField))
  }

  return 'simple'
}

export function filterFeatureCollectionByLegend(
  layer: Layer,
  collection: FeatureCollection,
  hiddenKeys: Set<string>,
): FeatureCollection {
  if (!hiddenKeys.size) {
    return collection
  }

  const nextFeatures = collection.features.filter((feature) => !hiddenKeys.has(getFeatureLegendKey(layer, feature)))
  if (nextFeatures.length === collection.features.length) {
    return collection
  }

  return {
    ...collection,
    features: nextFeatures,
  }
}

export function buildLayerLegendModel(layer: Layer, collection?: FeatureCollection): LayerLegendModel {
  const style = parseStyle(layer)
  const features = collection?.features ?? []
  const geometryFamily = geometryFamilyFromType(layer.geometry_type)
  const iconId = resolveIconId(style.iconName, style.iconLibrary, style.iconifyPrefix)

  const itemsByKey = new Map<string, LegendItemModel>()

  if (style.renderer === 'simple') {
    const simpleLabel =
      geometryFamily === 'point'
        ? style.pointShape === 'icon'
          ? `Icon (${style.iconLibrary})`
          : 'Point symbol'
        : geometryFamily === 'line'
          ? 'Line symbol'
          : geometryFamily === 'polygon'
            ? 'Fill symbol'
            : 'Default symbol'
    itemsByKey.set('simple', {
      key: 'simple',
      label: simpleLabel,
      color: style.baseColor,
      count: 0,
      iconId: geometryFamily === 'point' && style.pointShape === 'icon' ? iconId : undefined,
    })
  } else if (style.renderer === 'uniqueValue') {
    for (const stop of style.uniqueStops) {
      itemsByKey.set(stop.key, {
        key: stop.key,
        label: stop.value,
        color: stop.color,
        count: 0,
        iconId: geometryFamily === 'point' && style.pointShape === 'icon' ? iconId : undefined,
      })
    }

    itemsByKey.set('uv:__default', {
      key: 'uv:__default',
      label: 'Other / empty',
      color: style.uniqueDefaultColor,
      count: 0,
      isDefault: true,
      iconId: geometryFamily === 'point' && style.pointShape === 'icon' ? iconId : undefined,
    })
  } else {
    for (const stop of style.classBreakStops) {
      itemsByKey.set(stop.key, {
        key: stop.key,
        label: `${stop.min} - ${stop.max}`,
        color: stop.color,
        count: 0,
        iconId: geometryFamily === 'point' && style.pointShape === 'icon' ? iconId : undefined,
      })
    }

    itemsByKey.set('cb:__default', {
      key: 'cb:__default',
      label: 'Outside breaks',
      color: style.classBreakDefaultColor,
      count: 0,
      isDefault: true,
      iconId: geometryFamily === 'point' && style.pointShape === 'icon' ? iconId : undefined,
    })
  }

  for (const feature of features) {
    const key = getFeatureLegendKey(layer, feature)
    if (!itemsByKey.has(key)) {
      if (style.renderer === 'uniqueValue') {
        const valueLabel = key.startsWith('uv:') ? key.slice(3) : key
        itemsByKey.set(key, {
          key,
          label: valueLabel || 'Other / empty',
          color: style.uniqueDefaultColor,
          count: 0,
          iconId: style.pointShape === 'icon' ? iconId : undefined,
        })
      } else {
        continue
      }
    }

    const item = itemsByKey.get(key)
    if (item) {
      item.count += 1
    }
  }

  let items = Array.from(itemsByKey.values())

  if (style.renderer === 'uniqueValue') {
    const configuredOrder = new Map<string, number>()
    style.uniqueStops.forEach((stop, index) => configuredOrder.set(stop.key, index))
    items = items.sort((a, b) => {
      const orderA = configuredOrder.get(a.key)
      const orderB = configuredOrder.get(b.key)
      if (orderA != null && orderB != null) {
        return orderA - orderB
      }
      if (orderA != null) {
        return -1
      }
      if (orderB != null) {
        return 1
      }
      if (a.isDefault) {
        return 1
      }
      if (b.isDefault) {
        return -1
      }
      return a.label.localeCompare(b.label)
    })
  } else if (style.renderer === 'classBreaks') {
    const order = new Map<string, number>()
    style.classBreakStops.forEach((stop, index) => order.set(stop.key, index))
    items = items.sort((a, b) => {
      const orderA = order.get(a.key)
      const orderB = order.get(b.key)
      if (orderA != null && orderB != null) {
        return orderA - orderB
      }
      if (orderA != null) {
        return -1
      }
      if (orderB != null) {
        return 1
      }
      if (a.isDefault) {
        return 1
      }
      if (b.isDefault) {
        return -1
      }
      return a.label.localeCompare(b.label)
    })
  }

  return {
    layerId: layer.id,
    layerName: layer.name,
    geometryFamily,
    renderer: style.renderer,
    field: style.renderer === 'uniqueValue' ? style.uniqueField : style.renderer === 'classBreaks' ? style.classBreakField : undefined,
    pointShape: style.pointShape,
    iconLibrary: style.iconLibrary,
    iconName: style.iconName,
    iconId,
    totalCount: features.length,
    items,
  }
}
