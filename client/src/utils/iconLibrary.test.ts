import { describe, expect, it } from 'vitest'
import { iconifySvgUrl, resolveIconId } from './iconLibrary'

describe('resolveIconId', () => {
  it('translates the inherited Maki marker when switching icon libraries', () => {
    expect(resolveIconId('marker', 'tabler', '')).toBe('tabler:map-pin')
    expect(resolveIconId('marker', 'lucide', '')).toBe('lucide:map-pin')
    expect(resolveIconId('marker', 'material_symbols', '')).toBe('material-symbols:location-on')
  })

  it('preserves explicit icon identifiers and valid Maki markers', () => {
    expect(resolveIconId('tabler:school', 'maki', '')).toBe('tabler:school')
    expect(resolveIconId('marker', 'maki', '')).toBe('maki:marker')
  })

  it('builds encoded Iconify URLs with safe fallbacks', () => {
    expect(iconifySvgUrl('tabler:school', '#ff 00')).toBe(
      'https://api.iconify.design/tabler/school.svg?color=%23ff%2000',
    )
    expect(iconifySvgUrl(':')).toBe('https://api.iconify.design/maki/marker.svg')
  })
})
