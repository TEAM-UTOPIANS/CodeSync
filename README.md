## Code Sync – Real-Time Collaborative IDE

Production-structured collaborative web IDE with:
- **Real-time rooms** (code sync, cursors, chat, presence, roles)
- **Judge0 execution** for Python/C++/Java
- **MiniLang** custom interpreter (lexer → parser → AST → semantic analysis → interpreter)
- **Modern UI** (Monaco + Tailwind, toasts, theme, command palette, share links, resizable panels)
- **Two-page flow**: Home (create/join + random name) → Room IDE, plus a Solo Compiler page

### Run locally (Mac/Windows/Linux)

1) Create `.env` from the template:

- Copy `.env.example` → `.env`
- If using RapidAPI Judge0, set `JUDGE0_RAPIDAPI_KEY` (and host if needed).

2) Install dependencies:

```bash
python3 -m pip install -r requirements.txt
```

3) Start the app (single command):

```bash
python3 run.py
```

Open the UI:
- Local: `http://127.0.0.1:5000`
- Same Wi‑Fi: use the printed LAN URL like `http://192.168.x.x:5000`

Notes:
- On startup, `run.py` will **free the configured port** (default `5000`) by terminating any process listening on it.
  - Opt-out: set `SKIP_PORT_KILL=1`
- On macOS, Socket.IO runs in **threading mode** by default (eventlet+kqueue issues). On Linux, eventlet is used automatically.

### Collaboration

- Start on **Home** (`/`) to create or join a room.
- Shareable room URLs:
  - `/room/<roomId>?name=<YourName>&role=editor`
- **Roles**
  - Host: auto-assigned to first joiner (can change language)
  - Editor: can edit
  - Viewer: read-only (cannot edit)

LAN joining (same Wi‑Fi):
- Share the **LAN base URL** printed by the server, e.g. `http://192.168.1.102:5000`
- Then share either:
  - `http://192.168.1.102:5000/room/<roomId>` (they enter name on the IDE page), or
  - `http://192.168.1.102:5000/room/<roomId>?name=Alice&role=editor`

### Execution

- Select **Python/C++/Java** → runs via **Judge0** (backend submits + polls).
- Select **MiniLang** → runs through the backend interpreter (no Judge0).

### Pages

- **Home**: `/`
  - Create room
  - Join room by ID
  - Random name generator
- **Room IDE**: `/room/<roomId>`
  - Monaco editor + real-time sync + cursors + chat + roles
- **Solo compiler**: `/compiler`
  - Monaco + Run/Output only (no room)

### MiniLang (spec + syntax)

MiniLang is a small interpreted language executed **directly in the Python backend** with:
- **Lexer**: converts text → tokens with line/col, supports `#` comments and string escapes
- **Parser**: builds an AST with precedence rules
- **Semantic analysis**: detects undefined variables and invalid operations
- **Interpreter**: executes with a **step limit** to prevent runaway programs

#### Program structure

- A program **must** start with `START` and end with `STOP`.

#### Statements

- **Variable assignment**
  - `LET <identifier> = <expr>`
- **Print**
  - `PRINT <expr>`
- **If**
  - `IF <expr> < <expr> THEN`
  - (statements...)
  - `END`

#### Expressions

- **Numbers**: `10`, `3.14`
- **Strings**: `"hello"`, with escapes `\"`, `\\`, `\n`, `\t`
- **Identifiers**: `x`, `total_sum`
- **Operators**
  - Arithmetic: `+ - * /`
  - Comparisons: `< > ==`
  - Parentheses: `( ... )`
- **String concatenation**
  - `PRINT "hi " + name`

#### Comments

- `# anything after # is a comment`

#### Example program

```text
START
LET x = 10
LET y = 20
PRINT x + y

IF x < y THEN
    PRINT "x is smaller"
END

STOP
```

#### Common errors (and what they mean)

- **ParseError**: syntax issue (missing `START/STOP`, bad `IF ... THEN`, etc.)
- **SemanticError**: using an undefined variable (e.g. `PRINT x` before `LET x = ...`)
- **RuntimeError**: bad operation (e.g. division by zero)

MiniLang errors include **line/col** so the frontend can highlight the location.

### Docker (Linux production recommended)

This uses **eventlet** on Linux automatically. On macOS the server defaults to **threading** because of an eventlet/kqueue issue.

```bash
docker compose up --build
```

Then open `http://localhost:5000`.

### Scaling with Redis (optional)

Set:
- `USE_REDIS=1`
- `REDIS_URL=redis://redis:6379/0` (Docker) or your own Redis URL.

### Repo structure

- `frontend/`: `index.html` (Home), `ide.html` (Room IDE), `compiler.html` (Solo), plus JS under `/static/*`
- `backend/`: Flask app, routes, Socket.IO handlers, services
- `backend/compiler/minilang/`: MiniLang lexer/parser/AST/semantic/interpreter

