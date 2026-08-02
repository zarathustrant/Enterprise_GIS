import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Callable
from uuid import UUID


class VectorAnalysisError(ValueError):
    pass


@dataclass(frozen=True)
class ToolParameter:
    name: str
    label: str
    type: str
    required: bool = False
    default: Any = None
    minimum: float | None = None
    maximum: float | None = None
    choices: tuple[str, ...] = ()


@dataclass(frozen=True)
class VectorToolSpec:
    id: str
    version: int
    title: str
    category: str
    description: str
    input_geometry_families: tuple[str, ...]
    output_geometry_family: str | None
    parameters: tuple[ToolParameter, ...]
    supports_async: bool = True
    migrated: bool = False
    keywords: tuple[str, ...] = field(default_factory=tuple)

    def serialize(self) -> dict[str, Any]:
        result = asdict(self)
        result['input_geometry_families'] = list(self.input_geometry_families)
        result['parameters'] = [
            {**asdict(parameter), 'choices': list(parameter.choices)}
            for parameter in self.parameters
        ]
        result['keywords'] = list(self.keywords)
        return result


TOOL_REGISTRY: dict[str, VectorToolSpec] = {
    'buffer': VectorToolSpec(
        id='buffer',
        version=1,
        title='Buffer',
        category='Proximity',
        description='Create geodesic polygon buffers around input features.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family='polygon',
        parameters=(
            ToolParameter('layer_id', 'Input layer', 'layer', required=True),
            ToolParameter('distance', 'Distance (metres)', 'number', required=True, minimum=0.000001),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Buffer'),
        ),
        migrated=True,
        keywords=('distance', 'geodesic', 'proximity'),
    ),
    'multi_ring_buffer': VectorToolSpec(
        id='multi_ring_buffer',
        version=1,
        title='Multi-Ring Buffer',
        category='Proximity',
        description='Create ordered geodesic distance bands or cumulative buffers around each input feature.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family='polygon',
        parameters=(
            ToolParameter('layer_id', 'Input layer', 'layer', required=True),
            ToolParameter('distances', 'Distances (metres)', 'number_list', required=True, minimum=0.000001),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Multi-Ring Buffer'),
            ToolParameter('ring_type', 'Output type', 'choice', default='rings', choices=('rings', 'disks')),
        ),
        migrated=True,
        keywords=('distance bands', 'service area', 'proximity', 'geodesic'),
    ),
    'intersect': VectorToolSpec(
        id='intersect',
        version=1,
        title='Intersect',
        category='Overlay',
        description='Create features from the shared geometry of two layers.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family=None,
        parameters=(
            ToolParameter('layer_a', 'Input layer', 'layer', required=True),
            ToolParameter('layer_b', 'Overlay layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Intersection'),
            ToolParameter(
                'output_type',
                'Output geometry',
                'choice',
                required=True,
                default='auto',
                choices=('auto', 'point', 'line', 'polygon'),
            ),
            ToolParameter('prefix_a', 'Layer A field prefix', 'string', required=True, default='a_'),
            ToolParameter('prefix_b', 'Layer B field prefix', 'string', required=True, default='b_'),
            ToolParameter('fields_a', 'Layer A fields (empty means all)', 'string_list', default=()),
            ToolParameter('fields_b', 'Layer B fields (empty means all)', 'string_list', default=()),
            ToolParameter('minimum_measure', 'Minimum output length/area', 'number', minimum=0.000001),
        ),
        migrated=True,
        keywords=('overlay', 'shared geometry'),
    ),
    'clip': VectorToolSpec(
        id='clip',
        version=1,
        title='Clip',
        category='Overlay',
        description='Extract input feature portions that fall inside polygon masks.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family=None,
        parameters=(
            ToolParameter('input_layer', 'Input layer', 'layer', required=True),
            ToolParameter('mask_layer', 'Polygon mask layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Clip'),
            ToolParameter('dissolve_mask', 'Dissolve mask features', 'boolean', default=True),
        ),
        migrated=True,
        keywords=('extract', 'mask', 'cookie cutter'),
    ),
    'erase': VectorToolSpec(
        id='erase',
        version=1,
        title='Erase',
        category='Overlay',
        description='Remove polygon mask areas from input features.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family=None,
        parameters=(
            ToolParameter('input_layer', 'Input layer', 'layer', required=True),
            ToolParameter('mask_layer', 'Polygon mask layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Erase'),
        ),
        migrated=True,
        keywords=('difference', 'remove', 'mask'),
    ),
    'dissolve': VectorToolSpec(
        id='dissolve',
        version=1,
        title='Dissolve',
        category='Data management',
        description='Aggregate features by attributes and calculate summary statistics.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family=None,
        parameters=(
            ToolParameter('layer_id', 'Input layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Dissolve'),
            ToolParameter('dissolve_fields', 'Dissolve fields', 'string_list', default=()),
            ToolParameter('statistics', 'Summary statistics', 'statistics', default=()),
            ToolParameter('concatenate_delimiter', 'Concatenation delimiter', 'string', default=', '),
            ToolParameter('concatenate_max_length', 'Maximum concatenated length', 'integer', default=4000, minimum=1, maximum=100000),
            ToolParameter('multipart', 'Create multipart features', 'boolean', default=True),
            ToolParameter(
                'null_policy',
                'Null grouping policy',
                'choice',
                default='group',
                choices=('group', 'exclude'),
            ),
        ),
        migrated=True,
        keywords=('aggregate', 'group', 'union', 'statistics'),
    ),
    'spatial_join': VectorToolSpec(
        id='spatial_join',
        version=1,
        title='Spatial Join',
        category='Overlay',
        description='Join attributes using a spatial relationship while retaining target geometry.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family=None,
        parameters=(
            ToolParameter('target_layer', 'Target layer', 'layer', required=True),
            ToolParameter('join_layer', 'Join layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Spatial Join'),
            ToolParameter(
                'predicate',
                'Spatial relationship',
                'choice',
                default='intersects',
                choices=('intersects', 'within', 'contains', 'touches', 'crosses', 'overlaps', 'equals', 'within_distance'),
            ),
            ToolParameter(
                'output_mode',
                'Output cardinality',
                'choice',
                default='one_to_one',
                choices=('one_to_one', 'one_to_many'),
            ),
            ToolParameter('keep_all', 'Keep unmatched targets', 'boolean', default=True),
            ToolParameter('distance', 'Search distance (metres)', 'number', minimum=0.000001),
            ToolParameter('target_prefix', 'Target field prefix', 'string', default='target_'),
            ToolParameter('join_prefix', 'Join field prefix', 'string', default='join_'),
            ToolParameter('target_fields', 'Target fields (empty means all)', 'string_list', default=()),
            ToolParameter('join_fields', 'Join fields (empty means all)', 'string_list', default=()),
        ),
        migrated=True,
        keywords=('attributes', 'relationship', 'cardinality', 'match'),
    ),
    'summarize_within': VectorToolSpec(
        id='summarize_within',
        version=1,
        title='Summarize Within',
        category='Analysis',
        description='Summarize feature counts, measurements, groups, and attributes within polygon zones.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family='polygon',
        parameters=(
            ToolParameter('zone_layer', 'Polygon zone layer', 'layer', required=True),
            ToolParameter('summary_layer', 'Summary feature layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Summarize Within'),
            ToolParameter('group_field', 'Optional categorical group field', 'string', default=''),
            ToolParameter('statistics', 'Numeric summary statistics', 'statistics', default=()),
            ToolParameter('include_empty', 'Include zones without matches', 'boolean', default=True),
            ToolParameter(
                'boundary_predicate',
                'Boundary relationship',
                'choice',
                default='intersects',
                choices=('intersects', 'within'),
            ),
        ),
        migrated=True,
        keywords=('zones', 'count', 'length', 'area', 'grouped summary'),
    ),
    'near': VectorToolSpec(
        id='near',
        version=1,
        title='Near',
        category='Proximity',
        description='Generate a ranked near table with geodesic distance, bearing, and closest locations.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family=None,
        parameters=(
            ToolParameter('source_layer', 'Source layer', 'layer', required=True),
            ToolParameter('near_layer', 'Candidate layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Near'),
            ToolParameter('nearest_count', 'Nearest features per source', 'integer', default=1, minimum=1),
            ToolParameter('max_distance', 'Maximum search distance (metres)', 'number', minimum=0.000001),
            ToolParameter('exclude_self', 'Exclude matching feature IDs', 'boolean', default=True),
            ToolParameter(
                'output_geometry',
                'Output geometry',
                'choice',
                default='connecting_line',
                choices=('connecting_line', 'source_point', 'near_point'),
            ),
            ToolParameter('source_prefix', 'Source field prefix', 'string', default='source_'),
            ToolParameter('near_prefix', 'Near field prefix', 'string', default='near_'),
        ),
        migrated=True,
        keywords=('nearest', 'distance', 'bearing', 'near table', 'knn'),
    ),
    'polygonize': VectorToolSpec(
        id='polygonize',
        version=1,
        title='Polygonize Lines',
        category='Data management',
        description='Build polygons from noded line networks and optionally retain unconsumed edges as diagnostics.',
        input_geometry_families=('line',),
        output_geometry_family='polygon',
        parameters=(
            ToolParameter('line_layer', 'Input line layer', 'layer', required=True),
            ToolParameter('output_name', 'Output polygon layer name', 'string', required=True, default='Polygonized Lines'),
            ToolParameter('snap_tolerance', 'Optional snapping tolerance (degrees)', 'number', minimum=0.000000001),
            ToolParameter(
                'attribute_transfer',
                'Attribute transfer',
                'choice',
                default='majority_boundary',
                choices=('none', 'first_intersecting', 'majority_boundary'),
            ),
            ToolParameter('create_diagnostics', 'Create unconsumed-edge diagnostics', 'boolean', default=True),
        ),
        migrated=True,
        keywords=('line network', 'topology', 'closed rings', 'dangles', 'cut edges'),
    ),
    'geometry_construct': VectorToolSpec(
        id='geometry_construct', version=1, title='Geometry Construction', category='Data management',
        description='Construct derived geometry while preserving source attributes and provenance.',
        input_geometry_families=('point', 'line', 'polygon'), output_geometry_family=None,
        parameters=(
            ToolParameter('layer_id', 'Input layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Constructed Geometry'),
            ToolParameter('operation', 'Operation', 'choice', required=True, default='multipart_to_singlepart', choices=(
                'multipart_to_singlepart', 'interior_point', 'polygon_boundary', 'points_along_lines',
                'convex_hull', 'concave_hull', 'minimum_bounding_geometry',
            )),
            ToolParameter('interval', 'Point interval (metres)', 'number', minimum=0.000001),
            ToolParameter('concavity', 'Concave-hull target (0-1)', 'number', minimum=0),
        ), migrated=True, keywords=('singlepart', 'centroid', 'boundary', 'hull', 'points along line'),
    ),
    'split_lines_at_points': VectorToolSpec(
        id='split_lines_at_points', version=1, title='Split Lines At Points', category='Data management',
        description='Split line features at nearby point locations using a geodesic search tolerance.',
        input_geometry_families=('line', 'point'), output_geometry_family='line',
        parameters=(
            ToolParameter('line_layer', 'Line layer', 'layer', required=True),
            ToolParameter('point_layer', 'Split point layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Split Lines'),
            ToolParameter('tolerance', 'Search tolerance (metres)', 'number', required=True, default=1, minimum=0.000001),
        ), migrated=True, keywords=('split', 'line', 'points', 'stationing'),
    ),
    'merge_layers': VectorToolSpec(
        id='merge_layers', version=1, title='Merge Layers', category='Data management',
        description='Append two compatible layers into a new layer using deterministic union or common-field mapping.',
        input_geometry_families=('point', 'line', 'polygon'), output_geometry_family=None,
        parameters=(
            ToolParameter('layer_a', 'First layer', 'layer', required=True),
            ToolParameter('layer_b', 'Second layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Merged Layers'),
            ToolParameter('schema_strategy', 'Schema strategy', 'choice', default='union', choices=('union', 'intersection')),
        ), migrated=True, keywords=('append', 'merge', 'field mapping', 'schema'),
    ),
    'reproject': VectorToolSpec(
        id='reproject', version=1, title='Define And Reproject', category='Data management',
        description='Interpret stored coordinates in a declared EPSG CRS and create a normalized EPSG:4326 layer.',
        input_geometry_families=('point', 'line', 'polygon'), output_geometry_family=None,
        parameters=(
            ToolParameter('layer_id', 'Input layer', 'layer', required=True),
            ToolParameter('source_crs', 'Coordinate CRS', 'string', required=True, default='EPSG:4326'),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Reprojected Layer'),
        ), migrated=True, keywords=('projection', 'crs', 'epsg', 'normalize'),
    ),
    'geometry_quality': VectorToolSpec(
        id='geometry_quality', version=1, title='Geometry Quality And Generalization', category='Data quality',
        description='Inspect, repair, integrate, generalize, or aggregate feature geometry.',
        input_geometry_families=('point', 'line', 'polygon'), output_geometry_family=None,
        parameters=(
            ToolParameter('layer_id', 'Input layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Geometry Quality Result'),
            ToolParameter('operation', 'Operation', 'choice', required=True, default='check', choices=(
                'check', 'repair', 'detect_duplicates', 'snap_integrate', 'simplify', 'smooth',
                'densify', 'eliminate_slivers', 'aggregate_polygons',
            )),
            ToolParameter('tolerance', 'Tolerance', 'number', minimum=0.000000001),
            ToolParameter('area_threshold', 'Area threshold (square metres)', 'number', minimum=0.000001),
            ToolParameter('iterations', 'Smoothing iterations', 'integer', default=1, minimum=1, maximum=5),
            ToolParameter('only_issues', 'Return only detected issues', 'boolean', default=True),
        ), migrated=True, keywords=('validity', 'repair', 'duplicate', 'simplify', 'smooth', 'sliver'),
    ),
    'topology_validate': VectorToolSpec(
        id='topology_validate', version=1, title='Polygon Topology Validation', category='Data quality',
        description='Create polygon diagnostics for overlaps, coverage gaps, and slivers.',
        input_geometry_families=('polygon',), output_geometry_family='polygon',
        parameters=(
            ToolParameter('polygon_layer', 'Polygon layer', 'layer', required=True),
            ToolParameter('coverage_layer', 'Optional expected coverage boundary', 'layer'),
            ToolParameter('output_name', 'Diagnostics layer name', 'string', required=True, default='Topology Diagnostics'),
            ToolParameter('checks', 'Checks', 'string_list', default=('overlaps',)),
            ToolParameter('sliver_area', 'Sliver threshold (square metres)', 'number', minimum=0.000001),
        ), migrated=True, keywords=('overlap', 'gap', 'sliver', 'topology', 'validation'),
    ),
    'spatial_statistics': VectorToolSpec(
        id='spatial_statistics', version=1, title='Vector Spatial Statistics', category='Spatial statistics',
        description='Calculate spatial centers, dispersion, nearest-neighbor patterns, autocorrelation, and hot spots.',
        input_geometry_families=('point', 'line', 'polygon'), output_geometry_family=None,
        parameters=(
            ToolParameter('layer_id', 'Input layer', 'layer', required=True),
            ToolParameter('output_name', 'Output layer name', 'string', required=True, default='Spatial Statistics'),
            ToolParameter('operation', 'Statistic', 'choice', required=True, default='mean_center', choices=(
                'mean_center', 'median_center', 'central_feature', 'standard_distance',
                'directional_distribution', 'nearest_neighbor', 'spatial_autocorrelation', 'hot_spot',
            )),
            ToolParameter('value_field', 'Numeric analysis field', 'string', default=''),
            ToolParameter('distance_band', 'Distance band (metres)', 'number', minimum=0.000001),
            ToolParameter('standard_deviations', 'Standard deviations', 'number', default=1, minimum=0.1, maximum=3),
        ), migrated=True, keywords=('center', 'ellipse', 'nearest neighbor', 'moran', 'getis ord', 'hot spot'),
    ),
    'within': VectorToolSpec(
        id='within',
        version=1,
        title='Within',
        category='Selection',
        description='Find features completely within a polygon.',
        input_geometry_families=('point', 'line', 'polygon'),
        output_geometry_family=None,
        parameters=(
            ToolParameter('layer_id', 'Input layer', 'layer', required=True),
            ToolParameter('polygon', 'Selection polygon', 'geometry', required=True),
        ),
        supports_async=True,
        migrated=False,
        keywords=('select by location', 'containment'),
    ),
}


def list_tool_specs() -> list[dict[str, Any]]:
    return [spec.serialize() for spec in TOOL_REGISTRY.values()]


def get_tool_spec(tool_id: str) -> VectorToolSpec:
    spec = TOOL_REGISTRY.get(tool_id)
    if not spec:
        raise VectorAnalysisError(f'Unknown vector analysis tool: {tool_id}')
    return spec


def normalize_environments(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    scope = str(data.get('scope', 'all')).strip().lower()
    allowed_scopes = {'all', 'selected', 'filtered', 'extent'}
    if scope not in allowed_scopes:
        raise VectorAnalysisError('environment scope must be all, selected, filtered, or extent')

    def normalize_scope(name: str, fallback: str) -> str:
        value = str(data.get(name, fallback)).strip().lower()
        if value not in allowed_scopes:
            raise VectorAnalysisError(f'{name} must be all, selected, filtered, or extent')
        return value

    def normalize_ids(name: str, required: bool) -> list[str]:
        values = data.get(name)
        if not required and values in (None, []):
            return []
        if not isinstance(values, list) or not values:
            raise VectorAnalysisError(f'selected scope requires {name}')
        if len(values) > 100_000:
            raise VectorAnalysisError('selected scope is limited to 100,000 feature IDs')
        try:
            return [str(UUID(str(value))) for value in values]
        except (TypeError, ValueError) as exc:
            raise VectorAnalysisError(f'{name} must contain UUID values') from exc

    scope_a = normalize_scope('scope_a', scope)
    scope_b = normalize_scope('scope_b', 'all')
    selected_ids = normalize_ids('selected_feature_ids', scope == 'selected')
    selected_ids_a = normalize_ids(
        'selected_feature_ids_a',
        scope_a == 'selected' and not selected_ids,
    ) or selected_ids
    selected_ids_b = normalize_ids('selected_feature_ids_b', scope_b == 'selected')

    precision_grid = data.get('precision_grid')
    if precision_grid in (None, ''):
        precision_grid = None
    else:
        try:
            precision_grid = float(precision_grid)
        except (TypeError, ValueError) as exc:
            raise VectorAnalysisError('precision_grid must be a positive number') from exc
        if precision_grid <= 0:
            raise VectorAnalysisError('precision_grid must be a positive number')

    output_crs = str(data.get('output_crs', 'EPSG:4326')).strip().upper()
    if output_crs not in {'EPSG:4326', '4326'}:
        raise VectorAnalysisError('The current vector store supports EPSG:4326 outputs only')
    invalid_geometry_policy = str(data.get('invalid_geometry_policy', 'reject')).strip().lower()
    if invalid_geometry_policy not in {'reject', 'repair'}:
        raise VectorAnalysisError('invalid_geometry_policy must be reject or repair')
    multipart_policy = str(data.get('multipart_policy', 'preserve')).strip().lower()
    if multipart_policy not in {'preserve', 'explode'}:
        raise VectorAnalysisError('multipart_policy must be preserve or explode')
    z_policy = str(data.get('z_policy', 'preserve')).strip().lower()
    if z_policy not in {'preserve', 'drop'}:
        raise VectorAnalysisError('z_policy must be preserve or drop')
    output_collision_policy = str(data.get('output_collision_policy', 'suffix')).strip().lower()
    if output_collision_policy not in {'error', 'suffix', 'overwrite'}:
        raise VectorAnalysisError('output_collision_policy must be error, suffix, or overwrite')

    def normalize_extent(name: str):
        value = data.get(name)
        if value in (None, ''):
            return None
        if not isinstance(value, (list, tuple)) or len(value) != 4:
            raise VectorAnalysisError(f'{name} must contain [min_lng, min_lat, max_lng, max_lat]')
        try:
            extent = [float(item) for item in value]
        except (TypeError, ValueError) as exc:
            raise VectorAnalysisError(f'{name} must contain numeric coordinates') from exc
        if extent[0] >= extent[2] or extent[1] >= extent[3] or extent[1] < -90 or extent[3] > 90:
            raise VectorAnalysisError(f'{name} is not a valid EPSG:4326 extent')
        return extent

    def normalize_filters(name: str):
        values = data.get(name) or []
        if not isinstance(values, list) or len(values) > 20:
            raise VectorAnalysisError(f'{name} must be a list with at most 20 filters')
        normalized = []
        for item in values:
            if not isinstance(item, dict):
                raise VectorAnalysisError(f'{name} entries must be objects')
            field_name = str(item.get('field', '')).strip()
            operator = str(item.get('operator', 'equals')).strip().lower()
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}', field_name):
                raise VectorAnalysisError(f'{name} contains an invalid field name')
            if operator not in {'equals', 'not_equals', 'contains', 'greater_than', 'at_least', 'less_than', 'at_most', 'is_null', 'is_not_null'}:
                raise VectorAnalysisError(f'{name} contains an unsupported operator')
            normalized.append({'field': field_name, 'operator': operator, 'value': item.get('value')})
        return normalized

    extent = normalize_extent('extent')
    extent_a = normalize_extent('extent_a') or extent
    extent_b = normalize_extent('extent_b')
    filters = normalize_filters('filters')
    filters_a = normalize_filters('filters_a') or filters
    filters_b = normalize_filters('filters_b')
    if scope_a == 'extent' and not extent_a:
        raise VectorAnalysisError('extent_a or extent is required for extent scope')
    if scope_b == 'extent' and not extent_b:
        raise VectorAnalysisError('extent_b is required for second-input extent scope')
    if scope_a == 'filtered' and not filters_a:
        raise VectorAnalysisError('filters_a or filters is required for filtered scope')
    if scope_b == 'filtered' and not filters_b:
        raise VectorAnalysisError('filters_b is required for second-input filtered scope')

    return {
        'scope': scope,
        'selected_feature_ids': selected_ids,
        'scope_a': scope_a,
        'scope_b': scope_b,
        'selected_feature_ids_a': selected_ids_a,
        'selected_feature_ids_b': selected_ids_b,
        'precision_grid': precision_grid,
        'output_crs': 'EPSG:4326',
        'invalid_geometry_policy': invalid_geometry_policy,
        'multipart_policy': multipart_policy,
        'z_policy': z_policy,
        'output_collision_policy': output_collision_policy,
        'extent_a': extent_a,
        'extent_b': extent_b,
        'filters_a': filters_a,
        'filters_b': filters_b,
    }


