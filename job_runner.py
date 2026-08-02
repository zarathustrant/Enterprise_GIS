import json
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.extras

from enterprise_utils import log_audit
from vector_analysis import execute_vector_tool, update_analysis_run


@contextmanager
def get_conn(database_url: str):
    conn = psycopg2.connect(database_url, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        yield conn
    finally:
        conn.close()


def _set_job_status(cur, job_id: str, status: str, progress: int, result: dict[str, Any] | None = None, error: str | None = None):
    if status == 'running':
        cur.execute(
            """
            UPDATE async_jobs
            SET status = %s,
                progress = %s,
                started_at = COALESCE(started_at, NOW())
            WHERE id = %s::uuid
            """,
            (status, progress, job_id),
        )
        return

    cur.execute(
        """
        UPDATE async_jobs
        SET status = %s,
            progress = %s,
            result = %s::jsonb,
            error = %s,
            finished_at = NOW()
        WHERE id = %s::uuid
        """,
        (
            status,
            progress,
            json.dumps(result) if result is not None else None,
            error,
            job_id,
        ),
    )


def _run_within(cur, payload: dict[str, Any]):
    layer_id = payload.get('layer_id')
    polygon = payload.get('polygon')

    cur.execute(
        """
        SELECT COUNT(*) AS count
        FROM features
        WHERE layer_id = %s::uuid
          AND ST_Within(geometry, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        """,
        (layer_id, json.dumps(polygon)),
    )
    count = int(cur.fetchone()['count'])
    return {'count': count}


def process_job(database_url: str, job_id: str) -> bool:
    with get_conn(database_url) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, job_type, status, payload, created_by
            FROM async_jobs
            WHERE id = %s::uuid
            FOR UPDATE
            """,
            (job_id,),
        )
        job = cur.fetchone()
        if not job:
            conn.rollback()
            return False

        if job['status'] not in {'queued', 'running'}:
            conn.rollback()
            return False

        _set_job_status(cur, job_id, 'running', 10)
        conn.commit()

    with get_conn(database_url) as conn:
        cur = conn.cursor()
        cur.execute(
            'SELECT id, job_type, status, payload, created_by FROM async_jobs WHERE id = %s::uuid',
            (job_id,),
        )
        job = cur.fetchone()
        if not job or job['status'] == 'cancelled':
            return False

        job_type = job['job_type']
        payload = job['payload'] or {}
        created_by = str(job['created_by']) if job.get('created_by') else None
        analysis_run_id = payload.get('analysis_run_id')

        if analysis_run_id:
            cur.execute(
                'UPDATE analysis_runs SET worker_backend_pid = pg_backend_pid() WHERE id = %s::uuid',
                (analysis_run_id,),
            )
            # Publish the backend PID so another request can cancel the spatial statement.
            conn.commit()

        try:
            if job_type in {
                'analysis.buffer',
                'analysis.multi_ring_buffer',
                'analysis.intersect',
                'analysis.clip',
                'analysis.erase',
                'analysis.dissolve',
                'analysis.spatial_join',
                'analysis.summarize_within',
                'analysis.near',
                'analysis.polygonize',
                'analysis.geometry_construct',
                'analysis.split_lines_at_points',
                'analysis.merge_layers',
                'analysis.reproject',
                'analysis.geometry_quality',
                'analysis.topology_validate',
                'analysis.spatial_statistics',
            }:
                # New jobs use the structured framework payload; retain old queued jobs.
                parameters = payload.get('parameters') or payload
                environments = payload.get('environments') or {}
                result = execute_vector_tool(
                    cur,
                    tool_id=payload.get('tool_id') or job_type.removeprefix('analysis.'),
                    parameters=parameters,
                    environments=environments,
                    created_by=created_by,
                    run_id=analysis_run_id,
                )
            elif job_type == 'analysis.within':
                result = _run_within(cur, payload)
            else:
                raise ValueError(f'Unsupported job type: {job_type}')

            _set_job_status(cur, job_id, 'success', 100, result=result)
            if analysis_run_id:
                cur.execute(
                    'UPDATE analysis_runs SET worker_backend_pid = NULL WHERE id = %s::uuid',
                    (analysis_run_id,),
                )
            log_audit(
                cur,
                user_id=created_by,
                action='job_completed',
                entity_type='async_job',
                entity_id=job_id,
                payload={'job_type': job_type, 'result': result},
            )
            conn.commit()
            return True
        except Exception as exc:
            # Spatial operations can leave PostgreSQL in an aborted transaction.
            conn.rollback()
            cur = conn.cursor()
            cur.execute('SELECT status FROM async_jobs WHERE id = %s::uuid', (job_id,))
            current_job = cur.fetchone()
            if current_job and current_job['status'] == 'cancelled':
                if analysis_run_id:
                    cur.execute(
                        """UPDATE analysis_runs SET status = 'cancelled', progress = 100,
                           progress_stage = 'Cancelled', worker_backend_pid = NULL,
                           finished_at = COALESCE(finished_at, NOW()) WHERE id = %s::uuid""",
                        (analysis_run_id,),
                    )
                conn.commit()
                return True
            _set_job_status(cur, job_id, 'error', 100, error=str(exc))
            if analysis_run_id:
                update_analysis_run(
                    cur,
                    analysis_run_id,
                    status='failed',
                    progress=100,
                    stage='Failed',
                    error=str(exc),
                    structured_errors=[{
                        'code': 'worker_execution_error',
                        'message': str(exc),
                        'retryable': True,
                    }],
                )
                cur.execute(
                    'UPDATE analysis_runs SET worker_backend_pid = NULL WHERE id = %s::uuid',
                    (analysis_run_id,),
                )
            log_audit(
                cur,
                user_id=created_by,
                action='job_failed',
                entity_type='async_job',
                entity_id=job_id,
                payload={'job_type': job_type, 'error': str(exc)},
            )
            conn.commit()
            return False
