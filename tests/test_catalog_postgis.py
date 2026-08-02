"""Disposable PostGIS tests for persistent maps and the data catalog.

Set TEST_DATABASE_URL to a database whose name contains ``enterprise_gis_test``.
The suite applies every migration and never runs against the application database.
"""

import os
import unittest
from pathlib import Path
from uuid import uuid4

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None


TEST_DATABASE_URL = os.getenv('TEST_DATABASE_URL')


@unittest.skipUnless(TEST_DATABASE_URL and psycopg2, 'TEST_DATABASE_URL or psycopg2 is not configured')
class CatalogPostgisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app

        connection = psycopg2.connect(TEST_DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
        cursor = connection.cursor()
        cursor.execute('SELECT current_database() AS name')
        database_name = cursor.fetchone()['name']
        if 'enterprise_gis_test' not in database_name:
            raise RuntimeError(f'Refusing catalog tests against non-test database: {database_name}')
        migration_root = Path(__file__).resolve().parents[1] / 'database' / 'migrations'
        for migration in sorted(migration_root.glob('*.sql')):
            cursor.execute(migration.read_text())
        connection.commit()
        connection.close()

        class TestConfig:
            TESTING = True
            SECRET_KEY = 'catalog-test'
            JWT_SECRET_KEY = 'catalog-test-jwt'
            DATABASE_URL = TEST_DATABASE_URL
            FRONTEND_URL = None
            REDIS_URL = 'redis://127.0.0.1:1/0'
            JOB_QUEUE_NAME = 'unused'

        cls.application = create_app(TestConfig)

    def setUp(self):
        from flask_jwt_extended import create_access_token

        self.connection = psycopg2.connect(
            TEST_DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor
        )
        self.cursor = self.connection.cursor()
        suffix = uuid4().hex[:10]
        self.suffix = suffix
        self.cursor.execute(
            """INSERT INTO users (username, email, password_hash)
               VALUES (%s, %s, 'unused') RETURNING id""",
            (f'catalog_{suffix}', f'catalog_{suffix}@test.invalid'),
        )
        self.user_id = str(self.cursor.fetchone()['id'])
        self.cursor.execute(
            """INSERT INTO layers (
                   name, description, geometry_type, catalog_status, tags, created_by
               ) VALUES (%s, 'Water distribution assets', 'LineString',
                         'authoritative', ARRAY['water', 'utility'], %s::uuid) RETURNING id""",
            (f'Water mains {suffix}', self.user_id),
        )
        self.layer_id = str(self.cursor.fetchone()['id'])
        self.connection.commit()
        with self.application.app_context():
            self.token = create_access_token(identity=self.user_id)
        self.client = self.application.test_client()
        self.headers = {'Authorization': f'Bearer {self.token}'}

    def tearDown(self):
        self.connection.rollback()
        # The suite deliberately verifies that map removal preserves source layers.
        # Those layers retain their creator FK, so cleanup happens by dropping the
        # guarded disposable database after the suite rather than deleting users.
        self.connection.close()

    def test_map_reference_style_and_source_preservation(self):
        maps_response = self.client.get('/api/v1/maps', headers=self.headers)
        self.assertEqual(maps_response.status_code, 200, maps_response.get_json())
        maps = maps_response.get_json()
        self.assertEqual(len([item for item in maps if item['is_default']]), 1)
        map_id = next(item['id'] for item in maps if item['is_default'])

        added = self.client.post(
            f'/api/v1/maps/{map_id}/layers',
            json={'source_layer_ids': [self.layer_id]},
            headers=self.headers,
        )
        self.assertEqual(added.status_code, 201, added.get_json())
        map_layer_id = added.get_json()[0]['id']

        styled = self.client.patch(
            f'/api/v1/maps/{map_id}/layers/{map_layer_id}',
            json={'style_override': {'color': '#0057b8', 'lineWidth': 4}, 'visible': False},
            headers=self.headers,
        )
        self.assertEqual(styled.status_code, 200, styled.get_json())

        loaded = self.client.get(f'/api/v1/maps/{map_id}', headers=self.headers)
        self.assertEqual(loaded.status_code, 200, loaded.get_json())
        item = loaded.get_json()['layers'][0]
        self.assertEqual(item['source_layer_id'], self.layer_id)
        self.assertEqual(item['effective_style']['lineWidth'], 4)
        self.assertFalse(item['visible'])

        removed = self.client.delete(
            f'/api/v1/maps/{map_id}/layers/{map_layer_id}', headers=self.headers
        )
        self.assertEqual(removed.status_code, 200, removed.get_json())
        self.cursor.execute('SELECT id FROM layers WHERE id = %s::uuid', (self.layer_id,))
        self.assertIsNotNone(self.cursor.fetchone(), 'Removing a map item must not delete source data')

    def test_catalog_search_favorite_geodatabase_and_group_copy(self):
        geodatabase = self.client.post(
            '/api/v1/geodatabases',
            json={'name': 'Utility Geodatabase', 'default_crs': 'EPSG:32631'},
            headers=self.headers,
        )
        self.assertEqual(geodatabase.status_code, 201, geodatabase.get_json())
        geodatabase_id = geodatabase.get_json()['id']
        self.assertEqual(geodatabase.get_json()['layer_count'], 0)
        self.assertEqual(geodatabase.get_json()['feature_dataset_count'], 0)

        duplicate_geodatabase = self.client.post(
            '/api/v1/geodatabases',
            json={'name': 'utility geodatabase'},
            headers=self.headers,
        )
        self.assertEqual(duplicate_geodatabase.status_code, 409, duplicate_geodatabase.get_json())

        feature_dataset = self.client.post(
            f'/api/v1/geodatabases/{geodatabase_id}/feature-datasets',
            json={'name': 'Distribution Assets', 'crs': 'EPSG:4326'},
            headers=self.headers,
        )
        self.assertEqual(feature_dataset.status_code, 201, feature_dataset.get_json())
        feature_dataset_id = feature_dataset.get_json()['id']
        self.assertEqual(feature_dataset.get_json()['layer_count'], 0)

        duplicate_dataset = self.client.post(
            f'/api/v1/geodatabases/{geodatabase_id}/feature-datasets',
            json={'name': 'distribution assets', 'crs': 'EPSG:4326'},
            headers=self.headers,
        )
        self.assertEqual(duplicate_dataset.status_code, 409, duplicate_dataset.get_json())

        moved = self.client.put(
            f'/api/v1/layers/{self.layer_id}',
            json={
                'geodatabase_id': geodatabase_id,
                'feature_dataset_id': feature_dataset_id,
            },
            headers=self.headers,
        )
        self.assertEqual(moved.status_code, 200, moved.get_json())

        feature_datasets = self.client.get(
            f'/api/v1/geodatabases/{geodatabase_id}/feature-datasets', headers=self.headers
        )
        self.assertEqual(feature_datasets.status_code, 200, feature_datasets.get_json())
        self.assertEqual(feature_datasets.get_json()[0]['layer_count'], 1)
        geodatabases = self.client.get('/api/v1/geodatabases', headers=self.headers).get_json()
        counted = next(item for item in geodatabases if item['id'] == geodatabase_id)
        self.assertEqual(counted['layer_count'], 1)
        self.assertEqual(counted['feature_dataset_count'], 1)

        search = self.client.get(f'/api/v1/catalog/items?q={self.suffix}', headers=self.headers)
        self.assertEqual(search.status_code, 200, search.get_json())
        self.assertEqual(search.get_json()['total'], 1)
        self.assertEqual(search.get_json()['items'][0]['catalog_status'], 'authoritative')

        favorite = self.client.post(
            f'/api/v1/catalog/items/layer/{self.layer_id}/favorite', headers=self.headers
        )
        self.assertEqual(favorite.status_code, 200, favorite.get_json())
        favorites = self.client.get(
            '/api/v1/catalog/items?collection=favorites', headers=self.headers
        )
        self.assertEqual(favorites.get_json()['total'], 1)

        created_map = self.client.post(
            '/api/v1/maps', json={'name': 'Operations Map'}, headers=self.headers
        ).get_json()
        group = self.client.post(
            f'/api/v1/maps/{created_map["id"]}/groups',
            json={'title': 'Utilities'}, headers=self.headers,
        )
        self.assertEqual(group.status_code, 201, group.get_json())
        added = self.client.post(
            f'/api/v1/maps/{created_map["id"]}/layers',
            json={'source_layer_ids': [self.layer_id], 'parent_id': group.get_json()['id']},
            headers=self.headers,
        )
        self.assertEqual(added.status_code, 201, added.get_json())

        duplicate = self.client.post(
            f'/api/v1/maps/{created_map["id"]}/duplicate',
            json={'name': 'Operations Map Copy'}, headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 201, duplicate.get_json())
        copied = self.client.get(
            f'/api/v1/maps/{duplicate.get_json()["id"]}', headers=self.headers
        ).get_json()
        copied_group = next(item for item in copied['layers'] if item['layer_kind'] == 'group')
        copied_layer = next(item for item in copied['layers'] if item['layer_kind'] == 'feature')
        self.assertEqual(copied_layer['parent_id'], copied_group['id'])

    def test_shared_map_redacts_inaccessible_source_metadata(self):
        from flask_jwt_extended import create_access_token

        created_map = self.client.post(
            '/api/v1/maps', json={'name': 'Shared Map', 'is_public': True}, headers=self.headers
        ).get_json()
        self.client.post(
            f'/api/v1/maps/{created_map["id"]}/layers',
            json={'source_layer_ids': [self.layer_id]}, headers=self.headers,
        )
        suffix = uuid4().hex[:10]
        self.cursor.execute(
            """INSERT INTO users (username, email, password_hash)
               VALUES (%s, %s, 'unused') RETURNING id""",
            (f'catalog_viewer_{suffix}', f'catalog_viewer_{suffix}@test.invalid'),
        )
        viewer_id = str(self.cursor.fetchone()['id'])
        self.connection.commit()
        with self.application.app_context():
            viewer_token = create_access_token(identity=viewer_id)

        response = self.client.get(
            f'/api/v1/maps/{created_map["id"]}',
            headers={'Authorization': f'Bearer {viewer_token}'},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        item = next(layer for layer in response.get_json()['layers'] if layer['layer_kind'] == 'feature')
        self.assertFalse(item['source_accessible'])
        self.assertIsNone(item['source'])
        self.assertEqual(item['effective_style'], {})

        self.cursor.execute('DELETE FROM users WHERE id = %s::uuid', (viewer_id,))
        self.connection.commit()

    def test_style_validation_and_map_override_persistence(self):
        valid_style = {
            'rendererType': 'classBreaks',
            'classBreakField': 'pressure',
            'classBreakStops': [
                {'min': 50, 'max': 100, 'color': '#d1495b', 'opacity': 1},
                {'min': 0, 'max': 50, 'color': '#2a9d8f', 'opacity': 0.75},
            ],
            'classBreakDefaultColor': '#6c757d',
            'classBreakDefaultOpacity': 0,
            'labelField': 'name',
            'labelMinZoom': 4,
            'labelMaxZoom': 18,
            'labelTextExpression': '["coalesce",["get","name"],"Unnamed"]',
        }
        updated = self.client.put(
            f'/api/v1/layers/{self.layer_id}',
            json={'style': valid_style}, headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200, updated.get_json())
        self.assertEqual(updated.get_json()['style']['classBreakDefaultOpacity'], 0)

        invalid = self.client.put(
            f'/api/v1/layers/{self.layer_id}',
            json={'style': {
                'rendererType': 'classBreaks',
                'classBreakStops': [
                    {'min': 0, 'max': 10, 'color': '#00ff00'},
                    {'min': 5, 'max': 20, 'color': 'red'},
                ],
            }},
            headers=self.headers,
        )
        self.assertEqual(invalid.status_code, 400, invalid.get_json())
        self.assertEqual(invalid.get_json()['error'], 'Invalid layer style')
        self.assertTrue(any('overlaps' in detail for detail in invalid.get_json()['details']))

        source = self.client.get(f'/api/v1/layers/{self.layer_id}', headers=self.headers)
        self.assertEqual(source.get_json()['style'], valid_style)

        map_id = next(
            item['id'] for item in self.client.get('/api/v1/maps', headers=self.headers).get_json()
            if item['is_default']
        )
        added = self.client.post(
            f'/api/v1/maps/{map_id}/layers',
            json={'source_layer_ids': [self.layer_id]}, headers=self.headers,
        )
        self.assertEqual(added.status_code, 201, added.get_json())
        map_layer_id = added.get_json()[0]['id']
        override = {**valid_style, 'labelColor': '#ffffff', 'labelHaloColor': '#000000'}
        patched = self.client.patch(
            f'/api/v1/maps/{map_id}/layers/{map_layer_id}',
            json={'style_override': override}, headers=self.headers,
        )
        self.assertEqual(patched.status_code, 200, patched.get_json())
        loaded = self.client.get(f'/api/v1/maps/{map_id}', headers=self.headers).get_json()
        map_layer = next(item for item in loaded['layers'] if item['id'] == map_layer_id)
        self.assertEqual(map_layer['effective_style'], override)


if __name__ == '__main__':
    unittest.main()
