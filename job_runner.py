import json
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.extras

from enterprise_utils import log_audit


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


def _serialize_layer(cur, layer_id: str):
    cur.execute(
        """
        SELECT l.*, u.username AS created_by
        FROM layers l
        LEFT JOIN users u ON u.id = l.created_by
        WHERE l.id = %s::uuid
        """,
        (layer_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        'id': str(row['id']),
        'name': row['name'],
        'description': row['description'],
        'geometry_type': row['geometry_type'],
        'crs': row['crs'],
        'style': row['style'],
        'min_zoom': row['min_zoom'],
        'max_zoom': row['max_zoom'],
        'is_public': row['is_public'],
        'created_by': row.get('created_by'),
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }


def _run_buffer(cur, payload: dict[str, Any], user_id: str | None):
    layer_id = payload.get('layer_id')
    distance = float(payload.get('distance'))
    output_name = (payload.get('output_name') or 'Buffer').strip()

    cur.execute('SELECT id, name FROM layers WHERE id = %s::uuid', (layer_id,))
    source = cur.fetchone()
    if not source:
        raise ValueError('Source layer not found')

    cur.execute(
        """
        INSERT INTO layers (name, description, geometry_type, is_public, created_by)
        VALUES (%s, %s, %s, FALSE, %s::uuid)
        RETURNING id
        """,
        (output_name, f'Buffer {distance} m of "{source["name"]}"', 'Polygon', user_id),
    )
    out_id = str(cur.fetchone()['id'])

    cur.execute(
        """
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               ST_Buffer(geometry::geography, %s)::geometry,
               properties,
               %s::uuid
        FROM features
        WHERE layer_id = %s::uuid
        """,
        (out_id, distance, user_id, layer_id),
    )

    return {
        'layer': _serialize_layer(cur, out_id),
        'count': cur.rowcount,
    }


def _run_intersect(cur, payload: dict[str, Any], user_id: str | None):
    layer_a = payload.get('layer_a')
    layer_b = payload.get('layer_b')
    output_name = (payload.get('output_name') or 'Intersection').strip()

    cur.execute(
        """
        INSERT INTO layers (name, description, geometry_type, is_public, created_by)
        VALUES (%s, %s, %s, FALSE, %s::uuid)
        RETURNING id
        """,
        (output_name, 'Spatial intersection', None, user_id),
    )
    out_id = str(cur.fetchone()['id'])

    cur.execute(
        """
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               ST_Intersection(a.geometry, b.geometry),
               a.properties,
               %s::uuid
        FROM features a
        JOIN features b ON ST_Intersects(a.geometry, b.geometry)
        WHERE a.layer_id = %s::uuid
          AND b.layer_id = %s::uuid
          AND NOT ST_IsEmpty(ST_Intersection(a.geometry, b.geometry))
        """,
        (out_id, user_id, layer_a, layer_b),
    )

    return {
        'layer': _serialize_layer(cur, out_id),
        'count': cur.rowcount,
    }


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
            'SELECT id, job_type, payload, created_by FROM async_jobs WHERE id = %s::uuid',
            (job_id,),
        )
        job = cur.fetchone()
        if not job:
            return False

        job_type = job['job_type']
        payload = job['payload'] or {}
        created_by = str(job['created_by']) if job.get('created_by') else None

        try:
            if job_type == 'analysis.buffer':
                result = _run_buffer(cur, payload, created_by)
            elif job_type == 'analysis.intersect':
                result = _run_intersect(cur, payload, created_by)
            elif job_type == 'analysis.within':
                result = _run_within(cur, payload)
            else:
                raise ValueError(f'Unsupported job type: {job_type}')

            _set_job_status(cur, job_id, 'success', 100, result=result)
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
            _set_job_status(cur, job_id, 'error', 100, error=str(exc))
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
