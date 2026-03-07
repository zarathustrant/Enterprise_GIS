import json
from typing import Any

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db import get_db
from field_schema import (
    FieldSchemaError,
    coerce_field_value,
    enforce_domain,
    fetch_layer_domains,
    fetch_layer_fields,
    parse_layer_access,
    serialize_domain,
    serialize_field,
    validate_domain_payload,
    validate_field_payload,
)
from enterprise_utils import invalidate_layer_tile_cache, log_audit

schema_bp = Blueprint('schema', __name__)


def _field_rows(cur, layer_id: str) -> list[dict[str, Any]]:
    return fetch_layer_fields(cur, layer_id)


def _domain_rows(cur, layer_id: str) -> list[dict[str, Any]]:
    return fetch_layer_domains(cur, layer_id)


def _require_access(cur, layer_id: str, user_id: str | None, write: bool = False):
    access = parse_layer_access(cur, layer_id, user_id)
    if not access.exists:
        return jsonify({'error': 'Layer not found'}), 404
    if write and not access.is_owner:
        return jsonify({'error': 'Layer not found or permission denied'}), 404
    return None


def _ensure_domain_for_layer(cur, layer_id: str, domain_id: str | None) -> dict[str, Any] | None:
    if not domain_id:
        return None

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
        WHERE id = %s::uuid AND layer_id = %s
        """,
        (domain_id, layer_id),
    )
    row = cur.fetchone()
    if not row:
        raise FieldSchemaError('Domain not found for this layer')
    return dict(row)


def _validate_domain_shape(values: dict[str, Any]) -> None:
    domain_type = values.get('domain_type')

    if domain_type == 'codedValue':
        coded_values = values.get('coded_values')
        if not isinstance(coded_values, list) or not coded_values:
            raise FieldSchemaError('codedValue domains require a non-empty coded_values list')
        values['min_value'] = None
        values['max_value'] = None
        return

    if domain_type == 'range':
        min_value = values.get('min_value')
        max_value = values.get('max_value')
        if min_value is None or max_value is None:
            raise FieldSchemaError('range domains require min_value and max_value')
        if float(min_value) > float(max_value):
            raise FieldSchemaError('min_value cannot be greater than max_value')
        values['coded_values'] = None
        return

    raise FieldSchemaError('domain_type must be codedValue or range')


def _check_field_default(field: dict[str, Any], default_value: Any) -> Any:
    coerced = coerce_field_value(field, default_value)
    enforce_domain(field, coerced)
    return coerced


def _fetch_field(cur, layer_id: str, field_id: str) -> dict[str, Any] | None:
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
        WHERE f.layer_id = %s AND f.id = %s::uuid
        """,
        (layer_id, field_id),
    )
    row = cur.fetchone()
    return dict(row) if row else None


def _check_feature_population(cur, layer_id: str, field_name: str) -> bool:
    cur.execute(
        """
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (
                   WHERE properties ? %s
                     AND properties->%s IS NOT NULL
                     AND properties->>%s <> 'null'
               ) AS populated
        FROM features
        WHERE layer_id = %s
        """,
        (field_name, field_name, field_name, layer_id),
    )
    row = cur.fetchone()
    return bool(row and row['total'] == row['populated'])


