import json
from typing import Any

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db import get_db
from enterprise_utils import log_audit

utility_bp = Blueprint('utilities', __name__)

UTILITY_TYPES = {
    'electric',
    'water',
    'wastewater',
    'stormwater',
    'gas',
    'telecom',
    'district_energy',
    'other',
}
NETWORK_STATUSES = {'planning', 'active', 'maintenance', 'retired'}
ASSET_STATUSES = {'planned', 'in_service', 'out_of_service', 'maintenance', 'retired'}
SERVICE_POINT_STATUSES = {'planned', 'active', 'inactive', 'disconnected'}
NODE_TYPES = {
    'source',
    'substation',
    'transformer',
    'switch',
    'valve',
    'pump',
    'junction',
    'meter',
    'regulator',
    'tank',
    'manhole',
    'service_point',
    'other',
}
EDGE_TYPES = {
    'feeder',
    'main',
    'lateral',
    'transmission',
    'distribution',
    'service_line',
    'fiber',
    'coax',
    'duct',
    'pipe',
    'conduit',
    'other',
}


def _serialize_network(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row['id']),
        'name': row['name'],
        'utility_type': row['utility_type'],
        'description': row.get('description'),
        'status': row['status'],
        'is_public': row['is_public'],
        'workspace_id': str(row['workspace_id']) if row.get('workspace_id') else None,
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'created_at': row['created_at'].isoformat() if row.get('created_at') else None,
        'updated_at': row['updated_at'].isoformat() if row.get('updated_at') else None,
    }


def _serialize_feature_row(row: dict[str, Any], geometry_field: str = 'geometry') -> dict[str, Any]:
    return {
        'type': 'Feature',
        'id': str(row['id']),
        'geometry': json.loads(row[geometry_field]) if row.get(geometry_field) else None,
        'properties': {
            'asset_id': row.get('asset_id'),
            'name': row.get('name'),
            'asset_type': row.get('asset_type'),
            'status': row.get('status'),
            'customer_count': row.get('customer_count'),
            **(row.get('properties') or {}),
        },
    }


def _workspace_accessible(cur, workspace_id: str, user_id: str | None) -> bool:
    if not user_id:
        return False
    cur.execute(
        """
        SELECT 1
        FROM workspaces w
        WHERE w.id = %s::uuid
          AND (
            w.created_by = %s::uuid
            OR EXISTS (
                SELECT 1
                FROM workspace_members wm
                WHERE wm.workspace_id = w.id
                  AND wm.user_id = %s::uuid
            )
          )
        LIMIT 1
        """,
        (workspace_id, user_id, user_id),
    )
    return cur.fetchone() is not None


def _network_access(cur, network_id: str, user_id: str | None) -> tuple[bool, bool]:
    cur.execute(
        """
        SELECT n.id,
               n.created_by = %s::uuid AS is_owner
        FROM utility_network.networks n
        WHERE n.id = %s::uuid
          AND (
            n.is_public = TRUE
            OR n.created_by = %s::uuid
            OR EXISTS (
                SELECT 1
                FROM workspace_members wm
                WHERE wm.workspace_id = n.workspace_id
                  AND wm.user_id = %s::uuid
            )
          )
        LIMIT 1
        """,
        (user_id, network_id, user_id, user_id),
    )
    row = cur.fetchone()
    if not row:
        return False, False
    return True, bool(row.get('is_owner'))


def _owner_required(cur, network_id: str, user_id: str | None):
    exists, is_owner = _network_access(cur, network_id, user_id)
    if not exists:
        return jsonify({'error': 'Utility network not found'}), 404
    if not is_owner:
        return jsonify({'error': 'Utility network not found or permission denied'}), 404
    return None


def _parse_geometry_payload(expected_type: str) -> str:
    geometry = request.get_json(silent=True) or {}
    raw_geometry = geometry.get('geometry')
    if not isinstance(raw_geometry, dict):
        raise ValueError('geometry is required')
    if raw_geometry.get('type') != expected_type:
        raise ValueError(f'geometry.type must be {expected_type}')
    return json.dumps(raw_geometry)


def _parse_bbox(value: str | None) -> tuple[float, float, float, float] | None:
    if not value:
        return None
    parts = [token.strip() for token in value.split(',')]
    if len(parts) != 4:
        raise ValueError('bbox must be minx,miny,maxx,maxy')
    min_x, min_y, max_x, max_y = [float(token) for token in parts]
    return min_x, min_y, max_x, max_y


