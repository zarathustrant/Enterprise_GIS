import json
import uuid
from typing import Any

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db import get_db
from enterprise_utils import add_feature_history, invalidate_layer_tile_cache, log_audit
from field_schema import FieldSchemaError, parse_layer_access, validate_properties_against_schema

features_bp = Blueprint('features', __name__)


def _layer_accessible(cur, layer_id: str, user_id: str | None, share_token: str | None = None) -> bool:
    access = parse_layer_access(cur, layer_id, user_id)
    if access.exists:
        return True

    if not share_token:
        return False

    try:
        normalized_share_token = str(uuid.UUID(str(share_token)))
    except (ValueError, TypeError):
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
        (layer_id, normalized_share_token),
    )
    return cur.fetchone() is not None


def _layer_can_write(cur, layer_id: str, user_id: str) -> bool:
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


def _extract_session_id(payload: dict[str, Any] | None = None) -> str | None:
    raw_session_id = payload.get('session_id') if payload else None
    if raw_session_id is None:
        raw_session_id = request.args.get('session_id')
    if raw_session_id in (None, ''):
        return None

    try:
        return str(uuid.UUID(str(raw_session_id)))
    except (ValueError, TypeError) as exc:
        raise FieldSchemaError('session_id must be a valid UUID') from exc


def _resolve_edit_session_for_change(
    cur,
    *,
    layer_id: str,
    user_id: str,
    payload: dict[str, Any] | None = None,
) -> str | None:
    session_id = _extract_session_id(payload)
    if not session_id:
        return None

    cur.execute(
        """
        SELECT id, status, created_by, assigned_reviewer
        FROM edit_sessions
        WHERE id = %s::uuid
          AND layer_id = %s::uuid
        """,
        (session_id, layer_id),
    )
    session = cur.fetchone()
    if not session:
        raise FieldSchemaError('Edit session not found for this layer')

    status = session['status']
    if status in {'published', 'abandoned'}:
        raise FieldSchemaError('Cannot add changes to a published or abandoned edit session')

    created_by = str(session['created_by']) if session.get('created_by') else None
    assigned_reviewer = str(session['assigned_reviewer']) if session.get('assigned_reviewer') else None

    if created_by and user_id not in {created_by, assigned_reviewer}:
        access = parse_layer_access(cur, layer_id, user_id)
        if not access.is_owner:
            raise FieldSchemaError('You are not assigned to this edit session')

    return session_id


def _record_edit_session_change(
    cur,
    *,
    session_id: str | None,
    layer_id: str,
    feature_id: str | None,
    change_type: str,
    geometry_geojson: Any,
    properties: dict[str, Any] | None,
    version: int | None,
    created_by: str,
) -> None:
    if not session_id:
        return

    geometry_json: str | None = None
    if geometry_geojson is not None:
        if isinstance(geometry_geojson, str):
            try:
                json.loads(geometry_geojson)
            except json.JSONDecodeError as exc:
                raise FieldSchemaError('Invalid geometry JSON for edit session change') from exc
            geometry_json = geometry_geojson
        else:
            geometry_json = json.dumps(geometry_geojson)

    cur.execute(
        """
        INSERT INTO edit_session_changes (
            session_id, layer_id, feature_id, change_type, geometry, properties, version, created_by
        )
        VALUES (
            %s::uuid,
            %s::uuid,
            %s::uuid,
            %s,
            CASE
                WHEN %s IS NULL THEN NULL
                ELSE ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
            END,
            %s::jsonb,
            %s,
            %s::uuid
        )
        """,
        (
            session_id,
            layer_id,
            feature_id,
            change_type,
            geometry_json,
            geometry_json,
            json.dumps(properties or {}),
            version,
            created_by,
        ),
    )


def _serialize_feature(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'type': 'Feature',
        'id': str(row['id']),
        'geometry': json.loads(row['geometry']) if isinstance(row['geometry'], str) else row['geometry'],
        'properties': {
            **(row['properties'] or {}),
            '_version': row['version'],
            '_created_at': row['created_at'].isoformat(),
            '_updated_at': row['updated_at'].isoformat(),
        },
    }


