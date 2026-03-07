import datetime as dt
import re
from dataclasses import dataclass
from typing import Any

FIELD_TYPES = {'string', 'integer', 'double', 'boolean', 'date', 'datetime'}
DOMAIN_TYPES = {'codedValue', 'range'}
FIELD_NAME_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


class FieldSchemaError(ValueError):
    """Raised when layer field/domain configuration or values are invalid."""


@dataclass(frozen=True)
class LayerAccess:
    exists: bool
    is_owner: bool


def parse_layer_access(cur, layer_id: str, user_id: str | None) -> LayerAccess:
    cur.execute(
        """
        SELECT l.id,
               l.created_by = %s::uuid AS is_owner
        FROM layers l
        WHERE l.id = %s::uuid
          AND (
            l.is_public = TRUE
            OR l.created_by = %s::uuid
            OR EXISTS (
                SELECT 1
                FROM workspace_layers wl
                JOIN workspace_members wm ON wm.workspace_id = wl.workspace_id
                WHERE wl.layer_id = l.id
                  AND wm.user_id = %s::uuid
            )
          )
        """,
        (user_id, layer_id, user_id, user_id),
    )
    row = cur.fetchone()
    if not row:
        return LayerAccess(exists=False, is_owner=False)
    return LayerAccess(exists=True, is_owner=bool(row.get('is_owner')))


def field_name_is_valid(value: str) -> bool:
    return bool(FIELD_NAME_PATTERN.fullmatch(value))


def parse_number(value: Any) -> float:
    if isinstance(value, bool):
        raise FieldSchemaError('Boolean values are not valid numbers')
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise FieldSchemaError('Number value cannot be empty')
        try:
            return float(text)
        except ValueError as exc:
            raise FieldSchemaError(f'Invalid number value: {value}') from exc
    raise FieldSchemaError(f'Invalid number value: {value}')


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().lower()
        if token in {'true', '1', 'yes'}:
            return True
        if token in {'false', '0', 'no'}:
            return False
    raise FieldSchemaError(f'Expected boolean value, got: {value}')


def _parse_integer(value: Any) -> int:
    if isinstance(value, bool):
        raise FieldSchemaError(f'Expected integer value, got: {value}')
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r'[-+]?\d+', text):
            return int(text)
    raise FieldSchemaError(f'Expected integer value, got: {value}')


def _parse_double(value: Any) -> float:
    if isinstance(value, bool):
        raise FieldSchemaError(f'Expected numeric value, got: {value}')
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        try:
            return float(text)
        except ValueError as exc:
            raise FieldSchemaError(f'Expected numeric value, got: {value}') from exc
    raise FieldSchemaError(f'Expected numeric value, got: {value}')


def _parse_date(value: Any) -> str:
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, str):
        try:
            parsed = dt.date.fromisoformat(value.strip())
            return parsed.isoformat()
        except ValueError as exc:
            raise FieldSchemaError(f'Expected YYYY-MM-DD date, got: {value}') from exc
    raise FieldSchemaError(f'Expected YYYY-MM-DD date, got: {value}')


def _parse_datetime(value: Any) -> str:
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, str):
        text = value.strip().replace('Z', '+00:00')
        try:
            parsed = dt.datetime.fromisoformat(text)
            return parsed.isoformat()
        except ValueError as exc:
            raise FieldSchemaError(f'Expected ISO datetime, got: {value}') from exc
    raise FieldSchemaError(f'Expected ISO datetime, got: {value}')


def coerce_field_value(field: dict[str, Any], value: Any) -> Any:
    field_type = field['field_type']

    if value is None:
        return None

    if field_type == 'string':
        if not isinstance(value, str):
            raise FieldSchemaError(f'Field "{field["name"]}" must be a string')
        max_len = field.get('length')
        if isinstance(max_len, int) and max_len > 0 and len(value) > max_len:
            raise FieldSchemaError(f'Field "{field["name"]}" exceeds max length ({max_len})')
        return value

    if field_type == 'integer':
        return _parse_integer(value)

    if field_type == 'double':
        return _parse_double(value)

    if field_type == 'boolean':
        return _parse_bool(value)

    if field_type == 'date':
        return _parse_date(value)

    if field_type == 'datetime':
        return _parse_datetime(value)

    raise FieldSchemaError(f'Unsupported field type: {field_type}')


