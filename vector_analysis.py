import json
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
        ),
        migrated=False,
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

    selected_ids: list[str] = []
    if scope == 'selected':
        values = data.get('selected_feature_ids')
        if not isinstance(values, list) or not values:
            raise VectorAnalysisError('selected scope requires selected_feature_ids')
        if len(values) > 100_000:
            raise VectorAnalysisError('selected scope is limited to 100,000 feature IDs')
        try:
            selected_ids = [str(UUID(str(value))) for value in values]
        except (TypeError, ValueError) as exc:
            raise VectorAnalysisError('selected_feature_ids must contain UUID values') from exc

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


def _create_output_layer(
    cur,
    *,
    name: str,
    description: str,
    geometry_type: str,
    created_by: str | None,
    source_layer_id: str,
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
    progress(90, 'Finalizing output')
    return {
        'layer': _serialize_layer(cur, output_layer_id),
        'count': feature_count,
        'output_layer_ids': [output_layer_id],
        'warnings': [] if feature_count else ['The operation produced an empty output layer.'],
    }


EXECUTORS: dict[str, Callable[..., dict[str, Any]]] = {'buffer': _execute_buffer}


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
    result['metrics'] = {'elapsed_ms': elapsed_ms, 'output_feature_count': result['count']}
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
