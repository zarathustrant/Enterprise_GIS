import type { LayerIconLibrary } from '../types/gis'

export interface IconLibraryDefinition {
  value: LayerIconLibrary
  label: string
  prefix: string
  example: string
}

export const ICON_LIBRARY_DEFINITIONS: IconLibraryDefinition[] = [
  { value: 'maki', label: 'Maki', prefix: 'maki', example: 'marker' },
  { value: 'tabler', label: 'Tabler', prefix: 'tabler', example: 'map-pin' },
  { value: 'lucide', label: 'Lucide', prefix: 'lucide', example: 'map-pin' },
  { value: 'heroicons_outline', label: 'Heroicons Outline', prefix: 'heroicons-outline', example: 'map-pin' },
  { value: 'heroicons_solid', label: 'Heroicons Solid', prefix: 'heroicons-solid', example: 'map-pin' },
  { value: 'material_symbols', label: 'Material Symbols', prefix: 'material-symbols', example: 'location-on' },
  { value: 'iconify', label: 'Any Iconify Set', prefix: '', example: 'bus' },
]

function sanitizeIconToken(value: string): string {
  return value.trim().replace(/\s+/g, '-').toLowerCase()
}

export function resolveIconPrefix(iconLibrary: LayerIconLibrary, iconifyPrefix: string): string {
  const found = ICON_LIBRARY_DEFINITIONS.find((item) => item.value === iconLibrary)
  if (found && found.prefix) {
    return found.prefix
  }
  return sanitizeIconToken(iconifyPrefix) || 'maki'
}

export function resolveIconId(token: string, iconLibrary: LayerIconLibrary, iconifyPrefix: string): string {
  const cleaned = sanitizeIconToken(token)
  if (!cleaned) {
    return `${resolveIconPrefix(iconLibrary, iconifyPrefix)}:marker`
  }

  if (cleaned.includes(':')) {
    const [prefix, ...parts] = cleaned.split(':')
    const name = parts.join(':')
    if (prefix && name) {
      return `${prefix}:${name}`
    }
  }

  return `${resolveIconPrefix(iconLibrary, iconifyPrefix)}:${cleaned}`
}

export function iconifySvgUrl(iconId: string, color?: string): string {
  const [prefix, ...parts] = iconId.split(':')
  const name = parts.join(':')
  const safePrefix = encodeURIComponent(prefix || 'maki')
  const safeName = encodeURIComponent(name || 'marker')
  const base = `https://api.iconify.design/${safePrefix}/${safeName}.svg`
  if (!color) {
    return base
  }
  return `${base}?color=${encodeURIComponent(color)}`
}
