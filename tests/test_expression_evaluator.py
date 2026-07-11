import unittest

from expression_evaluator import ExpressionEvaluationError, evaluate_expression


class ExpressionEvaluatorTests(unittest.TestCase):
    def test_evaluates_fields_arithmetic_and_allowed_functions(self):
        result = evaluate_expression('round(population / area, 2)', {'population': 1250, 'area': 12})
        self.assertEqual(result, 104.17)

    def test_supports_conditional_expressions(self):
        result = evaluate_expression('"Urban" if population >= 10000 else "Rural"', {'population': 12000})
        self.assertEqual(result, 'Urban')

    def test_rejects_attribute_access(self):
        with self.assertRaisesRegex(ExpressionEvaluationError, 'Unsupported expression element'):
            evaluate_expression('value.__class__', {'value': 1})

    def test_rejects_unapproved_functions(self):
        with self.assertRaisesRegex(ExpressionEvaluationError, 'Function is not allowed'):
            evaluate_expression('open("secret")', {})

    def test_rejects_comprehensions(self):
        with self.assertRaisesRegex(ExpressionEvaluationError, 'Unsupported expression element'):
            evaluate_expression('[value for value in items]', {'items': [1, 2]})


if __name__ == '__main__':
    unittest.main()
