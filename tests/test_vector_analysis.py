import unittest
from datetime import datetime, timezone
from uuid import uuid4

from vector_analysis import (
    VectorAnalysisError,
    _bounded_identifier,
    _execute_intersect,
    _geometry_family,
    _resolve_intersection_output_type,
    get_tool_spec,
    list_tool_specs,
    normalize_environments,
    validate_tool_parameters,
)


class VectorToolRegistryTests(unittest.TestCase):
    def test_buffer_is_exposed_as_migrated_tool(self):
        buffer_tool = get_tool_spec('buffer')

        self.assertTrue(buffer_tool.migrated)
        self.assertEqual(buffer_tool.output_geometry_family, 'polygon')
        self.assertIn('point', buffer_tool.input_geometry_families)
        self.assertIn('buffer', {tool['id'] for tool in list_tool_specs()})

    def test_intersect_is_exposed_as_migrated_tool(self):
        intersect_tool = get_tool_spec('intersect')

        self.assertTrue(intersect_tool.migrated)
        output_parameter = next(
            parameter for parameter in intersect_tool.parameters
            if parameter.name == 'output_type'
        )
        self.assertEqual(output_parameter.default, 'auto')
        self.assertEqual(output_parameter.choices, ('auto', 'point', 'line', 'polygon'))

    def test_unknown_tool_is_rejected(self):
        with self.assertRaisesRegex(VectorAnalysisError, 'Unknown vector analysis tool'):
            get_tool_spec('not-a-tool')


class VectorToolValidationTests(unittest.TestCase):
    def test_buffer_parameters_are_normalized(self):
        parameters = validate_tool_parameters('buffer', {
            'layer_id': str(uuid4()),
            'distance': '25.5',
            'output_name': '  Service area  ',
        })

        self.assertEqual(parameters['distance'], 25.5)
        self.assertEqual(parameters['output_name'], 'Service area')

    def test_buffer_rejects_non_positive_distance(self):
        with self.assertRaisesRegex(VectorAnalysisError, 'distance must be at least'):
            validate_tool_parameters('buffer', {
                'layer_id': str(uuid4()),
                'distance': 0,
                'output_name': 'Invalid buffer',
            })

    def test_parameters_exclude_execution_control_keys(self):
        parameters = validate_tool_parameters('buffer', {
            'layer_id': str(uuid4()),
            'distance': 50,
            'output_name': 'Buffer',
            'async': True,
            'environments': {'scope': 'all'},
        })

        self.assertNotIn('async', parameters)
        self.assertNotIn('environments', parameters)

    def test_layer_parameter_requires_uuid(self):
        with self.assertRaisesRegex(VectorAnalysisError, 'layer UUID'):
            validate_tool_parameters('buffer', {
                'layer_id': 'not-a-uuid',
                'distance': 50,
                'output_name': 'Buffer',
            })

    def test_intersect_parameters_apply_professional_defaults(self):
        parameters = validate_tool_parameters('intersect', {
            'layer_a': str(uuid4()),
            'layer_b': str(uuid4()),
            'output_name': 'Overlay',
        })

        self.assertEqual(parameters['output_type'], 'auto')
        self.assertEqual(parameters['prefix_a'], 'a_')
        self.assertEqual(parameters['prefix_b'], 'b_')

    def test_intersect_rejects_invalid_output_type(self):
        with self.assertRaisesRegex(VectorAnalysisError, 'output_type must be one of'):
            validate_tool_parameters('intersect', {
                'layer_a': str(uuid4()),
                'layer_b': str(uuid4()),
                'output_name': 'Overlay',
                'output_type': 'geometry-collection',
            })

    def test_selected_scope_requires_valid_feature_ids(self):
        feature_id = str(uuid4())
        environments = normalize_environments({
            'scope': 'selected',
            'selected_feature_ids': [feature_id],
            'precision_grid': '0.00001',
        })

        self.assertEqual(environments['selected_feature_ids'], [feature_id])
        self.assertEqual(environments['precision_grid'], 0.00001)

        with self.assertRaisesRegex(VectorAnalysisError, 'UUID'):
            normalize_environments({
                'scope': 'selected',
                'selected_feature_ids': ['bad-id'],
            })

    def test_unsupported_output_crs_is_explicit(self):
        with self.assertRaisesRegex(VectorAnalysisError, 'EPSG:4326'):
            normalize_environments({'output_crs': 'EPSG:3857'})

    def test_intersect_supports_independent_selected_inputs(self):
        feature_a = str(uuid4())
        feature_b = str(uuid4())
        environments = normalize_environments({
            'scope_a': 'selected',
            'scope_b': 'selected',
            'selected_feature_ids_a': [feature_a],
            'selected_feature_ids_b': [feature_b],
        })

        self.assertEqual(environments['selected_feature_ids_a'], [feature_a])
        self.assertEqual(environments['selected_feature_ids_b'], [feature_b])


