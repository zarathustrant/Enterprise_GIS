# Catalog, Maps, And Geodatabases

## Implemented Model

Enterprise GIS now separates reusable source data from map presentation:

- `layers` remain authoritative feature-class storage.
- `geodatabases` organize governed data sources.
- `feature_datasets` group feature classes that use one spatial reference.
- `maps` persist basemap, initial view, sharing, settings, and revision state.
- `map_layers` reference source layers and persist drawing order, group membership, visibility, scale range, opacity, styles, labels, pop-ups, and definition filters per map.
- `catalog_favorites` stores user-specific catalog shortcuts.

Removing a `map_layers` row never deletes its source `layers` row or any feature. Deleting source data remains a separate owner-only action.

## User Workflows

### Contents

The Contents tab is driven by the active map document. Users can:

- create, reopen, save, duplicate, rename, share, and delete non-default maps;
- choose an OSM, light, or satellite basemap;
- restore the saved map viewport;
- add map groups and assign layers to them;
- persist visibility and drawing order;
- apply map-specific symbology without changing the shared source style;
- remove a layer reference while preserving its catalog dataset.

### Catalog

The Catalog tab supports:

- Organization, My Content, Shared With Me, and Favorites collections;
- full-text and tag search;
- geometry, lifecycle-status, and geodatabase filters;
- metadata details including CRS, owner, feature count, extent availability, tags, and update time;
- multi-select Add to Map, optionally into a map group;
- personal favorites;
- geodatabase and feature-dataset creation;
- moving owned datasets into geodatabases and feature datasets.

Feature-dataset assignment is rejected when the layer CRS differs from the feature-dataset CRS. The API instructs the user to reproject first rather than silently changing coordinates.

### Create A Geodatabase, Dataset, And Layer

The Catalog tab's **Data storage** section implements the hierarchy directly:

```text
Geodatabase
|- Root layers (use the geodatabase default CRS)
`- Feature dataset (defines one CRS)
   `- Layers / feature classes (must use the feature-dataset CRS)
```

1. Select **New geodatabase**, enter its name and default coordinate system, then create it.
2. The new geodatabase becomes the **Working geodatabase**. This controls where new source data is stored; it does not filter the catalog search results.
3. Either keep **Layer location** at **Geodatabase root**, or select **New dataset** to create a same-CRS feature dataset for related feature classes.
4. Confirm the **Selected location** breadcrumb and coordinate system.
5. Select **New layer here**, enter the feature-class name and geometry type, and optionally add it to the active map.

The **Filter catalog by geodatabase** control is intentionally separate. It only narrows search results and never changes the destination of a create operation.

A feature dataset is not itself a drawable layer and does not hold features directly. It is a schema container for related point, line, or polygon feature classes that need a shared coordinate system, and later can participate in topology, networks, or other controller datasets.

The UI reports both layer count and feature-dataset count for each geodatabase. Feature datasets separately report their contained layer count, avoiding the previous ambiguous `dataset_count` display.

## API Surface

```text
GET/POST          /api/v1/maps
GET/PATCH/DELETE  /api/v1/maps/{map_id}
POST              /api/v1/maps/{map_id}/duplicate
POST              /api/v1/maps/{map_id}/layers
POST              /api/v1/maps/{map_id}/groups
PATCH/DELETE       /api/v1/maps/{map_id}/layers/{map_layer_id}

GET                /api/v1/catalog/items
POST/DELETE        /api/v1/catalog/items/{type}/{id}/favorite

GET/POST           /api/v1/geodatabases
GET/POST           /api/v1/geodatabases/{id}/feature-datasets
```

Map updates support optimistic revision checks. Workspace map writes accept owner, admin, and editor membership; read access continues to use map visibility and workspace membership.

## Migration And Data Safety

Migration `010_catalog_maps_geodatabases.sql` is additive and idempotent:

- it does not move or rewrite feature geometry;
- existing users receive a personal geodatabase and default map;
- existing owned layers receive geodatabase assignments and map references;
- map references copy presentation JSON only, not feature data;
- foreign keys use restrictive or nulling behavior where source preservation matters.

`make github-web` starts only this repository's named Compose services and then runs every migration against Compose service `db`, database `enterprise_gis`, inside container `enterprise-gis-db`. Existing volumes are preserved unless an operator explicitly runs a volume-removal command.

## Verification

- Python syntax compilation covers the new API modules.
- The standard backend unit suite remains green.
- `tests/test_catalog_postgis.py` is guarded to run only when `TEST_DATABASE_URL` contains `enterprise_gis_test`.
- Catalog integration tests cover default maps, references, style overrides, source preservation, search, favorites, geodatabases, groups, and hierarchy-preserving duplication.
- Frontend tests cover new-map and map-properties workflows.
- TypeScript production build and ESLint run successfully.

## Next Governed Catalog Work

1. Geodatabase-scoped domains and assignments.
2. Catalog item details endpoint with field schema, lineage, quality score, and thumbnail generation.
3. Cursor pagination, owner/workspace/tag/date/extent filters, and saved searches.
4. Drag-and-drop Contents tree with nested groups and accessible keyboard reordering.
5. Subtypes, relationship classes, attachments, topology rules, and calculation/constraint rules.
6. Utility-network registration as a geodatabase controller dataset.
7. OGC and ArcGIS service connections with credential storage and health checks.
8. Broken-source diagnosis and repair workflows.
