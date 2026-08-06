# Proposal: `GET /api/v1/items/{id}/about`

*A finding from the player, in the form the player exists to produce: the contract cannot do
something its competitors' contracts can, and this is the smallest honest surface that closes it.*

## The gap

An artist page in Music Assistant or Plexamp carries a biography, genres, and a row of similar
artists. Ours carries a heading and the albums. The prose and the relations are not in any
provider listing `/browse` walks — they come from cloud metadata services (TheAudioDB, fanart.tv,
last.fm, MusicBrainz + Wikipedia), and every player that shows them fetches them **server-side**.

The player cannot close this gap itself, for reasons that are architecture rather than effort:

- **Keys.** Most of those services want an API key, and a key shipped in a public web bundle is a
  key published. The audioserver can hold one; a browser cannot.
- **Reach.** A wall panel on a LAN does not necessarily have internet. The server usually does,
  and what it has cached it can serve to clients that never could have fetched it.
- **One cache, many panels.** A house full of panels asking Wikipedia the same question is what a
  server-side cache exists to prevent — and metadata services rate-limit exactly that.
- **The rule.** This player speaks only `/api/v1`, deliberately, as the test of whether the
  contract is complete. Fetching around the server would hide exactly the gap this document
  reports.

## The surface

One route, item-scoped rather than artist-scoped — an album has a review, a station has a
description, and the id is already opaque:

```
GET /api/v1/items/{id}/about
```

**200** with:

```jsonc
{
  "description": "Archive is a music collective from London…", // plain text, paragraphs on blank lines; null when none
  "similar": [ /* ContentItem[] — real, resolvable items, playable/browsable like any others */ ],
  "source": { "name": "TheAudioDB", "url": "https://…" }       // attribution; null only for the server's own prose
}
```

**404** whenever there is nothing to tell: no enrichment configured, nothing found, an item kind
nobody writes about. 404 is the *ordinary* answer, not an error — the player already treats it as
"render nothing", the same contract `/waveform` uses.

Notes that matter:

- **`similar` items must be real items** — ids the server can `browse`/`play` — which usually
  means resolving the cloud service's artist names back through the configured providers and
  dropping what does not resolve. A similar artist you cannot open is a caption, and the player
  renders them as ordinary tiles, not captions.
- **Attribution is part of the payload**, not a UI courtesy: the free tiers of these services
  require it, and the player draws `source.name` whenever prose is shown.
- **Additive evolution**: a `heroUrl` (wide artist image, fanart.tv-style) would slot in later as
  an optional field without breaking anything — the player's unions are open.
- **Language** could follow the server's locale setting; the field is one string, so this is a
  server concern invisible to the contract.

## Server sketch

Provider-pluggable, like everything else in the audioserver: one enrichment backend configured
(or none), keyed by a normalised artist/album name from the item, cached persistently with a long
TTL (biographies do not churn), negative results cached too. The route reads the cache and only
misses trigger an upstream fetch.

## Player status

The client side of this is **already merged and dormant**: `ContentAbout` in `api/content.ts`,
`ApiClient.itemAbout` (404 → null, cached per id per session), and the browse view renders the
biography under the heading (clamped to four lines, opened by `more`, attribution beside it) and
the similar items as a `beside this` shelf at the end of the page. The day the route answers,
every artist page in the house grows its story — no player release needed.