def _collect_domain_codes(coded_values: Any) -> list[Any]:
    if not isinstance(coded_values, list):
        raise FieldSchemaError('codedValue domain must provide a list of values')

    codes: list[Any] = []
    for entry in coded_values:
        if isinstance(entry, dict):
            if 'code' not in entry:
                raise FieldSchemaError('codedValue domain entry is missing "code"')
            codes.append(entry['code'])
        else:
            codes.append(entry)
    return codes


def enforce_domain(field: dict[str, Any], value: Any) -> None:
    domain_type = field.get('domain_type')
    if not domain_type or value is None:
        return

    if domain_type == 'codedValue':
        allowed_codes = _collect_domain_codes(field.get('coded_values'))
        if value not in allowed_codes:
            raise FieldSchemaError(f'Field "{field["name"]}" must be one of {allowed_codes}')
        return

    if domain_type == 'range':
        min_value = field.get('min_value')
        max_value = field.get('max_value')

        if field['field_type'] in {'integer', 'double'}:
            numeric = parse_number(value)
            if min_value is not None and numeric < float(min_value):
                raise FieldSchemaError(f'Field "{field["name"]}" is below the allowed minimum')
            if max_value is not None and numeric > float(max_value):
                raise FieldSchemaError(f'Field "{field["name"]}" is above the allowed maximum')
            return

        raise FieldSchemaError(f'Range domains require numeric field types (field "{field["name"]}")')


