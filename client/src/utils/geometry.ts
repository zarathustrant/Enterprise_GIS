export type GeometryFamily = 'point' | 'line' | 'polygon' | 'mixed'

export function geometryFamilyFromType(geometryType: string | null | undefined): GeometryFamily {
  if (!geometryType) {
    return 'mixed'
  }

  const token = geometryType.toLowerCase()
  if (token.includes('point')) {
    return 'point'
  }
  if (token.includes('line')) {
    return 'line'
  }
  if (token.includes('polygon')) {
    return 'polygon'
  }
  return 'mixed'
}