def _fetch_layer_style(cur, layer_id: str) -> dict[str, Any]:
    cur.execute('SELECT style FROM layers WHERE id = %s::uuid', (layer_id,))
    row = cur.fetchone()
    style = row['style'] if row and row.get('style') else {}
    return style if isinstance(style, dict) else {}


def _apply_snapping(cur, layer_id: str, geometry: dict[str, Any]) -> dict[str, Any]:
    if geometry.get('type') != 'Point':
        return geometry

    style = _fetch_layer_style(cur, layer_id)
    if not style.get('snap_enabled'):
        return geometry

    tolerance_m = float(style.get('snap_tolerance_m', 8))

    cur.execute(
        """
        WITH input AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) AS geom
        ),
        source AS (
            SELECT ST_Collect(geometry) AS geom
            FROM features
            WHERE layer_id = %s::uuid
        )
        SELECT
            ST_AsGeoJSON(ST_ClosestPoint(source.geom, input.geom)) AS snapped,
            ST_DistanceSphere(input.geom, ST_ClosestPoint(source.geom, input.geom)) AS dist
        FROM source, input
        WHERE source.geom IS NOT NULL
        """,
        (json.dumps(geometry), layer_id),
    )
    row = cur.fetchone()

    if not row or row.get('snapped') is None or row.get('dist') is None:
        return geometry

    if float(row['dist']) > tolerance_m:
        return geometry

    return json.loads(row['snapped'])


