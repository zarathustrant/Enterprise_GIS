import json
from dataclasses import dataclass
from typing import Any


class GeometryValidationError(ValueError):
    """Raised when submitted geometry cannot safely enter the authoritative store."""


@dataclass(frozen=True)
class GeometryValidationResult:
    geometry: dict[str, Any]
    geometry_type: str


def validate_geojson_geometry(
    cur,
    geometry: Any,
    *,
    srid: int = 4326,
    expected_type: str | None = None,
) -> GeometryValidationResult:
    if not isinstance(geometry, dict) or not isinstance(geometry.get('type'), str):
        raise GeometryValidationError('geometry must be a GeoJSON geometry object')

    if geometry.get('type') == 'GeometryCollection':
        raise GeometryValidationError('GeometryCollection is not supported for editable features')
    if expected_type and geometry.get('type') != expected_type:
        raise GeometryValidationError(f'geometry.type must be {expected_type}')

    try:
        encoded = json.dumps(geometry, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise GeometryValidationError('geometry contains invalid or non-finite coordinates') from exc

    try:
        cur.execute(
            """
            WITH candidate AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), %s) AS geom
            )
            SELECT
                ST_IsEmpty(geom) AS is_empty,
                ST_IsValid(geom) AS is_valid,
                ST_IsValidReason(geom) AS validity_reason,
                GeometryType(geom) AS geometry_type,
                ST_AsGeoJSON(geom) AS normalized_geometry
            FROM candidate
            """,
            (encoded, srid),
        )
        row = cur.fetchone()
    except Exception as exc:
        raise GeometryValidationError(f'geometry is not valid GeoJSON: {exc}') from exc

    if not row or row.get('normalized_geometry') is None:
        raise GeometryValidationError('geometry could not be parsed')
    if row.get('is_empty'):
        raise GeometryValidationError('empty geometry is not allowed')
    if not row.get('is_valid'):
        reason = row.get('validity_reason') or 'unknown validity error'
        raise GeometryValidationError(f'invalid geometry: {reason}')

    normalized = row['normalized_geometry']
    if isinstance(normalized, str):
        normalized = json.loads(normalized)

    if expected_type and normalized.get('type') != expected_type:
        raise GeometryValidationError(f'normalized geometry.type must be {expected_type}')

    return GeometryValidationResult(
        geometry=normalized,
        geometry_type=str(row.get('geometry_type') or geometry.get('type')),
    )
