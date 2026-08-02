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
    get_tool_spec,
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


@analysis_bp.route('/tools/<tool_id>/run', methods=['POST'])
@jwt_required()
def run_catalog_tool(tool_id):
    try:
        spec = get_tool_spec(tool_id)
    except VectorAnalysisError as exc:
        return jsonify({'error': str(exc)}), 404
    if not spec.migrated:
        return jsonify({'error': f'{spec.title} is not available in the shared workbench'}), 400
    data = request.get_json() or {}
    input_names = tuple(
        parameter.name for parameter in spec.parameters
        if parameter.type == 'layer' and data.get(parameter.name)
    )
    return _run_layer_tool(tool_id, data, input_names, f'analysis_{tool_id}')


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


@analysis_bp.route('/runs/<run_id>/cancel', methods=['POST'])
@jwt_required()
def cancel_analysis_run(run_id):
    try:
        run_id = str(UUID(run_id))
    except ValueError:
        return jsonify({'error': 'Analysis run not found'}), 404
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    cur.execute(
        'SELECT * FROM analysis_runs WHERE id = %s::uuid AND created_by = %s::uuid FOR UPDATE',
        (run_id, user_id),
    )
    run = cur.fetchone()
    if not run:
        return jsonify({'error': 'Analysis run not found'}), 404
    if run['status'] not in {'queued', 'running'}:
        return jsonify({'error': f'Only queued or running analysis can be cancelled; current status is {run["status"]}'}), 409
    backend_cancelled = False
    if run.get('worker_backend_pid'):
        cur.execute('SELECT pg_cancel_backend(%s) AS cancelled', (run['worker_backend_pid'],))
        backend_cancelled = bool(cur.fetchone()['cancelled'])
    if run.get('async_job_id'):
        cur.execute(
            """UPDATE async_jobs SET status = 'cancelled', progress = 100,
               error = 'Cancelled by user', finished_at = NOW()
               WHERE id = %s::uuid AND status IN ('queued', 'running')""",
            (str(run['async_job_id']),),
        )
    cur.execute(
        """UPDATE analysis_runs SET status = 'cancelled', progress = 100,
           progress_stage = 'Cancelled', error = NULL, cancellation_requested_at = NOW(),
           finished_at = NOW() WHERE id = %s::uuid RETURNING *""",
        (run_id,),
    )
    cancelled_run = dict(cur.fetchone())
    log_audit(
        cur, user_id=user_id, action='analysis_cancelled', entity_type='analysis_run', entity_id=run_id,
        payload={'async_job_id': str(run['async_job_id']) if run.get('async_job_id') else None, 'backend_cancelled': backend_cancelled},
    )
    db.commit()
    return jsonify(serialize_analysis_run(cancelled_run))


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


