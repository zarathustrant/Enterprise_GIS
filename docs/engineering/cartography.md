# Professional Web Cartography

## Objective

The cartography subsystem should support repeatable publishing-quality maps rather than treating styling as a single color per layer. A saved style must evaluate consistently in the map, legend, and future vector-tile publishing paths.

## Capability register

| Capability | Status |
|---|---|
| Scale-dependent symbol overrides | Implemented |
| Symbol levels and drawing order | Implemented |
| Multiple symbol layers per feature | Implemented for lines; expansion planned |
| Line casing | Implemented |
| Marker placement along lines | Implemented |
| Polygon centroid/interior-point markers | Implemented |
| Categorized all-other values | Implemented |
| Null-value styling | Implemented |
| Normalization and expression-based rendering | Foundation implemented; expansion planned |
| Label collision priorities | Implemented |
| Label classes | Implemented |
| Curved line labels | Segment-following implemented; true curved glyphs planned |
| Repeat distances | Implemented |
| Polygon label fitting | Implemented |
| Text wrapping and abbreviation | Implemented |
| Geometry-appropriate legend patches | Implemented with publisher overrides |
| Visual accessibility checks | Implemented foundation |
| Saved organization style libraries | Planned |

## Symbol rendering order

The current rendering stack uses this visual order:

1. line casing
2. primary feature symbol
3. polygon pattern overlay
4. labels
5. editing and analysis overlays

Line casing is a solid under-stroke. The configured casing width is added on both sides of the primary stroke, while the foreground line retains its configured dash pattern. Casing is restricted to line and multiline geometry.

## Compatibility

Style properties are additive and optional. Existing layers render as before because casing defaults to disabled.

Current casing properties:

- `lineCasingEnabled`
- `lineCasingColor`
- `lineCasingWidth`

## Categorized fallback semantics

Unique-value and class-break renderers distinguish three states:

- a configured category or break
- all other values, including unmatched or out-of-range values
- null or empty values

These groups use stable legend keys so interactive filtering behaves consistently regardless of how many unmatched raw values exist. Null symbols and all-other symbols have independent color and opacity controls.

## Scale-dependent symbol overrides

Zoom rules override base color, opacity, stroke width, and point radius. Rules are evaluated in list order and the last matching rule wins when ranges overlap. The map and legend both evaluate against the current map zoom. Existing styles remain compatible because an empty rule list uses the base symbol at every zoom.

## Symbol composition

Layer symbol levels control draw order across map layers. Line layers may contain ordered secondary strokes below or above the primary stroke, each with independent color, opacity, width, and dash settings. Repeated line markers use real-world spacing and may rotate to the local segment bearing.

Polygon markers support arithmetic centroid or an interior search. Interior placement checks polygon holes and searches inside concave polygons when the centroid is not usable.

## Label readability

Collision handling uses the configured numeric priority field to retain higher-priority labels. Labels can wrap at a character target and abbreviate with an ellipsis at a maximum length before collision evaluation.

Label classes are ordered attribute-equality rules with independent label fields, colors, sizes, zoom ranges, and priorities. Repeated line labels use real-world spacing and may rotate to the local line segment. True glyph-by-glyph curved labels require a dedicated path-label engine and remain planned.

Polygon label fitting estimates the wrapped text bounds against the polygon's projected screen bounds and suppresses labels that do not fit at the current zoom. Legend patches default to the layer geometry and may be overridden with circle, square, line, or area conventions.

The style editor reports foundational accessibility warnings for low opacity, undersized point/line symbols, poor label-halo contrast, and category colors that are too similar.

The style dialog, map evaluator, and legend use the same values. This is the minimum contract for every future cartographic capability: editor, persistence, map evaluation, and legend representation must ship together.

## Next renderer slices

1. true curved line labels
2. organization style libraries and schema versioning
