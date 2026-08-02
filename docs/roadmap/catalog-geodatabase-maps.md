# Catalog, Geodatabase, And Multi-Map Architecture

> Implementation status (August 2, 2026): persistent maps, map-layer references,
> per-map styles and visibility, groups/order, catalog search/favorites,
> geodatabases, feature datasets, CRS validation, map management, and safe
> migration backfills are implemented. Governed domains, subtypes, topology,
> attachments, service connections, and broken-source repair remain roadmap work.

## Decision

Enterprise GIS should separate reusable spatial data from map composition.

- **Catalog** discovers and governs reusable items.
- **Geodatabases** organize related datasets and shared data rules.
- **Maps** reference catalog datasets without copying their features.
- **Contents** manages only the layer instances in the active map.

The current `Data Layers` drawer combines these responsibilities. Every accessible layer is queried, displayed in the drawer, and treated as part of one implicit map. That works for a small prototype but does not scale to an organization with hundreds or thousands of datasets and many authored maps.

## ArcGIS Concepts To Adopt

ArcGIS Pro's Catalog pane exposes project, portal, and favorite collections and supports browsing, searching, filtering, previewing, connecting to databases, and adding selected items to maps. Its Contents pane is different: it manages drawing order, visibility, selection, labeling, and data-source grouping for layers already in the active map.

ArcGIS Online follows the same separation. Users search My Content, favorites, groups, the organization, or public catalogs, inspect item details, and explicitly add an item to a map. Once added, its map-layer configuration can be changed without changing the source dataset's default presentation.

An ArcGIS geodatabase is more than a folder. It is a governed container for feature classes, tables, feature datasets, shared domains, relationships, topologies, utility networks, spatial references, indexes, subtypes, and rules. A feature dataset groups related feature classes that share a coordinate system and can participate in controller datasets such as topology or a utility network.

We should adopt these information-model principles without copying ArcGIS terminology where it would misrepresent our implementation.

## Product Vocabulary

| Enterprise GIS term | Meaning |
|---|---|
| Organization | Security and ownership boundary |
| Workspace | Collaborative project boundary with members and roles |
| Geodatabase | Governed logical data container inside a workspace |
| Feature dataset | Thematic and spatial-reference container inside a geodatabase |
| Feature class | Current spatial `layers` dataset and its features/schema |
| Table | Nonspatial records using the same field/domain model |
| Catalog item | Searchable metadata record for a feature class, table, map, service, style, or tool |
| Map | Saved 2D composition with basemap, extent, operational layers, tables, bookmarks, and settings |
| Map layer | A map-specific reference to a catalog dataset with presentation overrides |
| Group layer | A map-only hierarchy node containing map layers or other groups |

The existing database table named `layers` represents feature classes more closely than map layers. It should eventually be renamed or wrapped as `datasets`, but an immediate destructive rename is unnecessary. New APIs can expose it as a dataset while compatibility endpoints continue to work.

## Left Panel Information Architecture

### Persistent shell

The left pane should have two primary tabs:

1. **Contents**
2. **Catalog**

The active map title and save state sit above the tabs:

```text
Kwara Operations Map        Saved
[Contents] [Catalog]
```

### Contents tab

Contents represents only the active map.

Header actions:

- Add data
- New group
- Search current map
- List by drawing order
- List by source
- List by selection
- Collapse all

Tree behavior:

```text
Kwara Operations Map
  Operational layers
    Transport
      Roads
      Bridges
    Boundaries
      LGAs
  Standalone tables
    Inspection Codes
  Basemap
    OpenStreetMap
```

Each map-layer row provides:

- expansion arrow
- geometry-aware symbol patch
- visibility checkbox
- layer title
- scale-range state
- selected-feature count
- warning badge for broken or inaccessible sources
- overflow menu

The overflow menu should contain Open table, Zoom to, Style, Labels, Filter, Pop-ups, Properties, Duplicate, Move to group, and Remove from map. Removing a map layer must never delete its source dataset. Dataset deletion belongs only in Catalog and requires a separate confirmation flow.

Drag and drop changes map-layer order or group membership. This order is stored on the active map, not in the source dataset.

### Catalog tab

Catalog browses reusable content and does not imply map membership.

Top-level collections:

```text
Project
  Maps
  Geodatabases
  Styles
My Content
Favorites
Organization
Shared With Me
External Connections
```

The first implementation can map these to existing ownership and workspace permissions:

- My Content: `created_by = current user`
- Organization: accessible organization/workspace items
- Shared With Me: workspace and direct-share access not owned by the user
- Favorites: user-item favorites
- Project: active workspace items

Catalog controls:

- full-text search
- item-type filter
- geometry filter
- owner filter
- workspace/geodatabase filter
- authoritative/deprecated status
- tags and categories
- modified-date filter
- current-map-extent filter
- list/grid display
- sort by relevance, title, owner, or modified date

