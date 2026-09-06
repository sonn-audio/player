/**
 * What the selected zone is playing, and everything that acts on it.
 *
 * `zone.track === null` is the whole idle check — the contract uses `null` rather than
 * empty strings precisely so a client does not have to test three fields to find out.
 *
 * `source.name` is shown as the provenance line (station, service, input name) with
 * `source.kind` as the hint for *what* it is. Both are rendered as given: `kind` is an open
 * set, so this must not switch exhaustively on it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Crossfade } from '@/art/Crossfade';
import { zoneCoverCss } from '@/art/cover';
import { Transport } from '@/components/Transport';
import { Volume } from '@/components/Volume';
import { Waveform } from '@/components/Waveform';
import { SourceChip } from '@/components/StreamFormat';
import { AnalysisPanel, Readout } from '@/components/AnalysisPanel';
import { SignalClock, SignalPath, SignalWire } from '@/components/SignalPath';
import { HouseLane } from '@/components/HouseLanes';
import { RunningOrder } from '@/components/RunningOrder';
import { useRoomDrag } from '@/art/useRoomDrag';
import { Icon } from '@/components/Icon';
import { splitQualifier } from '@/lib/format';
import { useZoneFavorite } from '@/state/useZoneFavorite';
import { useApi } from '@/state/ServerContext';
import { useCoverAnchor } from '@/shell/coverMorph';
import type { ApiZoneState } from '@/api/types';

/**
 * The heart, for the room you are looking at.
 *
 * A toggle rather than the add-only star used in list rows: this one is about *the thing that is
 * playing*, which you can already have saved, so a control that only adds would be lying half the
 * time. Absent for a source with no id (a line-in), because there is nothing to store.
 */
function TrackHeart({ zone }: { zone: ApiZoneState }) {
  const { available, saved, toggle } = useZoneFavorite(zone);
  if (!available) {
    return null;
  }
  const title = saved ? `Saved to ${zone.name}` : `Add to ${zone.name}’s favourites`;
  return (
    <button type="button" className="np-action" data-on={saved ? '' : undefined} title={title} aria-label={title} onClick={toggle}>
      <Icon name="star" />
    </button>
  );
}

/**
 * How big the title is set, decided by how long it is — the same ladder the art face uses.
 *
 * A fixed `clamp(27px, 3.4vw, 52px)` is a compromise struck against the longest title anybody might
 * play, and every shorter one pays for it: `Dragula` sat at 52px with nine hundred pixels of empty
 * nameplate beside it. Stepped by character count, a short title takes the room it has and a long one
 * still fits in two lines. Boundaries are where two lines of the step above stop fitting the column.
 */
function titleStep(title: string): 1 | 2 | 3 | 4 {
  const length = title.trim().length;
  if (length <= 16) {
    return 1;
  }
  if (length <= 32) {
    return 2;
  }
  if (length <= 56) {
    return 3;
  }
  return 4;
}

/**
 * How many shut rooms stand either side of the open one.
 *
 * A house may hold twenty-four; twenty-three lines of 58px is fourteen hundred pixels, so with the
 * instrument open they cannot all be on screen and something has to give. What gives is the *distance*
 * ones: the rooms next to the one you are in stay, and the rest are a press away in the folded view,
 * which is the whole house as lines. Three each side keeps the column composed on a laptop and still
 * shows a house of seven in full.
 */
const NEIGHBOURS = 3;

/**
 * The rooms slide to their new places.
 *
 * Opening a tab moves every other room in the column — the one below the room that opened travels the
 * whole height of an instrument — and without this they teleport. So each row's position is remembered
 * between renders and any row that has moved is animated from where it *was* to where it is, which is
 * the same gesture the art face's wall makes when a panel widens and its neighbours slide along the
 * row.
 *
 * Measured from the DOM rather than through a ref per row: the rows are a list whose length changes
 * with the house, and a `data-` attribute is a stabler handle than a map of refs that has to be kept
 * in step with it. Web Animations rather than CSS, because the distance is only known at the moment
 * the layout changes.
 *
 * A row that has just appeared (the room that closed) has no previous position and is left to its own
 * entrance; see `np-lane-in`.
 */
