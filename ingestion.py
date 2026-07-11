import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Any
import zipfile

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db import get_db
from enterprise_utils import add_feature_history, invalidate_layer_tile_cache, log_audit
from field_schema import (
    fetch_layer_fields,
    parse_layer_access,
    validate_properties_with_fields,
)
from spatial_validation import GeometryValidationError, validate_geojson_geometry

ingestion_bp = Blueprint('ingestion', __name__)

MAX_UPLOAD_BYTES = 250 * 1024 * 1024
MAX_FEATURES = 100_000
OGR_TIMEOUT_SECONDS = 300
SUPPORTED_EXTENSIONS = {
    '.geojson', '.json', '.kml', '.kmz', '.zip', '.csv', '.gpkg',
    '.gml', '.gpx', '.fgb', '.dxf', '.tab', '.mif', '.sqlite',
}


class IngestionError(ValueError):
    pass


def _save_upload(upload, destination: Path) -> None:
    total = 0
    with destination.open('wb') as output:
        while True:
            chunk = upload.stream.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise IngestionError('Upload exceeds the 250 MB limit')
            output.write(chunk)


def _run_ogr(command: list[str]) -> subprocess.CompletedProcess[str]:
    if not shutil.which(command[0]):
        raise IngestionError('The server image does not include GDAL/OGR. Rebuild the API image.')
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=OGR_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise IngestionError('Import conversion exceeded the five-minute limit') from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or 'OGR could not read the dataset').strip()
        raise IngestionError(detail[-2000:]) from exc


def _ogr_source_path(path: Path) -> str:
    if path.suffix.lower() == '.kmz':
        try:
            with zipfile.ZipFile(path) as archive:
                members = [
                    name for name in archive.namelist()
                    if name.lower().endswith('.kml')
                    and not name.startswith(('/', '\\'))
                    and '..' not in Path(name).parts
                ]
        except (OSError, zipfile.BadZipFile) as exc:
            raise IngestionError('Invalid KMZ archive') from exc
        if not members:
            raise IngestionError('KMZ archive does not contain a KML document')
        preferred = next((name for name in members if Path(name).name.lower() == 'doc.kml'), members[0])
        return f'/vsizip/{path}/{preferred}'
    if path.suffix.lower() == '.zip':
        try:
            with zipfile.ZipFile(path) as archive:
                members = [
                    name for name in archive.namelist()
                    if not name.startswith(('/', '\\')) and '..' not in Path(name).parts
                ]
        except (OSError, zipfile.BadZipFile) as exc:
            raise IngestionError('Invalid ZIP archive') from exc
        gdb_roots = sorted({
            '/'.join(Path(name).parts[:index + 1])
            for name in members
            for index, part in enumerate(Path(name).parts)
            if part.lower().endswith('.gdb')
        })
        if gdb_roots:
            return f'/vsizip/{path}/{gdb_roots[0]}'
        return f'/vsizip/{path}'
    return str(path)


def _discover_ogr_layers(source: str) -> list[str]:
    result = _run_ogr(['ogrinfo', '-ro', '-q', source])
    layers: list[str] = []
    for line in result.stdout.splitlines():
        match = re.match(r'^\s*\d+\s*:\s*(.+?)(?:\s+\([^()]+\))?\s*$', line)
        if match:
            layers.append(match.group(1).strip())
    return layers


def _convert_with_ogr(
    source_path: Path,
    output_path: Path,
    *,
    source_crs: str | None,
    source_layer: str | None,
) -> tuple[dict[str, Any], str | None]:
    source = _ogr_source_path(source_path)
    layers = _discover_ogr_layers(source)
    selected_layer = source_layer or (layers[0] if layers else None)
    if source_layer and source_layer not in layers:
        raise IngestionError(f'Source layer "{source_layer}" was not found')

    command = [
        'ogr2ogr', '-f', 'GeoJSON', str(output_path), source,
        '-t_srs', 'EPSG:4326', '-lco', 'RFC7946=YES',
        '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures',
    ]
    if source_crs:
        command.extend(['-s_srs', source_crs])
    elif source_path.suffix.lower() == '.csv':
        command.extend(['-s_srs', 'EPSG:4326'])
    if source_path.suffix.lower() == '.csv':
        command.extend([
            '-oo', 'X_POSSIBLE_NAMES=longitude,lon,lng,x,easting',
            '-oo', 'Y_POSSIBLE_NAMES=latitude,lat,y,northing',
            '-oo', 'GEOM_POSSIBLE_NAMES=wkt,geometry,geom',
            '-oo', 'KEEP_GEOM_COLUMNS=NO',
        ])
    if selected_layer:
        command.append(selected_layer)

    _run_ogr(command)
    try:
        with output_path.open(encoding='utf-8') as converted:
            return json.load(converted), selected_layer
    except (OSError, json.JSONDecodeError) as exc:
        raise IngestionError('OGR produced an invalid converted dataset') from exc