def validate_tool_parameters(tool_id: str, raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise VectorAnalysisError('parameters must be an object')
    spec = get_tool_spec(tool_id)
    parameters: dict[str, Any] = {}
    for definition in spec.parameters:
        value = raw.get(definition.name, definition.default)
        if definition.required and value in (None, ''):
            raise VectorAnalysisError(f'{definition.name} is required')
        if definition.type in {'number', 'integer'} and value is not None:
            try:
                numeric_value = float(value)
            except (TypeError, ValueError) as exc:
                raise VectorAnalysisError(f'{definition.name} must be a number') from exc
            if definition.type == 'integer' and not numeric_value.is_integer():
                raise VectorAnalysisError(f'{definition.name} must be a whole number')
            value = int(numeric_value) if definition.type == 'integer' else numeric_value
            if definition.minimum is not None and value < definition.minimum:
                raise VectorAnalysisError(f'{definition.name} must be at least {definition.minimum}')
            if definition.maximum is not None and value > definition.maximum:
                raise VectorAnalysisError(f'{definition.name} must be at most {definition.maximum}')
        if definition.type == 'string' and value is not None:
            value = str(value).strip()
            if definition.required and not value:
                raise VectorAnalysisError(f'{definition.name} is required')
            if len(value) > 255:
                raise VectorAnalysisError(f'{definition.name} must be 255 characters or fewer')
        if definition.type == 'layer' and value is not None:
            try:
                value = str(UUID(str(value)))
            except (TypeError, ValueError) as exc:
                raise VectorAnalysisError(f'{definition.name} must be a layer UUID') from exc
        if definition.type == 'choice' and value not in definition.choices:
            raise VectorAnalysisError(
                f'{definition.name} must be one of {", ".join(definition.choices)}'
            )
        if definition.type == 'boolean':
            if isinstance(value, bool):
                pass
            elif isinstance(value, str) and value.strip().lower() in {'true', 'false'}:
                value = value.strip().lower() == 'true'
            else:
                raise VectorAnalysisError(f'{definition.name} must be a boolean')
        if definition.type == 'string_list':
            if not isinstance(value, (list, tuple)):
                raise VectorAnalysisError(f'{definition.name} must be a list of field names')
            value = [str(item).strip() for item in value]
            if any(not item or len(item) > 64 for item in value):
                raise VectorAnalysisError(f'{definition.name} contains an invalid field name')
            if len(value) != len(set(value)):
                raise VectorAnalysisError(f'{definition.name} cannot contain duplicate fields')
        if definition.type == 'number_list':
            if not isinstance(value, (list, tuple)) or not value:
                raise VectorAnalysisError(f'{definition.name} must be a non-empty list of numbers')
            try:
                value = sorted({float(item) for item in value})
            except (TypeError, ValueError) as exc:
                raise VectorAnalysisError(f'{definition.name} must contain only numbers') from exc
            if definition.minimum is not None and any(item < definition.minimum for item in value):
                raise VectorAnalysisError(f'{definition.name} values must be at least {definition.minimum}')
            if len(value) > 50:
                raise VectorAnalysisError(f'{definition.name} is limited to 50 distances')
        if definition.type == 'statistics':
            if not isinstance(value, (list, tuple)):
                raise VectorAnalysisError(f'{definition.name} must be a list')
            normalized_statistics = []
            allowed_statistics = {'count', 'sum', 'minimum', 'maximum', 'mean', 'first', 'last', 'concatenate'}
            used_output_names: set[str] = set()
            for index, item in enumerate(value):
                if not isinstance(item, dict):
                    raise VectorAnalysisError(f'{definition.name}[{index}] must be an object')
                statistic = str(item.get('statistic', '')).strip().lower()
                field_name = str(item.get('field', '')).strip()
                if statistic not in allowed_statistics:
                    raise VectorAnalysisError(f'Unsupported statistic: {statistic or "missing"}')
                if statistic != 'count' and not field_name:
                    raise VectorAnalysisError(f'{statistic} statistic requires a field')
                default_name = 'feature_count' if statistic == 'count' else f'{statistic}_{field_name}'
                output_name = str(item.get('output_field') or default_name).strip()
                if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}', output_name):
                    raise VectorAnalysisError(f'Invalid statistic output field: {output_name}')
                if output_name in used_output_names:
                    raise VectorAnalysisError(f'Duplicate statistic output field: {output_name}')
                used_output_names.add(output_name)
                normalized_statistics.append({
                    'field': field_name or None,
                    'statistic': statistic,
                    'output_field': output_name,
                })
            value = normalized_statistics
        parameters[definition.name] = value
    if tool_id == 'spatial_join':
        if parameters['target_layer'] == parameters['join_layer']:
            raise VectorAnalysisError('Spatial Join requires different target and join layers')
        if parameters['predicate'] == 'within_distance' and parameters['distance'] is None:
            raise VectorAnalysisError('distance is required for within_distance')
    if tool_id == 'summarize_within':
        if parameters['zone_layer'] == parameters['summary_layer']:
            raise VectorAnalysisError('Summarize Within requires different zone and summary layers')
        unsupported = [
            statistic['statistic'] for statistic in parameters['statistics']
            if statistic['statistic'] not in {'count', 'sum', 'minimum', 'maximum', 'mean'}
        ]
        if unsupported:
            raise VectorAnalysisError('Summarize Within supports count, sum, minimum, maximum, and mean')
    if tool_id == 'near' and parameters['nearest_count'] > 100:
        raise VectorAnalysisError('nearest_count is limited to 100 features per source')
    if tool_id == 'geometry_construct':
        if parameters['operation'] == 'points_along_lines' and parameters['interval'] is None:
            raise VectorAnalysisError('interval is required for points_along_lines')
        if parameters['operation'] == 'concave_hull':
            if parameters['concavity'] is None:
                parameters['concavity'] = 0.8
            if parameters['concavity'] > 1:
                raise VectorAnalysisError('concavity must be between 0 and 1')
    if tool_id == 'split_lines_at_points' and parameters['line_layer'] == parameters['point_layer']:
        raise VectorAnalysisError('Split Lines At Points requires distinct line and point layers')
    if tool_id == 'merge_layers' and parameters['layer_a'] == parameters['layer_b']:
        raise VectorAnalysisError('Merge Layers requires two different input layers')
    if tool_id == 'reproject':
        match = re.fullmatch(r'EPSG:(\d{1,6})', parameters['source_crs'].upper())
        if not match or int(match.group(1)) <= 0:
            raise VectorAnalysisError('source_crs must be a valid EPSG code such as EPSG:32632')
        parameters['source_crs'] = f'EPSG:{int(match.group(1))}'
    if tool_id == 'geometry_quality':
        if parameters['operation'] in {'snap_integrate', 'simplify', 'densify', 'aggregate_polygons'} and parameters['tolerance'] is None:
            raise VectorAnalysisError(f'tolerance is required for {parameters["operation"]}')
        if parameters['operation'] == 'eliminate_slivers' and parameters['area_threshold'] is None:
            raise VectorAnalysisError('area_threshold is required for eliminate_slivers')
    if tool_id == 'topology_validate':
        allowed_checks = {'overlaps', 'gaps', 'slivers'}
        if not parameters['checks'] or not set(parameters['checks']).issubset(allowed_checks):
            raise VectorAnalysisError('checks must contain overlaps, gaps, or slivers')
        if 'gaps' in parameters['checks'] and not parameters['coverage_layer']:
            raise VectorAnalysisError('coverage_layer is required when checking gaps')
        if 'slivers' in parameters['checks'] and parameters['sliver_area'] is None:
            raise VectorAnalysisError('sliver_area is required when checking slivers')
    if tool_id == 'spatial_statistics':
        if parameters['operation'] in {'spatial_autocorrelation', 'hot_spot'}:
            if not parameters['value_field']:
                raise VectorAnalysisError('value_field is required for autocorrelation and hot-spot analysis')
            if parameters['distance_band'] is None:
                raise VectorAnalysisError('distance_band is required for autocorrelation and hot-spot analysis')
    return parameters


def create_analysis_run(
    cur,
    *,
    tool_id: str,
    execution_mode: str,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    input_layer_ids: list[str],
    created_by: str | None,
    status: str,
) -> dict[str, Any]:
    spec = get_tool_spec(tool_id)
    cur.execute(
        """
        SELECT l.id, l.updated_at, l.workspace_id, w.organization_id
        FROM layers l
        LEFT JOIN workspaces w ON w.id = l.workspace_id
        WHERE l.id = ANY(%s::uuid[])
        """,
        (input_layer_ids,),
    )
    input_rows = cur.fetchall()
    revisions = {str(row['id']): row['updated_at'].isoformat() for row in input_rows}
    workspace_ids = {str(row['workspace_id']) for row in input_rows if row.get('workspace_id')}
    organization_ids = {str(row['organization_id']) for row in input_rows if row.get('organization_id')}
    workspace_id = next(iter(workspace_ids)) if len(workspace_ids) == 1 else None
    organization_id = next(iter(organization_ids)) if len(organization_ids) == 1 else None
    normalized_record = {
        'tool_id': tool_id,
        'tool_version': spec.version,
        'parameters': parameters,
        'environments': environments,
        'input_layer_revisions': revisions,
    }
    reproducibility_hash = hashlib.sha256(
        json.dumps(normalized_record, sort_keys=True, separators=(',', ':'), default=str).encode('utf-8')
    ).hexdigest()
    estimated_counts = environments.get('estimated_input_counts') or []
    total_units = int(environments.get('estimated_candidate_pairs') or sum(estimated_counts) or 0) or None
    provenance = {
        'engine': 'PostGIS',
        'tool_id': tool_id,
        'tool_version': spec.version,
        'input_layer_ids': input_layer_ids,
        'input_layer_revisions': revisions,
    }
    cur.execute(
        """
        INSERT INTO analysis_runs (
            tool_id, tool_version, status, execution_mode, parameters, environments,
            input_layer_ids, input_layer_revisions, progress, progress_stage, created_by,
            started_at, organization_id, workspace_id, completed_units, total_units,
            provenance, reproducibility_hash
        ) VALUES (
            %s, %s, %s, %s, %s::jsonb, %s::jsonb,
            %s::jsonb, %s::jsonb, %s, %s, %s::uuid,
            CASE WHEN %s = 'running' THEN NOW() ELSE NULL END,
            %s::uuid, %s::uuid, %s, %s, %s::jsonb, %s
        )
        RETURNING *
        """,
        (
            tool_id,
            spec.version,
            status,
            execution_mode,
            json.dumps(parameters),
            json.dumps(environments),
            json.dumps(input_layer_ids),
            json.dumps(revisions),
            5 if status == 'running' else 0,
            'Preparing inputs' if status == 'running' else 'Queued',
            created_by,
            status,
            organization_id,
            workspace_id,
            0,
            total_units,
            json.dumps(provenance),
            reproducibility_hash,
        ),
    )
    return dict(cur.fetchone())


def update_analysis_run(
    cur,
    run_id: str,
    *,
    status: str,
    progress: int,
    stage: str,
    output_layer_ids: list[str] | None = None,
    warnings: list[str] | None = None,
    metrics: dict[str, Any] | None = None,
    error: str | None = None,
    completed_units: int | None = None,
    total_units: int | None = None,
    structured_errors: list[dict[str, Any]] | None = None,
) -> None:
    cur.execute(
        """
        UPDATE analysis_runs
        SET status = %s,
            progress = %s,
            progress_stage = %s,
            output_layer_ids = COALESCE(%s::jsonb, output_layer_ids),
            warnings = COALESCE(%s::jsonb, warnings),
            metrics = COALESCE(%s::jsonb, metrics),
            error = %s,
            completed_units = COALESCE(%s, completed_units),
            total_units = COALESCE(%s, total_units),
            structured_errors = COALESCE(%s::jsonb, structured_errors),
            started_at = CASE WHEN %s = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
            finished_at = CASE WHEN %s IN ('succeeded', 'failed', 'cancelled') THEN NOW() ELSE finished_at END
        WHERE id = %s::uuid
        """,
        (
            status,
            max(0, min(100, progress)),
            stage,
            json.dumps(output_layer_ids) if output_layer_ids is not None else None,
            json.dumps(warnings) if warnings is not None else None,
            json.dumps(metrics) if metrics is not None else None,
            error,
            completed_units,
            total_units,
            json.dumps(structured_errors) if structured_errors is not None else None,
            status,
            status,
            run_id,
        ),
    )


def attach_job_to_run(cur, run_id: str, job_id: str) -> None:
    cur.execute(
        'UPDATE analysis_runs SET async_job_id = %s::uuid WHERE id = %s::uuid',
        (job_id, run_id),
    )


def serialize_analysis_run(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row['id']),
        'tool_id': row['tool_id'],
        'tool_version': row['tool_version'],
        'status': row['status'],
        'execution_mode': row['execution_mode'],
        'parameters': row.get('parameters') or {},
        'environments': row.get('environments') or {},
        'input_layer_ids': row.get('input_layer_ids') or [],
        'input_layer_revisions': row.get('input_layer_revisions') or {},
        'output_layer_ids': row.get('output_layer_ids') or [],
        'warnings': row.get('warnings') or [],
        'metrics': row.get('metrics') or {},
        'progress': row['progress'],
        'progress_stage': row.get('progress_stage'),
        'completed_units': row.get('completed_units', 0),
        'total_units': row.get('total_units'),
        'error': row.get('error'),
        'structured_errors': row.get('structured_errors') or [],
        'organization_id': str(row['organization_id']) if row.get('organization_id') else None,
        'workspace_id': str(row['workspace_id']) if row.get('workspace_id') else None,
        'provenance': row.get('provenance') or {},
        'reproducibility_hash': row.get('reproducibility_hash'),
        'async_job_id': str(row['async_job_id']) if row.get('async_job_id') else None,
        'worker_backend_pid': row.get('worker_backend_pid'),
        'cancellation_requested_at': row['cancellation_requested_at'].isoformat() if row.get('cancellation_requested_at') else None,
        'created_by': str(row['created_by']) if row.get('created_by') else None,
        'created_at': row['created_at'].isoformat() if row.get('created_at') else None,
        'started_at': row['started_at'].isoformat() if row.get('started_at') else None,
        'finished_at': row['finished_at'].isoformat() if row.get('finished_at') else None,
    }


def _clone_layer_schema(cur, source_layer_id: str, output_layer_id: str) -> None:
    cur.execute(
        """
        SELECT id, name, description, domain_type, coded_values, min_value, max_value
        FROM layer_domains WHERE layer_id = %s::uuid ORDER BY created_at
        """,
        (source_layer_id,),
    )
    domain_mapping: dict[str, str] = {}
    for domain in cur.fetchall():
        cur.execute(
            """
            INSERT INTO layer_domains (
                layer_id, name, description, domain_type, coded_values, min_value, max_value
            ) VALUES (%s::uuid, %s, %s, %s, %s::jsonb, %s, %s)
            RETURNING id
            """,
            (
                output_layer_id,
                domain['name'],
                domain.get('description'),
                domain['domain_type'],
                json.dumps(domain.get('coded_values')) if domain.get('coded_values') is not None else None,
                domain.get('min_value'),
                domain.get('max_value'),
            ),
        )
        domain_mapping[str(domain['id'])] = str(cur.fetchone()['id'])

    cur.execute(
        """
        SELECT name, alias, field_type, nullable, default_value, domain_id,
               length, precision, scale, sort_order
        FROM layer_fields WHERE layer_id = %s::uuid ORDER BY sort_order, created_at
        """,
        (source_layer_id,),
    )
    for source_field in cur.fetchall():
        source_domain_id = str(source_field['domain_id']) if source_field.get('domain_id') else None
        cur.execute(
            """
            INSERT INTO layer_fields (
                layer_id, name, alias, field_type, nullable, default_value, domain_id,
                length, precision, scale, sort_order
            ) VALUES (
                %s::uuid, %s, %s, %s, %s, %s::jsonb, %s::uuid,
                %s, %s, %s, %s
            )
            """,
            (
                output_layer_id,
                source_field['name'],
                source_field.get('alias'),
                source_field['field_type'],
                source_field['nullable'],
                json.dumps(source_field.get('default_value')) if source_field.get('default_value') is not None else None,
                domain_mapping.get(source_domain_id),
                source_field.get('length'),
                source_field.get('precision'),
                source_field.get('scale'),
                source_field.get('sort_order') or 0,
            ),
        )


def _bounded_identifier(prefix: str, name: str, used: set[str], max_length: int = 64) -> str:
    raw = re.sub(r'[^A-Za-z0-9_]', '_', f'{prefix}{name}')
    if not raw or not re.match(r'^[A-Za-z_]', raw):
        raw = f'_{raw}'
    candidate = raw[:max_length]
    if candidate not in used:
        used.add(candidate)
        return candidate

    digest = hashlib.sha1(raw.encode('utf-8')).hexdigest()[:8]
    base = raw[:max_length - len(digest) - 1]
    candidate = f'{base}_{digest}'
    counter = 2
    while candidate in used:
        suffix = f'_{counter}'
        candidate = f'{base[:max_length - len(digest) - len(suffix) - 1]}_{digest}{suffix}'
        counter += 1
    used.add(candidate)
    return candidate


def _append_prefixed_layer_schema(
    cur,
    *,
    source_layer_id: str,
    output_layer_id: str,
    prefix: str,
    alias_prefix: str,
    sort_offset: int,
    used_field_names: set[str],
    used_domain_names: set[str],
    include_fields: set[str] | None = None,
) -> dict[str, str]:
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,15}', prefix):
        raise VectorAnalysisError(
            f'Field prefix "{prefix}" must begin with a letter or underscore and contain at most 16 characters'
        )

    cur.execute(
        """
        SELECT id, name, description, domain_type, coded_values, min_value, max_value
        FROM layer_domains WHERE layer_id = %s::uuid ORDER BY created_at
        """,
        (source_layer_id,),
    )
    domain_mapping: dict[str, str] = {}
    for domain in cur.fetchall():
        output_name = _bounded_identifier(prefix, domain['name'], used_domain_names, 100)
        cur.execute(
            """
            INSERT INTO layer_domains (
                layer_id, name, description, domain_type, coded_values, min_value, max_value
            ) VALUES (%s::uuid, %s, %s, %s, %s::jsonb, %s, %s)
            RETURNING id
            """,
            (
                output_layer_id,
                output_name,
                f'{alias_prefix} - {domain.get("description") or domain["name"]}',
                domain['domain_type'],
                json.dumps(domain.get('coded_values')) if domain.get('coded_values') is not None else None,
                domain.get('min_value'),
                domain.get('max_value'),
            ),
        )
        domain_mapping[str(domain['id'])] = str(cur.fetchone()['id'])

    cur.execute(
        """
        SELECT name, alias, field_type, nullable, default_value, domain_id,
               length, precision, scale, sort_order
        FROM layer_fields WHERE layer_id = %s::uuid ORDER BY sort_order, created_at
        """,
        (source_layer_id,),
    )
    field_mapping: dict[str, str] = {}
    for index, source_field in enumerate(cur.fetchall()):
        if include_fields is not None and source_field['name'] not in include_fields:
            continue
        output_name = _bounded_identifier(prefix, source_field['name'], used_field_names)
        source_domain_id = str(source_field['domain_id']) if source_field.get('domain_id') else None
        cur.execute(
            """
            INSERT INTO layer_fields (
                layer_id, name, alias, field_type, nullable, default_value, domain_id,
                length, precision, scale, sort_order
            ) VALUES (
                %s::uuid, %s, %s, %s, %s, %s::jsonb, %s::uuid,
                %s, %s, %s, %s
            )
            """,
            (
                output_layer_id,
                output_name,
                f'{alias_prefix} - {source_field.get("alias") or source_field["name"]}'[:128],
                source_field['field_type'],
                source_field['nullable'],
                json.dumps(source_field.get('default_value')) if source_field.get('default_value') is not None else None,
                domain_mapping.get(source_domain_id),
                source_field.get('length'),
                source_field.get('precision'),
                source_field.get('scale'),
                sort_offset + index,
            ),
        )
        field_mapping[source_field['name']] = output_name
    return field_mapping