@utility_bp.route('/networks', methods=['GET'])
@jwt_required(optional=True)
def list_networks():
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    if user_id:
        cur.execute(
            """
            SELECT n.id, n.name, n.utility_type, n.description, n.status, n.is_public, n.workspace_id, n.created_by, n.created_at, n.updated_at
            FROM utility_network.networks n
            WHERE n.is_public = TRUE
               OR n.created_by = %s::uuid
               OR EXISTS (
                    SELECT 1
                    FROM workspace_members wm
                    WHERE wm.workspace_id = n.workspace_id
                      AND wm.user_id = %s::uuid
               )
            ORDER BY n.created_at DESC
            """,
            (user_id, user_id),
        )
    else:
        cur.execute(
            """
            SELECT id, name, utility_type, description, status, is_public, workspace_id, created_by, created_at, updated_at
            FROM utility_network.networks
            WHERE is_public = TRUE
            ORDER BY created_at DESC
            """
        )

    return jsonify([_serialize_network(row) for row in cur.fetchall()])


@utility_bp.route('/networks', methods=['POST'])
@jwt_required()
def create_network():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    name = str(data.get('name') or '').strip()
    utility_type = str(data.get('utility_type') or '').strip()
    status = str(data.get('status') or 'active').strip()
    workspace_id = data.get('workspace_id')

    if not name:
        return jsonify({'error': 'name is required'}), 400
    if utility_type not in UTILITY_TYPES:
        return jsonify({'error': f'utility_type must be one of {sorted(UTILITY_TYPES)}'}), 400
    if status not in NETWORK_STATUSES:
        return jsonify({'error': f'status must be one of {sorted(NETWORK_STATUSES)}'}), 400

    db = get_db()
    cur = db.cursor()

    if workspace_id and not _workspace_accessible(cur, workspace_id, user_id):
        return jsonify({'error': 'Workspace not found or permission denied'}), 404

    cur.execute(
        """
        INSERT INTO utility_network.networks (
            name, utility_type, description, status, is_public, workspace_id, created_by
        )
        VALUES (%s, %s, %s, %s, %s, %s::uuid, %s::uuid)
        RETURNING id, name, utility_type, description, status, is_public, workspace_id, created_by, created_at, updated_at
        """,
        (
            name,
            utility_type,
            data.get('description'),
            status,
            bool(data.get('is_public', False)),
            workspace_id,
            user_id,
        ),
    )
    row = cur.fetchone()
    log_audit(
        cur,
        user_id=user_id,
        action='utility_network_created',
        entity_type='utility_network',
        entity_id=str(row['id']),
        payload={'name': name, 'utility_type': utility_type},
    )
    db.commit()
    return jsonify(_serialize_network(row)), 201


