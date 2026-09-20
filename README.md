# CodeSync

Live coding rooms where the host decides who can edit and who can only watch. A shared editor with cursors, chat, checkpoints and one-click execution in 30+ languages. No accounts.

- **Frontend**: static HTML, CSS and ES modules on Vercel (no build framework).
- **Room server**: a small Node + Socket.IO service that relays the document and enforces roles.
- **Code execution**: in the browser, or through a Vercel function that calls public compiler services.

## Roles

Roles are enforced on the server. A viewer who tampers with the page still cannot change the document.

| | Host | Editor | Viewer |
| --- | --- | --- | --- |
| Edit the file, change language | yes | yes | no |
| Run code for themselves | yes | yes | yes |
| Share output with the room | yes | yes | no |
| Chat | yes | yes | yes |
| Save and restore checkpoints | yes | yes | view only |
| Change roles, remove people | yes | no | no |
| Default role, lock, passcode | yes | no | no |
| Hand over the host role | yes | no | no |
| Ask for edit access | | | yes |

How the host is decided: the browser that creates a room stores a random host token and sends it when it joins. The server keeps only a hash of it, so the invite link (which never contains the token) cannot be used to take over the room. Transferring the host role issues a fresh token to the new host.

## Features

- Live editing (Yjs CRDT over Socket.IO) with remote cursors, selections and follow mode.
- Presence panel drawn as a track diagram: each person's rail shows their role (doubled = host, solid = editor, gapped = viewer).
- Edit requests: a viewer asks, the host allows or denies.
- Room controls: default role for newcomers, lock, passcode, remove, transfer host.
- Chat with history, named checkpoints with restore for everyone, shared run output.
- 33 languages, command palette (`Ctrl/Cmd + K`), live HTML preview, snapshot links, download and open files.
- Works offline as a playground (`/play`), saved in the browser.

## Run locally

```bash
npm run setup    # once: installs the room server's dependencies
npm run dev      # site on http://localhost:3000, room server on :3001, /api functions included
npm test         # site tests + room server tests
```

Open `http://localhost:3000`, press **Start a room**, and open the invite link in a second browser profile to see roles in action.

## Deploy (free)

The site and the room server are deployed separately because Vercel functions cannot hold WebSocket connections.

1. **Room server on Render** (free web service). In Render choose *New > Blueprint* and pick this repo; `render.yaml` sets it up. Copy the service URL, for example `https://codesync-server.onrender.com`.
   Any Node host works: run `npm --prefix server install && npm --prefix server start` and expose `PORT`.
2. **Site on Vercel**. Import the repo, then add environment variables:
   - `SOCKET_URL` = the room server URL from step 1.
3. Back on Render set `CORS_ORIGIN` to your Vercel URL (comma separate several) or leave `*`.

`vercel.json` runs `scripts/build-config.mjs`, which writes `public/config.js` from `SOCKET_URL`. Without it the site still works, but rooms show a "No room server" notice and the playground keeps working.

Notes on the free tier: Render's free service sleeps after inactivity, so the first person to open a room may wait around 30 seconds while it wakes (the editor shows "Reconnecting"). Rooms live in the server's memory and are removed after 30 minutes with nobody in them. Everyone keeps a local copy in their browser, and editors push it back to the server when they reconnect.

## Architecture

```
Browser
  |-- public/ (Vercel static)   UI, Monaco, Yjs
  |-- Socket.IO  ------------>  server/ (Render)   rooms, roles, Yjs relay, chat, checkpoints
  |-- /api/execute ---------->  api/ (Vercel fn)   validate, throttle, run on public compilers
  `-- Web Workers / Pyodide     JavaScript, Python and MiniLang run locally
```

```
public/            landing page, room page, css, js modules
  js/net.js        Socket.IO client + Yjs sync
  js/room.js       room UI: roles, people, chat, history, run
  js/providers.js  compiler services (shared by the function and the browser fallback)
server/            Socket.IO room server (rooms.js holds every permission rule)
api/               execute.js, languages.js
scripts/           dev server, config builder, live language check
tests/             MiniLang, providers, API
```

Wire format: Yjs updates travel as base64 strings; everything else is small JSON.

## Languages

JavaScript, Python, MiniLang and an HTML preview run in the browser. The rest run on Compiler Explorer or Wandbox through `/api/execute`: C, C++, Rust, Go, Zig, Nim, Crystal, D, Swift, Pascal, Fortran, Java, Kotlin, Scala, Groovy, C#, Ruby, PHP, Perl, Lua, Bash, TypeScript, Dart, Haskell, OCaml, Julia, R, SQL (SQLite), COBOL. Remote languages send your code to a third party, so keep secrets out of them.

`npm run verify:languages` runs every starter program through the real services. Run it after changing `providers.js` or a template.

To add a language: add it to `public/js/languages.js`, and if it runs remotely add a matching entry to `REMOTE` in `public/js/providers.js`. A test fails if the two disagree.

## Limitations

- Rooms are in memory on one server instance. Restarting the server clears them (clients re-sync from their local copies). Scaling to several instances needs the Socket.IO Redis adapter.
- Host identity is browser-bound. If the host clears site data, they lose the host role for that room.
- A viewer's own browser can still show local changes if they tamper with it; the shared document is never affected.
- Public compiler services can be slow, rate-limited or briefly broken. Seven languages (Kotlin, Dart, Crystal, Swift, OCaml, Fortran, COBOL) rely on Compiler Explorer alone.

## Ideas for next

Multi-file projects, voice chat over WebRTC, a timed interview mode with a fixed language and hidden test cases, inline review comments, recording and replay of a session from the Yjs history, presenter mode that locks everyone's viewport to the host, Gist import and export, and durable rooms with Redis or SQLite.
