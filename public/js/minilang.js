// MiniLang — a tiny teaching language.
// Pipeline: lexer -> parser (AST) -> semantic analysis -> tree-walking interpreter.
// Pure ES module with no DOM or Node dependencies, so it runs in the browser,
// in a Web Worker, and under `node --test`.

export class MiniLangError extends Error {
  // A MiniLang failure that knows which phase raised it and where.
  constructor(type, message, line, col) {
    super(`MiniLang ${type} at line ${line}, col ${col}: ${message}`);
    this.name = "MiniLangError";
    this.type = type; // "LexError" | "ParseError" | "SemanticError" | "RuntimeError"
    this.reason = message;
    this.line = line;
    this.col = col;
  }
}

/** Thrown when INPUT is reached and stdin has no lines left. */
export class InputNeeded extends Error {
  // Carries whatever the program printed before it ran out of input.
  constructor(varName, output, line, col) {
    super(`Waiting for input for '${varName}' at line ${line}, col ${col}`);
    this.name = "InputNeeded";
    this.varName = varName;
    this.output = output;
    this.line = line;
    this.col = col;
  }
}

/* ───────────────────────────── Lexer ───────────────────────────── */

const KEYWORDS = new Set(["START", "STOP", "LET", "PRINT", "IF", "THEN", "ELSE", "END", "INPUT"]);
const SINGLE = { "(": "LPAREN", ")": "RPAREN", "+": "PLUS", "-": "MINUS", "*": "STAR", "/": "SLASH", "=": "EQUAL", "<": "LT", ">": "GT" };
const TWO_CHAR = { "<=": "LE", ">=": "GE", "!=": "NEQ", "==": "EQEQ" };
const ESCAPES = { n: "\n", t: "\t", '"': '"', "\\": "\\" };

// Character tests the lexer leans on.
const isDigit = (c) => c >= "0" && c <= "9";
// Identifier characters, including the underscore.
const isAlpha = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";

// Stage 1. Turn source text into tokens, each carrying its line and column.
export function tokenize(source) {
  const src = source.replace(/\r\n?/g, "\n");
  const tokens = [];
  let i = 0, line = 1, col = 1;

  // Look at a character without consuming it.
  const peek = (o = 0) => src[i + o] ?? "\0";
  // Consume one character, keeping the line and column counters honest.
  const advance = () => {
    const ch = src[i++];
    if (ch === "\n") { line++; col = 1; } else col++;
    return ch;
  };
  // Abort lexing with a positioned error.
  const fail = (msg, l = line, c = col) => { throw new MiniLangError("LexError", msg, l, c); };

  while (i < src.length) {
    const ch = peek();
    if (ch === " " || ch === "\t" || ch === "\n") { advance(); continue; }
    if (ch === "#") { while (i < src.length && peek() !== "\n") advance(); continue; }

    const sl = line, sc = col;

    if (ch === '"') {
      advance();
      let buf = "";
      for (;;) {
        if (i >= src.length) fail("Unterminated string literal", sl, sc);
        const p = advance();
        if (p === '"') break;
        if (p === "\\") {
          if (i >= src.length) fail("Unterminated escape sequence");
          const esc = advance();
          if (!(esc in ESCAPES)) fail(`Unknown escape: \\${esc}`);
          buf += ESCAPES[esc];
        } else buf += p;
      }
      tokens.push({ type: "STRING", value: buf, line: sl, col: sc });
      continue;
    }

    if (isDigit(ch)) {
      let buf = "";
      while (isDigit(peek())) buf += advance();
      if (peek() === ".") {
        buf += advance();
        if (!isDigit(peek())) fail("Invalid number literal");
        while (isDigit(peek())) buf += advance();
      }
      tokens.push({ type: "NUMBER", value: buf, line: sl, col: sc });
      continue;
    }

    if (isAlpha(ch)) {
      let buf = "";
      while (isAlpha(peek()) || isDigit(peek())) buf += advance();
      const upper = buf.toUpperCase();
      tokens.push(KEYWORDS.has(upper)
        ? { type: upper, value: upper, line: sl, col: sc }
        : { type: "IDENT", value: buf, line: sl, col: sc });
      continue;
    }

    const two = src.slice(i, i + 2);
    if (two in TWO_CHAR) {
      advance(); advance();
      tokens.push({ type: TWO_CHAR[two], value: two, line: sl, col: sc });
      continue;
    }
    if (ch in SINGLE) {
      advance();
      tokens.push({ type: SINGLE[ch], value: ch, line: sl, col: sc });
      continue;
    }
    fail(`Unexpected character: ${JSON.stringify(ch)}`, sl, sc);
  }
  tokens.push({ type: "EOF", value: "", line, col });
  return tokens;
}

