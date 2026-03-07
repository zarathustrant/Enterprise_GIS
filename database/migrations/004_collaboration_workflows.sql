-- Enterprise GIS — Phase 4 Collaboration Workflows

CREATE TABLE IF NOT EXISTS layer_views (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_layer_id UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    name            VARCHAR(120) NOT NULL,
    description     TEXT,
    definition      JSONB NOT NULL DEFAULT '{}'::jsonb,
    field_whitelist JSONB,
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_layer_id, name)
);

CREATE INDEX IF NOT EXISTS idx_layer_views_source ON layer_views(source_layer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_layer_views_public ON layer_views(is_public, created_at DESC);

CREATE TABLE IF NOT EXISTS layer_relationships (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_layer_id       UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    destination_layer_id  UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    origin_field          VARCHAR(64) NOT NULL,
    destination_field     VARCHAR(64) NOT NULL,
    cardinality           VARCHAR(20) NOT NULL DEFAULT 'one_to_many'
                         CHECK (cardinality IN ('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many')),
    name                  VARCHAR(120),
    created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layer_relationships_origin ON layer_relationships(origin_layer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_layer_relationships_destination ON layer_relationships(destination_layer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS edit_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer_id          UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    name              VARCHAR(140) NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'in_review', 'published', 'abandoned')),
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_reviewer UUID REFERENCES users(id) ON DELETE SET NULL,
    notes             TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    submitted_at      TIMESTAMPTZ,
    published_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_edit_sessions_layer ON edit_sessions(layer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edit_sessions_status ON edit_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS edit_session_changes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
    layer_id    UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    feature_id  UUID,
    change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
    geometry    GEOMETRY(Geometry, 4326),
    properties  JSONB DEFAULT '{}',
    version     INTEGER,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edit_session_changes_session ON edit_session_changes(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edit_session_changes_feature ON edit_session_changes(layer_id, feature_id, created_at DESC);
