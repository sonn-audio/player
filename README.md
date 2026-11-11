# sonn player

The web player for sonn core. Every room in the house, in a browser — on a desk, on a phone, or on
a panel on the wall. It plays there too: the tab can register itself as a room and take the music.

It speaks **only** the server's public `/api/v1` contract — no `/admin/api`, no use of the loxone audio server api, no
undocumented routes. That began as a way of proving the contract was complete enough to build a
player on.

## One player, and its frame

There used to be two players here — a *technical* face and an *art* one, a hash route and a switch
between them. One has absorbed the other: the instruments are a view of the player now (`art/Signal`)
rather than a second application, so what remains is one stance towards the music with the technology
one press away.

On a **desk** the player is an app with a frame (`art/Shell.tsx`, `app.css`): a sidebar down the left
holding the player's places (home, now playing, music, search, inputs), every service the server
reports with its mark, and every room in the house with the sleeve of what is on in it; a player bar
along the foot with the record, its transport, timeline and fader, the room it plays in, the queue and
the rests; and between them a pane — a rounded sheet — that shows whatever the room is showing: the
house, the stage, the catalogue, the inputs, the rooms, the reading.

**A hi-fi component, not an app.** Black, silver and hairlines. The sleeve is the only colour on the
screen and green is only ever a verdict. Labels are small spaced capitals, the way a faceplate is
engraved; titles are set light; figures are mono. Nothing is boxed that a line can separate.

**Now playing is quiet on purpose** (`art/Stage.tsx`): the sleeve, the name, who, the record, one lamp
for what is on the wire, and what comes next.

**Signal is the instrument** (`art/Signal.tsx`, `art/Vu.tsx`): the one place the player shows what it
is made of. The page opens on the answer — the verdict with its lamp, and why in a sentence — then two
VU meters on a lit scale that follow the room's left and right levels off the analysis stream (0 VU at
−18 dBFS, a VU's 300 ms), the spectrum, four figures (integrated loudness, range, true peak,
correlation), and down the right the path from file to amplifier, a point for every stage. Under the
fold: the loudness history, the stereo field, the scope, the peaks, the clock. The instruments draw in
silver; the lamp is the only green.

**Home** (`art/House.tsx`) is the house as the records that are on in it: a sleeve per room with
music, the quiet rooms as lines of type, and what this room played lately. **Rooms** is a ruled list:
a line, a dot and a figure per room, and one line down the left of rooms that play together.

On a **phone** it is the same component in the hand: a home that lists the house as ruled lines, a
strip above the tabs that says what is playing, and the full player one press up from it — a head, a
square sleeve, the name, the lamp, a hairline clock, the transport, a fader. The sleeve answers the
thumb: swipe sideways for the next track, up for the queue, down to put it away, a haptic tick at each
commit.

Desktop and phone get different component trees, split at 980px, because they are different products:
one has a pointer, a lot of width and every room on screen at once; the other has a thumb, one column
and a player that must never scroll. Everything below the presentation is shared.

