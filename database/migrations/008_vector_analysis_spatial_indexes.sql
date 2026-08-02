-- Layer-constrained spatial and nearest-neighbor plans need one multicolumn GiST path.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE INDEX IF NOT EXISTS idx_features_layer_geometry_gist
    ON features USING GIST (layer_id, geometry);

CREATE INDEX IF NOT EXISTS idx_features_layer_geography_gist
    ON features USING GIST (layer_id, (geometry::geography));
