"""Disposable PostGIS correctness tests.

Set TEST_DATABASE_URL to a database whose name contains ``enterprise_gis_test``.
The guard is deliberate: this suite applies migrations and must never target a user database.
"""

import json
import os
import threading
import time
import unittest
from pathlib import Path
from uuid import uuid4

try:
    import psycopg2
    import psycopg2.extras
except ImportError:  # The lightweight local unit-test environment need not install DB drivers.
    psycopg2 = None

from vector_analysis import create_analysis_run, execute_vector_tool, normalize_environments, validate_tool_parameters


TEST_DATABASE_URL = os.getenv('TEST_DATABASE_URL')


@unittest.skipUnless(TEST_DATABASE_URL and psycopg2, 'TEST_DATABASE_URL or psycopg2 is not configured')
class VectorAnalysisPostgisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.connection = psycopg2.connect(
            TEST_DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor
        )
        cursor = cls.connection.cursor()
        cursor.execute('SELECT current_database() AS name')
        database_name = cursor.fetchone()['name']
        if 'enterprise_gis_test' not in database_name:
            raise RuntimeError(
                f'Refusing destructive integration tests against non-test database: {database_name}'
            )
        migration_root = Path(__file__).resolve().parents[1] / 'database' / 'migrations'
        for migration in sorted(migration_root.glob('*.sql')):
            cursor.execute(migration.read_text())
        cls.connection.commit()

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def setUp(self):
        self.connection.rollback()
        self.cursor = self.connection.cursor()
        suffix = uuid4().hex[:10]
        self.cursor.execute(
            """INSERT INTO users (username, email, password_hash)
               VALUES (%s, %s, 'test') RETURNING id""",
            (f'analysis_{suffix}', f'{suffix}@test.invalid'),
        )
        self.user_id = str(self.cursor.fetchone()['id'])

    def tearDown(self):
        self.connection.rollback()

    def add_layer(self, name, geometry_type, features, fields=()):
        self.cursor.execute(
            """INSERT INTO layers (name, geometry_type, created_by)
               VALUES (%s, %s, %s::uuid) RETURNING id""",
            (name, geometry_type, self.user_id),
        )
        layer_id = str(self.cursor.fetchone()['id'])
        for index, (field_name, field_type) in enumerate(fields):
            self.cursor.execute(
                """INSERT INTO layer_fields (layer_id, name, alias, field_type, sort_order)
                   VALUES (%s::uuid, %s, %s, %s, %s)""",
                (layer_id, field_name, field_name.title(), field_type, index),
            )
        for geometry, properties in features:
            self.cursor.execute(
                """INSERT INTO features (layer_id, geometry, properties, created_by)
                   VALUES (%s::uuid, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s::jsonb, %s::uuid)""",
                (layer_id, json.dumps(geometry), json.dumps(properties), self.user_id),
            )
        return layer_id

    def run_tool(self, tool_id, parameters, environments=None):
        return execute_vector_tool(
            self.cursor,
            tool_id=tool_id,
            parameters=parameters,
            environments=environments or {},
            created_by=self.user_id,
        )

    def test_clip_and_erase_conserve_polygon_area(self):
        source = self.add_layer('source', 'Polygon', [(
            {'type': 'Polygon', 'coordinates': [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]},
            {'name': 'source'},
        )], [('name', 'string')])
        mask = self.add_layer('mask', 'Polygon', [(
            {'type': 'Polygon', 'coordinates': [[[1, -1], [3, -1], [3, 3], [1, 3], [1, -1]]]},
            {},
        )])
        clip = self.run_tool('clip', {
            'input_layer': source, 'mask_layer': mask, 'output_name': 'clip result',
        })
        erase = self.run_tool('erase', {
            'input_layer': source, 'mask_layer': mask, 'output_name': 'erase result',
        })
        self.cursor.execute(
            """SELECT
                 (SELECT SUM(ST_Area(geometry)) FROM features WHERE layer_id = %s::uuid) AS source_area,
                 (SELECT SUM(ST_Area(geometry)) FROM features WHERE layer_id = %s::uuid) AS clip_area,
                 (SELECT SUM(ST_Area(geometry)) FROM features WHERE layer_id = %s::uuid) AS erase_area""",
            (source, clip['output_layer_ids'][0], erase['output_layer_ids'][0]),
        )
        areas = self.cursor.fetchone()
        self.assertAlmostEqual(areas['source_area'], areas['clip_area'] + areas['erase_area'], places=9)

    def test_polygonize_closed_grid_and_diagnostics(self):
        lines = self.add_layer('closed linework', 'LineString', [
            ({'type': 'LineString', 'coordinates': [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]}, {}),
            ({'type': 'LineString', 'coordinates': [[2, 0], [3, 0]]}, {}),
        ])
        result = self.run_tool('polygonize', {
            'line_layer': lines, 'output_name': 'blocks', 'create_diagnostics': True,
            'attribute_transfer': 'none',
        })
        self.assertEqual(result['count'], 1)
        self.assertEqual(result['metrics']['diagnostic_count'], 1)
        self.cursor.execute(
            'SELECT ST_IsValid(geometry) AS valid, ST_Area(geometry) AS area '
            'FROM features WHERE layer_id = %s::uuid',
            (result['output_layer_ids'][0],),
        )
        polygon = self.cursor.fetchone()
        self.assertTrue(polygon['valid'])
        self.assertAlmostEqual(polygon['area'], 1.0, places=9)
        self.cursor.execute(
            "SELECT properties ->> 'issue_type' AS issue_type FROM features WHERE layer_id = %s::uuid",
            (result['output_layer_ids'][1],),
        )
        self.assertEqual(self.cursor.fetchone()['issue_type'], 'dangle')

    def test_field_maps_and_dissolve_concatenation(self):
        polygons = self.add_layer('field map polygons', 'Polygon', [
            ({'type': 'Polygon', 'coordinates': [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]},
             {'keep': 'A', 'omit': 'hidden'}),
        ], [('keep', 'string'), ('omit', 'string')])
        points = self.add_layer('field map points', 'Point', [
            ({'type': 'Point', 'coordinates': [0.5, 0.5]}, {'group': 'one', 'label': 'alpha'}),
            ({'type': 'Point', 'coordinates': [1.5, 1.5]}, {'group': 'one', 'label': 'beta'}),
        ], [('group', 'string'), ('label', 'string')])
        intersect = self.run_tool('intersect', {
            'layer_a': polygons, 'layer_b': points, 'output_name': 'mapped intersect',
            'fields_a': ['keep'], 'fields_b': ['label'],
        })
        self.cursor.execute(
            'SELECT ARRAY_AGG(name ORDER BY name) AS names FROM layer_fields WHERE layer_id = %s::uuid',
            (intersect['output_layer_ids'][0],),
        )
        names = self.cursor.fetchone()['names']
        self.assertIn('a_keep', names)
        self.assertIn('b_label', names)
        self.assertNotIn('a_omit', names)

        dissolved = self.run_tool('dissolve', {
            'layer_id': points,
            'output_name': 'concatenated dissolve',
            'dissolve_fields': ['group'],
            'statistics': [{'field': 'label', 'statistic': 'concatenate', 'output_field': 'labels'}],
            'concatenate_delimiter': ' | ',
            'concatenate_max_length': 100,
        })
        self.cursor.execute(
            "SELECT properties ->> 'labels' AS labels FROM features WHERE layer_id = %s::uuid",
            (dissolved['output_layer_ids'][0],),
        )
        self.assertEqual(set(self.cursor.fetchone()['labels'].split('|')), {'alpha', 'beta'})

    def test_near_is_geodesic_across_antimeridian_and_deterministic(self):
        source = self.add_layer('source points', 'Point', [
            ({'type': 'Point', 'coordinates': [179.9, 0]}, {'name': 'source'}),
        ], [('name', 'string')])
        candidates = self.add_layer('candidate points', 'Point', [
            ({'type': 'Point', 'coordinates': [-179.9, 0]}, {'name': 'across date line'}),
            ({'type': 'Point', 'coordinates': [170, 0]}, {'name': 'farther'}),
        ], [('name', 'string')])
        result = self.run_tool('near', {
            'source_layer': source, 'near_layer': candidates, 'output_name': 'near result',
            'nearest_count': 1, 'output_geometry': 'connecting_line',
        })
        self.cursor.execute(
            "SELECT (properties ->> 'distance_m')::double precision AS distance_m "
            'FROM features WHERE layer_id = %s::uuid',
            (result['output_layer_ids'][0],),
        )
        distance = self.cursor.fetchone()['distance_m']
        self.assertGreater(distance, 20_000)
        self.assertLess(distance, 23_000)

    def test_repair_policy_does_not_commit_source_mutation(self):
        invalid = self.add_layer('invalid polygons', 'Polygon', [(
            {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},
            {},
        )])
        self.cursor.execute(
            'SELECT ST_AsEWKB(geometry) AS original, ST_IsValid(geometry) AS valid '
            'FROM features WHERE layer_id = %s::uuid',
            (invalid,),
        )
        original = self.cursor.fetchone()
        self.assertFalse(original['valid'])
        result = self.run_tool('geometry_quality', {
            'layer_id': invalid, 'output_name': 'repaired', 'operation': 'repair',
        }, {'invalid_geometry_policy': 'repair'})
        self.cursor.execute(
            'SELECT ST_AsEWKB(geometry) AS current FROM features WHERE layer_id = %s::uuid',
            (invalid,),
        )
        self.assertEqual(bytes(original['original']), bytes(self.cursor.fetchone()['current']))
        self.cursor.execute(
            'SELECT BOOL_AND(ST_IsValid(geometry)) AS valid FROM features WHERE layer_id = %s::uuid',
            (result['output_layer_ids'][0],),
        )
        self.assertTrue(self.cursor.fetchone()['valid'])

    def test_transaction_rollback_leaves_no_output_layer(self):
        source = self.add_layer('rollback source', 'Point', [
            ({'type': 'Point', 'coordinates': [3, 6]}, {}),
        ])
        self.connection.commit()
        self.run_tool('buffer', {
            'layer_id': source, 'distance': 100, 'output_name': 'must rollback',
        })
        self.connection.rollback()
        self.cursor = self.connection.cursor()
        self.cursor.execute("SELECT COUNT(*) AS count FROM layers WHERE name = 'must rollback'")
        self.assertEqual(self.cursor.fetchone()['count'], 0)

    def test_spatial_index_supports_knn_candidate_plan(self):
        layer = self.add_layer('knn points', 'Point', [
            ({'type': 'Point', 'coordinates': [index / 1000, 0]}, {}) for index in range(100)
        ])
        self.cursor.execute('SET LOCAL enable_seqscan = off')
        self.cursor.execute(
            """EXPLAIN (FORMAT TEXT)
               SELECT id FROM features WHERE layer_id = %s::uuid
               ORDER BY geometry <-> ST_SetSRID(ST_MakePoint(0, 0), 4326) LIMIT 1""",
            (layer,),
        )
        plan = '\n'.join(row['QUERY PLAN'] for row in self.cursor.fetchall())
        self.assertIn('idx_features_layer_geometry_gist', plan)
        self.cursor.execute(
            """EXPLAIN (FORMAT TEXT)
               SELECT id FROM features WHERE layer_id = %s::uuid
               ORDER BY geometry::geography <-> ST_SetSRID(ST_MakePoint(179.9, 0), 4326)::geography LIMIT 1""",
            (layer,),
        )
        geography_plan = '\n'.join(row['QUERY PLAN'] for row in self.cursor.fetchall())
        self.assertIn('idx_features_layer_geography_gist', geography_plan)

    def test_split_merge_and_reproject_management_tools(self):
        lines = self.add_layer('split source', 'LineString', [
            ({'type': 'LineString', 'coordinates': [[0, 0], [0.02, 0]]}, {'road': 'A'}),
        ], [('road', 'string')])
        points = self.add_layer('split points', 'Point', [
            ({'type': 'Point', 'coordinates': [0.01, 0]}, {}),
        ])
        split = self.run_tool('split_lines_at_points', {
            'line_layer': lines, 'point_layer': points, 'output_name': 'split output', 'tolerance': 5,
        })
        self.assertEqual(split['count'], 2)

        second_lines = self.add_layer('second lines', 'LineString', [
            ({'type': 'LineString', 'coordinates': [[0, 1], [0.02, 1]]}, {'class': 2}),
        ], [('class', 'integer')])
        merged = self.run_tool('merge_layers', {
            'layer_a': lines, 'layer_b': second_lines, 'output_name': 'merged output',
            'schema_strategy': 'union',
        })
        self.assertEqual(merged['count'], 2)
        self.cursor.execute(
            'SELECT ARRAY_AGG(name ORDER BY name) AS names FROM layer_fields WHERE layer_id = %s::uuid',
            (merged['output_layer_ids'][0],),
        )
        self.assertTrue({'road', 'class', 'source_layer_id', 'source_feature_id'}.issubset(set(self.cursor.fetchone()['names'])))

        projected = self.add_layer('projected coordinates', 'Point', [
            ({'type': 'Point', 'coordinates': [333958.472, 669141.057]}, {}),
        ])
        reprojected = self.run_tool('reproject', {
            'layer_id': projected, 'source_crs': 'EPSG:3857', 'output_name': 'normalized coordinates',
        })
        self.cursor.execute(
            'SELECT ST_X(geometry) AS x, ST_Y(geometry) AS y FROM features WHERE layer_id = %s::uuid',
            (reprojected['output_layer_ids'][0],),
        )
        coordinate = self.cursor.fetchone()
        self.assertAlmostEqual(coordinate['x'], 3.0, places=3)
        self.assertAlmostEqual(coordinate['y'], 6.0, places=3)

    def test_geometry_quality_and_topology_diagnostics(self):
        duplicate_points = self.add_layer('duplicate points', 'Point', [
            ({'type': 'Point', 'coordinates': [0, 0]}, {}),
            ({'type': 'Point', 'coordinates': [0, 0]}, {}),
            ({'type': 'Point', 'coordinates': [1, 1]}, {}),
        ])
        duplicates = self.run_tool('geometry_quality', {
            'layer_id': duplicate_points, 'output_name': 'duplicates',
            'operation': 'detect_duplicates', 'only_issues': True,
        })
        self.assertEqual(duplicates['count'], 2)

        polygons = self.add_layer('topology polygons', 'Polygon', [
            ({'type': 'Polygon', 'coordinates': [[[0, 0], [1.2, 0], [1.2, 1], [0, 1], [0, 0]]]}, {}),
            ({'type': 'Polygon', 'coordinates': [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]]}, {}),
            ({'type': 'Polygon', 'coordinates': [[[0, 1.5], [0.01, 1.5], [0.01, 1.51], [0, 1.51], [0, 1.5]]]}, {}),
        ])
        coverage = self.add_layer('coverage boundary', 'Polygon', [
            ({'type': 'Polygon', 'coordinates': [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]}, {}),
        ])
        topology = self.run_tool('topology_validate', {
            'polygon_layer': polygons, 'coverage_layer': coverage, 'output_name': 'topology issues',
            'checks': ['overlaps', 'gaps', 'slivers'], 'sliver_area': 2_000_000,
        })
        self.assertGreaterEqual(topology['count'], 3)
        self.cursor.execute(
            "SELECT ARRAY_AGG(DISTINCT properties ->> 'issue_type') AS issues "
            'FROM features WHERE layer_id = %s::uuid',
            (topology['output_layer_ids'][0],),
        )
        self.assertTrue({'overlap', 'gap', 'sliver'}.issubset(set(self.cursor.fetchone()['issues'])))

    def test_spatial_statistics_operations_produce_valid_outputs(self):
        points = self.add_layer('statistical points', 'Point', [
            ({'type': 'Point', 'coordinates': [3.0, 6.0]}, {'value': 10}),
            ({'type': 'Point', 'coordinates': [3.01, 6.0]}, {'value': 12}),
            ({'type': 'Point', 'coordinates': [3.0, 6.01]}, {'value': 30}),
            ({'type': 'Point', 'coordinates': [3.02, 6.02]}, {'value': 40}),
        ], [('value', 'double')])
        operations = [
            'mean_center', 'median_center', 'central_feature', 'standard_distance',
            'directional_distribution', 'nearest_neighbor', 'spatial_autocorrelation', 'hot_spot',
        ]
        for operation in operations:
            payload = {
                'layer_id': points, 'output_name': f'stat {operation}', 'operation': operation,
            }
            if operation in {'spatial_autocorrelation', 'hot_spot'}:
                payload.update({'value_field': 'value', 'distance_band': 3000})
            result = self.run_tool('spatial_statistics', payload)
            self.assertGreater(result['count'], 0, operation)
            self.cursor.execute(
                'SELECT BOOL_AND(ST_IsValid(geometry)) AS valid FROM features WHERE layer_id = %s::uuid',
                (result['output_layer_ids'][0],),
            )
            self.assertTrue(self.cursor.fetchone()['valid'], operation)

    def test_quality_generalization_operations_execute_in_postgis(self):
        lines = self.add_layer('quality lines', 'LineString', [
            ({'type': 'LineString', 'coordinates': [[0, 0], [0.005, 0.001], [0.01, 0]]}, {}),
            ({'type': 'LineString', 'coordinates': [[0.01, 0], [0.02, 0]]}, {}),
        ])
        for operation, extra in [
            ('check', {'only_issues': False}),
            ('snap_integrate', {'tolerance': 0.0001}),
            ('simplify', {'tolerance': 0.0001}),
            ('smooth', {'iterations': 2}),
            ('densify', {'tolerance': 100}),
        ]:
            result = self.run_tool('geometry_quality', {
                'layer_id': lines, 'output_name': f'quality {operation}', 'operation': operation, **extra,
            })
            self.assertGreater(result['count'], 0, operation)

        polygons = self.add_layer('quality polygons', 'Polygon', [
            ({'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}, {}),
            ({'type': 'Polygon', 'coordinates': [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]]}, {}),
            ({'type': 'Polygon', 'coordinates': [[[2, 0], [2.001, 0], [2.001, 0.001], [2, 0.001], [2, 0]]]}, {}),
        ])
        aggregate = self.run_tool('geometry_quality', {
            'layer_id': polygons, 'output_name': 'aggregated polygons',
            'operation': 'aggregate_polygons', 'tolerance': 0.01,
        })
        self.assertEqual(aggregate['count'], 1)
        eliminated = self.run_tool('geometry_quality', {
            'layer_id': polygons, 'output_name': 'eliminated slivers',
            'operation': 'eliminate_slivers', 'area_threshold': 20_000,
        })
        self.assertLess(eliminated['count'], 3)

    def test_sync_and_worker_buffer_outputs_are_equivalent(self):
        from enterprise_utils import create_async_job
        from job_runner import process_job

        source = self.add_layer('equivalence source', 'Point', [
            ({'type': 'Point', 'coordinates': [3, 6]}, {'name': 'A'}),
            ({'type': 'Point', 'coordinates': [3.01, 6.01]}, {'name': 'B'}),
        ], [('name', 'string')])
        sync_result = self.run_tool('buffer', {
            'layer_id': source, 'distance': 250, 'output_name': 'sync buffer',
        })
        parameters = validate_tool_parameters('buffer', {
            'layer_id': source, 'distance': 250, 'output_name': 'worker buffer',
        })
        environments = normalize_environments({})
        run = create_analysis_run(
            self.cursor, tool_id='buffer', execution_mode='asynchronous', parameters=parameters,
            environments=environments, input_layer_ids=[source], created_by=self.user_id, status='queued',
        )
        job = create_async_job(
            self.cursor, job_type='analysis.buffer', payload={
                'analysis_run_id': str(run['id']), 'tool_id': 'buffer',
                'parameters': parameters, 'environments': environments,
            }, created_by=self.user_id,
        )
        self.connection.commit()
        self.assertTrue(process_job(TEST_DATABASE_URL, str(job['id'])))
        self.cursor = self.connection.cursor()
        self.cursor.execute('SELECT result FROM async_jobs WHERE id = %s::uuid', (str(job['id']),))
        async_result = self.cursor.fetchone()['result']
        async_layer = async_result['output_layer_ids'][0]
        self.cursor.execute(
            """SELECT ST_Equals(
                    (SELECT ST_UnaryUnion(ST_Collect(geometry)) FROM features WHERE layer_id = %s::uuid),
                    (SELECT ST_UnaryUnion(ST_Collect(geometry)) FROM features WHERE layer_id = %s::uuid)
                ) AS equal""",
            (sync_result['output_layer_ids'][0], async_layer),
        )
        self.assertTrue(self.cursor.fetchone()['equal'])
        self.cursor.execute(
            """SELECT layer_id::text, ARRAY_AGG(name ORDER BY name) AS fields
               FROM layer_fields WHERE layer_id = ANY(%s::uuid[]) GROUP BY layer_id""",
            ([sync_result['output_layer_ids'][0], async_layer],),
        )
        schemas = [row['fields'] for row in self.cursor.fetchall()]
        self.assertEqual(schemas[0], schemas[1])

    def test_filtered_extent_multipart_and_collision_environments(self):
        points = self.add_layer('scoped points', 'Point', [
            ({'type': 'Point', 'coordinates': [0, 0]}, {'value': 1}),
            ({'type': 'Point', 'coordinates': [1, 1]}, {'value': 5}),
            ({'type': 'Point', 'coordinates': [2, 2]}, {'value': 10}),
        ], [('value', 'double')])
        filtered = self.run_tool('buffer', {
            'layer_id': points, 'distance': 10, 'output_name': 'filtered buffer',
        }, {
            'scope': 'filtered',
            'filters': [{'field': 'value', 'operator': 'greater_than', 'value': 2}],
        })
        self.assertEqual(filtered['count'], 2)
        extent = self.run_tool('buffer', {
            'layer_id': points, 'distance': 10, 'output_name': 'extent buffer',
        }, {'scope': 'extent', 'extent': [-0.1, -0.1, 0.1, 0.1]})
        self.assertEqual(extent['count'], 1)

        multipart = self.add_layer('multipart source', 'MultiPolygon', [(
            {'type': 'MultiPolygon', 'coordinates': [
                [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]],
            ]}, {},
        )])
        exploded = self.run_tool('reproject', {
            'layer_id': multipart, 'source_crs': 'EPSG:4326', 'output_name': 'exploded copy',
        }, {'multipart_policy': 'explode'})
        self.assertEqual(exploded['count'], 2)

        suffixed = self.run_tool('buffer', {
            'layer_id': points, 'distance': 10, 'output_name': 'filtered buffer',
        }, {'output_collision_policy': 'suffix'})
        self.assertEqual(suffixed['layer']['name'], 'filtered buffer (2)')
        with self.assertRaisesRegex(Exception, 'already exists'):
            self.run_tool('buffer', {
                'layer_id': points, 'distance': 10, 'output_name': 'filtered buffer',
            }, {'output_collision_policy': 'error'})

    def test_running_analysis_cancellation_interrupts_backend(self):
        from flask_jwt_extended import create_access_token
        from app import create_app

        self.cursor.execute(
            """INSERT INTO async_jobs (job_type, status, progress, payload, created_by)
               VALUES ('analysis.buffer', 'running', 10, '{}'::jsonb, %s::uuid) RETURNING id""",
            (self.user_id,),
        )
        job_id = str(self.cursor.fetchone()['id'])
        sleeper = psycopg2.connect(TEST_DATABASE_URL)
        sleeper_cursor = sleeper.cursor()
        sleeper_cursor.execute('SELECT pg_backend_pid()')
        backend_pid = sleeper_cursor.fetchone()[0]
        self.cursor.execute(
            """INSERT INTO analysis_runs
               (tool_id, tool_version, status, execution_mode, parameters, environments,
                input_layer_ids, input_layer_revisions, async_job_id, created_by, worker_backend_pid)
               VALUES ('buffer', 1, 'running', 'asynchronous', '{}'::jsonb, '{}'::jsonb,
                       '[]'::jsonb, '{}'::jsonb, %s::uuid, %s::uuid, %s) RETURNING id""",
            (job_id, self.user_id, backend_pid),
        )
        run_id = str(self.cursor.fetchone()['id'])
        self.connection.commit()
        interrupted = threading.Event()

        def sleep_until_cancelled():
            try:
                sleeper_cursor.execute('SELECT pg_sleep(30)')
            except psycopg2.Error:
                sleeper.rollback()
                interrupted.set()

        thread = threading.Thread(target=sleep_until_cancelled, daemon=True)
        thread.start()
        time.sleep(0.2)

        class TestConfig:
            TESTING = True
            SECRET_KEY = 'test'
            JWT_SECRET_KEY = 'test-jwt'
            DATABASE_URL = TEST_DATABASE_URL
            FRONTEND_URL = None
            REDIS_URL = 'redis://127.0.0.1:1/0'
            JOB_QUEUE_NAME = 'unused'

        application = create_app(TestConfig)
        with application.app_context():
            token = create_access_token(identity=self.user_id)
        response = application.test_client().post(
            f'/api/v1/analysis/runs/{run_id}/cancel',
            headers={'Authorization': f'Bearer {token}'},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()['status'], 'cancelled')
        thread.join(timeout=5)
        self.assertTrue(interrupted.is_set())
        sleeper.close()
        self.cursor = self.connection.cursor()
        self.cursor.execute('SELECT status FROM async_jobs WHERE id = %s::uuid', (job_id,))
        self.assertEqual(self.cursor.fetchone()['status'], 'cancelled')

    def test_private_inputs_are_hidden_and_public_inputs_are_read_only(self):
        from flask_jwt_extended import create_access_token
        from app import create_app

        private_layer = self.add_layer('private analysis input', 'Point', [
            ({'type': 'Point', 'coordinates': [0, 0]}, {'name': 'source'}),
        ], [('name', 'string')])
        self.cursor.execute(
            """INSERT INTO users (username, email, password_hash)
               VALUES ('analysis_other', 'analysis_other@example.test', 'unused') RETURNING id"""
        )
        other_user_id = str(self.cursor.fetchone()['id'])
        self.connection.commit()

        class TestConfig:
            TESTING = True
            SECRET_KEY = 'test-secret-key-for-analysis-suite'
            JWT_SECRET_KEY = 'test-jwt-secret-key-for-analysis-suite'
            DATABASE_URL = TEST_DATABASE_URL
            FRONTEND_URL = None
            REDIS_URL = 'redis://127.0.0.1:1/0'
            JOB_QUEUE_NAME = 'unused'

        application = create_app(TestConfig)
        with application.app_context():
            token = create_access_token(identity=other_user_id)
        client = application.test_client()
        payload = {'layer_id': private_layer, 'distance': 10, 'output_name': 'read-only output'}
        hidden = client.post(
            '/api/v1/analysis/tools/buffer/run', json=payload,
            headers={'Authorization': f'Bearer {token}'},
        )
        self.assertEqual(hidden.status_code, 404, hidden.get_json())

        self.cursor = self.connection.cursor()
        self.cursor.execute('UPDATE layers SET is_public = TRUE WHERE id = %s::uuid', (private_layer,))
        self.connection.commit()
        allowed = client.post(
            '/api/v1/analysis/tools/buffer/run', json=payload,
            headers={'Authorization': f'Bearer {token}'},
        )
        self.assertEqual(allowed.status_code, 201, allowed.get_json())
        output_layer = allowed.get_json()['layer']['id']
        self.cursor = self.connection.cursor()
        self.cursor.execute(
            'SELECT created_by::text AS created_by FROM layers WHERE id = %s::uuid',
            (output_layer,),
        )
        self.assertEqual(self.cursor.fetchone()['created_by'], other_user_id)
        self.cursor.execute(
            'SELECT properties FROM features WHERE layer_id = %s::uuid', (private_layer,),
        )
        self.assertEqual(self.cursor.fetchone()['properties']['name'], 'source')


if __name__ == '__main__':
    unittest.main()
