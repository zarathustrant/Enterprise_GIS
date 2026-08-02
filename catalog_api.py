import json
import uuid

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db import get_db
from enterprise_utils import log_audit
from style_validation import StyleValidationError, validate_layer_style


catalog_bp = Blueprint('catalog', __name__)


def _uuid(value, field_name):
    if value in (None, ''):
        return None
    try:
        return str(uuid.UUID(str(value)))
    except ValueError as exc:
        raise ValueError(f'{field_name} must be a UUID') from exc


def _map_access_clause(alias='m'):
    return f"""(
        {alias}.is_public = TRUE
        OR {alias}.created_by = %s::uuid
        OR EXISTS (
            SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = {alias}.workspace_id AND wm.user_id = %s::uuid
        )
    )"""


def _layer_access_clause(alias='l'):
    return f"""(
        {alias}.is_public = TRUE
        OR {alias}.created_by = %s::uuid
        OR EXISTS (
            SELECT 1 FROM workspace_layers wl
            JOIN workspace_members wm ON wm.workspace_id = wl.workspace_id
            WHERE wl.layer_id = {alias}.id AND wm.user_id = %s::uuid
        )
    )"""


def _serialize_map(row):
    return {
        'id': str(row['id']),
        'workspace_id': str(row['workspace_id']) if row.get('workspace_id') else None,
        'name': row['name'],
        'description': row.get('description'),
        'basemap': row.get('basemap') or {},
        'initial_view': row.get('initial_view') or {},
        'spatial_reference': row.get('spatial_reference') or 'EPSG:4326',
        'settings': row.get('settings') or {},
        'thumbnail_key': row.get('thumbnail_key'),
        'is_public': bool(row.get('is_public')),
        'is_default': bool(row.get('is_default')),
        'revision': int(row.get('revision') or 1),
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'owner_name': row.get('owner_name'),
        'layer_count': int(row.get('layer_count') or 0),
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }


def _serialize_map_layer(row):
    source_accessible = bool(row.get('source_accessible', True))
    source_style = (row.get('source_style') or {}) if source_accessible else {}
    return {
        'id': str(row['id']),
        'map_id': str(row['map_id']),
        'source_layer_id': str(row['source_layer_id']) if row.get('source_layer_id') else None,
        'parent_id': str(row['parent_id']) if row.get('parent_id') else None,
        'layer_kind': row['layer_kind'],
        'title': row['title'],
        'draw_order': int(row['draw_order']),
        'visible': bool(row['visible']),
        'min_zoom': float(row['min_zoom']),
        'max_zoom': float(row['max_zoom']),
        'opacity': float(row['opacity']),
        'style_override': row.get('style_override'),
        'effective_style': row.get('style_override') or source_style,
        'source_accessible': source_accessible,
        'source_error': None if source_accessible else 'Source layer is unavailable or you do not have access.',
        'label_override': row.get('label_override'),
        'popup_config': row.get('popup_config') or {},
        'definition_filter': row.get('definition_filter') or {},
        'selection_enabled': bool(row['selection_enabled']),
        'source': None if not row.get('source_layer_id') or not source_accessible else {
            'id': str(row['source_layer_id']),
            'name': row.get('source_name'),
            'description': row.get('source_description'),
            'geometry_type': row.get('geometry_type'),
            'crs': row.get('crs'),
            'style': source_style,
            'is_public': bool(row.get('source_is_public')),
            'catalog_status': row.get('catalog_status') or 'draft',
            'created_by': row.get('source_owner_name'),
            'created_at': row['source_created_at'].isoformat() if row.get('source_created_at') else None,
            'updated_at': row['source_updated_at'].isoformat() if row.get('source_updated_at') else None,
        },
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }


def _fetch_map(cur, map_id, user_id, owner_only=False):
    ownership = (
        """(
            m.created_by = %s::uuid
            OR EXISTS (
                SELECT 1 FROM workspace_members wm
                WHERE wm.workspace_id = m.workspace_id
                  AND wm.user_id = %s::uuid
                  AND wm.role IN ('owner', 'admin', 'editor')
            )
        )"""
        if owner_only else _map_access_clause('m')
    )
    parameters = (map_id, user_id, user_id)
    cur.execute(
        f"""SELECT m.*, u.username AS owner_name,
                   (SELECT COUNT(*) FROM map_layers ml WHERE ml.map_id = m.id) AS layer_count
            FROM maps m LEFT JOIN users u ON u.id = m.created_by
            WHERE m.id = %s::uuid AND {ownership}""",
        parameters,
    )
    return cur.fetchone()