def _add_source_id_fields(cur, output_layer_id: str) -> None:
    cur.execute(
        """
        INSERT INTO layer_fields (
            layer_id, name, alias, field_type, nullable, length, sort_order
        ) VALUES
            (%s::uuid, 'source_a_id', 'Layer A source feature ID', 'string', FALSE, 36, 0),
            (%s::uuid, 'source_b_id', 'Layer B source feature ID', 'string', FALSE, 36, 1)
        """,
        (output_layer_id, output_layer_id),
    )


def _add_provenance_fields(
    cur,
    output_layer_id: str,
    requested_names: list[tuple[str, str]],
) -> list[str]:
    cur.execute(
        'SELECT name FROM layer_fields WHERE layer_id = %s::uuid',
        (output_layer_id,),
    )
    used = {row['name'] for row in cur.fetchall()}
    output_names: list[str] = []
    for index, (requested_name, alias) in enumerate(requested_names):
        output_name = _bounded_identifier('', requested_name, used)
        cur.execute(
            """
            INSERT INTO layer_fields (
                layer_id, name, alias, field_type, nullable, length, sort_order
            ) VALUES (%s::uuid, %s, %s, 'string', FALSE, 36, %s)
            """,
            (output_layer_id, output_name, alias, 100_000 + index),
        )
        output_names.append(output_name)
    return output_names


def _inherit_layer_style(cur, output_layer_id: str, source_layer_id: str) -> None:
    cur.execute(
        """
        UPDATE layers output
        SET style = source.style,
            min_zoom = source.min_zoom,
            max_zoom = source.max_zoom
        FROM layers source
        WHERE output.id = %s::uuid AND source.id = %s::uuid
        """,
        (output_layer_id, source_layer_id),
    )


def _create_output_layer(
    cur,
    *,
    name: str,
    description: str,
    geometry_type: str,
    created_by: str | None,
    source_layer_id: str | None = None,
) -> str:
    cur.execute(
        """
        INSERT INTO layers (name, description, geometry_type, crs, is_public, created_by)
        VALUES (%s, %s, %s, 'EPSG:4326', FALSE, %s::uuid)
        RETURNING id
        """,
        (name, description, geometry_type, created_by),
    )
    output_layer_id = str(cur.fetchone()['id'])
    if source_layer_id:
        _clone_layer_schema(cur, source_layer_id, output_layer_id)
    return output_layer_id


def _serialize_layer(cur, layer_id: str) -> dict[str, Any]:
    cur.execute(
        """
        SELECT l.*, u.username AS created_by
        FROM layers l LEFT JOIN users u ON u.id = l.created_by
        WHERE l.id = %s::uuid
        """,
        (layer_id,),
    )
    row = cur.fetchone()
    if not row:
        raise VectorAnalysisError('Output layer was not created')
    return {
        'id': str(row['id']),
        'name': row['name'],
        'description': row['description'],
        'geometry_type': row['geometry_type'],
        'crs': row['crs'],
        'style': row['style'],
        'min_zoom': row['min_zoom'],
        'max_zoom': row['max_zoom'],
        'is_public': row['is_public'],
        'created_by': row.get('created_by'),
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }


def _execute_buffer(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
) -> dict[str, Any]:
    layer_id = parameters['layer_id']
    distance = parameters['distance']
    output_name = parameters['output_name']
    cur.execute('SELECT id, name FROM layers WHERE id = %s::uuid', (layer_id,))
    source = cur.fetchone()
    if not source:
        raise VectorAnalysisError('Source layer not found')

    progress(20, 'Creating output layer')
    output_layer_id = _create_output_layer(
        cur,
        name=output_name,
        description=f'Buffer {distance:g} m of "{source["name"]}"',
        geometry_type='Polygon',
        created_by=created_by,
        source_layer_id=layer_id,
    )

    scope_clause = _selected_clause('source', environments['scope'])
    query_params: list[Any] = [output_layer_id, distance, created_by, layer_id]
    if environments['scope'] == 'selected':
        query_params.append(environments['selected_feature_ids'])

    geometry_expression = 'ST_Buffer(source.geometry::geography, %s)::geometry'
    if environments['precision_grid'] is not None:
        geometry_expression = f'ST_SnapToGrid({geometry_expression}, %s)'
        query_params = [output_layer_id, distance, environments['precision_grid'], created_by, layer_id] + (
            [environments['selected_feature_ids']] if environments['scope'] == 'selected' else []
        )

    progress(45, 'Buffering features')
    cur.execute(
        f"""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               {geometry_expression},
               source.properties,
               %s::uuid
        FROM features source
        WHERE source.layer_id = %s::uuid
          {scope_clause}
        """,
        tuple(query_params),
    )
    feature_count = cur.rowcount

    progress(75, 'Recording output provenance')
    _record_output_history(cur, output_layer_id, created_by)
    progress(90, 'Finalizing output')
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': [] if feature_count else ['The operation produced an empty output layer.'],
    }


def _execute_multi_ring_buffer(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
) -> dict[str, Any]:
    layer_id = parameters['layer_id']
    cur.execute('SELECT id, name FROM layers WHERE id = %s::uuid', (layer_id,))
    source = cur.fetchone()
    if not source:
        raise VectorAnalysisError('Source layer not found')
    source_count = _count_scoped_features(
        cur, layer_id, environments['scope'], environments['selected_feature_ids']
    )

    progress(15, 'Creating distance-band schema')
    output_layer_id = _create_output_layer(
        cur,
        name=parameters['output_name'],
        description=f'Multi-ring buffer of "{source["name"]}"',
        geometry_type='Polygon',
        created_by=created_by,
        source_layer_id=layer_id,
    )
    cur.execute('SELECT name FROM layer_fields WHERE layer_id = %s::uuid', (output_layer_id,))
    used_fields = {row['name'] for row in cur.fetchall()}
    generated: dict[str, str] = {}
    definitions = [
        ('source_feature_id', 'Source feature ID', 'string', 36),
        ('ring_index', 'Ring index', 'integer', None),
        ('ring_min_m', 'Inner distance (metres)', 'double', None),
        ('ring_max_m', 'Outer distance (metres)', 'double', None),
    ]
    for index, (requested, alias, field_type, length) in enumerate(definitions):
        output_field = _bounded_identifier('', requested, used_fields)
        generated[requested] = output_field
        cur.execute(
            """
            INSERT INTO layer_fields (layer_id, name, alias, field_type, nullable, length, sort_order)
            VALUES (%s::uuid, %s, %s, %s, FALSE, %s, %s)
            """,
            (output_layer_id, output_field, alias, field_type, length, 100_000 + index),
        )

    scope_clause = _selected_clause('source', environments['scope'])
    geometry_expression = (
        'outer_geometry'
        if parameters['ring_type'] == 'disks'
        else 'CASE WHEN inner_distance = 0 THEN outer_geometry '
             'ELSE ST_Difference(outer_geometry, ST_Buffer(source_geometry::geography, inner_distance)::geometry) END'
    )
    query_parameters: list[Any] = [parameters['distances'], layer_id]
    if environments['scope'] == 'selected':
        query_parameters.append(environments['selected_feature_ids'])
    query_parameters.append(output_layer_id)
    if environments['precision_grid'] is not None:
        geometry_expression = f'ST_SnapToGrid({geometry_expression}, %s)'
        query_parameters.append(environments['precision_grid'])
    query_parameters.append(created_by)

    progress(42, 'Building geodesic distance bands')
    cur.execute(
        f"""
        WITH distance_steps AS MATERIALIZED (
            SELECT distance,
                   ordinal::integer AS ring_index,
                   COALESCE(LAG(distance) OVER (ORDER BY distance), 0) AS inner_distance
            FROM UNNEST(%s::double precision[]) WITH ORDINALITY AS requested(distance, ordinal)
        ), buffered AS MATERIALIZED (
            SELECT source.id AS source_id,
                   source.geometry AS source_geometry,
                   source.properties,
                   distance_steps.distance AS outer_distance,
                   distance_steps.inner_distance,
                   distance_steps.ring_index,
                   ST_Buffer(source.geometry::geography, distance_steps.distance)::geometry AS outer_geometry
            FROM features source
            CROSS JOIN distance_steps
            WHERE source.layer_id = %s::uuid
              {scope_clause}
        )
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               {geometry_expression},
               properties || jsonb_build_object(
                   '{generated['source_feature_id']}', source_id::text,
                   '{generated['ring_index']}', ring_index,
                   '{generated['ring_min_m']}', inner_distance,
                   '{generated['ring_max_m']}', outer_distance
               ),
               %s::uuid
        FROM buffered
        """,
        tuple(query_parameters),
    )
    feature_count = cur.rowcount
    progress(80, 'Recording output provenance')
    _record_output_history(cur, output_layer_id, created_by)
    progress(92, 'Finalizing output')
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': [] if feature_count else ['The operation produced an empty output layer.'],
        'metrics': {
            'source_feature_count': source_count,
            'distance_count': len(parameters['distances']),
            'distances_m': parameters['distances'],
            'ring_type': parameters['ring_type'],
            'distance_method': 'PostGIS geography buffer',
        },
    }


def _record_output_history(cur, output_layer_id: str, created_by: str | None) -> None:
    cur.execute(
        """
        INSERT INTO feature_history (
            feature_id, layer_id, version, geometry, properties, change_type, changed_by
        )
        SELECT id, layer_id, version, geometry, properties, 'create', %s::uuid
        FROM features WHERE layer_id = %s::uuid
        """,
        (created_by, output_layer_id),
    )


def _geometry_family(value: str | None) -> str | None:
    normalized = (value or '').lower()
    if 'point' in normalized:
        return 'point'
    if 'line' in normalized or 'curve' in normalized:
        return 'line'
    if 'polygon' in normalized or 'surface' in normalized:
        return 'polygon'
    return None


def _resolve_layer_family(cur, layer: dict[str, Any]) -> str:
    family = _geometry_family(layer.get('geometry_type'))
    if family:
        return family
    cur.execute(
        """
        SELECT MAX(ST_Dimension(geometry)) AS dimension
        FROM features WHERE layer_id = %s::uuid AND geometry IS NOT NULL
        """,
        (str(layer['id']),),
    )
    dimension = cur.fetchone()['dimension']
    family_by_dimension = {0: 'point', 1: 'line', 2: 'polygon'}
    if dimension not in family_by_dimension:
        raise VectorAnalysisError(f'Cannot determine geometry family for layer "{layer["name"]}"')
    return family_by_dimension[dimension]


def _resolve_intersection_output_type(family_a: str, family_b: str, requested: str) -> str:
    dimensions = {'point': 0, 'line': 1, 'polygon': 2}
    maximum_dimension = min(dimensions[family_a], dimensions[family_b])
    if requested == 'auto':
        return ('point', 'line', 'polygon')[maximum_dimension]
    if dimensions[requested] > maximum_dimension:
        raise VectorAnalysisError(
            f'{requested} output is not possible for {family_a} and {family_b} inputs'
        )
    return requested


def _selected_clause(alias: str, scope: str) -> str:
    if scope == 'selected':
        return f'AND {alias}.id = ANY(%s::uuid[])'
    if scope == 'prepared_a':
        return f'AND {alias}.id IN (SELECT id FROM analysis_scope_a_ids)'
    if scope == 'prepared_b':
        return f'AND {alias}.id IN (SELECT id FROM analysis_scope_b_ids)'
    return ''


def _count_scoped_features(cur, layer_id: str, scope: str, selected_ids: list[str]) -> int:
    if scope in {'prepared_a', 'prepared_b'}:
        table_name = 'analysis_scope_a_ids' if scope == 'prepared_a' else 'analysis_scope_b_ids'
        cur.execute(f'SELECT COUNT(*) AS count FROM {table_name}')
        return int(cur.fetchone()['count'])
    clause = 'AND id = ANY(%s::uuid[])' if scope == 'selected' else ''
    parameters: list[Any] = [layer_id]
    if scope == 'selected':
        parameters.append(selected_ids)
    cur.execute(
        f'SELECT COUNT(*) AS count FROM features WHERE layer_id = %s::uuid {clause}',
        tuple(parameters),
    )
    return int(cur.fetchone()['count'])


def _filter_scope_sql(filters: list[dict[str, Any]]) -> tuple[list[str], list[Any]]:
    clauses: list[str] = []
    parameters: list[Any] = []
    for item in filters:
        field_name, operator, value = item['field'], item['operator'], item.get('value')
        if operator == 'equals':
            clauses.append('properties ->> %s = %s')
            parameters.extend([field_name, str(value)])
        elif operator == 'not_equals':
            clauses.append('properties ->> %s IS DISTINCT FROM %s')
            parameters.extend([field_name, str(value)])
        elif operator == 'contains':
            clauses.append('properties ->> %s ILIKE %s')
            parameters.extend([field_name, f'%{value}%'])
        elif operator in {'greater_than', 'at_least', 'less_than', 'at_most'}:
            try:
                numeric_value = float(value)
            except (TypeError, ValueError) as exc:
                raise VectorAnalysisError(f'{operator} filter requires a numeric value for {field_name}') from exc
            comparison = {'greater_than': '>', 'at_least': '>=', 'less_than': '<', 'at_most': '<='}[operator]
            clauses.append(
                f"CASE WHEN jsonb_typeof(properties -> %s) = 'number' "
                f'THEN (properties ->> %s)::double precision END {comparison} %s'
            )
            parameters.extend([field_name, field_name, numeric_value])
        elif operator == 'is_null':
            clauses.append('properties ->> %s IS NULL')
            parameters.append(field_name)
        else:
            clauses.append('properties ->> %s IS NOT NULL')
            parameters.append(field_name)
    return clauses, parameters


def _prepare_environment_scopes(cur, tool_id, parameters, environments):
    layer_ids = [
        parameters.get(definition.name)
        for definition in get_tool_spec(tool_id).parameters
        if definition.type == 'layer' and parameters.get(definition.name)
    ]
    prepared = dict(environments)
    for index, suffix in enumerate(('a', 'b')):
        if index >= len(layer_ids):
            break
        scope_key = f'scope_{suffix}'
        scope = environments[scope_key]
        if scope not in {'filtered', 'extent'}:
            continue
        clauses = ['layer_id = %s::uuid']
        query_parameters: list[Any] = [layer_ids[index]]
        if scope == 'filtered':
            filter_clauses, filter_parameters = _filter_scope_sql(environments[f'filters_{suffix}'])
            clauses.extend(filter_clauses)
            query_parameters.extend(filter_parameters)
        else:
            extent = environments[f'extent_{suffix}']
            clauses.append('geometry && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
            query_parameters.extend(extent)
        table_name = f'analysis_scope_{suffix}_ids'
        cur.execute(f'DROP TABLE IF EXISTS {table_name}')
        cur.execute(
            f'CREATE TEMP TABLE {table_name} ON COMMIT DROP AS '
            f'SELECT id FROM features WHERE {" AND ".join(clauses)}',
            tuple(query_parameters),
        )
        cur.execute(f'CREATE UNIQUE INDEX ON {table_name}(id)')
        prepared[scope_key] = f'prepared_{suffix}'
        if index == 0:
            prepared['scope'] = 'prepared_a'
    return prepared


def _tool_input_layer_ids(tool_id: str, parameters: dict[str, Any]) -> list[str]:
    return [
        parameters[definition.name]
        for definition in get_tool_spec(tool_id).parameters
        if definition.type == 'layer' and parameters.get(definition.name)
    ]


def _prepare_input_geometry_policy(cur, tool_id, parameters, environments) -> int:
    layer_ids = _tool_input_layer_ids(tool_id, parameters)
    invalid_count = 0
    if environments['invalid_geometry_policy'] == 'repair':
        cur.execute(
            'CREATE TEMP TABLE IF NOT EXISTS analysis_original_geometries '
            '(id uuid PRIMARY KEY, geometry geometry(Geometry, 4326)) ON COMMIT DROP'
        )
    for index, layer_id in enumerate(layer_ids[:2]):
        suffix = 'a' if index == 0 else 'b'
        scope = environments[f'scope_{suffix}']
        alias = 'feature'
        scope_clause = _selected_clause(alias, scope)
        query_parameters: list[Any] = [layer_id]
        if scope == 'selected':
            query_parameters.append(environments[f'selected_feature_ids_{suffix}'])
        cur.execute(
            f'SELECT COUNT(*) AS count FROM features {alias} WHERE layer_id = %s::uuid '
            f'{scope_clause} AND NOT ST_IsValid(geometry)',
            tuple(query_parameters),
        )
        layer_invalid_count = int(cur.fetchone()['count'])
        invalid_count += layer_invalid_count
        if layer_invalid_count and environments['invalid_geometry_policy'] == 'reject':
            raise VectorAnalysisError(
                f'Input layer contains {layer_invalid_count} invalid geometries in the processing scope; '
                'choose the repair policy or run Check Geometry.'
            )
        if layer_invalid_count:
            cur.execute(
                f"""INSERT INTO analysis_original_geometries (id, geometry)
                    SELECT id, geometry FROM features {alias}
                    WHERE layer_id = %s::uuid {scope_clause} AND NOT ST_IsValid(geometry)
                    ON CONFLICT (id) DO NOTHING""",
                tuple(query_parameters),
            )
            cur.execute(
                f"""UPDATE features {alias} SET geometry = ST_MakeValid(geometry)
                    WHERE layer_id = %s::uuid {scope_clause} AND NOT ST_IsValid(geometry)""",
                tuple(query_parameters),
            )
    return invalid_count


def _restore_input_geometries(cur) -> None:
    cur.execute("SELECT to_regclass('pg_temp.analysis_original_geometries') AS table_name")
    if cur.fetchone()['table_name']:
        cur.execute(
            'UPDATE features feature SET geometry = original.geometry '
            'FROM analysis_original_geometries original WHERE feature.id = original.id'
        )


def _apply_output_geometry_policies(cur, result, environments, created_by) -> dict[str, Any]:
    rewrite_history = environments['multipart_policy'] == 'explode' or environments['z_policy'] == 'drop'
    if not rewrite_history:
        return result
    for output_layer_id in result['output_layer_ids']:
        if environments['z_policy'] == 'drop':
            cur.execute(
                'UPDATE features SET geometry = ST_Force2D(geometry) WHERE layer_id = %s::uuid',
                (output_layer_id,),
            )
        if environments['multipart_policy'] == 'explode':
            cur.execute(
                'SELECT geometry_type FROM layers WHERE id = %s::uuid', (output_layer_id,)
            )
            family = _geometry_family(cur.fetchone()['geometry_type'])
            dimension = {'point': 1, 'line': 2, 'polygon': 3}.get(family)
            if dimension:
                cur.execute(
                    f"""WITH removed AS (
                            DELETE FROM features WHERE layer_id = %s::uuid
                            RETURNING geometry, properties, version, created_by
                        )
                        INSERT INTO features (layer_id, geometry, properties, version, created_by)
                        SELECT %s::uuid, dumped.geom, removed.properties, removed.version, removed.created_by
                        FROM removed CROSS JOIN LATERAL ST_Dump(
                            ST_CollectionExtract(removed.geometry, {dimension})
                        ) dumped WHERE NOT ST_IsEmpty(dumped.geom)""",
                    (output_layer_id, output_layer_id),
                )
        cur.execute('DELETE FROM feature_history WHERE layer_id = %s::uuid', (output_layer_id,))
        _record_output_history(cur, output_layer_id, created_by)
    primary_layer_id = result['output_layer_ids'][0]
    cur.execute('SELECT COUNT(*) AS count FROM features WHERE layer_id = %s::uuid', (primary_layer_id,))
    result['count'] = int(cur.fetchone()['count'])
    result.setdefault('metrics', {})['output_feature_count_after_policy'] = result['count']
    return result


def _prepare_output_collision(cur, parameters, environments, created_by, input_layer_ids):
    output_name = parameters.get('output_name')
    if not output_name:
        return parameters
    cur.execute(
        'SELECT id::text AS id, name FROM layers WHERE created_by = %s::uuid AND LOWER(name) = LOWER(%s) ORDER BY created_at',
        (created_by, output_name),
    )
    conflicts = [dict(row) for row in cur.fetchall()]
    if not conflicts:
        return parameters
    policy = environments['output_collision_policy']
    if policy == 'error':
        raise VectorAnalysisError(f'An owned layer named "{output_name}" already exists')
    if policy == 'overwrite':
        conflict_ids = [row['id'] for row in conflicts]
        if set(conflict_ids) & set(input_layer_ids):
            raise VectorAnalysisError('Overwrite cannot delete an input layer; choose a different output name')
        cur.execute('DELETE FROM layers WHERE id = ANY(%s::uuid[])', (conflict_ids,))
        return parameters
    cur.execute(
        'SELECT name FROM layers WHERE created_by = %s::uuid AND name ILIKE %s',
        (created_by, f'{output_name} (%)'),
    )
    used_names = {row['name'].lower() for row in cur.fetchall()} | {output_name.lower()}
    counter = 2
    candidate = f'{output_name} ({counter})'
    while candidate.lower() in used_names:
        counter += 1
        candidate = f'{output_name} ({counter})'
    return {**parameters, 'output_name': candidate}


def _execute_intersect(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
) -> dict[str, Any]:
    layer_a_id = parameters['layer_a']
    layer_b_id = parameters['layer_b']
    if layer_a_id == layer_b_id:
        raise VectorAnalysisError('Self-intersection requires a dedicated self-intersect tool')

    cur.execute(
        'SELECT id, name, geometry_type FROM layers WHERE id = ANY(%s::uuid[])',
        ([layer_a_id, layer_b_id],),
    )
    layers = {str(row['id']): dict(row) for row in cur.fetchall()}
    if layer_a_id not in layers or layer_b_id not in layers:
        raise VectorAnalysisError('One or more input layers were not found')

    family_a = _resolve_layer_family(cur, layers[layer_a_id])
    family_b = _resolve_layer_family(cur, layers[layer_b_id])
    output_family = _resolve_intersection_output_type(
        family_a,
        family_b,
        parameters['output_type'],
    )
    geometry_types = {'point': ('Point', 1), 'line': ('LineString', 2), 'polygon': ('Polygon', 3)}
    layer_geometry_type, collection_type = geometry_types[output_family]
    if parameters['minimum_measure'] is not None and output_family == 'point':
        raise VectorAnalysisError('minimum_measure applies only to line length or polygon area outputs')

    scope_a = environments['scope_a']
    scope_b = environments['scope_b']
    selected_a = environments['selected_feature_ids_a']
    selected_b = environments['selected_feature_ids_b']
    input_count_a = _count_scoped_features(cur, layer_a_id, scope_a, selected_a)
    input_count_b = _count_scoped_features(cur, layer_b_id, scope_b, selected_b)
    maximum_pairs = input_count_a * input_count_b

    progress(15, 'Creating output schema')
    output_layer_id = _create_output_layer(
        cur,
        name=parameters['output_name'],
        description=f'Intersection of "{layers[layer_a_id]["name"]}" and "{layers[layer_b_id]["name"]}"',
        geometry_type=layer_geometry_type,
        created_by=created_by,
    )
    _add_source_id_fields(cur, output_layer_id)
    used_fields = {'source_a_id', 'source_b_id'}
    used_domains: set[str] = set()
    mapping_a = _append_prefixed_layer_schema(
        cur,
        source_layer_id=layer_a_id,
        output_layer_id=output_layer_id,
        prefix=parameters['prefix_a'],
        alias_prefix='Layer A',
        sort_offset=10,
        used_field_names=used_fields,
        used_domain_names=used_domains,
        include_fields=set(parameters['fields_a']) if parameters['fields_a'] else None,
    )
    mapping_b = _append_prefixed_layer_schema(
        cur,
        source_layer_id=layer_b_id,
        output_layer_id=output_layer_id,
        prefix=parameters['prefix_b'],
        alias_prefix='Layer B',
        sort_offset=10_000,
        used_field_names=used_fields,
        used_domain_names=used_domains,
        include_fields=set(parameters['fields_b']) if parameters['fields_b'] else None,
    )
    missing_a = set(parameters['fields_a']) - set(mapping_a)
    missing_b = set(parameters['fields_b']) - set(mapping_b)
    if missing_a or missing_b:
        raise VectorAnalysisError(
            f'Unknown field-map entries: {", ".join(sorted(missing_a | missing_b))}'
        )

    raw_parameters: list[Any] = [layer_a_id, layer_b_id]
    if scope_a == 'selected':
        raw_parameters.append(selected_a)
    if scope_b == 'selected':
        raw_parameters.append(selected_b)

    raw_geometry = 'ST_Intersection(a.geometry, b.geometry)'
    geometry_parameters: list[Any] = []
    if environments['precision_grid'] is not None:
        raw_geometry = f'ST_SnapToGrid({raw_geometry}, %s)'
        geometry_parameters.append(environments['precision_grid'])

    progress(40, 'Intersecting candidate features')
    minimum_filter = ''
    minimum_parameters: list[Any] = []
    if parameters['minimum_measure'] is not None:
        measurement = 'ST_Length(geometry::geography)' if output_family == 'line' else 'ST_Area(geometry::geography)'
        minimum_filter = f'AND {measurement} >= %s'
        minimum_parameters.append(parameters['minimum_measure'])
    cur.execute(
        f"""
        WITH raw_intersections AS MATERIALIZED (
            SELECT a.id AS source_a_id,
                   b.id AS source_b_id,
                   a.properties AS properties_a,
                   b.properties AS properties_b,
                   {raw_geometry} AS geometry
            FROM features a
            JOIN features b
              ON a.geometry && b.geometry
             AND ST_Intersects(a.geometry, b.geometry)
            WHERE a.layer_id = %s::uuid
              AND b.layer_id = %s::uuid
              {_selected_clause('a', scope_a)}
              {_selected_clause('b', scope_b)}
        ), typed_intersections AS MATERIALIZED (
            SELECT source_a_id,
                   source_b_id,
                   properties_a,
                   properties_b,
                   ST_CollectionExtract(geometry, %s) AS geometry
            FROM raw_intersections
        )
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               geometry,
               jsonb_build_object(
                   'source_a_id', source_a_id::text,
                   'source_b_id', source_b_id::text
               )
               || COALESCE((
                   SELECT jsonb_object_agg(field_map.value, source_property.value)
                   FROM jsonb_each_text(%s::jsonb) field_map
                   JOIN jsonb_each(properties_a) source_property ON source_property.key = field_map.key
               ), '{{}}'::jsonb)
               || COALESCE((
                   SELECT jsonb_object_agg(field_map.value, source_property.value)
                   FROM jsonb_each_text(%s::jsonb) field_map
                   JOIN jsonb_each(properties_b) source_property ON source_property.key = field_map.key
               ), '{{}}'::jsonb),
               %s::uuid
        FROM typed_intersections
        WHERE geometry IS NOT NULL AND NOT ST_IsEmpty(geometry) {minimum_filter}
        """,
        tuple(
            geometry_parameters
            + raw_parameters
            + [collection_type]
            + [output_layer_id, json.dumps(mapping_a), json.dumps(mapping_b), created_by]
            + minimum_parameters
        ),
    )
    feature_count = cur.rowcount

    progress(78, 'Recording output provenance')
    _record_output_history(cur, output_layer_id, created_by)
    warnings: list[str] = []
    if parameters['output_type'] != 'auto':
        warnings.append(
            f'Only {output_family} components were retained from intersection results.'
        )
    if maximum_pairs > 1_000_000:
        warnings.append(
            f'The inputs contain up to {maximum_pairs:,} feature pairs; spatial indexes limited actual candidates.'
        )
    if not feature_count:
        warnings.append('The operation produced an empty output layer.')

    progress(92, 'Finalizing output')
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': warnings,
        'metrics': {
            'input_feature_count_a': input_count_a,
            'input_feature_count_b': input_count_b,
            'maximum_feature_pairs': maximum_pairs,
            'output_geometry_family': output_family,
            'minimum_measure': parameters['minimum_measure'],
        },
    }


