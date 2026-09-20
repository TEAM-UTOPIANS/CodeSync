# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain static HTML, CSS and ES modules (no build step). Frontend on Vercel Hobby, Socket.IO room server on a free Node host. Delegated to the builder: the user asked for a from-scratch frontend with no framework preference. (Inferred, user unavailable.)

## Users

Developers, students and teachers who pair-program, run interviews, teach a class, or share a snippet. They open a link and start typing within seconds. Rooms have three roles: host, editor, viewer. (Inferred from the request and the existing product.)

## Product Purpose

A shared browser code editor with live cursors, chat, presence, role-based permissions and one-click execution in 30+ languages. Success: someone joins a room from a link, sees the live document, and can run code without installing anything or signing up.

## Positioning

Free to host and free to use: static frontend plus a tiny Socket.IO server. Server-enforced roles (host, editor, viewer), 30+ languages including compiled ones, and no accounts.

## Operating Context

Sessions are short and link-driven: pair sessions, teaching, technical interviews, quick experiments. The host controls who may edit. Code runs in the browser (JavaScript, Python, MiniLang, HTML preview) or on public compiler services (Compiler Explorer, Wandbox) through a Vercel function.

## Capabilities and Constraints

- Real-time editing (Yjs CRDT relayed by Socket.IO), remote cursors, follow mode, chat, presence.
- Roles enforced on the server: viewers cannot change the document; the host can change roles, kick, lock the room, set a passcode, transfer host.
- Viewers can request edit access; the host approves or denies.
- Named checkpoints (version history) per room.
- Command palette, live HTML preview, snapshot links, download and open files.
- Must stay free: no paid services, no accounts, no API keys.
- Free hosts sleep and restart, so rooms are ephemeral; clients keep a local copy and re-sync.

## Brand Commitments

Name: CodeSync. Repository: TEAM-UTOPIANS/CodeSync. No prior logo or brand assets worth preserving (the earlier visual worlds are anti-references for this redesign).

## Evidence on Hand

Working product with tests and verified starter programs for 33 languages. No customer, usage or benchmark claims exist; do not invent any.
