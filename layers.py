import json
from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db
from enterprise_utils import invalidate_layer_tile_cache, log_audit
from style_validation import StyleValidationError, validate_layer_style

layers_bp = Blueprint('layers', __name__)


def _resolve_catalog_container(cur, user_id, data, current=None):
    current = current or {}
    geodatabase_id = data.get('geodatabase_id', current.get('geodatabase_id'))
    feature_dataset_id = data.get('feature_dataset_id', current.get('feature_dataset_id'))
    crs = str(data.get('crs', current.get('crs') or 'EPSG:4326'))
    if 'geodatabase_id' in data and not geodatabase_id and 'feature_dataset_id' not in data:
        feature_dataset_id = None

    if feature_dataset_id:
        cur.execute(
            """SELECT fd.*, g.workspace_id, g.created_by AS geodatabase_owner
               FROM feature_datasets fd
               JOIN geodatabases g ON g.id = fd.geodatabase_id
               WHERE fd.id = %s::uuid AND (
                   g.created_by = %s::uuid OR EXISTS (
                       SELECT 1 FROM workspace_members wm
                       WHERE wm.workspace_id = g.workspace_id
                         AND wm.user_id = %s::uuid
                         AND wm.role IN ('owner', 'admin', 'editor')
                   )
               )""",
            (feature_dataset_id, user_id, user_id),
        )
        dataset = cur.fetchone()
        if not dataset:
            raise ValueError('Feature dataset not found or permission denied')
        if geodatabase_id and str(dataset['geodatabase_id']) != str(geodatabase_id):
            raise ValueError('Feature dataset does not belong to the selected geodatabase')
        if dataset['crs'].upper() != crs.upper():
            raise ValueError(
                f'Layer CRS {crs} must match feature dataset CRS {dataset["crs"]}. '
                'Reproject the layer before moving it.'
            )
        geodatabase_id = str(dataset['geodatabase_id'])
    elif geodatabase_id:
        cur.execute(
            """SELECT id FROM geodatabases g
               WHERE g.id = %s::uuid AND (
                   g.created_by = %s::uuid OR EXISTS (
                       SELECT 1 FROM workspace_members wm
                       WHERE wm.workspace_id = g.workspace_id
                         AND wm.user_id = %s::uuid
                         AND wm.role IN ('owner', 'admin', 'editor')
                   )
               )""",
            (geodatabase_id, user_id, user_id),
        )
        if not cur.fetchone():
            raise ValueError('Geodatabase not found or permission denied')
    elif not current:
        cur.execute(
            """SELECT id FROM geodatabases
               WHERE created_by = %s::uuid AND workspace_id IS NULL
               ORDER BY created_at LIMIT 1""",
            (user_id,),
        )
        personal = cur.fetchone()
        if not personal:
            cur.execute(
                """INSERT INTO geodatabases
                       (name, alias, description, database_type, created_by)
                   VALUES ('My Geodatabase', 'My Geodatabase',
                           'Default personal catalog container.', 'project', %s::uuid)
                   RETURNING id""",
                (user_id,),
            )
            personal = cur.fetchone()
        geodatabase_id = str(personal['id'])

    return geodatabase_id, feature_dataset_id


def _serialize(r):
    return {
        'id': str(r['id']),
        'name': r['name'],
        'description': r['description'],
        'geometry_type': r['geometry_type'],
        'crs': r['crs'],
        'style': r['style'],
        'min_zoom': r['min_zoom'],
        'max_zoom': r['max_zoom'],
        'is_public': r['is_public'],
        'group_name': r.get('group_name'),
        'z_index': r.get('z_index', 0),
        'workspace_id': str(r['workspace_id']) if r.get('workspace_id') else None,
        'geodatabase_id': str(r['geodatabase_id']) if r.get('geodatabase_id') else None,
        'feature_dataset_id': str(r['feature_dataset_id']) if r.get('feature_dataset_id') else None,
        'catalog_status': r.get('catalog_status', 'draft'),
        'tags': r.get('tags') or [],
        'thumbnail_key': r.get('thumbnail_key'),
        'metadata': r.get('metadata') or {},
        'created_by': r.get('created_by'),
        'created_at': r['created_at'].isoformat(),
        'updated_at': r['updated_at'].isoformat(),
    }


