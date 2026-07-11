import unittest

from spatial_validation import GeometryValidationError, validate_geojson_geometry


class FakeCursor:
    def __init__(self, row=None, error=None):
        self.row = row
        self.error = error
        self.params = None

    def execute(self, _query, params):
        self.params = params
        if self.error:
            raise self.error

    def fetchone(self):
        return self.row


class GeometryValidationTests(unittest.TestCase):
    def test_returns_postgis_normalized_geometry(self):
        cursor = FakeCursor({
            'is_empty': False,
            'is_valid': True,
            'validity_reason': 'Valid Geometry',
            'geometry_type': 'POINT',
            'normalized_geometry': '{"type":"Point","coordinates":[3,7]}',
        })

        result = validate_geojson_geometry(
            cursor,
            {'type': 'Point', 'coordinates': [3.0, 7.0]},
        )

        self.assertEqual(result.geometry, {'type': 'Point', 'coordinates': [3, 7]})
        self.assertEqual(result.geometry_type, 'POINT')
        self.assertEqual(cursor.params[1], 4326)

    def test_rejects_spatially_invalid_geometry_with_reason(self):
        cursor = FakeCursor({
            'is_empty': False,
            'is_valid': False,
            'validity_reason': 'Self-intersection[1 1]',
            'geometry_type': 'POLYGON',
            'normalized_geometry': '{"type":"Polygon","coordinates":[]}',
        })

        with self.assertRaisesRegex(GeometryValidationError, 'Self-intersection'):
            validate_geojson_geometry(cursor, {'type': 'Polygon', 'coordinates': []})

    def test_rejects_empty_geometry(self):
        cursor = FakeCursor({
            'is_empty': True,
            'is_valid': True,
            'validity_reason': 'Valid Geometry',
            'geometry_type': 'POINT',
            'normalized_geometry': '{"type":"Point","coordinates":[]}',
        })

        with self.assertRaisesRegex(GeometryValidationError, 'empty geometry'):
            validate_geojson_geometry(cursor, {'type': 'Point', 'coordinates': []})

    def test_rejects_non_finite_coordinates_before_database_call(self):
        cursor = FakeCursor()

        with self.assertRaisesRegex(GeometryValidationError, 'non-finite'):
            validate_geojson_geometry(
                cursor,
                {'type': 'Point', 'coordinates': [float('nan'), 7]},
            )

        self.assertIsNone(cursor.params)

    def test_rejects_geometry_collections(self):
        with self.assertRaisesRegex(GeometryValidationError, 'GeometryCollection'):
            validate_geojson_geometry(
                FakeCursor(),
                {'type': 'GeometryCollection', 'geometries': []},
            )

    def test_maps_postgis_parse_failures_to_validation_error(self):
        cursor = FakeCursor(error=RuntimeError('parse error'))

        with self.assertRaisesRegex(GeometryValidationError, 'not valid GeoJSON'):
            validate_geojson_geometry(cursor, {'type': 'Point', 'coordinates': ['bad', 7]})

    def test_rejects_unexpected_exact_geometry_type(self):
        cursor = FakeCursor()

        with self.assertRaisesRegex(GeometryValidationError, 'must be LineString'):
            validate_geojson_geometry(
                cursor,
                {'type': 'Point', 'coordinates': [3, 7]},
                expected_type='LineString',
            )

        self.assertIsNone(cursor.params)


if __name__ == '__main__':
    unittest.main()
