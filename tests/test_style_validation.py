import unittest

from style_validation import StyleValidationError, validate_layer_style


class StyleValidationTests(unittest.TestCase):
    def test_accepts_complete_advanced_style(self):
        validate_layer_style({
            'rendererType': 'uniqueValue',
            'opacity': 0,
            'uniqueValueField': 'status',
            'uniqueValueStops': [
                {'value': 'open', 'color': '#00aa55', 'opacity': 1},
                {'value': 'closed', 'color': '#c33', 'opacity': 0.4},
            ],
            'labelMinZoom': 4,
            'labelMaxZoom': 18,
            'labelTextExpression': '["coalesce",["get","name"],"Unnamed"]',
            'scaleOverrides': [{
                'minZoom': 10, 'maxZoom': 14, 'color': '#336699',
                'opacity': 0.8, 'strokeWidth': 3, 'pointRadius': 8,
            }],
        })

    def test_rejects_ambiguous_or_unrenderable_style(self):
        with self.assertRaises(StyleValidationError) as context:
            validate_layer_style({
                'rendererType': 'classBreaks',
                'opacity': 1.5,
                'labelMinZoom': 15,
                'labelMaxZoom': 8,
                'lineDashArray': [4, -1],
                'labelTextExpression': '[bad json',
                'classBreakStops': [
                    {'min': 0, 'max': 10, 'color': '#00ff00'},
                    {'min': 8, 'max': 20, 'color': 'red'},
                ],
            })
        message = str(context.exception)
        self.assertIn('opacity must be between 0 and 1', message)
        self.assertIn('labels.minZoom cannot exceed maxZoom', message)
        self.assertIn('overlaps', message)
        self.assertIn('must be valid JSON', message)

    def test_rejects_duplicate_categories_and_label_classes(self):
        with self.assertRaises(StyleValidationError) as context:
            validate_layer_style({
                'uniqueValueStops': [
                    {'value': 'a', 'color': '#111111'},
                    {'value': 'a', 'color': '#222222'},
                ],
                'labelClasses': [
                    {'id': 'same', 'minZoom': 0, 'maxZoom': 10},
                    {'id': 'same', 'minZoom': 0, 'maxZoom': 10},
                ],
            })
        self.assertIn('duplicate value a', str(context.exception))
        self.assertIn('duplicate id same', str(context.exception))

    def test_rejects_invalid_nested_symbol_configuration(self):
        with self.assertRaises(StyleValidationError) as context:
            validate_layer_style({
                'scaleOverrides': [{
                    'minZoom': 2, 'maxZoom': 8, 'color': 'blue',
                    'opacity': -0.1, 'strokeWidth': -2,
                }],
                'lineSymbolLayers': [
                    {'id': 'outline', 'color': '#fff', 'opacity': 1, 'width': 4, 'dashArray': [1, 0], 'level': 0},
                    {'id': 'outline', 'color': '#000', 'opacity': 2, 'width': -1, 'dashArray': [1], 'level': 'top'},
                ],
                'labelClasses': [{
                    'id': 'invalid', 'color': '#12345g', 'size': -4, 'priority': 'high',
                }],
            })
        message = str(context.exception)
        self.assertIn('scaleOverrides[0].color', message)
        self.assertIn('lineSymbolLayers contains duplicate id outline', message)
        self.assertIn('lineSymbolLayers[1].dashArray', message)
        self.assertIn('labelClasses[0].priority', message)


if __name__ == '__main__':
    unittest.main()
