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

## Buffer Migration

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

## Transaction Guarantees

- A run is committed before synchronous execution, so failures remain visible.
- Tool output and successful run completion are committed atomically.
- Failed worker transactions are rolled back before job and run failures are saved.
- Failed operations do not leave partial output layers.

## Next Migration Order

1. Intersect with field-collision policies and geometry-family inference.
2. Clip and Erase using the shared overlay kernel.
3. Dissolve with grouping fields and aggregate statistics.
4. Spatial Join and Summarize Within with explicit cardinality behavior.
5. Near and nearest-feature tables with geodesic distances.
6. Analysis Workbench UI generated from the registry and run-history APIs.