@utility_bp.route('/networks/<network_id>', methods=['GET'])
@jwt_required(optional=True)
def get_network(network_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    exists, _ = _network_access(cur, network_id, user_id)
    if not exists:
        return jsonify({'error': 'Utility network not found'}), 404

    cur.execute(
        """
        SELECT id, name, utility_type, description, status, is_public, workspace_id, created_by, created_at, updated_at
        FROM utility_network.networks
        WHERE id = %s::uuid
        """,
        (network_id,),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Utility network not found'}), 404
    return jsonify(_serialize_network(row))


@utility_bp.route('/networks/<network_id>/summary', methods=['GET'])
@jwt_required(optional=True)
def get_network_summary(network_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    exists, _ = _network_access(cur, network_id, user_id)
    if not exists:
        return jsonify({'error': 'Utility network not found'}), 404

    cur.execute(
        """
        SELECT
            (SELECT COUNT(*) FROM utility_network.nodes WHERE network_id = %s::uuid) AS node_count,
            (SELECT COUNT(*) FROM utility_network.edges WHERE network_id = %s::uuid) AS edge_count,
            (SELECT COUNT(*) FROM utility_network.service_points WHERE network_id = %s::uuid) AS service_point_count,
            COALESCE((SELECT SUM(length_m) FROM utility_network.edges WHERE network_id = %s::uuid), 0) AS total_length_m
        """,
        (network_id, network_id, network_id, network_id),
    )
    row = cur.fetchone()
    return jsonify({
        'network_id': network_id,
        'node_count': int(row['node_count'] or 0),
        'edge_count': int(row['edge_count'] or 0),
        'service_point_count': int(row['service_point_count'] or 0),
        'total_length_m': float(row['total_length_m'] or 0),
    })


@utility_bp.route('/networks/<network_id>/nodes', methods=['GET'])
@jwt_required(optional=True)
def list_nodes(network_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    exists, _ = _network_access(cur, network_id, user_id)
    if not exists:
        return jsonify({'error': 'Utility network not found'}), 404

    try:
        bbox = _parse_bbox(request.args.get('bbox'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    limit = min(max(int(request.args.get('limit', 1000)), 1), 5000)

    params: list[Any] = [network_id]
    bbox_clause = ''
    if bbox:
        bbox_clause = ' AND geometry && ST_MakeEnvelope(%s, %s, %s, %s, 4326)'
        params.extend(bbox)
    params.append(limit)

    cur.execute(
        f"""
        SELECT id, asset_id, name, node_type AS asset_type, status, properties, ST_AsGeoJSON(geometry) AS geometry
        FROM utility_network.nodes
        WHERE network_id = %s::uuid
        {bbox_clause}
        ORDER BY created_at DESC
        LIMIT %s
        """,
        tuple(params),
    )
    return jsonify({
        'type': 'FeatureCollection',
        'features': [_serialize_feature_row(row) for row in cur.fetchall()],
    })


@utility_bp.route('/networks/<network_id>/nodes', methods=['POST'])
@jwt_required()
def create_node(network_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    node_type = str(data.get('node_type') or '').strip()
    status = str(data.get('status') or 'in_service').strip()

    if node_type not in NODE_TYPES:
        return jsonify({'error': f'node_type must be one of {sorted(NODE_TYPES)}'}), 400
    if status not in ASSET_STATUSES:
        return jsonify({'error': f'status must be one of {sorted(ASSET_STATUSES)}'}), 400

    db = get_db()
    cur = db.cursor()
    denied = _owner_required(cur, network_id, user_id)
    if denied:
        return denied

    try:
        geometry_geojson = _parse_geometry_payload('Point')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    cur.execute(
        """
        INSERT INTO utility_network.nodes (
            network_id, asset_id, name, node_type, status, geometry, elevation_m, properties, source_feature_id, created_by
        )
        VALUES (
            %s::uuid,
            %s,
            %s,
            %s,
            %s,
            ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
            %s,
            %s::jsonb,
            %s::uuid,
            %s::uuid
        )
        RETURNING id, asset_id, name, status, properties, ST_AsGeoJSON(geometry) AS geometry
        """,
        (
            network_id,
            data.get('asset_id'),
            data.get('name'),
            node_type,
            status,
            geometry_geojson,
            data.get('elevation_m'),
            json.dumps(data.get('properties') or {}),
            data.get('source_feature_id'),
            user_id,
        ),
    )
    row = cur.fetchone()
    log_audit(
        cur,
        user_id=user_id,
        action='utility_node_created',
        entity_type='utility_node',
        entity_id=str(row['id']),
        payload={'network_id': network_id, 'node_type': node_type},
    )
    db.commit()
    return jsonify(_serialize_feature_row({**row, 'asset_type': node_type})), 201


@utility_bp.route('/networks/<network_id>/edges', methods=['GET'])
@jwt_required(optional=True)
def list_edges(network_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    exists, _ = _network_access(cur, network_id, user_id)
    if not exists:
        return jsonify({'error': 'Utility network not found'}), 404

    try:
        bbox = _parse_bbox(request.args.get('bbox'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    limit = min(max(int(request.args.get('limit', 1000)), 1), 5000)

    params: list[Any] = [network_id]
    bbox_clause = ''
    if bbox:
        bbox_clause = ' AND geometry && ST_MakeEnvelope(%s, %s, %s, %s, 4326)'
        params.extend(bbox)
    params.append(limit)

    cur.execute(
        f"""
        SELECT id, asset_id, name, edge_type AS asset_type, status, properties, ST_AsGeoJSON(geometry) AS geometry
        FROM utility_network.edges
        WHERE network_id = %s::uuid
        {bbox_clause}
        ORDER BY created_at DESC
        LIMIT %s
        """,
        tuple(params),
    )
    return jsonify({
        'type': 'FeatureCollection',
        'features': [_serialize_feature_row(row) for row in cur.fetchall()],
    })


@utility_bp.route('/networks/<network_id>/edges', methods=['POST'])
@jwt_required()
def create_edge(network_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    edge_type = str(data.get('edge_type') or '').strip()
    status = str(data.get('status') or 'in_service').strip()

    if edge_type not in EDGE_TYPES:
        return jsonify({'error': f'edge_type must be one of {sorted(EDGE_TYPES)}'}), 400
    if status not in ASSET_STATUSES:
        return jsonify({'error': f'status must be one of {sorted(ASSET_STATUSES)}'}), 400

    db = get_db()
    cur = db.cursor()
    denied = _owner_required(cur, network_id, user_id)
    if denied:
        return denied

    try:
        geometry_geojson = _parse_geometry_payload('LineString')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    from_node_id = data.get('from_node_id')
    to_node_id = data.get('to_node_id')
    if from_node_id:
        cur.execute(
            "SELECT 1 FROM utility_network.nodes WHERE id = %s::uuid AND network_id = %s::uuid",
            (from_node_id, network_id),
        )
        if not cur.fetchone():
            return jsonify({'error': 'from_node_id does not belong to this network'}), 400
    if to_node_id:
        cur.execute(
            "SELECT 1 FROM utility_network.nodes WHERE id = %s::uuid AND network_id = %s::uuid",
            (to_node_id, network_id),
        )
        if not cur.fetchone():
            return jsonify({'error': 'to_node_id does not belong to this network'}), 400

    cur.execute(
        """
        INSERT INTO utility_network.edges (
            network_id, asset_id, name, edge_type, status, from_node_id, to_node_id, geometry, length_m,
            properties, source_feature_id, created_by
        )
        VALUES (
            %s::uuid,
            %s,
            %s,
            %s,
            %s,
            %s::uuid,
            %s::uuid,
            ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
            COALESCE(%s, ST_Length(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 3857))),
            %s::jsonb,
            %s::uuid,
            %s::uuid
        )
        RETURNING id, asset_id, name, status, properties, ST_AsGeoJSON(geometry) AS geometry
        """,
        (
            network_id,
            data.get('asset_id'),
            data.get('name'),
            edge_type,
            status,
            from_node_id,
            to_node_id,
            geometry_geojson,
            data.get('length_m'),
            geometry_geojson,
            json.dumps(data.get('properties') or {}),
            data.get('source_feature_id'),
            user_id,
        ),
    )
    row = cur.fetchone()
    log_audit(
        cur,
        user_id=user_id,
        action='utility_edge_created',
        entity_type='utility_edge',
        entity_id=str(row['id']),
        payload={'network_id': network_id, 'edge_type': edge_type},
    )
    db.commit()
    return jsonify(_serialize_feature_row({**row, 'asset_type': edge_type})), 201


@utility_bp.route('/networks/<network_id>/service-points', methods=['GET'])
@jwt_required(optional=True)
def list_service_points(network_id: str):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    exists, _ = _network_access(cur, network_id, user_id)
    if not exists:
        return jsonify({'error': 'Utility network not found'}), 404

    limit = min(max(int(request.args.get('limit', 1000)), 1), 5000)
    cur.execute(
        """
        SELECT id, asset_id, name, 'service_point' AS asset_type, status, customer_count, properties, ST_AsGeoJSON(geometry) AS geometry
        FROM utility_network.service_points
        WHERE network_id = %s::uuid
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (network_id, limit),
    )
    return jsonify({
        'type': 'FeatureCollection',
        'features': [_serialize_feature_row(row) for row in cur.fetchall()],
    })


@utility_bp.route('/networks/<network_id>/service-points', methods=['POST'])
@jwt_required()
def create_service_point(network_id: str):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    status = str(data.get('status') or 'active').strip()

    if status not in SERVICE_POINT_STATUSES:
        return jsonify({'error': f'status must be one of {sorted(SERVICE_POINT_STATUSES)}'}), 400

    db = get_db()
    cur = db.cursor()
    denied = _owner_required(cur, network_id, user_id)
    if denied:
        return denied

    try:
        geometry_geojson = _parse_geometry_payload('Point')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    node_id = data.get('node_id')
    connected_edge_id = data.get('connected_edge_id')
    if node_id:
        cur.execute(
            "SELECT 1 FROM utility_network.nodes WHERE id = %s::uuid AND network_id = %s::uuid",
            (node_id, network_id),
        )
        if not cur.fetchone():
            return jsonify({'error': 'node_id does not belong to this network'}), 400
    if connected_edge_id:
        cur.execute(
            "SELECT 1 FROM utility_network.edges WHERE id = %s::uuid AND network_id = %s::uuid",
            (connected_edge_id, network_id),
        )
        if not cur.fetchone():
            return jsonify({'error': 'connected_edge_id does not belong to this network'}), 400

    cur.execute(
        """
        INSERT INTO utility_network.service_points (
            network_id, asset_id, name, status, geometry, node_id, connected_edge_id, customer_count,
            properties, source_feature_id, created_by
        )
        VALUES (
            %s::uuid,
            %s,
            %s,
            %s,
            ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
            %s::uuid,
            %s::uuid,
            %s,
            %s::jsonb,
            %s::uuid,
            %s::uuid
        )
        RETURNING id, asset_id, name, status, properties, ST_AsGeoJSON(geometry) AS geometry
        """,
        (
            network_id,
            data.get('asset_id'),
            data.get('name'),
            status,
            geometry_geojson,
            node_id,
            connected_edge_id,
            int(data.get('customer_count') or 0),
            json.dumps(data.get('properties') or {}),
            data.get('source_feature_id'),
            user_id,
        ),
    )
    row = cur.fetchone()
    log_audit(
        cur,
        user_id=user_id,
        action='utility_service_point_created',
        entity_type='utility_service_point',
        entity_id=str(row['id']),
        payload={'network_id': network_id},
    )
    db.commit()
    return jsonify(
        _serialize_feature_row({
            **row,
            'asset_type': 'service_point',
            'customer_count': int(data.get('customer_count') or 0),
        })
    ), 201