@layers_bp.route('', methods=['GET'])
@jwt_required(optional=True)
def list_layers():
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    if user_id:
        cur.execute("""
            SELECT l.*, u.username AS created_by
            FROM layers l LEFT JOIN users u ON u.id = l.created_by
            WHERE l.is_public = TRUE
               OR l.created_by = %s::uuid
               OR EXISTS (
                    SELECT 1
                    FROM workspace_layers wl
                    JOIN workspace_members wm ON wm.workspace_id = wl.workspace_id
                    WHERE wl.layer_id = l.id
                      AND wm.user_id = %s::uuid
               )
            ORDER BY l.group_name ASC NULLS LAST, l.z_index DESC, l.created_at DESC
        """, (user_id, user_id))
    else:
        cur.execute("""
            SELECT l.*, u.username AS created_by
            FROM layers l LEFT JOIN users u ON u.id = l.created_by
            WHERE l.is_public = TRUE
            ORDER BY l.group_name ASC NULLS LAST, l.z_index DESC, l.created_at DESC
        """)

    return jsonify([_serialize(r) for r in cur.fetchall()])


@layers_bp.route('', methods=['POST'])
@jwt_required()
def create_layer():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    try:
        validate_layer_style(data.get('style', {}))
    except StyleValidationError as exc:
        return jsonify({'error': 'Invalid layer style', 'details': exc.errors}), 400

    db = get_db()
    cur = db.cursor()
    if data.get('catalog_status', 'draft') not in {'draft', 'authoritative', 'deprecated'}:
        return jsonify({'error': 'Invalid catalog_status'}), 400
    if not isinstance(data.get('tags', []), list) or not all(isinstance(tag, str) for tag in data.get('tags', [])):
        return jsonify({'error': 'tags must be an array of strings'}), 400
    try:
        geodatabase_id, feature_dataset_id = _resolve_catalog_container(cur, get_jwt_identity(), data)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    cur.execute("""
        INSERT INTO layers
            (name, description, geometry_type, crs, style, min_zoom, max_zoom,
             is_public, group_name, z_index, workspace_id, geodatabase_id,
             feature_dataset_id, catalog_status, tags, thumbnail_key, metadata, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid, %s::uuid,
                %s::uuid, %s, %s::text[], %s, %s::jsonb, %s::uuid)
        RETURNING *, NULL AS created_by
    """, (
        name,
        data.get('description'),
        data.get('geometry_type'),
        data.get('crs', 'EPSG:4326'),
        json.dumps(data.get('style', {})),
        data.get('min_zoom', 0),
        data.get('max_zoom', 22),
        data.get('is_public', False),
        data.get('group_name', 'Default'),
        data.get('z_index', 0),
        data.get('workspace_id'),
        geodatabase_id,
        feature_dataset_id,
        data.get('catalog_status', 'draft'),
        data.get('tags') or [],
        data.get('thumbnail_key'),
        json.dumps(data.get('metadata') or {}),
        get_jwt_identity(),
    ))
    # Re-query to get username
    layer_id = cur.fetchone()['id']
    cur.execute("""
        SELECT l.*, u.username AS created_by
        FROM layers l LEFT JOIN users u ON u.id = l.created_by
        WHERE l.id = %s
    """, (layer_id,))
    created = cur.fetchone()
    log_audit(
        cur,
        user_id=get_jwt_identity(),
        action='layer_created',
        entity_type='layer',
        entity_id=str(layer_id),
        layer_id=str(layer_id),
        payload={'name': name},
    )
    db.commit()
    return jsonify(_serialize(created)), 201


