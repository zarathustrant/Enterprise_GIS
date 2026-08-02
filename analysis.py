import json
from uuid import UUID
from flask import Blueprint, current_app, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db
from enterprise_utils import create_async_job, log_audit, serialize_job
from job_queue import enqueue_job
from vector_analysis import (
    VectorAnalysisError,
    attach_job_to_run,
    create_analysis_run,
    execute_vector_tool,
    list_tool_specs,
    normalize_environments,
    serialize_analysis_run,
    update_analysis_run,
    validate_tool_parameters,
)

analysis_bp = Blueprint('analysis', __name__)


@analysis_bp.route('/tools', methods=['GET'])
def tools():
    """Return the server-owned vector tool catalogue used by analysis clients."""
    return jsonify({'tools': list_tool_specs()})


@analysis_bp.route('/runs', methods=['GET'])
@jwt_required()
def analysis_runs():
    user_id = get_jwt_identity()
    try:
        limit = max(1, min(int(request.args.get('limit', 50)), 200))
    except ValueError:
        return jsonify({'error': 'limit must be an integer'}), 400

    cur = get_db().cursor()
    cur.execute(
        """
        SELECT * FROM analysis_runs
        WHERE created_by = %s::uuid
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (user_id, limit),
    )
    return jsonify({'runs': [serialize_analysis_run(dict(row)) for row in cur.fetchall()]})


@analysis_bp.route('/runs/<run_id>', methods=['GET'])
@jwt_required()
def analysis_run(run_id):
    try:
        run_id = str(UUID(run_id))
    except ValueError:
        return jsonify({'error': 'Analysis run not found'}), 404
    cur = get_db().cursor()
    cur.execute(
        'SELECT * FROM analysis_runs WHERE id = %s::uuid AND created_by = %s::uuid',
        (run_id, get_jwt_identity()),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Analysis run not found'}), 404
    return jsonify(serialize_analysis_run(dict(row)))


def _serialize_layer(r):
    return {
        'id':            str(r['id']),
        'name':          r['name'],
        'description':   r['description'],
        'geometry_type': r['geometry_type'],
        'crs':           r['crs'],
        'style':         r['style'],
        'min_zoom':      r['min_zoom'],
        'max_zoom':      r['max_zoom'],
        'is_public':     r['is_public'],
        'created_by':    r.get('created_by'),
        'created_at':    r['created_at'].isoformat(),
        'updated_at':    r['updated_at'].isoformat(),
    }


def _check_layer(cur, layer_id, user_id):
    """Return layer row if accessible, else None."""
    cur.execute(
        """
        SELECT l.id, l.name
        FROM layers l
        WHERE l.id = %s::uuid
          AND (
            l.is_public = TRUE
            OR l.created_by = %s::uuid
            OR EXISTS (
              SELECT 1
              FROM workspace_layers wl
              JOIN workspace_members wm ON wm.workspace_id = wl.workspace_id
              WHERE wl.layer_id = l.id
                AND wm.user_id = %s::uuid
            )
          )
        """,
        (layer_id, user_id, user_id)
    )
    return cur.fetchone()


def _new_layer(cur, name, desc, geom_type, user_id):
    """Create output layer and return its id."""
    cur.execute("""
        INSERT INTO layers (name, description, geometry_type, is_public, created_by)
        VALUES (%s, %s, %s, FALSE, %s::uuid)
        RETURNING id
    """, (name, desc, geom_type, user_id))
    return cur.fetchone()['id']


def _fetch_layer_full(cur, layer_id):
    cur.execute("""
        SELECT l.*, u.username AS created_by
        FROM layers l LEFT JOIN users u ON u.id = l.created_by
        WHERE l.id = %s
    """, (layer_id,))
    return cur.fetchone()


# ── Buffer ────────────────────────────────────────────────────────────────────

@analysis_bp.route('/buffer', methods=['POST'])
@jwt_required()
def buffer():
    data = request.get_json() or {}
    user_id = get_jwt_identity()
    try:
        parameters = validate_tool_parameters('buffer', data)
        environments = normalize_environments(data.get('environments'))
    except VectorAnalysisError as exc:
        return jsonify({'error': str(exc)}), 400

    requested_mode = str(data.get('execution_mode', '')).strip().lower()
    run_async = bool(data.get('async')) or request.args.get('async') == 'true'
    if requested_mode in {'asynchronous', 'async'}:
        run_async = True
    elif requested_mode not in {'', 'automatic', 'synchronous', 'sync'}:
        return jsonify({'error': 'execution_mode must be automatic, synchronous, or asynchronous'}), 400
    execution_mode = 'asynchronous' if run_async else ('automatic' if requested_mode == 'automatic' else 'synchronous')

    db = get_db()
    cur = db.cursor()
    src = _check_layer(cur, parameters['layer_id'], user_id)
    if not src:
        return jsonify({'error': 'Source layer not found'}), 404

    run = create_analysis_run(
        cur,
        tool_id='buffer',
        execution_mode=execution_mode,
        parameters=parameters,
        environments=environments,
        input_layer_ids=[parameters['layer_id']],
        created_by=user_id,
        status='queued' if run_async else 'running',
    )
    run_id = str(run['id'])

    if run_async:
        job = create_async_job(
            cur,
            job_type='analysis.buffer',
            payload={
                'analysis_run_id': run_id,
                'tool_id': 'buffer',
                'parameters': parameters,
                'environments': environments,
            },
            created_by=user_id,
        )
        attach_job_to_run(cur, run_id, str(job['id']))
        queued = enqueue_job(
            current_app.config.get('REDIS_URL', 'redis://localhost:6379/0'),
            current_app.config.get('JOB_QUEUE_NAME', 'enterprise_gis_jobs'),
            str(job['id']),
        )
        log_audit(
            cur,
            user_id=user_id,
            action='analysis_buffer_queued',
            entity_type='async_job',
            entity_id=str(job['id']),
            payload={'analysis_run_id': run_id, 'layer_id': parameters['layer_id'], 'queued': queued},
        )
        db.commit()
        run['async_job_id'] = job['id']
        return jsonify({
            **serialize_job(job),
            'queued': queued,
            'analysis_run': serialize_analysis_run(run),
        }), 202

    # Persist the run before execution so a failed transaction cannot erase provenance.
    db.commit()
    try:
        result = execute_vector_tool(
            cur,
            tool_id='buffer',
            parameters=parameters,
            environments=environments,
            created_by=user_id,
            run_id=run_id,
        )
        log_audit(
            cur,
            user_id=user_id,
            action='analysis_buffer_completed',
            entity_type='analysis_run',
            entity_id=run_id,
            layer_id=result['output_layer_ids'][0],
            payload={'source_layer_id': parameters['layer_id'], 'count': result['count']},
        )
        cur.execute('SELECT * FROM analysis_runs WHERE id = %s::uuid', (run_id,))
        completed_run = serialize_analysis_run(dict(cur.fetchone()))
        db.commit()
        return jsonify({
            'layer': result['layer'],
            'count': result['count'],
            'warnings': result['warnings'],
            'analysis_run': completed_run,
        }), 201
    except Exception as exc:
        db.rollback()
        cur = db.cursor()
        update_analysis_run(
            cur,
            run_id,
            status='failed',
            progress=100,
            stage='Failed',
            error=str(exc),
        )
        db.commit()
        status = 400 if isinstance(exc, VectorAnalysisError) else 500
        current_app.logger.exception('Buffer analysis failed run_id=%s', run_id)
        return jsonify({'error': str(exc), 'analysis_run_id': run_id}), status


# ── Intersect ─────────────────────────────────────────────────────────────────

@analysis_bp.route('/intersect', methods=['POST'])
@jwt_required()
def intersect():
    data     = request.get_json() or {}
    layer_a  = data.get('layer_a')
    layer_b  = data.get('layer_b')
    out_name = (data.get('output_name') or 'Intersection').strip()
    user_id  = get_jwt_identity()
    run_async = bool(data.get('async')) or request.args.get('async') == 'true'

    if not layer_a or not layer_b:
        return jsonify({'error': 'layer_a and layer_b are required'}), 400

    db  = get_db()
    cur = db.cursor()

    for lid in (layer_a, layer_b):
        if not _check_layer(cur, lid, user_id):
            return jsonify({'error': f'Layer {lid} not found'}), 404

    if run_async:
        job = create_async_job(
            cur,
            job_type='analysis.intersect',
            payload={'layer_a': layer_a, 'layer_b': layer_b, 'output_name': out_name},
            created_by=user_id,
        )
        queued = enqueue_job(
            current_app.config.get('REDIS_URL', 'redis://localhost:6379/0'),
            current_app.config.get('JOB_QUEUE_NAME', 'enterprise_gis_jobs'),
            str(job['id']),
        )
        log_audit(
            cur,
            user_id=user_id,
            action='analysis_intersect_queued',
            entity_type='async_job',
            entity_id=str(job['id']),
            payload={'layer_a': layer_a, 'layer_b': layer_b, 'queued': queued},
        )
        db.commit()
        return jsonify({**serialize_job(job), 'queued': queued}), 202

    out_id = _new_layer(cur, out_name, 'Spatial intersection', None, user_id)

    cur.execute("""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s,
               ST_Intersection(a.geometry, b.geometry),
               a.properties,
               %s::uuid
        FROM features a
        JOIN features b ON ST_Intersects(a.geometry, b.geometry)
        WHERE a.layer_id = %s
          AND b.layer_id = %s
          AND NOT ST_IsEmpty(ST_Intersection(a.geometry, b.geometry))
    """, (out_id, user_id, layer_a, layer_b))
    count = cur.rowcount
    log_audit(
        cur,
        user_id=user_id,
        action='analysis_intersect_completed',
        entity_type='layer',
        entity_id=str(out_id),
        layer_id=str(out_id),
        payload={'layer_a': layer_a, 'layer_b': layer_b, 'count': count},
    )
    db.commit()

    return jsonify({'layer': _serialize_layer(_fetch_layer_full(cur, out_id)), 'count': count}), 201


# ── Spatial query (features within a polygon) ─────────────────────────────────

@analysis_bp.route('/within', methods=['POST'])
@jwt_required(optional=True)
def within():
    """Return features from a layer that fall within a GeoJSON polygon."""
    data     = request.get_json() or {}
    layer_id = data.get('layer_id')
    polygon  = data.get('polygon')   # GeoJSON geometry object
    user_id  = get_jwt_identity()
    run_async = bool(data.get('async')) or request.args.get('async') == 'true'

    if not layer_id or not polygon:
        return jsonify({'error': 'layer_id and polygon are required'}), 400

    db  = get_db()
    cur = db.cursor()

    if not _check_layer(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404

    if run_async:
        job = create_async_job(
            cur,
            job_type='analysis.within',
            payload={'layer_id': layer_id, 'polygon': polygon},
            created_by=user_id,
        )
        queued = enqueue_job(
            current_app.config.get('REDIS_URL', 'redis://localhost:6379/0'),
            current_app.config.get('JOB_QUEUE_NAME', 'enterprise_gis_jobs'),
            str(job['id']),
        )
        log_audit(
            cur,
            user_id=user_id,
            action='analysis_within_queued',
            entity_type='async_job',
            entity_id=str(job['id']),
            payload={'layer_id': layer_id, 'queued': queued},
        )
        db.commit()
        return jsonify({**serialize_job(job), 'queued': queued}), 202

    cur.execute("""
        SELECT id, ST_AsGeoJSON(geometry) AS geometry, properties
        FROM features
        WHERE layer_id = %s
          AND ST_Within(geometry, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        ORDER BY created_at
    """, (layer_id, json.dumps(polygon)))

    features = [{
        'type':       'Feature',
        'id':         str(r['id']),
        'geometry':   json.loads(r['geometry']),
        'properties': r['properties'],
    } for r in cur.fetchall()]

    if user_id:
        log_audit(
            cur,
            user_id=user_id,
            action='analysis_within_completed',
            entity_type='layer',
            entity_id=str(layer_id),
            layer_id=str(layer_id),
            payload={'count': len(features)},
        )
        db.commit()

    return jsonify({'type': 'FeatureCollection', 'features': features})
