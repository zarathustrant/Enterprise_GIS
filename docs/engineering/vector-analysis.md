# Vector Analysis Framework

## Purpose

Enterprise GIS is evolving from individual spatial endpoints into a consistent vector geoprocessing platform. The Phase 0 framework provides a shared contract for tool discovery, execution environments, durable run history, asynchronous processing, output creation, schema propagation, warnings, metrics, and provenance.

Raster analysis is intentionally deferred. This subsystem currently targets vector feature layers stored in PostGIS with EPSG:4326 geometry.

## Current Foundation

### Tool registry

`vector_analysis.py` owns the server-side catalogue. Each tool declares a stable ID and version, category, geometry compatibility, typed parameters, asynchronous support, and migration status. Clients discover it through `GET /api/v1/analysis/tools`. A tool marked `migrated: false` remains on its legacy endpoint and cannot yet use the shared executor.

### Analysis environments

The environment contract supports:

- full-layer, selected-feature, attribute-filter, and visible-extent scopes
- independent scopes for two-input tools
- optional coordinate precision-grid snapping
- explicit EPSG:4326 output CRS
- reject or transactionally repair invalid input geometry
- preserve or explode multipart output
- preserve or drop Z coordinates
- fail, suffix, or safely overwrite output-name collisions

### Durable runs

Migrations `006`, `007`, and `009` define durable runs and cancellation. A migrated execution records normalized inputs, source revisions, organization/workspace context, linked jobs, progress units, warnings, metrics, structured errors, provenance, lifecycle timestamps, and a deterministic SHA-256 reproducibility hash.

Run history is user-scoped:

- `GET /api/v1/analysis/runs`
- `GET /api/v1/analysis/runs/{run_id}`
- `POST /api/v1/analysis/runs/{run_id}/cancel`

The registry-driven workbench provides tool search, favorites, typed parameters, processing environments, recent runs, cancellation, rerun, and show-output actions. Automatic execution uses scoped feature and candidate-pair estimates to select synchronous or worker execution.

### Output handling

The shared output service creates a private output layer, clones the source layer's domains and fields, inserts derived features, and records create events in feature history. Results include feature count, elapsed time, warnings, and output layer IDs.

## Migrated Tools

### Buffer

Buffer is the first migrated tool. The existing `POST /api/v1/analysis/buffer` payload remains compatible:

```json
{
  "layer_id": "layer-uuid",
  "distance": 100,
  "output_name": "100 m buffer"
}
```

It additionally accepts environments and execution mode:

```json
{
  "execution_mode": "automatic",
  "environments": {
    "scope": "selected",
    "selected_feature_ids": ["feature-uuid"],
    "precision_grid": 0.000001,
    "output_crs": "EPSG:4326"
  }
}
```

Set `async: true`, `execution_mode: "asynchronous"`, or `?async=true` for worker execution. Synchronous and asynchronous paths now use the same executor.

### Intersect

Intersect now uses the shared executor for both request and worker execution. It provides:

- spatial-index bounding-box candidate filtering before `ST_Intersects`
- one materialized intersection calculation per candidate pair
- automatic output geometry based on the lowest input dimension
- explicit Point, Line, or Polygon component extraction
- deterministic Layer A and Layer B field prefixes
- fields, aliases, domains, nullability, defaults, and ordering from both inputs
- `source_a_id` and `source_b_id` provenance fields
- independent all-feature or selected-feature scope for each input
- optional precision-grid snapping
- input counts, maximum pair estimate, output geometry family, elapsed time, and output count metrics
- explicit warnings for dimensional extraction, large pair potential, and empty outputs

The endpoint remains `POST /api/v1/analysis/intersect`. Optional parameters are `output_type`, `prefix_a`, and `prefix_b`. Self-intersection is rejected until a dedicated tool can provide correct duplicate-pair and topology behavior.

### Clip and Erase

Clip and Erase share one polygon-mask overlay kernel and preserve the input layer's geometry family, complete field/domain schema, style, and zoom range.

Clip provides:

- Point, Line, or Polygon inputs with Polygon or MultiPolygon masks
- dissolved-mask mode by default, producing at most one output row per source feature
- per-mask mode with both source and mask feature provenance
- spatial-index candidate filtering and exact intersection tests
- removal of touching-only lower-dimensional results
- explicit warning that overlapping undissolved masks can duplicate source portions

Erase provides:

- unioned polygon masks to avoid repeated subtraction and overlap artifacts
- retention of unaffected features
- removal of fully covered features
- preservation of holes and multipart results through same-family extraction
- fully removed feature count in run metrics

Both tools support independent selected-feature scopes for input and mask layers, precision-grid snapping, synchronous or worker execution, durable run history, output feature history, and transactional rollback. Their endpoints are `POST /api/v1/analysis/clip` and `POST /api/v1/analysis/erase`.

### Dissolve

Dissolve aggregates all input features or groups them by multiple authoritative schema fields. It supports:

- zero, one, or multiple grouping fields
- grouped or excluded null values
- multipart output or `ST_Dump` singlepart expansion
- count, sum, minimum, maximum, mean, first, and last statistics
- numeric field enforcement for numeric statistics
- deterministic first/last ordering by source feature UUID
- preservation of grouping field aliases, types, defaults, domains, and order
- generated statistic fields with validated names and appropriate types
- selected-feature scope and precision-grid snapping
- staged `ST_Collect` plus `ST_UnaryUnion` aggregation

The endpoint is `POST /api/v1/analysis/dissolve`. The analysis panel loads layer fields and builds grouping and statistic rules visually.

### Spatial Join