def _execute_mask_overlay(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
    operation: str,
) -> dict[str, Any]:
    input_layer_id = parameters['input_layer']
    mask_layer_id = parameters['mask_layer']
    if input_layer_id == mask_layer_id:
        raise VectorAnalysisError(f'{operation.title()} requires different input and mask layers')

    cur.execute(
        'SELECT id, name, geometry_type FROM layers WHERE id = ANY(%s::uuid[])',
        ([input_layer_id, mask_layer_id],),
    )
    layers = {str(row['id']): dict(row) for row in cur.fetchall()}
    if input_layer_id not in layers or mask_layer_id not in layers:
        raise VectorAnalysisError('One or more input layers were not found')

    input_family = _resolve_layer_family(cur, layers[input_layer_id])
    mask_family = _resolve_layer_family(cur, layers[mask_layer_id])
    if mask_family != 'polygon':
        raise VectorAnalysisError(f'{operation.title()} mask layer must contain polygon geometry')
    geometry_types = {'point': ('Point', 1), 'line': ('LineString', 2), 'polygon': ('Polygon', 3)}
    layer_geometry_type, collection_type = geometry_types[input_family]

    scope_input = environments['scope_a']
    scope_mask = environments['scope_b']
    selected_input = environments['selected_feature_ids_a']
    selected_mask = environments['selected_feature_ids_b']
    input_count = _count_scoped_features(cur, input_layer_id, scope_input, selected_input)
    mask_count = _count_scoped_features(cur, mask_layer_id, scope_mask, selected_mask)

    progress(15, 'Creating output schema')
    output_layer_id = _create_output_layer(
        cur,
        name=parameters['output_name'],
        description=f'{operation.title()} of "{layers[input_layer_id]["name"]}" using "{layers[mask_layer_id]["name"]}"',
        geometry_type=layer_geometry_type,
        created_by=created_by,
        source_layer_id=input_layer_id,
    )
    _inherit_layer_style(cur, output_layer_id, input_layer_id)
    provenance_requests = [
        ('source_feature_id', 'Source feature ID'),
    ]
    dissolve_mask = operation == 'erase' or parameters.get('dissolve_mask', True)
    if operation == 'clip' and not dissolve_mask:
        provenance_requests.append(('mask_feature_id', 'Mask feature ID'))
    provenance_fields = _add_provenance_fields(cur, output_layer_id, provenance_requests)
    source_id_field = provenance_fields[0]
    mask_id_field = provenance_fields[1] if len(provenance_fields) > 1 else None

    input_clause = _selected_clause('source', scope_input)
    mask_clause = _selected_clause('mask', scope_mask)
    precision_grid = environments['precision_grid']

    progress(38, f'{operation.title()}ping features' if operation == 'clip' else 'Erasing mask areas')
    if operation == 'clip' and not dissolve_mask:
        geometry_expression = 'ST_Intersection(source.geometry, mask.geometry)'
        query_parameters: list[Any] = []
        if precision_grid is not None:
            geometry_expression = f'ST_SnapToGrid({geometry_expression}, %s)'
            query_parameters.append(precision_grid)
        query_parameters.extend([input_layer_id, mask_layer_id])
        if scope_input == 'selected':
            query_parameters.append(selected_input)
        if scope_mask == 'selected':
            query_parameters.append(selected_mask)
        query_parameters.extend([
            collection_type,
            output_layer_id,
            source_id_field,
            mask_id_field,
            created_by,
        ])
        cur.execute(
            f"""
            WITH processed AS MATERIALIZED (
                SELECT source.id AS source_id,
                       mask.id AS mask_id,
                       source.properties,
                       {geometry_expression} AS geometry
                FROM features source
                JOIN features mask
                  ON source.geometry && mask.geometry
                 AND ST_Intersects(source.geometry, mask.geometry)
                WHERE source.layer_id = %s::uuid
                  AND mask.layer_id = %s::uuid
                  {input_clause}
                  {mask_clause}
            ), typed AS MATERIALIZED (
                SELECT source_id,
                       mask_id,
                       properties,
                       ST_CollectionExtract(geometry, %s) AS geometry
                FROM processed
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid,
                   geometry,
                   properties || jsonb_build_object(
                       %s, source_id::text,
                       %s, mask_id::text
                   ),
                   %s::uuid
            FROM typed
            WHERE geometry IS NOT NULL AND NOT ST_IsEmpty(geometry)
            """,
            tuple(query_parameters),
        )
    else:
        mask_parameters: list[Any] = [mask_layer_id]
        if scope_mask == 'selected':
            mask_parameters.append(selected_mask)
        if operation == 'clip':
            geometry_expression = 'ST_Intersection(source.geometry, dissolved_mask.geometry)'
        else:
            geometry_expression = """
                CASE
                    WHEN dissolved_mask.geometry IS NULL THEN source.geometry
                    WHEN NOT source.geometry && dissolved_mask.geometry THEN source.geometry
                    ELSE ST_Difference(source.geometry, dissolved_mask.geometry)
                END
            """
        geometry_parameters: list[Any] = []
        if precision_grid is not None:
            geometry_expression = f'ST_SnapToGrid(({geometry_expression}), %s)'
            geometry_parameters.append(precision_grid)
        input_parameters: list[Any] = [input_layer_id]
        if scope_input == 'selected':
            input_parameters.append(selected_input)
        cur.execute(
            f"""
            WITH dissolved_mask AS MATERIALIZED (
                SELECT ST_UnaryUnion(ST_Collect(mask.geometry)) AS geometry
                FROM features mask
                WHERE mask.layer_id = %s::uuid
                  {mask_clause}
            ), processed AS MATERIALIZED (
                SELECT source.id AS source_id,
                       source.properties,
                       {geometry_expression} AS geometry
                FROM features source
                CROSS JOIN dissolved_mask
                WHERE source.layer_id = %s::uuid
                  {input_clause}
                  {'AND dissolved_mask.geometry IS NOT NULL AND source.geometry && dissolved_mask.geometry AND ST_Intersects(source.geometry, dissolved_mask.geometry)' if operation == 'clip' else ''}
            ), typed AS MATERIALIZED (
                SELECT source_id,
                       properties,
                       ST_CollectionExtract(geometry, %s) AS geometry
                FROM processed
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid,
                   geometry,
                   properties || jsonb_build_object(%s, source_id::text),
                   %s::uuid
            FROM typed
            WHERE geometry IS NOT NULL AND NOT ST_IsEmpty(geometry)
            """,
            tuple(
                mask_parameters
                + geometry_parameters
                + input_parameters
                + [collection_type, output_layer_id, source_id_field, created_by]
            ),
        )
    feature_count = cur.rowcount

    progress(78, 'Recording output provenance')
    _record_output_history(cur, output_layer_id, created_by)
    warnings: list[str] = []
    if mask_count == 0:
        warnings.append('The selected mask contains no features.')
    if not feature_count:
        warnings.append('The operation produced an empty output layer.')
    if operation == 'clip' and not dissolve_mask:
        warnings.append('Overlapping mask features can produce duplicate source portions when mask dissolve is disabled.')

    progress(92, 'Finalizing output')
    metrics = {
        'input_feature_count': input_count,
        'mask_feature_count': mask_count,
        'output_geometry_family': input_family,
        'dissolved_mask': dissolve_mask,
    }
    if operation == 'erase':
        metrics['fully_removed_feature_count'] = max(input_count - feature_count, 0)
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': warnings,
        'metrics': metrics,
    }


def _execute_clip(cur, parameters, environments, created_by, progress):
    return _execute_mask_overlay(
        cur, parameters, environments, created_by, progress, 'clip'
    )


def _execute_erase(cur, parameters, environments, created_by, progress):
    return _execute_mask_overlay(
        cur, parameters, environments, created_by, progress, 'erase'
    )


def _execute_dissolve(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
) -> dict[str, Any]:
    layer_id = parameters['layer_id']
    cur.execute(
        'SELECT id, name, geometry_type FROM layers WHERE id = %s::uuid',
        (layer_id,),
    )
    source_layer = cur.fetchone()
    if not source_layer:
        raise VectorAnalysisError('Input layer was not found')
    source_layer = dict(source_layer)
    input_family = _resolve_layer_family(cur, source_layer)
    geometry_types = {'point': ('Point', 1), 'line': ('LineString', 2), 'polygon': ('Polygon', 3)}
    layer_geometry_type, collection_type = geometry_types[input_family]

    cur.execute(
        """
        SELECT name, alias, field_type, nullable, length, precision, scale
        FROM layer_fields WHERE layer_id = %s::uuid
        """,
        (layer_id,),
    )
    source_fields = {row['name']: dict(row) for row in cur.fetchall()}
    dissolve_fields = parameters['dissolve_fields']
    missing_fields = [name for name in dissolve_fields if name not in source_fields]
    if missing_fields:
        raise VectorAnalysisError(f'Unknown dissolve fields: {", ".join(missing_fields)}')

    statistics = parameters['statistics']
    numeric_types = {'integer', 'double'}
    for statistic in statistics:
        field_name = statistic['field']
        if field_name and field_name not in source_fields:
            raise VectorAnalysisError(f'Unknown statistic field: {field_name}')
        if statistic['statistic'] in {'sum', 'minimum', 'maximum', 'mean'}:
            if source_fields[field_name]['field_type'] not in numeric_types:
                raise VectorAnalysisError(
                    f'{statistic["statistic"]} requires a numeric field: {field_name}'
                )
        if statistic['output_field'] in dissolve_fields:
            raise VectorAnalysisError(
                f'Statistic output field conflicts with dissolve field: {statistic["output_field"]}'
            )

    scope = environments['scope']
    selected_ids = environments['selected_feature_ids']
    input_count = _count_scoped_features(cur, layer_id, scope, selected_ids)

    progress(15, 'Creating dissolve schema')
    output_layer_id = _create_output_layer(
        cur,
        name=parameters['output_name'],
        description=f'Dissolve of "{source_layer["name"]}"',
        geometry_type=layer_geometry_type,
        created_by=created_by,
        source_layer_id=layer_id,
    )
    if dissolve_fields:
        cur.execute(
            """
            DELETE FROM layer_fields
            WHERE layer_id = %s::uuid AND NOT (name = ANY(%s::text[]))
            """,
            (output_layer_id, dissolve_fields),
        )
    else:
        cur.execute('DELETE FROM layer_fields WHERE layer_id = %s::uuid', (output_layer_id,))
    cur.execute(
        """
        DELETE FROM layer_domains domain
        WHERE domain.layer_id = %s::uuid
          AND NOT EXISTS (SELECT 1 FROM layer_fields field WHERE field.domain_id = domain.id)
        """,
        (output_layer_id,),
    )
    for index, statistic in enumerate(statistics):
        source_field = source_fields.get(statistic['field']) if statistic['field'] else None
        statistic_name = statistic['statistic']
        if statistic_name == 'count':
            field_type = 'integer'
            alias = 'Feature count'
            length = precision = scale = None
        elif statistic_name in {'sum', 'minimum', 'maximum', 'mean'}:
            field_type = 'double'
            alias = f'{statistic_name.title()} of {source_field.get("alias") or statistic["field"]}'
            length = None
            precision = source_field.get('precision')
            scale = source_field.get('scale')
        elif statistic_name in {'first', 'last'}:
            field_type = source_field['field_type']
            alias = f'{statistic_name.title()} {source_field.get("alias") or statistic["field"]}'
            length = source_field.get('length')
            precision = source_field.get('precision')
            scale = source_field.get('scale')
        else:
            field_type = 'string'
            alias = f'Concatenated {source_field.get("alias") or statistic["field"]}'
            length = parameters['concatenate_max_length']
            precision = scale = None
        cur.execute(
            """
            INSERT INTO layer_fields (
                layer_id, name, alias, field_type, nullable, length, precision, scale, sort_order
            ) VALUES (%s::uuid, %s, %s, %s, TRUE, %s, %s, %s, %s)
            """,
            (
                output_layer_id,
                statistic['output_field'],
                alias[:128],
                field_type,
                length,
                precision,
                scale,
                10_000 + index,
            ),
        )

    group_selects = [
        f"source.properties -> '{field_name}' AS group_{index}"
        for index, field_name in enumerate(dissolve_fields)
    ]
    group_by = [f"source.properties -> '{field_name}'" for field_name in dissolve_fields]
    statistic_selects: list[str] = []
    statistic_parameters: list[Any] = []
    for index, statistic in enumerate(statistics):
        statistic_name = statistic['statistic']
        field_name = statistic['field']
        if statistic_name == 'count':
            expression = 'COUNT(*)'
        elif statistic_name in {'sum', 'minimum', 'maximum', 'mean'}:
            function = {'sum': 'SUM', 'minimum': 'MIN', 'maximum': 'MAX', 'mean': 'AVG'}[statistic_name]
            numeric_value = (
                f"CASE WHEN jsonb_typeof(source.properties -> '{field_name}') = 'number' "
                f"THEN (source.properties ->> '{field_name}')::double precision END"
            )
            expression = f'{function}({numeric_value})'
        elif statistic_name == 'first':
            expression = f"(array_agg(source.properties -> '{field_name}' ORDER BY source.id))[1]"
        elif statistic_name == 'last':
            expression = f"(array_agg(source.properties -> '{field_name}' ORDER BY source.id DESC))[1]"
        else:
            expression = (
                f"to_jsonb(LEFT(STRING_AGG(source.properties ->> '{field_name}', %s ORDER BY source.id), %s))"
            )
            statistic_parameters.extend([
                parameters['concatenate_delimiter'], parameters['concatenate_max_length'],
            ])
        statistic_selects.append(f'{expression} AS statistic_{index}')

    property_pairs = [
        f"'{field_name}', group_{index}"
        for index, field_name in enumerate(dissolve_fields)
    ] + [
        f"'{statistic['output_field']}', statistic_{index}"
        for index, statistic in enumerate(statistics)
    ]
    properties_expression = (
        f"jsonb_build_object({', '.join(property_pairs)})"
        if property_pairs else "'{}'::jsonb"
    )
    where_clauses = ['source.layer_id = %s::uuid']
    query_parameters: list[Any] = [layer_id]
    scope_condition = _selected_clause('source', scope).removeprefix('AND ')
    if scope_condition:
        where_clauses.append(scope_condition)
    if scope == 'selected':
        query_parameters.append(selected_ids)
    if parameters['null_policy'] == 'exclude':
        for field_name in dissolve_fields:
            where_clauses.append(
                f"source.properties -> '{field_name}' IS NOT NULL "
                f"AND source.properties -> '{field_name}' <> 'null'::jsonb"
            )

    aggregate_columns = group_selects + [
        'ST_MemUnion(source.geometry) AS geometry',
    ] + statistic_selects
    grouped_sql = ',\n                       '.join(aggregate_columns)
    precision_expression = 'ST_CollectionExtract(geometry, %s)'
    prepared_parameters: list[Any] = [collection_type]
    if environments['precision_grid'] is not None:
        precision_expression = f'ST_SnapToGrid({precision_expression}, %s)'
        prepared_parameters.append(environments['precision_grid'])
    group_clause = f"GROUP BY {', '.join(group_by)}" if group_by else ''
    if parameters['multipart']:
        final_geometry = 'geometry'
        final_from = 'prepared'
    else:
        final_geometry = 'dumped.geometry'
        final_from = 'prepared CROSS JOIN LATERAL ST_Dump(prepared.geometry) AS dumped'

    progress(42, 'Aggregating dissolve groups')
    cur.execute(
        f"""
        WITH grouped AS MATERIALIZED (
            SELECT {grouped_sql}
            FROM features source
            WHERE {' AND '.join(where_clauses)}
            {group_clause}
        ), prepared AS MATERIALIZED (
            SELECT {precision_expression} AS geometry,
                   {properties_expression} AS properties
            FROM grouped
        )
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid, {final_geometry}, properties, %s::uuid
        FROM {final_from}
        WHERE {final_geometry} IS NOT NULL AND NOT ST_IsEmpty({final_geometry})
        """,
        tuple(statistic_parameters + query_parameters + prepared_parameters + [output_layer_id, created_by]),
    )
    feature_count = cur.rowcount

    progress(80, 'Recording output provenance')
    _record_output_history(cur, output_layer_id, created_by)
    warnings = [] if feature_count else ['The operation produced an empty output layer.']
    progress(92, 'Finalizing output')
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': warnings,
        'metrics': {
            'input_feature_count': input_count,
            'group_count': feature_count,
            'dissolve_field_count': len(dissolve_fields),
            'statistic_count': len(statistics),
            'multipart': parameters['multipart'],
            'output_geometry_family': input_family,
        },
    }


