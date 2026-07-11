import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db
from field_schema import (
    FieldSchemaError,
    fetch_layer_fields,
    parse_layer_access,
    validate_properties_with_fields,
)
from enterprise_utils import add_feature_history, invalidate_layer_tile_cache, log_audit
from spatial_validation import GeometryValidationError, validate_geojson_geometry

ingestion_bp = Blueprint('ingestion', __name__)


@ingestion_bp.route('/<layer_id>/upload', methods=['POST'])
@jwt_required()
def upload_geojson(layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    access = parse_layer_access(cur, layer_id, user_id)
    if not access.exists:
        return jsonify({'error': 'Layer not found'}), 404
    if not access.is_owner:
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
        if not cur.fetchone():
            return jsonify({'error': 'Layer not found or permission denied'}), 404

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

    layer_fields = fetch_layer_fields(cur, layer_id)
    cur.execute('SELECT geometry_type FROM layers WHERE id = %s::uuid', (layer_id,))
    layer_row = cur.fetchone()
    expected_family = str((layer_row or {}).get('geometry_type') or '').lower()
    inserted = errors = 0
    for feature in features:
        geom = feature.get('geometry')
        props = feature.get('properties') or {}
        if not geom:
            errors += 1
            continue

        try:
            cur.execute("SAVEPOINT sp")
            normalized_geom = validate_geojson_geometry(cur, geom).geometry
            actual_type = str(normalized_geom.get('type') or '').lower()
            if expected_family and expected_family != 'mixed':
                family_matches = (
                    ('point' in expected_family and 'point' in actual_type)
                    or ('line' in expected_family and 'line' in actual_type)
                    or ('polygon' in expected_family and 'polygon' in actual_type)
                )
                if not family_matches:
                    raise GeometryValidationError(
                        f'Layer geometry type mismatch: expected {expected_family}, got {actual_type}'
                    )
            prepared_props = validate_properties_with_fields(layer_fields, props)
            cur.execute("""
                INSERT INTO features (layer_id, geometry, properties, created_by)
                VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s::uuid)
                RETURNING id, version, ST_AsGeoJSON(geometry) AS geometry, properties
            """, (layer_id, json.dumps(normalized_geom), json.dumps(prepared_props), user_id))
            inserted_row = cur.fetchone()
            add_feature_history(
                cur,
                feature_id=str(inserted_row['id']),
                layer_id=layer_id,
                version=int(inserted_row['version']),
                geometry_geojson=inserted_row['geometry'],
                properties=inserted_row['properties'],
                change_type='create',
                changed_by=user_id,
            )
            cur.execute("RELEASE SAVEPOINT sp")
            inserted += 1
        except (FieldSchemaError, GeometryValidationError):
            cur.execute("ROLLBACK TO SAVEPOINT sp")
            cur.execute("RELEASE SAVEPOINT sp")
            errors += 1
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT sp")
            cur.execute("RELEASE SAVEPOINT sp")
            errors += 1

    if inserted:
        invalidate_layer_tile_cache(cur, layer_id)
    log_audit(
        cur,
        user_id=user_id,
        action='layer_upload_geojson',
        entity_type='layer',
        entity_id=layer_id,
        layer_id=layer_id,
        payload={'inserted': inserted, 'errors': errors},
    )
    db.commit()
    return jsonify({'inserted': inserted, 'errors': errors})