@layers_bp.route('/<layer_id>', methods=['GET'])
@jwt_required(optional=True)
def get_layer(layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    if user_id:
        cur.execute("""
            SELECT l.*, u.username AS created_by
            FROM layers l LEFT JOIN users u ON u.id = l.created_by
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
        """, (layer_id, user_id, user_id))
    else:
        cur.execute("""
            SELECT l.*, u.username AS created_by
            FROM layers l LEFT JOIN users u ON u.id = l.created_by
            WHERE l.id = %s::uuid AND l.is_public = TRUE
        """, (layer_id,))
    r = cur.fetchone()
    if not r:
        return jsonify({'error': 'Layer not found'}), 404
    return jsonify(_serialize(r))


@layers_bp.route('/<layer_id>', methods=['PUT'])
@jwt_required()
def update_layer(layer_id):
    data = request.get_json() or {}
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    cur.execute(
        "SELECT * FROM layers WHERE id = %s AND created_by = %s::uuid",
        (layer_id, user_id)
    )
    current = cur.fetchone()
    if not current:
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    if 'catalog_status' in data and data['catalog_status'] not in {'draft', 'authoritative', 'deprecated'}:
        return jsonify({'error': 'Invalid catalog_status'}), 400
    if 'tags' in data and (not isinstance(data['tags'], list) or not all(isinstance(tag, str) for tag in data['tags'])):
        return jsonify({'error': 'tags must be an array of strings'}), 400
    if any(field in data for field in ('geodatabase_id', 'feature_dataset_id', 'crs')):
        try:
            geodatabase_id, feature_dataset_id = _resolve_catalog_container(cur, user_id, data, current)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        data['geodatabase_id'] = geodatabase_id
        data['feature_dataset_id'] = feature_dataset_id

    allowed = [
        'name', 'description', 'geometry_type', 'crs', 'min_zoom', 'max_zoom',
        'is_public', 'group_name', 'z_index', 'workspace_id', 'geodatabase_id',
        'feature_dataset_id', 'catalog_status', 'tags', 'thumbnail_key',
    ]
    fields, values = [], []
    for f in allowed:
        if f in data:
            fields.append(f"{f} = %s")
            values.append(data[f])
    if 'style' in data:
        try:
            validate_layer_style(data['style'])
        except StyleValidationError as exc:
            return jsonify({'error': 'Invalid layer style', 'details': exc.errors}), 400
        fields.append("style = %s")
        values.append(json.dumps(data['style']))
    if 'metadata' in data:
        fields.append("metadata = %s::jsonb")
        values.append(json.dumps(data['metadata'] or {}))
    if not fields:
        return jsonify({'error': 'No valid fields to update'}), 400

    fields.append("updated_at = NOW()")
    cur.execute(
        f"UPDATE layers SET {', '.join(fields)} WHERE id = %s AND created_by = %s::uuid RETURNING *",
        values + [layer_id, user_id]
    )
    r = dict(cur.fetchone())
    r['created_by'] = None
    invalidate_layer_tile_cache(cur, layer_id)
    log_audit(
        cur,
        user_id=user_id,
        action='layer_updated',
        entity_type='layer',
        entity_id=layer_id,
        layer_id=layer_id,
        payload={'fields': list(data.keys())},
    )
    db.commit()
    return jsonify(_serialize(r))


@layers_bp.route('/<layer_id>/export', methods=['GET'])
@jwt_required(optional=True)
def export_layer(layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    cur.execute(
        "SELECT name FROM layers WHERE id = %s AND (is_public = TRUE OR created_by = %s::uuid)",
        (layer_id, user_id)
    )
    layer = cur.fetchone()
    if not layer:
        return jsonify({'error': 'Layer not found'}), 404

    cur.execute("""
        SELECT f.id, ST_AsGeoJSON(f.geometry) AS geometry, f.properties
        FROM features f
        WHERE f.layer_id = %s
        ORDER BY f.created_at
    """, (layer_id,))

    fc = json.dumps({
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'id': str(r['id']),
            'geometry': json.loads(r['geometry']),
            'properties': r['properties'],
        } for r in cur.fetchall()],
    }, indent=2)

    filename = layer['name'].replace(' ', '_')
    return Response(
        fc,
        mimetype='application/geo+json',
        headers={'Content-Disposition': f'attachment; filename="{filename}.geojson"'},
    )


@layers_bp.route('/<layer_id>', methods=['DELETE'])
@jwt_required()
def delete_layer(layer_id):
    db = get_db()
    cur = db.cursor()
    user_id = get_jwt_identity()
    cur.execute(
        "SELECT id FROM layers WHERE id = %s::uuid AND created_by = %s::uuid",
        (layer_id, user_id),
    )
    if not cur.fetchone():
        return jsonify({'error': 'Layer not found or permission denied'}), 404
    cur.execute(
        """SELECT COUNT(*) AS count, ARRAY_AGG(DISTINCT map_id) AS map_ids
           FROM map_layers WHERE source_layer_id = %s::uuid""",
        (layer_id,),
    )
    references = cur.fetchone()
    reference_count = int(references['count'] or 0)
    force_references = request.args.get('force_map_references', '').lower() == 'true'
    if reference_count and not force_references:
        return jsonify({
            'error': (
                f'Layer is used by {reference_count} map item(s). Remove it from those maps, '
                'or explicitly confirm source deletion.'
            ),
            'map_reference_count': reference_count,
        }), 409
    if reference_count:
        map_ids = references.get('map_ids') or []
        cur.execute('DELETE FROM map_layers WHERE source_layer_id = %s::uuid', (layer_id,))
        cur.execute(
            'UPDATE maps SET revision = revision + 1, updated_at = NOW() WHERE id = ANY(%s::uuid[])',
            (map_ids,),
        )
    log_audit(
        cur,
        user_id=user_id,
        action='layer_deleted',
        entity_type='layer',
        entity_id=layer_id,
        layer_id=layer_id,
        payload={'removed_map_references': reference_count},
    )
    cur.execute(
        "DELETE FROM layers WHERE id = %s AND created_by = %s::uuid RETURNING id",
        (layer_id, user_id)
    )
    if not cur.fetchone():
        return jsonify({'error': 'Layer not found or permission denied'}), 404
    db.commit()
    return jsonify({'message': 'Layer deleted'})
