
## Code Sync – Real-Time Collaborative IDE

This repository is a production-structured collaborative web IDE built with a Python Flask backend and a modern browser frontend. It supports real-time rooms (code sync, cursors, chat, presence, roles), language execution via Judge0, and a built-in educational language called MiniLang.

Purpose of this README
- Provide a clear project overview and quick start.
- Give a detailed, navigable description of the code structure so developers can find and understand every major component.

Highlights
- Real-time collaborative rooms with role-based permissions.
- Judge0 integration for sandboxed language execution (Python/C++/Java).
- MiniLang interpreter implemented in Python (lexer → parser → AST → semantic analysis → interpreter).
- Simple Solo Compiler page for quick runs outside of rooms.

Quick start (local)
1. Copy the env template:

   cp .env.example .env

   If using RapidAPI Judge0, set `JUDGE0_RAPIDAPI_KEY` (and host if needed) in `.env`.

2. Install Python dependencies:

```bash
python3 -m pip install -r requirements.txt
```

3. Activate your virtualenv (optional) and run the app:

```bash
source venv/bin/activate
python3 run.py
```

4. Open the UI:
- Local: http://127.0.0.1:5000
- LAN (same Wi‑Fi): use the printed LAN URL, e.g. http://192.168.x.x:5000

Notes
- `run.py` will attempt to free the configured port (default `5000`) by terminating any process listening on it. Set `SKIP_PORT_KILL=1` in `.env` to opt out.
- On macOS the Socket.IO server uses threading mode by default due to eventlet/kqueue issues; on Linux eventlet is used automatically.

Environment variables (main ones)
- `FLASK_ENV` – development/production.
- `PORT` – HTTP port (default 5000).
- `USE_REDIS` – enable Redis-backed rooms/presence.
- `REDIS_URL` – Redis connection string.
- `JUDGE0_RAPIDAPI_KEY` – optional API key for Judge0 RapidAPI integration.
- `SKIP_PORT_KILL` – set to `1` to skip automatic port freeing.

Tech stack — what we used and why
- **Python 3 + Flask**: lightweight, fast to iterate with, excellent ecosystem for web backends and easy integration with Socket.IO.
  - Why: rapid development, readability, and good support for synchronous and asynchronous Socket.IO modes.
- **python-socketio / Flask-SocketIO**: real-time WebSocket (and fallback) support for presence, cursor sync, and chat.
  - Why: integrates cleanly with Flask, has production options (eventlet/gevent/threading), and supports rooms out of the box.
- **Judge0 (external service)**: sandboxed code execution for mainstream languages (Python/C++/Java).
  - Why: secure, language-agnostic execution with standard APIs; avoids running untrusted code locally.
- **Monaco Editor (frontend)**: powerful code editor used by VSCode, provides language features and is embeddable.
  - Why: excellent UX for code editing, syntax highlighting, and integrations like markers for errors.
- **Vanilla JS + small helpers**: keep frontend logic minimal and framework-agnostic so it's easy to embed into static pages.
  - Why: simplicity and small bundle sizes; easier to maintain for a focused tool.
- **Redis (optional)**: used for scaling presence/rooms across multiple server instances.
  - Why: fast in-memory store for shared state and pub/sub for Socket.IO scaling.

High-level repo layout

High-level repo layout

Root files
- `run.py` – application entrypoint. Boots the Flask app + Socket.IO, prints LAN URL, and optionally kills processes on the port.
- `requirements.txt` – Python dependencies.
- `vercel.json` – deployment config for Vercel (if used for static hosting or serverless parts).

Frontend (directory: `frontend/`)
- `index.html` – Home page (create/join rooms).
- `ide.html` – Room IDE page (Monaco editor, real-time sync, chat, presence).
- `compiler.html` – Solo compiler page (Monaco + run/output UI).
- `app.js`, `home.js`, `compiler.js`, `terminal.js` – client logic for pages and integrations.

