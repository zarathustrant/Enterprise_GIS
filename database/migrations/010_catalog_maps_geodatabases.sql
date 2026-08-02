-- Catalog, geodatabase, and persistent multi-map model.
-- Existing layers remain authoritative feature-class storage.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS geodatabases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    alias           VARCHAR(180),
    description     TEXT,
    database_type   VARCHAR(30) NOT NULL DEFAULT 'enterprise'
                    CHECK (database_type IN ('enterprise', 'project', 'external')),
    default_crs     VARCHAR(64) NOT NULL DEFAULT 'EPSG:4326',
    status          VARCHAR(30) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'read_only', 'archived')),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geodatabases_workspace ON geodatabases(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_geodatabases_owner ON geodatabases(created_by, name);

CREATE TABLE IF NOT EXISTS feature_datasets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geodatabase_id  UUID NOT NULL REFERENCES geodatabases(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    alias           VARCHAR(180),
    description     TEXT,
    crs             VARCHAR(64) NOT NULL DEFAULT 'EPSG:4326',
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (geodatabase_id, name)
);

CREATE INDEX IF NOT EXISTS idx_feature_datasets_geodatabase
    ON feature_datasets(geodatabase_id, name);

ALTER TABLE layers
    ADD COLUMN IF NOT EXISTS geodatabase_id UUID REFERENCES geodatabases(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS feature_dataset_id UUID REFERENCES feature_datasets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS catalog_status VARCHAR(30) NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS thumbnail_key TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS catalog_search TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(description, ''))
    ) STORED;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'layers_catalog_status_check'
    ) THEN
        ALTER TABLE layers ADD CONSTRAINT layers_catalog_status_check
            CHECK (catalog_status IN ('draft', 'authoritative', 'deprecated'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_layers_geodatabase ON layers(geodatabase_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_layers_feature_dataset ON layers(feature_dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_layers_catalog_status ON layers(catalog_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_layers_tags_gin ON layers USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_layers_catalog_search_gin ON layers USING GIN(catalog_search);
CREATE INDEX IF NOT EXISTS idx_layers_name_trgm ON layers USING GIN(name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS maps (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name                VARCHAR(180) NOT NULL,
    description         TEXT,
    basemap             JSONB NOT NULL DEFAULT '{"id":"osm","title":"OpenStreetMap"}',
    initial_view        JSONB NOT NULL DEFAULT '{"center":{"lng":4.5,"lat":8.5},"zoom":6,"bearing":0,"pitch":0}',
    spatial_reference   VARCHAR(64) NOT NULL DEFAULT 'EPSG:4326',
    settings            JSONB NOT NULL DEFAULT '{}',
    thumbnail_key       TEXT,
    is_public           BOOLEAN NOT NULL DEFAULT FALSE,
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    revision            INTEGER NOT NULL DEFAULT 1,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_maps_personal_default
    ON maps(created_by) WHERE is_default = TRUE AND workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_maps_workspace ON maps(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_maps_owner ON maps(created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_maps_name_trgm ON maps USING GIN(name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS map_layers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id              UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    source_layer_id     UUID REFERENCES layers(id) ON DELETE RESTRICT,
    parent_id           UUID REFERENCES map_layers(id) ON DELETE CASCADE,
    layer_kind          VARCHAR(20) NOT NULL DEFAULT 'feature'
                        CHECK (layer_kind IN ('feature', 'group')),
    title               VARCHAR(180) NOT NULL,
    draw_order          INTEGER NOT NULL DEFAULT 0,
    visible             BOOLEAN NOT NULL DEFAULT TRUE,
    min_zoom            DOUBLE PRECISION NOT NULL DEFAULT 0,
    max_zoom            DOUBLE PRECISION NOT NULL DEFAULT 22,
    opacity             DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (opacity >= 0 AND opacity <= 1),
    style_override      JSONB,
    label_override      JSONB,
    popup_config        JSONB NOT NULL DEFAULT '{}',
    definition_filter   JSONB NOT NULL DEFAULT '{}',
    selection_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (layer_kind = 'group' AND source_layer_id IS NULL)
        OR (layer_kind = 'feature' AND source_layer_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_map_layers_map_order ON map_layers(map_id, parent_id, draw_order DESC);
CREATE INDEX IF NOT EXISTS idx_map_layers_source ON map_layers(source_layer_id);

CREATE TABLE IF NOT EXISTS map_bookmarks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id      UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    view_state  JSONB NOT NULL,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_map_bookmarks_map ON map_bookmarks(map_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_favorites (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type   VARCHAR(30) NOT NULL CHECK (item_type IN ('layer', 'map', 'geodatabase')),
    item_id     UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_favorites_user
    ON catalog_favorites(user_id, created_at DESC);

-- Existing personal layers are organized without changing feature storage.
INSERT INTO geodatabases (name, alias, description, database_type, created_by)
SELECT 'My Geodatabase', 'My Geodatabase',
       'Default catalog container created during migration.', 'project', u.id
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM geodatabases g
    WHERE g.created_by = u.id AND g.workspace_id IS NULL AND g.name = 'My Geodatabase'
);

UPDATE layers l
SET geodatabase_id = g.id
FROM geodatabases g
WHERE l.geodatabase_id IS NULL
  AND l.created_by = g.created_by
  AND g.workspace_id IS NULL
  AND g.name = 'My Geodatabase';

-- Existing users receive one personal map; their owned layers are referenced,
-- not copied. Public/shared datasets remain discoverable through Catalog.
INSERT INTO maps (name, description, is_default, created_by)
SELECT 'My Map', 'Default map created during catalog migration.', TRUE, u.id
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM maps m
    WHERE m.created_by = u.id AND m.is_default = TRUE AND m.workspace_id IS NULL
);

INSERT INTO map_layers (
    map_id, source_layer_id, title, draw_order, visible, min_zoom, max_zoom, style_override
)
SELECT m.id, l.id, l.name, l.z_index, TRUE, l.min_zoom, l.max_zoom, l.style
FROM maps m
JOIN layers l ON l.created_by = m.created_by
WHERE m.is_default = TRUE
  AND m.workspace_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM map_layers ml
      WHERE ml.map_id = m.id AND ml.source_layer_id = l.id
  );