Spatial Join retains target geometry and combines prefixed target and join schemas. It supports intersects, within, contains, touches, crosses, overlaps, equals, and within-distance predicates. Standard predicates use bounding-box filtering before exact tests; distance joins use indexed geography `ST_DWithin` in metres.

One-to-many output emits every match. One-to-one output deterministically retains the lowest matching feature UUID and records the complete `join_match_count`. Keep-all mode retains unmatched target features with nullable join provenance. Both modes preserve domains from both inputs, record source feature IDs, support independent selections, estimate maximum pair cardinality, and share synchronous/worker execution.

Nearest is intentionally implemented by the dedicated proximity kernel in Phase 6 rather than duplicated here. The endpoint is `POST /api/v1/analysis/spatial-join`.

### Summarize Within

Summarize Within retains polygon zone geometry and schema while calculating counts and measurements for a second feature layer. Boundary behavior is explicit: `intersects` clips crossing features to each zone, while `within` includes only completely contained features.

The tool calculates geodesic line length in metres, polygon area in square metres, zone area, percentage of zone area, and percentage of each source measurement represented inside the zone. It supports optional categorical grouping, repeatable sum/minimum/maximum/mean statistics, empty-zone retention, independent input selections, and source-family-aware metrics. Grouped summaries intentionally produce one zone-geometry row per category. The endpoint is `POST /api/v1/analysis/summarize-within`.

### Near

Near generates one or more ranked candidate relationships per source feature. PostGIS GiST KNN ordering selects a bounded candidate set and exact geography measurements on the WGS84 spheroid determine distance and deterministic rank, with feature UUID as the tie-breaker.

Outputs include source and near feature IDs, rank, distance in metres, initial bearing, closest-point longitude/latitude pairs, and collision-safe prefixed schemas from both inputs. Users can map each relationship as a connecting line, closest point on the source, or closest point on the near feature. The tool supports maximum geodesic search distance, same-layer self-match exclusion, independent input selections, synchronous/worker execution, and a configurable 1-100 nearest count. The endpoint is `POST /api/v1/analysis/near`.

For very large candidate layers, exact geodesic ranking is refined from at least 64 indexed geography KNN candidates per source. This bounds work and is exposed in run metrics. Antimeridian behavior and the multicolumn geography GiST plan are covered by database tests.

### Multi-Ring Buffer

Multi-Ring Buffer creates up to 50 ordered geodesic distance levels per source feature. Non-overlapping ring mode subtracts each previous geography buffer from the next; cumulative disk mode retains complete buffers at every distance. Outputs preserve source schema and add collision-safe source ID, ring index, inner distance, and outer distance fields. Selected scope, precision snapping, durable runs, and worker execution use the same framework. The endpoint is `POST /api/v1/analysis/multi-ring-buffer`.

### Polygonize Lines

Polygonize constructs polygons without mutating source linework. It optionally snaps coordinates on a user-supplied decimal-degree grid, removes repeated points, unions and nodes all intersections, and passes the resulting network to `ST_Polygonize`; closed rings and holes are preserved by PostGIS topology construction.

Attribute transfer can be disabled, use the deterministic lowest intersecting feature UUID, or choose the source line contributing the greatest polygon-boundary length. An optional companion diagnostics layer classifies unconsumed components as dangles, cut edges, or invalid rings. Independent run metrics identify polygon and diagnostic counts. The endpoint is `POST /api/v1/analysis/polygonize`.

### Geometry Construction

The consolidated Geometry Construction tool provides multipart-to-singlepart expansion, interior points, polygon boundaries, geodesically spaced points along lines, convex hulls, concave hulls, and oriented minimum bounding geometry. Every operation preserves the authoritative source schema, style, source-feature provenance, selected scope, worker compatibility, and run metrics. Geometry-family checks prevent polygon-boundary and points-along-line operations from accepting incompatible layers. The endpoint is `POST /api/v1/analysis/geometry-construct`.

### Geometry Management

Split Lines at Points uses geodesic tolerance, snaps qualifying points to line locations, and emits deterministic source/segment provenance. Merge Layers reconciles union or intersection schemas, rejects incompatible geometry families, records source-layer provenance, and resolves field types deterministically. Reproject validates EPSG definitions, transforms source coordinates, and normalizes stored output to the database's EPSG:4326 geometry contract.

### Geometry Quality and Topology

Geometry Quality provides check, repair, duplicate detection, snap/integrate, simplify, smooth, densify, sliver elimination, and polygon aggregation operations. Topology Validate reports polygon overlaps, slivers, and explicit coverage gaps. Destructive-sounding quality operations always write a new output layer; source inputs remain unchanged.

### Vector Spatial Statistics

Spatial Statistics provides mean center, geometric median center, central feature, standard distance, directional distribution, observed/expected nearest-neighbor statistics, global Moran's I, and local Getis-Ord Gi* hot-spot classes. Distance-based operations use geography measurements in metres and require an explicit distance band where mathematically necessary.

## Transaction Guarantees

- A run is committed before synchronous execution, so failures remain visible.
- Tool output and successful run completion are committed atomically.
- Failed worker transactions are rolled back before job and run failures are saved.
- Failed operations do not leave partial output layers.

## Verification

The guarded PostGIS suite refuses to run unless the database name contains `enterprise_gis_test`. It covers geometry/schema equivalence between synchronous and worker execution, cancellation, rollback, repair without source mutation, scopes and output policies, field maps, overlay conservation, polygon diagnostics, antimeridian proximity, index plans, management tools, quality/generalization operations, topology, and every spatial-statistics operation.

Production databases must receive all numbered migrations through `make github-web`; fresh Compose databases mount the same migration sequence. The test suite uses disposable tmpfs-backed PostGIS containers and never mounts the Enterprise GIS data volume.
