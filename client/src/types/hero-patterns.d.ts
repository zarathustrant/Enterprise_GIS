declare module 'hero-patterns' {
  export type HeroPatternFn = (color?: string, opacity?: number) => string
  const patterns: Record<string, HeroPatternFn>
  export = patterns
}