def _load_uploaded_dataset(upload, source_crs: str | None, source_layer: str | None):
    original_name = Path(upload.filename or '').name
    extension = Path(original_name).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        supported = ', '.join(sorted(SUPPORTED_EXTENSIONS))
        raise IngestionError(f'Unsupported file type. Supported extensions: {supported}')

    with tempfile.TemporaryDirectory(prefix='enterprise-gis-import-') as temp_dir:
        source_path = Path(temp_dir) / f'source{extension}'
        output_path = Path(temp_dir) / 'converted.geojson'
        _save_upload(upload, source_path)

        if extension in {'.geojson', '.json'} and not source_crs:
            try:
                with source_path.open(encoding='utf-8') as source:
                    return json.load(source), None, original_name
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise IngestionError('Invalid GeoJSON file') from exc

        data, selected_layer = _convert_with_ogr(
            source_path,
            output_path,
            source_crs=source_crs,
            source_layer=source_layer,
        )
        return data, selected_layer, original_name


def _feature_list(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise IngestionError('Dataset root must be a GeoJSON object')
    if data.get('type') == 'Feature':
        return [data]
    if data.get('type') == 'FeatureCollection' and isinstance(data.get('features'), list):
        features = data['features']
        if len(features) > MAX_FEATURES:
            raise IngestionError(f'Import exceeds the {MAX_FEATURES:,}-feature synchronous limit')
        return features
    raise IngestionError('Dataset must contain a Feature or FeatureCollection')


@ingestion_bp.route('/<layer_id>/upload', methods=['POST'])
@jwt_required()
def upload_dataset(layer_id):
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
            WHERE wl.layer_id = %s::uuid AND wm.user_id = %s::uuid
              AND wm.role IN ('owner', 'editor', 'admin')
            LIMIT 1
            """,
            (layer_id, user_id),
        )
        if not cur.fetchone():
            return jsonify({'error': 'Layer not found or permission denied'}), 404

    try:
        source_crs = str(request.form.get('source_crs', '')).strip() or None
        source_layer = str(request.form.get('source_layer', '')).strip() or None
        if request.files.get('file'):
            data, selected_layer, original_name = _load_uploaded_dataset(
                request.files['file'], source_crs, source_layer,
            )
        elif request.is_json:
            data, selected_layer, original_name = request.get_json(), None, 'request.json'
        else:
            raise IngestionError('Provide a supported spatial file or GeoJSON body')
        features = _feature_list(data)
    except IngestionError as exc:
        return jsonify({'error': str(exc)}), 400

    layer_fields = fetch_layer_fields(cur, layer_id)
    cur.execute('SELECT geometry_type FROM layers WHERE id = %s::uuid', (layer_id,))
    layer_row = cur.fetchone()
    expected_family = str((layer_row or {}).get('geometry_type') or '').lower()
    inserted = errors = 0
    diagnostics: list[dict[str, Any]] = []

    for index, feature in enumerate(features, start=1):
        geom = feature.get('geometry') if isinstance(feature, dict) else None
        props = feature.get('properties') or {} if isinstance(feature, dict) else {}
        cur.execute('SAVEPOINT import_feature')
        try:
            if not geom:
                raise GeometryValidationError('Feature has no geometry')
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
            cur.execute(
                """
                INSERT INTO features (layer_id, geometry, properties, created_by)
                VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s::uuid)
                RETURNING id, version, ST_AsGeoJSON(geometry) AS geometry, properties
                """,
                (layer_id, json.dumps(normalized_geom), json.dumps(prepared_props), user_id),
            )
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
            cur.execute('RELEASE SAVEPOINT import_feature')
            inserted += 1
        except Exception as exc:
            cur.execute('ROLLBACK TO SAVEPOINT import_feature')
            cur.execute('RELEASE SAVEPOINT import_feature')
            errors += 1
            if len(diagnostics) < 25:
                diagnostics.append({'feature': index, 'error': str(exc) or exc.__class__.__name__})

    if inserted:
        invalidate_layer_tile_cache(cur, layer_id)
    log_audit(
        cur,
        user_id=user_id,
        action='layer_upload',
        entity_type='layer',
        entity_id=layer_id,
        layer_id=layer_id,
        payload={
            'file': original_name,
            'source_crs': source_crs,
            'source_layer': selected_layer,
            'inserted': inserted,
            'errors': errors,
        },
    )
    db.commit()
    return jsonify({
        'inserted': inserted,
        'errors': errors,
        'diagnostics': diagnostics,
        'source_file': original_name,
        'source_layer': selected_layer,
        'source_crs': source_crs or 'auto-detected',
        'target_crs': 'EPSG:4326',
    })
