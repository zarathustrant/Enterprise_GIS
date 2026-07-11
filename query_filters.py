from typing import Any

from field_schema import FieldSchemaError


def build_filter_sql(cur, layer_id: str, filters: list[dict[str, Any]]) -> tuple[list[str], list[Any]]:
    cur.execute('SELECT name, field_type FROM layer_fields WHERE layer_id = %s::uuid', (layer_id,))
    field_types = {row['name']: row['field_type'] for row in cur.fetchall()}
    clauses: list[str] = []
    params: list[Any] = []

    for item in filters:
        field = item['field']
        op = item['op']
        value = item.get('value')
        field_type = field_types.get(field, 'string')
        raw_expression = 'f.properties ->> %s'

        if field_type == 'integer':
            typed_expression = "CASE WHEN (f.properties ->> %s) ~ '^[+-]?[0-9]+$' THEN (f.properties ->> %s)::bigint END"
            expression_params = [field, field]
            cast = 'bigint'
        elif field_type == 'double':
            typed_expression = (
                "CASE WHEN (f.properties ->> %s) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' "
                'THEN (f.properties ->> %s)::double precision END'
            )
            expression_params = [field, field]
            cast = 'double precision'
        elif field_type == 'boolean':
            typed_expression = "CASE WHEN lower(f.properties ->> %s) IN ('true', 'false') THEN (f.properties ->> %s)::boolean END"
            expression_params = [field, field]
            cast = 'boolean'
        elif field_type == 'date':
            typed_expression = "CASE WHEN pg_input_is_valid(f.properties ->> %s, 'date') THEN (f.properties ->> %s)::date END"
            expression_params = [field, field]
            cast = 'date'
        elif field_type == 'datetime':
            typed_expression = (
                "CASE WHEN pg_input_is_valid(f.properties ->> %s, 'timestamp with time zone') "
                'THEN (f.properties ->> %s)::timestamptz END'
            )
            expression_params = [field, field]
            cast = 'timestamptz'
        else:
            typed_expression = raw_expression
            expression_params = [field]
            cast = 'text'

        try:
            if field_type == 'integer':
                typed_value: Any = int(value)
            elif field_type == 'double':
                typed_value = float(value)
            elif field_type == 'boolean':
                token = str(value).strip().lower()
                if token not in {'true', 'false', '1', '0'}:
                    raise ValueError
                typed_value = token in {'true', '1'}
            else:
                typed_value = value
        except (TypeError, ValueError) as exc:
            raise FieldSchemaError(f'Invalid {field_type} filter value for field "{field}"') from exc

        if op in {'eq', 'neq'} and field_type != 'string':
            operator = '=' if op == 'eq' else '<>'
            clauses.append(f'{typed_expression} {operator} %s::{cast}')
            params.extend([*expression_params, typed_value])
        elif op in {'eq', 'neq'}:
            operator = '=' if op == 'eq' else '<>'
            clauses.append(f"COALESCE({raw_expression}, '') {operator} %s")
            params.extend([field, str(value) if value is not None else ''])
        elif op in {'contains', 'startswith', 'endswith'}:
            pattern = {'contains': f'%{value}%', 'startswith': f'{value}%', 'endswith': f'%{value}'}[op]
            clauses.append(f"COALESCE({raw_expression}, '') ILIKE %s")
            params.extend([field, pattern])
        elif op in {'gt', 'gte', 'lt', 'lte'}:
            if field_type not in {'integer', 'double', 'date', 'datetime'}:
                raise FieldSchemaError(f'Operator {op} requires a numeric or date field')
            operator = {'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<='}[op]
            clauses.append(f'{typed_expression} {operator} %s::{cast}')
            params.extend([*expression_params, typed_value])
        elif op == 'isnull':
            clauses.append(f'({raw_expression} IS NULL)')
            params.append(field)
        elif op == 'notnull':
            clauses.append(f'({raw_expression} IS NOT NULL)')
            params.append(field)
        else:
            raise FieldSchemaError(f'Unsupported filter operator: {op}')

    return clauses, params
