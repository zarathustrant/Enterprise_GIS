import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db

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
            WHERE l.is_public = TRUE OR l.created_by = %s::uuid
            ORDER BY l.created_at DESC
        """, (user_id,))
    else:
        cur.execute("""
            SELECT l.*, u.username AS created_by
            FROM layers l LEFT JOIN users u ON u.id = l.created_by
            WHERE l.is_public = TRUE
            ORDER BY l.created_at DESC
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
            (name, description, geometry_type, crs, style, min_zoom, max_zoom, is_public, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::uuid)
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
        get_jwt_identity(),
    ))
    # Re-query to get username
    layer_id = cur.fetchone()['id']
    cur.execute("""
        SELECT l.*, u.username AS created_by
        FROM layers l LEFT JOIN users u ON u.id = l.created_by
        WHERE l.id = %s
    """, (layer_id,))
    db.commit()
    return jsonify(_serialize(cur.fetchone())), 201


@layers_bp.route('/<layer_id>', methods=['GET'])
@jwt_required(optional=True)
def get_layer(layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()
    cur.execute("""
        SELECT l.*, u.username AS created_by
        FROM layers l LEFT JOIN users u ON u.id = l.created_by
        WHERE l.id = %s AND (l.is_public = TRUE OR l.created_by = %s::uuid)
    """, (layer_id, user_id))
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

    allowed = ['name', 'description', 'geometry_type', 'crs', 'min_zoom', 'max_zoom', 'is_public']
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
    db.commit()
    return jsonify(_serialize(r))


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
    db.commit()
    return jsonify({'message': 'Layer deleted'})
