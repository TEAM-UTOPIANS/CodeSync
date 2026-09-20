# Design

Signal box. The room is a track diagram: people are trains on lanes, roles are levers, and interlocking means a viewer cannot pull the edit lever.

## Palette
Signal aspects are the whole palette. Red is host and fault. Amber is editor and running. Green is clear and success. Pale blue is viewer and locked. Grounds are charcoal enamel (dark) or cool white enamel (light). Peer cursors use a separate identity palette so people never share a colour with a role.

## Type
Barlow Condensed uppercase for legends, headings and plates. Barlow for prose. JetBrains Mono for code only.

## Shape and state
Plates and controls use a 2px radius. Lamps and avatars are round. Nothing else is rounded. State is drawn by rail stroke as well as colour: doubled rail for host, solid for editor, dashed for viewer.

## Components
Plates (role plates, room id), lamps (connection, run aspect), rails and levers (roles), schedule rows and departure board (landing), palette, menus, gate dialog.

## Motion
One authored moment: pulling a lever moves the handle and re-strokes the rail. Everything else is a short exponential ease-out. Reduced motion disables it.
