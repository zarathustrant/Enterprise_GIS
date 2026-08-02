import unittest
from uuid import uuid4

from vector_analysis import (
    VectorAnalysisError,
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


if __name__ == '__main__':
    unittest.main()
