-- Cooperative and PostgreSQL-backed cancellation for professional analysis runs.

ALTER TABLE async_jobs DROP CONSTRAINT IF EXISTS async_jobs_status_check;
ALTER TABLE async_jobs ADD CONSTRAINT async_jobs_status_check
    CHECK (status IN ('queued', 'running', 'success', 'error', 'cancelled'));

ALTER TABLE analysis_runs
    ADD COLUMN IF NOT EXISTS worker_backend_pid INTEGER,
    ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_analysis_runs_worker_backend
    ON analysis_runs(worker_backend_pid) WHERE worker_backend_pid IS NOT NULL;
