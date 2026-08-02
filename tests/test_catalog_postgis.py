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
        self.cursor.execute('DELETE FROM users WHERE id = %s::uuid', (self.user_id,))
        self.connection.commit()
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

        self.cursor.execute(
            'UPDATE layers SET geodatabase_id = %s::uuid WHERE id = %s::uuid',
            (geodatabase_id, self.layer_id),
        )
        self.connection.commit()

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


if __name__ == '__main__':
    unittest.main()