@schema_bp.route('/<layer_id>/domains', methods=['GET'])
@jwt_required(optional=True)
def list_domains(layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    denied = _require_access(cur, layer_id, user_id, write=False)
    if denied:
        return denied

    return jsonify([serialize_domain(row) for row in _domain_rows(cur, layer_id)])


@schema_bp.route('/<layer_id>/domains', methods=['POST'])
@jwt_required()
def create_domain(layer_id):
    user_id = get_jwt_identity()
    payload = request.get_json() or {}

    db = get_db()
    cur = db.cursor()

    denied = _require_access(cur, layer_id, user_id, write=True)
    if denied:
        return denied

    try:
        values = validate_domain_payload(payload, partial=False)
        _validate_domain_shape(values)

        cur.execute(
            """
            INSERT INTO layer_domains (
                layer_id, name, description, domain_type, coded_values, min_value, max_value
            )
            VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)
            RETURNING id,
                      layer_id,
                      name,
                      description,
                      domain_type,
                      coded_values,
                      min_value,
                      max_value,
                      created_at,
                      updated_at
            """,
            (
                layer_id,
                values['name'],
                values.get('description'),
                values['domain_type'],
                json.dumps(values.get('coded_values')) if values.get('coded_values') is not None else None,
                values.get('min_value'),
                values.get('max_value'),
            ),
        )
        row = cur.fetchone()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Failed to create domain: {exc}'}), 400

    log_audit(
        cur,
        user_id=user_id,
        action='layer_domain_created',
        entity_type='layer_domain',
        entity_id=str(row['id']),
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(serialize_domain(dict(row))), 201


@schema_bp.route('/<layer_id>/domains/<domain_id>', methods=['PUT'])
@jwt_required()
def update_domain(layer_id, domain_id):
    user_id = get_jwt_identity()
    payload = request.get_json() or {}

    db = get_db()
    cur = db.cursor()

    denied = _require_access(cur, layer_id, user_id, write=True)
    if denied:
        return denied

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
        WHERE id = %s::uuid AND layer_id = %s
        """,
        (domain_id, layer_id),
    )
    existing = cur.fetchone()
    if not existing:
        return jsonify({'error': 'Domain not found'}), 404

    try:
        updates = validate_domain_payload(payload, partial=True)
        merged = {**dict(existing), **updates}
        _validate_domain_shape(merged)

        cur.execute(
            """
            UPDATE layer_domains
            SET name = %s,
                description = %s,
                domain_type = %s,
                coded_values = %s::jsonb,
                min_value = %s,
                max_value = %s,
                updated_at = NOW()
            WHERE id = %s::uuid AND layer_id = %s
            RETURNING id,
                      layer_id,
                      name,
                      description,
                      domain_type,
                      coded_values,
                      min_value,
                      max_value,
                      created_at,
                      updated_at
            """,
            (
                merged['name'],
                merged.get('description'),
                merged['domain_type'],
                json.dumps(merged.get('coded_values')) if merged.get('coded_values') is not None else None,
                merged.get('min_value'),
                merged.get('max_value'),
                domain_id,
                layer_id,
            ),
        )
        row = cur.fetchone()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Failed to update domain: {exc}'}), 400

    log_audit(
        cur,
        user_id=user_id,
        action='layer_domain_updated',
        entity_type='layer_domain',
        entity_id=str(row['id']),
        layer_id=layer_id,
    )
    db.commit()
    return jsonify(serialize_domain(dict(row)))


@schema_bp.route('/<layer_id>/domains/<domain_id>', methods=['DELETE'])
@jwt_required()
def delete_domain(layer_id, domain_id):
    user_id = get_jwt_identity()

    db = get_db()
    cur = db.cursor()

    denied = _require_access(cur, layer_id, user_id, write=True)
    if denied:
        return denied

    cur.execute(
        """
        DELETE FROM layer_domains
        WHERE id = %s::uuid AND layer_id = %s
        RETURNING id
        """,
        (domain_id, layer_id),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Domain not found'}), 404

    log_audit(
        cur,
        user_id=user_id,
        action='layer_domain_deleted',
        entity_type='layer_domain',
        entity_id=domain_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify({'message': 'Domain deleted'})


@schema_bp.route('/<layer_id>/fields', methods=['GET'])
@jwt_required(optional=True)
def list_fields(layer_id):
    user_id = get_jwt_identity()
    db = get_db()
    cur = db.cursor()

    denied = _require_access(cur, layer_id, user_id, write=False)
    if denied:
        return denied

    return jsonify([serialize_field(row) for row in _field_rows(cur, layer_id)])


@schema_bp.route('/<layer_id>/fields', methods=['POST'])
@jwt_required()
def create_field(layer_id):
    user_id = get_jwt_identity()
    payload = request.get_json() or {}

    db = get_db()
    cur = db.cursor()

    denied = _require_access(cur, layer_id, user_id, write=True)
    if denied:
        return denied

    try:
        values = validate_field_payload(payload, partial=False)

        if not values['nullable'] and values.get('default_value') is None:
            raise FieldSchemaError('Non-nullable fields require a default_value')

        domain = _ensure_domain_for_layer(cur, layer_id, values.get('domain_id'))

        field_context = {
            'name': values['name'],
            'field_type': values['field_type'],
            'nullable': values['nullable'],
            'length': values.get('length'),
            'domain_type': domain['domain_type'] if domain else None,
            'coded_values': domain['coded_values'] if domain else None,
            'min_value': domain['min_value'] if domain else None,
            'max_value': domain['max_value'] if domain else None,
        }

        default_value = values.get('default_value')
        if default_value is not None:
            default_value = _check_field_default(field_context, default_value)

        if 'sort_order' not in values:
            cur.execute('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM layer_fields WHERE layer_id = %s', (layer_id,))
            values['sort_order'] = int(cur.fetchone()['next_sort'])

        cur.execute(
            """
            INSERT INTO layer_fields (
                layer_id, name, alias, field_type, nullable,
                default_value, domain_id, length, precision, scale, sort_order
            )
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::uuid, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                layer_id,
                values['name'],
                values.get('alias'),
                values['field_type'],
                values['nullable'],
                json.dumps(default_value) if default_value is not None else None,
                values.get('domain_id'),
                values.get('length'),
                values.get('precision'),
                values.get('scale'),
                values.get('sort_order'),
            ),
        )
        field_id = str(cur.fetchone()['id'])

        backfill_value = default_value if default_value is not None else None
        cur.execute(
            """
            UPDATE features
            SET properties = jsonb_set(
                COALESCE(properties, '{}'::jsonb),
                %s::text[],
                %s::jsonb,
                true
            ),
                version = version + 1,
                updated_at = NOW()
            WHERE layer_id = %s
            """,
            ([values['name']], json.dumps(backfill_value), layer_id),
        )

        row = _fetch_field(cur, layer_id, field_id)
        invalidate_layer_tile_cache(cur, layer_id)
        log_audit(
            cur,
            user_id=user_id,
            action='layer_field_created',
            entity_type='layer_field',
            entity_id=field_id,
            layer_id=layer_id,
        )
        db.commit()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Failed to create field: {exc}'}), 400

    return jsonify(serialize_field(row)), 201