def _enforce_topology_rules(cur, layer_id: str, geometry: dict[str, Any], feature_id: str | None = None) -> None:
    if geometry.get('type') not in {'Polygon', 'MultiPolygon'}:
        return

    style = _fetch_layer_style(cur, layer_id)
    if not style.get('topology_no_overlap'):
        return

    cur.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM features f
            WHERE f.layer_id = %s::uuid
              AND (%s::uuid IS NULL OR f.id <> %s::uuid)
              AND ST_Overlaps(f.geometry, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        ) AS has_overlap
        """,
        (layer_id, feature_id, feature_id, json.dumps(geometry)),
    )
    if cur.fetchone()['has_overlap']:
        raise FieldSchemaError('Topology rule violation: overlapping polygon detected in this layer')


def _parse_filters(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []

    if isinstance(raw, str):
        if not raw.strip():
            return []
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise FieldSchemaError('filters must be valid JSON') from exc

    if not isinstance(raw, list):
        raise FieldSchemaError('filters must be an array')

    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise FieldSchemaError('Each filter must be an object')
        field = str(item.get('field', '')).strip()
        op = str(item.get('op', 'eq')).strip().lower()
        if not field:
            raise FieldSchemaError('Filter field is required')
        normalized.append({'field': field, 'op': op, 'value': item.get('value')})
    return normalized


def _build_filter_sql(filters: list[dict[str, Any]]) -> tuple[list[str], list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    for item in filters:
        field = item['field']
        op = item['op']
        value = item.get('value')

        expr_text = 'f.properties ->> %s'
        params.append(field)

        if op == 'eq':
            clauses.append(f'{expr_text} = %s')
            params.append(str(value) if value is not None else None)
        elif op == 'neq':
            clauses.append(f'COALESCE({expr_text}, \'\') <> %s')
            params.append(str(value) if value is not None else None)
        elif op == 'contains':
            clauses.append(f'COALESCE({expr_text}, \'\') ILIKE %s')
            params.append(f'%{value}%')
        elif op == 'startswith':
            clauses.append(f'COALESCE({expr_text}, \'\') ILIKE %s')
            params.append(f'{value}%')
        elif op == 'endswith':
            clauses.append(f'COALESCE({expr_text}, \'\') ILIKE %s')
            params.append(f'%{value}')
        elif op in {'gt', 'gte', 'lt', 'lte'}:
            operator = {'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<='}[op]
            clauses.append(f'NULLIF({expr_text}, \'\')::double precision {operator} %s')
            params.append(float(value))
        elif op == 'isnull':
            clauses.append(f'({expr_text} IS NULL)')
        elif op == 'notnull':
            clauses.append(f'({expr_text} IS NOT NULL)')
        else:
            raise FieldSchemaError(f'Unsupported filter operator: {op}')

    return clauses, params


def _fetch_join_definition(cur, layer_id: str, join_id: str | None) -> dict[str, Any] | None:
    if not join_id:
        return None

    cur.execute(
        """
        SELECT id, source_layer_id, target_layer_id, source_field, target_field, join_type, COALESCE(name, 'join') AS name
        FROM layer_joins
        WHERE id = %s::uuid AND source_layer_id = %s::uuid
        """,
        (join_id, layer_id),
    )
    row = cur.fetchone()
    return dict(row) if row else None


def _apply_join(cur, features: list[dict[str, Any]], join_def: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not join_def or not features:
        return features

    target_layer_id = str(join_def['target_layer_id'])
    target_field = join_def['target_field']
    source_field = join_def['source_field']
    prefix = join_def['name']

    cur.execute(
        """
        SELECT properties
        FROM features
        WHERE layer_id = %s::uuid
          AND properties ? %s
        """,
        (target_layer_id, target_field),
    )

    mapping: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        props = row.get('properties') or {}
        key = props.get(target_field)
        if key is None:
            continue
        mapping[str(key)] = props

    merged: list[dict[str, Any]] = []
    for feature in features:
        props = dict(feature.get('properties') or {})
        source_key = props.get(source_field)
        target_props = mapping.get(str(source_key)) if source_key is not None else None

        if target_props:
            for key, value in target_props.items():
                props[f'{prefix}.{key}'] = value

        feature_copy = dict(feature)
        feature_copy['properties'] = props
        merged.append(feature_copy)

    return merged


def _query_feature_rows(
    cur,
    *,
    layer_id: str,
    bbox: str | None,
    intersects: str | None,
    filters: list[dict[str, Any]],
    limit: int,
    offset: int,
    sort_by: str,
    sort_dir: str,
) -> tuple[list[dict[str, Any]], int]:
    where = ['f.layer_id = %s::uuid']
    params: list[Any] = [layer_id]

    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(','))
        except ValueError as exc:
            raise FieldSchemaError('bbox must be: minX,minY,maxX,maxY') from exc

        where.append('f.geometry && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
        params.extend([minx, miny, maxx, maxy])

    if intersects:
        try:
            json.loads(intersects)
        except json.JSONDecodeError as exc:
            raise FieldSchemaError('intersects must be valid GeoJSON geometry JSON') from exc

        where.append('ST_Intersects(f.geometry, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))')
        params.append(intersects)

    filter_sql, filter_params = _build_filter_sql(filters)
    where.extend(filter_sql)
    params.extend(filter_params)

    sort_dir = 'DESC' if sort_dir.lower() == 'desc' else 'ASC'
    if sort_by in {'created_at', 'updated_at', 'version'}:
        order_expr = f'f.{sort_by}'
    else:
        order_expr = 'f.properties ->> %s'
        params.append(sort_by)

    where_sql = ' AND '.join(where)

    # Total count
    cur.execute(
        f"SELECT COUNT(*) AS count FROM features f WHERE {where_sql}",
        tuple(params[:-1] if order_expr == 'f.properties ->> %s' else params),
    )
    total = int(cur.fetchone()['count'])

    # Data rows
    query_params = list(params)
    query = f"""
        SELECT f.id,
               f.layer_id,
               ST_AsGeoJSON(f.geometry) AS geometry,
               f.properties,
               f.version,
               f.created_at,
               f.updated_at
        FROM features f
        WHERE {where_sql}
        ORDER BY {order_expr} {sort_dir}, f.created_at DESC
        LIMIT %s OFFSET %s
    """
    query_params.extend([limit, offset])
    cur.execute(query, tuple(query_params))

    return [dict(row) for row in cur.fetchall()], total


def _apply_bulk_calculator(properties: dict[str, Any], calculator: dict[str, Any]) -> dict[str, Any]:
    output = dict(properties)
    field = str(calculator.get('field', '')).strip()
    if not field:
        raise FieldSchemaError('calculator.field is required')

    calc_type = str(calculator.get('type', 'copy')).strip()

    if calc_type == 'copy':
        source_field = str(calculator.get('source_field', '')).strip()
        if not source_field:
            raise FieldSchemaError('calculator.source_field is required for copy')
        output[field] = properties.get(source_field)
        return output

    if calc_type == 'concat':
        fields = calculator.get('fields')
        if not isinstance(fields, list) or not fields:
            raise FieldSchemaError('calculator.fields must be a non-empty array for concat')
        separator = str(calculator.get('separator', ''))
        output[field] = separator.join(str(properties.get(str(key), '')) for key in fields)
        return output

    if calc_type == 'math':
        source_field = str(calculator.get('source_field', '')).strip()
        operator = str(calculator.get('operator', '+')).strip()
        operand = float(calculator.get('value', 0))

        if source_field not in properties:
            raise FieldSchemaError(f'calculator.source_field not found: {source_field}')
        base = float(properties.get(source_field) or 0)

        if operator == '+':
            output[field] = base + operand
        elif operator == '-':
            output[field] = base - operand
        elif operator == '*':
            output[field] = base * operand
        elif operator == '/':
            if operand == 0:
                raise FieldSchemaError('calculator.value cannot be 0 for division')
            output[field] = base / operand
        else:
            raise FieldSchemaError('calculator.operator must be one of +, -, *, /')
        return output

    raise FieldSchemaError('calculator.type must be one of copy, concat, math')


@features_bp.route('/<layer_id>/features', methods=['GET'])
@jwt_required(optional=True)
def get_features(layer_id):
    user_id = get_jwt_identity()
    share_token = request.args.get('share_token')
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id, share_token):
        return jsonify({'error': 'Layer not found'}), 404

    try:
        limit = min(max(int(request.args.get('limit', 1000)), 1), 10000)
        offset = max(int(request.args.get('offset', 0)), 0)
    except ValueError:
        return jsonify({'error': 'limit and offset must be integers'}), 400

    filters_raw = request.args.get('filters')
    sort_by = str(request.args.get('sort_by', 'created_at')).strip() or 'created_at'
    sort_dir = str(request.args.get('sort_dir', 'desc')).strip().lower()
    join_id = request.args.get('join_id')

    try:
        filters = _parse_filters(filters_raw)
        rows, total = _query_feature_rows(
            cur,
            layer_id=layer_id,
            bbox=request.args.get('bbox'),
            intersects=request.args.get('intersects'),
            filters=filters,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    except FieldSchemaError as exc:
        return jsonify({'error': str(exc)}), 400

    join_def = _fetch_join_definition(cur, layer_id, join_id)
    rows = _apply_join(cur, rows, join_def)

    return jsonify({
        'type': 'FeatureCollection',
        'features': [_serialize_feature(row) for row in rows],
        'meta': {
            'total': total,
            'limit': limit,
            'offset': offset,
            'sort_by': sort_by,
            'sort_dir': sort_dir,
            'filters': filters,
            'join_id': join_id,
        },
    })


@features_bp.route('/<layer_id>/features/query', methods=['POST'])
@jwt_required(optional=True)
def query_features(layer_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    share_token = data.get('share_token')
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id, share_token):
        return jsonify({'error': 'Layer not found'}), 404

    page = int(data.get('page', 1))
    page_size = min(max(int(data.get('page_size', 50)), 1), 500)
    offset = (max(page, 1) - 1) * page_size

    sort = data.get('sort') or {}
    sort_by = str(sort.get('field', 'created_at')).strip() or 'created_at'
    sort_dir = str(sort.get('direction', 'desc')).strip().lower()

    try:
        filters = _parse_filters(data.get('filters'))
        rows, total = _query_feature_rows(
            cur,
            layer_id=layer_id,
            bbox=data.get('bbox'),
            intersects=json.dumps(data.get('polygon')) if data.get('polygon') else None,
            filters=filters,
            limit=page_size,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    except FieldSchemaError as exc:
        return jsonify({'error': str(exc)}), 400

    join_def = _fetch_join_definition(cur, layer_id, data.get('join_id'))
    rows = _apply_join(cur, rows, join_def)

    table_rows = []
    for row in rows:
        table_rows.append({
            'id': str(row['id']),
            'properties': row['properties'] or {},
            'version': row['version'],
            'created_at': row['created_at'].isoformat(),
            'updated_at': row['updated_at'].isoformat(),
        })

    return jsonify({
        'rows': table_rows,
        'total': total,
        'page': page,
        'page_size': page_size,
        'sort': {'field': sort_by, 'direction': sort_dir},
        'filters': filters,
    })


@features_bp.route('/<layer_id>/features/select', methods=['POST'])
@jwt_required(optional=True)
def select_features(layer_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id, data.get('share_token')):
        return jsonify({'error': 'Layer not found'}), 404

    try:
        filters = _parse_filters(data.get('filters'))
        rows, _ = _query_feature_rows(
            cur,
            layer_id=layer_id,
            bbox=data.get('bbox'),
            intersects=json.dumps(data.get('polygon')) if data.get('polygon') else None,
            filters=filters,
            limit=min(max(int(data.get('limit', 2000)), 1), 5000),
            offset=0,
            sort_by='created_at',
            sort_dir='desc',
        )
    except FieldSchemaError as exc:
        return jsonify({'error': str(exc)}), 400

    feature_ids = [str(row['id']) for row in rows]

    return jsonify({
        'feature_ids': feature_ids,
        'count': len(feature_ids),
        'features': [_serialize_feature(row) for row in rows] if data.get('include_features') else None,
    })


@features_bp.route('/<layer_id>/features/bulk-update', methods=['POST'])
@jwt_required()
def bulk_update_features(layer_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404
    if not _layer_can_write(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    feature_ids = data.get('feature_ids')
    updates = data.get('updates') or {}
    calculator = data.get('calculator')

    if not isinstance(updates, dict):
        return jsonify({'error': 'updates must be an object'}), 400

    if feature_ids is not None and (not isinstance(feature_ids, list) or not feature_ids):
        return jsonify({'error': 'feature_ids must be a non-empty array when provided'}), 400

    filters = _parse_filters(data.get('filters'))
    session_id: str | None = None

    where = ['layer_id = %s::uuid']
    params: list[Any] = [layer_id]

    if feature_ids:
        where.append('id = ANY(%s::uuid[])')
        params.append(feature_ids)

    filter_sql, filter_params = _build_filter_sql(filters)
    where.extend(filter_sql)
    params.extend(filter_params)

    cur.execute(
        f"""
        SELECT id, properties, version, ST_AsGeoJSON(geometry) AS geometry
        FROM features f
        WHERE {' AND '.join(where)}
        """,
        tuple(params),
    )
    rows = [dict(row) for row in cur.fetchall()]

    if not rows:
        return jsonify({'updated_count': 0, 'message': 'No matching features'}), 200

    updated_count = 0

    try:
        session_id = _resolve_edit_session_for_change(
            cur,
            layer_id=layer_id,
            user_id=user_id,
            payload=data,
        )
        for row in rows:
            properties = dict(row.get('properties') or {})
            for key, value in updates.items():
                properties[str(key)] = value

            if calculator:
                properties = _apply_bulk_calculator(properties, calculator)

            validated = validate_properties_against_schema(cur, layer_id, properties)

            cur.execute(
                """
                UPDATE features
                SET properties = %s::jsonb,
                    version = version + 1,
                    updated_at = NOW()
                WHERE id = %s::uuid AND layer_id = %s::uuid
                RETURNING id, version, ST_AsGeoJSON(geometry) AS geometry, properties
                """,
                (json.dumps(validated), row['id'], layer_id),
            )
            updated = cur.fetchone()
            if not updated:
                continue

            add_feature_history(
                cur,
                feature_id=str(updated['id']),
                layer_id=layer_id,
                version=int(updated['version']),
                geometry_geojson=updated['geometry'],
                properties=updated['properties'],
                change_type='update',
                changed_by=user_id,
            )
            _record_edit_session_change(
                cur,
                session_id=session_id,
                layer_id=layer_id,
                feature_id=str(updated['id']),
                change_type='update',
                geometry_geojson=updated['geometry'],
                properties=updated['properties'],
                version=int(updated['version']),
                created_by=user_id,
            )
            updated_count += 1

        invalidate_layer_tile_cache(cur, layer_id)
        log_audit(
            cur,
            user_id=user_id,
            action='features_bulk_update',
            entity_type='feature',
            entity_id=None,
            layer_id=layer_id,
            payload={'updated_count': updated_count, 'filters': filters, 'calculator': calculator},
        )
        db.commit()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Bulk update failed: {exc}'}), 400

    return jsonify({'updated_count': updated_count})


@features_bp.route('/<layer_id>/features', methods=['POST'])
@jwt_required()
def create_feature(layer_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    geometry = data.get('geometry')

    if not geometry:
        return jsonify({'error': 'geometry is required'}), 400

    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404
    if not _layer_can_write(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    session_id: str | None = None
    try:
        session_id = _resolve_edit_session_for_change(
            cur,
            layer_id=layer_id,
            user_id=user_id,
            payload=data,
        )
        snapped_geometry = _apply_snapping(cur, layer_id, geometry)
        _enforce_topology_rules(cur, layer_id, snapped_geometry)
        prepared_properties = validate_properties_against_schema(cur, layer_id, data.get('properties', {}))

        cur.execute(
            """
            INSERT INTO features (layer_id, geometry, properties, created_by)
            VALUES (%s::uuid, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s::jsonb, %s::uuid)
            RETURNING id,
                      ST_AsGeoJSON(geometry) AS geometry,
                      properties,
                      version,
                      created_at,
                      updated_at
            """,
            (layer_id, json.dumps(snapped_geometry), json.dumps(prepared_properties), user_id),
        )
        row = dict(cur.fetchone())

        add_feature_history(
            cur,
            feature_id=str(row['id']),
            layer_id=layer_id,
            version=int(row['version']),
            geometry_geojson=row['geometry'],
            properties=row['properties'],
            change_type='create',
            changed_by=user_id,
        )
        _record_edit_session_change(
            cur,
            session_id=session_id,
            layer_id=layer_id,
            feature_id=str(row['id']),
            change_type='create',
            geometry_geojson=row['geometry'],
            properties=row['properties'],
            version=int(row['version']),
            created_by=user_id,
        )
        invalidate_layer_tile_cache(cur, layer_id)
        log_audit(
            cur,
            user_id=user_id,
            action='feature_created',
            entity_type='feature',
            entity_id=str(row['id']),
            layer_id=layer_id,
        )
        db.commit()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Invalid geometry: {exc}'}), 400

    return jsonify(_serialize_feature(row)), 201


@features_bp.route('/<layer_id>/features/<feature_id>', methods=['PUT'])
@jwt_required()
def update_feature(layer_id, feature_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404
    if not _layer_can_write(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    cur.execute(
        """
        SELECT id, version, ST_AsGeoJSON(geometry) AS geometry, properties
        FROM features
        WHERE id = %s::uuid AND layer_id = %s::uuid
        """,
        (feature_id, layer_id),
    )
    current = cur.fetchone()
    if not current:
        return jsonify({'error': 'Feature not found'}), 404

    client_version = data.get('version')
    if client_version is not None and int(client_version) != int(current['version']):
        return jsonify({
            'error': 'Conflict: feature was modified by another user',
            'server_version': int(current['version']),
        }), 409

    geometry = data.get('geometry')
    properties = data.get('properties')
    session_id: str | None = None

    try:
        session_id = _resolve_edit_session_for_change(
            cur,
            layer_id=layer_id,
            user_id=user_id,
            payload=data,
        )
        if geometry is not None:
            geometry = _apply_snapping(cur, layer_id, geometry)
            _enforce_topology_rules(cur, layer_id, geometry, feature_id=feature_id)

        prepared_properties = (
            validate_properties_against_schema(cur, layer_id, properties)
            if properties is not None
            else None
        )

        if geometry is not None:
            cur.execute(
                """
                UPDATE features
                SET geometry = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    properties = COALESCE(%s::jsonb, properties),
                    version = version + 1,
                    updated_at = NOW()
                WHERE id = %s::uuid AND layer_id = %s::uuid
                RETURNING id,
                          ST_AsGeoJSON(geometry) AS geometry,
                          properties,
                          version,
                          created_at,
                          updated_at
                """,
                (json.dumps(geometry), json.dumps(prepared_properties) if prepared_properties is not None else None, feature_id, layer_id),
            )
        else:
            cur.execute(
                """
                UPDATE features
                SET properties = COALESCE(%s::jsonb, properties),
                    version = version + 1,
                    updated_at = NOW()
                WHERE id = %s::uuid AND layer_id = %s::uuid
                RETURNING id,
                          ST_AsGeoJSON(geometry) AS geometry,
                          properties,
                          version,
                          created_at,
                          updated_at
                """,
                (json.dumps(prepared_properties) if prepared_properties is not None else None, feature_id, layer_id),
            )

        row = dict(cur.fetchone())

        add_feature_history(
            cur,
            feature_id=str(row['id']),
            layer_id=layer_id,
            version=int(row['version']),
            geometry_geojson=row['geometry'],
            properties=row['properties'],
            change_type='update',
            changed_by=user_id,
        )
        _record_edit_session_change(
            cur,
            session_id=session_id,
            layer_id=layer_id,
            feature_id=str(row['id']),
            change_type='update',
            geometry_geojson=row['geometry'],
            properties=row['properties'],
            version=int(row['version']),
            created_by=user_id,
        )
        invalidate_layer_tile_cache(cur, layer_id)
        log_audit(
            cur,
            user_id=user_id,
            action='feature_updated',
            entity_type='feature',
            entity_id=str(row['id']),
            layer_id=layer_id,
        )
        db.commit()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Failed to update feature: {exc}'}), 400

    return jsonify(_serialize_feature(row))


@features_bp.route('/<layer_id>/features/<feature_id>', methods=['DELETE'])
@jwt_required()
def delete_feature(layer_id, feature_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    payload = request.get_json(silent=True) or {}

    if not _layer_accessible(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404
    if not _layer_can_write(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    cur.execute(
        """
        SELECT id, version, ST_AsGeoJSON(geometry) AS geometry, properties
        FROM features
        WHERE id = %s::uuid AND layer_id = %s::uuid
        """,
        (feature_id, layer_id),
    )
    existing = cur.fetchone()
    if not existing:
        return jsonify({'error': 'Feature not found'}), 404

    try:
        session_id = _resolve_edit_session_for_change(
            cur,
            layer_id=layer_id,
            user_id=user_id,
            payload=payload,
        )
        cur.execute(
            'DELETE FROM features WHERE id = %s::uuid AND layer_id = %s::uuid RETURNING id',
            (feature_id, layer_id),
        )

        add_feature_history(
            cur,
            feature_id=str(existing['id']),
            layer_id=layer_id,
            version=int(existing['version']) + 1,
            geometry_geojson=existing['geometry'],
            properties=existing['properties'],
            change_type='delete',
            changed_by=user_id,
        )
        _record_edit_session_change(
            cur,
            session_id=session_id,
            layer_id=layer_id,
            feature_id=str(existing['id']),
            change_type='delete',
            geometry_geojson=existing['geometry'],
            properties=existing['properties'],
            version=int(existing['version']) + 1,
            created_by=user_id,
        )
        invalidate_layer_tile_cache(cur, layer_id)
        log_audit(
            cur,
            user_id=user_id,
            action='feature_deleted',
            entity_type='feature',
            entity_id=str(existing['id']),
            layer_id=layer_id,
        )
        db.commit()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Failed to delete feature: {exc}'}), 400

    return jsonify({'message': 'Feature deleted'})


@features_bp.route('/<layer_id>/features/<feature_id>/history', methods=['GET'])
@jwt_required(optional=True)
def get_feature_history(layer_id, feature_id):
    user_id = get_jwt_identity()
    share_token = request.args.get('share_token')
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id, share_token):
        return jsonify({'error': 'Layer not found'}), 404

    cur.execute(
        """
        SELECT id,
               feature_id,
               layer_id,
               version,
               ST_AsGeoJSON(geometry) AS geometry,
               properties,
               change_type,
               changed_by,
               changed_at
        FROM feature_history
        WHERE layer_id = %s::uuid
          AND feature_id = %s::uuid
        ORDER BY changed_at DESC
        """,
        (layer_id, feature_id),
    )

    rows = []
    for row in cur.fetchall():
        rows.append({
            'id': str(row['id']),
            'feature_id': str(row['feature_id']),
            'layer_id': str(row['layer_id']),
            'version': row['version'],
            'geometry': json.loads(row['geometry']) if row.get('geometry') else None,
            'properties': row.get('properties') or {},
            'change_type': row['change_type'],
            'changed_by': str(row['changed_by']) if row.get('changed_by') else None,
            'changed_at': row['changed_at'].isoformat(),
        })

    return jsonify(rows)


@features_bp.route('/<layer_id>/features/<feature_id>/rollback', methods=['POST'])
@jwt_required()
def rollback_feature(layer_id, feature_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404
    if not _layer_can_write(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    history_id = data.get('history_id')
    target_version = data.get('version')

    if history_id:
        cur.execute(
            """
            SELECT id, version, ST_AsGeoJSON(geometry) AS geometry, properties
            FROM feature_history
            WHERE id = %s::uuid
              AND feature_id = %s::uuid
              AND layer_id = %s::uuid
            """,
            (history_id, feature_id, layer_id),
        )
    elif target_version is not None:
        cur.execute(
            """
            SELECT id, version, ST_AsGeoJSON(geometry) AS geometry, properties
            FROM feature_history
            WHERE feature_id = %s::uuid
              AND layer_id = %s::uuid
              AND version = %s
            ORDER BY changed_at DESC
            LIMIT 1
            """,
            (feature_id, layer_id, int(target_version)),
        )
    else:
        return jsonify({'error': 'history_id or version is required'}), 400

    snapshot = cur.fetchone()
    if not snapshot:
        return jsonify({'error': 'History snapshot not found'}), 404
    if not snapshot.get('geometry'):
        return jsonify({'error': 'Snapshot does not include geometry'}), 400

    try:
        validated_props = validate_properties_against_schema(cur, layer_id, snapshot.get('properties') or {})

        cur.execute(
            """
            SELECT id, version
            FROM features
            WHERE id = %s::uuid AND layer_id = %s::uuid
            """,
            (feature_id, layer_id),
        )
        existing = cur.fetchone()

        if existing:
            cur.execute(
                """
                UPDATE features
                SET geometry = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    properties = %s::jsonb,
                    version = version + 1,
                    updated_at = NOW()
                WHERE id = %s::uuid AND layer_id = %s::uuid
                RETURNING id, version, ST_AsGeoJSON(geometry) AS geometry, properties, created_at, updated_at
                """,
                (snapshot['geometry'], json.dumps(validated_props), feature_id, layer_id),
            )
        else:
            cur.execute(
                """
                INSERT INTO features (id, layer_id, geometry, properties, version, created_by)
                VALUES (
                    %s::uuid,
                    %s::uuid,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    %s::jsonb,
                    1,
                    %s::uuid
                )
                RETURNING id, version, ST_AsGeoJSON(geometry) AS geometry, properties, created_at, updated_at
                """,
                (feature_id, layer_id, snapshot['geometry'], json.dumps(validated_props), user_id),
            )

        row = cur.fetchone()

        add_feature_history(
            cur,
            feature_id=str(row['id']),
            layer_id=layer_id,
            version=int(row['version']),
            geometry_geojson=row['geometry'],
            properties=row['properties'],
            change_type='rollback',
            changed_by=user_id,
        )
        invalidate_layer_tile_cache(cur, layer_id)
        log_audit(
            cur,
            user_id=user_id,
            action='feature_rolled_back',
            entity_type='feature',
            entity_id=str(row['id']),
            layer_id=layer_id,
            payload={'snapshot_id': str(snapshot['id']), 'snapshot_version': snapshot['version']},
        )
        db.commit()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Rollback failed: {exc}'}), 400

    return jsonify(_serialize_feature(dict(row)))