def _run_layer_tool(tool_id, data, input_parameter_names, audit_prefix):
    user_id = get_jwt_identity()
    try:
        parameters = validate_tool_parameters(tool_id, data)
        environments = normalize_environments(data.get('environments'))
    except VectorAnalysisError as exc:
        return jsonify({'error': str(exc)}), 400

    requested_mode = str(data.get('execution_mode', '')).strip().lower()
    run_async = bool(data.get('async')) or request.args.get('async') == 'true'
    if requested_mode in {'asynchronous', 'async'}:
        run_async = True
    elif requested_mode not in {'', 'automatic', 'synchronous', 'sync'}:
        return jsonify({'error': 'execution_mode must be automatic, synchronous, or asynchronous'}), 400
    db = get_db()
    cur = db.cursor()
    input_layer_ids = [parameters[name] for name in input_parameter_names]
    for layer_id in input_layer_ids:
        if not _check_layer(cur, layer_id, user_id):
            return jsonify({'error': f'Input layer {layer_id} not found'}), 404

    unique_layer_ids = list(dict.fromkeys(input_layer_ids))
    feature_counts: dict[str, int] = {}
    if unique_layer_ids:
        cur.execute(
            'SELECT layer_id::text AS layer_id, COUNT(*)::integer AS count FROM features '
            'WHERE layer_id = ANY(%s::uuid[]) GROUP BY layer_id',
            (unique_layer_ids,),
        )
        feature_counts = {row['layer_id']: int(row['count']) for row in cur.fetchall()}
    scoped_counts: list[int] = []
    for index, layer_id in enumerate(input_layer_ids):
        scope_name = 'scope_a' if index == 0 else 'scope_b'
        selected_name = 'selected_feature_ids_a' if index == 0 else 'selected_feature_ids_b'
        if environments.get(scope_name) == 'selected':
            scoped_counts.append(len(environments.get(selected_name) or []))
        else:
            scoped_counts.append(feature_counts.get(layer_id, 0))
    maximum_pairs = scoped_counts[0] * scoped_counts[1] if len(scoped_counts) > 1 else 0
    estimated_units = maximum_pairs or sum(scoped_counts)
    environments = {
        **environments,
        'estimated_input_counts': scoped_counts,
        'estimated_candidate_pairs': maximum_pairs,
    }
    if requested_mode == 'automatic':
        feature_threshold = int(current_app.config.get('ANALYSIS_AUTO_ASYNC_FEATURE_THRESHOLD', 50_000))
        pair_threshold = int(current_app.config.get('ANALYSIS_AUTO_ASYNC_PAIR_THRESHOLD', 1_000_000))
        expensive_tools = {'central_feature', 'spatial_autocorrelation', 'hot_spot'}
        expensive_operation = str(parameters.get('operation', '')) in expensive_tools
        run_async = (
            sum(scoped_counts) >= feature_threshold
            or maximum_pairs >= pair_threshold
            or (expensive_operation and estimated_units >= 10_000)
        )
    execution_mode = 'asynchronous' if run_async else (
        'automatic' if requested_mode == 'automatic' else 'synchronous'
    )

    run = create_analysis_run(
        cur,
        tool_id=tool_id,
        execution_mode=execution_mode,
        parameters=parameters,
        environments=environments,
        input_layer_ids=input_layer_ids,
        created_by=user_id,
        status='queued' if run_async else 'running',
    )
    run_id = str(run['id'])

    if run_async:
        job = create_async_job(
            cur,
            job_type=f'analysis.{tool_id}',
            payload={
                'analysis_run_id': run_id,
                'tool_id': tool_id,
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
            action=f'{audit_prefix}_queued',
            entity_type='async_job',
            entity_id=str(job['id']),
            payload={'analysis_run_id': run_id, 'input_layer_ids': input_layer_ids, 'queued': queued},
        )
        db.commit()
        run['async_job_id'] = job['id']
        return jsonify({
            **serialize_job(job),
            'queued': queued,
            'analysis_run': serialize_analysis_run(run),
        }), 202

    # Persist the run independently so execution failures remain discoverable.
    db.commit()
    try:
        result = execute_vector_tool(
            cur,
            tool_id=tool_id,
            parameters=parameters,
            environments=environments,
            created_by=user_id,
            run_id=run_id,
        )
        log_audit(
            cur,
            user_id=user_id,
            action=f'{audit_prefix}_completed',
            entity_type='analysis_run',
            entity_id=run_id,
            layer_id=result['output_layer_ids'][0],
            payload={'input_layer_ids': input_layer_ids, 'count': result['count']},
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
            structured_errors=[{
                'code': 'validation_error' if isinstance(exc, VectorAnalysisError) else 'execution_error',
                'message': str(exc),
                'retryable': not isinstance(exc, VectorAnalysisError),
            }],
        )
        db.commit()
        status = 400 if isinstance(exc, VectorAnalysisError) else 500
        current_app.logger.exception('%s failed run_id=%s', audit_prefix, run_id)
        return jsonify({'error': str(exc), 'analysis_run_id': run_id}), status


# ── Buffer ────────────────────────────────────────────────────────────────────

@analysis_bp.route('/buffer', methods=['POST'])
@jwt_required()
def buffer():
    return _run_layer_tool(
        'buffer',
        request.get_json() or {},
        ('layer_id',),
        'analysis_buffer',
    )


@analysis_bp.route('/multi-ring-buffer', methods=['POST'])
@jwt_required()
def multi_ring_buffer():
    return _run_layer_tool(
        'multi_ring_buffer',
        request.get_json() or {},
        ('layer_id',),
        'analysis_multi_ring_buffer',
    )


# ── Intersect ─────────────────────────────────────────────────────────────────

@analysis_bp.route('/intersect', methods=['POST'])
@jwt_required()
def intersect():
    return _run_layer_tool(
        'intersect',
        request.get_json() or {},
        ('layer_a', 'layer_b'),
        'analysis_intersect',
    )


# ── Clip / Erase ──────────────────────────────────────────────────────────────

@analysis_bp.route('/clip', methods=['POST'])
@jwt_required()
def clip():
    return _run_layer_tool(
        'clip',
        request.get_json() or {},
        ('input_layer', 'mask_layer'),
        'analysis_clip',
    )


@analysis_bp.route('/erase', methods=['POST'])
@jwt_required()
def erase():
    return _run_layer_tool(
        'erase',
        request.get_json() or {},
        ('input_layer', 'mask_layer'),
        'analysis_erase',
    )


# ── Dissolve ──────────────────────────────────────────────────────────────────

@analysis_bp.route('/dissolve', methods=['POST'])
@jwt_required()
def dissolve():
    return _run_layer_tool(
        'dissolve',
        request.get_json() or {},
        ('layer_id',),
        'analysis_dissolve',
    )


# ── Spatial Join ──────────────────────────────────────────────────────────────

@analysis_bp.route('/spatial-join', methods=['POST'])
@jwt_required()
def spatial_join():
    return _run_layer_tool(
        'spatial_join',
        request.get_json() or {},
        ('target_layer', 'join_layer'),
        'analysis_spatial_join',
    )


# ── Summarize Within ──────────────────────────────────────────────────────────

@analysis_bp.route('/summarize-within', methods=['POST'])
@jwt_required()
def summarize_within():
    return _run_layer_tool(
        'summarize_within',
        request.get_json() or {},
        ('zone_layer', 'summary_layer'),
        'analysis_summarize_within',
    )


# ── Near / Proximity ─────────────────────────────────────────────────────────

@analysis_bp.route('/near', methods=['POST'])
@jwt_required()
def near():
    return _run_layer_tool(
        'near',
        request.get_json() or {},
        ('source_layer', 'near_layer'),
        'analysis_near',
    )


# ── Polygonize Lines ─────────────────────────────────────────────────────────

@analysis_bp.route('/polygonize', methods=['POST'])
@jwt_required()
def polygonize():
    return _run_layer_tool(
        'polygonize',
        request.get_json() or {},
        ('line_layer',),
        'analysis_polygonize',
    )


@analysis_bp.route('/geometry-construct', methods=['POST'])
@jwt_required()
def geometry_construct():
    return _run_layer_tool('geometry_construct', request.get_json() or {}, ('layer_id',), 'analysis_geometry_construct')


@analysis_bp.route('/split-lines-at-points', methods=['POST'])
@jwt_required()
def split_lines_at_points():
    return _run_layer_tool(
        'split_lines_at_points', request.get_json() or {}, ('line_layer', 'point_layer'),
        'analysis_split_lines_at_points',
    )


@analysis_bp.route('/merge-layers', methods=['POST'])
@jwt_required()
def merge_layers():
    return _run_layer_tool(
        'merge_layers', request.get_json() or {}, ('layer_a', 'layer_b'), 'analysis_merge_layers'
    )


@analysis_bp.route('/reproject', methods=['POST'])
@jwt_required()
def reproject():
    return _run_layer_tool('reproject', request.get_json() or {}, ('layer_id',), 'analysis_reproject')


@analysis_bp.route('/geometry-quality', methods=['POST'])
@jwt_required()
def geometry_quality():
    return _run_layer_tool('geometry_quality', request.get_json() or {}, ('layer_id',), 'analysis_geometry_quality')


@analysis_bp.route('/topology-validate', methods=['POST'])
@jwt_required()
def topology_validate():
    data = request.get_json() or {}
    input_names = ('polygon_layer', 'coverage_layer') if data.get('coverage_layer') else ('polygon_layer',)
    return _run_layer_tool('topology_validate', data, input_names, 'analysis_topology_validate')


@analysis_bp.route('/spatial-statistics', methods=['POST'])
@jwt_required()
def spatial_statistics():
    return _run_layer_tool(
        'spatial_statistics', request.get_json() or {}, ('layer_id',), 'analysis_spatial_statistics'
    )


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