Backend (directory: `backend/`)
- `app.py` – Flask application factory and setup (initializes Socket.IO, blueprints, error handling).
- `config.py` – configuration loader (reads `.env` and exposes settings).
- `controllers/` – higher-level request handlers that orchestrate work between services and routes.
  - `execution_controller.py` – handles code execution requests (routes → controller → services).
  - `room_controller.py` – room lifecycle and room-level operations.
- `routes/` – Flask route definitions (blueprints) that connect HTTP endpoints to controllers.
  - `execution_routes.py` – `/api/execute` and related execution endpoints.
  - `room_routes.py` – endpoints for room creation/joining and room metadata.
- `services/` – encapsulated business logic and external integrations.
  - `judge0_service.py` – REST client for submitting code to Judge0 and polling results.
  - `room_service.py` – room data management (in-memory or Redis-backed depending on config).
- `sockets/` – Socket.IO event handlers and real-time synchronization.
  - `socket_handlers.py` – connection, join/leave, cursor updates, code patches, chat messages.
- `utils/` – helpful utilities and security helpers.
  - `helpers.py` – common helper functions used across backend.
  - `security.py` – token generation, basic sanitization helpers.

Compiler / MiniLang (directory: `backend/compiler/minilang/`)
- `lexer.py` – tokenizes MiniLang source into tokens with line/column metadata. Handles strings with escapes and `#` comments.
- `parser.py` – parses tokens into an AST, applies precedence and expression grouping.
- `ast_nodes.py` – AST node classes and helpers for traversal and printing.
- `semantic.py` – static/semantic analysis (detect undefined variables, type issues, invalid operations). Emits `SemanticError` with line/col.
- `interpreter.py` – executes the AST with a step limit, runtime checks, and I/O emulation for `INPUT` statements.

MiniLang — detailed overview & walkthrough

MiniLang is a deliberately small interpreted language implemented inside the Python backend for teaching and quick experiments. It emphasizes clarity (explicit `START`/`STOP` program structure), predictable semantics, and useful error reporting (line/column for frontend highlights).

Language essentials
- Program structure: every program must begin with `START` and end with `STOP`.
- Statements:
  - `LET <identifier> = <expr>` — assign an expression to a variable.
  - `PRINT <expr>` — evaluate and print the expression to output (supports string concatenation).
  - `IF <condition> THEN` ... optional `ELSE` ... `END` — guarded blocks.
  - `INPUT <identifier>` — read a line from the provided stdin lines and assign to identifier.
- Expressions:
  - Numeric literals (`10`, `3.14`) and arithmetic: `+ - * /`.
  - Strings with escapes: `"hello"`, supports `\n`, `\t`, `\"`, `\\`.
  - Identifiers: `x`, `total_sum`.
  - Comparisons: `== != < > <= >=` returning boolean values for `IF` conditions.
  - Parentheses for grouping: `( ... )`.
  - String concatenation via `+` (mixed type concatenation coerces numbers to strings when used with strings in `PRINT`).
- Comments: `#` to end of line.

Execution model and safety
- The interpreter runs in these phases: lexing → parsing → semantic analysis → interpretation.
  1. Lexer converts source text into tokens with line/column metadata. Lexing errors are reported with position.
  2. Parser builds an AST and enforces grammar rules. Syntax errors include location and a short message.
  3. Semantic analysis verifies defined variables and type-appropriate operations; emits `SemanticError` with location.
  4. Interpreter executes the AST with a configurable step limit to prevent infinite loops or runaway resource usage. When the step limit is exceeded, a `RuntimeError` is raised.
- I/O model: `INPUT` reads from a supplied input queue (execution payload includes an array of input lines). `PRINT` appends to the execution output buffer.

Error handling and frontend integration
- Errors (parse/semantic/runtime) include `line` and `column` to enable the frontend to highlight the exact token or statement.
- Interpreter returns a structured response: `{ ok: bool, stdout: string, stderr: string, error_type: string?, error_line?: int, error_column?: int }`.