def _ensure_default_map(cur, user_id):
    cur.execute(
        """SELECT id FROM maps
           WHERE created_by = %s::uuid AND is_default = TRUE AND workspace_id IS NULL""",
        (user_id,),
    )
    row = cur.fetchone()
    if row:
        return str(row['id'])
    cur.execute(
        """INSERT INTO maps (name, description, is_default, created_by)
           VALUES ('My Map', 'Personal default map.', TRUE, %s::uuid) RETURNING id""",
        (user_id,),
    )
    map_id = str(cur.fetchone()['id'])
    cur.execute(
        """INSERT INTO map_layers (
               map_id, source_layer_id, title, draw_order, visible,
               min_zoom, max_zoom, style_override
           ) SELECT %s::uuid, l.id, l.name, l.z_index, TRUE,
                    l.min_zoom, l.max_zoom, l.style
             FROM layers l WHERE l.created_by = %s::uuid""",
        (map_id, user_id),
    )
    return map_id


@catalog_bp.route('/maps', methods=['GET'])
@jwt_required()
def list_maps():
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    _ensure_default_map(cur, user_id)
    db.commit()
    cur.execute(
        f"""SELECT m.*, u.username AS owner_name,
                   (SELECT COUNT(*) FROM map_layers ml WHERE ml.map_id = m.id) AS layer_count
            FROM maps m LEFT JOIN users u ON u.id = m.created_by
            WHERE {_map_access_clause('m')}
            ORDER BY m.is_default DESC, m.updated_at DESC, m.name""",
        (user_id, user_id),
    )
    return jsonify([_serialize_map(row) for row in cur.fetchall()])


@catalog_bp.route('/maps', methods=['POST'])
@jwt_required()
def create_map():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    name = str(data.get('name', '')).strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    try:
        workspace_id = _uuid(data.get('workspace_id'), 'workspace_id')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    db = get_db()
    cur = db.cursor()
    if workspace_id:
        cur.execute(
            'SELECT role FROM workspace_members WHERE workspace_id = %s::uuid AND user_id = %s::uuid',
            (workspace_id, user_id),
        )
        member = cur.fetchone()
        if not member or member['role'] not in {'owner', 'admin', 'editor'}:
            return jsonify({'error': 'Workspace not found or permission denied'}), 404
    cur.execute(
        """INSERT INTO maps (
               workspace_id, name, description, basemap, initial_view,
               spatial_reference, settings, is_public, created_by
           ) VALUES (%s::uuid, %s, %s, %s::jsonb, %s::jsonb, %s, %s::jsonb, %s, %s::uuid)
           RETURNING *""",
        (
            workspace_id, name, data.get('description'),
            json.dumps(data.get('basemap') or {'id': 'osm', 'title': 'OpenStreetMap'}),
            json.dumps(data.get('initial_view') or {'center': {'lng': 4.5, 'lat': 8.5}, 'zoom': 6, 'bearing': 0, 'pitch': 0}),
            data.get('spatial_reference') or 'EPSG:4326', json.dumps(data.get('settings') or {}),
            bool(data.get('is_public', False)), user_id,
        ),
    )
    row = dict(cur.fetchone())
    row.update(owner_name=None, layer_count=0)
    log_audit(cur, user_id=user_id, action='map_created', entity_type='map', entity_id=str(row['id']), payload={'name': name})
    db.commit()
    return jsonify(_serialize_map(row)), 201


