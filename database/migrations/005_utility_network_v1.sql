-- Enterprise GIS — Phase 5 Utility Network Foundations

CREATE SCHEMA IF NOT EXISTS utility_network;

CREATE TABLE IF NOT EXISTS utility_network.networks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(140) NOT NULL,
    utility_type  VARCHAR(32) NOT NULL
                 CHECK (utility_type IN (
                    'electric',
                    'water',
                    'wastewater',
                    'stormwater',
                    'gas',
                    'telecom',
                    'district_energy',
                    'other'
                 )),
    description   TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('planning', 'active', 'maintenance', 'retired')),
    is_public     BOOLEAN NOT NULL DEFAULT FALSE,
    workspace_id  UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (created_by, name)
);

CREATE INDEX IF NOT EXISTS idx_utility_networks_workspace
    ON utility_network.networks(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_networks_type
    ON utility_network.networks(utility_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_networks_public
    ON utility_network.networks(is_public, created_at DESC);

CREATE TABLE IF NOT EXISTS utility_network.nodes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id         UUID NOT NULL REFERENCES utility_network.networks(id) ON DELETE CASCADE,
    asset_id           VARCHAR(120),
    name               VARCHAR(140),
    node_type          VARCHAR(40) NOT NULL
                      CHECK (node_type IN (
                        'source',
                        'substation',
                        'transformer',
                        'switch',
                        'valve',
                        'pump',
                        'junction',
                        'meter',
                        'regulator',
                        'tank',
                        'manhole',
                        'service_point',
                        'other'
                      )),
    status             VARCHAR(20) NOT NULL DEFAULT 'in_service'
                      CHECK (status IN ('planned', 'in_service', 'out_of_service', 'maintenance', 'retired')),
    geometry           GEOMETRY(Point, 4326) NOT NULL,
    elevation_m        DOUBLE PRECISION,
    properties         JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_feature_id  UUID REFERENCES features(id) ON DELETE SET NULL,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (network_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_utility_nodes_network
    ON utility_network.nodes(network_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_nodes_type
    ON utility_network.nodes(network_id, node_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_nodes_status
    ON utility_network.nodes(network_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_nodes_geometry
    ON utility_network.nodes USING GIST(geometry);

CREATE TABLE IF NOT EXISTS utility_network.edges (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id         UUID NOT NULL REFERENCES utility_network.networks(id) ON DELETE CASCADE,
    asset_id           VARCHAR(120),
    name               VARCHAR(140),
    edge_type          VARCHAR(40) NOT NULL
                      CHECK (edge_type IN (
                        'feeder',
                        'main',
                        'lateral',
                        'transmission',
                        'distribution',
                        'service_line',
                        'fiber',
                        'coax',
                        'duct',
                        'pipe',
                        'conduit',
                        'other'
                      )),
    status             VARCHAR(20) NOT NULL DEFAULT 'in_service'
                      CHECK (status IN ('planned', 'in_service', 'out_of_service', 'maintenance', 'retired')),
    from_node_id       UUID REFERENCES utility_network.nodes(id) ON DELETE SET NULL,
    to_node_id         UUID REFERENCES utility_network.nodes(id) ON DELETE SET NULL,
    geometry           GEOMETRY(LineString, 4326) NOT NULL,
    length_m           DOUBLE PRECISION,
    properties         JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_feature_id  UUID REFERENCES features(id) ON DELETE SET NULL,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (network_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_utility_edges_network
    ON utility_network.edges(network_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_edges_type
    ON utility_network.edges(network_id, edge_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_edges_status
    ON utility_network.edges(network_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_edges_from_to
    ON utility_network.edges(network_id, from_node_id, to_node_id);
CREATE INDEX IF NOT EXISTS idx_utility_edges_geometry
    ON utility_network.edges USING GIST(geometry);

CREATE TABLE IF NOT EXISTS utility_network.service_points (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id         UUID NOT NULL REFERENCES utility_network.networks(id) ON DELETE CASCADE,
    asset_id           VARCHAR(120),
    name               VARCHAR(140),
    status             VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('planned', 'active', 'inactive', 'disconnected')),
    geometry           GEOMETRY(Point, 4326) NOT NULL,
    node_id            UUID REFERENCES utility_network.nodes(id) ON DELETE SET NULL,
    connected_edge_id  UUID REFERENCES utility_network.edges(id) ON DELETE SET NULL,
    customer_count     INTEGER NOT NULL DEFAULT 0,
    properties         JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_feature_id  UUID REFERENCES features(id) ON DELETE SET NULL,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (network_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_utility_service_points_network
    ON utility_network.service_points(network_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_service_points_status
    ON utility_network.service_points(network_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_service_points_geometry
    ON utility_network.service_points USING GIST(geometry);