Detailed walkthrough (what happens on a run)
1. Client sends code + optional stdin lines to `/api/execute` with language `minilang`.
2. `execution_controller` routes the request to the MiniLang runner in `backend/compiler/minilang`.
3. The runner calls `lexer.tokenize(source)` producing tokens with positions.
   - If lexing fails, a `ParseError` with position is returned immediately.
4. Tokens are fed into `parser.parse(tokens)` to produce an AST.
   - Parser errors are reported as `ParseError` with line/column.
5. The AST is checked by `semantic.analyze(ast)` which ensures variables are defined before use and that operations make sense.
   - Any `SemanticError` contains the offending node position.
6. If semantic checks pass, `interpreter.run(ast, inputs, step_limit=10000)` executes the program, producing stdout and consuming inputs.
   - The interpreter enforces guards (division by zero, invalid operations) and step counting. Runtime errors include position info where applicable.
7. The controller returns the structured execution result to the frontend which shows stdout or highlights the error location.

MiniLang example programs

1) Basic arithmetic and prints

```text
START
LET x = 10
LET y = 20
LET sum = x + y
PRINT "Sum: " + sum
STOP
```

Produces:
```
Sum: 30
```

2) If/Else and comparisons

```text
START
LET a = 5
LET b = 8
IF a < b THEN
  PRINT "a is smaller"
ELSE
  PRINT "a is not smaller"
END
STOP
```

3) Strings, escapes and concatenation

```text
START
LET name = "Alice"
PRINT "Hello, " + name + "\nWelcome!"
STOP
```

4) Input and runtime checks

```text
START
PRINT "Enter a number:"
INPUT n
LET num = n
PRINT "You entered: " + num
STOP
```

5) Example showing a runtime error (division by zero)

```text
START
LET x = 10
LET y = 0
LET z = x / y
PRINT z
STOP
```

Runtime result: `RuntimeError` with message like "division by zero" and a line/column pointing at `x / y`.

Tips for contributors working on MiniLang
- Add unit tests for each phase: tokenization, parsing, semantic checks, and interpretation. Small, focused fixtures make debugging easier.
- Keep the interpreter step counter logic well-tested — most runaway programs are prevented there.
- Ensure error objects include `line` and `column`; frontend tests rely on stable error shapes for highlighting.

Execution flow (languages)
- MiniLang: handled entirely inside `backend/compiler/minilang` and executed by the `execution_controller` without Judge0.
- Other languages (Python/C++/Java): `execution_controller` uses `judge0_service` to submit code to Judge0, then polls for results and returns output, compile errors, or runtime errors to the client.

Real-time collaboration (Socket.IO)
- The Socket.IO server broadcasts edits, presence, cursor positions, and chat messages.
- Rooms may be persisted in memory or in Redis if `USE_REDIS=1`.
- Roles: `host` (first joiner, can change language), `editor` (can edit), `viewer` (read-only).

Developer notes
- To run locally: `python3 run.py` (see Quick start above).
- If you change backend code, restart the server. In development set `FLASK_ENV=development`.
- To simulate multi-user behavior, open the LAN URL on another device or open multiple browser tabs.

Testing and debugging
- There are no formal unit tests included in this repository by default. Recommended approach:
  - Unit test MiniLang components (`lexer`, `parser`, `semantic`, `interpreter`) separately.
  - Mock the `judge0_service` for integration tests of the `execution_controller`.

Deployment
- This app can be deployed behind a WSGI server or via serverless platforms if adapted. `vercel.json` contains hints for static hosting and rewrites if using Vercel for frontend assets.

Contributing
- Fork, branch, and send pull requests. For major changes, open an issue first to discuss architecture.

License
- Add a license file as needed (e.g., MIT) and update `LICENSE` at repo root.


