import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db

analysis_bp = Blueprint('analysis', __name__)


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
        "SELECT id, name FROM layers WHERE id = %s AND (is_public = TRUE OR created_by = %s::uuid)",
        (layer_id, user_id)
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
    data      = request.get_json() or {}
    layer_id  = data.get('layer_id')
    distance  = data.get('distance')   # metres
    out_name  = (data.get('output_name') or 'Buffer').strip()
    user_id   = get_jwt_identity()

    if not layer_id or distance is None:
        return jsonify({'error': 'layer_id and distance are required'}), 400
    try:
        distance = float(distance)
    except (TypeError, ValueError):
        return jsonify({'error': 'distance must be a number'}), 400
    if distance <= 0:
        return jsonify({'error': 'distance must be positive'}), 400

    db  = get_db()
    cur = db.cursor()

    src = _check_layer(cur, layer_id, user_id)
    if not src:
        return jsonify({'error': 'Source layer not found'}), 404

    out_id = _new_layer(
        cur, out_name,
        f'Buffer {distance} m of "{src["name"]}"', 'Polygon', user_id
    )

    # Use ::geography for accurate metre-based buffering, cast result back to geometry
    cur.execute("""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s,
               ST_Buffer(geometry::geography, %s)::geometry,
               properties,
               %s::uuid
        FROM features
        WHERE layer_id = %s
    """, (out_id, distance, user_id, layer_id))
    count = cur.rowcount
    db.commit()

    return jsonify({'layer': _serialize_layer(_fetch_layer_full(cur, out_id)), 'count': count}), 201


# ── Intersect ─────────────────────────────────────────────────────────────────

@analysis_bp.route('/intersect', methods=['POST'])
@jwt_required()
def intersect():
    data     = request.get_json() or {}
    layer_a  = data.get('layer_a')
    layer_b  = data.get('layer_b')
    out_name = (data.get('output_name') or 'Intersection').strip()
    user_id  = get_jwt_identity()

    if not layer_a or not layer_b:
        return jsonify({'error': 'layer_a and layer_b are required'}), 400

    db  = get_db()
    cur = db.cursor()

    for lid in (layer_a, layer_b):
        if not _check_layer(cur, lid, user_id):
            return jsonify({'error': f'Layer {lid} not found'}), 404

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

    if not layer_id or not polygon:
        return jsonify({'error': 'layer_id and polygon are required'}), 400

    db  = get_db()
    cur = db.cursor()

    if not _check_layer(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404

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

    return jsonify({'type': 'FeatureCollection', 'features': features})
