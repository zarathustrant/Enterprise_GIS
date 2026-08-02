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
    if scope not in {'all', 'selected'}:
        raise VectorAnalysisError('environment scope must be all or selected')

    def normalize_scope(name: str, fallback: str) -> str:
        value = str(data.get(name, fallback)).strip().lower()
        if value not in {'all', 'selected'}:
            raise VectorAnalysisError(f'{name} must be all or selected')
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

    return {
        'scope': scope,
        'selected_feature_ids': selected_ids,
        'scope_a': scope_a,
        'scope_b': scope_b,
        'selected_feature_ids_a': selected_ids_a,
        'selected_feature_ids_b': selected_ids_b,
        'precision_grid': precision_grid,
        'output_crs': 'EPSG:4326',
        'invalid_geometry_policy': 'reject',
        'multipart_policy': 'preserve',
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
        if definition.type == 'number' and value is not None:
            try:
                value = float(value)
            except (TypeError, ValueError) as exc:
                raise VectorAnalysisError(f'{definition.name} must be a number') from exc
            if definition.minimum is not None and value < definition.minimum:
                raise VectorAnalysisError(f'{definition.name} must be at least {definition.minimum}')
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
        if definition.type == 'statistics':
            if not isinstance(value, (list, tuple)):
                raise VectorAnalysisError(f'{definition.name} must be a list')
            normalized_statistics = []
            allowed_statistics = {'count', 'sum', 'minimum', 'maximum', 'mean', 'first', 'last'}
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
        SELECT id, updated_at FROM layers WHERE id = ANY(%s::uuid[])
        """,
        (input_layer_ids,),
    )
    revisions = {str(row['id']): row['updated_at'].isoformat() for row in cur.fetchall()}
    cur.execute(
        """
        INSERT INTO analysis_runs (
            tool_id, tool_version, status, execution_mode, parameters, environments,
            input_layer_ids, input_layer_revisions, progress, progress_stage, created_by,
            started_at
        ) VALUES (
            %s, %s, %s, %s, %s::jsonb, %s::jsonb,
            %s::jsonb, %s::jsonb, %s, %s, %s::uuid,
            CASE WHEN %s = 'running' THEN NOW() ELSE NULL END
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
        'error': row.get('error'),
        'async_job_id': str(row['async_job_id']) if row.get('async_job_id') else None,
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

    scope_clause = ''
    query_params: list[Any] = [output_layer_id, distance, created_by, layer_id]
    if environments['scope'] == 'selected':
        scope_clause = 'AND id = ANY(%s::uuid[])'
        query_params.append(environments['selected_feature_ids'])

    geometry_expression = 'ST_Buffer(geometry::geography, %s)::geometry'
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
               properties,
               %s::uuid
        FROM features
        WHERE layer_id = %s::uuid
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
    return f'AND {alias}.id = ANY(%s::uuid[])' if scope == 'selected' else ''


def _count_scoped_features(cur, layer_id: str, scope: str, selected_ids: list[str]) -> int:
    clause = 'AND id = ANY(%s::uuid[])' if scope == 'selected' else ''
    parameters: list[Any] = [layer_id]
    if scope == 'selected':
        parameters.append(selected_ids)
    cur.execute(
        f'SELECT COUNT(*) AS count FROM features WHERE layer_id = %s::uuid {clause}',
        tuple(parameters),
    )
    return int(cur.fetchone()['count'])


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
        WHERE geometry IS NOT NULL AND NOT ST_IsEmpty(geometry)
        """,
        tuple(
            geometry_parameters
            + raw_parameters
            + [collection_type]
            + [output_layer_id, json.dumps(mapping_a), json.dumps(mapping_b), created_by]
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
        else:
            field_type = source_field['field_type']
            alias = f'{statistic_name.title()} {source_field.get("alias") or statistic["field"]}'
            length = source_field.get('length')
            precision = source_field.get('precision')
            scale = source_field.get('scale')
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
        else:
            expression = f"(array_agg(source.properties -> '{field_name}' ORDER BY source.id DESC))[1]"
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
    if scope == 'selected':
        where_clauses.append('source.id = ANY(%s::uuid[])')
        query_parameters.append(selected_ids)
    if parameters['null_policy'] == 'exclude':
        for field_name in dissolve_fields:
            where_clauses.append(
                f"source.properties -> '{field_name}' IS NOT NULL "
                f"AND source.properties -> '{field_name}' <> 'null'::jsonb"
            )

    aggregate_columns = group_selects + [
        'ST_UnaryUnion(ST_Collect(source.geometry)) AS geometry',
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
        tuple(query_parameters + prepared_parameters + [output_layer_id, created_by]),
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
    group_clause = ', group_value' if group_field else ''
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


EXECUTORS: dict[str, Callable[..., dict[str, Any]]] = {
    'buffer': _execute_buffer,
    'intersect': _execute_intersect,
    'clip': _execute_clip,
    'erase': _execute_erase,
    'dissolve': _execute_dissolve,
    'spatial_join': _execute_spatial_join,
    'summarize_within': _execute_summarize_within,
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

    normalized_parameters = validate_tool_parameters(tool_id, parameters)
    normalized_environments = normalize_environments(environments)
    started = time.perf_counter()

    def report(progress: int, stage: str) -> None:
        if run_id:
            update_analysis_run(
                cur,
                run_id,
                status='running',
                progress=progress,
                stage=stage,
            )

    result = executor(cur, normalized_parameters, normalized_environments, created_by, report)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    result['metrics'] = {
        **result.get('metrics', {}),
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
        )
    return result
