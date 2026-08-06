# sonn player

The web player for sonn core. Every room in the house, in a browser — on a desk, on a phone, or on
a panel on the wall. It plays there too: the tab can register itself as a room and take the music.

It speaks **only** the server's public `/api/v1` contract — no `/admin/api`, no use of the loxone audio server api, no
undocumented routes. That began as a way of proving the contract was complete enough to build a
player on.

## Two players, one bundle

The same rooms, the same API, two stances towards the music, one press apart from either side:

- **Technical** (`#/technical`) — what the audio *is*. The signal path, the bit-perfect verdict, the
  format on the wire per room, the live spectrum and the equalizer over it. Three columns: catalogue
  on the left, the player in the middle, the output and the other rooms on the right, transport along
  the bottom from every view.
- **Art** (`#/art`) — what the music *is*. Artwork large, controls quiet, nothing technical anywhere.
  On a desk the sleeve holds the middle, with the queue folded down the right edge and the house
  folded along the bottom — both open when you reach for them and get out of the way when you do not.
  A phone gets a full-screen player that never scrolls, a bottom nav and sheets — painted in the
  record's own colours (`track.colors.backgroundDark`, damped), with the sleeve answering the thumb:
  swipe sideways for the next track, up for the queue, a haptic tick at each commit. Left alone for a
  minute the chrome dims away and the screen becomes the record, which is what a wall panel spends
  most of its day being.

Both mount under one `ServerProvider`, so switching face reopens nothing and keeps the selected room —
the frame around them (the wordmark, the corner that names the other face and the console) does not
move or fade while the room behind it rearranges. Faces are addressed by **hash** rather than path
because the audioserver serves this bundle from a static directory with no SPA fallback: `/player/art`
would 404 from the file handler, `#/art` never reaches the server. The chosen face is remembered, and
a browser that has never been here is **asked** — once, ever: the splash resolves into the two stances
(`the music` / `the audio`), one press picks, and the answer is stored exactly as a corner-switch press
would store it. A deep link counts as an answer and skips the ask. This is a return with a history —
an earlier landing page was removed as a toll booth — and `shell/useFace.ts` carries the full argument
for why once-ever is not that.

The look is shared with the admin UI on purpose: the same two brand faces (Hanken Grotesk for
display, JetBrains Mono for every label and measurement, both self-hosted variable fonts), the same
near-black surfaces, the same green accent, hairlines instead of borders. Three sheets own it —
`styles.css` (technical + the tokens both others read), `shell.css` (splash, frame, transition) and
`art.css` (everything under `.cx-root`) — and no component carries styling of its own.

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

`npm run typecheck` · `npm run build`

## What it does

**Zones** — optional, but first-class where they exist. The room list is permanent furniture
and doubles as a status board: what each room plays, group membership, and whether its player
is actually reachable. A server with no zones hides the list rather than showing an empty one.

Per zone: play/pause/stop, skip, seek, volume, power, repeat/shuffle, the queue, favourites,
recents, physical inputs, grouping, a 10-band equalizer, and the stream format the room is
actually receiving.

Zone favourites can be **made** as well as played: a star sits on every row that carries a
source id — browse results, search hits, queue entries, recents — and adds it to the selected
zone. That is the Loxone concept, and the API always supported it from any id.

**Local playback** — this browser is a room. It registers itself over `POST /destinations/local`
on load and appears in the room list beside the hardware zones; select it and play, and it plays
here.

There is no UI of its own — no enable button, no separate volume, no connection badge — because it
is a zone, so the ordinary zone controls already drive it. Volume goes through
`PUT /zones/{id}/volume` like any room; the server relays it to the browser over the audio socket.

The one thing a browser insists on is that its audio context be unlocked from inside a user
gesture, which no server default can supply. That happens on the first click or keypress anywhere
on the page, so it is never a step anyone has to find.

A local destination is deliberately **not** in `GET /zones` or the event stream — a browser tab is
not a room, and it would otherwise show up in everyone's list. So the tab finds itself through
`GET /destinations` with an `X-Sonn-Client-Id` header, and reads what it is playing from the audio
socket's `server/state` rather than from a zone object. The volume beside the button is this
browser's own output, separate from the server's zone volume.

**Content** — the services, paged listings, and search across every provider at once. Rows decide
what a tap does from `browsable`/`playable` rather than from `kind`, so an album both opens and
offers "play all". Search a track, click it, and it plays in the selected zone.

The two faces present the same tree differently, which is most of what separates them: the technical
one keeps a breadcrumb trail and says what each row is; the art one has a back link and the covers,
and picks its shape from what a listing actually holds — a table of contents where nothing has
artwork, shelves where the server sent sections, a running order where it is a record, a grid
otherwise.

**Scenes** — a moment in the house, saved and replayed in one press. "Dinner" is not a track: it is
the kitchen and the living room in step, that playlist, at *that* volume. Every part of it already
exists in the contract — `group`, `volume`, and `play` with a stored `source.id` — so a scene is
three calls with remembered arguments, no new server capability required. Saved from the rooms sheet
("save this moment", art face), recalled from the same sheet or from the quiet-house screen, and
stored in this browser, because the API has no store for client preferences — which is a finding.

**A citizen of the platform** — the player answers the surfaces a browser offers a thing that plays
music. `navigator.mediaSession` carries the leader's title, artwork and position, and routes the
lock screen's and a headset's keys through the ordinary zone commands (no silent-audio trick to
steal the keys; they surface when this tab genuinely plays). A web app manifest and icons make it
installable — a home-screen app on a phone, no URL bar on a wall panel — with deliberately no
service worker, since a cache-first shell on a panel would keep replaying an old build after every
upgrade. And while a room is playing, the art face holds a screen wake lock, so the panel the idle
state was designed for actually stays on to show it.

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
    useSelectedZone.ts / useLiveProgress.ts / useZoneCollection.ts
  shell/        The frame around both faces — drawn once, above both, so it holds still
    Root.tsx        Splash → face, and the transition between faces
    useFace.ts      Hash routing + the remembered choice
    Brand.tsx       The wordmark, and the way to the console
    FaceSwitch.tsx  admin | technical, or admin | art
    coverMorph.ts   The sleeve's flight from one face's layout to the other's
    Intro.tsx
  components/   Technical face: controls and panels — one concern each
  views/        Technical face: NowPlayingView, ContentView, GroupingView
  art/          Art face: Stage (desktop + phone), Channels, Rail, Browse, useCur
  lib/          Formatting helpers
```

Both faces share everything below the presentation: `api/`, `state/`, and the formatting helpers. The
art face adds only its own derived model (`art/useCur.ts` — one flat object per room, with the
leader/live/elapsed decisions already made) and its own gesture helpers, because its sliders are drawn
rather than native.

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
