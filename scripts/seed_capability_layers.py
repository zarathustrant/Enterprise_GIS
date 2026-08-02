#!/usr/bin/env python3
"""Create idempotent, demo-owned vector and utility fixtures for local QA."""

import argparse
import json
import os
from dataclasses import dataclass
from typing import Any

import psycopg2
import psycopg2.extras
from werkzeug.security import generate_password_hash
from style_validation import validate_layer_style


DEMO_USERNAME = 'capability_demo'
DEMO_EMAIL = 'capability_demo@enterprise-gis.local'
DEMO_PASSWORD = 'EnterpriseGIS!2026'
DEMO_GROUP = 'Capability Samples'


@dataclass
class LayerFixture:
    name: str
    geometry_type: str
    fields: list[tuple[str, str, str]]
    features: list[tuple[dict[str, Any], dict[str, Any]]]
    style: dict[str, Any]
    description: str


def polygon(x0: float, y0: float, x1: float, y1: float) -> dict[str, Any]:
    return {
        'type': 'Polygon',
        'coordinates': [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
    }


def fixtures() -> list[LayerFixture]:
    facilities = [
        ('Central Hospital', 'health', 92, 'operational', 'first-aid-kit', 4.540, 8.482),
        ('Unity School', 'education', 73, 'operational', 'school', 4.558, 8.490),
        ('Fire Station', 'emergency', 88, 'maintenance', 'flame', 4.576, 8.474),
        ('Water Plant', 'utility', 61, 'operational', 'droplet', 4.592, 8.501),
        ('Community Market With A Long UnbrokenNameToken', 'commercial', 55, 'planned', 'building-store', 4.614, 8.486),
        ('Civic Centre', 'government', 79, 'operational', 'building-community', 4.626, 8.516),
        ('Unclassified Depot', 'other', 40, 'planned', '', 4.646, 8.494),
        (None, None, 0, 'unknown', 'marker', 4.638, 8.525),
    ]
    facility_features = [
        ({'type': 'Point', 'coordinates': [x, y]}, {
            'name': name, 'category': category, 'score': score, 'status': status,
            'icon_name': icon_name, 'priority': 100 - index, 'opened': f'202{index % 6}-01-15',
        })
        for index, (name, category, score, status, icon_name, x, y) in enumerate(facilities)
    ]
    stats_features = []
    for index, (x, y, value) in enumerate([
        (4.532, 8.470, 12), (4.536, 8.474, 15), (4.540, 8.478, 18),
        (4.590, 8.510, 72), (4.594, 8.514, 80), (4.598, 8.518, 88),
        (4.640, 8.466, 25), (4.650, 8.500, 60), (4.620, 8.530, 100),
        (4.632, 8.542, None),
    ]):
        stats_features.append((
            {'type': 'Point', 'coordinates': [x, y]},
            {'sample_id': f'ST-{index + 1:02d}', 'value': value, 'weight': 1 + index % 3, 'cluster': 'west' if x < 4.56 else 'east'},
        ))

    road_features = [
        ({'type': 'LineString', 'coordinates': [[4.51, 8.47], [4.66, 8.52]]}, {'name': 'Unity Avenue', 'road_class': 'primary', 'speed_kph': 80, 'status': 'open'}),
        ({'type': 'LineString', 'coordinates': [[4.52, 8.53], [4.65, 8.46]]}, {'name': 'Market Road', 'road_class': 'secondary', 'speed_kph': 60, 'status': 'open'}),
        ({'type': 'LineString', 'coordinates': [[4.55, 8.45], [4.57, 8.55]]}, {'name': 'River Link', 'road_class': 'local', 'speed_kph': 35, 'status': 'works'}),
        ({'type': 'LineString', 'coordinates': [[4.61, 8.45], [4.61, 8.55]]}, {'name': 'Industrial Spur', 'road_class': 'service', 'speed_kph': 25, 'status': 'restricted'}),
        ({'type': 'LineString', 'coordinates': [[4.50, 8.49], [4.505, 8.49], [4.66, 8.545]]}, {'name': 'Very Long Regional Connector Label For Repeat Testing', 'road_class': 'track', 'speed_kph': 10, 'status': 'planned'}),
        ({'type': 'MultiLineString', 'coordinates': [[[4.515, 8.44], [4.525, 8.445]], [[4.63, 8.44], [4.66, 8.455]]]}, {'name': None, 'road_class': None, 'speed_kph': 0, 'status': 'unknown'}),
    ]
    grid_features = [
        ({'type': 'LineString', 'coordinates': [[4.52, 8.46], [4.62, 8.46], [4.62, 8.54], [4.52, 8.54], [4.52, 8.46]]}, {'boundary': 'outer'}),
        ({'type': 'LineString', 'coordinates': [[4.57, 8.46], [4.57, 8.54]]}, {'boundary': 'division'}),
        ({'type': 'LineString', 'coordinates': [[4.52, 8.50], [4.62, 8.50]]}, {'boundary': 'division'}),
        ({'type': 'LineString', 'coordinates': [[4.62, 8.50], [4.65, 8.50]]}, {'boundary': 'dangle'}),
    ]

    district_features = [
        (polygon(4.52, 8.46, 4.57, 8.50), {'name': 'West Ward', 'zone': 'residential', 'population': 18400, 'risk': 0.22}),
        (polygon(4.57, 8.46, 4.62, 8.50), {'name': 'South Ward', 'zone': 'commercial', 'population': 23100, 'risk': 0.58}),
        (polygon(4.52, 8.50, 4.57, 8.54), {'name': 'North Ward', 'zone': 'institutional', 'population': 12600, 'risk': 0.35}),
        (polygon(4.57, 8.50, 4.62, 8.54), {'name': 'East Ward', 'zone': 'industrial', 'population': 9700, 'risk': 0.83}),
        ({
            'type': 'Polygon',
            'coordinates': [
                [[4.625, 8.46], [4.675, 8.46], [4.675, 8.51], [4.625, 8.51], [4.625, 8.46]],
                [[4.642, 8.477], [4.658, 8.477], [4.658, 8.493], [4.642, 8.493], [4.642, 8.477]],
            ],
        }, {'name': 'Protected Landscape With Interior Exclusion', 'zone': 'conservation', 'population': 0, 'risk': 0.0}),
        ({
            'type': 'Polygon',
            'coordinates': [[[4.625, 8.515], [4.675, 8.515], [4.675, 8.55], [4.650, 8.532], [4.625, 8.55], [4.625, 8.515]]],
        }, {'name': None, 'zone': None, 'population': None, 'risk': None}),
    ]
    mask_features = [
        (polygon(4.545, 8.475, 4.590, 8.525), {'name': 'Study Area A', 'mask_type': 'primary'}),
        (polygon(4.580, 8.485, 4.630, 8.535), {'name': 'Study Area B', 'mask_type': 'secondary'}),
    ]
    quality_features = [
        (polygon(4.635, 8.470, 4.650, 8.485), {'name': 'Duplicate A', 'quality': 'duplicate'}),
        (polygon(4.635, 8.470, 4.650, 8.485), {'name': 'Duplicate B', 'quality': 'duplicate'}),
        (polygon(4.651, 8.470, 4.652, 8.505), {'name': 'Sliver', 'quality': 'sliver'}),
    ]
    multipart = {
        'type': 'MultiPolygon',
        'coordinates': [
            polygon(4.630, 8.510, 4.640, 8.520)['coordinates'],
            polygon(4.646, 8.518, 4.657, 8.530)['coordinates'],
        ],
    }

    return [
        LayerFixture(
            'Capability Points - Facilities', 'Point',
            [('name', 'Name', 'string'), ('category', 'Category', 'string'), ('score', 'Score', 'double'), ('status', 'Status', 'string'), ('icon_name', 'Icon Name', 'string'), ('priority', 'Priority', 'integer'), ('opened', 'Opened', 'date')],
            facility_features,
            {
                'rendererType': 'uniqueValue', 'uniqueValueField': 'category',
                'uniqueValueStops': [
                    {'value': 'health', 'color': '#d1495b', 'opacity': 1},
                    {'value': 'education', 'color': '#287271', 'opacity': 1},
                    {'value': 'emergency', 'color': '#f4a261', 'opacity': 1},
                    {'value': 'utility', 'color': '#277da1', 'opacity': 1},
                    {'value': 'commercial', 'color': '#9c6644', 'opacity': 1},
                    {'value': 'government', 'color': '#6a4c93', 'opacity': 1},
                ],
                'pointShape': 'icon', 'iconLibrary': 'tabler', 'iconName': 'building-community',
                'iconField': 'icon_name', 'iconSize': 1.15,
                'uniqueDefaultColor': '#8d5a97', 'uniqueDefaultOpacity': 0.55,
                'uniqueNullColor': '#6c757d', 'uniqueNullOpacity': 0.35,
                'labelField': 'name', 'labelTextExpression': '["coalesce",["get","name"],"Unnamed facility"]',
                'labelSize': 12, 'labelHaloColor': '#ffffff',
                'labelHaloWidth': 2, 'labelCollisionEnabled': True, 'labelPriorityField': 'priority',
                'labelWrapLength': 16, 'labelMaxLength': 48,
                'labelClasses': [
                    {'id': 'all-facilities', 'name': 'All facilities', 'filterField': '', 'filterValue': '', 'labelField': '', 'color': '#1b1f24', 'size': 12, 'minZoom': 0, 'maxZoom': 24, 'priority': 1},
                    {'id': 'health-priority', 'name': 'Health priority', 'filterField': 'category', 'filterValue': 'health', 'labelField': 'name', 'color': '#b42318', 'size': 15, 'minZoom': 0, 'maxZoom': 24, 'priority': 50},
                ],
                'scaleOverrides': [
                    {'minZoom': 0, 'maxZoom': 8, 'color': '#495057', 'opacity': 0.7, 'strokeWidth': 1, 'pointRadius': 4},
                    {'minZoom': 13, 'maxZoom': 24, 'color': '#136f63', 'opacity': 1, 'strokeWidth': 2, 'pointRadius': 10},
                ],
                'legendPatchShape': 'circle', 'symbolLevel': 30,
            },
            'Icon, category, label-priority, date, status, and numeric-field cartography fixture.',
        ),
        LayerFixture(
            'Capability Points - Spatial Statistics', 'Point',
            [('sample_id', 'Sample ID', 'string'), ('value', 'Observed Value', 'double'), ('weight', 'Weight', 'double'), ('cluster', 'Cluster', 'string')],
            stats_features,
            {
                'rendererType': 'classBreaks', 'classBreakField': 'value',
                'classBreakStops': [
                    {'min': 60, 'max': 100, 'color': '#e76f51', 'opacity': 0.95},
                    {'min': 0, 'max': 25, 'color': '#2a9d8f', 'opacity': 0.9},
                    {'min': 25, 'max': 60, 'color': '#e9c46a', 'opacity': 0.9},
                ],
                'classBreakDefaultColor': '#7b2cbf', 'classBreakDefaultOpacity': 0.45,
                'classBreakNullColor': '#adb5bd', 'classBreakNullOpacity': 0.25,
                'pointRadius': 7, 'sizeField': 'value', 'sizeMin': 4, 'sizeMax': 16,
                'labelField': 'sample_id', 'legendPatchShape': 'circle',
            },
            'Known point clusters for center, distance, nearest-neighbor, Moran I, and hot-spot tools.',
        ),
        LayerFixture(
            'Capability Lines - Roads', 'LineString',
            [('name', 'Road Name', 'string'), ('road_class', 'Road Class', 'string'), ('speed_kph', 'Speed km/h', 'double'), ('status', 'Status', 'string')],
            road_features,
            {
                'rendererType': 'uniqueValue', 'uniqueValueField': 'road_class',
                'uniqueValueStops': [
                    {'value': 'primary', 'color': '#d1495b', 'opacity': 1},
                    {'value': 'secondary', 'color': '#f4a261', 'opacity': 1},
                    {'value': 'local', 'color': '#457b9d', 'opacity': 1},
                    {'value': 'service', 'color': '#6c757d', 'opacity': 1},
                ],
                'uniqueDefaultColor': '#8d5a97', 'uniqueDefaultOpacity': 0.8,
                'uniqueNullColor': '#6c757d', 'uniqueNullOpacity': 0.5,
                'strokeWidth': 4, 'lineCasingEnabled': True, 'lineCasingColor': '#fff8e7',
                'lineCasingWidth': 3, 'lineDashArray': [1, 0], 'labelField': 'name',
                'labelRotateWithLine': True, 'labelRepeatDistanceMeters': 4000,
                'lineMarkerEnabled': True, 'lineMarkerLibrary': 'tabler', 'lineMarkerIcon': 'arrow-big-right',
                'lineMarkerSpacingMeters': 2500, 'lineMarkerSize': 14, 'legendPatchShape': 'line',
            },
            'Line casing, categorized roads, curved labels, repeat distance, and marker-placement fixture.',
        ),
        LayerFixture(
            'Capability Lines - Polygonize Grid', 'LineString',
            [('boundary', 'Boundary Type', 'string')], grid_features,
            {'rendererType': 'uniqueValue', 'uniqueValueField': 'boundary', 'strokeWidth': 3, 'lineDashArray': [6, 2], 'legendPatchShape': 'line'},
            'Closed noded grid with one dangle for polygonize and topology diagnostics.',
        ),
        LayerFixture(
            'Capability Polygons - Districts', 'Polygon',
            [('name', 'District Name', 'string'), ('zone', 'Land Use', 'string'), ('population', 'Population', 'integer'), ('risk', 'Risk Index', 'double')],
            district_features,
            {
                'rendererType': 'uniqueValue', 'uniqueValueField': 'zone',
                'uniqueValueStops': [
                    {'value': 'residential', 'color': '#90be6d', 'opacity': 0.62},
                    {'value': 'commercial', 'color': '#f9c74f', 'opacity': 0.62},
                    {'value': 'institutional', 'color': '#577590', 'opacity': 0.62},
                    {'value': 'industrial', 'color': '#f94144', 'opacity': 0.62},
                ],
                'uniqueDefaultColor': '#8d5a97', 'uniqueDefaultOpacity': 0.48,
                'uniqueNullColor': '#adb5bd', 'uniqueNullOpacity': 0.25,
                'strokeColor': '#2b2d42', 'strokeWidth': 1.5, 'polygonPatternLibrary': 'builtin',
                'polygonPattern': 'diagonal', 'polygonPatternColor': '#ffffff', 'polygonPatternOpacity': 0.18,
                'labelField': 'name', 'labelTextExpression': '["coalesce",["get","name"],"Unnamed district"]',
                'labelPolygonFitEnabled': True, 'labelWrapLength': 12, 'labelMaxLength': 40,
                'labelClasses': [
                    {'id': 'district-labels', 'name': 'District labels', 'filterField': '', 'filterValue': '',
                     'labelField': '', 'color': '#1b1f24', 'size': 13, 'minZoom': 0, 'maxZoom': 24, 'priority': 20},
                ],
                'polygonMarkerEnabled': True, 'polygonMarkerPlacement': 'interior',
                'polygonMarkerLibrary': 'tabler', 'polygonMarkerIcon': 'map-pin', 'polygonMarkerSize': 15,
                'legendPatchShape': 'area', 'topologyNoOverlap': True,
            },
            'Categorized polygon, pattern, interior marker, fitted labels, dissolve, summarize, and topology fixture.',
        ),
        LayerFixture(
            'Capability Polygons - Masks', 'Polygon',
            [('name', 'Mask Name', 'string'), ('mask_type', 'Mask Type', 'string')], mask_features,
            {'rendererType': 'simple', 'color': '#00b4d8', 'opacity': 0.22, 'strokeColor': '#0077b6', 'strokeWidth': 2, 'polygonPattern': 'crosshatch', 'legendPatchShape': 'area'},
            'Overlapping polygon masks for clip, erase, intersect, and spatial join.',
        ),
        LayerFixture(
            'Capability Polygons - Coverage', 'Polygon',
            [('name', 'Coverage Name', 'string')],
            [(polygon(4.515, 8.455, 4.625, 8.545), {'name': 'Expected District Coverage'})],
            {'rendererType': 'simple', 'color': '#ffffff', 'opacity': 0.05, 'strokeColor': '#4361ee', 'strokeWidth': 2, 'lineDashArray': [5, 3], 'legendPatchShape': 'area'},
            'Expected coverage envelope for explicit polygon-gap validation.',
        ),
        LayerFixture(
            'Capability Polygons - Quality', 'Polygon',
            [('name', 'Feature Name', 'string'), ('quality', 'Quality Case', 'string')], quality_features,
            {'rendererType': 'uniqueValue', 'uniqueValueField': 'quality', 'color': '#ff006e', 'opacity': 0.55, 'strokeColor': '#8338ec', 'legendPatchShape': 'area'},
            'Duplicate and sliver fixtures for quality checks and generalization.',
        ),
        LayerFixture(
            'Capability Polygons - Multipart', 'MultiPolygon',
            [('name', 'Feature Name', 'string')], [(multipart, {'name': 'Two-part Estate'})],
            {'rendererType': 'simple', 'color': '#3a86ff', 'opacity': 0.5, 'strokeColor': '#023e8a', 'polygonPattern': 'dots', 'legendPatchShape': 'area'},
            'Multipart fixture for explode, interior point, boundary, and minimum-bounding geometry.',
        ),
    ]


def seed_layer(cur, owner_id: str, geodatabase_id: str, fixture: LayerFixture, z_index: int) -> str:
    cur.execute(
        """
        INSERT INTO layers (
            name, description, geometry_type, crs, style, is_public, group_name,
            z_index, geodatabase_id, catalog_status, tags, created_by
        ) VALUES (%s, %s, %s, 'EPSG:4326', %s::jsonb, TRUE, %s, %s,
                  %s::uuid, 'authoritative', ARRAY['qa', 'symbology', 'labels'], %s::uuid)
        RETURNING id
        """,
        (
            fixture.name, fixture.description, fixture.geometry_type,
            json.dumps(fixture.style), DEMO_GROUP, z_index, geodatabase_id, owner_id,
        ),
    )
    layer_id = str(cur.fetchone()['id'])
    for order, (name, alias, field_type) in enumerate(fixture.fields):
        cur.execute(
            """INSERT INTO layer_fields (layer_id, name, alias, field_type, nullable, sort_order)
               VALUES (%s::uuid, %s, %s, %s, TRUE, %s)""",
            (layer_id, name, alias, field_type, order),
        )
    for geometry, properties in fixture.features:
        cur.execute(
            """INSERT INTO features (layer_id, geometry, properties, created_by)
               VALUES (%s::uuid, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s::jsonb, %s::uuid)""",
            (layer_id, json.dumps(geometry), json.dumps(properties), owner_id),
        )
    return layer_id


def seed_utility_network(cur, owner_id: str) -> dict[str, Any]:
    cur.execute(
        """INSERT INTO utility_network.networks
               (name, utility_type, description, status, is_public, created_by)
           VALUES ('Capability Water Network', 'water',
                   'Demo water network for connectivity and service-point workflows.',
                   'active', TRUE, %s::uuid)
           RETURNING id""",
        (owner_id,),
    )
    network_id = str(cur.fetchone()['id'])
    node_specs = [
        ('WN-001', 'North Tank', 'tank', 4.535, 8.525),
        ('WN-002', 'Main Pump', 'pump', 4.565, 8.505),
        ('WN-003', 'East Valve', 'valve', 4.605, 8.492),
        ('WN-004', 'South Junction', 'junction', 4.585, 8.468),
    ]
    node_ids: list[str] = []
    for asset_id, name, node_type, x, y in node_specs:
        cur.execute(
            """INSERT INTO utility_network.nodes
                   (network_id, asset_id, name, node_type, status, geometry, elevation_m, properties, created_by)
               VALUES (%s::uuid, %s, %s, %s, 'in_service', ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                       310, %s::jsonb, %s::uuid) RETURNING id""",
            (network_id, asset_id, name, node_type, x, y, json.dumps({'pressure_zone': 'Central'}), owner_id),
        )
        node_ids.append(str(cur.fetchone()['id']))
    edge_specs = [
        ('WE-001', 'Tank Main', 'main', 0, 1),
        ('WE-002', 'East Distribution', 'distribution', 1, 2),
        ('WE-003', 'South Distribution', 'distribution', 1, 3),
    ]
    edge_ids: list[str] = []
    for asset_id, name, edge_type, start, end in edge_specs:
        x1, y1 = node_specs[start][3], node_specs[start][4]
        x2, y2 = node_specs[end][3], node_specs[end][4]
        cur.execute(
            """INSERT INTO utility_network.edges
                   (network_id, asset_id, name, edge_type, status, from_node_id, to_node_id,
                    geometry, length_m, properties, created_by)
               VALUES (%s::uuid, %s, %s, %s, 'in_service', %s::uuid, %s::uuid,
                       ST_SetSRID(ST_MakeLine(ST_MakePoint(%s, %s), ST_MakePoint(%s, %s)), 4326),
                       ST_DistanceSphere(ST_MakePoint(%s, %s), ST_MakePoint(%s, %s)),
                       %s::jsonb, %s::uuid) RETURNING id""",
            (network_id, asset_id, name, edge_type, node_ids[start], node_ids[end], x1, y1, x2, y2,
             x1, y1, x2, y2, json.dumps({'diameter_mm': 300 if edge_type == 'main' else 160}), owner_id),
        )
        edge_ids.append(str(cur.fetchone()['id']))
    cur.execute(
        """INSERT INTO utility_network.service_points
               (network_id, asset_id, name, status, geometry, node_id, connected_edge_id,
                customer_count, properties, created_by)
           VALUES (%s::uuid, 'WS-001', 'Central Service Area', 'active',
                   ST_SetSRID(ST_MakePoint(4.607, 8.490), 4326), %s::uuid, %s::uuid,
                   145, '{"metered": true}'::jsonb, %s::uuid)""",
        (network_id, node_ids[2], edge_ids[1], owner_id),
    )
    return {'id': network_id, 'nodes': len(node_ids), 'edges': len(edge_ids), 'service_points': 1}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-url', default=os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5433/enterprise_gis'))
    parser.add_argument('--password', default=os.getenv('CAPABILITY_DEMO_PASSWORD', DEMO_PASSWORD))
    args = parser.parse_args()

    for fixture in fixtures():
        validate_layer_style(fixture.style)

    connection = psycopg2.connect(args.database_url, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        with connection:
            with connection.cursor() as cur:
                cur.execute(
                    """INSERT INTO users (username, email, password_hash)
                       VALUES (%s, %s, %s)
                       ON CONFLICT (username) DO UPDATE
                       SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, is_active = TRUE
                       RETURNING id""",
                    (DEMO_USERNAME, DEMO_EMAIL, generate_password_hash(args.password)),
                )
                owner_id = str(cur.fetchone()['id'])
                cur.execute(
                    """INSERT INTO user_roles (user_id, role_id)
                       SELECT %s::uuid, id FROM roles WHERE name = 'editor'
                       ON CONFLICT DO NOTHING""",
                    (owner_id,),
                )
                cur.execute(
                    """DELETE FROM map_layers
                       WHERE source_layer_id IN (
                           SELECT id FROM layers
                           WHERE created_by = %s::uuid
                             AND (group_name = %s OR name LIKE 'Capability %%' OR name LIKE 'QA - %%')
                       )""",
                    (owner_id, DEMO_GROUP),
                )
                cur.execute(
                    """DELETE FROM layers
                       WHERE created_by = %s::uuid
                         AND (group_name = %s OR name LIKE 'Capability %%' OR name LIKE 'QA - %%')""",
                    (owner_id, DEMO_GROUP),
                )
                cur.execute(
                    """SELECT id FROM geodatabases
                       WHERE created_by = %s::uuid AND name = 'Capability QA Geodatabase'
                       ORDER BY created_at LIMIT 1""",
                    (owner_id,),
                )
                geodatabase = cur.fetchone()
                if geodatabase:
                    geodatabase_id = str(geodatabase['id'])
                else:
                    cur.execute(
                        """INSERT INTO geodatabases
                               (name, alias, description, database_type, default_crs, created_by)
                           VALUES ('Capability QA Geodatabase', 'Capability QA Geodatabase',
                                   'Isolated sample data for cartography and labeling regression testing.',
                                   'project', 'EPSG:4326', %s::uuid)
                           RETURNING id""",
                        (owner_id,),
                    )
                    geodatabase_id = str(cur.fetchone()['id'])
                cur.execute(
                    "DELETE FROM utility_network.networks WHERE created_by = %s::uuid AND name = 'Capability Water Network'",
                    (owner_id,),
                )
                layer_ids = {
                    fixture.name: seed_layer(cur, owner_id, geodatabase_id, fixture, 100 - index)
                    for index, fixture in enumerate(fixtures())
                }
                cur.execute(
                    """SELECT id FROM maps
                       WHERE created_by = %s::uuid AND is_default = TRUE AND workspace_id IS NULL""",
                    (owner_id,),
                )
                qa_map = cur.fetchone()
                if qa_map:
                    map_id = str(qa_map['id'])
                    cur.execute(
                        """UPDATE maps
                           SET name = 'Symbology & Labels QA',
                               description = 'Point, line, polygon, renderer, legend, and labeling regression map.',
                               basemap = '{"id":"light","title":"Light Canvas"}'::jsonb,
                               initial_view = '{"center":{"lng":4.59,"lat":8.5},"zoom":11,"bearing":0,"pitch":0}'::jsonb,
                               revision = revision + 1, updated_at = NOW()
                           WHERE id = %s::uuid""",
                        (map_id,),
                    )
                else:
                    cur.execute(
                        """INSERT INTO maps
                               (name, description, basemap, initial_view, is_default, created_by)
                           VALUES ('Symbology & Labels QA',
                                   'Point, line, polygon, renderer, legend, and labeling regression map.',
                                   '{"id":"light","title":"Light Canvas"}'::jsonb,
                                   '{"center":{"lng":4.59,"lat":8.5},"zoom":11,"bearing":0,"pitch":0}'::jsonb,
                                   TRUE, %s::uuid)
                           RETURNING id""",
                        (owner_id,),
                    )
                    map_id = str(cur.fetchone()['id'])
                cur.execute('DELETE FROM map_layers WHERE map_id = %s::uuid', (map_id,))
                default_visible = {
                    'Capability Points - Facilities',
                    'Capability Points - Spatial Statistics',
                    'Capability Lines - Roads',
                    'Capability Polygons - Districts',
                }
                for draw_order, fixture in enumerate(fixtures()):
                    cur.execute(
                        """INSERT INTO map_layers
                               (map_id, source_layer_id, title, draw_order, visible,
                                min_zoom, max_zoom, style_override)
                           VALUES (%s::uuid, %s::uuid, %s, %s, %s, 0, 22, %s::jsonb)""",
                        (
                            map_id, layer_ids[fixture.name], fixture.name,
                            100 - draw_order, fixture.name in default_visible,
                            json.dumps(fixture.style),
                        ),
                    )
                network = seed_utility_network(cur, owner_id)
        print(json.dumps({
            'username': DEMO_USERNAME,
            'password': args.password,
            'group': DEMO_GROUP,
            'layers': layer_ids,
            'map_id': map_id,
            'geodatabase_id': geodatabase_id,
            'utility_network': network,
        }, indent=2))
    finally:
        connection.close()


if __name__ == '__main__':
    main()
