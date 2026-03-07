import os
import time

import psycopg2
import psycopg2.extras
from psycopg2 import errors

from job_queue import blocking_pop_job, queue_enabled
from job_runner import process_job


def fallback_claim_job(database_url: str) -> str | None:
    conn = psycopg2.connect(database_url, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                """
                UPDATE async_jobs
                SET status = 'running',
                    progress = 5,
                    started_at = COALESCE(started_at, NOW())
                WHERE id = (
                    SELECT id
                    FROM async_jobs
                    WHERE status = 'queued'
                    ORDER BY created_at
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id
                """
            )
        except errors.UndefinedTable:
            conn.rollback()
            return None
        row = cur.fetchone()
        conn.commit()
        return str(row['id']) if row else None
    finally:
        conn.close()


def main() -> None:
    database_url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@db:5432/enterprise_gis')
    redis_url = os.environ.get('REDIS_URL', 'redis://redis:6379/0')
    queue_name = os.environ.get('JOB_QUEUE_NAME', 'enterprise_gis_jobs')

    print('Worker started. queue_enabled=', queue_enabled(redis_url), 'queue_name=', queue_name, flush=True)

    while True:
        job_id = blocking_pop_job(redis_url, queue_name, timeout_seconds=5)
        if job_id:
            process_job(database_url, job_id)
            continue

        fallback_job = fallback_claim_job(database_url)
        if fallback_job:
            process_job(database_url, fallback_job)
            continue

        time.sleep(1)


if __name__ == '__main__':
    main()
