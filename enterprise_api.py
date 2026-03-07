import json
import uuid
from datetime import datetime
from typing import Any

from flask import Blueprint, Response, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db import get_db
from enterprise_utils import create_async_job, log_audit, serialize_job, serialize_map_view
from features import _apply_join, _fetch_join_definition, _parse_filters, _query_feature_rows
from field_schema import FieldSchemaError, parse_layer_access
from job_queue import enqueue_job

enterprise_bp = Blueprint('enterprise', __name__)


def _owner_required(cur, layer_id: str, user_id: str | None):
    access = parse_layer_access(cur, layer_id, user_id)
    if not access.exists:
        return jsonify({'error': 'Layer not found'}), 404
    if not access.is_owner:
        return jsonify({'error': 'Layer not found or permission denied'}), 404
    return None


def _layer_accessible_with_token(cur, layer_id: str, user_id: str | None, share_token: str | None) -> bool:
    access = parse_layer_access(cur, layer_id, user_id)
    if access.exists:
        return True

    if not share_token:
        return False

    try:
        token = str(uuid.UUID(share_token))
    except ValueError:
        return False

    cur.execute(
        """
        SELECT id
        FROM layer_share_links
        WHERE layer_id = %s::uuid
          AND token = %s::uuid
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1
        """,
        (layer_id, token),
    )
    return cur.fetchone() is not None


# ---------------------------------------------------------------------------
# Vector tiles + tile cache
# ---------------------------------------------------------------------------


@enterprise_bp.route('/layers/<layer_id>/tiles/<int:z>/<int:x>/<int:y>.mvt', methods=['GET'])
@jwt_required(optional=True)
def get_layer_tile(layer_id: str, z: int, x: int, y: int):
    user_id = get_jwt_identity()
    share_token = request.args.get('share_token')
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible_with_token(cur, layer_id, user_id, share_token):
        return jsonify({'error': 'Layer not found'}), 404

    cur.execute(
        """
        SELECT c.mvt, c.etag, c.cached_at, l.updated_at
        FROM layer_tile_cache c
        JOIN layers l ON l.id = c.layer_id
        WHERE c.layer_id = %s::uuid AND c.z = %s AND c.x = %s AND c.y = %s
        """,
        (layer_id, z, x, y),
    )
    cached = cur.fetchone()

    if cached and cached['cached_at'] and cached['updated_at'] and cached['cached_at'] >= cached['updated_at']:
        body = bytes(cached['mvt']) if not isinstance(cached['mvt'], bytes) else cached['mvt']
        response = Response(body, mimetype='application/vnd.mapbox-vector-tile')
        if cached.get('etag'):
            response.headers['ETag'] = cached['etag']
        response.headers['Cache-Control'] = 'public, max-age=60'
        return response

    cur.execute(
        """
        WITH bounds AS (
            SELECT ST_TileEnvelope(%s, %s, %s) AS geom
        ),
        mvtgeom AS (
            SELECT
                f.id,
                f.properties,
                ST_AsMVTGeom(
                    ST_Transform(f.geometry, 3857),
                    bounds.geom,
                    4096,
                    64,
                    true
                ) AS geom
            FROM features f, bounds
            WHERE f.layer_id = %s::uuid
              AND ST_Intersects(ST_Transform(f.geometry, 3857), bounds.geom)
        )
        SELECT ST_AsMVT(mvtgeom, 'features', 4096, 'geom') AS mvt
        FROM mvtgeom
        """,
        (z, x, y, layer_id),
    )
    row = cur.fetchone()
    mvt = bytes(row['mvt']) if row and row.get('mvt') else b''

    etag = uuid.uuid4().hex
    cur.execute(
        """
        INSERT INTO layer_tile_cache (layer_id, z, x, y, mvt, etag, cached_at)
        VALUES (%s::uuid, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (layer_id, z, x, y)
        DO UPDATE SET mvt = EXCLUDED.mvt, etag = EXCLUDED.etag, cached_at = NOW()
        """,
        (layer_id, z, x, y, mvt, etag),
    )
    db.commit()

    response = Response(mvt, mimetype='application/vnd.mapbox-vector-tile')
    response.headers['ETag'] = etag
    response.headers['Cache-Control'] = 'public, max-age=60'
    return response


# ---------------------------------------------------------------------------
# Share links + layer grouping / z-order
# ---------------------------------------------------------------------------