Catalog results must load metadata and thumbnails, not every feature collection. Selecting an item opens a details/preview surface with description, owner, geometry, spatial reference, extent, fields, feature count, last update, sharing, quality status, and lineage.

Actions are type-aware:

- Add to current map
- Add to new map
- Open map
- Preview data
- Open item details
- Favorite
- Copy reference
- Export
- Manage, when authorized

### Add Data experience

`Add data` opens Catalog in selection mode rather than a large modal.

1. Search or browse a collection.
2. Select one or many datasets.
3. Inspect details without losing the selection.
4. Choose Add to map.
5. Create map-layer references in one transaction.
6. Keep Catalog open so more data can be added.

Already-added results show a checked state and a Remove action. Search can optionally be constrained to datasets intersecting the current extent. A URL tab can later support GeoJSON, KML, WFS, WMS, WMTS, OGC API Features, vector tiles, and ArcGIS feature services.

## New Map Experience

`New Map` should be a first-class command, not a bookmark operation.

Required inputs:

- title
- workspace/folder
- optional template
- basemap
- initial extent or spatial reference policy

Templates can include Blank map, Editing map, Utility operations map, Analysis map, and organization templates.

Creating a map produces a persistent map record and opens an empty Contents tree. The user then adds catalog layers. Maps support Save, Save As, Duplicate, Rename, Share, Delete, and Open Recent.

The current `user_map_views` table remains useful for bookmarks but is not a map model. Bookmarks belong to a map and should reference `map_id` after migration.

## Persistence Model

### Geodatabase catalog

```sql
geodatabases (
  id, workspace_id, name, alias, description,
  database_type, default_crs, status,
  created_by, created_at, updated_at
)

feature_datasets (
  id, geodatabase_id, name, alias, description,
  crs, created_by, created_at, updated_at
)
```

Add nullable catalog placement to the existing `layers` table:

```sql
layers.geodatabase_id
layers.feature_dataset_id
layers.catalog_status       -- draft, authoritative, deprecated
layers.tags                 -- text[]
layers.thumbnail_key
layers.metadata             -- JSONB for lineage and item details
```

Domains should move toward geodatabase scope. A shared domain can be assigned to fields in multiple feature classes. Existing layer-scoped domains remain valid during migration.

Future governed data-model tables:

- geodatabase domains and field assignments
- subtypes and subtype field defaults/domains
- relationship classes
- topology definitions and rules
- attribute rules
- dataset indexes and constraints
- attachments
- catalog lineage and data-quality status

### Maps and map-layer instances

```sql
maps (
  id, workspace_id, folder_id, name, description,
  basemap, initial_view, spatial_reference,
  settings, thumbnail_key, is_public,
  created_by, created_at, updated_at, revision
)

map_layers (
  id, map_id, source_layer_id, parent_id,
  layer_kind, title, draw_order, visible,
  min_zoom, max_zoom, opacity,
  style_override, label_override, popup_config,
  definition_filter, selection_enabled,
  created_at, updated_at
)

map_tables (
  id, map_id, source_table_id, title, draw_order,
  definition_filter, popup_config
)

map_bookmarks (
  id, map_id, name, view_state, created_by,
  created_at, updated_at
)
```

`map_layers.source_layer_id` is a reference. Features remain stored once. The same source can be added to multiple maps or even multiple times in one map with different filters and styles.

Map-specific style overrides should initially copy the dataset's default style when added. Later changes affect only the map layer unless the user explicitly chooses **Save as dataset default**, which requires dataset-management permission.

## API Shape

Catalog:

```text
GET    /api/v1/catalog/items
GET    /api/v1/catalog/items/{id}
GET    /api/v1/catalog/items/{id}/preview
POST   /api/v1/catalog/items/{id}/favorite
DELETE /api/v1/catalog/items/{id}/favorite
```

Search parameters include `q`, `collection`, `item_type`, `geometry_type`, `workspace_id`, `geodatabase_id`, `owner_id`, `status`, `tags`, `bbox`, `sort`, `cursor`, and `limit`.

Geodatabases:

```text
GET/POST        /api/v1/geodatabases
GET/PATCH/DELETE /api/v1/geodatabases/{id}
GET/POST        /api/v1/geodatabases/{id}/feature-datasets
GET             /api/v1/geodatabases/{id}/items
```

Maps:

```text
GET/POST         /api/v1/maps
GET/PATCH/DELETE /api/v1/maps/{id}
POST             /api/v1/maps/{id}/duplicate
GET/POST          /api/v1/maps/{id}/layers
PATCH/DELETE      /api/v1/maps/{id}/layers/{map_layer_id}
POST              /api/v1/maps/{id}/layers/reorder
```

