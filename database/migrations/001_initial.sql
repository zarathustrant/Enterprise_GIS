-- Enterprise GIS — Phase 1 Initial Schema
-- Requires PostgreSQL 14+ with PostGIS extension

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ─── Users & Auth ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(50)  UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN      DEFAULT TRUE,
    created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID    REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Spatial RBAC: restrict users to geographic regions
CREATE TABLE IF NOT EXISTS user_regions (
    id          SERIAL PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    region_name VARCHAR(100) NOT NULL,
    boundary    GEOMETRY(Polygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_regions_boundary
    ON user_regions USING GIST(boundary);

-- ─── Layers ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS layers (
    id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100) NOT NULL,
    description   TEXT,
    geometry_type VARCHAR(50),  -- Point, LineString, Polygon, etc.
    crs           VARCHAR(20)  DEFAULT 'EPSG:4326',
    style         JSONB        DEFAULT '{}',
    min_zoom      INTEGER      DEFAULT 0,
    max_zoom      INTEGER      DEFAULT 22,
    is_public     BOOLEAN      DEFAULT FALSE,
    created_by    UUID         REFERENCES users(id),
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Role-based layer permissions
CREATE TABLE IF NOT EXISTS layer_permissions (
    layer_id  UUID    REFERENCES layers(id) ON DELETE CASCADE,
    role_id   INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    can_read  BOOLEAN DEFAULT TRUE,
    can_write BOOLEAN DEFAULT FALSE,
    can_admin BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (layer_id, role_id)
);

-- ─── Features ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS features (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer_id    UUID REFERENCES layers(id) ON DELETE CASCADE,
    geometry    GEOMETRY(Geometry, 4326) NOT NULL,
    properties  JSONB       DEFAULT '{}',
    version     INTEGER     DEFAULT 1,  -- optimistic locking
    created_by  UUID        REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_layer_id
    ON features(layer_id);

CREATE INDEX IF NOT EXISTS idx_features_geometry
    ON features USING GIST(geometry);

-- ─── Seed Data ────────────────────────────────────────────────────────────────

INSERT INTO roles (name, description) VALUES
    ('admin',  'Full system access'),
    ('editor', 'Create and edit layers and features'),
    ('viewer', 'Read-only access')
ON CONFLICT (name) DO NOTHING;
