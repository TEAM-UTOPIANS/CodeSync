<div align="center">

<img src="public/img/hero-art.jpg" alt="Three connected editor windows with small characters sitting on them" width="420" />

# CodeSync

**Ctrl + Alt + Together.**

A live code editor that runs in the browser. Open a room, send one link, and build the same
multi-file project together. The host picks who can edit and who is only watching, and the room
server makes that stick.

Built by **Mayank Karki**, **Nitin Kandpal** and **Swarit Kumar** · Team Utopians

</div>

---

**Contents** ·
[What it is](#what-codesync-is) ·
[Features](#features) ·
[Roles](#the-rules-in-one-table) ·
[Languages](#languages) ·
[Architecture](#how-it-fits-together) ·
[Run it](#run-it-locally) ·
[Deploy it](#deploy-it-free) ·
[Layout](#project-layout) ·
[MiniLang](#minilang) ·
[Testing](#testing) ·
[Limits](#known-limits) ·
[**Interview notes**](#talking-about-this-project) ·
[Credits](#credits)

## What CodeSync is

Most "share your code" tools give the same pen to whoever opens the link. CodeSync does not. A room
has a **host**, any number of **editors**, and any number of **viewers**, and the rules are checked
by the room server rather than by the page. A viewer who opens devtools and edits the document still
cannot change what anybody else sees.

Around that sit the things you actually need in a session: several files instead of one scratch pad,
33 languages that really run, cursors and chat, named checkpoints you can roll back to, and a live
preview for web pages. There is no account, no install, and nothing to pay for. The whole thing is
built to run on free hosting tiers.

It is useful for pair programming, teaching a class, running an interview, helping somebody debug,
or just sketching an idea with a friend.

## Features

**Working together**
- Live shared editing built on a conflict-free document (Yjs), so two people can type in the same
  line and it still lands where you expect.
- Everybody's cursor and selection, labelled with their name, across every file in the project.
- **Follow mode**: click a person to ride along as they move around the project.
- Chat with history for the life of the room.
- **Shared output**: when an editor runs the project, the whole room sees the result in their own
  terminal.

**Who can do what**
- Three roles: host, editor, viewer. Enforced server side.
- The host can promote and demote anyone, set the role that new people arrive with, lock the room,
  set a passcode, remove somebody, and hand the host role over.
- A viewer can ask the host for a pen; the host allows or denies with one click.

**The project**
- Multiple files per room. Add, rename and delete them; everyone sees the same tabs instantly.
- Files are sent to the compiler as a set, so `import`, `require` and `#include` resolve.
- **Checkpoints**: name a version and restore the entire project for the room later.
- Download a file, or drop one in from disk.
- **Snapshot links**: the whole project compressed into a URL you can paste anywhere.

**The editor**
- Monaco, the editor from VS Code, with syntax highlighting for every supported language.
- **An integrated terminal.** One pane, the way an editor's terminal works: program output and the
  lines you type share a single transcript. Type ahead of a run and the lines become that program's
  standard input; when a local program reads past what you gave it, the prompt lights up and waits
  for the next line. Up and down walk your history, Ctrl+C gives up on a prompt, and Enter on an
  empty prompt runs the project.
- Command palette on `Ctrl/Cmd + K` for every action and a fuzzy language switcher.
- Live web preview that assembles your HTML, CSS and JavaScript files and refreshes as you type.
- Four themes (Cream, Midnight, Bubblegum, Ocean) that also recolour the code.
- Font size, word wrap, minimap and ligature settings, remembered per browser.
- Compiler and runtime errors marked on the exact line.

## The rules, in one table

| Action | Host | Editor | Viewer |
| --- | :---: | :---: | :---: |
| Edit, rename and delete files | yes | yes | no |
| Run the project for yourself | yes | yes | yes |
| Show the output to the room | yes | yes | no |
| Send chat messages | yes | yes | yes |
| Save and restore checkpoints | yes | yes | no |
| Ask for a pen | n/a | n/a | yes |
| Change somebody else's role | yes | no | no |
| Set the default role, lock, passcode | yes | no | no |
| Remove somebody from the room | yes | no | no |
| Hand the host role to somebody else | yes | no | no |

**How the host is decided.** The browser that creates a room generates a random host token, keeps it
in `localStorage`, and presents it when joining. The server stores only a SHA-256 hash of it, and the
invite link never contains it, so passing the link around cannot pass the room around. Handing the
host role to somebody else mints a fresh token for them and invalidates the old one.

## Languages

Python, JavaScript, MiniLang and web pages execute inside your own browser and never leave it.
Everything else is built and run by public compiler services through a small serverless function.

| Where it runs | Languages |
| --- | --- |
| In your browser | JavaScript (Web Worker), Python (Pyodide), MiniLang, HTML/CSS/JS preview |
| Compiled | C, C++, Rust, Go, Zig, Nim, Crystal, D, Swift, Pascal, Fortran |
| JVM and .NET | Java, Kotlin, Scala, Groovy, C# |
| Scripting | Ruby, PHP, Perl, Lua, Bash, TypeScript, Dart |
| Functional and data | Haskell, OCaml, Julia, R, SQL (SQLite), COBOL |

Remote languages send your code to a third party (Compiler Explorer, then Wandbox as a fallback), so
keep secrets out of them. The provider layer picks the newest compiler on its own, skips toolchains
that are broken server side, strips ANSI colour codes and normalises both services into one response
shape.

## How it fits together

```
Browser
  |-- public/            the site and the editor            -> Vercel (static)
  |-- Socket.IO   <-->   server/   rooms, roles, relay      -> Render (free web service)
  |-- /api/execute       validate, throttle, dispatch       -> Vercel (serverless function)
  `-- Web Workers        JavaScript, Python, MiniLang run locally
```

- **The editor** holds a Yjs document per room and binds it to Monaco, one model per file.
- **The room server** is the only authority on roles. It relays document updates between people,
  refuses anything a viewer sends, keeps chat and checkpoints, and forgets a room 30 minutes after
  the last person leaves.
- **The function** in `api/` checks size and rate limits, then asks a public compiler service to
  build and run the project, failing over to the second service when the first one misbehaves.
- **No database anywhere.** Rooms live in memory; every browser also keeps its own copy in
  `localStorage`, and editors push it back when they reconnect.

If no room server is configured, rooms fall back to **peer to peer** mode: browsers find each other
through public relays and talk directly over WebRTC. Everything except roles, passcodes and
checkpoints still works. Add `?p2p` to any room URL to force that mode.

## Run it locally

```bash
npm run setup    # once: installs the room server's dependencies
npm run dev      # site on :3000, room server on :3001, api/ functions included
npm test         # site tests and room server tests
```

Node 18 or newer is the only requirement; the site itself has no build step and no dependencies.
Open `http://localhost:3000`, press **Start a room**, then open the invite link in a second browser
profile to watch the roles work.

## Deploy it (free)

The site and the room server go to different places, because Vercel functions cannot hold a
WebSocket open.

1. **Room server on Render.** Choose *New > Blueprint* and pick this repository; `render.yaml`
   configures it. Copy the service URL, for example `https://codesync-server-xxxx.onrender.com`, and
   check that `<url>/health` answers. Any Node host works: run
   `npm --prefix server install && npm --prefix server start` and expose `PORT`.
2. **Site on Vercel.** Import the repository, then set the environment variable `SOCKET_URL` to that
   room server URL and redeploy. `vercel.json` runs `scripts/build-config.mjs`, which writes
   `public/config.js` from it.
3. **Back on Render**, set `CORS_ORIGIN` to your Vercel URL (comma separate several), or leave it as
   `*`.

Render's free service sleeps when idle, so the first person into a room after a quiet spell may wait
about 30 seconds while it wakes; the editor says "Reconnecting" until it does.

## Project layout

```
public/                 the whole frontend, no build step
  index.html            landing page
  room.html             the editor, served for /r/:room and /play
  css/style.css         design system: themes, components, layout
  img/                  illustrations
  js/
    landing.js demo.js  landing page and the sample room in the hero
    room.js             the editor page: files, roles, chat, history, running code
    net.js p2p.js       Socket.IO transport, and the peer to peer fallback
    project.js          files as Yjs text, one Monaco model each
    binding.js          Monaco to Yjs binding and remote cursors
    languages.js        the catalog: labels, icons, templates, how each one runs
    providers.js        Compiler Explorer and Wandbox
    runners.js          send the code to a worker, the preview or a compiler
    minilang.js         MiniLang: lexer, parser, checker, interpreter
    preview.js          assemble HTML, CSS and JS files into one preview document
    terminal.js         the integrated terminal: transcript, prompt, input queue
    clipboard.js        copying that still works when the clipboard API refuses
    snapshot.js ui.js themes.js
    workers/            js-worker.js, py-worker.js
server/                 Socket.IO room server (rooms.js holds every permission rule)
api/                    execute.js, languages.js (Vercel functions)
scripts/                dev server, config builder, live language check
tests/                  MiniLang, providers, the execute function
```

## MiniLang

A small language that ships with CodeSync, written for teaching. A program starts with `START` and
ends with `STOP`, keywords ignore case, and `#` starts a comment.

```text
START
PRINT "Enter a number:"
INPUT n
IF n > 10 THEN
  PRINT "big"
ELSE
  PRINT "small: " + (n * 2)
END
STOP
```

Statements are `LET`, `PRINT`, `INPUT` and `IF ... THEN ... [ELSE ...] END`. Expressions cover
numbers, strings, variables, `+ - * /`, parentheses and the comparisons `< > <= >= == !=`. Errors
are reported per phase (lexing, parsing, checking, running) with a line and column, and programs
stop after 50,000 steps so a runaway loop cannot hang the tab.

## Adding a language

1. Add an entry to `public/js/languages.js`: label, group, Monaco mode, Devicon slug, file
   extension, and a starter program that reads one line of input and greets it.
2. If it runs remotely, add a matching entry to `REMOTE` in `public/js/providers.js` with the
   provider's language name and a version pattern.
3. Run `npm run verify:languages <id>`, which sends the real starter program to the real services,
   then `npm test`. A test fails if the catalog and the provider map disagree.

## Testing

- `npm test` runs the site tests (MiniLang, the provider layer, the execute function) and the room
  server tests (roles, refusals, requests, kick, lock, passcode, host transfer, checkpoints,
  presence, malformed updates).
- `npm run verify:languages` runs every starter program through the real compiler services. Do that
  after touching `providers.js` or a template, since public services change without notice.

## Known limits

- Rooms live in one server's memory. Restarting it clears them, and clients re-sync from their local
  copies. Scaling past one instance needs the Socket.IO Redis adapter.
- The host role is tied to a browser. Clearing site data means losing the host role for that room.
- Peer to peer mode has no TURN relay, so strict corporate networks may not connect.
- Public compiler services can be slow, rate limited or briefly broken. Only 11 of the 29 remote
  languages are served by both providers; 11 are Wandbox only and 7 (Kotlin, Crystal, Swift, Dart,
  OCaml, Fortran, COBOL) are Compiler Explorer only, so those have no fallback.
- A room holds up to 30 people and 12 files.

## Talking about this project

Everything below is for explaining CodeSync out loud: in an interview, a viva, or a demo. It is the
same system described above, just from the "why" side.

### The pitch

**In one line.** CodeSync is a browser based collaborative code editor where the host controls who
can type, and the server enforces it.

**In thirty seconds.** Most shared editors give everyone the same pen, which is fine for pairing and
wrong for a classroom or an interview. CodeSync has three roles. The document is a CRDT, so
simultaneous edits merge without a lock, and a small Socket.IO server both relays those edits and
decides whose edits count. Around that we added multi-file projects, 33 languages, checkpoints and a
live preview. The whole stack runs on free tiers with no database.

**In two minutes.** Add the how. Each room holds a Yjs document. A file is a `Y.Text` inside a
`Y.Map`, plus a `Y.Array` that keeps the tab order, and each file is bound to its own Monaco model.
When you type, Monaco's change event is turned into Yjs operations; Yjs produces a binary update;
the client sends it to the server; the server checks the sender's role, applies it to its own copy of
the document, and fans it out to the rest of the room. A viewer's update is dropped at that check, so
tampering with the page changes nothing for anybody else. Running code takes two paths: JavaScript,
Python and MiniLang execute inside the browser in a worker, while compiled languages go through a
serverless function to public compiler services, with a second service as fallback.

### Numbers

| | |
| --- | --- |
| JavaScript across the app, server, functions and tests | about 4,600 lines |
| CSS and HTML | about 1,100 lines |
| Languages | 33 (4 local, 29 remote) |
| Remote languages with a fallback provider | 11 of 29 |
| Automated tests | 37 (25 app, 12 room server) |
| Runtime dependencies in the frontend | 0 (everything is loaded from a CDN as an ES module) |
| Databases | 0 |

### Decisions and trade-offs

| Decision | Why | What it costs |
| --- | --- | --- |
| CRDT (Yjs) instead of operational transform | Merges without a central sequencer, survives reconnects, and the library is battle tested | Bigger payloads than plain OT, and document history grows until the room is dropped |
| Socket.IO instead of raw WebSocket | Automatic reconnection, acknowledgements, rooms and a polling fallback for hostile networks | A protocol layer we do not control, and a slightly larger client |
| Roles enforced on the server | A permission that only exists in the UI is decoration; `canEdit()` guards every write | The peer to peer fallback cannot have roles at all |
| Host identity as a token in `localStorage` | No accounts, and the invite link stays safe to paste anywhere | Clearing site data loses the host role for that room |
| Rooms in memory, no database | Nothing to pay for, nothing to leak, and a room is a session rather than a document | A restart clears rooms, and one instance cannot share rooms with another |
| Execution split between browser and remote | Python and JavaScript feel instant and stay private; compiled languages need a real toolchain | Two code paths to maintain, and remote languages depend on services we do not own |
| Public compiler services instead of Judge0 or a sandbox we run | Free, no API key, no container budget | Rate limits, occasional outages, and code leaving the browser for those languages |
| Replay instead of `SharedArrayBuffer` for interactive input | Keeps COOP/COEP off, so Monaco, Pyodide and the fonts still load from a CDN | A non-deterministic program can print a different prefix on replay |
| Base64 on the wire for document updates | One representation that behaves the same in Node and the browser | Roughly a third more bytes than raw binary |
| Monaco instead of CodeMirror | The editor people already know from VS Code, with a language mode for everything we support | A large download, so it comes from a CDN and is the heaviest asset on the page |
| No build step for the frontend | `git clone` and open it; nothing between the source and the page | No bundling, tree shaking or type checking |

### How the document actually syncs

1. You type. Monaco fires a content change with offsets against the pre-change document.
2. `binding.js` applies those changes to the `Y.Text` **from the end backwards**, so earlier offsets
   stay valid, inside one transaction tagged with a local origin.
3. Yjs emits a binary update. `net.js` sees the origin is not `remote`, so it is ours, and sends it.
4. The server checks `canEdit(socketId)`. If the sender is a viewer, the update is dropped and that
   socket gets a `read-only` notice. Otherwise the server applies it and broadcasts it.
5. Other clients apply the update with the origin `remote`, which stops it being echoed back, and the
   binding turns the Yjs delta into `model.applyEdits` in Monaco.

The same loop carries cursors, except those go out as volatile events, since a cursor that arrives
late is worth nothing.

### How permissions hold up

- Every write path on the server (`doc:update`, `checkpoint:save`, `run:result`) asks `canEdit()`.
- The client also sets `readOnly` on Monaco, and the binding restores the shared text if the model is
  changed some other way. That is politeness, not security: the server is what makes it true.
- The host token never travels in a link. The browser generates 28 random characters, the server
  stores `sha256(token)`, and a join is a host join only if the hash matches.
- Handing the host role over generates a new token, gives it to the new host, and invalidates the old
  one by replacing the stored hash.
- Removing somebody bans their `clientId` for the life of the room, so a refresh does not let them
  back in.

### Three walkthroughs

**Somebody opens an invite link.** The page asks for a name, connects, and emits `join` with the room
id, the browser's `clientId` and a host token if it has one. The server admits or refuses (locked,
passcode, removed, full), assigns a role, and replies with the document, the people, the settings,
the chat history and the checkpoint list. The client applies the document, and if it turns out to
hold newer state than the server it pushes the difference straight back.

**Somebody types one character.** Covered above: Monaco change, Yjs update, role check, broadcast.
The round trip is one relay hop, with no locking and no conflict resolution to wait for.

**Somebody presses Run.** The client collects every file in the project. If the language runs
locally, the code goes to a Web Worker, output streams back as messages, and a timeout kills the
worker if it overruns. If it is remote, the client posts to `/api/execute`, which validates sizes,
applies a per client rate limit, then asks Compiler Explorer (fast) or Wandbox (writes sibling files,
so it goes first when the project has several). The result is normalised, the first diagnostic is
turned into a Monaco marker, and editors also broadcast the output so the whole room sees it.

### Security

- No account means nothing to breach, and we store nothing about anybody.
- The invite link is the credential, which is why the passcode and the lock exist.
- The server never trusts the client for a role, the room id is pattern matched before use, names
  are stripped of control characters, and updates over 256 KB are rejected.
- Every socket has a token bucket (60 burst, 30 per second), and the execute function has its own.
- The preview iframe is sandboxed to scripts only, so a page in the preview cannot reach the room.
- Cursor names and chat are written with `textContent`, never `innerHTML`, so a name cannot inject
  markup.
- Honest limit: remote languages send code to a third party, which is stated on the site.

### Performance

- Monaco is loaded from a CDN and shared by every visitor's cache; the rest of the frontend is a
  handful of small ES modules with no bundler.
- Cursor updates are volatile and debounced; document updates are deltas rather than whole files.
- The local copy in `localStorage` is written on a 400 ms trailing timer rather than on each keypress.
- Pyodide loads once per tab and is reused, so only the first Python run pays for it.
- Output is capped at 200 KB per run, so a runaway loop cannot lock the tab.
- Scroll animation runs on the compositor through `animation-timeline`, with an IntersectionObserver
  fallback rather than a scroll listener.

### Testing

- **Unit.** MiniLang gets its own suite covering every phase: lexing, parsing, checking, runtime
  errors, the step limit and deep nesting.
- **Contract.** The provider layer is tested against a fake `fetch`: newest compiler selection,
  failover between services, ANSI stripping and broken toolchain detection. One test fails if the
  language catalog and the provider map ever disagree.
- **Integration.** The room server tests spin up a real Socket.IO server and connect real clients,
  then assert the rules: a viewer's update is refused, a promoted viewer's update is accepted, only
  the host may change roles, kick bans a returning browser, the passcode and lock gate joins, host
  transfer moves control, and checkpoints restore every file.
- **End to end by hand.** Two browser profiles in one room, for the flows that are about feel rather
  than assertions.
- `npm run verify:languages` is a live check: it sends all 33 starter programs to the real services
  and reports what actually built.

### Interactive input without cross-origin isolation

The terminal can ask a running program for another line, which sounds like it needs a blocking read
inside the worker. It does, and the only real way to block a worker on the main thread is
`Atomics.wait` on a `SharedArrayBuffer`, which needs COOP and COEP headers. Turning those on would
break every cross-origin script the page loads (Monaco, Pyodide, the icon font), so the project does
something simpler and honest instead.

When a local program reads past the input it was given, the worker reports `needInput` rather than
failing. The page asks the terminal for a line, appends it to the input, and **runs the program again
from the start**. Output already on screen is not printed twice: the runner counts the characters it
has shown and skips that many in the replay, which is the `visiblePart` helper and the thing the unit
test pins down. For the deterministic scripts people write in a shared editor this is
indistinguishable from a program that paused and carried on. In JavaScript the trigger is a sentinel
thrown from `input()`; in Python it is the `EOFError` that Pyodide raises; in MiniLang the
interpreter already reported that it was waiting. Remote languages get their standard input once,
when the build request is sent, because a compiler service has no channel to ask for more.

The one visible cost is that a non-deterministic program, one that prints the time or a random
number, can show a changed prefix on replay. That is written down rather than hidden.

### Problems worth talking about

- **Monaco and Yjs disagree about offsets.** Monaco reports changes against the document before the
  change; applying them in order corrupts later offsets. Sorting the changes and applying them from
  the end fixes it.
- **Echo loops.** Applying a remote update fires a change event, which would send it straight back.
  Tagging every transaction with an origin and ignoring `remote` breaks the loop.
- **Binary over Socket.IO.** Binary attachments behave differently in Node and the browser, which
  showed up as `Unexpected end of array` when decoding. Base64 everywhere was the simplest honest
  fix for documents this small.
- **Broken public toolchains.** Some Wandbox compilers fail for reasons that are not the user's code:
  a missing shared library, a permission error. Those signatures are detected and the next compiler
  is tried, so the user sees a real error or a real result, never a server's bad day.
- **A viewer who edits the DOM.** The editor is set read only, but that is trivially bypassed. The
  test that matters sends a document update straight down the socket as a viewer and asserts the
  server refuses it and the room's copy is unchanged.
- **Two people seeding an empty room.** If everyone creates a starter file, you get duplicates. Only
  the host seeds, and in peer to peer mode a client waits to see whether anybody else is there first.
- **`cleanUrls` on Vercel.** It quietly broke the `/r/:room` rewrite and every room 404ed in
  production while working locally. Worth mentioning as a reminder that hosting config is part of the
  system.

### If there were another week

- Redis adapter plus a shared store, so the room server can run more than one instance and rooms
  survive a restart.
- A TURN server, so peer to peer mode works on locked down networks.
- Voice chat over WebRTC, reusing the same peer connections.
- An interview mode: fixed language, hidden test cases, a timer, and a transcript at the end.
- Replay a session from the Yjs update history.
- Self hosted execution in Firecracker or gVisor, to stop depending on public services.

### Questions that tend to come up

**Why a CRDT rather than a lock or operational transform?** A lock turns pairing into turn taking.
OT needs a central server that orders every operation and a correct transform function per operation
type. A CRDT merges by construction, which also means the peer to peer mode works with no server at
all.

**What happens if two people edit the same line at the same moment?** Both edits survive. Yjs orders
them deterministically by client id and clock, so every client converges on the same text without
asking anybody.

**How do you stop a viewer from just editing the page?** You cannot stop them changing their own
screen, and that is fine. The document lives on the server, and the server refuses their update.
There is a test for exactly that.

**Why not Judge0 or your own container?** Both need money or an API key, and the project had to stay
free. Public compiler services cost nothing, and the provider layer hides the fact that there are two
of them.

**What breaks first under load?** The single room server instance, since every room lives in its
memory. The fix is the Redis adapter plus a shared room store. After that, the compiler services'
rate limits.

**Why is there no build step?** The frontend is ES modules the browser already understands. It keeps
the repository readable, makes the deploy trivial, and nothing in the project needed a compiler.

**What is the one thing you would change?** Room persistence. Everything else degrades gracefully,
but a server restart still drops rooms, and clients only recover what their own browser happened to
keep.

## Credits

Built by **Mayank Karki**, **Nitin Kandpal** and **Swarit Kumar** for Team Utopians.

Standing on: [Monaco](https://microsoft.github.io/monaco-editor/), [Yjs](https://yjs.dev),
[Socket.IO](https://socket.io), [Pyodide](https://pyodide.org),
[Compiler Explorer](https://godbolt.org), [Wandbox](https://wandbox.org),
[Trystero](https://github.com/dmotz/trystero), [Phosphor Icons](https://phosphoricons.com) and
[Devicon](https://devicon.dev). Illustrations generated with Cloudflare Workers AI.

Issues and pull requests are welcome at
[TEAM-UTOPIANS/CodeSync](https://github.com/TEAM-UTOPIANS/CodeSync).