Bulk add accepts ordered source IDs and returns map-layer instances. Reorder uses an expected map revision for optimistic concurrency.

## Search Architecture

Phase one can use PostgreSQL without an external search service:

- generated `tsvector` over title, description, tags, owner, workspace, and geodatabase
- GIN full-text index
- trigram index for partial names and typo tolerance
- GiST index on a stored item extent for map-area search
- cursor pagination rather than offset for large catalogs
- permission filtering inside the SQL query

Feature search is separate from catalog search. Catalog search finds datasets and maps; map feature search queries configured fields in layers already added to the active map.

## Permission Model

The system must distinguish:

- read dataset
- add dataset to a map
- edit features
- alter schema and shared domains
- manage dataset metadata
- delete dataset
- view map
- edit map composition
- share map

Adding a readable dataset to a map does not grant edit rights. Opening a shared map must re-evaluate access to every source and show a broken-access state without leaking restricted metadata.

## Migration From The Current Application

No existing feature geometry should move during the first implementation.

1. Add catalog metadata, geodatabase, map, and map-layer tables.
2. Create a default workspace geodatabase for existing layers.
3. Create a default map for each user or workspace.
4. Add currently accessible/visible layers to that map as references.
5. Keep existing layer endpoints as compatibility APIs.
6. Change the frontend to query only active-map layers for feature rendering.
7. Introduce Catalog search for all other accessible datasets.
8. Move source-level ordering from `layers.group_name/z_index` to map-layer groups/order.
9. Migrate bookmarks from `user_map_views` to map bookmarks.
10. Deprecate the implicit single-map state only after parity tests pass.

## Implementation Sequence

### Phase 1: Persistent maps and clean separation

1. Migration for `maps`, `map_layers`, and `map_bookmarks`.
2. Map CRUD and map-layer bulk-add/reorder APIs.
3. Default-map backfill without moving feature data.
4. Active-map state and recent-map selector.
5. Contents tab driven exclusively by map-layer instances.
6. New Map and Save As workflows.

### Phase 2: Catalog browser

7. Permission-aware catalog query and details endpoints.
8. Catalog tab with Project, My Content, Organization, Shared, and Favorites.
9. Search, filters, sorting, metadata preview, and pagination.
10. Add Data selection mode and bulk add/remove.
11. Dataset thumbnails and extent preview.
12. Current-map-extent filtering.

### Phase 3: Geodatabase organization

13. Geodatabase and feature-dataset schema/API.
14. Move/create dataset workflows with CRS compatibility validation.
15. Geodatabase-scoped domains and assignments.
16. Catalog tree and item context menus.
17. Authoritative/deprecated lifecycle and metadata completeness checks.

### Phase 4: Governed behavior

18. Subtypes and subtype-specific defaults/domains.
19. Relationship classes and attachment support.
20. Topology definitions/rules tied to feature datasets.
21. Attribute calculation and constraint rules.
22. Utility networks registered as geodatabase controller datasets.

### Phase 5: External catalog connections

23. OGC and ArcGIS service connections.
24. Connection health, credential vaulting, and refresh.
25. Remote layer capability discovery and caching.
26. Broken-source repair and lineage display.

## Acceptance Criteria For The First Release

- Opening a map fetches features only for layers referenced by that map.
- A catalog dataset can exist without being loaded into any map.
- The same dataset can be added to two maps with independent style and visibility.
- Removing a map layer never deletes source data.
- Deleting source data requires catalog-management permission and explicit confirmation.
- Users can create, save, duplicate, rename, share, and reopen maps.
- Users can search catalog items by title, owner, tags, type, geometry, workspace, and extent.
- Users can add multiple catalog results to the active map.
- Drawing order and groups persist per map.
- Existing layers, fields, domains, features, history, audit logs, and utility records survive migration unchanged.

## Source References

- [ArcGIS Pro Catalog pane and catalog view](https://pro.arcgis.com/en/pro-app/3.3/help/projects/catalog-overview.htm)
- [ArcGIS Pro Contents pane](https://pro.arcgis.com/en/pro-app/3.3/help/mapping/map-authoring/contents-pane.htm)
- [ArcGIS geodatabase terminology](https://pro.arcgis.com/en/pro-app/latest/help/data/geodatabases/overview/geodatabase-terminology.htm)
- [ArcGIS feature datasets](https://pro.arcgis.com/en/pro-app/3.3/tool-reference/data-management/create-feature-dataset.htm)
- [ArcGIS geodatabase data design](https://pro.arcgis.com/en/pro-app/latest/help/data/geodatabases/overview/view-and-edit-fields-domains-and-subtypes.htm)
- [ArcGIS Online Browse layers](https://doc.arcgis.com/en/arcgis-online/create-maps/browse-layers.htm)
- [Esri Web Map specification](https://developers.arcgis.com/web-map-specification/objects/webmap/)