def _spatial_join_predicate(predicate: str) -> tuple[str, str | None]:
    predicates = {
        'intersects': 'target.geometry && candidate.geometry AND ST_Intersects(target.geometry, candidate.geometry)',
        'within': 'target.geometry && candidate.geometry AND ST_Within(target.geometry, candidate.geometry)',
        'contains': 'target.geometry && candidate.geometry AND ST_Contains(target.geometry, candidate.geometry)',
        'touches': 'target.geometry && candidate.geometry AND ST_Touches(target.geometry, candidate.geometry)',
        'crosses': 'target.geometry && candidate.geometry AND ST_Crosses(target.geometry, candidate.geometry)',
        'overlaps': 'target.geometry && candidate.geometry AND ST_Overlaps(target.geometry, candidate.geometry)',
        'equals': 'target.geometry && candidate.geometry AND ST_Equals(target.geometry, candidate.geometry)',
        'within_distance': 'ST_DWithin(target.geometry::geography, candidate.geometry::geography, %s)',
    }
    return predicates[predicate], 'distance' if predicate == 'within_distance' else None


def _execute_spatial_join(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
) -> dict[str, Any]:
    target_layer_id = parameters['target_layer']
    join_layer_id = parameters['join_layer']
    cur.execute(
        'SELECT id, name, geometry_type FROM layers WHERE id = ANY(%s::uuid[])',
        ([target_layer_id, join_layer_id],),
    )
    layers = {str(row['id']): dict(row) for row in cur.fetchall()}
    if target_layer_id not in layers or join_layer_id not in layers:
        raise VectorAnalysisError('One or more input layers were not found')
    target_family = _resolve_layer_family(cur, layers[target_layer_id])
    geometry_types = {'point': 'Point', 'line': 'LineString', 'polygon': 'Polygon'}

    scope_target = environments['scope_a']
    scope_join = environments['scope_b']
    selected_target = environments['selected_feature_ids_a']
    selected_join = environments['selected_feature_ids_b']
    target_count = _count_scoped_features(cur, target_layer_id, scope_target, selected_target)
    join_count = _count_scoped_features(cur, join_layer_id, scope_join, selected_join)

    progress(15, 'Creating joined schema')
    output_layer_id = _create_output_layer(
        cur,
        name=parameters['output_name'],
        description=f'Spatial join of "{layers[target_layer_id]["name"]}" with "{layers[join_layer_id]["name"]}"',
        geometry_type=geometry_types[target_family],
        created_by=created_by,
    )
    _add_source_id_fields(cur, output_layer_id)
    cur.execute(
        "UPDATE layer_fields SET nullable = TRUE WHERE layer_id = %s::uuid AND name = 'source_b_id'",
        (output_layer_id,),
    )
    cur.execute(
        """
        INSERT INTO layer_fields (
            layer_id, name, alias, field_type, nullable, sort_order
        ) VALUES (%s::uuid, 'join_match_count', 'Join match count', 'integer', FALSE, 2)
        """,
        (output_layer_id,),
    )
    used_fields = {'source_a_id', 'source_b_id', 'join_match_count'}
    used_domains: set[str] = set()
    target_mapping = _append_prefixed_layer_schema(
        cur,
        source_layer_id=target_layer_id,
        output_layer_id=output_layer_id,
        prefix=parameters['target_prefix'],
        alias_prefix='Target',
        sort_offset=10,
        used_field_names=used_fields,
        used_domain_names=used_domains,
        include_fields=set(parameters['target_fields']) if parameters['target_fields'] else None,
    )
    join_mapping = _append_prefixed_layer_schema(
        cur,
        source_layer_id=join_layer_id,
        output_layer_id=output_layer_id,
        prefix=parameters['join_prefix'],
        alias_prefix='Join',
        sort_offset=10_000,
        used_field_names=used_fields,
        used_domain_names=used_domains,
        include_fields=set(parameters['join_fields']) if parameters['join_fields'] else None,
    )
    missing_target = set(parameters['target_fields']) - set(target_mapping)
    missing_join = set(parameters['join_fields']) - set(join_mapping)
    if missing_target or missing_join:
        raise VectorAnalysisError(
            f'Unknown field-map entries: {", ".join(sorted(missing_target | missing_join))}'
        )

    predicate_sql, predicate_parameter = _spatial_join_predicate(parameters['predicate'])
    join_scope_clause = _selected_clause('candidate', scope_join)
    target_scope_clause = _selected_clause('target', scope_target)
    lateral_parameters: list[Any] = [join_layer_id]
    if predicate_parameter:
        lateral_parameters.append(parameters[predicate_parameter])
    if scope_join == 'selected':
        lateral_parameters.append(selected_join)
    target_parameters: list[Any] = [target_layer_id]
    if scope_target == 'selected':
        target_parameters.append(selected_target)

    if parameters['output_mode'] == 'one_to_one':
        match_source = f"""
            FROM features target
            LEFT JOIN LATERAL (
                SELECT candidate.id,
                       candidate.properties,
                       COUNT(*) OVER()::integer AS match_count
                FROM features candidate
                WHERE candidate.layer_id = %s::uuid
                  AND {predicate_sql}
                  {join_scope_clause}
                ORDER BY candidate.id
                LIMIT 1
            ) matched ON TRUE
            WHERE target.layer_id = %s::uuid
              {target_scope_clause}
              {'AND matched.id IS NOT NULL' if not parameters['keep_all'] else ''}
        """
        match_id = 'matched.id'
        match_properties = 'matched.properties'
        match_count_expression = 'COALESCE(matched.match_count, 0)'
    else:
        match_source = f"""
            FROM features target
            LEFT JOIN features matched
              ON matched.layer_id = %s::uuid
             AND {predicate_sql.replace('candidate.', 'matched.')}
             {join_scope_clause.replace('candidate.', 'matched.')}
            WHERE target.layer_id = %s::uuid
              {target_scope_clause}
              {'AND matched.id IS NOT NULL' if not parameters['keep_all'] else ''}
        """
        match_id = 'matched.id'
        match_properties = 'matched.properties'
        match_count_expression = 'CASE WHEN matched.id IS NULL THEN 0 ELSE 1 END'

    progress(42, 'Evaluating spatial matches')
    cur.execute(
        f"""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               target.geometry,
               jsonb_build_object(
                   'source_a_id', target.id::text,
                   'source_b_id', {match_id}::text,
                   'join_match_count', {match_count_expression}
               )
               || COALESCE((
                   SELECT jsonb_object_agg(field_map.value, source_property.value)
                   FROM jsonb_each_text(%s::jsonb) field_map
                   JOIN jsonb_each(target.properties) source_property ON source_property.key = field_map.key
               ), '{{}}'::jsonb)
               || COALESCE((
                   SELECT jsonb_object_agg(field_map.value, source_property.value)
                   FROM jsonb_each_text(%s::jsonb) field_map
                   JOIN jsonb_each({match_properties}) source_property ON source_property.key = field_map.key
               ), '{{}}'::jsonb),
               %s::uuid
        {match_source}
        """,
        tuple(
            [output_layer_id, json.dumps(target_mapping), json.dumps(join_mapping), created_by]
            + lateral_parameters
            + target_parameters
        ),
    )
    feature_count = cur.rowcount
    progress(80, 'Recording output provenance')
    _record_output_history(cur, output_layer_id, created_by)
    warnings = [] if feature_count else ['The operation produced an empty output layer.']
    if target_count * join_count > 1_000_000:
        warnings.append(
            f'The inputs contain up to {target_count * join_count:,} feature pairs; spatial indexes limit actual candidates.'
        )
    progress(92, 'Finalizing output')
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': warnings,
        'metrics': {
            'target_feature_count': target_count,
            'join_feature_count': join_count,
            'maximum_feature_pairs': target_count * join_count,
            'output_mode': parameters['output_mode'],
            'predicate': parameters['predicate'],
            'keep_all': parameters['keep_all'],
            'output_geometry_family': target_family,
        },
    }


def _execute_summarize_within(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
) -> dict[str, Any]:
    zone_layer_id = parameters['zone_layer']
    summary_layer_id = parameters['summary_layer']
    cur.execute(
        'SELECT id, name, geometry_type FROM layers WHERE id = ANY(%s::uuid[])',
        ([zone_layer_id, summary_layer_id],),
    )
    layers = {str(row['id']): dict(row) for row in cur.fetchall()}
    if zone_layer_id not in layers or summary_layer_id not in layers:
        raise VectorAnalysisError('One or more input layers were not found')
    if _resolve_layer_family(cur, layers[zone_layer_id]) != 'polygon':
        raise VectorAnalysisError('Summarize Within zone layer must contain polygon geometry')
    summary_family = _resolve_layer_family(cur, layers[summary_layer_id])

    cur.execute(
        """
        SELECT name, alias, field_type, length, precision, scale
        FROM layer_fields WHERE layer_id = %s::uuid
        """,
        (summary_layer_id,),
    )
    summary_fields = {row['name']: dict(row) for row in cur.fetchall()}
    group_field = parameters['group_field']
    if group_field and group_field not in summary_fields:
        raise VectorAnalysisError(f'Unknown group field: {group_field}')
    for statistic in parameters['statistics']:
        field_name = statistic['field']
        if statistic['statistic'] != 'count':
            if field_name not in summary_fields:
                raise VectorAnalysisError(f'Unknown statistic field: {field_name}')
            if summary_fields[field_name]['field_type'] not in {'integer', 'double'}:
                raise VectorAnalysisError(f'{statistic["statistic"]} requires a numeric field: {field_name}')

    scope_zone = environments['scope_a']
    scope_summary = environments['scope_b']
    selected_zones = environments['selected_feature_ids_a']
    selected_summaries = environments['selected_feature_ids_b']
    zone_count = _count_scoped_features(cur, zone_layer_id, scope_zone, selected_zones)
    summary_count = _count_scoped_features(cur, summary_layer_id, scope_summary, selected_summaries)

    progress(15, 'Creating summary schema')
    output_layer_id = _create_output_layer(
        cur,
        name=parameters['output_name'],
        description=f'Summary of "{layers[summary_layer_id]["name"]}" within "{layers[zone_layer_id]["name"]}"',
        geometry_type='Polygon',
        created_by=created_by,
        source_layer_id=zone_layer_id,
    )
    _inherit_layer_style(cur, output_layer_id, zone_layer_id)
    cur.execute('SELECT name FROM layer_fields WHERE layer_id = %s::uuid', (output_layer_id,))
    used_fields = {row['name'] for row in cur.fetchall()}

    generated_fields: dict[str, str] = {}
    generated_definitions = [
        ('summary_count', 'Summary feature count', 'integer'),
        ('summary_length_m', 'Length within zone (metres)', 'double'),
        ('summary_area_sqm', 'Area within zone (square metres)', 'double'),
        ('zone_area_sqm', 'Zone area (square metres)', 'double'),
        ('percent_of_zone', 'Percentage of zone area', 'double'),
        ('percent_of_source', 'Percentage of source measure', 'double'),
    ]
    for index, (requested_name, alias, field_type) in enumerate(generated_definitions):
        output_name = _bounded_identifier('', requested_name, used_fields)
        generated_fields[requested_name] = output_name
        cur.execute(
            """
            INSERT INTO layer_fields (layer_id, name, alias, field_type, nullable, sort_order)
            VALUES (%s::uuid, %s, %s, %s, TRUE, %s)
            """,
            (output_layer_id, output_name, alias, field_type, 100_000 + index),
        )
    if group_field:
        group_output_name = _bounded_identifier('', 'summary_group', used_fields)
        generated_fields['summary_group'] = group_output_name
        group_definition = summary_fields[group_field]
        cur.execute(
            """
            INSERT INTO layer_fields (
                layer_id, name, alias, field_type, nullable, length, precision, scale, sort_order
            ) VALUES (%s::uuid, %s, %s, %s, TRUE, %s, %s, %s, 100100)
            """,
            (
                output_layer_id,
                group_output_name,
                f'Summary group: {group_definition.get("alias") or group_field}'[:128],
                group_definition['field_type'],
                group_definition.get('length'),
                group_definition.get('precision'),
                group_definition.get('scale'),
            ),
        )

    statistic_output_names: list[str] = []
    for index, statistic in enumerate(parameters['statistics']):
        output_name = _bounded_identifier('', statistic['output_field'], used_fields)
        statistic_output_names.append(output_name)
        field_type = 'integer' if statistic['statistic'] == 'count' else 'double'
        cur.execute(
            """
            INSERT INTO layer_fields (layer_id, name, alias, field_type, nullable, sort_order)
            VALUES (%s::uuid, %s, %s, %s, TRUE, %s)
            """,
            (output_layer_id, output_name, statistic['output_field'], field_type, 101000 + index),
        )

    predicate = (
        'zone.geometry && summary.geometry AND ST_Intersects(summary.geometry, zone.geometry)'
        if parameters['boundary_predicate'] == 'intersects'
        else 'zone.geometry && summary.geometry AND ST_Within(summary.geometry, zone.geometry)'
    )
    summary_scope_clause = _selected_clause('summary', scope_summary)
    zone_scope_clause = _selected_clause('zone', scope_zone)
    query_parameters: list[Any] = [summary_layer_id]
    if scope_summary == 'selected':
        query_parameters.append(selected_summaries)
    query_parameters.append(zone_layer_id)
    if scope_zone == 'selected':
        query_parameters.append(selected_zones)

    group_select = f", summary.properties -> '{group_field}' AS group_value" if group_field else ', NULL::jsonb AS group_value'
    # group_value is selected by the grouped CTE even when it is the typed NULL
    # placeholder used for an ungrouped summary, so PostgreSQL still requires it.
    group_clause = ', group_value'
    statistic_selects: list[str] = []
    for index, statistic in enumerate(parameters['statistics']):
        if statistic['statistic'] == 'count':
            expression = 'COUNT(summary_id)'
        else:
            function = {'sum': 'SUM', 'minimum': 'MIN', 'maximum': 'MAX', 'mean': 'AVG'}[statistic['statistic']]
            field_name = statistic['field']
            expression = (
                f"{function}(CASE WHEN jsonb_typeof(summary_properties -> '{field_name}') = 'number' "
                f"THEN (summary_properties ->> '{field_name}')::double precision END)"
            )
        statistic_selects.append(f'{expression} AS statistic_{index}')

    property_pairs = [
        f"'{generated_fields['summary_count']}', matched_count",
        f"'{generated_fields['summary_length_m']}', summary_length_m",
        f"'{generated_fields['summary_area_sqm']}', summary_area_sqm",
        f"'{generated_fields['zone_area_sqm']}', zone_area_sqm",
        f"'{generated_fields['percent_of_zone']}', percent_of_zone",
        f"'{generated_fields['percent_of_source']}', percent_of_source",
    ]
    if group_field:
        property_pairs.append(f"'{generated_fields['summary_group']}', group_value")
    property_pairs.extend(
        f"'{statistic_output_names[index]}', statistic_{index}"
        for index in range(len(statistic_output_names))
    )

    progress(42, 'Calculating zonal summaries')
    cur.execute(
        f"""
        WITH matches AS MATERIALIZED (
            SELECT zone.id AS zone_id,
                   zone.geometry AS zone_geometry,
                   zone.properties AS zone_properties,
                   summary.id AS summary_id,
                   summary.properties AS summary_properties,
                   CASE WHEN summary.id IS NULL THEN NULL ELSE ST_Intersection(summary.geometry, zone.geometry) END AS clipped_geometry,
                   CASE
                       WHEN summary.id IS NULL THEN NULL
                       WHEN {repr(summary_family)} = 'line' THEN ST_Length(summary.geometry::geography)
                       WHEN {repr(summary_family)} = 'polygon' THEN ST_Area(summary.geometry::geography)
                       ELSE 1
                   END AS source_measure
                   {group_select}
            FROM features zone
            LEFT JOIN features summary
              ON summary.layer_id = %s::uuid
             AND {predicate}
             {summary_scope_clause}
            WHERE zone.layer_id = %s::uuid
              {zone_scope_clause}
              {'AND summary.id IS NOT NULL' if not parameters['include_empty'] else ''}
        ), grouped AS MATERIALIZED (
            SELECT zone_id,
                   zone_geometry,
                   zone_properties,
                   group_value,
                   COUNT(summary_id)::integer AS matched_count,
                   SUM(CASE WHEN {repr(summary_family)} = 'line' THEN ST_Length(clipped_geometry::geography) ELSE 0 END) AS summary_length_m,
                   SUM(CASE WHEN {repr(summary_family)} = 'polygon' THEN ST_Area(clipped_geometry::geography) ELSE 0 END) AS summary_area_sqm,
                   ST_Area(zone_geometry::geography) AS zone_area_sqm,
                   CASE WHEN {repr(summary_family)} = 'polygon' THEN
                       100 * SUM(ST_Area(clipped_geometry::geography)) / NULLIF(ST_Area(zone_geometry::geography), 0)
                   END AS percent_of_zone,
                   CASE WHEN {repr(summary_family)} IN ('line', 'polygon') THEN
                       100 * SUM(CASE WHEN {repr(summary_family)} = 'line' THEN ST_Length(clipped_geometry::geography) ELSE ST_Area(clipped_geometry::geography) END)
                       / NULLIF(SUM(source_measure), 0)
                   END AS percent_of_source
                   {',' if statistic_selects else ''} {', '.join(statistic_selects)}
            FROM matches
            GROUP BY zone_id, zone_geometry, zone_properties{group_clause}
        )
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               zone_geometry,
               zone_properties || jsonb_build_object({', '.join(property_pairs)}),
               %s::uuid
        FROM grouped
        """,
        tuple(query_parameters + [output_layer_id, created_by]),
    )
    feature_count = cur.rowcount
    progress(80, 'Recording output provenance')
    _record_output_history(cur, output_layer_id, created_by)
    warnings = [] if feature_count else ['The operation produced an empty output layer.']
    progress(92, 'Finalizing output')
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': warnings,
        'metrics': {
            'zone_feature_count': zone_count,
            'summary_feature_count': summary_count,
            'output_row_count': feature_count,
            'summary_geometry_family': summary_family,
            'boundary_predicate': parameters['boundary_predicate'],
            'include_empty': parameters['include_empty'],
        },
    }