@schema_bp.route('/<layer_id>/fields/<field_id>', methods=['PUT'])
@jwt_required()
def update_field(layer_id, field_id):
    user_id = get_jwt_identity()
    payload = request.get_json() or {}

    db = get_db()
    cur = db.cursor()

    denied = _require_access(cur, layer_id, user_id, write=True)
    if denied:
        return denied

    existing = _fetch_field(cur, layer_id, field_id)
    if not existing:
        return jsonify({'error': 'Field not found'}), 404

    try:
        updates = validate_field_payload(payload, partial=True)

        if (
            'field_type' in updates
            and updates['field_type'] != existing['field_type']
        ):
            cur.execute(
                'SELECT COUNT(*) AS count FROM features WHERE layer_id = %s AND properties ? %s',
                (layer_id, existing['name']),
            )
            populated = int(cur.fetchone()['count'])
            if populated > 0:
                raise FieldSchemaError(
                    'Cannot change field_type after data exists. Create a new field and migrate values.'
                )

        merged = {**existing, **updates}

        if not merged.get('nullable') and merged.get('default_value') is None:
            if not _check_feature_population(cur, layer_id, merged['name']):
                raise FieldSchemaError('Cannot make field non-nullable while existing features still have null/missing values')

        domain = _ensure_domain_for_layer(cur, layer_id, merged.get('domain_id'))
        merged['domain_type'] = domain['domain_type'] if domain else None
        merged['coded_values'] = domain['coded_values'] if domain else None
        merged['min_value'] = domain['min_value'] if domain else None
        merged['max_value'] = domain['max_value'] if domain else None

        default_value = merged.get('default_value')
        if default_value is not None:
            default_value = _check_field_default(merged, default_value)
            merged['default_value'] = default_value

        old_name = existing['name']
        new_name = merged['name']

        cur.execute(
            """
            UPDATE layer_fields
            SET name = %s,
                alias = %s,
                field_type = %s,
                nullable = %s,
                default_value = %s::jsonb,
                domain_id = %s::uuid,
                length = %s,
                precision = %s,
                scale = %s,
                sort_order = %s,
                updated_at = NOW()
            WHERE id = %s::uuid AND layer_id = %s
            RETURNING id
            """,
            (
                new_name,
                merged.get('alias'),
                merged['field_type'],
                merged['nullable'],
                json.dumps(default_value) if default_value is not None else None,
                merged.get('domain_id'),
                merged.get('length'),
                merged.get('precision'),
                merged.get('scale'),
                merged.get('sort_order') or 0,
                field_id,
                layer_id,
            ),
        )

        if old_name != new_name:
            cur.execute(
                """
                UPDATE features
                SET properties = CASE
                    WHEN properties ? %s
                    THEN (properties - %s) || jsonb_build_object(%s, properties->%s)
                    ELSE properties
                END,
                    version = version + 1,
                    updated_at = NOW()
                WHERE layer_id = %s
                """,
                (old_name, old_name, new_name, old_name, layer_id),
            )

        row = _fetch_field(cur, layer_id, field_id)
        invalidate_layer_tile_cache(cur, layer_id)
        log_audit(
            cur,
            user_id=user_id,
            action='layer_field_updated',
            entity_type='layer_field',
            entity_id=field_id,
            layer_id=layer_id,
        )
        db.commit()
    except FieldSchemaError as exc:
        db.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({'error': f'Failed to update field: {exc}'}), 400

    return jsonify(serialize_field(row))


@schema_bp.route('/<layer_id>/fields/<field_id>', methods=['DELETE'])
@jwt_required()
def delete_field(layer_id, field_id):
    user_id = get_jwt_identity()

    db = get_db()
    cur = db.cursor()

    denied = _require_access(cur, layer_id, user_id, write=True)
    if denied:
        return denied

    existing = _fetch_field(cur, layer_id, field_id)
    if not existing:
        return jsonify({'error': 'Field not found'}), 404

    cur.execute(
        'DELETE FROM layer_fields WHERE id = %s::uuid AND layer_id = %s RETURNING id',
        (field_id, layer_id),
    )

    cur.execute(
        'UPDATE features SET properties = properties - %s, version = version + 1, updated_at = NOW() WHERE layer_id = %s',
        (existing['name'], layer_id),
    )

    invalidate_layer_tile_cache(cur, layer_id)
    log_audit(
        cur,
        user_id=user_id,
        action='layer_field_deleted',
        entity_type='layer_field',
        entity_id=field_id,
        layer_id=layer_id,
    )
    db.commit()
    return jsonify({'message': 'Field deleted'})
