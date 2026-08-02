import unittest
from datetime import datetime, timezone
from uuid import uuid4

from vector_analysis import (
    VectorAnalysisError,
    _bounded_identifier,
    _execute_clip,
    _execute_dissolve,
    _execute_erase,
    _execute_spatial_join,
    _execute_summarize_within,
    _execute_intersect,
    _execute_multi_ring_buffer,
    _execute_near,
    _execute_polygonize,
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

    def test_clip_and_erase_are_migrated_overlay_tools(self):
        clip_tool = get_tool_spec('clip')
        erase_tool = get_tool_spec('erase')

        self.assertTrue(clip_tool.migrated)
        self.assertTrue(erase_tool.migrated)
        self.assertEqual(clip_tool.category, 'Overlay')
        self.assertEqual(erase_tool.category, 'Overlay')

    def test_dissolve_is_a_migrated_data_management_tool(self):
        dissolve_tool = get_tool_spec('dissolve')

        self.assertTrue(dissolve_tool.migrated)
        self.assertEqual(dissolve_tool.category, 'Data management')

    def test_spatial_join_is_a_migrated_overlay_tool(self):
        tool = get_tool_spec('spatial_join')
        self.assertTrue(tool.migrated)
        self.assertEqual(tool.category, 'Overlay')

    def test_summarize_within_is_a_migrated_analysis_tool(self):
        tool = get_tool_spec('summarize_within')
        self.assertTrue(tool.migrated)
        self.assertEqual(tool.output_geometry_family, 'polygon')

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

    def test_clip_boolean_parameter_is_strict(self):
        base = {
            'input_layer': str(uuid4()),
            'mask_layer': str(uuid4()),
            'output_name': 'Clip',
        }
        self.assertTrue(validate_tool_parameters('clip', base)['dissolve_mask'])
        self.assertFalse(validate_tool_parameters('clip', {**base, 'dissolve_mask': 'false'})['dissolve_mask'])
        with self.assertRaisesRegex(VectorAnalysisError, 'must be a boolean'):
            validate_tool_parameters('clip', {**base, 'dissolve_mask': 1})

    def test_dissolve_statistics_are_normalized(self):
        parameters = validate_tool_parameters('dissolve', {
            'layer_id': str(uuid4()),
            'output_name': 'District totals',
            'dissolve_fields': ['district'],
            'statistics': [
                {'field': 'population', 'statistic': 'mean'},
                {'statistic': 'count'},
            ],
        })

        self.assertEqual(parameters['statistics'][0]['output_field'], 'mean_population')
        self.assertEqual(parameters['statistics'][1]['output_field'], 'feature_count')
        with self.assertRaisesRegex(VectorAnalysisError, 'Unsupported statistic'):
            validate_tool_parameters('dissolve', {
                'layer_id': str(uuid4()),
                'output_name': 'Invalid',
                'statistics': [{'field': 'population', 'statistic': 'median'}],
            })

    def test_spatial_join_requires_distance_and_distinct_layers(self):
        target = str(uuid4())
        join = str(uuid4())
        base = {
            'target_layer': target,
            'join_layer': join,
            'output_name': 'Join',
            'predicate': 'within_distance',
        }
        with self.assertRaisesRegex(VectorAnalysisError, 'distance is required'):
            validate_tool_parameters('spatial_join', base)
        with self.assertRaisesRegex(VectorAnalysisError, 'different'):
            validate_tool_parameters('spatial_join', {
                **base,
                'join_layer': target,
                'distance': 100,
            })

    def test_summarize_within_rejects_unsupported_statistics(self):
        with self.assertRaisesRegex(VectorAnalysisError, 'supports count'):
            validate_tool_parameters('summarize_within', {
                'zone_layer': str(uuid4()),
                'summary_layer': str(uuid4()),
                'output_name': 'Summary',
                'statistics': [{'field': 'name', 'statistic': 'first'}],
            })

    def test_near_parameters_enforce_rank_limits_and_integer_count(self):
        source = str(uuid4())
        near = str(uuid4())
        parameters = validate_tool_parameters('near', {
            'source_layer': source,
            'near_layer': near,
            'output_name': 'Nearest assets',
            'nearest_count': '3',
        })

        self.assertEqual(parameters['nearest_count'], 3)
        self.assertTrue(parameters['exclude_self'])
        self.assertEqual(parameters['output_geometry'], 'connecting_line')
        with self.assertRaisesRegex(VectorAnalysisError, 'whole number'):
            validate_tool_parameters('near', {
                'source_layer': source,
                'near_layer': near,
                'output_name': 'Invalid',
                'nearest_count': 1.5,
            })
        with self.assertRaisesRegex(VectorAnalysisError, 'limited to 100'):
            validate_tool_parameters('near', {
                'source_layer': source,
                'near_layer': near,
                'output_name': 'Invalid',
                'nearest_count': 101,
            })

    def test_multi_ring_distances_are_sorted_and_deduplicated(self):
        parameters = validate_tool_parameters('multi_ring_buffer', {
            'layer_id': str(uuid4()),
            'distances': [500, '100', 500, 250],
            'output_name': 'Service bands',
        })

        self.assertEqual(parameters['distances'], [100.0, 250.0, 500.0])
        self.assertEqual(parameters['ring_type'], 'rings')

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
    def __init__(
        self,
        layer_a: str,
        layer_b: str,
        output_layer: str,
        geometry_a: str = 'Polygon',
        geometry_b: str = 'LineString',
    ):
        self.layer_a = layer_a
        self.layer_b = layer_b
        self.output_layer = output_layer
        self.geometry_a = geometry_a
        self.geometry_b = geometry_b
        self.rowcount = 0
        self._one = None
        self._all = []
        self.intersect_parameters = None
        self.mask_overlay_parameters = None
        self.dissolve_parameters = None
        self.spatial_join_parameters = None
        self.summarize_within_parameters = None
        self.near_parameters = None
        self.multi_ring_parameters = None
        self.polygonize_parameters = []

    def execute(self, query, parameters=()):
        parameters = tuple(parameters)
        self.assert_placeholder_count(query, parameters)
        normalized = ' '.join(query.split())
        self._one = None
        self._all = []
        self.rowcount = 0

        if normalized.startswith('SELECT id, name, geometry_type FROM layers'):
            if '= ANY(' in normalized:
                self._all = [
                    {'id': self.layer_a, 'name': 'Parcels', 'geometry_type': self.geometry_a},
                    {'id': self.layer_b, 'name': 'Masks', 'geometry_type': self.geometry_b},
                ]
            else:
                self._one = {'id': self.layer_a, 'name': 'Parcels', 'geometry_type': self.geometry_a}
        elif normalized.startswith('SELECT id, name FROM layers WHERE id ='):
            self._one = {'id': self.layer_a, 'name': 'Parcels'}
        elif normalized.startswith('SELECT COUNT(*) AS count FROM features'):
            self._one = {'count': 2}
        elif normalized.startswith('INSERT INTO layers'):
            self._one = {'id': self.output_layer}
        elif normalized.startswith('WITH raw_intersections AS MATERIALIZED'):
            self.intersect_parameters = parameters
            self.rowcount = 2
        elif normalized.startswith('WITH dissolved_mask AS MATERIALIZED') or normalized.startswith('WITH processed AS MATERIALIZED'):
            self.mask_overlay_parameters = parameters
            self.rowcount = 2
        elif normalized.startswith('WITH grouped AS MATERIALIZED'):
            self.dissolve_parameters = parameters
            self.rowcount = 1
        elif normalized.startswith('INSERT INTO features') and ('LEFT JOIN LATERAL' in normalized or 'LEFT JOIN features matched' in normalized):
            self.spatial_join_parameters = parameters
            self.rowcount = 2
        elif normalized.startswith('WITH matches AS MATERIALIZED'):
            self.summarize_within_parameters = parameters
            self.rowcount = 2
        elif normalized.startswith('INSERT INTO features') and 'Finding indexed nearest candidates' not in normalized and 'candidate.geometry <-> source.geometry' in normalized:
            self.near_parameters = parameters
            self.rowcount = 3
        elif normalized.startswith('WITH distance_steps AS MATERIALIZED'):
            self.multi_ring_parameters = parameters
            self.rowcount = 6
        elif normalized.startswith('WITH scoped_lines AS MATERIALIZED') and 'ST_Polygonize' in normalized:
            self.polygonize_parameters.append(parameters)
            self.rowcount = 4 if len(self.polygonize_parameters) == 1 else 2
        elif normalized.startswith('SELECT l.*, u.username AS created_by'):
            now = datetime.now(timezone.utc)
            self._one = {
                'id': self.output_layer,
                'name': 'Road parcel overlay',
                'description': 'Intersection',
                'geometry_type': self.geometry_a,
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


class MultiRingBufferExecutorContractTests(unittest.TestCase):
    def test_selected_multi_ring_buffer_orders_precision_after_output(self):
        source_layer = str(uuid4())
        output_layer = str(uuid4())
        user_id = str(uuid4())
        selected_feature = str(uuid4())
        cursor = PlaceholderCheckingCursor(source_layer, str(uuid4()), output_layer)
        parameters = validate_tool_parameters('multi_ring_buffer', {
            'layer_id': source_layer,
            'distances': [100, 250, 500],
            'output_name': 'Service bands',
        })
        environments = normalize_environments({
            'scope': 'selected',
            'selected_feature_ids': [selected_feature],
            'precision_grid': 0.00001,
        })

        result = _execute_multi_ring_buffer(
            cursor, parameters, environments, user_id, lambda _progress, _stage: None
        )

        self.assertEqual(result['count'], 6)
        self.assertEqual(cursor.multi_ring_parameters, (
            [100.0, 250.0, 500.0],
            source_layer,
            [selected_feature],
            output_layer,
            0.00001,
            user_id,
        ))


class MaskOverlayExecutorContractTests(unittest.TestCase):
    def setUp(self):
        self.input_layer = str(uuid4())
        self.mask_layer = str(uuid4())
        self.output_layer = str(uuid4())
        self.user_id = str(uuid4())

    def test_dissolved_clip_preserves_input_family_and_parameter_order(self):
        cursor = PlaceholderCheckingCursor(
            self.input_layer,
            self.mask_layer,
            self.output_layer,
            geometry_a='LineString',
            geometry_b='Polygon',
        )
        parameters = validate_tool_parameters('clip', {
            'input_layer': self.input_layer,
            'mask_layer': self.mask_layer,
            'output_name': 'Road clip',
        })
        environments = normalize_environments({'precision_grid': 0.00001})

        result = _execute_clip(
            cursor, parameters, environments, self.user_id, lambda _progress, _stage: None
        )

        self.assertEqual(result['count'], 2)
        self.assertEqual(result['metrics']['output_geometry_family'], 'line')
        self.assertTrue(result['metrics']['dissolved_mask'])
        self.assertEqual(cursor.mask_overlay_parameters[:3], (
            self.mask_layer,
            0.00001,
            self.input_layer,
        ))

    def test_erase_uses_dissolved_polygon_mask(self):
        cursor = PlaceholderCheckingCursor(
            self.input_layer,
            self.mask_layer,
            self.output_layer,
            geometry_a='Polygon',
            geometry_b='MultiPolygon',
        )
        parameters = validate_tool_parameters('erase', {
            'input_layer': self.input_layer,
            'mask_layer': self.mask_layer,
            'output_name': 'Parcel erase',
        })

        result = _execute_erase(
            cursor,
            parameters,
            normalize_environments({}),
            self.user_id,
            lambda _progress, _stage: None,
        )

        self.assertEqual(result['metrics']['output_geometry_family'], 'polygon')
        self.assertTrue(result['metrics']['dissolved_mask'])
        self.assertEqual(cursor.mask_overlay_parameters[:2], (self.mask_layer, self.input_layer))

    def test_undissolved_clip_orders_selected_input_parameters(self):
        cursor = PlaceholderCheckingCursor(
            self.input_layer,
            self.mask_layer,
            self.output_layer,
            geometry_a='Point',
            geometry_b='Polygon',
        )
        input_feature = str(uuid4())
        mask_feature = str(uuid4())
        parameters = validate_tool_parameters('clip', {
            'input_layer': self.input_layer,
            'mask_layer': self.mask_layer,
            'output_name': 'Per-mask clip',
            'dissolve_mask': False,
        })
        environments = normalize_environments({
            'scope_a': 'selected',
            'scope_b': 'selected',
            'selected_feature_ids_a': [input_feature],
            'selected_feature_ids_b': [mask_feature],
            'precision_grid': 0.00001,
        })

        result = _execute_clip(
            cursor, parameters, environments, self.user_id, lambda _progress, _stage: None
        )

        self.assertFalse(result['metrics']['dissolved_mask'])
        self.assertEqual(cursor.mask_overlay_parameters[:5], (
            0.00001,
            self.input_layer,
            self.mask_layer,
            [input_feature],
            [mask_feature],
        ))
        self.assertTrue(any('duplicate' in warning for warning in result['warnings']))

    def test_clip_rejects_non_polygon_mask(self):
        cursor = PlaceholderCheckingCursor(
            self.input_layer,
            self.mask_layer,
            self.output_layer,
            geometry_a='Point',
            geometry_b='LineString',
        )
        parameters = validate_tool_parameters('clip', {
            'input_layer': self.input_layer,
            'mask_layer': self.mask_layer,
            'output_name': 'Invalid clip',
        })

        with self.assertRaisesRegex(VectorAnalysisError, 'must contain polygon'):
            _execute_clip(
                cursor,
                parameters,
                normalize_environments({}),
                self.user_id,
                lambda _progress, _stage: None,
            )


class DissolveExecutorContractTests(unittest.TestCase):
    def test_dissolve_all_with_count_uses_selected_scope_and_precision(self):
        layer_id = str(uuid4())
        output_layer = str(uuid4())
        user_id = str(uuid4())
        selected_feature = str(uuid4())
        cursor = PlaceholderCheckingCursor(
            layer_id,
            str(uuid4()),
            output_layer,
            geometry_a='Polygon',
        )
        parameters = validate_tool_parameters('dissolve', {
            'layer_id': layer_id,
            'output_name': 'Dissolved parcels',
            'statistics': [{'statistic': 'count'}],
        })
        environments = normalize_environments({
            'scope': 'selected',
            'selected_feature_ids': [selected_feature],
            'precision_grid': 0.00001,
        })

        result = _execute_dissolve(
            cursor, parameters, environments, user_id, lambda _progress, _stage: None
        )

        self.assertEqual(result['count'], 1)
        self.assertEqual(result['metrics']['statistic_count'], 1)
        self.assertEqual(cursor.dissolve_parameters[:4], (
            layer_id,
            [selected_feature],
            3,
            0.00001,
        ))


class SpatialJoinExecutorContractTests(unittest.TestCase):
    def test_one_to_one_distance_join_orders_scopes_and_distance(self):
        target_layer = str(uuid4())
        join_layer = str(uuid4())
        output_layer = str(uuid4())
        user_id = str(uuid4())
        target_feature = str(uuid4())
        join_feature = str(uuid4())
        cursor = PlaceholderCheckingCursor(
            target_layer,
            join_layer,
            output_layer,
            geometry_a='Point',
            geometry_b='Polygon',
        )
        parameters = validate_tool_parameters('spatial_join', {
            'target_layer': target_layer,
            'join_layer': join_layer,
            'output_name': 'Nearby zones',
            'predicate': 'within_distance',
            'distance': 500,
        })
        environments = normalize_environments({
            'scope_a': 'selected',
            'scope_b': 'selected',
            'selected_feature_ids_a': [target_feature],
            'selected_feature_ids_b': [join_feature],
        })

        result = _execute_spatial_join(
            cursor, parameters, environments, user_id, lambda _progress, _stage: None
        )

        self.assertEqual(result['count'], 2)
        self.assertEqual(result['metrics']['output_mode'], 'one_to_one')
        self.assertEqual(cursor.spatial_join_parameters[4:], (
            join_layer,
            500.0,
            [join_feature],
            target_layer,
            [target_feature],
        ))


class SummarizeWithinExecutorContractTests(unittest.TestCase):
    def test_line_summary_uses_dual_selected_scopes(self):
        zone_layer = str(uuid4())
        summary_layer = str(uuid4())
        output_layer = str(uuid4())
        user_id = str(uuid4())
        zone_feature = str(uuid4())
        summary_feature = str(uuid4())
        cursor = PlaceholderCheckingCursor(
            zone_layer,
            summary_layer,
            output_layer,
            geometry_a='Polygon',
            geometry_b='LineString',
        )
        parameters = validate_tool_parameters('summarize_within', {
            'zone_layer': zone_layer,
            'summary_layer': summary_layer,
            'output_name': 'Roads by zone',
        })
        environments = normalize_environments({
            'scope_a': 'selected',
            'scope_b': 'selected',
            'selected_feature_ids_a': [zone_feature],
            'selected_feature_ids_b': [summary_feature],
        })

        result = _execute_summarize_within(
            cursor, parameters, environments, user_id, lambda _progress, _stage: None
        )

        self.assertEqual(result['count'], 2)
        self.assertEqual(result['metrics']['summary_geometry_family'], 'line')
        self.assertEqual(cursor.summarize_within_parameters, (
            summary_layer,
            [summary_feature],
            zone_layer,
            [zone_feature],
            output_layer,
            user_id,
        ))

    def test_zone_layer_must_be_polygon(self):
        zone_layer = str(uuid4())
        summary_layer = str(uuid4())
        cursor = PlaceholderCheckingCursor(
            zone_layer,
            summary_layer,
            str(uuid4()),
            geometry_a='LineString',
            geometry_b='Point',
        )
        parameters = validate_tool_parameters('summarize_within', {
            'zone_layer': zone_layer,
            'summary_layer': summary_layer,
            'output_name': 'Invalid zones',
        })
        with self.assertRaisesRegex(VectorAnalysisError, 'polygon'):
            _execute_summarize_within(
                cursor,
                parameters,
                normalize_environments({}),
                str(uuid4()),
                lambda _progress, _stage: None,
            )


class NearExecutorContractTests(unittest.TestCase):
    def test_near_uses_dual_scopes_distance_and_knn_candidate_limit(self):
        source_layer = str(uuid4())
        near_layer = str(uuid4())
        output_layer = str(uuid4())
        user_id = str(uuid4())
        source_feature = str(uuid4())
        near_feature = str(uuid4())
        cursor = PlaceholderCheckingCursor(
            source_layer,
            near_layer,
            output_layer,
            geometry_a='Polygon',
            geometry_b='Point',
        )
        parameters = validate_tool_parameters('near', {
            'source_layer': source_layer,
            'near_layer': near_layer,
            'output_name': 'Three nearest facilities',
            'nearest_count': 3,
            'max_distance': 2500,
            'output_geometry': 'near_point',
        })
        environments = normalize_environments({
            'scope_a': 'selected',
            'scope_b': 'selected',
            'selected_feature_ids_a': [source_feature],
            'selected_feature_ids_b': [near_feature],
        })

        result = _execute_near(
            cursor, parameters, environments, user_id, lambda _progress, _stage: None
        )

        self.assertEqual(result['count'], 3)
        self.assertEqual(result['metrics']['nearest_count'], 3)
        self.assertEqual(result['metrics']['candidate_limit'], 64)
        self.assertEqual(cursor.near_parameters[-7:], (
            near_layer,
            2500.0,
            [near_feature],
            64,
            3,
            source_layer,
            [source_feature],
        ))


class PolygonizeExecutorContractTests(unittest.TestCase):
    def test_polygonize_nodes_selected_lines_and_emits_diagnostics(self):
        line_layer = str(uuid4())
        output_layer = str(uuid4())
        user_id = str(uuid4())
        selected_feature = str(uuid4())
        cursor = PlaceholderCheckingCursor(
            line_layer,
            str(uuid4()),
            output_layer,
            geometry_a='LineString',
        )
        parameters = validate_tool_parameters('polygonize', {
            'line_layer': line_layer,
            'output_name': 'Survey blocks',
            'snap_tolerance': 0.00001,
            'attribute_transfer': 'majority_boundary',
            'create_diagnostics': True,
        })
        environments = normalize_environments({
            'scope': 'selected',
            'selected_feature_ids': [selected_feature],
        })

        result = _execute_polygonize(
            cursor, parameters, environments, user_id, lambda _progress, _stage: None
        )

        self.assertEqual(result['count'], 4)
        self.assertEqual(result['metrics']['diagnostic_count'], 2)
        self.assertEqual(cursor.polygonize_parameters[0], (
            0.00001,
            line_layer,
            [selected_feature],
            output_layer,
            user_id,
            line_layer,
        ))
        self.assertEqual(cursor.polygonize_parameters[1], (
            0.00001,
            line_layer,
            [selected_feature],
            output_layer,
            user_id,
        ))

    def test_polygonize_rejects_non_line_layer(self):
        line_layer = str(uuid4())
        cursor = PlaceholderCheckingCursor(
            line_layer,
            str(uuid4()),
            str(uuid4()),
            geometry_a='Polygon',
        )
        with self.assertRaisesRegex(VectorAnalysisError, 'line geometry'):
            _execute_polygonize(
                cursor,
                validate_tool_parameters('polygonize', {
                    'line_layer': line_layer,
                    'output_name': 'Invalid',
                }),
                normalize_environments({}),
                str(uuid4()),
                lambda _progress, _stage: None,
            )


if __name__ == '__main__':
    unittest.main()
