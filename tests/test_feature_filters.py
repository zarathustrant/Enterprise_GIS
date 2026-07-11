import unittest

from field_schema import FieldSchemaError
from query_filters import build_filter_sql


class SchemaCursor:
    def __init__(self, fields):
        self.fields = fields

    def execute(self, _query, _params):
        pass

    def fetchall(self):
        return self.fields


class FeatureFilterTests(unittest.TestCase):
    def test_integer_comparison_uses_guarded_numeric_cast(self):
        cursor = SchemaCursor([{'name': 'population', 'field_type': 'integer'}])

        clauses, params = build_filter_sql(
            cursor,
            '11111111-1111-1111-1111-111111111111',
            [{'field': 'population', 'op': 'gte', 'value': '100'}],
        )

        self.assertIn('::bigint', clauses[0])
        self.assertIn('CASE WHEN', clauses[0])
        self.assertEqual(params, ['population', 'population', 100])

    def test_boolean_equality_parses_user_value(self):
        cursor = SchemaCursor([{'name': 'active', 'field_type': 'boolean'}])

        clauses, params = build_filter_sql(
            cursor,
            '11111111-1111-1111-1111-111111111111',
            [{'field': 'active', 'op': 'eq', 'value': 'true'}],
        )

        self.assertIn('::boolean', clauses[0])
        self.assertIs(params[-1], True)

    def test_rejects_order_comparison_for_text_fields(self):
        cursor = SchemaCursor([{'name': 'name', 'field_type': 'string'}])

        with self.assertRaisesRegex(FieldSchemaError, 'requires a numeric or date field'):
            build_filter_sql(
                cursor,
                '11111111-1111-1111-1111-111111111111',
                [{'field': 'name', 'op': 'gt', 'value': 'M'}],
            )

    def test_rejects_invalid_boolean_filter_value(self):
        cursor = SchemaCursor([{'name': 'active', 'field_type': 'boolean'}])

        with self.assertRaisesRegex(FieldSchemaError, 'Invalid boolean filter value'):
            build_filter_sql(
                cursor,
                '11111111-1111-1111-1111-111111111111',
                [{'field': 'active', 'op': 'eq', 'value': 'perhaps'}],
            )


if __name__ == '__main__':
    unittest.main()
