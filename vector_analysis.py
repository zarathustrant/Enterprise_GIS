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
        parameters[definition.name] = value
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


EXECUTORS: dict[str, Callable[..., dict[str, Any]]] = {
    'buffer': _execute_buffer,
    'intersect': _execute_intersect,
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
