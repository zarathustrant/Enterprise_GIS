import json
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_audit(
    cur,
    *,
    user_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str | None,
    layer_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    cur.execute(
        """
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, layer_id, payload)
        VALUES (%s::uuid, %s, %s, %s::uuid, %s::uuid, %s::jsonb)
        """,
        (
            user_id,
            action,
            entity_type,
            entity_id,
            layer_id,
            json.dumps(payload or {}),
        ),
    )


def add_feature_history(
    cur,
    *,
    feature_id: str,
    layer_id: str,
    version: int,
    geometry_geojson: str | None,
    properties: dict[str, Any] | None,
    change_type: str,
    changed_by: str | None,
) -> None:
    cur.execute(
        """
        INSERT INTO feature_history (
            feature_id, layer_id, version, geometry, properties, change_type, changed_by
        )
        VALUES (
            %s::uuid,
            %s::uuid,
            %s,
            CASE WHEN %s IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) END,
            %s::jsonb,
            %s,
            %s::uuid
        )
        """,
        (
            feature_id,
            layer_id,
            version,
            geometry_geojson,
            geometry_geojson,
            json.dumps(properties or {}),
            change_type,
            changed_by,
        ),
    )


def invalidate_layer_tile_cache(cur, layer_id: str) -> None:
    cur.execute('DELETE FROM layer_tile_cache WHERE layer_id = %s::uuid', (layer_id,))


def create_async_job(cur, *, job_type: str, payload: dict[str, Any], created_by: str | None) -> dict[str, Any]:
    cur.execute(
        """
        INSERT INTO async_jobs (job_type, status, progress, payload, created_by)
        VALUES (%s, 'queued', 0, %s::jsonb, %s::uuid)
        RETURNING id, job_type, status, progress, payload, result, error, created_by, created_at, started_at, finished_at
        """,
        (job_type, json.dumps(payload), created_by),
    )
    return dict(cur.fetchone())


def serialize_job(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row['id']),
        'job_type': row['job_type'],
        'status': row['status'],
        'progress': row['progress'],
        'payload': row.get('payload') or {},
        'result': row.get('result'),
        'error': row.get('error'),
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'created_at': row['created_at'].isoformat() if row.get('created_at') else None,
        'started_at': row['started_at'].isoformat() if row.get('started_at') else None,
        'finished_at': row['finished_at'].isoformat() if row.get('finished_at') else None,
    }


def serialize_map_view(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row['id']),
        'user_id': str(row['user_id']),
        'name': row['name'],
        'center': {'lng': row['center_lng'], 'lat': row['center_lat']},
        'zoom': row['zoom'],
        'bearing': row['bearing'],
        'pitch': row['pitch'],
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }
