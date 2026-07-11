import ast
import operator
from typing import Any


class ExpressionEvaluationError(ValueError):
    pass


ALLOWED_FUNCTIONS = {
    'abs': abs,
    'max': max,
    'min': min,
    'round': round,
    'int': int,
    'float': float,
    'str': str,
    'len': len,
}

BINARY_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

UNARY_OPERATORS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
    ast.Not: operator.not_,
}

COMPARISON_OPERATORS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}


def evaluate_expression(expression: str, values: dict[str, Any]) -> Any:
    if not expression or len(expression) > 2000:
        raise ExpressionEvaluationError('Expression must contain between 1 and 2000 characters')

    try:
        tree = ast.parse(expression, mode='eval')
    except SyntaxError as exc:
        raise ExpressionEvaluationError(f'Invalid expression syntax: {exc.msg}') from exc

    if sum(1 for _ in ast.walk(tree)) > 200:
        raise ExpressionEvaluationError('Expression is too complex')

    def visit(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (str, int, float, bool, type(None))):
                return node.value
            raise ExpressionEvaluationError('Unsupported constant type')
        if isinstance(node, ast.Name):
            if node.id in values:
                return values[node.id]
            raise ExpressionEvaluationError(f'Field not found in expression: {node.id}')
        if isinstance(node, ast.BinOp) and type(node.op) in BINARY_OPERATORS:
            return BINARY_OPERATORS[type(node.op)](visit(node.left), visit(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in UNARY_OPERATORS:
            return UNARY_OPERATORS[type(node.op)](visit(node.operand))
        if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            operands = [visit(value) for value in node.values]
            return all(operands) if isinstance(node.op, ast.And) else any(operands)
        if isinstance(node, ast.Compare):
            left = visit(node.left)
            for operation, comparator in zip(node.ops, node.comparators):
                function = COMPARISON_OPERATORS.get(type(operation))
                if function is None:
                    raise ExpressionEvaluationError('Unsupported comparison operator')
                right = visit(comparator)
                if not function(left, right):
                    return False
                left = right
            return True
        if isinstance(node, ast.IfExp):
            return visit(node.body) if visit(node.test) else visit(node.orelse)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            function = ALLOWED_FUNCTIONS.get(node.func.id)
            if function is None or node.keywords:
                raise ExpressionEvaluationError(f'Function is not allowed: {node.func.id}')
            return function(*(visit(argument) for argument in node.args))

        raise ExpressionEvaluationError(f'Unsupported expression element: {type(node).__name__}')

    try:
        return visit(tree)
    except ExpressionEvaluationError:
        raise
    except ZeroDivisionError as exc:
        raise ExpressionEvaluationError('Division by zero in expression') from exc
    except (TypeError, ValueError, OverflowError) as exc:
        raise ExpressionEvaluationError(f'Expression evaluation failed: {exc}') from exc