def _execute_near(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
) -> dict[str, Any]:
    source_layer_id = parameters['source_layer']
    near_layer_id = parameters['near_layer']
    cur.execute(
        'SELECT id, name, geometry_type FROM layers WHERE id = ANY(%s::uuid[])',
        ([source_layer_id, near_layer_id],),
    )
    layers = {str(row['id']): dict(row) for row in cur.fetchall()}
    if source_layer_id not in layers or near_layer_id not in layers:
        raise VectorAnalysisError('One or more input layers were not found')

    scope_source = environments['scope_a']
    scope_near = environments['scope_b']
    selected_sources = environments['selected_feature_ids_a']
    selected_near = environments['selected_feature_ids_b']
    source_count = _count_scoped_features(cur, source_layer_id, scope_source, selected_sources)
    near_count = _count_scoped_features(cur, near_layer_id, scope_near, selected_near)

    progress(15, 'Creating near-table schema')
    output_geometry_type = 'LineString' if parameters['output_geometry'] == 'connecting_line' else 'Point'
    output_layer_id = _create_output_layer(
        cur,
        name=parameters['output_name'],
        description=f'Nearest features from "{layers[source_layer_id]["name"]}" to "{layers[near_layer_id]["name"]}"',
        geometry_type=output_geometry_type,
        created_by=created_by,
    )
    cur.execute(
        """
        INSERT INTO layer_fields (layer_id, name, alias, field_type, nullable, length, sort_order)
        VALUES
            (%s::uuid, 'source_id', 'Source feature ID', 'string', FALSE, 36, 0),
            (%s::uuid, 'near_id', 'Near feature ID', 'string', FALSE, 36, 1),
            (%s::uuid, 'near_rank', 'Near rank', 'integer', FALSE, NULL, 2),
            (%s::uuid, 'distance_m', 'Geodesic distance (metres)', 'double', FALSE, NULL, 3),
            (%s::uuid, 'bearing_deg', 'Initial bearing (degrees)', 'double', TRUE, NULL, 4),
            (%s::uuid, 'source_x', 'Closest source longitude', 'double', FALSE, NULL, 5),
            (%s::uuid, 'source_y', 'Closest source latitude', 'double', FALSE, NULL, 6),
            (%s::uuid, 'near_x', 'Closest near longitude', 'double', FALSE, NULL, 7),
            (%s::uuid, 'near_y', 'Closest near latitude', 'double', FALSE, NULL, 8)
        """,
        (output_layer_id,) * 9,
    )
    used_fields = {
        'source_id', 'near_id', 'near_rank', 'distance_m', 'bearing_deg',
        'source_x', 'source_y', 'near_x', 'near_y',
    }
    used_domains: set[str] = set()
    source_mapping = _append_prefixed_layer_schema(
        cur,
        source_layer_id=source_layer_id,
        output_layer_id=output_layer_id,
        prefix=parameters['source_prefix'],
        alias_prefix='Source',
        sort_offset=100,
        used_field_names=used_fields,
        used_domain_names=used_domains,
    )
    near_mapping = _append_prefixed_layer_schema(
        cur,
        source_layer_id=near_layer_id,
        output_layer_id=output_layer_id,
        prefix=parameters['near_prefix'],
        alias_prefix='Near',
        sort_offset=10_000,
        used_field_names=used_fields,
        used_domain_names=used_domains,
    )

    source_scope_clause = _selected_clause('source', scope_source)
    near_scope_clause = _selected_clause('candidate', scope_near)
    self_clause = 'AND candidate.id <> source.id' if parameters['exclude_self'] and source_layer_id == near_layer_id else ''
    distance_clause = (
        'AND ST_DWithin(source.geometry::geography, candidate.geometry::geography, %s)'
        if parameters['max_distance'] is not None else ''
    )
    output_geometry = {
        'connecting_line': 'ST_MakeLine(ranked.source_point, ranked.near_point)',
        'source_point': 'ranked.source_point',
        'near_point': 'ranked.near_point',
    }[parameters['output_geometry']]
    query_parameters: list[Any] = [
        output_layer_id,
        json.dumps(source_mapping),
        json.dumps(near_mapping),
        created_by,
        near_layer_id,
    ]
    if parameters['max_distance'] is not None:
        query_parameters.append(parameters['max_distance'])
    if scope_near == 'selected':
        query_parameters.append(selected_near)
    candidate_limit = max(64, parameters['nearest_count'] * 8)
    query_parameters.extend([candidate_limit, parameters['nearest_count'], source_layer_id])
    if scope_source == 'selected':
        query_parameters.append(selected_sources)

    progress(42, 'Finding indexed nearest candidates')
    cur.execute(
        f"""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               {output_geometry},
               jsonb_build_object(
                   'source_id', source.id::text,
                   'near_id', ranked.near_id::text,
                   'near_rank', ranked.near_rank,
                   'distance_m', ranked.distance_m,
                   'bearing_deg', ranked.bearing_deg,
                   'source_x', ST_X(ranked.source_point),
                   'source_y', ST_Y(ranked.source_point),
                   'near_x', ST_X(ranked.near_point),
                   'near_y', ST_Y(ranked.near_point)
               )
               || COALESCE((
                   SELECT jsonb_object_agg(field_map.value, source_property.value)
                   FROM jsonb_each_text(%s::jsonb) field_map
                   JOIN jsonb_each(source.properties) source_property ON source_property.key = field_map.key
               ), '{{}}'::jsonb)
               || COALESCE((
                   SELECT jsonb_object_agg(field_map.value, near_property.value)
                   FROM jsonb_each_text(%s::jsonb) field_map
                   JOIN jsonb_each(ranked.near_properties) near_property ON near_property.key = field_map.key
               ), '{{}}'::jsonb),
               %s::uuid
        FROM features source
        CROSS JOIN LATERAL (
            SELECT exact.near_id,
                   exact.near_properties,
                   exact.source_point,
                   exact.near_point,
                   exact.distance_m,
                   exact.bearing_deg,
                   ROW_NUMBER() OVER (ORDER BY exact.distance_m, exact.near_id)::integer AS near_rank
            FROM (
                SELECT candidates.near_id,
                       candidates.near_properties,
                       candidates.source_point,
                       candidates.near_point,
                       ST_Distance(candidates.source_point::geography, candidates.near_point::geography) AS distance_m,
                       DEGREES(ST_Azimuth(candidates.source_point::geography, candidates.near_point::geography)) AS bearing_deg
                FROM (
                    SELECT candidate.id AS near_id,
                           candidate.properties AS near_properties,
                           ST_ClosestPoint(source.geometry, candidate.geometry) AS source_point,
                           ST_ClosestPoint(candidate.geometry, source.geometry) AS near_point
                    FROM features candidate
                    WHERE candidate.layer_id = %s::uuid
                      {self_clause}
                      {distance_clause}
                      {near_scope_clause}
                    ORDER BY candidate.geometry::geography <-> source.geometry::geography, candidate.id
                    LIMIT %s
                ) candidates
            ) exact
            ORDER BY exact.distance_m, exact.near_id
            LIMIT %s
        ) ranked
        WHERE source.layer_id = %s::uuid
          {source_scope_clause}
        """,
        tuple(query_parameters),
    )
    feature_count = cur.rowcount
    progress(80, 'Recording output provenance')
    _record_output_history(cur, output_layer_id, created_by)
    warnings = [] if feature_count else ['No candidate features met the Near search criteria.']
    if near_count > candidate_limit:
        warnings.append(
            f'Exact spheroid ranking was refined from the closest {candidate_limit} geography-index candidates per source.'
        )
    progress(92, 'Finalizing output')
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': warnings,
        'metrics': {
            'source_feature_count': source_count,
            'near_feature_count': near_count,
            'nearest_count': parameters['nearest_count'],
            'candidate_limit': candidate_limit,
            'max_distance_m': parameters['max_distance'],
            'exclude_self': parameters['exclude_self'],
            'distance_method': 'PostGIS spheroid geography',
            'candidate_method': 'GiST KNN geography operator',
            'output_geometry': parameters['output_geometry'],
        },
    }


def _execute_polygonize(
    cur,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    progress: Callable[[int, str], None],
) -> dict[str, Any]:
    line_layer_id = parameters['line_layer']
    cur.execute('SELECT id, name, geometry_type FROM layers WHERE id = %s::uuid', (line_layer_id,))
    source = cur.fetchone()
    if not source:
        raise VectorAnalysisError('Input line layer was not found')
    if _resolve_layer_family(cur, dict(source)) != 'line':
        raise VectorAnalysisError('Polygonize requires a line geometry layer')
    scope = environments['scope']
    selected_ids = environments['selected_feature_ids']
    source_count = _count_scoped_features(cur, line_layer_id, scope, selected_ids)

    progress(15, 'Creating polygon and diagnostics schemas')
    output_layer_id = _create_output_layer(
        cur,
        name=parameters['output_name'],
        description=f'Polygons constructed from "{source["name"]}"',
        geometry_type='Polygon',
        created_by=created_by,
        source_layer_id=line_layer_id if parameters['attribute_transfer'] != 'none' else None,
    )
    diagnostic_layer_id: str | None = None
    if parameters['create_diagnostics']:
        diagnostic_layer_id = _create_output_layer(
            cur,
            name=f'{parameters["output_name"]} - Diagnostics',
            description=f'Linework from "{source["name"]}" not consumed by polygon boundaries',
            geometry_type='LineString',
            created_by=created_by,
        )
        cur.execute(
            """
            INSERT INTO layer_fields (layer_id, name, alias, field_type, nullable, length, sort_order)
            VALUES
                (%s::uuid, 'issue_type', 'Topology issue', 'string', FALSE, 32, 0),
                (%s::uuid, 'length_map_units', 'Diagnostic length (degrees)', 'double', FALSE, NULL, 1)
            """,
            (diagnostic_layer_id, diagnostic_layer_id),
        )

    scope_clause = _selected_clause('source', scope)
    prepared_geometry = 'ST_RemoveRepeatedPoints(source.geometry)'
    base_parameters: list[Any] = [line_layer_id]
    if scope == 'selected':
        base_parameters.append(selected_ids)
    if parameters['snap_tolerance'] is not None:
        prepared_geometry = 'ST_RemoveRepeatedPoints(ST_SnapToGrid(source.geometry, %s))'
        base_parameters = [parameters['snap_tolerance'], line_layer_id]
        if scope == 'selected':
            base_parameters.append(selected_ids)

    transfer_join = ''
    transfer_properties = "'{}'::jsonb"
    transfer_parameters: list[Any] = []
    if parameters['attribute_transfer'] != 'none':
        order_expression = (
            'candidate.id'
            if parameters['attribute_transfer'] == 'first_intersecting'
            else 'ST_Length(ST_Intersection(candidate.geometry, ST_Boundary(polygon.geometry))) DESC, candidate.id'
        )
        transfer_join = f"""
            LEFT JOIN LATERAL (
                SELECT candidate.properties
                FROM features candidate
                WHERE candidate.layer_id = %s::uuid
                  AND candidate.geometry && polygon.geometry
                  AND ST_Intersects(candidate.geometry, ST_Boundary(polygon.geometry))
                ORDER BY {order_expression}
                LIMIT 1
            ) transferred ON TRUE
        """
        transfer_parameters.append(line_layer_id)
        transfer_properties = "COALESCE(transferred.properties, '{}'::jsonb)"

    progress(38, 'Noding intersections and polygonizing rings')
    cur.execute(
        f"""
        WITH scoped_lines AS MATERIALIZED (
            SELECT source.id, source.properties, {prepared_geometry} AS geometry
            FROM features source
            WHERE source.layer_id = %s::uuid
              {scope_clause}
              AND source.geometry IS NOT NULL
              AND NOT ST_IsEmpty(source.geometry)
        ), network AS MATERIALIZED (
            SELECT ST_Node(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
            FROM scoped_lines
        ), polygons AS MATERIALIZED (
            SELECT (ST_Dump(ST_Polygonize(geometry))).geom AS geometry
            FROM network
        )
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               polygon.geometry,
               {transfer_properties},
               %s::uuid
        FROM polygons polygon
        {transfer_join}
        WHERE NOT ST_IsEmpty(polygon.geometry)
          AND ST_IsValid(polygon.geometry)
        """,
        tuple(base_parameters + [output_layer_id, created_by] + transfer_parameters),
    )
    feature_count = cur.rowcount
    _record_output_history(cur, output_layer_id, created_by)

    diagnostic_count = 0
    if diagnostic_layer_id:
        progress(68, 'Extracting unconsumed network edges')
        cur.execute(
            f"""
            WITH scoped_lines AS MATERIALIZED (
                SELECT {prepared_geometry} AS geometry
                FROM features source
                WHERE source.layer_id = %s::uuid
                  {scope_clause}
                  AND source.geometry IS NOT NULL
                  AND NOT ST_IsEmpty(source.geometry)
            ), network AS MATERIALIZED (
                SELECT ST_Node(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
                FROM scoped_lines
            ), network_parts AS MATERIALIZED (
                SELECT (ST_Dump(ST_CollectionExtract(geometry, 2))).geom AS geometry
                FROM network
            ), polygons AS MATERIALIZED (
                SELECT (ST_Dump(ST_Polygonize(geometry))).geom AS geometry
                FROM network
            ), unused AS MATERIALIZED (
                SELECT ST_Difference(
                    network.geometry,
                    COALESCE(ST_Boundary(ST_UnaryUnion(ST_Collect(polygons.geometry))), ST_GeomFromText('MULTILINESTRING EMPTY', 4326))
                ) AS geometry
                FROM network LEFT JOIN polygons ON TRUE
                GROUP BY network.geometry
            ), parts AS (
                SELECT (ST_Dump(ST_CollectionExtract(geometry, 2))).geom AS geometry
                FROM unused
            ), classified AS (
                SELECT parts.geometry,
                       CASE
                           WHEN ST_IsClosed(parts.geometry) AND NOT ST_IsRing(parts.geometry)
                               THEN 'invalid_ring'
                           WHEN (
                               SELECT MIN(endpoint_degree)
                               FROM (
                                   SELECT COUNT(*)::integer AS endpoint_degree
                                   FROM (VALUES (ST_StartPoint(parts.geometry)), (ST_EndPoint(parts.geometry))) endpoints(point)
                                   JOIN network_parts segment
                                     ON ST_Equals(ST_StartPoint(segment.geometry), endpoints.point)
                                     OR ST_Equals(ST_EndPoint(segment.geometry), endpoints.point)
                                   GROUP BY endpoints.point
                               ) degrees
                           ) <= 1 THEN 'dangle'
                           ELSE 'cut_edge'
                       END AS issue_type
                FROM parts
                WHERE NOT ST_IsEmpty(parts.geometry) AND ST_Length(parts.geometry) > 0
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid,
                   geometry,
                   jsonb_build_object('issue_type', issue_type, 'length_map_units', ST_Length(geometry)),
                   %s::uuid
            FROM classified
            """,
            tuple(base_parameters + [diagnostic_layer_id, created_by]),
        )
        diagnostic_count = cur.rowcount
        _record_output_history(cur, diagnostic_layer_id, created_by)

    warnings: list[str] = []
    if not feature_count:
        warnings.append('No closed rings formed polygons; inspect the diagnostics layer for gaps and dangles.')
    if diagnostic_count:
        warnings.append(f'{diagnostic_count} dangle, cut-edge, or invalid-ring diagnostic(s) were written.')
    progress(92, 'Finalizing polygonized output')
    output_layer_ids = [output_layer_id] + ([diagnostic_layer_id] if diagnostic_layer_id else [])
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': output_layer_ids,
        'warnings': warnings,
        'metrics': {
            'source_feature_count': source_count,
            'polygon_count': feature_count,
            'diagnostic_count': diagnostic_count,
            'diagnostic_layer_id': diagnostic_layer_id,
            'snap_tolerance_degrees': parameters['snap_tolerance'],
            'attribute_transfer': parameters['attribute_transfer'],
            'intersections_noded': True,
        },
    }


def _execute_geometry_construct(cur, parameters, environments, created_by, progress):
    layer_id = parameters['layer_id']
    cur.execute('SELECT id, name, geometry_type FROM layers WHERE id = %s::uuid', (layer_id,))
    source = cur.fetchone()
    if not source:
        raise VectorAnalysisError('Input layer was not found')
    family = _resolve_layer_family(cur, dict(source))
    operation = parameters['operation']
    if operation in {'polygon_boundary'} and family != 'polygon':
        raise VectorAnalysisError('Polygon Boundary requires polygon input')
    if operation == 'points_along_lines' and family != 'line':
        raise VectorAnalysisError('Points Along Lines requires line input')
    output_family = {
        'interior_point': 'point', 'points_along_lines': 'point', 'polygon_boundary': 'line',
        'convex_hull': 'polygon', 'concave_hull': 'polygon', 'minimum_bounding_geometry': 'polygon',
    }.get(operation, family)
    geometry_types = {'point': 'Point', 'line': 'LineString', 'polygon': 'Polygon'}
    progress(15, 'Creating derived geometry schema')
    output_layer_id = _create_output_layer(
        cur, name=parameters['output_name'], description=f'{operation.replace("_", " ").title()} from "{source["name"]}"',
        geometry_type=geometry_types[output_family], created_by=created_by, source_layer_id=layer_id,
    )
    _inherit_layer_style(cur, output_layer_id, layer_id)
    [source_id_field] = _add_provenance_fields(cur, output_layer_id, [('source_feature_id', 'Source feature ID')])
    scope_clause = _selected_clause('source', environments['scope'])
    expression_parameters: list[Any] = []
    lateral = ''
    geometry_expression = 'source.geometry'
    if operation == 'multipart_to_singlepart':
        lateral = 'CROSS JOIN LATERAL ST_Dump(source.geometry) dumped'
        geometry_expression = 'dumped.geom'
    elif operation == 'interior_point':
        geometry_expression = 'ST_PointOnSurface(source.geometry)'
    elif operation == 'polygon_boundary':
        geometry_expression = 'ST_CollectionExtract(ST_Boundary(source.geometry), 2)'
    elif operation == 'points_along_lines':
        lateral = (
            'CROSS JOIN LATERAL generate_series(0, CEIL('
            'ST_Length(source.geometry::geography) / %s::double precision)::integer) station_index'
        )
        expression_parameters.extend([parameters['interval'], parameters['interval']])
        geometry_expression = (
            'ST_LineInterpolatePoint(source.geometry, LEAST((station_index * %s::double precision) / '
            'NULLIF(ST_Length(source.geometry::geography), 0), 1))'
        )
    elif operation == 'convex_hull':
        geometry_expression = 'ST_CollectionExtract(ST_ConvexHull(source.geometry), 3)'
    elif operation == 'concave_hull':
        geometry_expression = 'ST_CollectionExtract(ST_ConcaveHull(source.geometry, %s, TRUE), 3)'
        expression_parameters.append(parameters['concavity'])
    elif operation == 'minimum_bounding_geometry':
        geometry_expression = 'ST_OrientedEnvelope(source.geometry)'
    query_parameters: list[Any] = [output_layer_id, created_by, *expression_parameters, layer_id]
    if environments['scope'] == 'selected':
        query_parameters.append(environments['selected_feature_ids'])
    progress(42, f'Running {operation.replace("_", " ")}')
    cur.execute(f"""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid, derived.geometry,
               source.properties || jsonb_build_object('{source_id_field}', source.id::text), %s::uuid
        FROM features source
        {lateral}
        CROSS JOIN LATERAL (SELECT {geometry_expression} AS geometry) derived
        WHERE source.layer_id = %s::uuid {scope_clause}
          AND derived.geometry IS NOT NULL AND NOT ST_IsEmpty(derived.geometry)
    """, tuple(query_parameters))
    feature_count = cur.rowcount
    _record_output_history(cur, output_layer_id, created_by)
    progress(92, 'Finalizing constructed geometry')
    return {
        'layer': _serialize_layer(cur, output_layer_id), 'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': [] if feature_count else ['The operation produced no compatible output geometry.'],
        'metrics': {'operation': operation, 'input_geometry_family': family, 'output_geometry_family': output_family},
    }


