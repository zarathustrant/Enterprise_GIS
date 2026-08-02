-- Professional vector analysis framework: durable runs, provenance, and outputs.

CREATE TABLE IF NOT EXISTS analysis_runs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_id                VARCHAR(80) NOT NULL,
    tool_version           INTEGER NOT NULL DEFAULT 1,
    status                 VARCHAR(20) NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    execution_mode         VARCHAR(20) NOT NULL DEFAULT 'synchronous'
                           CHECK (execution_mode IN ('synchronous', 'asynchronous', 'automatic')),
    parameters             JSONB NOT NULL DEFAULT '{}'::jsonb,
    environments           JSONB NOT NULL DEFAULT '{}'::jsonb,
    input_layer_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
    input_layer_revisions  JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_layer_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings               JSONB NOT NULL DEFAULT '[]'::jsonb,
    metrics                JSONB NOT NULL DEFAULT '{}'::jsonb,
    progress               INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    progress_stage         VARCHAR(120),
    error                  TEXT,
    async_job_id           UUID REFERENCES async_jobs(id) ON DELETE SET NULL,
    created_by             UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at             TIMESTAMPTZ,
    finished_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_user
    ON analysis_runs(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_status
    ON analysis_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_tool
    ON analysis_runs(tool_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_job
    ON analysis_runs(async_job_id) WHERE async_job_id IS NOT NULL;