def fetch_layer_fields(cur, layer_id: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT f.id,
               f.layer_id,
               f.name,
               f.alias,
               f.field_type,
               f.nullable,
               f.default_value,
               f.length,
               f.precision,
               f.scale,
               f.sort_order,
               f.domain_id,
               f.created_at,
               f.updated_at,
               d.name AS domain_name,
               d.domain_type,
               d.coded_values,
               d.min_value,
               d.max_value,
               d.description AS domain_description
        FROM layer_fields f
        LEFT JOIN layer_domains d ON d.id = f.domain_id
        WHERE f.layer_id = %s
        ORDER BY f.sort_order ASC, f.created_at ASC
        """,
        (layer_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def fetch_layer_domains(cur, layer_id: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT id,
               layer_id,
               name,
               description,
               domain_type,
               coded_values,
               min_value,
               max_value,
               created_at,
               updated_at
        FROM layer_domains
        WHERE layer_id = %s
        ORDER BY created_at ASC
        """,
        (layer_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def serialize_domain(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': str(row['id']),
        'layer_id': str(row['layer_id']),
        'name': row['name'],
        'description': row.get('description'),
        'domain_type': row['domain_type'],
        'coded_values': row.get('coded_values'),
        'min_value': row.get('min_value'),
        'max_value': row.get('max_value'),
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }


def serialize_field(row: dict[str, Any]) -> dict[str, Any]:
    domain = None
    if row.get('domain_id'):
        domain = {
            'id': str(row['domain_id']),
            'name': row.get('domain_name'),
            'domain_type': row.get('domain_type'),
            'coded_values': row.get('coded_values'),
            'min_value': row.get('min_value'),
            'max_value': row.get('max_value'),
            'description': row.get('domain_description'),
        }

    return {
        'id': str(row['id']),
        'layer_id': str(row['layer_id']),
        'name': row['name'],
        'alias': row.get('alias'),
        'field_type': row['field_type'],
        'nullable': row['nullable'],
        'default_value': row.get('default_value'),
        'length': row.get('length'),
        'precision': row.get('precision'),
        'scale': row.get('scale'),
        'sort_order': row.get('sort_order') or 0,
        'domain': domain,
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat(),
    }


def _normalize_properties(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise FieldSchemaError('properties must be an object')
    return raw


def validate_properties_with_fields(fields: list[dict[str, Any]], raw_properties: Any) -> dict[str, Any]:
    properties = _normalize_properties(raw_properties)
    field_by_name = {field['name']: field for field in fields}

    # No schema yet: preserve flexible JSON behavior.
    if not fields:
        return properties

    unknown_fields = sorted(
        key
        for key in properties.keys()
        if not key.startswith('_') and key not in field_by_name
    )
    if unknown_fields:
        raise FieldSchemaError(
            f'Unknown attribute field(s): {", ".join(unknown_fields)}. Add fields to the layer schema first.'
        )

    prepared: dict[str, Any] = {}

    for field in fields:
        field_name = field['name']
        provided = field_name in properties

        if provided:
            raw_value = properties[field_name]
        elif field.get('default_value') is not None:
            raw_value = field.get('default_value')
        elif field['nullable']:
            raw_value = None
        else:
            raise FieldSchemaError(f'Field "{field_name}" is required')

        coerced = coerce_field_value(field, raw_value)
        if coerced is None and not field['nullable']:
            raise FieldSchemaError(f'Field "{field_name}" cannot be null')

        enforce_domain(field, coerced)
        prepared[field_name] = coerced

    return prepared


def validate_properties_against_schema(cur, layer_id: str, raw_properties: Any) -> dict[str, Any]:
    return validate_properties_with_fields(fetch_layer_fields(cur, layer_id), raw_properties)


def validate_domain_payload(payload: dict[str, Any], *, partial: bool = False) -> dict[str, Any]:
    data: dict[str, Any] = {}

    if not partial or 'name' in payload:
        name = str(payload.get('name', '')).strip()
        if not name:
            raise FieldSchemaError('Domain name is required')
        data['name'] = name

    if not partial or 'description' in payload:
        description = payload.get('description')
        if description is not None:
            description = str(description).strip()
        data['description'] = description or None

    if not partial or 'domain_type' in payload:
        domain_type = str(payload.get('domain_type', '')).strip()
        if domain_type not in DOMAIN_TYPES:
            raise FieldSchemaError(f'domain_type must be one of: {sorted(DOMAIN_TYPES)}')
        data['domain_type'] = domain_type

    if 'coded_values' in payload:
        coded_values = payload.get('coded_values')
        _collect_domain_codes(coded_values)
        data['coded_values'] = coded_values

    if 'min_value' in payload:
        data['min_value'] = parse_number(payload['min_value'])

    if 'max_value' in payload:
        data['max_value'] = parse_number(payload['max_value'])

    return data


def validate_field_payload(payload: dict[str, Any], *, partial: bool = False) -> dict[str, Any]:
    data: dict[str, Any] = {}

    if not partial or 'name' in payload:
        name = str(payload.get('name', '')).strip()
        if not name:
            raise FieldSchemaError('Field name is required')
        if not field_name_is_valid(name):
            raise FieldSchemaError('Field name must match [A-Za-z_][A-Za-z0-9_]*')
        data['name'] = name

    if not partial or 'field_type' in payload:
        field_type = str(payload.get('field_type', '')).strip()
        if field_type not in FIELD_TYPES:
            raise FieldSchemaError(f'field_type must be one of: {sorted(FIELD_TYPES)}')
        data['field_type'] = field_type

    if not partial or 'alias' in payload:
        alias = payload.get('alias')
        if alias is not None:
            alias = str(alias).strip()
        data['alias'] = alias or None

    if not partial or 'nullable' in payload:
        nullable = payload.get('nullable', True)
        if not isinstance(nullable, bool):
            raise FieldSchemaError('nullable must be true or false')
        data['nullable'] = nullable

    if 'default_value' in payload:
        data['default_value'] = payload['default_value']

    if 'domain_id' in payload:
        domain_id = payload.get('domain_id')
        if domain_id in (None, ''):
            data['domain_id'] = None
        else:
            data['domain_id'] = str(domain_id)

    if 'length' in payload:
        length = payload.get('length')
        if length in (None, ''):
            data['length'] = None
        else:
            parsed_length = _parse_integer(length)
            if parsed_length <= 0:
                raise FieldSchemaError('length must be greater than 0')
            data['length'] = parsed_length

    if 'precision' in payload:
        precision = payload.get('precision')
        if precision in (None, ''):
            data['precision'] = None
        else:
            parsed_precision = _parse_integer(precision)
            if parsed_precision < 0:
                raise FieldSchemaError('precision must be 0 or greater')
            data['precision'] = parsed_precision

    if 'scale' in payload:
        scale = payload.get('scale')
        if scale in (None, ''):
            data['scale'] = None
        else:
            parsed_scale = _parse_integer(scale)
            if parsed_scale < 0:
                raise FieldSchemaError('scale must be 0 or greater')
            data['scale'] = parsed_scale

    if 'sort_order' in payload:
        sort_order = payload.get('sort_order')
        data['sort_order'] = _parse_integer(sort_order)

    return data