/* ───────────────────────────── Parser ─────────────────────────────
   program := START stmt* STOP EOF
   stmt    := LET IDENT '=' expr | PRINT expr | INPUT IDENT
            | IF cond THEN stmt* (ELSE stmt*)? END
   cond    := expr ('<' | '>' | '==' | '!=' | '<=' | '>=') expr
   expr    := term (('+'|'-') term)*
   term    := factor (('*'|'/') factor)*
   factor  := ('+'|'-') factor | primary
   primary := NUMBER | STRING | IDENT | '(' expr ')'
*/

// Stage 2. Turn tokens into an abstract syntax tree by recursive descent.
export function parse(tokens) {
  let i = 0;
  // The token we are looking at.
  const peek = () => tokens[i];
  // Is the current token of this type?
  const at = (t) => peek().type === t;
  // Consume the current token, stopping at the end of the stream.
  const advance = () => (i < tokens.length - 1 ? tokens[i++] : tokens[i]);
  // Consume the current token only if it is one of these types.
  const match = (...types) => (types.includes(peek().type) ? advance() : null);
  const fail = (msg, tok = peek()) => { throw new MiniLangError("ParseError", msg, tok.line, tok.col); };
  // Consume a required token, or fail with a positioned message.
  const expect = (t, msg) => (at(t) ? advance() : fail(msg));

  // One statement: LET, PRINT, INPUT or an IF block.
  const stmt = () => {
    let t;
    if ((t = match("LET"))) {
      const name = expect("IDENT", "Expected identifier after LET");
      expect("EQUAL", "Expected '=' in assignment");
      return { kind: "let", name: name.value, expr: expr(), line: name.line, col: name.col };
    }
    if ((t = match("PRINT"))) return { kind: "print", expr: expr(), line: t.line, col: t.col };
    if ((t = match("INPUT"))) {
      const name = expect("IDENT", "Expected identifier after INPUT");
      return { kind: "input", name: name.value, line: t.line, col: t.col };
    }
    if ((t = match("IF"))) {
      const cond = condition();
      expect("THEN", "Expected THEN after IF condition");
      const thenBody = [], elseBody = [];
      while (!at("END") && !at("ELSE") && !at("EOF")) thenBody.push(stmt());
      if (match("ELSE")) while (!at("END") && !at("EOF")) elseBody.push(stmt());
      expect("END", "Expected END to close IF block");
      return { kind: "if", cond, thenBody, elseBody, line: t.line, col: t.col };
    }
    return fail(`Unexpected token ${peek().type}`);
  };

  // A comparison between two expressions, which is all IF accepts.
  const condition = () => {
    const left = expr();
    const op = match("LT", "GT", "EQEQ", "NEQ", "LE", "GE");
    if (!op) fail("Expected comparison operator (<, >, ==, !=, <=, >=)");
    return { kind: "bin", op: op.value, left, right: expr(), line: op.line, col: op.col };
  };

  // Build a left-associative operator level out of the level below it.
  const binary = (next, ...ops) => () => {
    let left = next();
    for (let op; (op = match(...ops)); ) {
      left = { kind: "bin", op: op.value, left, right: next(), line: op.line, col: op.col };
    }
    return left;
  };

  // A literal, a variable, or a parenthesised expression.
  const primary = () => {
    let t;
    if ((t = match("NUMBER"))) return { kind: "num", value: Number(t.value), line: t.line, col: t.col };
    if ((t = match("STRING"))) return { kind: "str", value: t.value, line: t.line, col: t.col };
    if ((t = match("IDENT"))) return { kind: "var", name: t.value, line: t.line, col: t.col };
    if ((t = match("LPAREN"))) {
      const inner = expr();
      expect("RPAREN", "Expected ')' after expression");
      return { kind: "paren", expr: inner, line: t.line, col: t.col };
    }
    return fail("Expected expression");
  };
  // An optional leading sign in front of a primary.
  const factor = () => {
    const op = match("PLUS", "MINUS");
    return op ? { kind: "unary", op: op.value, expr: factor(), line: op.line, col: op.col } : primary();
  };
  const term = binary(factor, "STAR", "SLASH");
  const expr = binary(term, "PLUS", "MINUS");

  const start = expect("START", "Program must begin with START");
  const body = [];
  while (!at("STOP") && !at("EOF")) body.push(stmt());
  expect("STOP", "Program must end with STOP");
  expect("EOF", "Unexpected tokens after STOP");
  return { kind: "program", body, line: start.line, col: start.col };
}