The look is shared with the admin UI on purpose: the same two brand faces (Hanken Grotesk for
display and for every word, JetBrains Mono for every figure, both self-hosted variable fonts), the
same near-black surfaces until a record lights them, the green kept for verdicts, hairlines instead of
borders. Four sheets own it —
`styles.css` (the tokens and the instruments), `shell.css` (splash and the overlays), `art.css`
(everything under `.cx-root`) and `app.css` (the frame, and each part as it stands now: the phone's player and bars, home, the rooms, Signal) — and no component carries styling of
its own.

## Running it

```bash
npm install
npm run dev            # http://localhost:5175/player/
```

The dev server proxies `/api` to `http://localhost:7090`. Point it elsewhere either way:

```bash
AUDIOSERVER_URL=http://192.168.1.209:7090 npm run dev   # proxy a remote server
VITE_SERVER_ORIGIN=http://192.168.1.209:7090 npm run dev # talk to it directly (CORS is open)
```

`npm run typecheck` · `npm run build` · `npm run check -- --width 390` (the page measured in a headless Chrome: sideways overflow, clipped text, and on a phone width every control's reach against 44px; `--click` and `--eval` walk to a screen first)

## What it does

**Zones** — optional, but first-class where they exist. The room list is permanent furniture
and doubles as a status board: what each room plays, group membership, and whether its player
is actually reachable. A server with no zones hides the list rather than showing an empty one.

Per zone: play/pause/stop, skip, seek, volume, power, repeat/shuffle, the queue, favourites,
recents, physical inputs, grouping, a 10-band equalizer, and the stream format the room is
actually receiving.

Zone favourites can be **made** as well as played: the heart beside what is playing — on the stage,
in the player bar, in the phone's player — saves the room's current source, and the "kept" shelf on
the catalogue's front page plays them back. That is the Loxone concept, and the API always supported
it from any id.

**Local playback** — this browser is a room. It registers itself over `POST /destinations/local`
on load and appears in the room list beside the hardware zones, named for the device ("This phone"
below the phone breakpoint, "This browser" on a desk); select it and play, and it plays here. That
is what makes the phone player a music player in its own right rather than a remote for other
rooms, while the sidebar and the desk keep every zone one press away.

There is no UI of its own — no enable button, no separate volume, no connection badge — because it
is a zone, so the ordinary zone controls already drive it. Volume goes through
`PUT /zones/{id}/volume` like any room; the server relays it to the browser over the audio socket.

The one thing a browser insists on is that its audio context be unlocked from inside a user
gesture, which no server default can supply. That happens on the first click or keypress anywhere
on the page, so it is never a step anyone has to find.

A local destination is deliberately **not** in `GET /zones` or the event stream — a browser tab is
not a room, and it would otherwise show up in everyone's list. So the tab keeps the registration it
was handed, merges it into its own room list as a zone, and reads what it is playing from the audio
socket's `server/state` rather than from a zone object.

**Content** — the services, paged listings, and search across every provider at once. Rows decide
what a tap does from `browsable`/`playable` rather than from `kind`, so an album both opens and
offers "play all". Search a track, click it, and it plays in the selected zone.

The catalogue has a back link and the covers, and picks its shape from what a listing actually
holds — a hall of service marks at the front, a table of contents where nothing has artwork, shelves
where the server sent sections, a running order where it is a record, a grid otherwise. Inside a
service the categories stand as a contents column beside the shelves, and one record is put forward
each day on a wall of its own light.

**Scenes** — a moment in the house, saved and replayed in one press. "Dinner" is not a track: it is
the kitchen and the living room in step, that playlist, at *that* volume. Every part of it already
exists in the contract — `group`, `volume`, and `play` with a stored `source.id` — so a scene is
three calls with remembered arguments, no new server capability required. Saved from the desk ("save
this moment"), recalled from the same desk or from the quiet-house screen, and stored in this browser,
because the API has no store for client preferences — which is a finding.

**A citizen of the platform** — the player answers the surfaces a browser offers a thing that plays
music. `navigator.mediaSession` carries the leader's title, artwork and position, and routes the
lock screen's and a headset's keys through the ordinary zone commands (no silent-audio trick to
steal the keys; they surface when this tab genuinely plays). A web app manifest and icons make it
installable — a home-screen app on a phone, no URL bar on a wall panel. There is a service worker
only because Chromium will not offer the install prompt without one; it is network-first and never
answers from its cache while a response is coming, since a cache-first shell on a panel would keep
replaying an old build after every upgrade. And while a room is playing, the player holds a screen
wake lock, so the panel the idle state was designed for actually stays on to show it.

## How it is laid out

```
src/
  api/          The contract, and nothing above it
    types.ts      Wire types, mirrored from the server's apiTypes.ts
    client.ts     One method per endpoint — the only place URLs are built
    events.ts     The SSE feed, with reconnect
    content.ts    ContentSource + the HTTP adapter for /services, /browse, /items, /search
  state/        Live state, framework-aware
    zoneStore.ts       SSE events in, sorted zones out (no React)
    ServerContext.tsx  Wires one server into React
    useSelectedZone.ts / useLiveProgress.ts / useZoneCollection.ts / useLocalPlayback.ts / useScenes.ts
  shell/        What is drawn around and over the player
    Root.tsx        Splash, then the player
    coverMorph.ts   The sleeve's flight between the stage and the reading
    Intro.tsx / InstallHint.tsx / ServerMismatch.tsx
  art/          The player
    ArtApp.tsx      Views, sheets, the two trees (desk and phone), the keys
    Shell.tsx       The desk's frame: sidebar and player bar
    House.tsx       Home: a sleeve per room with music, the quiet rooms, lately
    Vu.tsx          The VU meters on the Signal deck
    artKey.ts       When the artwork changed: the key every dissolve hangs on
    serviceMark.tsx A service's two capitals, and the library and the radio drawn
    Stage.tsx       The record on a desk and on a phone; Transport, Timeline, VolumeRow
    Browse.tsx      The catalogue, the inputs page, the mini bar
    Channels.tsx    The rooms as cards (groups, scenes, lining up)
    Rail.tsx        The queue
    Wall.tsx        The house strip and the gallery rest
    Signal.tsx / Instruments.tsx   The reading
    useCur.ts       One flat object per room, with the leader/live/elapsed decisions already made
  components/   The signal path and the instruments' panels
  lib/          Formatting helpers
tools/
  check.mjs     The page measured: overflow, clipped text, a thumb's reach
```

The desk and the phone share everything below the presentation: `api/`, `state/`, `useCur` and the
formatting helpers. The player's sliders are drawn rather than native, which is why it carries its own
gesture helpers.

The layering rule is one-directional: `api/` knows nothing about React, `state/` knows nothing
about the DOM, and components never construct a client or a URL. That is what makes
"only `/api/v1`" checkable by reading `api/client.ts` instead of grepping the tree.

Two conventions worth knowing, both from the contract:

- **No optimistic state.** Every command is followed by a `zone.changed`, so controls render
  the zone rather than what was just asked for. Two tabs, a wall panel and a physical remote
  agree instead of fighting. The exceptions are dragging a slider and scrubbing, where echoing
  the server mid-gesture fights the finger.
- **Nothing polls, and nothing reads back after writing.** State arrives on `zone.changed`;
  paged collections announce themselves stale with `queue.changed` / `favorites.changed` /
  `recents.changed` and are re-read then. A failed play reports itself through `zone.error`
  rather than being verified. The upshot is that an edit made in another tab, a wall panel or
  the Loxone app shows up here with no code of ours involved.
- **Unions are open.** `source.kind`, `output.protocol` and `input.icon` accept values this
  build has never heard of, and unknown event types are ignored. New ones are not a breaking
  change, so a client that switches exhaustively breaks on a server upgrade.
