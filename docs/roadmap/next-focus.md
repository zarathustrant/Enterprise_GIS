# Next Focus: Professional Vector Analysis

## Decision

The active product program is professional vector geoprocessing. Raster storage, raster rendering, Map Algebra, terrain analysis, hydrology, and imagery processing are deferred.

The relevant benchmarks are ArcGIS Pro Analysis, Overlay, Proximity, Data Management, and Spatial Statistics; ArcGIS Online feature analysis; QGIS Processing vector tools; and PostGIS.

This is not a plan to add isolated buttons around SQL statements. The first deliverable is a shared analysis framework that makes every tool consistent, testable, cancellable, traceable, and safe for enterprise data.

## Current Baseline

Implemented:

- geodesic buffer in metres
- pairwise vector intersection
- features-within-polygon query
- output-layer creation for buffer and intersect
- Redis-backed asynchronous job infrastructure
- audit logging
- basic three-tool analysis dialog

Current limitations:

- intersect retains only Layer A attributes
- output geometry and field schemas are not propagated reliably
- synchronous and worker implementations duplicate SQL
- the UI does not currently request asynchronous execution
- analysis progress is lifecycle-based rather than work-based
- there is no reusable tool registry or parameter schema
- there are no processing environments for selection, extent, precision, output CRS, or multipart policy
- no dedicated tests assert analysis geometry, schema, provenance, or rollback behavior
- older documentation overstates density, viewshed, and overlay capabilities

## Engineering Principles

1. PostGIS is the authoritative vector processing engine.
2. Every operation is transactional: output data and metadata succeed or fail together.
3. Inputs are never modified unless a tool explicitly declares in-place behavior.
4. Output geometry type and field schema are computed before execution.
5. Field collisions are resolved deterministically and exposed before the run.
6. Geometry validity, precision, multipart behavior, and empty outputs are explicit policies.
7. Small jobs may run synchronously; large jobs use the existing Redis worker automatically.
8. A tool has one execution implementation shared by synchronous and asynchronous paths.
9. Every run records parameters, input versions, counts, warnings, timing, and outputs.
10. Raster concepts and dependencies are excluded from this program.

## Phase 0: Shared Vector Geoprocessing Framework

Implementation status as of this pass:

- server-owned tool registry and typed parameter metadata implemented
- durable analysis-run migration and user-scoped history endpoints implemented
- initial all/selected scope, precision-grid, and output-CRS environments implemented
- shared output layer, source schema/domain cloning, feature history, warnings, and metrics implemented
- Buffer migrated to one executor for synchronous and worker execution
- safe existing-volume migration target added to `make github-web`
- database-backed geometry equivalence, cancellation, and rollback tests remain before the Phase 0 exit gate is complete

### Tool registry

Create declarative tool specifications containing:

- stable tool identifier and version
- category, title, description, and help
- supported input geometry families
- typed parameter definitions and defaults
- output geometry and schema strategy
- estimated-cost function
- execution handler
- cancellation and progress checkpoints

The API and React workbench must consume the same tool metadata so UI controls cannot drift from backend behavior.

### Analysis run model

Add persistent analysis-run records with:

- tool identifier and implementation version
- user, organization, and workspace context
- input layer IDs and input revision timestamps
- normalized parameters and processing environments
- queued, running, succeeded, failed, and cancelled states
- progress stage, completed units, and total units
- warnings and structured errors
- output layer IDs and feature counts
- start, finish, and elapsed time
- reproducibility and provenance metadata

### Processing environments

Initial vector environments:

- selected features, filtered features, visible extent, or full layer
- output CRS
- precision grid size
- invalid-geometry policy: reject or repair
- multipart policy: preserve or explode
- Z/M handling policy
- output naming and collision behavior
- synchronous/automatic/asynchronous execution mode

### Output service

Centralize:

- output layer creation
- geometry-family assignment
- source and generated field mapping
- field aliases, types, nullability, and ordering
- feature history and audit records
- tile-cache invalidation
- empty-output cleanup
- transaction rollback

### Workbench UI

Replace the three-tab dialog with a compact, map-safe right-side analysis workbench:

