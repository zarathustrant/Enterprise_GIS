-- Complete the durable analysis-run contract used by the vector workbench.

ALTER TABLE analysis_runs
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS completed_units BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_units BIGINT,
    ADD COLUMN IF NOT EXISTS structured_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS reproducibility_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_workspace
    ON analysis_runs(workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_runs_organization
    ON analysis_runs(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_runs_reproducibility
    ON analysis_runs(reproducibility_hash) WHERE reproducibility_hash IS NOT NULL;
