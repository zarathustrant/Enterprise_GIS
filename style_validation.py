import json
import math
import re
from typing import Any


COLOR_PATTERN = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
RENDERERS = {'simple', 'uniqueValue', 'classBreaks'}
ICON_LIBRARIES = {
    'maki', 'tabler', 'lucide', 'heroicons_outline', 'heroicons_solid',
    'material_symbols', 'iconify',
}
EXPRESSION_FIELDS = {
    'fillColorExpression', 'lineColorExpression', 'pointRadiusExpression',
    'opacityExpression', 'labelTextExpression',
}
COLOR_FIELDS = {
    'color', 'strokeColor', 'lineCasingColor', 'labelColor', 'labelHaloColor',
    'polygonPatternColor', 'uniqueDefaultColor', 'uniqueNullColor',
    'classBreakDefaultColor', 'classBreakNullColor',
}
OPACITY_FIELDS = {
    'opacity', 'polygonPatternOpacity', 'uniqueDefaultOpacity',
    'uniqueNullOpacity', 'classBreakDefaultOpacity', 'classBreakNullOpacity',
    'opacityMin', 'opacityMax',
}
NON_NEGATIVE_FIELDS = {
    'strokeWidth', 'lineCasingWidth', 'pointRadius', 'iconSize', 'labelSize',
    'labelHaloWidth', 'labelMaxCount', 'labelWrapLength', 'labelMaxLength',
    'labelRepeatDistanceMeters', 'sizeMin', 'sizeMax', 'polygonPatternScale',
    'snapToleranceMeters', 'lineMarkerSpacingMeters', 'lineMarkerSize',
    'polygonMarkerSize',
}


class StyleValidationError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__('; '.join(errors))


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_zoom_range(item: dict[str, Any], prefix: str, errors: list[str]) -> None:
    minimum = item.get('minZoom')
    maximum = item.get('maxZoom')
    if minimum is not None and (not _number(minimum) or minimum < 0 or minimum > 24):
        errors.append(f'{prefix}.minZoom must be between 0 and 24')
    if maximum is not None and (not _number(maximum) or maximum < 0 or maximum > 24):
        errors.append(f'{prefix}.maxZoom must be between 0 and 24')
    if _number(minimum) and _number(maximum) and minimum > maximum:
        errors.append(f'{prefix}.minZoom cannot exceed maxZoom')


def _validate_expression(value: Any, field: str, errors: list[str]) -> None:
    if value in (None, ''):
        return
    parsed = value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            errors.append(f'{field} must be valid JSON')
            return
    if not isinstance(parsed, list) or not parsed or not isinstance(parsed[0], str):
        errors.append(f'{field} must be a JSON expression array beginning with an operator')
        return
    if sum(1 for _ in _walk(parsed)) > 500:
        errors.append(f'{field} is too complex')


def _validate_color(value: Any, field: str, errors: list[str]) -> None:
    if value is not None and (not isinstance(value, str) or not COLOR_PATTERN.fullmatch(value.strip())):
        errors.append(f'{field} must be a 3- or 6-digit hex color')


def _validate_opacity(value: Any, field: str, errors: list[str]) -> None:
    if value is not None and (not _number(value) or value < 0 or value > 1):
        errors.append(f'{field} must be between 0 and 1')


def _validate_non_negative(value: Any, field: str, errors: list[str]) -> None:
    if value is not None and (not _number(value) or value < 0):
        errors.append(f'{field} must be a non-negative number')


def _validate_dash(value: Any, field: str, errors: list[str]) -> None:
    if value is not None and (
        not isinstance(value, list) or len(value) != 2
        or any(not _number(part) or part < 0 for part in value)
    ):
        errors.append(f'{field} must contain two non-negative numbers')


