from __future__ import annotations

from typing import List, Optional

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
    InputNode,
    UnaryOpNode,
)
from backend.compiler.minilang.lexer import Lexer, MiniLangLexError, Token


class MiniLangParseError(Exception):
    pass


class Parser:
    """
    Stage 2 (Parser): Convert tokens into an AST via recursive descent.
    Grammar (high level):
      program  := START stmt* STOP EOF
      stmt     := LET IDENT '=' expr
              |  PRINT expr
              |  IF cond THEN stmt* (ELSE stmt*)? END
              |  INPUT IDENT
      cond     := expr ( '<' | '>' | '==' | '!=' | '<=' | '>=' ) expr
      expr     := term (('+'|'-') term)*
      term     := factor (('*'|'/') factor)*
      factor   := ('+'|'-') factor | primary
      primary  := NUMBER | STRING | IDENT | '(' expr ')'
    """

    def __init__(self, tokens: List[Token]):
        self.tokens = tokens
        self.i = 0

    @staticmethod
    def from_source(src: str) -> "Parser":
        try:
            tokens = Lexer(src).tokenize()
        except MiniLangLexError as e:
            raise MiniLangParseError(str(e)) from e
        return Parser(tokens)

    def _peek(self) -> Token:
        return self.tokens[self.i]

    def _prev(self) -> Token:
        return self.tokens[self.i - 1]

    def _at(self, t: str) -> bool:
        return self._peek().type == t

    def _advance(self) -> Token:
        if self.i < len(self.tokens) - 1:
            self.i += 1
        return self._prev()

    def _match(self, *types: str) -> Optional[Token]:
        if self._peek().type in types:
            return self._advance()
        return None

    def _expect(self, t: str, msg: str) -> Token:
        if self._peek().type == t:
            return self._advance()
        tok = self._peek()
        raise MiniLangParseError(f"MiniLang ParseError at line {tok.line}, col {tok.col}: {msg}")

    def parse(self) -> ProgramNode:
        start = self._expect("START", "Program must begin with START")
        stmts: List[Stmt] = []
        while not self._at("STOP") and not self._at("EOF"):
            stmts.append(self._stmt())
        stop = self._expect("STOP", "Program must end with STOP")
        self._expect("EOF", "Unexpected tokens after STOP")
        return ProgramNode(span=Span(start.line, start.col), statements=stmts)

    def _stmt(self) -> Stmt:
        if self._match("LET"):
            name_tok = self._expect("IDENT", "Expected identifier after LET")
            self._expect("EQUAL", "Expected '=' in assignment")
            expr = self._expr()
            return AssignmentNode(span=Span(name_tok.line, name_tok.col), name=name_tok.value, expr=expr)

        if self._match("PRINT"):
            kw = self._prev()
            expr = self._expr()
            return PrintNode(span=Span(kw.line, kw.col), expr=expr)

        if self._match("IF"):
            kw = self._prev()
            cond = self._cond()
            self._expect("THEN", "Expected THEN after IF condition")
            then_body: List[Stmt] = []
            else_body: List[Stmt] = []
            while not self._at("END") and not self._at("ELSE") and not self._at("EOF"):
                then_body.append(self._stmt())
            if self._match("ELSE"):
                while not self._at("END") and not self._at("EOF"):
                    else_body.append(self._stmt())
            self._expect("END", "Expected END to close IF block")
            return IfNode(span=Span(kw.line, kw.col), condition=cond, then_body=then_body, else_body=else_body)

        if self._match("INPUT"):
            kw = self._prev()
            name_tok = self._expect("IDENT", "Expected identifier after INPUT")
            return InputNode(span=Span(kw.line, kw.col), name=name_tok.value)

        tok = self._peek()
        raise MiniLangParseError(f"MiniLang ParseError at line {tok.line}, col {tok.col}: Unexpected token {tok.type}")

    def _cond(self):
        left = self._expr()
        op_tok = self._match("LT", "GT", "EQEQ", "NEQ", "LE", "GE")
        if not op_tok:
            tok = self._peek()
            raise MiniLangParseError(
                f"MiniLang ParseError at line {tok.line}, col {tok.col}: Expected comparison operator (<, >, ==, !=, <=, >=)"
            )
        right = self._expr()
        return BinaryOpNode(span=Span(op_tok.line, op_tok.col), left=left, op=op_tok.value, right=right)

    def _expr(self):
        expr = self._term()
        while True:
            op = self._match("PLUS", "MINUS")
            if not op:
                break
            right = self._term()
            expr = BinaryOpNode(span=Span(op.line, op.col), left=expr, op=op.value, right=right)
        return expr

    def _term(self):
        expr = self._factor()
        while True:
            op = self._match("STAR", "SLASH")
            if not op:
                break
            right = self._factor()
            expr = BinaryOpNode(span=Span(op.line, op.col), left=expr, op=op.value, right=right)
        return expr

    def _factor(self):
        op = self._match("PLUS", "MINUS")
        if op:
            right = self._factor()
            return UnaryOpNode(span=Span(op.line, op.col), op=op.value, expr=right)
        return self._primary()

    def _primary(self):
        if (n := self._match("NUMBER")) is not None:
            v = float(n.value) if "." in n.value else int(n.value)
            return LiteralNode(span=Span(n.line, n.col), value=v)
        if (s := self._match("STRING")) is not None:
            return LiteralNode(span=Span(s.line, s.col), value=s.value)
        if (i := self._match("IDENT")) is not None:
            return IdentifierNode(span=Span(i.line, i.col), name=i.value)
        if (lp := self._match("LPAREN")) is not None:
            expr = self._expr()
            self._expect("RPAREN", "Expected ')' after expression")
            return ParenNode(span=Span(lp.line, lp.col), expr=expr)
        tok = self._peek()
        raise MiniLangParseError(f"MiniLang ParseError at line {tok.line}, col {tok.col}: Expected expression")