function useHouseSlide(key: unknown): void {
  const seen = useRef(new Map<number, number>());

  useLayoutEffect(() => {
    const now = new Map<number, number>();
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const row of document.querySelectorAll<HTMLElement>('[data-lane-id]')) {
      const id = Number(row.dataset.laneId);
      const top = row.getBoundingClientRect().top;
      now.set(id, top);
      const was = seen.current.get(id);
      if (quiet || was === undefined || Math.abs(was - top) < 1) {
        continue;
      }
      row.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], {
        duration: 340,
        easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      });
    }

    seen.current = now;
  }, [key]);
}

export function NowPlayingView({
  zone,
  zones,
  onSelectZone,
  onOpenQueue,
}: {
  zone: ApiZoneState;
  /** Every room, for the lanes under the panel. */
  zones: ApiZoneState[];
  onSelectZone: (zoneId: number) => void;
  /** Where the whole queue lives — the rail's own Queue. See `RunningOrder`. */
  onOpenQueue: () => void;
}) {
  const api = useApi();
  const coverAnchor = useCoverAnchor();

  /*
   * Folded or open, remembered.
   *
   * Folding is what makes a house of twenty-four rooms a thing you can look at: every room becomes a
   * line, the column scrolls, and the instrument is one press away. It is a choice about this browser
   * on this screen, so it survives a reload the same way the rail's fold does. `try`/`catch` because
   * private-mode Safari throws on the read as well as the write.
   */
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem('sonn.rooms') === 'folded';
    } catch {
      return false;
    }
  });
  const setFold = useCallback((next: boolean) => {
    setFolded(next);
    try {
      localStorage.setItem('sonn.rooms', next ? 'folded' : 'open');
    } catch {
      // A browser that will not remember it still folds for this visit.
    }
  }, []);

  useHouseSlide(`${zone.id}|${zones.length}|${folded}`);

  /*
   * The two gestures the house invites, on this face as well.
   *
   * Drag the record onto another room and the music goes there; drag a room onto the one you are in and
   * they play together. Both were already in the contract, both are already implemented on the art
   * face's wall, and the same hook does it here — the rooms are rows instead of panels and nothing else
   * about the gesture changes. It is what turns this column from a set of tabs into the house: the tabs
   * are targets now, not just switches.
   *
   * A refusal is worth one sentence and then silence.
   */
  const [said, setSaid] = useState<string | null>(null);
  const drag = useRoomDrag((payload, target) => {
    if (payload.kind === 'record') {
      void api
        .handoff(payload.zoneId, target.zoneId)
        /* The screen follows the music: whoever threw the record into the kitchen is thinking about the
           kitchen, and staying on the room they just emptied would answer a gesture with a shrug. */
        .then(() => onSelectZone(target.zoneId))
        .catch(() => setSaid('that room would not take it'));
      return;
    }
    const leaderId = zone.group?.leader ?? zone.id;
    const members = zones.find((room) => room.id === leaderId)?.group?.members ?? [leaderId];
    void api
      .setGroup(leaderId, [...members, payload.zoneId])
      .then((result) => {
        const refused = result.rejected[0];
        if (refused) {
          setSaid(
            refused.reason === 'protocol-mismatch'
              ? `${payload.name} can’t stay in step with this room`
              : `${payload.name} is not there any more`,
          );
        }
      })
      .catch(() => setSaid('that did not work'));
  });

  useEffect(() => {
    if (!said) {
      return undefined;
    }
    const timer = window.setTimeout(() => setSaid(null), 4000);
    return () => window.clearTimeout(timer);
  }, [said]);

  const track = zone.track;

  /*
   * The house, in its own order, split around the room that is open.
   *
   * Every room is a tab and the open one stays *where it lives* in the house rather than being lifted
   * to the top with the rest listed underneath — which is the arrangement the art face's wall makes:
   * the room you are listening in is the wide panel standing between its neighbours' spines, in its
   * own place in the row. Choosing another room widens that one and narrows this one; nothing
   * reorders, so the house holds still while the tab you opened grows.
   */
  const at = zones.findIndex((candidate) => candidate.id === zone.id);
  const above = at < 0 ? [] : zones.slice(0, at);
  const below = at < 0 ? zones.filter((candidate) => candidate.id !== zone.id) : zones.slice(at + 1);
  const lane = (room: ApiZoneState) => <HouseLane key={room.id} zone={room} onSelect={onSelectZone} drag={drag} />;

  /* With the instrument open only the nearest rooms fit; folded, the whole house is on screen. */
  const nearAbove = above.slice(Math.max(0, above.length - NEIGHBOURS));
  const nearBelow = below.slice(0, NEIGHBOURS);

  return (
    <div className="now-playing">
      {/*
       * The record's light, in this face's voice: black and white.
       *
       * The art player lights its room with the sleeve in colour; this face's rule is that colour
       * comes from one constant wash and never from the music — a rule about *colour*, not about
       * light. So the sleeve stands behind the player as a monochrome wash: blurred past recognition,
       * desaturated completely, fading out before the spectrum. The page keeps one palette in every
       * room and still sits in the light of what is playing — a darkroom print of the same idea the
       * other face does in colour. Dissolving on the same slow cross-fade (`Crossfade`), because
       * light in a room does not blink.
       */}
      {track && (
        <Crossfade
          artKey={`${track.coverUrl}|${track.title}`}
          cover={zoneCoverCss(api, zone, 480)}
          render={(slot) => <span className="np-wash" style={{ backgroundImage: slot.cover }} />}
        />
      )}

      {/*
        The player itself: pinned, so it stays put while the queue moves under it.
        No card around it — the artwork's colour is the page's background now, and a bordered box
        floating on its own wash reads as a panel that failed to fill.
      */}
      {/*
       * This room's name, at the head of the column every other room's name runs down.
       *
       * The house concept from the art face, in this face's medium: there the rooms are panels in a row
       * and the one you are listening in takes the width; here they are lanes in a column and the one
       * you are listening in takes the height. Same idea, same gesture, and the name column is what
       * makes it read as one table with a tall row in it rather than a panel with a list stapled under.
       *
       * It also retires the picker in the rail. Two ways to choose a room on one screen is the
       * duplication this face has been removing everywhere else.
       */}
      {/*
       * Folded: the whole house as lines.
       *
       * Every room including the one you are in, in the house's own order, and the column scrolls if
       * there are more than fit. It is the overview a server with twenty-four rooms actually needs —
       * and it is the same set of rows either way, so folding is a change of *height*, not of subject.
       */}
      {folded && (
        <>
          {zones.map((room) =>
            room.id === zone.id ? <HouseLane key={room.id} zone={room} onSelect={() => setFold(false)} current /> : lane(room),
          )}
        </>
      )}

      {!folded && (
        <>
          {/* The rooms that did not fit are a count, not a scrollbar: pressing it folds the house. */}
          {above.length > nearAbove.length && (
            <button type="button" className="np-more-rooms mono" onClick={() => setFold(true)}>
              {above.length - nearAbove.length} more {above.length - nearAbove.length === 1 ? 'room' : 'rooms'}
            </button>
          )}

          {nearAbove.map(lane)}
        </>
      )}

      {!folded && (
        <>
          {/*
           * The open tab.
           *
           * Same line as every shut room — a lamp and the room's name, on the same left edge — with the
           * instrument hanging under it on a surface the shut rooms do not have. That is what makes the
           * column read as tabs rather than as a player with a table stapled beneath it: which room is
           * open is a fact of the drawing, not something to work out from what is on screen.
           */}
          <section
            className="np-room"
            data-current
            key={zone.id}
            /* A room dragged onto this one joins it. `data-room-drop` is what the gesture hit-tests for. */
            data-room-drop={zone.id}
            data-room-drop-kind="wall"
            data-hot={drag.active?.kind === 'room' || undefined}
            data-over={drag.over === zone.id || undefined}
          >
            <div className="np-room-head">
              <span className="np-room-lamp" data-lit={zone.state === 'playing' || undefined} aria-hidden="true" />
              {/*
               * The name folds it too.
               *
               * A heading that is the label of the thing it opens should be the way you shut it — the
               * chevron at the end of the line is the affordance, not the only target. The button lives
               * *inside* the heading so the room keeps being a heading in the document; a heading inside a
               * button is not phrasing content and browsers are entitled to make a mess of it.
               */}
              <h2 className="np-room-name">
                <button type="button" onClick={() => setFold(true)} title={`Fold ${zone.name}`}>
                  {zone.name}
                </button>
              </h2>

              {/*
               * The room's own controls, on the room's own line.
               *
               * They were a 90px row inside the panel, above the reading — so the face's subject was the
               * third thing on the page and got whatever height was left over. A room's transport belongs
               * to the room, and this line *is* the room: lamp, name, controls, fold. The position stays
               * down with the record, where "how far in are we" is part of what is playing rather than a
               * control you reach for.
               */}
              {/*
              Transport, the room's volume beside it, and the one per-track action opposite.

              The volume is *here* rather than in a bar because that is where a hand already is: it was in
              the top bar for a while and adjusting it meant crossing the window while looking at the
              player. And it has to be here now — the bar along the bottom is absent in this view, so
              there is nothing else in sight that carries it.
              */}
              <div className="np-controls">
                <Transport zone={zone} />
                {/*
              The volume and the one per-track action, as a unit.

              They were siblings of the transport, and `flex-wrap` treated them as strangers: at the
              1440px column there is room for the transport and the volume but not the star, so the
              star wrapped alone to a second row — one orphaned button hanging off the right edge.
              Grouped, the pair wraps together into a full second row (fader left, star at the far
              edge) or fits beside the transport whole. Both arrangements look decided.
              */}
                <div className="np-tail">
                  <Volume zone={zone} compact percent />
                  {/* One action beside the transport, not two: the "…" that used to sit here held things
              that belong to the room rather than to the track. */}
                  <div className="np-actions">
                    <TrackHeart zone={zone} />
                  </div>
                </div>
              </div>

              {/*
               * Fold the instrument away.
               *
               * At the end of the tab's own line, quieter than the line it operates — the lesson the rail's
               * fold taught twice. What it buys is the house: twenty-three other rooms cannot be on screen
               * beside an open instrument, and folded they all are.
               */}
              <button
                type="button"
                className="np-room-fold"
                onClick={() => setFold(true)}
                title={`Fold ${zone.name} — show every room as a line`}
                aria-label="Fold the instrument"
              >
                <i aria-hidden="true" />
              </button>
            </div>

            <div className="np-room-body">
              {/*
               * The room's plate: its name, and the record playing in it.
               *
               * This column was the room's *name* and eleven hundred pixels of nothing under it — which is
               * exactly what made this read as unlike the art face, where a room is a sliver *filled* with its
               * own artwork. The sleeve belongs here, not in the panel's first column: it is the thing that
               * says which room this is, in the same column the other rooms say it in. The panel keeps the
               * words and the readings.
               */}
              {/*
               * The plate *is* the record: the artwork as the column itself, full height.
               *
               * A square sleeve at the top with seven hundred pixels of nothing under it is what made this
               * column read as a label rather than as a room — on the art face a room is a band of its own
               * artwork, top to bottom. Painted rather than placed: an `<img>` in a box wants its own aspect
               * ratio and the box wants the row's height, and those two cannot both win. A background can
               * simply be cropped to the column, which is what a band is.
               *
               * The sleeve keeps its flight to the art player: the anchor rides this element now, so pressing
               * `ART` still carries the record across instead of dissolving one screen into another.
               */}
              {/*
               * The room's column: the record, its name, and what follows it.
               *
               * One column holding three things that are all about *this room* — which is what makes the
               * space under a square sleeve worth having rather than a hole to be filled. The panel beside
               * it is about the audio; this is about the room the audio is in.
               */}
              <div className="np-side">
                <div
                  className="np-plate"
                  data-playing={zone.state === 'playing' || undefined}
                  {...(track
                    ? {
                        style: {
                          /* The record goes in as a custom property, not as this element's own background: it
                       is painted twice from here — once square and sharp as the sleeve, once blurred
                       across the whole column as the room's light — and a single background could only
                       be one of those. */
                          '--rec': `url("${api.coverUrl(zone.id, { size: 640, cacheKey: track.coverUrl })}")`,
                        } as React.CSSProperties,
                      }
                    : {})}
                >
                  {/*
                   * The sleeve, square.
                   *
                   * It was the column: one tall crop of a square photograph, which keeps a strip of the middle
                   * and throws the sides away — a record read as stretched because it *was* stretched across a
                   * shape a record does not have. So it is a square again, at the column's width, in the
                   * proportion the sleeve was made in.
                   *
                   * The column still fills, but with the record's own light rather than with more of the
                   * record: `::before` paints the same picture blurred from top to bottom, which is the same
                   * device the rest of this face uses and the reason the plate does not read as a label on a
                   * dark box.
                   *
                   * The anchor rides the sleeve, so pressing `ART` still flies this square across to the art
                   * player rather than dissolving one screen into another.
                   */}
                  {/* No name under the sleeve: the tab's own line names the room a few pixels above this,
                and the same words twice is the duplication this face keeps removing. */}
                  {/* The record is a thing you can pick up: drag it onto another room's line and the music
                goes there. Pointer-down begins a *possible* drag — below the threshold in
                `useRoomDrag` nothing has happened and the press stays a press. */}
                  <span
                    className="np-plate-art"
                    aria-hidden="true"
                    {...coverAnchor}
                    onPointerDown={(event) =>
                      track &&
                      drag.begin(
                        {
                          kind: 'record',
                          zoneId: zone.id,
                          cover: `url("${api.coverUrl(zone.id, { size: 320, cacheKey: track.coverUrl })}")`,
                          name: track.title,
                        },
                        event,
                      )
                    }
                  />
                </div>

                <RunningOrder zone={zone} onOpenQueue={onOpenQueue} />
              </div>

              <div className="np-player">
                {/*
          The playing block, in the order a listener reads it: what it is, what it *is* technically,
          where it has got to, and only then the controls.

          Three lines rather than one `subtitleOf`: the artist carries the accent because it is the
          thing people look for, and the album is a place rather than a name so it sits under it in
          plain grey with the provider's mark beside it. The old single "Artist — Album" line made
          both equally important and neither findable.
        */}
                <div className="np-meta">
                  {/*
            The three lines are one block, not three rows.

            Their own tight rhythm — 5px between title and artist, 3px more before the album — is what
            makes them read as a single statement, where the shell's uniform gap made them look like
            three separate fields that happened to be stacked. The `key` is the track title, so the block
            crossfades when the music changes instead of snapping to the next song mid-glance.
          */}
                  <div className="np-heading" key={track?.title ?? 'idle'}>
                    {/* Who, then what — a nameplate's order, and the same one the art face's label reads in.
                Under the title it was the second half of a search result; above it, it is the line
                that says whose equipment-load this is. */}
                    {track?.artist && <p className="np-artist">{track.artist}</p>}

                    {/*
              The edition, at a size that matches its importance.
              `(Radio Version)`, `(2010 Remastered Version)`, `[Explicit]` — the catalogue puts these
              inside the title, so at 46px they arrive with the same weight as the song's name while
              usually being the longer half of it. Same line, smaller and quieter; see
              `splitQualifier` for why only a trailing group is treated this way.
            */}
                    <h1 className="np-title" data-len={titleStep(track?.title || 'Nothing playing')}>
                      {(() => {
                        const { main, qualifier } = splitQualifier(track?.title || 'Nothing playing');
                        return (
                          <>
                            {main}
                            {qualifier && <span className="np-qualifier"> {qualifier}</span>}
                          </>
                        );
                      })()}
                    </h1>

                    {/* Just the album. The provider moved down into the chip row, where "where did this come
                from" sits with the rest of what this audio *is* — trailing the album title it read as
                an afterthought, and it is the first thing people check. */}
                    {track?.album && (
                      <p className="np-album">
                        {(() => {
                          const { main, qualifier } = splitQualifier(track.album);
                          return (
                            <>
                              {main}
                              {qualifier && <span className="np-qualifier"> {qualifier}</span>}
                            </>
                          );
                        })()}
                      </p>
                    )}
                  </div>

                  {/*
            Why the last attempt failed. This is the whole reason no view polls after a play:
            `play` answers 204 before anything is resolved, and the failure arrives here on a
            `zone.changed` with a reason worth showing — beside `track: null`, not inside it.
          */}
                  {zone.error && <p className="notice warn">{zone.error}</p>}

                  {/* The nameplate: where it came from, then what it is. The rail's signal path no longer
              repeats the verdict — see `FormatChips` and `SignalPath`.

              Keyed on the *wire* format, so the row re-arrives — the same small rise the heading
              has — exactly when the equipment relocks: a 16/44.1 record giving way to a 24/192 one
              is a moment on this face the way a track change is on the other. The signature leaves
              the bitrate out (it moves every second) and the track out (an unchanged wire across a
              whole album should sit perfectly still). */}
                  <p
                    className="format-chips"
                    key={
                      zone.format?.output
                        ? `${zone.format.output.codec}/${zone.format.output.sampleRate}/${zone.format.output.bitDepth}/${zone.format.bitPerfect}/${zone.format.source?.codec ?? ''}`
                        : 'silent'
                    }
                  >
                    {/*
                     * Provenance only. The formats moved out.
                     *
                     * `TRACK · CONVERTED · PCM · 48 KHZ · 24-BIT` was the signal path's own reading, written a
                     * second time in the one place on this screen where the eye lands first — and now that the
                     * rail is the tallest thing on the panel and legible end to end, the chips were the summary
                     * of a document that is already open. What they said that the rail does not is *where the
                     * music came from*, so that is what stays.
                     */}
                    {zone.source && <SourceChip source={zone.source} />}
                  </p>

                  {/*
            No Stop / Power off row: three controls and a sentence at the bottom of a block whose subject
            is the music, two of which act on the *room* rather than on it. The Zone tab that held them —
            along with the room's inputs — is gone too: this view is about what is playing, and the tabs
            under it are the three lists that feed it.
          */}
                </div>

                {/*
                 * The transport, across the panel rather than under the words.
                 *
                 * The nameplate row was three islands with six hundred pixels of nothing between the middle and
                 * the right: a picture, a column of type that stopped where its longest line stopped, and a pair
                 * of readings pinned to the far edge. A timeline that runs the width of the panel and a
                 * transport centred beneath it turns that row into one object — and it is what the control strip
                 * on a piece of equipment actually looks like, which is the argument this face has been making
                 * everywhere else.
                 */}
                <div className="np-transport">
                  {/* The envelope of what has played, the position, and the seek gesture — one element. A slim
              bar under it drew the position a second time; see `Waveform`. */}
                  <Waveform zone={zone} />
                </div>

                {/* The reading, at a size worth the name of this face — see `Readout`. It fills the half of
            the nameplate row that was empty page, with the numbers that were living at 10px in the
            corner of the display below. */}
                <div className="np-readings">
                  <Readout zoneId={zone.id} active={zone.state === 'playing'} capabilities={zone.output?.capabilities} />

                  {/*
                   * And the clock, under them.
                   *
                   * It used to sit in the chain, which was the wrong company: nothing passes *through*
                   * a clock. It is a reading, like the level and the note, so it stands where the
                   * readings stand — and the column it makes fills the panel's whole right edge, which
                   * was a thousand pixels of empty page beside a title.
                   */}
                  <SignalClock zone={zone} />

                  {/* And what the stream is doing right now — see `SignalWire`. */}
                  <SignalWire zone={zone} />
                </div>

                {/*
                 * The chain, under the display it explains.
                 *
                 * It used to be a column down the right edge — the shape of an inspector, which is a thing you
                 * consult *about* what you are looking at. Here it is a rack strip: the stations in the order
                 * the audio passes through them, laid left to right across the full width, directly beneath the
                 * picture of what that audio looks like at the end of them. The layout is the argument — this
                 * face is a signal path with a record going through it, not a record with a signal path beside
                 * it.
                 */}
                <div className="np-chain">
                  <SignalPath zone={zone} />
                </div>

                {/*
          The spectrum runs the full width, under the artwork as well as the controls.
          It is the one element with no natural width — it is a reading of the audio, not a piece
          of metadata — so it takes the space beneath the cover that nothing else was using.
        */}
                <AnalysisPanel zoneId={zone.id} active={zone.state === 'playing'} capabilities={zone.output?.capabilities} />
              </div>
            </div>
          </section>

          {nearBelow.map(lane)}

          {/*
           * What is in the hand.
           *
           * Fixed to the pointer rather than parented to what it came from: a ghost inside the tab it was
           * picked up from would be cut off at the first edge it met, and this one crosses the whole column.
           */}
          {drag.active && (
            <span
              className="np-hand"
              style={{
                left: `${drag.active.x}px`,
                top: `${drag.active.y}px`,
                backgroundImage: drag.active.cover,
              }}
              aria-hidden="true"
            >
              {!drag.active.cover && <i className="np-hand-name mono">{drag.active.name}</i>}
            </span>
          )}

          {said && <span className="np-said mono">{said}</span>}

          {below.length > nearBelow.length && (
            <button type="button" className="np-more-rooms mono" onClick={() => setFold(true)}>
              {below.length - nearBelow.length} more {below.length - nearBelow.length === 1 ? 'room' : 'rooms'}
            </button>
          )}
        </>
      )}

      {/*
       * No tab strip, and no lists under the instrument.
       *
       * Queue, favourites and recents were three tabs and a scrolling body pinned beneath the display —
       * and grid gives content that states a size what it asks for, so a twelve-track queue took its
       * 208px off the top of the spectrum every time. On a face whose subject is the signal, the
       * paperwork cannot be the thing that decides how tall the reading is.
       *
       * All three are places in the rail now: favourites and recents already were, and the queue joined
       * them. This view is the instrument, end to end, and it keeps every pixel the window has.
       */}
    </div>
  );
}