def _execute_split_lines_at_points(cur, parameters, environments, created_by, progress):
    line_layer_id = parameters['line_layer']
    point_layer_id = parameters['point_layer']
    cur.execute(
        'SELECT id, name, geometry_type FROM layers WHERE id = ANY(%s::uuid[])',
        ([line_layer_id, point_layer_id],),
    )
    layers = {str(row['id']): dict(row) for row in cur.fetchall()}
    if line_layer_id not in layers or point_layer_id not in layers:
        raise VectorAnalysisError('One or more input layers were not found')
    if _resolve_layer_family(cur, layers[line_layer_id]) != 'line':
        raise VectorAnalysisError('line_layer must contain line geometry')
    if _resolve_layer_family(cur, layers[point_layer_id]) != 'point':
        raise VectorAnalysisError('point_layer must contain point geometry')

    progress(15, 'Creating split-line schema')
    output_layer_id = _create_output_layer(
        cur, name=parameters['output_name'],
        description=f'Lines from "{layers[line_layer_id]["name"]}" split at "{layers[point_layer_id]["name"]}"',
        geometry_type='LineString', created_by=created_by, source_layer_id=line_layer_id,
    )
    _inherit_layer_style(cur, output_layer_id, line_layer_id)
    source_id_field, segment_field = _add_provenance_fields(cur, output_layer_id, [
        ('source_feature_id', 'Source line feature ID'), ('segment_index', 'Segment index'),
    ])
    # Segment index is numeric even though provenance fields default to strings.
    cur.execute(
        'UPDATE layer_fields SET field_type = %s, length = NULL WHERE layer_id = %s::uuid AND name = %s',
        ('integer', output_layer_id, segment_field),
    )
    line_scope = environments['scope_a']
    point_scope = environments['scope_b']
    line_scope_clause = _selected_clause('line', line_scope)
    point_scope_clause = _selected_clause('point', point_scope)
    query_parameters: list[Any] = [
        output_layer_id, created_by, point_layer_id, parameters['tolerance'], parameters['tolerance'],
    ]
    if point_scope == 'selected':
        query_parameters.append(environments['selected_feature_ids_b'])
    query_parameters.append(line_layer_id)
    if line_scope == 'selected':
        query_parameters.append(environments['selected_feature_ids_a'])
    progress(42, 'Snapping split points and cutting lines')
    cur.execute(f"""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid, segment.geom,
               line.properties || jsonb_build_object(
                   '{source_id_field}', line.id::text,
                   '{segment_field}', segment.path[1]
               ), %s::uuid
        FROM features line
        LEFT JOIN LATERAL (
            SELECT ST_UnaryUnion(ST_Collect(ST_ClosestPoint(line.geometry, point.geometry))) AS blade
            FROM features point
            WHERE point.layer_id = %s::uuid
              AND line.geometry && ST_Expand(point.geometry, %s / 111320.0)
              AND ST_DWithin(line.geometry::geography, point.geometry::geography, %s)
              {point_scope_clause}
        ) split_points ON TRUE
        CROSS JOIN LATERAL ST_Dump(
            ST_CollectionExtract(
                ST_Split(line.geometry, COALESCE(split_points.blade, ST_GeomFromText('MULTIPOINT EMPTY', 4326))), 2
            )
        ) segment
        WHERE line.layer_id = %s::uuid {line_scope_clause}
          AND NOT ST_IsEmpty(segment.geom)
    """, tuple(query_parameters))
    feature_count = cur.rowcount
    _record_output_history(cur, output_layer_id, created_by)
    warnings = [] if feature_count else ['No line segments were produced.']
    progress(92, 'Finalizing split lines')
    return {
        'layer': _serialize_layer(cur, output_layer_id), 'count': feature_count,
        'output_layer_ids': [output_layer_id], 'warnings': warnings,
        'metrics': {'tolerance_m': parameters['tolerance'], 'output_segment_count': feature_count},
    }


def _prepare_merged_schema(cur, layer_a: str, layer_b: str, output_layer_id: str, strategy: str) -> set[str]:
    cur.execute(
        """SELECT layer_id::text AS layer_id, name, alias, field_type, nullable, length, precision, scale, sort_order
           FROM layer_fields WHERE layer_id = ANY(%s::uuid[]) ORDER BY sort_order, created_at""",
        ([layer_a, layer_b],),
    )
    rows = [dict(row) for row in cur.fetchall()]
    fields_a = {row['name']: row for row in rows if row['layer_id'] == layer_a}
    fields_b = {row['name']: row for row in rows if row['layer_id'] == layer_b}
    output_names = set(fields_a)
    if strategy == 'intersection':
        output_names &= set(fields_b)
        cur.execute(
            'DELETE FROM layer_fields WHERE layer_id = %s::uuid AND NOT (name = ANY(%s::text[]))',
            (output_layer_id, sorted(output_names)),
        )
    else:
        for name, field_definition in fields_b.items():
            if name in output_names:
                continue
            output_names.add(name)
            cur.execute(
                """INSERT INTO layer_fields
                   (layer_id, name, alias, field_type, nullable, length, precision, scale, sort_order)
                   VALUES (%s::uuid, %s, %s, %s, TRUE, %s, %s, %s, %s)""",
                (
                    output_layer_id, name, field_definition.get('alias'), field_definition['field_type'],
                    field_definition.get('length'), field_definition.get('precision'), field_definition.get('scale'),
                    10_000 + (field_definition.get('sort_order') or 0),
                ),
            )
    for name in output_names & set(fields_a) & set(fields_b):
        if fields_a[name]['field_type'] != fields_b[name]['field_type']:
            cur.execute(
                """UPDATE layer_fields SET field_type = 'string', domain_id = NULL,
                   alias = COALESCE(alias, %s), length = NULL, precision = NULL, scale = NULL
                   WHERE layer_id = %s::uuid AND name = %s""",
                (name, output_layer_id, name),
            )
    return output_names


def _execute_merge_layers(cur, parameters, environments, created_by, progress):
    layer_a, layer_b = parameters['layer_a'], parameters['layer_b']
    cur.execute(
        'SELECT id, name, geometry_type FROM layers WHERE id = ANY(%s::uuid[])', ([layer_a, layer_b],),
    )
    layers = {str(row['id']): dict(row) for row in cur.fetchall()}
    if layer_a not in layers or layer_b not in layers:
        raise VectorAnalysisError('One or more input layers were not found')
    family_a = _resolve_layer_family(cur, layers[layer_a])
    family_b = _resolve_layer_family(cur, layers[layer_b])
    if family_a != family_b:
        raise VectorAnalysisError('Merge Layers requires matching geometry families')
    geometry_type = {'point': 'Point', 'line': 'LineString', 'polygon': 'Polygon'}[family_a]
    progress(15, 'Reconciling merged field schema')
    output_layer_id = _create_output_layer(
        cur, name=parameters['output_name'],
        description=f'Merged "{layers[layer_a]["name"]}" and "{layers[layer_b]["name"]}"',
        geometry_type=geometry_type, created_by=created_by, source_layer_id=layer_a,
    )
    _inherit_layer_style(cur, output_layer_id, layer_a)
    output_fields = _prepare_merged_schema(cur, layer_a, layer_b, output_layer_id, parameters['schema_strategy'])
    source_layer_field, source_feature_field = _add_provenance_fields(cur, output_layer_id, [
        ('source_layer_id', 'Source layer ID'), ('source_feature_id', 'Source feature ID'),
    ])
    scope_a, scope_b = environments['scope_a'], environments['scope_b']
    query_parameters: list[Any] = [
        output_layer_id, sorted(output_fields), source_layer_field, source_feature_field,
        created_by, layer_a,
    ]
    if scope_a == 'selected':
        query_parameters.append(environments['selected_feature_ids_a'])
    query_parameters.append(layer_b)
    if scope_b == 'selected':
        query_parameters.append(environments['selected_feature_ids_b'])
    progress(44, 'Appending compatible features')
    cur.execute(f"""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid, source.geometry,
               (SELECT COALESCE(jsonb_object_agg(item.key, item.value), '{{}}'::jsonb)
                FROM jsonb_each(source.properties) item WHERE item.key = ANY(%s::text[]))
               || jsonb_build_object(%s, source.layer_id::text, %s, source.id::text),
               %s::uuid
        FROM features source
        WHERE (source.layer_id = %s::uuid {_selected_clause('source', scope_a)})
           OR (source.layer_id = %s::uuid {_selected_clause('source', scope_b)})
    """, tuple(query_parameters))
    feature_count = cur.rowcount
    _record_output_history(cur, output_layer_id, created_by)
    progress(92, 'Finalizing merged layer')
    return {
        'layer': _serialize_layer(cur, output_layer_id), 'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': [] if feature_count else ['The merged output is empty.'],
        'metrics': {'schema_strategy': parameters['schema_strategy'], 'output_field_count': len(output_fields), 'geometry_family': family_a},
    }


def _execute_reproject(cur, parameters, environments, created_by, progress):
    layer_id = parameters['layer_id']
    cur.execute('SELECT id, name, geometry_type FROM layers WHERE id = %s::uuid', (layer_id,))
    source = cur.fetchone()
    if not source:
        raise VectorAnalysisError('Input layer was not found')
    family = _resolve_layer_family(cur, dict(source))
    source_srid = int(parameters['source_crs'].split(':')[1])
    progress(15, 'Creating normalized output schema')
    output_layer_id = _create_output_layer(
        cur, name=parameters['output_name'], description=f'Reprojected from EPSG:{source_srid} to EPSG:4326',
        geometry_type={'point': 'Point', 'line': 'LineString', 'polygon': 'Polygon'}[family],
        created_by=created_by, source_layer_id=layer_id,
    )
    _inherit_layer_style(cur, output_layer_id, layer_id)
    [source_id_field] = _add_provenance_fields(cur, output_layer_id, [('source_feature_id', 'Source feature ID')])
    scope_clause = _selected_clause('source', environments['scope'])
    query_parameters: list[Any] = [output_layer_id, source_srid, source_id_field, created_by, layer_id]
    if environments['scope'] == 'selected':
        query_parameters.append(environments['selected_feature_ids'])
    progress(45, f'Transforming EPSG:{source_srid} coordinates to EPSG:4326')
    cur.execute(f"""
        INSERT INTO features (layer_id, geometry, properties, created_by)
        SELECT %s::uuid,
               ST_Force2D(ST_Transform(ST_SetSRID(source.geometry, %s), 4326)),
               source.properties || jsonb_build_object(%s, source.id::text), %s::uuid
        FROM features source
        WHERE source.layer_id = %s::uuid {scope_clause}
    """, tuple(query_parameters))
    feature_count = cur.rowcount
    _record_output_history(cur, output_layer_id, created_by)
    progress(92, 'Finalizing normalized layer')
    return {
        'layer': _serialize_layer(cur, output_layer_id), 'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': ['This operation reinterprets stored coordinate numbers in the declared source CRS.'] if source_srid != 4326 else [],
        'metrics': {'source_crs': f'EPSG:{source_srid}', 'output_crs': 'EPSG:4326'},
    }


def _add_generated_fields(cur, output_layer_id: str, definitions: list[tuple[str, str, str]]) -> dict[str, str]:
    cur.execute('SELECT name FROM layer_fields WHERE layer_id = %s::uuid', (output_layer_id,))
    used = {row['name'] for row in cur.fetchall()}
    mapped: dict[str, str] = {}
    for index, (name, alias, field_type) in enumerate(definitions):
        output_name = _bounded_identifier('', name, used)
        mapped[name] = output_name
        cur.execute(
            """INSERT INTO layer_fields (layer_id, name, alias, field_type, nullable, sort_order)
               VALUES (%s::uuid, %s, %s, %s, TRUE, %s)""",
            (output_layer_id, output_name, alias, field_type, 100_000 + index),
        )
    return mapped


def _execute_geometry_quality(cur, parameters, environments, created_by, progress):
    layer_id, operation = parameters['layer_id'], parameters['operation']
    cur.execute('SELECT id, name, geometry_type FROM layers WHERE id = %s::uuid', (layer_id,))
    source = cur.fetchone()
    if not source:
        raise VectorAnalysisError('Input layer was not found')
    family = _resolve_layer_family(cur, dict(source))
    if operation in {'eliminate_slivers', 'aggregate_polygons'} and family != 'polygon':
        raise VectorAnalysisError(f'{operation.replace("_", " ").title()} requires polygon input')
    if operation == 'smooth' and family == 'point':
        raise VectorAnalysisError('Smooth requires line or polygon input')
    geometry_type = {'point': 'Point', 'line': 'LineString', 'polygon': 'Polygon'}[family]
    clone_schema = operation != 'aggregate_polygons'
    progress(15, 'Creating quality-result schema')
    output_layer_id = _create_output_layer(
        cur, name=parameters['output_name'],
        description=f'{operation.replace("_", " ").title()} result for "{source["name"]}"',
        geometry_type=geometry_type, created_by=created_by,
        source_layer_id=layer_id if clone_schema else None,
    )
    if clone_schema:
        _inherit_layer_style(cur, output_layer_id, layer_id)
    generated = _add_generated_fields(cur, output_layer_id, [('source_feature_id', 'Source feature ID', 'string')])
    if operation == 'check':
        generated.update(_add_generated_fields(cur, output_layer_id, [
            ('is_valid', 'Geometry is valid', 'boolean'), ('validity_reason', 'Validity reason', 'string'),
        ]))
    elif operation == 'detect_duplicates':
        generated.update(_add_generated_fields(cur, output_layer_id, [
            ('duplicate_count', 'Duplicate geometry count', 'integer'), ('duplicate_rank', 'Duplicate rank', 'integer'),
        ]))
    elif operation == 'aggregate_polygons':
        generated.update(_add_generated_fields(cur, output_layer_id, [('member_count', 'Aggregated feature count', 'integer')]))
    scope_clause = _selected_clause('source', environments['scope'])
    scope_parameters: list[Any] = [layer_id]
    if environments['scope'] == 'selected':
        scope_parameters.append(environments['selected_feature_ids'])

    progress(42, f'Running {operation.replace("_", " ")}')
    query_parameters: list[Any]
    if operation == 'check':
        issue_clause = 'AND NOT ST_IsValid(source.geometry)' if parameters['only_issues'] else ''
        query_parameters = [output_layer_id, generated['source_feature_id'], generated['is_valid'], generated['validity_reason'], created_by] + scope_parameters
        cur.execute(f"""
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, source.geometry,
                   source.properties || jsonb_build_object(
                       %s, source.id::text, %s, ST_IsValid(source.geometry), %s, ST_IsValidReason(source.geometry)
                   ), %s::uuid
            FROM features source WHERE source.layer_id = %s::uuid {scope_clause} {issue_clause}
        """, tuple(query_parameters))
    elif operation == 'detect_duplicates':
        issue_clause = 'WHERE duplicate_count > 1' if parameters['only_issues'] else ''
        query_parameters = scope_parameters + [output_layer_id, generated['source_feature_id'], generated['duplicate_count'], generated['duplicate_rank'], created_by]
        cur.execute(f"""
            WITH fingerprinted AS MATERIALIZED (
                SELECT source.*,
                       COUNT(*) OVER (PARTITION BY ST_AsEWKB(ST_Normalize(source.geometry)))::integer AS duplicate_count,
                       ROW_NUMBER() OVER (PARTITION BY ST_AsEWKB(ST_Normalize(source.geometry)) ORDER BY source.id)::integer AS duplicate_rank
                FROM features source WHERE source.layer_id = %s::uuid {scope_clause}
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, geometry,
                   properties || jsonb_build_object(%s, id::text, %s, duplicate_count, %s, duplicate_rank),
                   %s::uuid FROM fingerprinted {issue_clause}
        """, tuple(query_parameters))
    elif operation == 'aggregate_polygons':
        query_parameters = scope_parameters + [parameters['tolerance'], output_layer_id, generated['source_feature_id'], generated['member_count'], created_by]
        cur.execute(f"""
            WITH scoped AS MATERIALIZED (
                SELECT source.* FROM features source WHERE source.layer_id = %s::uuid {scope_clause}
            ), clustered AS MATERIALIZED (
                SELECT *, ST_ClusterDBSCAN(geometry, eps := %s, minpoints := 1) OVER () AS cluster_id FROM scoped
            ), grouped AS (
                SELECT cluster_id, MIN(id::text) AS source_id, COUNT(*)::integer AS member_count,
                       ST_UnaryUnion(ST_Collect(geometry)) AS geometry FROM clustered GROUP BY cluster_id
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, geometry, jsonb_build_object(%s, source_id, %s, member_count), %s::uuid FROM grouped
        """, tuple(query_parameters))
    elif operation == 'eliminate_slivers':
        query_parameters = scope_parameters + [parameters['area_threshold'], output_layer_id, generated['source_feature_id'], created_by]
        cur.execute(f"""
            WITH scoped AS MATERIALIZED (
                SELECT source.* FROM features source WHERE source.layer_id = %s::uuid {scope_clause}
            ), classified AS MATERIALIZED (
                SELECT *, ST_Area(geometry::geography) < %s AS is_sliver FROM scoped
            ), assignments AS MATERIALIZED (
                SELECT sliver.id AS sliver_id, target.id AS target_id, sliver.geometry
                FROM classified sliver
                LEFT JOIN LATERAL (
                    SELECT candidate.id FROM classified candidate
                    WHERE NOT candidate.is_sliver AND candidate.geometry && sliver.geometry
                      AND ST_Touches(candidate.geometry, sliver.geometry)
                    ORDER BY ST_Length(ST_Intersection(ST_Boundary(candidate.geometry), ST_Boundary(sliver.geometry))) DESC, candidate.id
                    LIMIT 1
                ) target ON TRUE WHERE sliver.is_sliver
            ), outputs AS (
                SELECT retained.id, retained.properties,
                       ST_UnaryUnion(ST_Collect(retained.geometry, ST_Collect(assignments.geometry))) AS geometry
                FROM classified retained LEFT JOIN assignments ON assignments.target_id = retained.id
                WHERE NOT retained.is_sliver GROUP BY retained.id, retained.properties, retained.geometry
                UNION ALL
                SELECT sliver.id, sliver.properties, sliver.geometry FROM classified sliver
                WHERE sliver.is_sliver AND NOT EXISTS (
                    SELECT 1 FROM assignments WHERE assignments.sliver_id = sliver.id AND assignments.target_id IS NOT NULL
                )
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, geometry, properties || jsonb_build_object(%s, id::text), %s::uuid FROM outputs
        """, tuple(query_parameters))
    else:
        family_dimension = {'point': 1, 'line': 2, 'polygon': 3}[family]
        geometry_expression = {
            'repair': f'ST_CollectionExtract(ST_MakeValid(source.geometry), {family_dimension})',
            'snap_integrate': 'ST_Snap(source.geometry, network.geometry, %s)',
            'simplify': 'ST_SimplifyPreserveTopology(source.geometry, %s)',
            'smooth': 'ST_ChaikinSmoothing(source.geometry, %s, TRUE)',
            'densify': 'ST_Segmentize(source.geometry::geography, %s)::geometry',
        }[operation]
        expression_parameters: list[Any] = []
        if operation in {'snap_integrate', 'simplify', 'densify'}:
            expression_parameters.append(parameters['tolerance'])
        elif operation == 'smooth':
            expression_parameters.append(parameters['iterations'])
        network_cte = (
            f"WITH scoped AS MATERIALIZED (SELECT source.* FROM features source WHERE source.layer_id = %s::uuid {scope_clause}), "
            "network AS MATERIALIZED (SELECT ST_UnaryUnion(ST_Collect(geometry)) AS geometry FROM scoped) "
            if operation == 'snap_integrate' else ''
        )
        source_from = 'scoped source CROSS JOIN network' if operation == 'snap_integrate' else 'features source'
        where_clause = '' if operation == 'snap_integrate' else f'WHERE source.layer_id = %s::uuid {scope_clause}'
        if operation == 'snap_integrate':
            query_parameters = scope_parameters + [output_layer_id, generated['source_feature_id'], created_by] + expression_parameters
        else:
            query_parameters = [output_layer_id, generated['source_feature_id'], created_by] + expression_parameters + scope_parameters
        cur.execute(f"""
            {network_cte}
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, derived.geometry,
                   source.properties || jsonb_build_object(%s, source.id::text), %s::uuid
            FROM {source_from}
            CROSS JOIN LATERAL (SELECT {geometry_expression} AS geometry) derived
            {where_clause}
            {'AND' if where_clause else 'WHERE'} derived.geometry IS NOT NULL AND NOT ST_IsEmpty(derived.geometry)
        """, tuple(query_parameters))
    feature_count = cur.rowcount
    _record_output_history(cur, output_layer_id, created_by)
    warnings = [] if feature_count else ['The quality operation produced an empty result layer.']
    progress(92, 'Finalizing geometry-quality result')
    return {
        'layer': _serialize_layer(cur, output_layer_id), 'count': feature_count,
        'output_layer_ids': [output_layer_id], 'warnings': warnings,
        'metrics': {'operation': operation, 'input_geometry_family': family, 'output_feature_count': feature_count},
    }


