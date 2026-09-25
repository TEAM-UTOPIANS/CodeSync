<div align="center">

<img src="public/img/hero-art.jpg" alt="Three connected editor windows with small characters sitting on them" width="420" />

# CodeSync

**Share the room. Keep the pen.**

A live code editor that runs in the browser. Open a room, send one link, and build the same
multi-file project together. The host picks who can edit and who is only watching, and the room
server makes that stick.

Built by **Mayank Karki**, **Nitin Kandpal** and **Swarit Kumar** · Team Utopians

</div>

---

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
- **Shared output**: when an editor runs the project, the whole room sees the result.

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
- Public compiler services can be slow, rate limited or briefly broken. Seven languages (Kotlin,
  Dart, Crystal, Swift, OCaml, Fortran, COBOL) have only one provider and no fallback.
- A room holds up to 30 people and 12 files.

## Credits

Built by **Mayank Karki**, **Nitin Kandpal** and **Swarit Kumar** for Team Utopians.

Standing on: [Monaco](https://microsoft.github.io/monaco-editor/), [Yjs](https://yjs.dev),
[Socket.IO](https://socket.io), [Pyodide](https://pyodide.org),
[Compiler Explorer](https://godbolt.org), [Wandbox](https://wandbox.org),
[Trystero](https://github.com/dmotz/trystero), [Phosphor Icons](https://phosphoricons.com) and
[Devicon](https://devicon.dev). Illustrations generated with Cloudflare Workers AI.

Issues and pull requests are welcome at
[TEAM-UTOPIANS/CodeSync](https://github.com/TEAM-UTOPIANS/CodeSync).
