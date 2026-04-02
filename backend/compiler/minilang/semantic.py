from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple, Union

from backend.compiler.minilang.ast_nodes import (
    AssignmentNode,
    BinaryOpNode,
    IdentifierNode,
    IfNode,
    InputNode,
    LiteralNode,
    ParenNode,
    PrintNode,
    ProgramNode,
    Span,
    Stmt,
    UnaryOpNode,
)


class MiniLangSemanticError(Exception):
    pass


ValueType = str  # "number" | "string" | "bool" | "unknown"


@dataclass
class _Env:
    defined: Set[str]
    types: Dict[str, ValueType]


def analyze(program: ProgramNode) -> None:
    """
    Stage 3/4 (AST + semantic analysis): Validate variable usage and operator compatibility.
    """
    env = _Env(defined=set(), types={})
    for stmt in program.statements:
        _analyze_stmt(stmt, env)


def _err(span: Span, msg: str) -> MiniLangSemanticError:
    return MiniLangSemanticError(f"MiniLang SemanticError at line {span.line}, col {span.col}: {msg}")


def _analyze_stmt(stmt: Stmt, env: _Env) -> None:
    if isinstance(stmt, AssignmentNode):
        t = _analyze_expr(stmt.expr, env)
        env.defined.add(stmt.name)
        if t != "unknown":
            env.types[stmt.name] = t
        return
    if isinstance(stmt, PrintNode):
        _analyze_expr(stmt.expr, env)
        return
    if isinstance(stmt, IfNode):
        ct = _analyze_expr(stmt.condition, env)
        if ct not in ("bool", "unknown"):
            # condition is comparison op anyway, but keep check strict
            pass
        # allow definitions in IF to carry out (simple language)
        for s in stmt.then_body:
            _analyze_stmt(s, env)
        for s in stmt.else_body:
            _analyze_stmt(s, env)
        return
    if isinstance(stmt, InputNode):
        # INPUT assigns a value to a variable
        env.defined.add(stmt.name)
        env.types[stmt.name] = env.types.get(stmt.name, "unknown")
        return
    raise _err(stmt.span, f"Unknown statement type: {type(stmt).__name__}")


def _analyze_expr(expr, env: _Env) -> ValueType:
    if isinstance(expr, LiteralNode):
        if isinstance(expr.value, (int, float)):
            return "number"
        if isinstance(expr.value, str):
            return "string"
        return "unknown"
    if isinstance(expr, IdentifierNode):
        if expr.name not in env.defined:
            raise _err(expr.span, f"Undefined variable '{expr.name}'")
        return env.types.get(expr.name, "unknown")
    if isinstance(expr, ParenNode):
        return _analyze_expr(expr.expr, env)
    if isinstance(expr, UnaryOpNode):
        t = _analyze_expr(expr.expr, env)
        if expr.op in ("+", "-"):
            if t not in ("number", "unknown"):
                raise _err(expr.span, f"Unary '{expr.op}' expects a number")
            return "number"
        return "unknown"
    if isinstance(expr, BinaryOpNode):
        lt = _analyze_expr(expr.left, env)
        rt = _analyze_expr(expr.right, env)
        op = expr.op
        if op in ("+", "-", "*", "/"):
            if op == "+" and (lt == "string" or rt == "string"):
                # allow string concatenation; other ops remain numeric-only
                return "string" if (lt == "string" or rt == "string") else "unknown"
            if lt not in ("number", "unknown") or rt not in ("number", "unknown"):
                raise _err(expr.span, f"Operator '{op}' expects numbers")
            return "number"
        if op in ("<", ">", "<=", ">="):
            if lt not in ("number", "unknown") or rt not in ("number", "unknown"):
                raise _err(expr.span, f"Operator '{op}' expects numbers")
            return "bool"
        if op in ("==", "!="):
            if (lt == "string" and rt not in ("string", "unknown")) or (rt == "string" and lt not in ("string", "unknown")):
                raise _err(expr.span, f"Operator '{op}' expects matching operand types")
            return "bool"
        raise _err(expr.span, f"Unknown operator '{op}'")
    raise _err(getattr(expr, "span", Span(1, 1)), f"Unknown expression type: {type(expr).__name__}")