- searchable tool catalog grouped by category
- recent and favorite tools
- geometry-aware input selectors
- typed parameter controls
- environment settings drawer
- field-map preview
- estimated feature-pair count and execution mode
- validation summary before Run
- progress, cancellation, warnings, and result actions
- run history with rerun and open-output actions

### Phase 0 exit gate

- buffer runs through the shared framework in both sync and worker modes
- sync and async runs produce equivalent geometries, schemas, and provenance
- cancellation leaves no partial output layer
- output creation and rollback have database-backed tests
- no new tool adds a separate one-off job implementation

## Phase 1: Professional Intersect

Implementation status:

- shared synchronous/worker executor complete
- spatial-index candidate filtering and single materialized intersection calculation complete
- geometry-family inference and explicit component extraction complete
- prefixed Layer A/Layer B schema, domain, and property propagation complete
- source feature IDs, independent selected-input environments, metrics, and warnings complete
- field-map preview, automatic cost-based async selection, sliver controls, and database geometry fixtures remain

Capabilities:

- point, line, and polygon combinations
- pairwise and self-intersection validation
- output type selection where valid
- Layer A and Layer B field propagation
- deterministic field prefixes and collision handling
- selected, filtered, extent, and full-layer inputs
- precision-grid and sliver controls
- empty and lower-dimensional result policy
- automatic async execution above a cost threshold

Correctness requirements:

- spatial indexes participate in candidate selection
- intersection geometry is computed once per candidate pair
- invalid and empty outputs are handled explicitly
- output layer geometry type matches actual results
- source IDs and provenance are retained
- no Cartesian expansion occurs without an estimate and warning

## Phase 2: Clip And Erase

Implementation status:

- shared Clip/Erase polygon-mask kernel complete
- dissolved and per-feature Clip masks complete
- Erase mask union, unaffected-feature retention, and fully removed counts complete
- source schema, domains, styling, geometry family, and provenance propagation complete
- independent input/mask selections, precision grid, sync/worker execution, metrics, and warnings complete
- database area/length conservation fixtures, repair policy, multipart explode mode, and automatic async threshold remain

### Clip

- clip points, lines, and polygons by polygon masks
- dissolve-mask option
- retain source attributes
- preserve or explode multipart outputs
- selected-mask and selected-input support

### Erase

- remove polygon mask areas from input features
- retain unaffected points and line segments correctly
- support dissolved and per-feature masks
- report removed, changed, unchanged, and empty feature counts

Exit gate:

- area and length conservation are tested within precision tolerance
- holes and multipart geometries are preserved
- touching-only cases do not create invalid slivers

## Phase 3: Dissolve

Implementation status:

- dissolve all and multi-field grouping complete
- grouped or excluded null policy complete
- multipart and singlepart output complete
- count, sum, minimum, maximum, mean, first, and last statistics complete
- grouping schema/domain retention and generated statistic schema complete
- selected scope, precision grid, shared worker execution, visual field/statistic builder, metrics, and warnings complete
- database aggregate fixtures, concatenated values, invalid-geometry repair, and bounded staged unions for very large groups remain

Capabilities:

- dissolve all or by one or more fields
- multipart or singlepart output
- statistics: count, sum, minimum, maximum, mean, first, and last
- null grouping policy
- concatenated-value option with limits
- geometry repair and precision controls

Exit gate:

- output schema represents grouping and statistic fields correctly
- group counts and aggregate values match SQL fixtures
- large groups use staged union strategies rather than unbounded memory

## Phase 4: Spatial Join

Implementation status:

- intersects, within, contains, touches, crosses, overlaps, equals, and within-distance predicates complete
- one-to-one deterministic selection with full match count complete
- one-to-many and keep-all/only-matched behavior complete
- prefixed target/join schemas, domains, source provenance, and target geometry retention complete
- selected scopes, geography distance, indexed candidate filtering, cardinality metrics, and visual controls complete
- nearest is assigned to Phase 6; field-map customization, aggregate strategies beyond deterministic first, database fixtures, and query-plan verification remain

Predicates:

- intersects
- within
- contains
- touches
- crosses
- overlaps
- equals
- within distance
- nearest

Output modes:

- one-to-one with aggregation
- one-to-many
- keep all target features or matching targets only
- configurable field map and prefixes

Exit gate:

- join cardinality is estimated and displayed before execution
- nearest joins have deterministic tie behavior
- aggregation and null handling are covered by database tests

## Phase 5: Summarize Within

Capabilities:

- count points, lines, or polygons within polygon zones
- line-length and polygon-area summaries
- grouped summaries by categorical field
- numeric sum, minimum, maximum, mean, and count
- include empty zones
- percentage-of-zone and percentage-of-source measures

Exit gate:

- boundary predicate is explicit
- geographic measurements use a documented geodesic policy
- overlapping zones and multipart inputs have fixtures

## Phase 6: Near And Proximity

Capabilities:

- nearest feature
- N nearest features
- generate near table
- geodesic distance and bearing
- maximum search distance
- self-match exclusion
- point-on-source and point-on-near geometry outputs
- multi-ring buffer as a related tool

Exit gate:

- indexed nearest-neighbor plans are verified
- ties, empty candidates, and antimeridian cases are deterministic
- distances have multi-region accuracy fixtures

## Phase 7: Polygonize Lines

This tool directly supports seismic grids, cadastral boundaries, survey lines, and imported linework.

Capabilities:

- construct polygons from closed line networks
- optional snapping tolerance
- node intersections before polygonization
- preserve holes
- identify dangles, cut edges, and invalid rings
- transfer attributes by source coverage, majority, or spatial join
- diagnostics overlay for linework that did not form polygons

Exit gate:

- closed grids produce expected polygon counts and areas
- gaps beyond tolerance remain diagnostics rather than fabricated polygons
- holes and nested rings are represented correctly
- source lines remain unchanged

## Phase 8: Geometry Construction And Management

Next tool group:

- multipart to singlepart
- feature to point/interior point
- polygon boundaries to lines
- points along lines
- split lines at points
- convex hull
- concave hull
- minimum bounding geometry
- merge and append with field mapping
- project/reproject

## Phase 9: Geometry Quality And Generalization

Next tool group:

- check geometry
- repair geometry
- detect duplicate geometry
- snap and integrate
- overlap and gap validation
- sliver detection and elimination
- simplify
- smooth
- densify
- aggregate polygons

## Phase 10: Vector Spatial Statistics

Deferred until the geoprocessing framework and core vector tools are stable:

- mean and median center
- central feature
- standard distance
- directional distribution
- nearest-neighbor statistics
- spatial autocorrelation
- hot-spot and cluster analysis

## Cross-Cutting Test Matrix

Every tool must cover:

- point, line, polygon, multi-geometry, and geometry collection policy
- empty, null, invalid, self-intersecting, and mixed inputs
- holes and multipart structure
- CRS and antimeridian behavior where applicable
- field-name collisions and type propagation
- selection, filter, extent, and full-layer scopes
- sync/async equivalence
- cancellation and rollback
- unauthorized and read-only access
- large-layer query plans
- deterministic reruns

## Performance Targets

- candidate generation uses spatial indexes
- API memory remains bounded independently of output feature count
- output inserts are batched or set-based
- large operations expose real progress stages
- automatic async thresholds use feature counts, extents, and candidate estimates
- no tool serializes an entire large layer through Flask

## Immediate Implementation Order

1. Tool registry, analysis-run model, output service, and processing environments
2. Migrate Buffer to the framework
3. Rebuild Intersect on the framework
4. Implement Clip
5. Implement Erase
6. Implement Dissolve
7. Implement Spatial Join
8. Implement Summarize Within
9. Implement Near
10. Implement Polygonize Lines

## Parallel Queued Work

Scalable ingestion schema profiling remains queued but does not block vector analysis:

- aggregate property keys and value types in PostgreSQL
- bound memory independently of feature count
- move expensive backfills to Redis workers
- preserve transactional field mapping and migration

Advanced editing, attribute-table refinement, and utility-network workflows remain active maintenance streams. They must consume the shared geometry, field mapping, job, and provenance services where applicable rather than creating parallel infrastructure.
