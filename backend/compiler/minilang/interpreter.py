from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

from backend.compiler.minilang.ast_nodes import (
    AssignmentNode,
    BinaryOpNode,
    IdentifierNode,
    IfNode,
    LiteralNode,
    ParenNode,
    PrintNode,
    ProgramNode,
    Span,
    Stmt,
    UnaryOpNode,
)
from backend.compiler.minilang.parser import MiniLangParseError, Parser
from backend.compiler.minilang.semantic import MiniLangSemanticError, analyze


class MiniLangRuntimeError(Exception):
    pass


@dataclass
class _Context:
    variables: Dict[str, Any]
    output: List[str]
    steps: int
    step_limit: int


def run_minilang(source: str, *, step_limit: int = 50_000) -> str:
    """
    Stage 5 (Interpreter): Parse + analyze + execute.
    Returns stdout as a single string (lines separated by \\n).
    """
    program = Parser.from_source(source).parse()
    analyze(program)
    ctx = _Context(variables={}, output=[], steps=0, step_limit=step_limit)
    _exec_program(program, ctx)
    return "\n".join(ctx.output)


def _rt_err(span: Span, msg: str) -> MiniLangRuntimeError:
    return MiniLangRuntimeError(f"MiniLang RuntimeError at line {span.line}, col {span.col}: {msg}")


def _step(ctx: _Context, span: Span) -> None:
    ctx.steps += 1
    if ctx.steps > ctx.step_limit:
        raise _rt_err(span, f"Execution step limit exceeded ({ctx.step_limit}).")


def _exec_program(program: ProgramNode, ctx: _Context) -> None:
    for stmt in program.statements:
        _exec_stmt(stmt, ctx)


def _exec_stmt(stmt: Stmt, ctx: _Context) -> None:
    _step(ctx, stmt.span)
    if isinstance(stmt, AssignmentNode):
        ctx.variables[stmt.name] = _eval_expr(stmt.expr, ctx)
        return
    if isinstance(stmt, PrintNode):
        v = _eval_expr(stmt.expr, ctx)
        ctx.output.append(_to_string(v))
        return
    if isinstance(stmt, IfNode):
        cond = _eval_expr(stmt.condition, ctx)
        if _truthy(cond):
            for s in stmt.then_body:
                _exec_stmt(s, ctx)
        return
    raise _rt_err(stmt.span, f"Unknown statement type: {type(stmt).__name__}")


def _eval_expr(expr, ctx: _Context) -> Any:
    _step(ctx, expr.span)
    if isinstance(expr, LiteralNode):
        return expr.value
    if isinstance(expr, IdentifierNode):
        if expr.name not in ctx.variables:
            raise _rt_err(expr.span, f"Undefined variable '{expr.name}'")
        return ctx.variables[expr.name]
    if isinstance(expr, ParenNode):
        return _eval_expr(expr.expr, ctx)
    if isinstance(expr, UnaryOpNode):
        v = _eval_expr(expr.expr, ctx)
        if expr.op == "+":
            return _to_number(v, expr.span)
        if expr.op == "-":
            n = _to_number(v, expr.span)
            return -n
        raise _rt_err(expr.span, f"Unknown unary operator '{expr.op}'")
    if isinstance(expr, BinaryOpNode):
        op = expr.op
        if op in ("+", "-", "*", "/"):
            a = _eval_expr(expr.left, ctx)
            b = _eval_expr(expr.right, ctx)
            if op == "+" and (isinstance(a, str) or isinstance(b, str)):
                return _to_string(a) + _to_string(b)
            na = _to_number(a, expr.span)
            nb = _to_number(b, expr.span)
            if op == "+":
                return _num_binop(na, nb, "+")
            if op == "-":
                return _num_binop(na, nb, "-")
            if op == "*":
                return _num_binop(na, nb, "*")
            if op == "/":
                if nb == 0:
                    raise _rt_err(expr.span, "Division by zero")
                return na / nb
        if op in ("<", ">", "=="):
            a = _eval_expr(expr.left, ctx)
            b = _eval_expr(expr.right, ctx)
            if op == "==":
                return a == b
            na = _to_number(a, expr.span)
            nb = _to_number(b, expr.span)
            return na < nb if op == "<" else na > nb
        raise _rt_err(expr.span, f"Unknown operator '{op}'")
    raise _rt_err(getattr(expr, "span", Span(1, 1)), f"Unknown expression type: {type(expr).__name__}")


def _to_string(v: Any) -> str:
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    return str(v)


def _truthy(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return len(v) > 0
    return bool(v)


def _num_binop(a: float | int, b: float | int, op: str) -> float | int:
    # Preserve integers when both operands are ints (except division).
    if isinstance(a, int) and isinstance(b, int):
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
    # Fall back to float math
    af = float(a)
    bf = float(b)
    if op == "+":
        return af + bf
    if op == "-":
        return af - bf
    if op == "*":
        return af * bf
    raise ValueError("Unsupported op")


def _to_number(v: Any, span: Span) -> float | int:
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v) if "." in v else int(v)
        except Exception as e:
            raise _rt_err(span, f"Expected number, got string '{v}'") from e
    raise _rt_err(span, f"Expected number, got {type(v).__name__}")