@enterprise_bp.route('/layers/<layer_id>/share-links', methods=['GET'])
@jwt_required()
def list_share_links(layer_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    cur.execute(
        """
        SELECT id, layer_id, token, can_edit, expires_at, created_by, created_at
        FROM layer_share_links
        WHERE layer_id = %s::uuid
        ORDER BY created_at DESC
        """,
        (layer_id,),
    )

    rows = []
    for row in cur.fetchall():
        rows.append({
            'id': str(row['id']),
            'layer_id': str(row['layer_id']),
            'token': str(row['token']),
            'can_edit': row['can_edit'],
            'expires_at': row['expires_at'].isoformat() if row.get('expires_at') else None,
            'created_by': str(row['created_by']) if row.get('created_by') else None,
            'created_at': row['created_at'].isoformat(),
            'url': f"/api/v1/layers/{layer_id}/features?share_token={row['token']}",
        })

    return jsonify(rows)


@enterprise_bp.route('/layers/<layer_id>/share-links', methods=['POST'])
@jwt_required()
def create_share_link(layer_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()

    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    expires_at = data.get('expires_at')
    parsed_expires = None
    if expires_at:
        try:
            parsed_expires = datetime.fromisoformat(str(expires_at).replace('Z', '+00:00'))
        except ValueError:
            return jsonify({'error': 'expires_at must be an ISO datetime'}), 400

    cur.execute(
        """
        INSERT INTO layer_share_links (layer_id, can_edit, expires_at, created_by)
        VALUES (%s::uuid, %s, %s, %s::uuid)
        RETURNING id, layer_id, token, can_edit, expires_at, created_by, created_at
        """,
        (layer_id, bool(data.get('can_edit', False)), parsed_expires, user_id),
    )
    row = cur.fetchone()

    log_audit(
        cur,
        user_id=user_id,
        action='share_link_created',
        entity_type='layer_share_link',
        entity_id=str(row['id']),
        layer_id=layer_id,
    )
    db.commit()

    return jsonify({
        'id': str(row['id']),
        'layer_id': str(row['layer_id']),
        'token': str(row['token']),
        'can_edit': row['can_edit'],
        'expires_at': row['expires_at'].isoformat() if row.get('expires_at') else None,
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'created_at': row['created_at'].isoformat(),
        'url': f"/api/v1/layers/{layer_id}/features?share_token={row['token']}",
    }), 201


@enterprise_bp.route('/layers/<layer_id>/share-links/<share_id>', methods=['DELETE'])
@jwt_required()
def delete_share_link(layer_id: str, share_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    cur.execute(
        'DELETE FROM layer_share_links WHERE id = %s::uuid AND layer_id = %s::uuid RETURNING id',
        (share_id, layer_id),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Share link not found'}), 404

    log_audit(
        cur,
        user_id=user_id,
        action='share_link_deleted',
        entity_type='layer_share_link',
        entity_id=share_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify({'message': 'Share link deleted'})


@enterprise_bp.route('/layers/<layer_id>/ordering', methods=['PUT'])
@jwt_required()
def update_layer_ordering(layer_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()

    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    group_name = str(data.get('group_name', 'Default')).strip() or 'Default'
    try:
        z_index = int(data.get('z_index', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'z_index must be an integer'}), 400

    cur.execute(
        """
        UPDATE layers
        SET group_name = %s,
            z_index = %s,
            updated_at = NOW()
        WHERE id = %s::uuid
        RETURNING id, group_name, z_index
        """,
        (group_name, z_index, layer_id),
    )
    row = cur.fetchone()

    log_audit(
        cur,
        user_id=user_id,
        action='layer_ordering_updated',
        entity_type='layer',
        entity_id=layer_id,
        layer_id=layer_id,
        payload={'group_name': group_name, 'z_index': z_index},
    )
    db.commit()

    return jsonify({
        'id': str(row['id']),
        'group_name': row['group_name'],
        'z_index': row['z_index'],
    })


# ---------------------------------------------------------------------------
# Join/relate definitions
# ---------------------------------------------------------------------------


@enterprise_bp.route('/layers/<layer_id>/joins', methods=['GET'])
@jwt_required(optional=True)
def list_layer_joins(layer_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    access = parse_layer_access(cur, layer_id, user_id)
    if not access.exists:
        return jsonify({'error': 'Layer not found'}), 404

    cur.execute(
        """
        SELECT id, source_layer_id, target_layer_id, source_field, target_field, join_type, name, created_by, created_at, updated_at
        FROM layer_joins
        WHERE source_layer_id = %s::uuid
        ORDER BY created_at DESC
        """,
        (layer_id,),
    )

    rows = []
    for row in cur.fetchall():
        rows.append({
            'id': str(row['id']),
            'source_layer_id': str(row['source_layer_id']),
            'target_layer_id': str(row['target_layer_id']),
            'source_field': row['source_field'],
            'target_field': row['target_field'],
            'join_type': row['join_type'],
            'name': row.get('name'),
            'created_by': str(row['created_by']) if row.get('created_by') else None,
            'created_at': row['created_at'].isoformat(),
            'updated_at': row['updated_at'].isoformat(),
        })

    return jsonify(rows)


@enterprise_bp.route('/layers/<layer_id>/joins', methods=['POST'])
@jwt_required()
def create_layer_join(layer_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    target_layer_id = data.get('target_layer_id')
    source_field = str(data.get('source_field', '')).strip()
    target_field = str(data.get('target_field', '')).strip()
    join_type = str(data.get('join_type', 'left')).strip()
    name = str(data.get('name', '')).strip() or None

    if not target_layer_id or not source_field or not target_field:
        return jsonify({'error': 'target_layer_id, source_field and target_field are required'}), 400
    if join_type not in {'left', 'inner'}:
        return jsonify({'error': 'join_type must be left or inner'}), 400

    db = get_db()
    cur = db.cursor()
    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    target_access = parse_layer_access(cur, str(target_layer_id), user_id)
    if not target_access.exists:
        return jsonify({'error': 'Target layer not found'}), 404

    cur.execute(
        """
        INSERT INTO layer_joins (
            source_layer_id, target_layer_id, source_field, target_field, join_type, name, created_by
        )
        VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::uuid)
        RETURNING id, source_layer_id, target_layer_id, source_field, target_field, join_type, name, created_by, created_at, updated_at
        """,
        (layer_id, target_layer_id, source_field, target_field, join_type, name, user_id),
    )
    row = cur.fetchone()

    log_audit(
        cur,
        user_id=user_id,
        action='layer_join_created',
        entity_type='layer_join',
        entity_id=str(row['id']),
        layer_id=layer_id,
        payload={
            'target_layer_id': str(target_layer_id),
            'source_field': source_field,
            'target_field': target_field,
            'join_type': join_type,
        },
    )
    db.commit()

    return jsonify({
        'id': str(row['id']),
        'source_layer_id': str(row['source_layer_id']),
        'target_layer_id': str(row['target_layer_id']),
        'source_field': row['source_field'],
        'target_field': row['target_field'],
        'join_type': row['join_type'],
        'name': row.get('name'),
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }), 201


@enterprise_bp.route('/layers/<layer_id>/joins/<join_id>', methods=['DELETE'])
@jwt_required()
def delete_layer_join(layer_id: str, join_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    cur.execute(
        'DELETE FROM layer_joins WHERE id = %s::uuid AND source_layer_id = %s::uuid RETURNING id',
        (join_id, layer_id),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Join not found'}), 404

    log_audit(
        cur,
        user_id=user_id,
        action='layer_join_deleted',
        entity_type='layer_join',
        entity_id=join_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify({'message': 'Join deleted'})


# ---------------------------------------------------------------------------
# Saved map views/bookmarks
# ---------------------------------------------------------------------------


@enterprise_bp.route('/views', methods=['GET'])
@jwt_required()
def list_views():
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    cur.execute(
        """
        SELECT id, user_id, name, center_lng, center_lat, zoom, bearing, pitch, created_at, updated_at
        FROM user_map_views
        WHERE user_id = %s::uuid
        ORDER BY updated_at DESC
        """,
        (user_id,),
    )
    return jsonify([serialize_map_view(dict(row)) for row in cur.fetchall()])


@enterprise_bp.route('/views', methods=['POST'])
@jwt_required()
def create_view():
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    name = str(data.get('name', '')).strip()
    center = data.get('center') or {}
    if not name:
        return jsonify({'error': 'name is required'}), 400

    try:
        lng = float(center.get('lng'))
        lat = float(center.get('lat'))
        zoom = float(data.get('zoom'))
        bearing = float(data.get('bearing', 0))
        pitch = float(data.get('pitch', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'center.lng, center.lat and zoom are required numeric values'}), 400

    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO user_map_views (user_id, name, center_lng, center_lat, zoom, bearing, pitch)
        VALUES (%s::uuid, %s, %s, %s, %s, %s, %s)
        RETURNING id, user_id, name, center_lng, center_lat, zoom, bearing, pitch, created_at, updated_at
        """,
        (user_id, name, lng, lat, zoom, bearing, pitch),
    )
    row = dict(cur.fetchone())

    log_audit(
        cur,
        user_id=user_id,
        action='view_created',
        entity_type='map_view',
        entity_id=str(row['id']),
        payload={'name': name, 'center': center, 'zoom': zoom},
    )
    db.commit()
    return jsonify(serialize_map_view(row)), 201


@enterprise_bp.route('/views/<view_id>', methods=['DELETE'])
@jwt_required()
def delete_view(view_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    cur.execute(
        'DELETE FROM user_map_views WHERE id = %s::uuid AND user_id = %s::uuid RETURNING id',
        (view_id, user_id),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'View not found'}), 404

    log_audit(
        cur,
        user_id=user_id,
        action='view_deleted',
        entity_type='map_view',
        entity_id=view_id,
    )
    db.commit()
    return jsonify({'message': 'View deleted'})


# ---------------------------------------------------------------------------
# Async jobs (Redis-backed queue)
# ---------------------------------------------------------------------------


@enterprise_bp.route('/jobs', methods=['GET'])
@jwt_required()
def list_jobs():
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    limit = min(int(request.args.get('limit', 50)), 200)

    cur.execute(
        """
        SELECT id, job_type, status, progress, payload, result, error, created_by, created_at, started_at, finished_at
        FROM async_jobs
        WHERE created_by = %s::uuid
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (user_id, limit),
    )

    return jsonify([serialize_job(dict(row)) for row in cur.fetchall()])


@enterprise_bp.route('/jobs/<job_id>', methods=['GET'])
@jwt_required(optional=True)
def get_job(job_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    if user_id:
        cur.execute(
            """
            SELECT id, job_type, status, progress, payload, result, error, created_by, created_at, started_at, finished_at
            FROM async_jobs
            WHERE id = %s::uuid AND (created_by = %s::uuid OR created_by IS NULL)
            """,
            (job_id, user_id),
        )
    else:
        cur.execute(
            """
            SELECT id, job_type, status, progress, payload, result, error, created_by, created_at, started_at, finished_at
            FROM async_jobs
            WHERE id = %s::uuid
            """,
            (job_id,),
        )

    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Job not found'}), 404

    return jsonify(serialize_job(dict(row)))


@enterprise_bp.route('/jobs', methods=['POST'])
@jwt_required()
def create_job_endpoint():
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    job_type = str(data.get('job_type', '')).strip()
    payload = data.get('payload') or {}

    if job_type not in {'analysis.buffer', 'analysis.intersect', 'analysis.within'}:
        return jsonify({'error': 'Unsupported job_type'}), 400
    if not isinstance(payload, dict):
        return jsonify({'error': 'payload must be an object'}), 400

    db = get_db()
    cur = db.cursor()

    row = create_async_job(cur, job_type=job_type, payload=payload, created_by=user_id)
    queued = enqueue_job(
        current_app.config.get('REDIS_URL', 'redis://localhost:6379/0'),
        current_app.config.get('JOB_QUEUE_NAME', 'enterprise_gis_jobs'),
        str(row['id']),
    )

    log_audit(
        cur,
        user_id=user_id,
        action='job_created',
        entity_type='async_job',
        entity_id=str(row['id']),
        payload={'job_type': job_type, 'queued': queued},
    )
    db.commit()

    return jsonify({
        **serialize_job(row),
        'queued': queued,
    }), 202


# ---------------------------------------------------------------------------
# Frontend telemetry + simple SLO metrics
# ---------------------------------------------------------------------------


@enterprise_bp.route('/telemetry', methods=['POST'])
@jwt_required(optional=True)
def ingest_telemetry():
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    event_type = str(data.get('event_type', '')).strip()
    if not event_type:
        return jsonify({'error': 'event_type is required'}), 400

    event_payload = data.get('event_payload')
    if event_payload is None:
        event_payload = {}

    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO telemetry_events (user_id, event_type, event_payload)
        VALUES (%s::uuid, %s, %s::jsonb)
        """,
        (user_id, event_type, json.dumps(event_payload)),
    )
    db.commit()
    return jsonify({'message': 'telemetry recorded'}), 201


@enterprise_bp.route('/metrics', methods=['GET'])
def metrics_snapshot():
    db = get_db()
    cur = db.cursor()

    cur.execute('SELECT COUNT(*) AS count FROM async_jobs WHERE status = \'queued\'')
    queued_jobs = int(cur.fetchone()['count'])

    cur.execute('SELECT COUNT(*) AS count FROM async_jobs WHERE status = \'running\'')
    running_jobs = int(cur.fetchone()['count'])

    cur.execute(
        """
        SELECT COUNT(*) AS count
        FROM telemetry_events
        WHERE created_at > NOW() - INTERVAL '1 hour'
        """
    )
    telemetry_last_hour = int(cur.fetchone()['count'])

    cur.execute(
        """
        SELECT COUNT(*) AS count
        FROM audit_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        """
    )
    audit_last_day = int(cur.fetchone()['count'])

    return jsonify({
        'queued_jobs': queued_jobs,
        'running_jobs': running_jobs,
        'telemetry_events_last_hour': telemetry_last_hour,
        'audit_events_last_day': audit_last_day,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    })


# ---------------------------------------------------------------------------
# Organizations / Workspaces (RBAC primitives)
# ---------------------------------------------------------------------------


@enterprise_bp.route('/organizations', methods=['GET'])
@jwt_required()
def list_organizations():
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    cur.execute(
        """
        SELECT o.id, o.name, o.created_by, o.created_at, om.role
        FROM organizations o
        JOIN organization_members om ON om.organization_id = o.id
        WHERE om.user_id = %s::uuid
        ORDER BY o.created_at DESC
        """,
        (user_id,),
    )

    rows = []
    for row in cur.fetchall():
        rows.append({
            'id': str(row['id']),
            'name': row['name'],
            'role': row['role'],
            'created_by': str(row['created_by']) if row.get('created_by') else None,
            'created_at': row['created_at'].isoformat(),
        })

    return jsonify(rows)


@enterprise_bp.route('/organizations', methods=['POST'])
@jwt_required()
def create_organization():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    name = str(data.get('name', '')).strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    db = get_db()
    cur = db.cursor()
    cur.execute(
        'INSERT INTO organizations (name, created_by) VALUES (%s, %s::uuid) RETURNING id, name, created_by, created_at',
        (name, user_id),
    )
    org = cur.fetchone()
    cur.execute(
        'INSERT INTO organization_members (organization_id, user_id, role) VALUES (%s::uuid, %s::uuid, %s)',
        (org['id'], user_id, 'owner'),
    )
    db.commit()

    return jsonify({
        'id': str(org['id']),
        'name': org['name'],
        'role': 'owner',
        'created_by': str(org['created_by']) if org.get('created_by') else None,
        'created_at': org['created_at'].isoformat(),
    }), 201


@enterprise_bp.route('/workspaces', methods=['GET'])
@jwt_required()
def list_workspaces():
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        SELECT w.id, w.organization_id, w.name, w.created_by, w.created_at, wm.role
        FROM workspaces w
        JOIN workspace_members wm ON wm.workspace_id = w.id
        WHERE wm.user_id = %s::uuid
        ORDER BY w.created_at DESC
        """,
        (user_id,),
    )

    rows = []
    for row in cur.fetchall():
        rows.append({
            'id': str(row['id']),
            'organization_id': str(row['organization_id']) if row.get('organization_id') else None,
            'name': row['name'],
            'role': row['role'],
            'created_by': str(row['created_by']) if row.get('created_by') else None,
            'created_at': row['created_at'].isoformat(),
        })
    return jsonify(rows)


@enterprise_bp.route('/workspaces', methods=['POST'])
@jwt_required()
def create_workspace():
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    organization_id = data.get('organization_id')
    name = str(data.get('name', '')).strip()

    if not organization_id or not name:
        return jsonify({'error': 'organization_id and name are required'}), 400

    db = get_db()
    cur = db.cursor()

    cur.execute(
        """
        SELECT role
        FROM organization_members
        WHERE organization_id = %s::uuid AND user_id = %s::uuid
        """,
        (organization_id, user_id),
    )
    membership = cur.fetchone()
    if not membership:
        return jsonify({'error': 'Organization not found or permission denied'}), 404

    cur.execute(
        """
        INSERT INTO workspaces (organization_id, name, created_by)
        VALUES (%s::uuid, %s, %s::uuid)
        RETURNING id, organization_id, name, created_by, created_at
        """,
        (organization_id, name, user_id),
    )
    workspace = cur.fetchone()

    cur.execute(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (%s::uuid, %s::uuid, %s)',
        (workspace['id'], user_id, 'owner'),
    )
    db.commit()

    return jsonify({
        'id': str(workspace['id']),
        'organization_id': str(workspace['organization_id']) if workspace.get('organization_id') else None,
        'name': workspace['name'],
        'role': 'owner',
        'created_by': str(workspace['created_by']) if workspace.get('created_by') else None,
        'created_at': workspace['created_at'].isoformat(),
    }), 201


# ---------------------------------------------------------------------------
# Layer Views / Relationships / Edit Sessions (collaboration workflows)
# ---------------------------------------------------------------------------


def _layer_can_write(cur, layer_id: str, user_id: str | None) -> bool:
    if not user_id:
        return False

    access = parse_layer_access(cur, layer_id, user_id)
    if access.is_owner:
        return True

    cur.execute(
        """
        SELECT 1
        FROM workspace_layers wl
        JOIN workspace_members wm ON wm.workspace_id = wl.workspace_id
        WHERE wl.layer_id = %s::uuid
          AND wm.user_id = %s::uuid
          AND wm.role IN ('owner', 'editor', 'admin')
        LIMIT 1
        """,
        (layer_id, user_id),
    )
    return cur.fetchone() is not None


def _serialize_layer_view(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row['id']),
        'source_layer_id': str(row['source_layer_id']),
        'name': row['name'],
        'description': row.get('description'),
        'definition': row.get('definition') or {},
        'field_whitelist': row.get('field_whitelist'),
        'is_public': bool(row.get('is_public')),
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }


def _serialize_relationship(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row['id']),
        'origin_layer_id': str(row['origin_layer_id']),
        'destination_layer_id': str(row['destination_layer_id']),
        'origin_field': row['origin_field'],
        'destination_field': row['destination_field'],
        'cardinality': row['cardinality'],
        'name': row.get('name'),
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }


def _serialize_edit_session(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row['id']),
        'layer_id': str(row['layer_id']),
        'name': row['name'],
        'status': row['status'],
        'notes': row.get('notes'),
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'assigned_reviewer': str(row['assigned_reviewer']) if row.get('assigned_reviewer') else None,
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
        'submitted_at': row['submitted_at'].isoformat() if row.get('submitted_at') else None,
        'published_at': row['published_at'].isoformat() if row.get('published_at') else None,
        'change_count': int(row['change_count']) if row.get('change_count') is not None else 0,
    }


def _serialize_edit_change(row: dict[str, Any]) -> dict[str, Any]:
    geometry = row.get('geometry')
    if isinstance(geometry, str):
        geometry = json.loads(geometry)
    return {
        'id': str(row['id']),
        'session_id': str(row['session_id']),
        'layer_id': str(row['layer_id']),
        'feature_id': str(row['feature_id']) if row.get('feature_id') else None,
        'change_type': row['change_type'],
        'geometry': geometry,
        'properties': row.get('properties') or {},
        'version': row.get('version'),
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'created_at': row['created_at'].isoformat(),
    }


@enterprise_bp.route('/layers/<layer_id>/views', methods=['GET'])
@jwt_required(optional=True)
def list_layer_views(layer_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    access = parse_layer_access(cur, layer_id, user_id)
    if not access.exists:
        return jsonify({'error': 'Layer not found'}), 404

    if user_id:
        cur.execute(
            """
            SELECT id, source_layer_id, name, description, definition, field_whitelist, is_public, created_by, created_at, updated_at
            FROM layer_views
            WHERE source_layer_id = %s::uuid
              AND (is_public = TRUE OR created_by = %s::uuid)
            ORDER BY created_at DESC
            """,
            (layer_id, user_id),
        )
    else:
        cur.execute(
            """
            SELECT id, source_layer_id, name, description, definition, field_whitelist, is_public, created_by, created_at, updated_at
            FROM layer_views
            WHERE source_layer_id = %s::uuid
              AND is_public = TRUE
            ORDER BY created_at DESC
            """,
            (layer_id,),
        )

    return jsonify([_serialize_layer_view(dict(row)) for row in cur.fetchall()])


@enterprise_bp.route('/layers/<layer_id>/views', methods=['POST'])
@jwt_required()
def create_layer_view(layer_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    name = str(data.get('name', '')).strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    definition = data.get('definition') or {}
    if not isinstance(definition, dict):
        return jsonify({'error': 'definition must be an object'}), 400

    field_whitelist = data.get('field_whitelist')
    if field_whitelist is not None:
        if not isinstance(field_whitelist, list) or not all(isinstance(field, str) for field in field_whitelist):
            return jsonify({'error': 'field_whitelist must be an array of strings'}), 400

    db = get_db()
    cur = db.cursor()
    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    cur.execute(
        """
        INSERT INTO layer_views (source_layer_id, name, description, definition, field_whitelist, is_public, created_by)
        VALUES (%s::uuid, %s, %s, %s::jsonb, %s::jsonb, %s, %s::uuid)
        RETURNING id, source_layer_id, name, description, definition, field_whitelist, is_public, created_by, created_at, updated_at
        """,
        (
            layer_id,
            name,
            data.get('description'),
            json.dumps(definition),
            json.dumps(field_whitelist) if field_whitelist is not None else None,
            bool(data.get('is_public', False)),
            user_id,
        ),
    )
    row = dict(cur.fetchone())
    log_audit(
        cur,
        user_id=user_id,
        action='layer_view_created',
        entity_type='layer_view',
        entity_id=str(row['id']),
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(_serialize_layer_view(row)), 201


@enterprise_bp.route('/layers/<layer_id>/views/<view_id>', methods=['PUT'])
@jwt_required()
def update_layer_view(layer_id: str, view_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()

    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    allowed = {'name', 'description', 'definition', 'field_whitelist', 'is_public'}
    unknown = [key for key in data.keys() if key not in allowed]
    if unknown:
        return jsonify({'error': f'Unsupported fields: {unknown}'}), 400

    if 'definition' in data and not isinstance(data.get('definition'), dict):
        return jsonify({'error': 'definition must be an object'}), 400
    if 'field_whitelist' in data:
        fields = data.get('field_whitelist')
        if fields is not None and (not isinstance(fields, list) or not all(isinstance(field, str) for field in fields)):
            return jsonify({'error': 'field_whitelist must be an array of strings'}), 400

    updates = []
    params: list[Any] = []
    if 'name' in data:
        updates.append('name = %s')
        params.append(str(data['name']).strip())
    if 'description' in data:
        updates.append('description = %s')
        params.append(data.get('description'))
    if 'definition' in data:
        updates.append('definition = %s::jsonb')
        params.append(json.dumps(data.get('definition') or {}))
    if 'field_whitelist' in data:
        updates.append('field_whitelist = %s::jsonb')
        params.append(json.dumps(data.get('field_whitelist')) if data.get('field_whitelist') is not None else None)
    if 'is_public' in data:
        updates.append('is_public = %s')
        params.append(bool(data.get('is_public')))

    if not updates:
        return jsonify({'error': 'No valid updates supplied'}), 400

    updates.append('updated_at = NOW()')
    params.extend([layer_id, view_id])

    cur.execute(
        f"""
        UPDATE layer_views
        SET {', '.join(updates)}
        WHERE source_layer_id = %s::uuid
          AND id = %s::uuid
        RETURNING id, source_layer_id, name, description, definition, field_whitelist, is_public, created_by, created_at, updated_at
        """,
        tuple(params),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Layer view not found'}), 404

    log_audit(
        cur,
        user_id=user_id,
        action='layer_view_updated',
        entity_type='layer_view',
        entity_id=view_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(_serialize_layer_view(dict(row)))


@enterprise_bp.route('/layers/<layer_id>/views/<view_id>', methods=['DELETE'])
@jwt_required()
def delete_layer_view(layer_id: str, view_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    cur.execute(
        'DELETE FROM layer_views WHERE source_layer_id = %s::uuid AND id = %s::uuid RETURNING id',
        (layer_id, view_id),
    )
    if not cur.fetchone():
        return jsonify({'error': 'Layer view not found'}), 404

    log_audit(
        cur,
        user_id=user_id,
        action='layer_view_deleted',
        entity_type='layer_view',
        entity_id=view_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify({'message': 'Layer view deleted'})


@enterprise_bp.route('/layer-views/<view_id>/features', methods=['GET'])
@jwt_required(optional=True)
def get_layer_view_features(view_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    cur.execute(
        """
        SELECT id, source_layer_id, name, definition, field_whitelist, is_public, created_by
        FROM layer_views
        WHERE id = %s::uuid
        """,
        (view_id,),
    )
    view = cur.fetchone()
    if not view:
        return jsonify({'error': 'Layer view not found'}), 404

    source_layer_id = str(view['source_layer_id'])
    source_access = parse_layer_access(cur, source_layer_id, user_id)
    if not view['is_public'] and not source_access.exists:
        return jsonify({'error': 'Layer view not found'}), 404

    definition = view.get('definition') or {}
    filters_raw = definition.get('filters')
    join_id = definition.get('join_id')
    sort_cfg = definition.get('sort') or {}
    sort_by = str(sort_cfg.get('field', 'created_at')).strip() or 'created_at'
    sort_dir = str(sort_cfg.get('direction', 'desc')).strip().lower()
    limit = min(max(int(request.args.get('limit', 1000)), 1), 5000)
    offset = max(int(request.args.get('offset', 0)), 0)
    bbox = definition.get('bbox')
    intersects = json.dumps(definition.get('polygon')) if definition.get('polygon') else None

    try:
        filters = _parse_filters(filters_raw)
        rows, total = _query_feature_rows(
            cur,
            layer_id=source_layer_id,
            bbox=bbox,
            intersects=intersects,
            filters=filters,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    except (FieldSchemaError, ValueError) as exc:
        return jsonify({'error': f'Invalid layer view definition: {exc}'}), 400

    join_def = _fetch_join_definition(cur, source_layer_id, join_id)
    rows = _apply_join(cur, rows, join_def)

    whitelist = view.get('field_whitelist')
    if isinstance(whitelist, list):
        allowed = set(str(field) for field in whitelist)
        for row in rows:
            properties = row.get('properties') or {}
            row['properties'] = {
                key: value
                for key, value in properties.items()
                if key in allowed
            }

    features = []
    for row in rows:
        geometry = row.get('geometry')
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        features.append({
            'type': 'Feature',
            'id': str(row['id']),
            'geometry': geometry,
            'properties': row.get('properties') or {},
        })

    return jsonify({
        'type': 'FeatureCollection',
        'features': features,
        'meta': {
            'view_id': str(view['id']),
            'name': view['name'],
            'source_layer_id': source_layer_id,
            'total': total,
            'limit': limit,
            'offset': offset,
        },
    })


@enterprise_bp.route('/layers/<layer_id>/relationships', methods=['GET'])
@jwt_required(optional=True)
def list_layer_relationships(layer_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    access = parse_layer_access(cur, layer_id, user_id)
    if not access.exists:
        return jsonify({'error': 'Layer not found'}), 404

    cur.execute(
        """
        SELECT id, origin_layer_id, destination_layer_id, origin_field, destination_field, cardinality, name, created_by, created_at, updated_at
        FROM layer_relationships
        WHERE origin_layer_id = %s::uuid
        ORDER BY created_at DESC
        """,
        (layer_id,),
    )
    return jsonify([_serialize_relationship(dict(row)) for row in cur.fetchall()])


@enterprise_bp.route('/layers/<layer_id>/relationships', methods=['POST'])
@jwt_required()
def create_layer_relationship(layer_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    destination_layer_id = data.get('destination_layer_id')
    origin_field = str(data.get('origin_field', '')).strip()
    destination_field = str(data.get('destination_field', '')).strip()
    cardinality = str(data.get('cardinality', 'one_to_many')).strip()
    name = str(data.get('name', '')).strip() or None

    if not destination_layer_id or not origin_field or not destination_field:
        return jsonify({'error': 'destination_layer_id, origin_field and destination_field are required'}), 400
    if cardinality not in {'one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'}:
        return jsonify({'error': 'Unsupported cardinality'}), 400

    db = get_db()
    cur = db.cursor()
    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    destination_access = parse_layer_access(cur, str(destination_layer_id), user_id)
    if not destination_access.exists:
        return jsonify({'error': 'Destination layer not found'}), 404

    cur.execute(
        """
        INSERT INTO layer_relationships (
            origin_layer_id, destination_layer_id, origin_field, destination_field, cardinality, name, created_by
        )
        VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::uuid)
        RETURNING id, origin_layer_id, destination_layer_id, origin_field, destination_field, cardinality, name, created_by, created_at, updated_at
        """,
        (layer_id, destination_layer_id, origin_field, destination_field, cardinality, name, user_id),
    )
    row = dict(cur.fetchone())
    log_audit(
        cur,
        user_id=user_id,
        action='layer_relationship_created',
        entity_type='layer_relationship',
        entity_id=str(row['id']),
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(_serialize_relationship(row)), 201


@enterprise_bp.route('/layers/<layer_id>/relationships/<relationship_id>', methods=['DELETE'])
@jwt_required()
def delete_layer_relationship(layer_id: str, relationship_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    denied = _owner_required(cur, layer_id, user_id)
    if denied:
        return denied

    cur.execute(
        """
        DELETE FROM layer_relationships
        WHERE origin_layer_id = %s::uuid
          AND id = %s::uuid
        RETURNING id
        """,
        (layer_id, relationship_id),
    )
    if not cur.fetchone():
        return jsonify({'error': 'Relationship not found'}), 404

    log_audit(
        cur,
        user_id=user_id,
        action='layer_relationship_deleted',
        entity_type='layer_relationship',
        entity_id=relationship_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify({'message': 'Relationship deleted'})


@enterprise_bp.route('/layers/<layer_id>/features/<feature_id>/related', methods=['GET'])
@jwt_required(optional=True)
def list_related_features(layer_id: str, feature_id: str):
    user_id = get_jwt_identity()
    relationship_id = request.args.get('relationship_id')
    if not relationship_id:
        return jsonify({'error': 'relationship_id is required'}), 400

    db = get_db()
    cur = db.cursor()
    origin_access = parse_layer_access(cur, layer_id, user_id)
    if not origin_access.exists:
        return jsonify({'error': 'Layer not found'}), 404

    cur.execute(
        """
        SELECT id, origin_layer_id, destination_layer_id, origin_field, destination_field, cardinality, name
        FROM layer_relationships
        WHERE id = %s::uuid
          AND origin_layer_id = %s::uuid
        """,
        (relationship_id, layer_id),
    )
    relationship = cur.fetchone()
    if not relationship:
        return jsonify({'error': 'Relationship not found'}), 404

    destination_layer_id = str(relationship['destination_layer_id'])
    destination_access = parse_layer_access(cur, destination_layer_id, user_id)
    if not destination_access.exists:
        return jsonify({'error': 'Destination layer not found'}), 404

    cur.execute(
        """
        SELECT properties
        FROM features
        WHERE id = %s::uuid
          AND layer_id = %s::uuid
        """,
        (feature_id, layer_id),
    )
    origin_row = cur.fetchone()
    if not origin_row:
        return jsonify({'error': 'Feature not found'}), 404

    join_value = (origin_row.get('properties') or {}).get(relationship['origin_field'])
    if join_value is None:
        return jsonify({'type': 'FeatureCollection', 'features': [], 'meta': {'count': 0}})

    limit = min(max(int(request.args.get('limit', 200)), 1), 2000)
    cur.execute(
        """
        SELECT id, ST_AsGeoJSON(geometry) AS geometry, properties, version, created_at, updated_at
        FROM features
        WHERE layer_id = %s::uuid
          AND properties ->> %s = %s
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (destination_layer_id, relationship['destination_field'], str(join_value), limit),
    )
    rows = cur.fetchall()

    features = []
    for row in rows:
        features.append({
            'type': 'Feature',
            'id': str(row['id']),
            'geometry': json.loads(row['geometry']) if row.get('geometry') else None,
            'properties': {
                **(row.get('properties') or {}),
                '_version': row['version'],
                '_created_at': row['created_at'].isoformat(),
                '_updated_at': row['updated_at'].isoformat(),
            },
        })

    return jsonify({
        'type': 'FeatureCollection',
        'features': features,
        'meta': {
            'count': len(features),
            'relationship_id': str(relationship['id']),
            'cardinality': relationship['cardinality'],
        },
    })


@enterprise_bp.route('/layers/<layer_id>/sessions', methods=['GET'])
@jwt_required()
def list_edit_sessions(layer_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    if not _layer_can_write(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    cur.execute(
        """
        SELECT s.id, s.layer_id, s.name, s.status, s.notes, s.created_by, s.assigned_reviewer,
               s.created_at, s.updated_at, s.submitted_at, s.published_at,
               COALESCE(c.change_count, 0) AS change_count
        FROM edit_sessions s
        LEFT JOIN (
            SELECT session_id, COUNT(*) AS change_count
            FROM edit_session_changes
            GROUP BY session_id
        ) c ON c.session_id = s.id
        WHERE s.layer_id = %s::uuid
        ORDER BY s.created_at DESC
        """,
        (layer_id,),
    )
    return jsonify([_serialize_edit_session(dict(row)) for row in cur.fetchall()])


@enterprise_bp.route('/layers/<layer_id>/sessions', methods=['POST'])
@jwt_required()
def create_edit_session(layer_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    name = str(data.get('name', '')).strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    db = get_db()
    cur = db.cursor()
    if not _layer_can_write(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    cur.execute(
        """
        INSERT INTO edit_sessions (layer_id, name, notes, created_by, assigned_reviewer)
        VALUES (%s::uuid, %s, %s, %s::uuid, %s::uuid)
        RETURNING id, layer_id, name, status, notes, created_by, assigned_reviewer, created_at, updated_at, submitted_at, published_at
        """,
        (layer_id, name, data.get('notes'), user_id, data.get('assigned_reviewer')),
    )
    row = dict(cur.fetchone())
    row['change_count'] = 0
    log_audit(
        cur,
        user_id=user_id,
        action='edit_session_created',
        entity_type='edit_session',
        entity_id=str(row['id']),
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(_serialize_edit_session(row)), 201


def _load_edit_session(cur, layer_id: str, session_id: str) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT id, layer_id, name, status, notes, created_by, assigned_reviewer, created_at, updated_at, submitted_at, published_at
        FROM edit_sessions
        WHERE id = %s::uuid
          AND layer_id = %s::uuid
        """,
        (session_id, layer_id),
    )
    row = cur.fetchone()
    return dict(row) if row else None


def _can_manage_edit_session(session: dict[str, Any], user_id: str | None) -> bool:
    if not user_id:
        return False
    created_by = str(session['created_by']) if session.get('created_by') else None
    reviewer = str(session['assigned_reviewer']) if session.get('assigned_reviewer') else None
    return user_id == created_by or user_id == reviewer


@enterprise_bp.route('/layers/<layer_id>/sessions/<session_id>/submit', methods=['POST'])
@jwt_required()
def submit_edit_session(layer_id: str, session_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    session = _load_edit_session(cur, layer_id, session_id)
    if not session:
        return jsonify({'error': 'Edit session not found'}), 404
    if not _can_manage_edit_session(session, user_id):
        return jsonify({'error': 'Permission denied'}), 403
    if session['status'] != 'draft':
        return jsonify({'error': 'Only draft sessions can be submitted'}), 400

    cur.execute(
        """
        UPDATE edit_sessions
        SET status = 'in_review',
            submitted_at = NOW(),
            updated_at = NOW()
        WHERE id = %s::uuid
        RETURNING id, layer_id, name, status, notes, created_by, assigned_reviewer, created_at, updated_at, submitted_at, published_at
        """,
        (session_id,),
    )
    row = dict(cur.fetchone())
    row['change_count'] = 0
    log_audit(
        cur,
        user_id=user_id,
        action='edit_session_submitted',
        entity_type='edit_session',
        entity_id=session_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(_serialize_edit_session(row))


@enterprise_bp.route('/layers/<layer_id>/sessions/<session_id>/publish', methods=['POST'])
@jwt_required()
def publish_edit_session(layer_id: str, session_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    session = _load_edit_session(cur, layer_id, session_id)
    if not session:
        return jsonify({'error': 'Edit session not found'}), 404
    if not _can_manage_edit_session(session, user_id):
        return jsonify({'error': 'Permission denied'}), 403
    if session['status'] not in {'draft', 'in_review'}:
        return jsonify({'error': 'Only draft/in_review sessions can be published'}), 400

    cur.execute(
        """
        UPDATE edit_sessions
        SET status = 'published',
            published_at = NOW(),
            updated_at = NOW()
        WHERE id = %s::uuid
        RETURNING id, layer_id, name, status, notes, created_by, assigned_reviewer, created_at, updated_at, submitted_at, published_at
        """,
        (session_id,),
    )
    row = dict(cur.fetchone())
    row['change_count'] = 0
    log_audit(
        cur,
        user_id=user_id,
        action='edit_session_published',
        entity_type='edit_session',
        entity_id=session_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(_serialize_edit_session(row))


@enterprise_bp.route('/layers/<layer_id>/sessions/<session_id>/abandon', methods=['POST'])
@jwt_required()
def abandon_edit_session(layer_id: str, session_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    session = _load_edit_session(cur, layer_id, session_id)
    if not session:
        return jsonify({'error': 'Edit session not found'}), 404
    if not _can_manage_edit_session(session, user_id):
        return jsonify({'error': 'Permission denied'}), 403
    if session['status'] == 'published':
        return jsonify({'error': 'Published sessions cannot be abandoned'}), 400

    cur.execute(
        """
        UPDATE edit_sessions
        SET status = 'abandoned',
            updated_at = NOW()
        WHERE id = %s::uuid
        RETURNING id, layer_id, name, status, notes, created_by, assigned_reviewer, created_at, updated_at, submitted_at, published_at
        """,
        (session_id,),
    )
    row = dict(cur.fetchone())
    row['change_count'] = 0
    log_audit(
        cur,
        user_id=user_id,
        action='edit_session_abandoned',
        entity_type='edit_session',
        entity_id=session_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(_serialize_edit_session(row))


@enterprise_bp.route('/layers/<layer_id>/sessions/<session_id>/changes', methods=['GET'])
@jwt_required()
def list_edit_session_changes(layer_id: str, session_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    if not _layer_can_write(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    session = _load_edit_session(cur, layer_id, session_id)
    if not session:
        return jsonify({'error': 'Edit session not found'}), 404

    cur.execute(
        """
        SELECT id, session_id, layer_id, feature_id, change_type, ST_AsGeoJSON(geometry) AS geometry,
               properties, version, created_by, created_at
        FROM edit_session_changes
        WHERE session_id = %s::uuid
          AND layer_id = %s::uuid
        ORDER BY created_at DESC
        """,
        (session_id, layer_id),
    )
    return jsonify([_serialize_edit_change(dict(row)) for row in cur.fetchall()])
