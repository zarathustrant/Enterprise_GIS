# Enterprise GIS Look-Ahead

## Purpose

This roadmap converts the GIS platform critique into implementation gates. The immediate objective is not to add more visible tools. It is to make existing publishing, styling, querying, editing, and utility workflows dependable enough for authoritative spatial data.

## Product position

Enterprise GIS will focus on three defensible strengths:

1. professional web cartography
2. trustworthy collaborative spatial editing
3. operational utility-asset and network workflows

The platform is not attempting to reproduce every ArcGIS Pro capability. New breadth should be accepted only when the workflows below have passed their quality gates.

## Delivery principles

- PostGIS is the authority for persisted geometry and spatial operations.
- The browser may preview an operation, but the server validates the committed result.
- A tool is experimental until coordinate-level tests prove its behavior.
- CRS is explicit metadata, never an unverified assumption.
- Every authoritative edit is atomic, versioned, attributable, and reversible.
- Large-layer workflows are server-query and vector-tile driven.

## Milestone 1: Geometry trust foundation

Outcome: malformed or spatially invalid geometry cannot silently enter the feature store.

Work:

- central server-side geometry validation
- empty and non-finite coordinate rejection
- PostGIS validity reason returned to the client
- geometry-family enforcement after normalization
- validation after snapping and spatial transformations
- fixtures for polygons, holes, multipart features, and invalid rings

Exit gate:

- create and update use the same validation pipeline
- failures are actionable and do not partially mutate data
- automated tests cover valid, empty, malformed, mismatched, and self-intersecting geometry

## Milestone 2: Authoritative advanced editing

Outcome: split, reshape, rotate, and scale produce the geometry indicated by the user's sketch or handles.

Work:

- replace midpoint split fallback with line-based server operation
- return split parts and validation diagnostics before commit
- sketch-based reshape with ring and multipart handling
- projected-coordinate rotate and scale
- preserve holes and multipart structure where mathematically possible
- transactional replacement of source features
- exact undo and redo command records

Exit gate:

- no advanced tool contains a silent fallback
- geometry tests assert part count, area conservation, centroid behavior, and validity
- experimental tools are visibly labelled until their tests pass

## Milestone 3: CRS and measurement integrity

Outcome: imported, displayed, measured, and analyzed data has explicit coordinate-system behavior.

Work:

- source CRS capture during ingestion
- reject ambiguous uploads that require a CRS
- transform rather than relabel coordinates
- define storage, display, and analysis CRS responsibilities
- geodesic/projected measurement policy
- coordinate display and transformation metadata

Exit gate:

- known CRS fixtures round-trip within defined tolerance
- area, length, buffer, and snapping tests cover multiple geographic regions

## Milestone 4: Editing-engine decomposition

Outcome: map interaction behavior is predictable and independently testable.

Work:

- extract map lifecycle and layer registry
- introduce a single interaction state machine
- extract selection, sketch, snapping, cursor, and history controllers
- define command contracts for edits
- keep rendering separate from mutation workflows

Exit gate:

- `MapCanvas` coordinates subsystems instead of implementing them
- only one interaction mode owns pointer behavior at a time
- mode transitions have automated tests

## Milestone 5: Authoritative attribute workflows

Outcome: users can safely query and update large operational datasets.

Work:

- stable server-side pagination, filtering, and sorting
- virtualized table rendering
- transactional bulk updates with preview and failure report
- domain, subtype, and contingent-value validation
- related records and attachments
- map/table selection synchronization

Exit gate:

- workflows are tested at realistic row counts
- bulk changes are atomic and auditable
- sorting or paging never changes row identity or selection unexpectedly

## Milestone 6: Cartographic publishing

Outcome: layers can be published with consistent, reusable, accessible cartography.

Work:

- multilayer symbols and line casing
- scale-dependent symbol overrides
- label classes, priorities, and repeat behavior
- null and other-value categories
- organization symbol/style libraries
- geometry-appropriate legend patches

Exit gate:

- style schemas are versioned and backward compatible
- legends match map evaluation for all renderer types

## Milestone 7: Utility topology

Outcome: Utility Mode advances from asset inventory to operational network analysis.

Work:

- connectivity and association rules
- topology build and dirty-area model
- terminals, barriers, sources, and sinks
- upstream, downstream, connected, and isolation traces
- validation errors as map layers
- outage and affected-service workflows

Exit gate:

- invalid connectivity cannot be published unnoticed
- trace results are deterministic and covered by network fixtures

## Milestone 8: Production operations

Outcome: the platform can be upgraded, observed, backed up, and recovered safely.

Work:

- versioned migration runner
- managed secrets and production configuration
- structured logs, metrics, traces, and job diagnostics
- backup and restore drills
- SSO/OIDC and token revocation
- load, concurrency, and failure testing

Exit gate:

- upgrades work against existing persistent volumes
- recovery objectives are documented and tested
- performance budgets are enforced in CI

## Current implementation slice

Milestone 1 is active. The first change introduces a shared PostGIS-backed geometry quality gate for feature creation and updates. Next, add its database-backed tests and route all ingestion, edit-session publication, history restoration, and utility geometry writes through the same policy.

## Near-term implementation order

1. add geometry validation tests
2. cover restore and session-publication paths
3. implement a validation-only API for edit previews
4. implement authoritative line splitting
5. replace the client split fallback
6. add split geometry fixtures and end-to-end tests
7. establish CRS metadata and ingestion policy
8. begin map interaction subsystem extraction