/* ─────────────────────── Semantic analysis ───────────────────────
   Static checks: undefined variables and operator/type compatibility.
   Types are "number" | "string" | "bool" | "unknown" (unknown always passes). */

// Stage 3. Walk the tree and reject undefined variables and impossible operations.
export function analyze(program) {
  const defined = new Set();
  const types = new Map();
  // Abort the check with the offending node's position.
  const fail = (n, msg) => { throw new MiniLangError("SemanticError", msg, n.line, n.col); };
  // Numbers pass, and so does anything we could not work out.
  const numeric = (t) => t === "number" || t === "unknown";

  // Work out the type of an expression, complaining when the operands do not fit.
  const typeOf = (e) => {
    switch (e.kind) {
      case "num": return "number";
      case "str": return "string";
      case "paren": return typeOf(e.expr);
      case "var":
        if (!defined.has(e.name)) fail(e, `Undefined variable '${e.name}'`);
        return types.get(e.name) ?? "unknown";
      case "unary":
        if (!numeric(typeOf(e.expr))) fail(e, `Unary '${e.op}' expects a number`);
        return "number";
      case "bin": {
        const l = typeOf(e.left), r = typeOf(e.right);
        if (e.op === "+" && (l === "string" || r === "string")) return "string";
        if ("+-*/".includes(e.op)) {
          if (!numeric(l) || !numeric(r)) fail(e, `Operator '${e.op}' expects numbers`);
          return "number";
        }
        if (e.op === "==" || e.op === "!=") {
          // Comparing a string with a non-string is a mistake worth reporting.
          const mismatch = (a, b) => a === "string" && b !== "string" && b !== "unknown";
          if (mismatch(l, r) || mismatch(r, l)) fail(e, `Operator '${e.op}' expects matching operand types`);
          return "bool";
        }
        if (!numeric(l) || !numeric(r)) fail(e, `Operator '${e.op}' expects numbers`);
        return "bool";
      }
    }
  };

  // Check one statement, recording the variables it defines.
  const check = (s) => {
    if (s.kind === "let") {
      const t = typeOf(s.expr);
      defined.add(s.name);
      if (t !== "unknown") types.set(s.name, t);
    } else if (s.kind === "print") typeOf(s.expr);
    else if (s.kind === "input") { defined.add(s.name); types.set(s.name, types.get(s.name) ?? "unknown"); }
    else if (s.kind === "if") { typeOf(s.cond); s.thenBody.forEach(check); s.elseBody.forEach(check); }
  };
  program.body.forEach(check);
}

/* ─────────────────────────── Interpreter ─────────────────────────── */

// Print values the way MiniLang spells them.
const show = (v) => (v === true ? "true" : v === false ? "false" : String(v));
const NUMERIC_RE = /^\s*-?\d+(\.\d+)?\s*$/;

