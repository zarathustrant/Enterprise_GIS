import json
from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db
from enterprise_utils import invalidate_layer_tile_cache, log_audit

layers_bp = Blueprint('layers', __name__)


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

    db = get_db()
    cur = db.cursor()
    cur.execute("""
        INSERT INTO layers
            (name, description, geometry_type, crs, style, min_zoom, max_zoom, is_public, group_name, z_index, workspace_id, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid, %s::uuid)
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
        "SELECT id FROM layers WHERE id = %s AND created_by = %s::uuid",
        (layer_id, user_id)
    )
    if not cur.fetchone():
        return jsonify({'error': 'Layer not found or permission denied'}), 404

    allowed = ['name', 'description', 'geometry_type', 'crs', 'min_zoom', 'max_zoom', 'is_public', 'group_name', 'z_index', 'workspace_id']
    fields, values = [], []
    for f in allowed:
        if f in data:
            fields.append(f"{f} = %s")
            values.append(data[f])
    if 'style' in data:
        fields.append("style = %s")
        values.append(json.dumps(data['style']))
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
    cur.execute(
        "DELETE FROM layers WHERE id = %s AND created_by = %s::uuid RETURNING id",
        (layer_id, get_jwt_identity())
    )
    if not cur.fetchone():
        return jsonify({'error': 'Layer not found or permission denied'}), 404
    log_audit(
        cur,
        user_id=get_jwt_identity(),
        action='layer_deleted',
        entity_type='layer',
        entity_id=layer_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify({'message': 'Layer deleted'})
