# Vector Data Ingestion

## Scope

The synchronous layer import endpoint accepts vector datasets and appends valid features to an existing target layer:

`POST /api/v1/layers/{layer_id}/upload`

Supported inputs include:

- GeoJSON and JSON
- KML and KMZ, including KMZ archives whose KML is not named `doc.kml`
- zipped Esri Shapefile
- CSV with coordinate columns or WKT geometry
- GeoPackage
- GML and GPX
- FlatGeobuf
- DXF
- SpatiaLite
- zipped FileGDB through GDAL's OpenFileGDB driver
- zipped MapInfo and other vector datasets supported by the installed GDAL/OGR build

Raster imagery, elevation rasters, point clouds, and 3D tiles are deliberately outside this endpoint. GeoTIFF/COG, LAS/LAZ, and 3D formats require dedicated storage, tiling, metadata, and rendering pipelines.

## Coordinate Systems

OGR reads source CRS metadata where the format provides it and transforms geometry to EPSG:4326 before PostGIS insertion. The import form accepts a `source_crs` override such as `EPSG:32632`, `EPSG:26332`, or a valid WKT/PROJ definition.

Use the override when:

- a Shapefile has no `.prj`
- source metadata is known to be incorrect
- CSV coordinates are projected eastings/northings
- a CAD or legacy dataset has no embedded CRS

CSV longitude/latitude files default to EPSG:4326. Treating unknown projected coordinates as longitude/latitude is unsafe; operators must supply the source CRS.

## CSV Geometry

Recognized X columns: `longitude`, `lon`, `lng`, `x`, `easting`.

Recognized Y columns: `latitude`, `lat`, `y`, `northing`.

Recognized WKT columns: `wkt`, `geometry`, `geom`.

Column matching is handled by the GDAL CSV driver. Attribute values then pass through the target layer's field schema, type, nullability, and domain validation.

## Field Schema Inference

When the target layer has no fields and no existing features, import creates field metadata automatically. Types are inferred across the complete source dataset using conservative promotion:

- boolean remains boolean
- integer remains integer
- mixed integer/double becomes double
- mixed or complex values become strings

Invalid database field characters are replaced with underscores, leading digits are prefixed, names are made unique, and the original source name is retained as the field alias. Imported properties are rewritten to the registered field names. The response includes `fields_created` and `field_mapping`.

Populated layers and layers with an explicit schema remain strict: imports must match their existing field definitions. This prevents an upload from silently changing an operational schema.

## Multi-Layer Datasets

GeoPackage, KML, FileGDB, and archives may expose multiple source layers. The optional `source_layer` form field selects one by name. If omitted, the first layer reported by OGR is imported.

A future import-inspection endpoint should expose source layers, schema, CRS, geometry types, and sample rows before committing data.

## Safety And Limits

- maximum upload size: 250 MB
- maximum synchronous feature count: 100,000
- conversion timeout: five minutes
- ZIP/KMZ paths are inspected without unsafe filesystem extraction
- geometry is normalized and validated through the shared PostGIS quality gate
- target geometry family is enforced
- target field schema and domains are enforced
- each failed feature rolls back to a savepoint without affecting valid inserts
- responses include up to 25 row-level diagnostics
- imports invalidate vector-tile cache and write an audit event

Large imports should eventually be moved to the asynchronous job queue with staged validation, progress reporting, cancellation, and an all-or-nothing option.

## Runtime Dependency

The API image installs `gdal-bin`, providing `ogrinfo` for datasource inspection and `ogr2ogr` for conversion and reprojection. Rebuild the API and worker images after changing this dependency.