class IntersectGeometryTests(unittest.TestCase):
    def test_geometry_family_recognizes_multi_types(self):
        self.assertEqual(_geometry_family('MultiPoint'), 'point')
        self.assertEqual(_geometry_family('MultiLineString'), 'line')
        self.assertEqual(_geometry_family('MultiPolygon'), 'polygon')

    def test_auto_output_uses_lowest_input_dimension(self):
        self.assertEqual(_resolve_intersection_output_type('polygon', 'line', 'auto'), 'line')
        self.assertEqual(_resolve_intersection_output_type('polygon', 'point', 'auto'), 'point')
        self.assertEqual(_resolve_intersection_output_type('polygon', 'polygon', 'auto'), 'polygon')

    def test_output_cannot_exceed_input_dimension(self):
        with self.assertRaisesRegex(VectorAnalysisError, 'not possible'):
            _resolve_intersection_output_type('point', 'polygon', 'line')

    def test_bounded_identifiers_are_unique_and_valid(self):
        used: set[str] = set()
        first = _bounded_identifier('a_', 'field-name', used)
        second = _bounded_identifier('a_', 'field-name', used)
        long_name = _bounded_identifier('b_', 'x' * 100, used)

        self.assertEqual(first, 'a_field_name')
        self.assertNotEqual(first, second)
        self.assertLessEqual(len(long_name), 64)


class PlaceholderCheckingCursor:
    def __init__(self, layer_a: str, layer_b: str, output_layer: str):
        self.layer_a = layer_a
        self.layer_b = layer_b
        self.output_layer = output_layer
        self.rowcount = 0
        self._one = None
        self._all = []
        self.intersect_parameters = None

    def execute(self, query, parameters=()):
        parameters = tuple(parameters)
        self.assert_placeholder_count(query, parameters)
        normalized = ' '.join(query.split())
        self._one = None
        self._all = []
        self.rowcount = 0

        if normalized.startswith('SELECT id, name, geometry_type FROM layers'):
            self._all = [
                {'id': self.layer_a, 'name': 'Parcels', 'geometry_type': 'Polygon'},
                {'id': self.layer_b, 'name': 'Roads', 'geometry_type': 'LineString'},
            ]
        elif normalized.startswith('SELECT COUNT(*) AS count FROM features'):
            self._one = {'count': 2}
        elif normalized.startswith('INSERT INTO layers'):
            self._one = {'id': self.output_layer}
        elif normalized.startswith('WITH raw_intersections AS MATERIALIZED'):
            self.intersect_parameters = parameters
            self.rowcount = 2
        elif normalized.startswith('SELECT l.*, u.username AS created_by'):
            now = datetime.now(timezone.utc)
            self._one = {
                'id': self.output_layer,
                'name': 'Road parcel overlay',
                'description': 'Intersection',
                'geometry_type': 'LineString',
                'crs': 'EPSG:4326',
                'style': {},
                'min_zoom': 0,
                'max_zoom': 24,
                'is_public': False,
                'created_by': 'tester',
                'created_at': now,
                'updated_at': now,
            }

    @staticmethod
    def assert_placeholder_count(query, parameters):
        expected = query.count('%s')
        if expected != len(parameters):
            raise AssertionError(f'Expected {expected} SQL parameters, received {len(parameters)}')

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all


class IntersectExecutorContractTests(unittest.TestCase):
    def test_precision_parameter_precedes_layer_parameters(self):
        layer_a = str(uuid4())
        layer_b = str(uuid4())
        output_layer = str(uuid4())
        user_id = str(uuid4())
        cursor = PlaceholderCheckingCursor(layer_a, layer_b, output_layer)
        parameters = validate_tool_parameters('intersect', {
            'layer_a': layer_a,
            'layer_b': layer_b,
            'output_name': 'Road parcel overlay',
        })
        environments = normalize_environments({'precision_grid': 0.00001})

        result = _execute_intersect(
            cursor,
            parameters,
            environments,
            user_id,
            lambda _progress, _stage: None,
        )

        self.assertEqual(result['count'], 2)
        self.assertEqual(result['metrics']['output_geometry_family'], 'line')
        self.assertEqual(cursor.intersect_parameters[0], 0.00001)
        self.assertEqual(cursor.intersect_parameters[1:3], (layer_a, layer_b))


if __name__ == '__main__':
    unittest.main()
