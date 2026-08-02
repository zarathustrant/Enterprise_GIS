# Vector Analysis Framework

## Purpose

Enterprise GIS is evolving from individual spatial endpoints into a consistent vector geoprocessing platform. The Phase 0 framework provides a shared contract for tool discovery, execution environments, durable run history, asynchronous processing, output creation, schema propagation, warnings, metrics, and provenance.

Raster analysis is intentionally deferred. This subsystem currently targets vector feature layers stored in PostGIS with EPSG:4326 geometry.

## Current Foundation

### Tool registry

`vector_analysis.py` owns the server-side catalogue. Each tool declares a stable ID and version, category, geometry compatibility, typed parameters, asynchronous support, and migration status. Clients discover it through `GET /api/v1/analysis/tools`. A tool marked `migrated: false` remains on its legacy endpoint and cannot yet use the shared executor.

### Analysis environments

The initial environment contract supports:

- all-feature or selected-feature scope
- optional coordinate precision-grid snapping
- explicit EPSG:4326 output CRS
- reject-invalid-geometry policy
- preserve-multipart policy

Future phases will add processing extent, output workspace, overwrite policy, Z/M handling, invalid geometry repair, and configurable multipart behavior.

### Durable runs

Migration `006_vector_analysis_framework.sql` adds `analysis_runs`. A migrated execution records normalized inputs, source layer revisions, execution mode, linked async job, progress stage, output layer IDs, warnings, metrics, errors, and lifecycle timestamps.

Run history is user-scoped:

- `GET /api/v1/analysis/runs`
- `GET /api/v1/analysis/runs/{run_id}`

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

## Transaction Guarantees

- A run is committed before synchronous execution, so failures remain visible.
- Tool output and successful run completion are committed atomically.
- Failed worker transactions are rolled back before job and run failures are saved.
- Failed operations do not leave partial output layers.

## Next Migration Order

1. Dissolve with grouping fields and aggregate statistics.
2. Spatial Join and Summarize Within with explicit cardinality behavior.
3. Near and nearest-feature tables with geodesic distances.
4. Analysis Workbench UI generated from the registry and run-history APIs.
