from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


KEYWORDS = {
    "START",
    "STOP",
    "LET",
    "PRINT",
    "IF",
    "THEN",
    "ELSE",
    "END",
    "INPUT",
}


SINGLE_CHARS = {
    "(": "LPAREN",
    ")": "RPAREN",
    "+": "PLUS",
    "-": "MINUS",
    "*": "STAR",
    "/": "SLASH",
    "=": "EQUAL",
    "<": "LT",
    ">": "GT",
}


@dataclass(frozen=True)
class Token:
    type: str
    value: str
    line: int
    col: int


class MiniLangLexError(Exception):
    pass


class Lexer:
    """
    Stage 1 (Lexer): Convert source text into a token stream with line/column.
    """

    def __init__(self, src: str):
        self.src = src.replace("\r\n", "\n").replace("\r", "\n")
        self.i = 0
        self.line = 1
        self.col = 1

    def _peek(self) -> str:
        if self.i >= len(self.src):
            return "\0"
        return self.src[self.i]

    def _advance(self) -> str:
        ch = self._peek()
        if ch == "\0":
            return ch
        self.i += 1
        if ch == "\n":
            self.line += 1
            self.col = 1
        else:
            self.col += 1
        return ch

    def _match(self, expected: str) -> bool:
        if self._peek() == expected:
            self._advance()
            return True
        return False

    def _err(self, msg: str, line: Optional[int] = None, col: Optional[int] = None) -> MiniLangLexError:
        l = self.line if line is None else line
        c = self.col if col is None else col
        return MiniLangLexError(f"MiniLang LexError at line {l}, col {c}: {msg}")

    def tokenize(self) -> List[Token]:
        tokens: List[Token] = []
        while True:
            ch = self._peek()
            if ch == "\0":
                tokens.append(Token("EOF", "", self.line, self.col))
                return tokens

            if ch in (" ", "\t", "\n"):
                self._advance()
                continue

            start_line, start_col = self.line, self.col

            if ch == "#":
                while self._peek() not in ("\n", "\0"):
                    self._advance()
                continue

            if ch == '"':
                self._advance()
                buf = []
                while True:
                    p = self._peek()
                    if p == "\0":
                        raise self._err("Unterminated string literal", start_line, start_col)
                    if p == '"':
                        self._advance()
                        break
                    if p == "\\":
                        self._advance()
                        esc = self._peek()
                        if esc == "\0":
                            raise self._err("Unterminated escape sequence", self.line, self.col)
                        self._advance()
                        if esc == "n":
                            buf.append("\n")
                        elif esc == "t":
                            buf.append("\t")
                        elif esc == '"':
                            buf.append('"')
                        elif esc == "\\":
                            buf.append("\\")
                        else:
                            raise self._err(f"Unknown escape: \\{esc}", self.line, self.col)
                        continue
                    buf.append(self._advance())
                tokens.append(Token("STRING", "".join(buf), start_line, start_col))
                continue

            if ch.isdigit():
                buf = [self._advance()]
                while self._peek().isdigit():
                    buf.append(self._advance())
                if self._peek() == ".":
                    buf.append(self._advance())
                    if not self._peek().isdigit():
                        raise self._err("Invalid number literal", self.line, self.col)
                    while self._peek().isdigit():
                        buf.append(self._advance())
                tokens.append(Token("NUMBER", "".join(buf), start_line, start_col))
                continue

            if ch.isalpha() or ch == "_":
                buf = [self._advance()]
                while True:
                    p = self._peek()
                    if p.isalnum() or p == "_":
                        buf.append(self._advance())
                        continue
                    break
                text = "".join(buf)
                upper = text.upper()
                if upper in KEYWORDS:
                    tokens.append(Token(upper, upper, start_line, start_col))
                else:
                    tokens.append(Token("IDENT", text, start_line, start_col))
                continue

            # two-char operators
            if ch == "<" and self.src[self.i : self.i + 2] == "<=":
                self._advance()
                self._advance()
                tokens.append(Token("LE", "<=", start_line, start_col))
                continue
            if ch == ">" and self.src[self.i : self.i + 2] == ">=":
                self._advance()
                self._advance()
                tokens.append(Token("GE", ">=", start_line, start_col))
                continue
            if ch == "!" and self.src[self.i : self.i + 2] == "!=":
                self._advance()
                self._advance()
                tokens.append(Token("NEQ", "!=", start_line, start_col))
                continue

            if ch == "=" and self.src[self.i : self.i + 2] == "==":
                self._advance()
                self._advance()
                tokens.append(Token("EQEQ", "==", start_line, start_col))
                continue

            if ch in SINGLE_CHARS:
                t = SINGLE_CHARS[ch]
                self._advance()
                tokens.append(Token(t, ch, start_line, start_col))
                continue

            raise self._err(f"Unexpected character: {repr(ch)}", start_line, start_col)

