-- Enterprise GIS — Phase 3 Enterprise Capabilities

CREATE TABLE IF NOT EXISTS organizations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(150) NOT NULL,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(30) NOT NULL DEFAULT 'member',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         VARCHAR(30) NOT NULL DEFAULT 'viewer',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE layers
    ADD COLUMN IF NOT EXISTS group_name VARCHAR(100) DEFAULT 'Default',
    ADD COLUMN IF NOT EXISTS z_index INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_layers_workspace_id ON layers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_layers_group_z ON layers(group_name, z_index);

CREATE TABLE IF NOT EXISTS workspace_layers (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    layer_id     UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    role         VARCHAR(30) NOT NULL DEFAULT 'viewer',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, layer_id)
);

CREATE TABLE IF NOT EXISTS layer_share_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer_id    UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    token       UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    can_edit    BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at  TIMESTAMPTZ,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layer_share_links_layer_id ON layer_share_links(layer_id);
CREATE INDEX IF NOT EXISTS idx_layer_share_links_token ON layer_share_links(token);

CREATE TABLE IF NOT EXISTS user_map_views (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    center_lng  DOUBLE PRECISION NOT NULL,
    center_lat  DOUBLE PRECISION NOT NULL,
    zoom        DOUBLE PRECISION NOT NULL,
    bearing     DOUBLE PRECISION NOT NULL DEFAULT 0,
    pitch       DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_map_views_user_id ON user_map_views(user_id);

CREATE TABLE IF NOT EXISTS layer_joins (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_layer_id  UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    target_layer_id  UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    source_field     VARCHAR(64) NOT NULL,
    target_field     VARCHAR(64) NOT NULL,
    join_type        VARCHAR(20) NOT NULL DEFAULT 'left' CHECK (join_type IN ('left', 'inner')),
    name             VARCHAR(120),
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layer_joins_source ON layer_joins(source_layer_id);
CREATE INDEX IF NOT EXISTS idx_layer_joins_target ON layer_joins(target_layer_id);

CREATE TABLE IF NOT EXISTS layer_tile_cache (
    layer_id   UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    z          INTEGER NOT NULL,
    x          INTEGER NOT NULL,
    y          INTEGER NOT NULL,
    mvt        BYTEA NOT NULL,
    etag       VARCHAR(128),
    cached_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (layer_id, z, x, y)
);

CREATE TABLE IF NOT EXISTS async_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type    VARCHAR(80) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'error')),
    progress    INTEGER NOT NULL DEFAULT 0,
    payload     JSONB NOT NULL DEFAULT '{}',
    result      JSONB,
    error       TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_async_jobs_status ON async_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_async_jobs_created_by ON async_jobs(created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id   UUID,
    layer_id    UUID REFERENCES layers(id) ON DELETE SET NULL,
    payload     JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_layer ON audit_logs(layer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feature_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id  UUID NOT NULL,
    layer_id    UUID NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    geometry    GEOMETRY(Geometry, 4326),
    properties  JSONB DEFAULT '{}',
    change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('create', 'update', 'delete', 'rollback')),
    changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_history_feature ON feature_history(feature_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_history_layer ON feature_history(layer_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type    VARCHAR(80) NOT NULL,
    event_payload JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_type ON telemetry_events(event_type, created_at DESC);
