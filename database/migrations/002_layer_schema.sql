-- Enterprise GIS — Phase 2 Layer Schema & Attribute Metadata

CREATE TABLE IF NOT EXISTS layer_domains (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer_id      UUID        NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    name          VARCHAR(100) NOT NULL,
    description   TEXT,
    domain_type   VARCHAR(20) NOT NULL CHECK (domain_type IN ('codedValue', 'range')),
    coded_values  JSONB,
    min_value     DOUBLE PRECISION,
    max_value     DOUBLE PRECISION,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (layer_id, name),
    UNIQUE (layer_id, id),
    CHECK (
        (
            domain_type = 'codedValue'
            AND coded_values IS NOT NULL
            AND min_value IS NULL
            AND max_value IS NULL
        )
        OR
        (
            domain_type = 'range'
            AND coded_values IS NULL
            AND min_value IS NOT NULL
            AND max_value IS NOT NULL
        )
    ),
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE INDEX IF NOT EXISTS idx_layer_domains_layer_id
    ON layer_domains(layer_id);

CREATE TABLE IF NOT EXISTS layer_fields (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer_id      UUID        NOT NULL,
    name          VARCHAR(64) NOT NULL,
    alias         VARCHAR(128),
    field_type    VARCHAR(20) NOT NULL CHECK (field_type IN ('string', 'integer', 'double', 'boolean', 'date', 'datetime')),
    nullable      BOOLEAN     NOT NULL DEFAULT TRUE,
    default_value JSONB,
    domain_id     UUID,
    length        INTEGER,
    precision     INTEGER,
    scale         INTEGER,
    sort_order    INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (layer_id, name),
    CHECK (name ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
    CHECK (length IS NULL OR length > 0),
    CHECK (precision IS NULL OR precision >= 0),
    CHECK (scale IS NULL OR scale >= 0),
    FOREIGN KEY (layer_id) REFERENCES layers(id) ON DELETE CASCADE,
    FOREIGN KEY (layer_id, domain_id) REFERENCES layer_domains(layer_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_layer_fields_layer_id
    ON layer_fields(layer_id);

CREATE INDEX IF NOT EXISTS idx_layer_fields_domain_id
    ON layer_fields(domain_id);

CREATE INDEX IF NOT EXISTS idx_features_properties_gin
    ON features USING GIN (properties jsonb_path_ops);