/**
 * Run a MiniLang program.
 * @returns {{ok: boolean, status: "OK"|"ERROR"|"WAITING_FOR_INPUT", stdout: string, error?: object, inputVar?: string}}
 */
export function run(source, { stdin = "", stepLimit = 50_000 } = {}) {
  const output = [];
  try {
    const program = parse(tokenize(source));
    analyze(program);
    execute(program, { stdin, stepLimit, output });
    return { ok: true, status: "OK", stdout: output.join("\n") };
  } catch (e) {
    if (e instanceof InputNeeded) {
      return { ok: false, status: "WAITING_FOR_INPUT", stdout: output.join("\n"), inputVar: e.varName, error: { type: "InputNeeded", message: e.message, line: e.line, col: e.col } };
    }
    if (e instanceof MiniLangError) {
      return { ok: false, status: "ERROR", stdout: output.join("\n"), error: { type: e.type, message: e.message, line: e.line, col: e.col } };
    }
    if (e instanceof RangeError) {
      return { ok: false, status: "ERROR", stdout: output.join("\n"), error: { type: "RuntimeError", message: "MiniLang RuntimeError: program nests too deeply", line: 1, col: 1 } };
    }
    throw e;
  }
}

// Stage 4. Walk the tree and actually run it.
function execute(program, { stdin, stepLimit, output }) {
  const vars = new Map();
  const lines = stdin === "" ? [] : stdin.replace(/\r\n?/g, "\n").split("\n");
  let stdinIdx = 0, steps = 0;

  // A runtime error carrying the position of the node that raised it.
  const rtErr = (n, msg) => new MiniLangError("RuntimeError", msg, n.line, n.col);
  // Count a step and stop the program if it runs away.
  const tick = (n) => { if (++steps > stepLimit) throw rtErr(n, `Execution step limit exceeded (${stepLimit}).`); };
  // Coerce a value to a number, or explain why that is impossible.
  const toNumber = (v, n) => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && NUMERIC_RE.test(v)) return Number(v);
    throw rtErr(n, typeof v === "string" ? `Expected number, got string '${v}'` : `Expected number, got ${typeof v}`);
  };

  // Evaluate one expression node.
  const evalExpr = (e) => {
    tick(e);
    switch (e.kind) {
      case "num": case "str": return e.value;
      case "paren": return evalExpr(e.expr);
      case "var":
        if (!vars.has(e.name)) throw rtErr(e, `Undefined variable '${e.name}'`);
        return vars.get(e.name);
      case "unary": {
        const n = toNumber(evalExpr(e.expr), e);
        return e.op === "-" ? -n : n;
      }
      case "bin": {
        const a = evalExpr(e.left), b = evalExpr(e.right);
        switch (e.op) {
          case "==": return a === b;
          case "!=": return a !== b;
          case "+":
            if (typeof a === "string" || typeof b === "string") return show(a) + show(b);
        }
        const x = toNumber(a, e), y = toNumber(b, e);
        switch (e.op) {
          case "+": return x + y;
          case "-": return x - y;
          case "*": return x * y;
          case "/": if (y === 0) throw rtErr(e, "Division by zero"); return x / y;
          case "<": return x < y;
          case ">": return x > y;
          case "<=": return x <= y;
          case ">=": return x >= y;
        }
      }
    }
    throw rtErr(e, `Unknown expression type: ${e.kind}`);
  };

  // Run one statement node.
  const exec = (s) => {
    tick(s);
    switch (s.kind) {
      case "let": vars.set(s.name, evalExpr(s.expr)); break;
      case "print": output.push(show(evalExpr(s.expr))); break;
      case "if": (evalExpr(s.cond) ? s.thenBody : s.elseBody).forEach(exec); break;
      case "input": {
        tick(s);
        if (stdinIdx >= lines.length) throw new InputNeeded(s.name, output.join("\n"), s.line, s.col);
        const raw = lines[stdinIdx++];
        vars.set(s.name, NUMERIC_RE.test(raw) ? Number(raw) : raw);
        break;
      }
    }
  };

  program.body.forEach(exec);
}
