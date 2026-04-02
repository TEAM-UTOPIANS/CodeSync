from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class Span:
    line: int
    col: int


class Node:
    span: Span


@dataclass(frozen=True)
class ProgramNode(Node):
    span: Span
    statements: List[Stmt]


class Stmt(Node):
    pass


class Expr(Node):
    pass


@dataclass(frozen=True)
class AssignmentNode(Stmt):
    span: Span
    name: str
    expr: Expr


@dataclass(frozen=True)
class PrintNode(Stmt):
    span: Span
    expr: Expr


@dataclass(frozen=True)
class IfNode(Stmt):
    span: Span
    condition: Expr
    then_body: List[Stmt]
    else_body: List[Stmt]


@dataclass(frozen=True)
class InputNode(Stmt):
    span: Span
    name: str


@dataclass(frozen=True)
class BinaryOpNode(Expr):
    span: Span
    left: Expr
    op: str
    right: Expr


@dataclass(frozen=True)
class UnaryOpNode(Expr):
    span: Span
    op: str
    expr: Expr


@dataclass(frozen=True)
class LiteralNode(Expr):
    span: Span
    value: object


@dataclass(frozen=True)
class IdentifierNode(Expr):
    span: Span
    name: str


@dataclass(frozen=True)
class ParenNode(Expr):
    span: Span
    expr: Expr


Stmt.__annotations__ = {}  # type: ignore[attr-defined]
Expr.__annotations__ = {}  # type: ignore[attr-defined]