def _execute_topology_validate(cur, parameters, environments, created_by, progress):
    polygon_layer = parameters['polygon_layer']
    input_ids = [polygon_layer] + ([parameters['coverage_layer']] if parameters['coverage_layer'] else [])
    cur.execute('SELECT id, name, geometry_type FROM layers WHERE id = ANY(%s::uuid[])', (input_ids,))
    layers = {str(row['id']): dict(row) for row in cur.fetchall()}
    if any(layer_id not in layers for layer_id in input_ids):
        raise VectorAnalysisError('One or more topology input layers were not found')
    for layer_id in input_ids:
        if _resolve_layer_family(cur, layers[layer_id]) != 'polygon':
            raise VectorAnalysisError('Topology validation requires polygon inputs')
    progress(15, 'Creating topology diagnostics schema')
    output_layer_id = _create_output_layer(
        cur, name=parameters['output_name'],
        description=f'Topology diagnostics for "{layers[polygon_layer]["name"]}"',
        geometry_type='Polygon', created_by=created_by,
    )
    fields = _add_generated_fields(cur, output_layer_id, [
        ('issue_type', 'Topology issue', 'string'), ('source_a_id', 'First source feature ID', 'string'),
        ('source_b_id', 'Second source feature ID', 'string'), ('area_sqm', 'Issue area (square metres)', 'double'),
    ])
    scope_a = environments['scope_a']
    source_scope_clause = _selected_clause('source', scope_a)
    total_count = 0
    checks = parameters['checks']
    progress(38, 'Evaluating polygon topology')
    if 'overlaps' in checks:
        query_parameters: list[Any] = [
            output_layer_id, fields['issue_type'], fields['source_a_id'], fields['source_b_id'], fields['area_sqm'],
            created_by, polygon_layer,
        ]
        if scope_a == 'selected':
            query_parameters.append(environments['selected_feature_ids_a'])
        query_parameters.append(polygon_layer)
        if scope_a == 'selected':
            query_parameters.append(environments['selected_feature_ids_a'])
        cur.execute(f"""
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, overlap.geometry,
                   jsonb_build_object(%s, 'overlap', %s, source.id::text, %s, candidate.id::text,
                                      %s, ST_Area(overlap.geometry::geography)), %s::uuid
            FROM features source JOIN features candidate
              ON candidate.layer_id = %s::uuid AND source.id < candidate.id
             AND source.geometry && candidate.geometry AND ST_Overlaps(source.geometry, candidate.geometry)
             {_selected_clause('candidate', scope_a)}
            CROSS JOIN LATERAL (SELECT ST_CollectionExtract(ST_Intersection(source.geometry, candidate.geometry), 3) AS geometry) overlap
            WHERE source.layer_id = %s::uuid {source_scope_clause}
              AND NOT ST_IsEmpty(overlap.geometry)
        """, tuple(query_parameters))
        total_count += cur.rowcount
    if 'gaps' in checks:
        coverage_layer = parameters['coverage_layer']
        scope_b = environments['scope_b']
        query_parameters = [polygon_layer]
        if scope_a == 'selected':
            query_parameters.append(environments['selected_feature_ids_a'])
        query_parameters.append(coverage_layer)
        if scope_b == 'selected':
            query_parameters.append(environments['selected_feature_ids_b'])
        query_parameters.extend([
            output_layer_id, fields['issue_type'], fields['source_a_id'], fields['source_b_id'], fields['area_sqm'], created_by,
        ])
        cur.execute(f"""
            WITH data_coverage AS MATERIALIZED (
                SELECT ST_UnaryUnion(ST_Collect(source.geometry)) AS geometry FROM features source
                WHERE source.layer_id = %s::uuid {source_scope_clause}
            ), expected_coverage AS MATERIALIZED (
                SELECT ST_UnaryUnion(ST_Collect(coverage.geometry)) AS geometry FROM features coverage
                WHERE coverage.layer_id = %s::uuid {_selected_clause('coverage', scope_b)}
            ), gaps AS (
                SELECT (ST_Dump(ST_CollectionExtract(ST_Difference(expected_coverage.geometry, data_coverage.geometry), 3))).geom AS geometry
                FROM expected_coverage CROSS JOIN data_coverage
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, geometry,
                   jsonb_build_object(%s, 'gap', %s, NULL, %s, NULL, %s, ST_Area(geometry::geography)), %s::uuid
            FROM gaps WHERE NOT ST_IsEmpty(geometry)
        """, tuple(query_parameters))
        total_count += cur.rowcount
    if 'slivers' in checks:
        query_parameters = [
            output_layer_id, fields['issue_type'], fields['source_a_id'], fields['source_b_id'], fields['area_sqm'],
            created_by, polygon_layer,
        ]
        if scope_a == 'selected':
            query_parameters.append(environments['selected_feature_ids_a'])
        query_parameters.append(parameters['sliver_area'])
        cur.execute(f"""
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, source.geometry,
                   jsonb_build_object(%s, 'sliver', %s, source.id::text, %s, NULL,
                                      %s, ST_Area(source.geometry::geography)), %s::uuid
            FROM features source WHERE source.layer_id = %s::uuid {source_scope_clause}
              AND ST_Area(source.geometry::geography) < %s
        """, tuple(query_parameters))
        total_count += cur.rowcount
    _record_output_history(cur, output_layer_id, created_by)
    progress(92, 'Finalizing topology diagnostics')
    return {
        'layer': _serialize_layer(cur, output_layer_id), 'count': total_count,
        'output_layer_ids': [output_layer_id],
        'warnings': [] if total_count else ['No requested topology issues were detected.'],
        'metrics': {'checks': checks, 'issue_count': total_count, 'coverage_layer_id': parameters['coverage_layer']},
    }


def _execute_spatial_statistics(cur, parameters, environments, created_by, progress):
    layer_id, operation = parameters['layer_id'], parameters['operation']
    cur.execute('SELECT id, name, geometry_type FROM layers WHERE id = %s::uuid', (layer_id,))
    source = cur.fetchone()
    if not source:
        raise VectorAnalysisError('Input layer was not found')
    family = _resolve_layer_family(cur, dict(source))
    value_field = parameters['value_field']
    if value_field:
        cur.execute(
            'SELECT name, field_type FROM layer_fields WHERE layer_id = %s::uuid AND name = %s',
            (layer_id, value_field),
        )
        field_definition = cur.fetchone()
        if not field_definition or field_definition['field_type'] not in {'integer', 'double'}:
            raise VectorAnalysisError(f'Analysis field must be numeric: {value_field}')
    output_family = family if operation in {'central_feature', 'hot_spot'} else (
        'polygon' if operation in {'standard_distance', 'directional_distribution'} else 'point'
    )
    clone_schema = operation in {'central_feature', 'hot_spot'}
    progress(15, 'Creating spatial-statistics schema')
    output_layer_id = _create_output_layer(
        cur, name=parameters['output_name'], description=f'{operation.replace("_", " ").title()} for "{source["name"]}"',
        geometry_type={'point': 'Point', 'line': 'LineString', 'polygon': 'Polygon'}[output_family],
        created_by=created_by, source_layer_id=layer_id if clone_schema else None,
    )
    if clone_schema:
        _inherit_layer_style(cur, output_layer_id, layer_id)
    statistic_definitions: dict[str, list[tuple[str, str, str]]] = {
        'mean_center': [('feature_count', 'Input feature count', 'integer')],
        'median_center': [('feature_count', 'Input feature count', 'integer')],
        'central_feature': [('source_feature_id', 'Central source feature ID', 'string'), ('total_distance_m', 'Total distance to all features', 'double')],
        'standard_distance': [('feature_count', 'Input feature count', 'integer'), ('radius_m', 'Standard distance radius (metres)', 'double')],
        'directional_distribution': [('feature_count', 'Input feature count', 'integer'), ('major_axis_m', 'Major semi-axis (metres)', 'double'), ('minor_axis_m', 'Minor semi-axis (metres)', 'double'), ('rotation_deg', 'Ellipse rotation (degrees)', 'double')],
        'nearest_neighbor': [('feature_count', 'Input feature count', 'integer'), ('observed_mean_m', 'Observed mean nearest distance', 'double'), ('expected_mean_m', 'Expected random mean distance', 'double'), ('nn_ratio', 'Nearest-neighbor ratio', 'double'), ('z_score', 'Nearest-neighbor z-score', 'double')],
        'spatial_autocorrelation': [('feature_count', 'Input feature count', 'integer'), ('moran_i', "Global Moran's I", 'double'), ('expected_i', 'Expected Moran I', 'double'), ('neighbor_links', 'Neighbor links', 'integer')],
        'hot_spot': [('source_feature_id', 'Source feature ID', 'string'), ('gi_z_score', 'Getis-Ord Gi* z-score', 'double'), ('hot_spot_class', 'Hot/cold spot class', 'string'), ('neighbor_count', 'Neighbor count', 'integer')],
    }
    fields = _add_generated_fields(cur, output_layer_id, statistic_definitions[operation])
    scope_clause = _selected_clause('source', environments['scope'])
    scope_parameters: list[Any] = [layer_id]
    if environments['scope'] == 'selected':
        scope_parameters.append(environments['selected_feature_ids'])
    representative = 'ST_PointOnSurface(source.geometry)'
    points_cte = f"""
        scoped AS MATERIALIZED (
            SELECT source.id, source.geometry, source.properties, {representative} AS point
            FROM features source WHERE source.layer_id = %s::uuid {scope_clause}
        )
    """
    progress(42, f'Calculating {operation.replace("_", " ")}')
    if operation in {'mean_center', 'median_center'}:
        center_expression = (
            'ST_Transform(ST_Centroid(ST_Collect(ST_Transform(point, 3857))), 4326)'
            if operation == 'mean_center'
            else 'ST_Transform(ST_GeometricMedian(ST_Collect(ST_Transform(point, 3857))), 4326)'
        )
        query_parameters = scope_parameters + [output_layer_id, fields['feature_count'], created_by]
        cur.execute(f"""
            WITH {points_cte}, result AS (
                SELECT {center_expression} AS geometry, COUNT(*)::integer AS feature_count FROM scoped
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, geometry, jsonb_build_object(%s, feature_count), %s::uuid
            FROM result WHERE geometry IS NOT NULL
        """, tuple(query_parameters))
    elif operation == 'central_feature':
        query_parameters = scope_parameters + [output_layer_id, fields['source_feature_id'], fields['total_distance_m'], created_by]
        cur.execute(f"""
            WITH {points_cte}, scored AS (
                SELECT candidate.id, candidate.geometry, candidate.properties,
                       SUM(ST_Distance(candidate.point::geography, other.point::geography)) AS total_distance
                FROM scoped candidate CROSS JOIN scoped other
                GROUP BY candidate.id, candidate.geometry, candidate.properties
                ORDER BY total_distance, candidate.id LIMIT 1
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, geometry,
                   properties || jsonb_build_object(%s, id::text, %s, total_distance), %s::uuid FROM scored
        """, tuple(query_parameters))
    elif operation == 'standard_distance':
        query_parameters = scope_parameters + [parameters['standard_deviations'], output_layer_id, fields['feature_count'], fields['radius_m'], created_by]
        cur.execute(f"""
            WITH {points_cte}, center AS (
                SELECT ST_Transform(ST_Centroid(ST_Collect(ST_Transform(point, 3857))), 4326) AS geometry,
                       COUNT(*)::integer AS feature_count FROM scoped
            ), radius AS (
                SELECT center.geometry, center.feature_count,
                       SQRT(AVG(POWER(ST_Distance(scoped.point::geography, center.geometry::geography), 2))) * %s AS radius_m
                FROM center CROSS JOIN scoped GROUP BY center.geometry, center.feature_count
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, ST_Buffer(geometry::geography, radius_m)::geometry,
                   jsonb_build_object(%s, feature_count, %s, radius_m), %s::uuid FROM radius
            WHERE radius_m IS NOT NULL
        """, tuple(query_parameters))
    elif operation == 'directional_distribution':
        query_parameters = scope_parameters + [parameters['standard_deviations'], parameters['standard_deviations'], output_layer_id, fields['feature_count'], fields['major_axis_m'], fields['minor_axis_m'], fields['rotation_deg'], created_by]
        cur.execute(f"""
            WITH {points_cte}, projected AS (
                SELECT id, ST_Transform(point, 3857) AS point FROM scoped
            ), moments AS (
                SELECT COUNT(*)::integer AS n, AVG(ST_X(point)) AS mx, AVG(ST_Y(point)) AS my,
                       VAR_POP(ST_X(point)) AS var_x, VAR_POP(ST_Y(point)) AS var_y,
                       COVAR_POP(ST_X(point), ST_Y(point)) AS covariance FROM projected
            ), axes AS (
                SELECT *, 0.5 * ATAN2(2 * covariance, var_x - var_y) AS angle,
                       SQRT(GREATEST(0, (var_x + var_y + SQRT(POWER(var_x-var_y,2)+4*POWER(covariance,2))) / 2)) * %s AS major_axis,
                       SQRT(GREATEST(0, (var_x + var_y - SQRT(POWER(var_x-var_y,2)+4*POWER(covariance,2))) / 2)) * %s AS minor_axis
                FROM moments
            ), ellipse AS (
                SELECT *, ST_SetSRID(ST_MakePoint(mx, my), 3857) AS center FROM axes
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid,
                   ST_Transform(
                       ST_SetSRID(ST_Translate(
                           ST_Rotate(ST_Scale(ST_Buffer(ST_MakePoint(0, 0), 1, 64), major_axis, minor_axis), angle),
                           mx, my
                       ), 3857),
                       4326
                   ),
                   jsonb_build_object(%s, n, %s, major_axis, %s, minor_axis, %s, DEGREES(angle)), %s::uuid
            FROM ellipse WHERE n > 1 AND major_axis > 0 AND minor_axis > 0
        """, tuple(query_parameters))
    elif operation == 'nearest_neighbor':
        query_parameters = scope_parameters + [output_layer_id, fields['feature_count'], fields['observed_mean_m'], fields['expected_mean_m'], fields['nn_ratio'], fields['z_score'], created_by]
        cur.execute(f"""
            WITH {points_cte}, nearest AS (
                SELECT source.id,
                       ST_Distance(source.point::geography, candidate.point::geography) AS distance_m
                FROM scoped source CROSS JOIN LATERAL (
                    SELECT near.point FROM scoped near WHERE near.id <> source.id
                    ORDER BY near.point <-> source.point, near.id LIMIT 1
                ) candidate
            ), summary AS (
                SELECT (SELECT COUNT(*)::integer FROM nearest) AS n,
                       (SELECT AVG(distance_m) FROM nearest) AS observed,
                       ST_Area(ST_ConvexHull(ST_Collect(point))::geography) AS study_area,
                       ST_Centroid(ST_Collect(point)) AS center FROM scoped
            ), statistic AS (
                SELECT *, 0.5 / SQRT(n / NULLIF(study_area, 0)) AS expected,
                       0.26136 / SQRT(POWER(n, 2) / NULLIF(study_area, 0)) AS standard_error FROM summary
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, center,
                   jsonb_build_object(%s, n, %s, observed, %s, expected, %s, observed/NULLIF(expected,0),
                                      %s, (observed-expected)/NULLIF(standard_error,0)), %s::uuid
            FROM statistic WHERE n > 1
        """, tuple(query_parameters))
    elif operation == 'spatial_autocorrelation':
        query_parameters = scope_parameters + [parameters['distance_band'], parameters['distance_band'], output_layer_id, fields['feature_count'], fields['moran_i'], fields['expected_i'], fields['neighbor_links'], created_by]
        cur.execute(f"""
            WITH {points_cte}, valued AS MATERIALIZED (
                SELECT *, (properties ->> {repr(value_field)})::double precision AS value FROM scoped
                WHERE jsonb_typeof(properties -> {repr(value_field)}) = 'number'
            ), stats AS (SELECT COUNT(*)::double precision AS n, AVG(value) AS mean FROM valued),
            links AS MATERIALIZED (
                SELECT a.id AS a_id, b.id AS b_id, a.value AS a_value, b.value AS b_value
                FROM valued a JOIN valued b ON a.id <> b.id AND a.point && ST_Expand(b.point, %s / 111320.0)
                 AND ST_DWithin(a.point::geography, b.point::geography, %s)
            ), result AS (
                SELECT stats.n::integer AS n, COUNT(*)::integer AS w,
                       (stats.n / NULLIF(COUNT(*),0)) *
                       SUM((a_value-stats.mean)*(b_value-stats.mean)) /
                       NULLIF((SELECT SUM(POWER(value-stats.mean,2)) FROM valued),0) AS moran_i,
                       -1 / NULLIF(stats.n-1,0) AS expected_i,
                       (SELECT ST_Centroid(ST_Collect(point)) FROM valued) AS center
                FROM links CROSS JOIN stats GROUP BY stats.n, stats.mean
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, center, jsonb_build_object(%s,n,%s,moran_i,%s,expected_i,%s,w), %s::uuid FROM result
            WHERE center IS NOT NULL
        """, tuple(query_parameters))
    else:
        query_parameters = scope_parameters + [parameters['distance_band'], parameters['distance_band'], output_layer_id, fields['source_feature_id'], fields['gi_z_score'], fields['hot_spot_class'], fields['neighbor_count'], created_by]
        cur.execute(f"""
            WITH {points_cte}, valued AS MATERIALIZED (
                SELECT *, (properties ->> {repr(value_field)})::double precision AS value FROM scoped
                WHERE jsonb_typeof(properties -> {repr(value_field)}) = 'number'
            ), global_stats AS (
                SELECT COUNT(*)::double precision AS n, AVG(value) AS mean, STDDEV_POP(value) AS stddev FROM valued
            ), scored AS (
                SELECT source.*, neighbors.neighbor_count,
                       (neighbors.local_sum - neighbors.neighbor_count * global_stats.mean) /
                       NULLIF(global_stats.stddev * SQRT((global_stats.n * neighbors.neighbor_count - POWER(neighbors.neighbor_count,2)) / NULLIF(global_stats.n-1,0)),0) AS z_score
                FROM valued source CROSS JOIN global_stats CROSS JOIN LATERAL (
                    SELECT COUNT(*)::double precision AS neighbor_count, SUM(candidate.value) AS local_sum
                    FROM valued candidate
                    WHERE source.point && ST_Expand(candidate.point, %s / 111320.0)
                      AND ST_DWithin(source.point::geography, candidate.point::geography, %s)
                ) neighbors
            )
            INSERT INTO features (layer_id, geometry, properties, created_by)
            SELECT %s::uuid, geometry,
                   properties || jsonb_build_object(%s,id::text,%s,z_score,%s,
                       CASE WHEN z_score >= 2.58 THEN 'hot_99' WHEN z_score >= 1.96 THEN 'hot_95'
                            WHEN z_score <= -2.58 THEN 'cold_99' WHEN z_score <= -1.96 THEN 'cold_95' ELSE 'not_significant' END,
                       %s,neighbor_count::integer), %s::uuid FROM scored
        """, tuple(query_parameters))
    feature_count = cur.rowcount
    _record_output_history(cur, output_layer_id, created_by)
    warnings = [] if feature_count else ['The statistic could not be calculated from the available features.']
    if operation in {'central_feature', 'spatial_autocorrelation', 'hot_spot'}:
        warnings.append('This statistic can be expensive for dense layers; use a selected or filtered scope for exploratory runs.')
    progress(92, 'Finalizing spatial-statistics result')
    return {
        'layer': _serialize_layer(cur, output_layer_id), 'count': feature_count,
        'output_layer_ids': [output_layer_id], 'warnings': warnings,
        'metrics': {'operation': operation, 'value_field': value_field or None, 'distance_band_m': parameters['distance_band']},
    }


EXECUTORS: dict[str, Callable[..., dict[str, Any]]] = {
    'buffer': _execute_buffer,
    'multi_ring_buffer': _execute_multi_ring_buffer,
    'intersect': _execute_intersect,
    'clip': _execute_clip,
    'erase': _execute_erase,
    'dissolve': _execute_dissolve,
    'spatial_join': _execute_spatial_join,
    'summarize_within': _execute_summarize_within,
    'near': _execute_near,
    'polygonize': _execute_polygonize,
    'geometry_construct': _execute_geometry_construct,
    'split_lines_at_points': _execute_split_lines_at_points,
    'merge_layers': _execute_merge_layers,
    'reproject': _execute_reproject,
    'geometry_quality': _execute_geometry_quality,
    'topology_validate': _execute_topology_validate,
    'spatial_statistics': _execute_spatial_statistics,
}


def execute_vector_tool(
    cur,
    *,
    tool_id: str,
    parameters: dict[str, Any],
    environments: dict[str, Any],
    created_by: str | None,
    run_id: str | None = None,
) -> dict[str, Any]:
    spec = get_tool_spec(tool_id)
    executor = EXECUTORS.get(tool_id)
    if not spec.migrated or not executor:
        raise VectorAnalysisError(f'{spec.title} has not been migrated to the vector framework')

    estimated_counts = environments.get('estimated_input_counts') or []
    estimated_total_units = int(
        environments.get('estimated_candidate_pairs') or sum(estimated_counts) or 0
    )
    normalized_parameters = validate_tool_parameters(tool_id, parameters)
    normalized_environments = normalize_environments(environments)
    normalized_environments = _prepare_environment_scopes(
        cur, tool_id, normalized_parameters, normalized_environments
    )
    normalized_parameters = _prepare_output_collision(
        cur,
        normalized_parameters,
        normalized_environments,
        created_by,
        _tool_input_layer_ids(tool_id, normalized_parameters),
    )
    if run_id:
        cur.execute(
            'UPDATE analysis_runs SET parameters = %s::jsonb WHERE id = %s::uuid',
            (json.dumps(normalized_parameters), run_id),
        )
    repaired_input_count = _prepare_input_geometry_policy(
        cur, tool_id, normalized_parameters, normalized_environments
    )
    started = time.perf_counter()

    def report(progress: int, stage: str) -> None:
        if run_id:
            update_analysis_run(
                cur,
                run_id,
                status='running',
                progress=progress,
                stage=stage,
                completed_units=(estimated_total_units * progress // 100) if estimated_total_units else None,
                total_units=estimated_total_units or None,
            )

    result = executor(cur, normalized_parameters, normalized_environments, created_by, report)
    _restore_input_geometries(cur)
    result = _apply_output_geometry_policies(
        cur, result, normalized_environments, created_by
    )
    if repaired_input_count:
        result.setdefault('warnings', []).append(
            f'{repaired_input_count} invalid input geometries were repaired transactionally for processing.'
        )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    result['metrics'] = {
        **result.get('metrics', {}),
        'repaired_input_geometry_count': repaired_input_count,
        'multipart_policy': normalized_environments['multipart_policy'],
        'z_policy': normalized_environments['z_policy'],
        'elapsed_ms': elapsed_ms,
        'output_feature_count': result['count'],
    }
    if run_id:
        update_analysis_run(
            cur,
            run_id,
            status='succeeded',
            progress=100,
            stage='Completed',
            output_layer_ids=result['output_layer_ids'],
            warnings=result['warnings'],
            metrics=result['metrics'],
            completed_units=result['count'],
            total_units=result['count'],
        )
    return result