def _walk(value: Any):
    yield value
    if isinstance(value, list):
        for item in value:
            yield from _walk(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _walk(item)


def validate_layer_style(style: Any) -> None:
    if not isinstance(style, dict):
        raise StyleValidationError(['style must be a JSON object'])
    if len(json.dumps(style, separators=(',', ':')).encode('utf-8')) > 200_000:
        raise StyleValidationError(['style exceeds the 200 KB limit'])

    errors: list[str] = []
    renderer = style.get('rendererType', 'simple')
    if renderer not in RENDERERS:
        errors.append('rendererType must be simple, uniqueValue, or classBreaks')

    for field in COLOR_FIELDS:
        _validate_color(style.get(field), field, errors)

    for field in OPACITY_FIELDS:
        _validate_opacity(style.get(field), field, errors)

    for field in NON_NEGATIVE_FIELDS:
        _validate_non_negative(style.get(field), field, errors)

    if _number(style.get('sizeMin')) and _number(style.get('sizeMax')) and style['sizeMin'] > style['sizeMax']:
        errors.append('sizeMin cannot exceed sizeMax')
    if _number(style.get('opacityMin')) and _number(style.get('opacityMax')) and style['opacityMin'] > style['opacityMax']:
        errors.append('opacityMin cannot exceed opacityMax')

    _validate_dash(style.get('lineDashArray'), 'lineDashArray', errors)

    for field in ('iconLibrary', 'lineMarkerLibrary', 'polygonMarkerLibrary'):
        value = style.get(field)
        if value is not None and value not in ICON_LIBRARIES:
            errors.append(f'{field} is not a supported icon library')

    for field in EXPRESSION_FIELDS:
        _validate_expression(style.get(field), field, errors)

    _validate_zoom_range(
        {'minZoom': style.get('labelMinZoom'), 'maxZoom': style.get('labelMaxZoom')},
        'labels', errors,
    )

    scale_overrides = style.get('scaleOverrides', [])
    if not isinstance(scale_overrides, list):
        errors.append('scaleOverrides must be an array')
    else:
        for index, override in enumerate(scale_overrides):
            if not isinstance(override, dict):
                errors.append(f'scaleOverrides[{index}] must be an object')
                continue
            _validate_zoom_range(override, f'scaleOverrides[{index}]', errors)
            _validate_color(override.get('color'), f'scaleOverrides[{index}].color', errors)
            _validate_opacity(override.get('opacity'), f'scaleOverrides[{index}].opacity', errors)
            _validate_non_negative(override.get('strokeWidth'), f'scaleOverrides[{index}].strokeWidth', errors)
            _validate_non_negative(override.get('pointRadius'), f'scaleOverrides[{index}].pointRadius', errors)

    line_symbols = style.get('lineSymbolLayers', [])
    if not isinstance(line_symbols, list):
        errors.append('lineSymbolLayers must be an array')
    else:
        identifiers: set[str] = set()
        for index, symbol in enumerate(line_symbols):
            if not isinstance(symbol, dict):
                errors.append(f'lineSymbolLayers[{index}] must be an object')
                continue
            identifier = symbol.get('id')
            if identifier and identifier in identifiers:
                errors.append(f'lineSymbolLayers contains duplicate id {identifier}')
            if identifier:
                identifiers.add(identifier)
            _validate_color(symbol.get('color'), f'lineSymbolLayers[{index}].color', errors)
            _validate_opacity(symbol.get('opacity'), f'lineSymbolLayers[{index}].opacity', errors)
            _validate_non_negative(symbol.get('width'), f'lineSymbolLayers[{index}].width', errors)
            _validate_dash(symbol.get('dashArray'), f'lineSymbolLayers[{index}].dashArray', errors)
            if symbol.get('level') is not None and not _number(symbol['level']):
                errors.append(f'lineSymbolLayers[{index}].level must be a finite number')

    label_classes = style.get('labelClasses', [])
    if not isinstance(label_classes, list):
        errors.append('labelClasses must be an array')
    else:
        identifiers: set[str] = set()
        for index, label_class in enumerate(label_classes):
            if not isinstance(label_class, dict):
                errors.append(f'labelClasses[{index}] must be an object')
                continue
            identifier = label_class.get('id')
            if identifier and identifier in identifiers:
                errors.append(f'labelClasses contains duplicate id {identifier}')
            if identifier:
                identifiers.add(identifier)
            _validate_zoom_range(label_class, f'labelClasses[{index}]', errors)
            _validate_color(label_class.get('color'), f'labelClasses[{index}].color', errors)
            _validate_non_negative(label_class.get('size'), f'labelClasses[{index}].size', errors)
            if label_class.get('priority') is not None and not _number(label_class['priority']):
                errors.append(f'labelClasses[{index}].priority must be a finite number')

    unique_stops = style.get('uniqueValueStops', [])
    if not isinstance(unique_stops, list):
        errors.append('uniqueValueStops must be an array')
    else:
        values: set[str] = set()
        for index, stop in enumerate(unique_stops):
            if not isinstance(stop, dict) or stop.get('value') is None:
                errors.append(f'uniqueValueStops[{index}] must have a non-null value')
                continue
            key = str(stop['value'])
            if key in values:
                errors.append(f'uniqueValueStops contains duplicate value {key}')
            values.add(key)
            if not isinstance(stop.get('color'), str) or not COLOR_PATTERN.fullmatch(stop['color'].strip()):
                errors.append(f'uniqueValueStops[{index}].color must be a hex color')
            if stop.get('opacity') is not None and (
                not _number(stop['opacity']) or stop['opacity'] < 0 or stop['opacity'] > 1
            ):
                errors.append(f'uniqueValueStops[{index}].opacity must be between 0 and 1')

    class_breaks = style.get('classBreakStops', [])
    if not isinstance(class_breaks, list):
        errors.append('classBreakStops must be an array')
    else:
        normalized: list[tuple[float, float, int]] = []
        for index, stop in enumerate(class_breaks):
            if not isinstance(stop, dict) or not _number(stop.get('min')) or not _number(stop.get('max')):
                errors.append(f'classBreakStops[{index}] must have finite min and max values')
                continue
            if stop['min'] >= stop['max']:
                errors.append(f'classBreakStops[{index}].min must be less than max')
            normalized.append((float(stop['min']), float(stop['max']), index))
            if not isinstance(stop.get('color'), str) or not COLOR_PATTERN.fullmatch(stop['color'].strip()):
                errors.append(f'classBreakStops[{index}].color must be a hex color')
            if stop.get('opacity') is not None and (
                not _number(stop['opacity']) or stop['opacity'] < 0 or stop['opacity'] > 1
            ):
                errors.append(f'classBreakStops[{index}].opacity must be between 0 and 1')
        normalized.sort()
        for previous, current in zip(normalized, normalized[1:]):
            if current[0] < previous[1]:
                errors.append(
                    f'classBreakStops[{current[2]}] overlaps classBreakStops[{previous[2]}]'
                )

    if errors:
        raise StyleValidationError(errors)