@catalog_bp.route('/maps/<map_id>', methods=['GET'])
@jwt_required()
def get_map(map_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    row = _fetch_map(cur, map_id, user_id)
    if not row:
        return jsonify({'error': 'Map not found'}), 404
    cur.execute(
        f"""SELECT ml.*, l.name AS source_name, l.description AS source_description,
                  l.geometry_type, l.crs, l.style AS source_style, l.is_public AS source_is_public,
                  l.catalog_status, l.created_at AS source_created_at,
                  l.updated_at AS source_updated_at, u.username AS source_owner_name,
                  CASE WHEN l.id IS NULL THEN FALSE ELSE {_layer_access_clause('l')} END AS source_accessible
           FROM map_layers ml
           LEFT JOIN layers l ON l.id = ml.source_layer_id
           LEFT JOIN users u ON u.id = l.created_by
           WHERE ml.map_id = %s::uuid
           ORDER BY ml.parent_id NULLS FIRST, ml.draw_order DESC, ml.created_at""",
        (user_id, user_id, map_id),
    )
    result = _serialize_map(row)
    result['layers'] = [_serialize_map_layer(item) for item in cur.fetchall()]
    return jsonify(result)


@catalog_bp.route('/maps/<map_id>', methods=['PATCH'])
@jwt_required()
def update_map(map_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()
    row = _fetch_map(cur, map_id, user_id, owner_only=True)
    if not row:
        return jsonify({'error': 'Map not found or permission denied'}), 404
    expected_revision = data.get('revision')
    if expected_revision is not None:
        try:
            expected_revision = int(expected_revision)
        except (TypeError, ValueError):
            return jsonify({'error': 'revision must be an integer'}), 400
        if expected_revision != int(row['revision']):
            return jsonify({'error': 'Map has changed. Reload the latest revision.', 'revision': row['revision']}), 409
    assignments, values = [], []
    for field in ('name', 'description', 'spatial_reference', 'thumbnail_key', 'is_public'):
        if field in data:
            assignments.append(f'{field} = %s')
            values.append(data[field])
    for field in ('basemap', 'initial_view', 'settings'):
        if field in data:
            assignments.append(f'{field} = %s::jsonb')
            values.append(json.dumps(data[field]))
    if not assignments:
        return jsonify({'error': 'No valid fields to update'}), 400
    assignments.extend(['revision = revision + 1', 'updated_at = NOW()'])
    cur.execute(
        f"UPDATE maps SET {', '.join(assignments)} WHERE id = %s::uuid RETURNING *",
        values + [map_id],
    )
    updated = dict(cur.fetchone())
    updated.update(owner_name=row.get('owner_name'), layer_count=row.get('layer_count', 0))
    db.commit()
    return jsonify(_serialize_map(updated))


@catalog_bp.route('/maps/<map_id>', methods=['DELETE'])
@jwt_required()
def delete_map(map_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """DELETE FROM maps
           WHERE id = %s::uuid AND created_by = %s::uuid AND is_default = FALSE
           RETURNING id""",
        (map_id, user_id),
    )
    if not cur.fetchone():
        return jsonify({'error': 'Map not found, permission denied, or default map cannot be deleted'}), 404
    db.commit()
    return jsonify({'message': 'Map deleted'})


@catalog_bp.route('/maps/<map_id>/duplicate', methods=['POST'])
@jwt_required()
def duplicate_map(map_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()
    source = _fetch_map(cur, map_id, user_id)
    if not source:
        return jsonify({'error': 'Map not found'}), 404
    name = str(data.get('name') or f'{source["name"]} Copy').strip()
    cur.execute(
        """INSERT INTO maps (
               name, description, basemap, initial_view, spatial_reference,
               settings, thumbnail_key, is_public, created_by
           ) SELECT %s, description, basemap, initial_view, spatial_reference,
                    settings, thumbnail_key, FALSE, %s::uuid
             FROM maps WHERE id = %s::uuid RETURNING *""",
        (name, user_id, map_id),
    )
    created = dict(cur.fetchone())
    cur.execute('SELECT * FROM map_layers WHERE map_id = %s::uuid ORDER BY created_at', (map_id,))
    source_layers = cur.fetchall()
    copied_ids = {}
    for item in source_layers:
        cur.execute(
            """INSERT INTO map_layers (
                   map_id, source_layer_id, parent_id, layer_kind, title, draw_order,
                   visible, min_zoom, max_zoom, opacity, style_override, label_override,
                   popup_config, definition_filter, selection_enabled
               ) VALUES (%s::uuid, %s::uuid, NULL, %s, %s, %s, %s, %s, %s, %s,
                         %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s) RETURNING id""",
            (
                created['id'], item.get('source_layer_id'), item['layer_kind'], item['title'],
                item['draw_order'], item['visible'], item['min_zoom'], item['max_zoom'],
                item['opacity'], json.dumps(item.get('style_override')) if item.get('style_override') is not None else None,
                json.dumps(item.get('label_override')) if item.get('label_override') is not None else None,
                json.dumps(item.get('popup_config') or {}), json.dumps(item.get('definition_filter') or {}),
                item['selection_enabled'],
            ),
        )
        copied_ids[str(item['id'])] = str(cur.fetchone()['id'])
    for item in source_layers:
        if item.get('parent_id'):
            cur.execute(
                'UPDATE map_layers SET parent_id = %s::uuid WHERE id = %s::uuid',
                (copied_ids[str(item['parent_id'])], copied_ids[str(item['id'])]),
            )
    created.update(owner_name=None, layer_count=len(source_layers))
    db.commit()
    return jsonify(_serialize_map(created)), 201


@catalog_bp.route('/maps/<map_id>/layers', methods=['POST'])
@jwt_required()
def add_map_layers(map_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    source_ids = data.get('source_layer_ids') or []
    if not isinstance(source_ids, list) or not source_ids:
        return jsonify({'error': 'source_layer_ids must be a non-empty list'}), 400
    try:
        source_ids = [_uuid(value, 'source_layer_ids') for value in source_ids]
        parent_id = _uuid(data.get('parent_id'), 'parent_id')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    db = get_db()
    cur = db.cursor()
    owner = _fetch_map(cur, map_id, user_id, owner_only=True)
    if not owner:
        return jsonify({'error': 'Map not found or permission denied'}), 404
    if parent_id:
        cur.execute(
            "SELECT id FROM map_layers WHERE id = %s::uuid AND map_id = %s::uuid AND layer_kind = 'group'",
            (parent_id, map_id),
        )
        if not cur.fetchone():
            return jsonify({'error': 'Parent group not found'}), 404
    cur.execute(
        f"""SELECT l.* FROM layers l
            WHERE l.id = ANY(%s::uuid[]) AND {_layer_access_clause('l')}""",
        (source_ids, user_id, user_id),
    )
    sources = {str(row['id']): row for row in cur.fetchall()}
    missing = [item for item in source_ids if item not in sources]
    if missing:
        return jsonify({'error': 'One or more catalog layers were not found', 'layer_ids': missing}), 404
    cur.execute('SELECT COALESCE(MAX(draw_order), -1) AS maximum FROM map_layers WHERE map_id = %s::uuid', (map_id,))
    next_order = int(cur.fetchone()['maximum']) + 1
    created = []
    for offset, source_id in enumerate(source_ids):
        source = sources[source_id]
        cur.execute(
            """INSERT INTO map_layers (
                   map_id, source_layer_id, parent_id, title, draw_order,
                   visible, min_zoom, max_zoom, style_override
               ) VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, TRUE, %s, %s, %s::jsonb)
               RETURNING *""",
            (map_id, source_id, parent_id, source['name'], next_order + offset, source['min_zoom'], source['max_zoom'], json.dumps(source['style'] or {})),
        )
        row = dict(cur.fetchone())
        row.update(
            source_name=source['name'], source_description=source['description'], geometry_type=source['geometry_type'],
            crs=source['crs'], source_style=source['style'], source_is_public=source['is_public'],
            catalog_status=source.get('catalog_status'), source_updated_at=source['updated_at'], source_owner_name=None,
            source_created_at=source['created_at'], source_accessible=True,
        )
        created.append(_serialize_map_layer(row))
    cur.execute('UPDATE maps SET revision = revision + 1, updated_at = NOW() WHERE id = %s::uuid', (map_id,))
    db.commit()
    return jsonify(created), 201


@catalog_bp.route('/maps/<map_id>/groups', methods=['POST'])
@jwt_required()
def create_map_group(map_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    title = str(data.get('title', '')).strip()
    if not title:
        return jsonify({'error': 'title is required'}), 400
    db = get_db()
    cur = db.cursor()
    if not _fetch_map(cur, map_id, user_id, owner_only=True):
        return jsonify({'error': 'Map not found or permission denied'}), 404
    cur.execute('SELECT COALESCE(MAX(draw_order), -1) + 1 AS next_order FROM map_layers WHERE map_id = %s::uuid', (map_id,))
    draw_order = cur.fetchone()['next_order']
    cur.execute(
        """INSERT INTO map_layers (map_id, layer_kind, title, draw_order)
           VALUES (%s::uuid, 'group', %s, %s) RETURNING *""",
        (map_id, title, draw_order),
    )
    row = dict(cur.fetchone())
    row.update(source_style={})
    cur.execute('UPDATE maps SET revision = revision + 1, updated_at = NOW() WHERE id = %s::uuid', (map_id,))
    db.commit()
    return jsonify(_serialize_map_layer(row)), 201


@catalog_bp.route('/maps/<map_id>/layers/<map_layer_id>', methods=['PATCH'])
@jwt_required()
def update_map_layer(map_id, map_layer_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()
    if not _fetch_map(cur, map_id, user_id, owner_only=True):
        return jsonify({'error': 'Map not found or permission denied'}), 404
    assignments, values = [], []
    if 'style_override' in data and data['style_override'] is not None:
        try:
            validate_layer_style(data['style_override'])
        except StyleValidationError as exc:
            return jsonify({'error': 'Invalid layer style', 'details': exc.errors}), 400
    for field in ('title', 'draw_order', 'visible', 'min_zoom', 'max_zoom', 'opacity', 'selection_enabled'):
        if field in data:
            assignments.append(f'{field} = %s')
            values.append(data[field])
    for field in ('style_override', 'label_override', 'popup_config', 'definition_filter'):
        if field in data:
            assignments.append(f'{field} = %s::jsonb')
            values.append(json.dumps(data[field]) if data[field] is not None else None)
    if 'parent_id' in data:
        try:
            parent_id = _uuid(data.get('parent_id'), 'parent_id')
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        if parent_id == map_layer_id:
            return jsonify({'error': 'A map item cannot be its own parent'}), 400
        if parent_id:
            cur.execute(
                """SELECT id FROM map_layers
                   WHERE id = %s::uuid AND map_id = %s::uuid AND layer_kind = 'group'""",
                (parent_id, map_id),
            )
            if not cur.fetchone():
                return jsonify({'error': 'Parent group not found'}), 404
        assignments.append('parent_id = %s::uuid')
        values.append(parent_id)
    if not assignments:
        return jsonify({'error': 'No valid fields to update'}), 400
    assignments.append('updated_at = NOW()')
    cur.execute(
        f"""UPDATE map_layers SET {', '.join(assignments)}
            WHERE id = %s::uuid AND map_id = %s::uuid RETURNING *""",
        values + [map_layer_id, map_id],
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Map layer not found'}), 404
    cur.execute('UPDATE maps SET revision = revision + 1, updated_at = NOW() WHERE id = %s::uuid', (map_id,))
    db.commit()
    return jsonify({'id': str(row['id']), 'message': 'Map layer updated'})


@catalog_bp.route('/maps/<map_id>/layers/<map_layer_id>', methods=['DELETE'])
@jwt_required()
def remove_map_layer(map_id, map_layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    if not _fetch_map(cur, map_id, user_id, owner_only=True):
        return jsonify({'error': 'Map not found or permission denied'}), 404
    cur.execute('DELETE FROM map_layers WHERE id = %s::uuid AND map_id = %s::uuid RETURNING id', (map_layer_id, map_id))
    if not cur.fetchone():
        return jsonify({'error': 'Map layer not found'}), 404
    cur.execute('UPDATE maps SET revision = revision + 1, updated_at = NOW() WHERE id = %s::uuid', (map_id,))
    db.commit()
    return jsonify({'message': 'Layer removed from map'})


@catalog_bp.route('/catalog/items', methods=['GET'])
@jwt_required()
def catalog_items():
    user_id = get_jwt_identity()
    q = request.args.get('q', '').strip()
    collection = request.args.get('collection', 'organization')
    geometry_type = request.args.get('geometry_type', '').strip()
    status = request.args.get('status', '').strip()
    geodatabase_id = request.args.get('geodatabase_id', '').strip()
    try:
        limit = min(max(int(request.args.get('limit', 50)), 1), 100)
        offset = max(int(request.args.get('offset', 0)), 0)
    except ValueError:
        return jsonify({'error': 'limit and offset must be integers'}), 400
    conditions = [_layer_access_clause('l')]
    values = [user_id, user_id]
    if collection == 'mine':
        conditions.append('l.created_by = %s::uuid')
        values.append(user_id)
    elif collection == 'shared':
        conditions.append('l.created_by <> %s::uuid')
        values.append(user_id)
    elif collection == 'favorites':
        conditions.append("EXISTS (SELECT 1 FROM catalog_favorites cf WHERE cf.user_id = %s::uuid AND cf.item_type = 'layer' AND cf.item_id = l.id)")
        values.append(user_id)
    if q:
        conditions.append("(l.catalog_search @@ plainto_tsquery('simple', %s) OR l.name ILIKE %s OR EXISTS (SELECT 1 FROM unnest(l.tags) tag WHERE tag ILIKE %s))")
        values.extend([q, f'%{q}%', f'%{q}%'])
    if geometry_type:
        conditions.append('LOWER(l.geometry_type) = LOWER(%s)')
        values.append(geometry_type)
    if status:
        conditions.append('l.catalog_status = %s')
        values.append(status)
    if geodatabase_id:
        try:
            geodatabase_id = _uuid(geodatabase_id, 'geodatabase_id')
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        conditions.append('l.geodatabase_id = %s::uuid')
        values.append(geodatabase_id)
    where = ' AND '.join(conditions)
    db = get_db()
    cur = db.cursor()
    cur.execute(f'SELECT COUNT(*) AS count FROM layers l WHERE {where}', tuple(values))
    total = int(cur.fetchone()['count'])
    cur.execute(
        f"""SELECT l.*, u.username AS owner_name, g.name AS geodatabase_name,
                   fd.name AS feature_dataset_name,
                   EXISTS (
                       SELECT 1 FROM catalog_favorites cf
                       WHERE cf.user_id = %s::uuid AND cf.item_type = 'layer' AND cf.item_id = l.id
                   ) AS is_favorite,
                   (SELECT COUNT(*) FROM features f WHERE f.layer_id = l.id) AS feature_count,
                   ST_AsGeoJSON((SELECT ST_Envelope(ST_Extent(f.geometry)) FROM features f WHERE f.layer_id = l.id)) AS extent
            FROM layers l
            LEFT JOIN users u ON u.id = l.created_by
            LEFT JOIN geodatabases g ON g.id = l.geodatabase_id
            LEFT JOIN feature_datasets fd ON fd.id = l.feature_dataset_id
            WHERE {where}
            ORDER BY l.catalog_status = 'authoritative' DESC,
                     CASE WHEN %s = '' THEN 1 ELSE similarity(l.name, %s) END DESC,
                     l.updated_at DESC
            LIMIT %s OFFSET %s""",
        tuple([user_id] + values + [q, q, limit, offset]),
    )
    items = []
    for row in cur.fetchall():
        items.append({
            'id': str(row['id']), 'item_type': 'layer', 'name': row['name'],
            'description': row.get('description'), 'geometry_type': row.get('geometry_type'),
            'crs': row.get('crs'), 'owner_name': row.get('owner_name'),
            'workspace_id': str(row['workspace_id']) if row.get('workspace_id') else None,
            'geodatabase_id': str(row['geodatabase_id']) if row.get('geodatabase_id') else None,
            'geodatabase_name': row.get('geodatabase_name'),
            'feature_dataset_id': str(row['feature_dataset_id']) if row.get('feature_dataset_id') else None,
            'feature_dataset_name': row.get('feature_dataset_name'),
            'catalog_status': row.get('catalog_status') or 'draft', 'tags': row.get('tags') or [],
            'thumbnail_key': row.get('thumbnail_key'), 'metadata': row.get('metadata') or {},
            'is_public': bool(row.get('is_public')), 'is_favorite': bool(row.get('is_favorite')),
            'feature_count': int(row.get('feature_count') or 0),
            'extent': json.loads(row['extent']) if row.get('extent') else None,
            'updated_at': row['updated_at'].isoformat(),
        })
    return jsonify({'items': items, 'total': total, 'limit': limit, 'offset': offset})


@catalog_bp.route('/catalog/items/<item_type>/<item_id>/favorite', methods=['POST', 'DELETE'])
@jwt_required()
def catalog_favorite(item_type, item_id):
    if item_type not in {'layer', 'map', 'geodatabase'}:
        return jsonify({'error': 'Unsupported catalog item type'}), 400
    try:
        item_id = _uuid(item_id, 'item_id')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    if request.method == 'POST':
        if item_type == 'layer':
            cur.execute(
                f'SELECT l.id FROM layers l WHERE l.id = %s::uuid AND {_layer_access_clause("l")}',
                (item_id, user_id, user_id),
            )
            accessible = cur.fetchone()
        elif item_type == 'map':
            accessible = _fetch_map(cur, item_id, user_id)
        else:
            cur.execute(
                """SELECT g.id FROM geodatabases g
                   WHERE g.id = %s::uuid AND (
                       g.created_by = %s::uuid OR EXISTS (
                           SELECT 1 FROM workspace_members wm
                           WHERE wm.workspace_id = g.workspace_id AND wm.user_id = %s::uuid
                       )
                   )""",
                (item_id, user_id, user_id),
            )
            accessible = cur.fetchone()
        if not accessible:
            return jsonify({'error': 'Catalog item not found'}), 404
        cur.execute(
            """INSERT INTO catalog_favorites (user_id, item_type, item_id)
               VALUES (%s::uuid, %s, %s::uuid) ON CONFLICT DO NOTHING""",
            (user_id, item_type, item_id),
        )
        message = 'Favorite added'
    else:
        cur.execute(
            'DELETE FROM catalog_favorites WHERE user_id = %s::uuid AND item_type = %s AND item_id = %s::uuid',
            (user_id, item_type, item_id),
        )
        message = 'Favorite removed'
    db.commit()
    return jsonify({'message': message})


def _serialize_geodatabase(row):
    return {
        'id': str(row['id']), 'workspace_id': str(row['workspace_id']) if row.get('workspace_id') else None,
        'name': row['name'], 'alias': row.get('alias'), 'description': row.get('description'),
        'database_type': row['database_type'], 'default_crs': row['default_crs'], 'status': row['status'],
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        # dataset_count is retained for compatibility with older clients.
        'dataset_count': int(row.get('layer_count') or row.get('dataset_count') or 0),
        'layer_count': int(row.get('layer_count') or row.get('dataset_count') or 0),
        'feature_dataset_count': int(row.get('feature_dataset_count') or 0),
        'created_at': row['created_at'].isoformat(), 'updated_at': row['updated_at'].isoformat(),
    }


def _serialize_feature_dataset(row):
    return {
        'id': str(row['id']), 'geodatabase_id': str(row['geodatabase_id']), 'name': row['name'],
        'alias': row.get('alias'), 'description': row.get('description'), 'crs': row['crs'],
        'layer_count': int(row.get('layer_count') or 0),
        'created_at': row['created_at'].isoformat(), 'updated_at': row['updated_at'].isoformat(),
    }


@catalog_bp.route('/geodatabases', methods=['GET', 'POST'])
@jwt_required()
def geodatabases():
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    if request.method == 'POST':
        data = request.get_json() or {}
        name = str(data.get('name', '')).strip()
        if not name:
            return jsonify({'error': 'name is required'}), 400
        try:
            workspace_id = _uuid(data.get('workspace_id'), 'workspace_id')
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        if workspace_id:
            cur.execute(
                """SELECT role FROM workspace_members
                   WHERE workspace_id = %s::uuid AND user_id = %s::uuid""",
                (workspace_id, user_id),
            )
            member = cur.fetchone()
            if not member or member['role'] not in {'owner', 'admin', 'editor'}:
                return jsonify({'error': 'Workspace not found or permission denied'}), 404
        cur.execute(
            """SELECT id FROM geodatabases
               WHERE LOWER(name) = LOWER(%s) AND (
                   (%s::uuid IS NULL AND workspace_id IS NULL AND created_by = %s::uuid)
                   OR (%s::uuid IS NOT NULL AND workspace_id = %s::uuid)
               )""",
            (name, workspace_id, user_id, workspace_id, workspace_id),
        )
        if cur.fetchone():
            return jsonify({'error': 'A geodatabase with this name already exists in this location'}), 409
        cur.execute(
            """INSERT INTO geodatabases (
                   workspace_id, name, alias, description, database_type, default_crs, created_by
               ) VALUES (%s::uuid, %s, %s, %s, %s, %s, %s::uuid) RETURNING *""",
            (workspace_id, name, data.get('alias'), data.get('description'), data.get('database_type', 'enterprise'), data.get('default_crs', 'EPSG:4326'), user_id),
        )
        row = dict(cur.fetchone()); row['layer_count'] = 0; row['feature_dataset_count'] = 0
        db.commit()
        return jsonify(_serialize_geodatabase(row)), 201
    cur.execute(
        """SELECT id FROM geodatabases
           WHERE created_by = %s::uuid AND workspace_id IS NULL LIMIT 1""",
        (user_id,),
    )
    if not cur.fetchone():
        cur.execute(
            """INSERT INTO geodatabases
                   (name, alias, description, database_type, created_by)
               VALUES ('My Geodatabase', 'My Geodatabase',
                       'Default personal catalog container.', 'project', %s::uuid)""",
            (user_id,),
        )
        db.commit()
    cur.execute(
        """SELECT g.*,
                  (SELECT COUNT(*) FROM layers l WHERE l.geodatabase_id = g.id) AS layer_count,
                  (SELECT COUNT(*) FROM feature_datasets fd WHERE fd.geodatabase_id = g.id) AS feature_dataset_count
           FROM geodatabases g
           WHERE g.created_by = %s::uuid
              OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = g.workspace_id AND wm.user_id = %s::uuid)
           ORDER BY g.name""",
        (user_id, user_id),
    )
    return jsonify([_serialize_geodatabase(row) for row in cur.fetchall()])


@catalog_bp.route('/geodatabases/<geodatabase_id>/feature-datasets', methods=['GET', 'POST'])
@jwt_required()
def feature_datasets(geodatabase_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """SELECT g.* FROM geodatabases g
           WHERE g.id = %s::uuid AND (
               g.created_by = %s::uuid OR EXISTS (
                   SELECT 1 FROM workspace_members wm
                   WHERE wm.workspace_id = g.workspace_id AND wm.user_id = %s::uuid
               )
           )""",
        (geodatabase_id, user_id, user_id),
    )
    geodatabase = cur.fetchone()
    if not geodatabase:
        return jsonify({'error': 'Geodatabase not found'}), 404
    if request.method == 'POST':
        if geodatabase['created_by'] and str(geodatabase['created_by']) != user_id:
            cur.execute(
                """SELECT role FROM workspace_members
                   WHERE workspace_id = %s::uuid AND user_id = %s::uuid""",
                (geodatabase.get('workspace_id'), user_id),
            )
            member = cur.fetchone()
            if not member or member['role'] not in {'owner', 'admin', 'editor'}:
                return jsonify({'error': 'Permission denied'}), 404
        data = request.get_json() or {}
        name = str(data.get('name', '')).strip()
        if not name:
            return jsonify({'error': 'name is required'}), 400
        crs = str(data.get('crs') or geodatabase['default_crs'])
        cur.execute(
            'SELECT id FROM feature_datasets WHERE geodatabase_id = %s::uuid AND LOWER(name) = LOWER(%s)',
            (geodatabase_id, name),
        )
        if cur.fetchone():
            return jsonify({'error': 'A feature dataset with this name already exists in this geodatabase'}), 409
        cur.execute(
            """INSERT INTO feature_datasets (geodatabase_id, name, alias, description, crs, created_by)
               VALUES (%s::uuid, %s, %s, %s, %s, %s::uuid) RETURNING *""",
            (geodatabase_id, name, data.get('alias'), data.get('description'), crs, user_id),
        )
        row = dict(cur.fetchone()); row['layer_count'] = 0; db.commit()
        return jsonify(_serialize_feature_dataset(row)), 201
    cur.execute(
        """SELECT fd.*, (SELECT COUNT(*) FROM layers l WHERE l.feature_dataset_id = fd.id) AS layer_count
           FROM feature_datasets fd WHERE fd.geodatabase_id = %s::uuid ORDER BY fd.name""",
        (geodatabase_id,),
    )
    return jsonify([_serialize_feature_dataset(row) for row in cur.fetchall()])
