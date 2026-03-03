import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db

features_bp = Blueprint('features', __name__)


def _layer_accessible(cur, layer_id, user_id):
    cur.execute(
        "SELECT id FROM layers WHERE id = %s AND (is_public = TRUE OR created_by = %s::uuid)",
        (layer_id, user_id)
    )
    return cur.fetchone() is not None


def _serialize_feature(row):
    return {
        'type': 'Feature',
        'id': str(row['id']),
        'geometry': json.loads(row['geometry']),
        'properties': {
            **row['properties'],
            '_version': row['version'],
            '_created_at': row['created_at'].isoformat(),
            '_updated_at': row['updated_at'].isoformat(),
        },
    }


@features_bp.route('/<layer_id>/features', methods=['GET'])
@jwt_required(optional=True)
def get_features(layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404

    where = ["f.layer_id = %s"]
    params = [layer_id]

    # Bounding box filter: ?bbox=minX,minY,maxX,maxY
    bbox = request.args.get('bbox')
    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(','))
        except ValueError:
            return jsonify({'error': 'bbox must be: minX,minY,maxX,maxY'}), 400
        where.append("f.geometry && ST_MakeEnvelope(%s, %s, %s, %s, 4326)")
        params += [minx, miny, maxx, maxy]

    # Spatial intersection filter: ?intersects=<GeoJSON geometry>
    intersects = request.args.get('intersects')
    if intersects:
        try:
            json.loads(intersects)  # validate JSON
        except json.JSONDecodeError:
            return jsonify({'error': 'intersects must be a valid GeoJSON geometry'}), 400
        where.append("ST_Intersects(f.geometry, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))")
        params.append(intersects)

    limit = min(int(request.args.get('limit', 1000)), 10000)
    offset = int(request.args.get('offset', 0))

    cur.execute(f"""
        SELECT f.id, f.layer_id,
               ST_AsGeoJSON(f.geometry) AS geometry,
               f.properties, f.version, f.created_at, f.updated_at
        FROM features f
        WHERE {' AND '.join(where)}
        ORDER BY f.created_at DESC
        LIMIT %s OFFSET %s
    """, params + [limit, offset])

    return jsonify({
        'type': 'FeatureCollection',
        'features': [_serialize_feature(r) for r in cur.fetchall()],
    })


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

    try:
        cur.execute("""
            INSERT INTO features (layer_id, geometry, properties, created_by)
            VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s::uuid)
            RETURNING id, ST_AsGeoJSON(geometry) AS geometry,
                      properties, version, created_at, updated_at
        """, (layer_id, json.dumps(geometry), json.dumps(data.get('properties', {})), user_id))
        r = cur.fetchone()
        db.commit()
    except Exception as e:
        db.rollback()
        return jsonify({'error': f'Invalid geometry: {e}'}), 400

    return jsonify(_serialize_feature(r)), 201


@features_bp.route('/<layer_id>/features/<feature_id>', methods=['PUT'])
@jwt_required()
def update_feature(layer_id, feature_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404

    cur.execute(
        "SELECT version FROM features WHERE id = %s AND layer_id = %s",
        (feature_id, layer_id)
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Feature not found'}), 404

    # Optimistic locking: reject stale writes
    client_version = data.get('version')
    if client_version is not None and row['version'] != int(client_version):
        return jsonify({
            'error': 'Conflict: feature was modified by another user',
            'server_version': row['version'],
        }), 409

    geometry = data.get('geometry')
    properties = data.get('properties')
    props_json = json.dumps(properties) if properties is not None else None

    if geometry is not None:
        cur.execute("""
            UPDATE features
            SET geometry   = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                properties = COALESCE(%s::jsonb, properties),
                version    = version + 1,
                updated_at = NOW()
            WHERE id = %s AND layer_id = %s
            RETURNING id, ST_AsGeoJSON(geometry) AS geometry,
                      properties, version, created_at, updated_at
        """, (json.dumps(geometry), props_json, feature_id, layer_id))
    else:
        cur.execute("""
            UPDATE features
            SET properties = COALESCE(%s::jsonb, properties),
                version    = version + 1,
                updated_at = NOW()
            WHERE id = %s AND layer_id = %s
            RETURNING id, ST_AsGeoJSON(geometry) AS geometry,
                      properties, version, created_at, updated_at
        """, (props_json, feature_id, layer_id))

    r = cur.fetchone()
    db.commit()
    return jsonify(_serialize_feature(r))


@features_bp.route('/<layer_id>/features/<feature_id>', methods=['DELETE'])
@jwt_required()
def delete_feature(layer_id, feature_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    if not _layer_accessible(cur, layer_id, user_id):
        return jsonify({'error': 'Layer not found'}), 404

    cur.execute(
        "DELETE FROM features WHERE id = %s AND layer_id = %s RETURNING id",
        (feature_id, layer_id)
    )
    if not cur.fetchone():
        return jsonify({'error': 'Feature not found'}), 404
    db.commit()
    return jsonify({'message': 'Feature deleted'})
