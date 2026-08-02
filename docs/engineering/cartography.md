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

Collision handling is map-wide and deterministic. Candidates from every visible layer are projected to screen space, sorted by label-class plus numeric-field priority, measured after wrapping and rotation, and accepted only when their padded bounds do not overlap a previously accepted label. Labels with collision disabled remain visible without blocking other candidates. The accepted labels are drawn after feature geometry so later symbols cannot cover text.

This CPU collision pass replaces deck.gl's `CollisionFilterExtension`, which suppressed the complete shared label group in the MapLibre interleaved overlay on supported browsers. Zoom, pan, bearing, pitch, style, and data changes recompute collision bounds.

Labels can wrap at a character target and abbreviate with an ellipsis at a maximum length before collision evaluation. Unbroken strings are split into bounded chunks rather than overflowing the collision estimate.

Label classes are ordered attribute-equality rules with independent label fields, colors, sizes, zoom ranges, and priorities. Repeated line labels use real-world spacing and may rotate to the local line segment. True glyph-by-glyph curved labels require a dedicated path-label engine and remain planned.

Polygon label fitting estimates the wrapped text bounds against the polygon's projected screen bounds and suppresses labels that do not fit at the current zoom. Legend patches default to the layer geometry and may be overridden with circle, square, line, or area conventions.

The style editor reports foundational accessibility warnings for low opacity, undersized point/line symbols, poor label-halo contrast, and category colors that are too similar.

The style dialog, map evaluator, and legend use the same values. This is the minimum contract for every future cartographic capability: editor, persistence, map evaluation, and legend representation must ship together.

## Renderer edge semantics

- Opacity is a true `0..1` range. Zero remains fully transparent and is never raised to a visibility floor.
- Active-map opacity multiplies source/category/pattern/secondary-symbol opacity without changing the source layer style.
- Unique values distinguish configured, unmatched, and null/empty values.
- Class breaks are sorted numerically for evaluation and legends. Shared boundaries belong to the following break, except the final maximum, which is inclusive.
- Overlapping class breaks are rejected by the API because their output would depend on array order.
- Line categories color the primary line stroke. Polygon categories color the fill while retaining the configured outline.
- Scale overrides are applied before symbol evaluation. The last matching override wins.
- Polygon interior placement avoids holes and falls back from centroid to an interior search for concave geometry.
- Line and multiline labels use length midpoints rather than middle vertices; the longest multiline part is selected.

## Style validation contract

`style_validation.py` validates source styles and per-map style overrides before persistence. Invalid requests return HTTP 400 with an `Invalid layer style` error and actionable `details` entries. The client includes those details in the displayed API error.

Validation currently covers:

- renderer names and the 200 KB payload limit
- base, fallback, null, scale-override, label-class, and secondary-symbol colors
- all opacity ranges, non-negative dimensions, dash arrays, and zoom ranges
- supported icon libraries
- JSON expression shape and complexity
- duplicate categories, label-class IDs, and secondary-symbol IDs
- finite class-break values, ascending ranges, and overlap detection

## Reproducible QA data

Run `make seed-capabilities` after migrations. The idempotent seed creates:

- user `capability_demo` with password `EnterpriseGIS!2026`
- `Capability QA Geodatabase`
- default map `Symbology & Labels QA`
- nine point, line, polygon, and multipart layers

The default map initially shows facilities, spatial-statistics points, roads, and districts. Additional analysis fixtures remain in the map but start hidden to prevent visual obstruction.

The fixtures explicitly exercise icons and icon-field fallback, unmatched and null categories, exact class-break boundaries, null numeric values, true zero opacity, scale overrides, line casing and repeat labels, polygon holes and concavity, interior markers, long/unbroken text, label classes, priorities, pattern fills, and geometry-appropriate legends.

Regression coverage:

- `tests/test_style_validation.py`
- `tests/test_catalog_postgis.py`
- `client/src/components/MapCanvas.style.test.ts`
- `client/src/utils/legend.test.ts`
- `client/e2e/symbology-labeling.spec.ts`

## Next renderer slices

1. true curved line labels
2. organization style libraries and schema versioning
