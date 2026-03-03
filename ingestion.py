import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db

ingestion_bp = Blueprint('ingestion', __name__)


@ingestion_bp.route('/<layer_id>/upload', methods=['POST'])
@jwt_required()
def upload_geojson(layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    cur.execute(
        "SELECT id FROM layers WHERE id = %s AND (is_public = TRUE OR created_by = %s::uuid)",
        (layer_id, user_id)
    )
    if not cur.fetchone():
        return jsonify({'error': 'Layer not found'}), 404

    # Accept multipart file upload or raw JSON body
    if request.files.get('file'):
        f = request.files['file']
        if not f.filename.lower().endswith('.geojson'):
            return jsonify({'error': 'Only .geojson files are accepted'}), 400
        try:
            data = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return jsonify({'error': 'Invalid GeoJSON file'}), 400
    elif request.is_json:
        data = request.get_json()
    else:
        return jsonify({'error': 'Provide a .geojson file or a JSON body'}), 400

    ftype = data.get('type', '')
    if ftype == 'Feature':
        features = [data]
    elif ftype == 'FeatureCollection':
        features = data.get('features', [])
    else:
        return jsonify({'error': 'Root type must be Feature or FeatureCollection'}), 400

    inserted = errors = 0
    for feature in features:
        geom = feature.get('geometry')
        props = feature.get('properties') or {}
        if not geom:
            errors += 1
            continue
        try:
            cur.execute("SAVEPOINT sp")
            cur.execute("""
                INSERT INTO features (layer_id, geometry, properties, created_by)
                VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s::uuid)
            """, (layer_id, json.dumps(geom), json.dumps(props), user_id))
            cur.execute("RELEASE SAVEPOINT sp")
            inserted += 1
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT sp")
            cur.execute("RELEASE SAVEPOINT sp")
            errors += 1

    db.commit()
    return jsonify({'inserted': inserted, 'errors': errors})
