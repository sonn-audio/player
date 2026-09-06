/**
 * The rest of the house, as signal lanes.
 *
 * The panel above this shows one room in full — its record, its display, its chain, its clock. That is
 * what a player shows. But this is a *server*: it feeds several rooms at once, each with its own source,
 * its own processing, its own output and its own clock, and no other player can show that because no
 * other player knows it. A technical face that draws one chain and calls it the signal path is telling
 * a fraction of what it has.
 *
 * So every other room gets a lane: one line, the same reading as the panel above compressed to its
 * stations and its verdict. Read down the column and you have the state of the whole house on one
 * screen — which room is altering its audio, which is bit-perfect, which one's clock is drifting.
 *
 * A lane is a *row of the same table*: name, chain, what went in and what went out, where it goes, and
 * whether it is locked. The columns are stated once (see `.house-lane` in styles.css) so the numbers
 * line up down the page and the whole thing reads as an instrument's log rather than a list of cards.
 *
 * Pressing a lane makes that room the panel — the same gesture the wall makes on the other face, where
 * choosing a room widens it. Nothing here is a second implementation of anything: the stations come from
 * `stagesOf`, the same function the chain draws.
 */
import { stagesOf } from '@/components/SignalPath';
import { useApi } from '@/state/ServerContext';
import { zoneCoverCss } from '@/art/cover';
import type { RoomDrag } from '@/art/useRoomDrag';
import type { ApiZoneState } from '@/api/types';

/** How a stage's state maps to the lane's dot — the same three states the chain uses. */
function dotState(state: string): string {
  return state;
}

/** `AAC 44.1 → PCM 48/24`, or as much of it as the room can say. */
function wire(zone: ApiZoneState): string {
  const source = zone.format?.source;
  const output = zone.format?.output;
  const one = source ? `${source.codec.toUpperCase()} ${source.sampleRate / 1000}` : '—';
  const two = output ? `${output.codec.toUpperCase()} ${output.sampleRate / 1000}/${output.bitDepth}` : '—';
  return `${one} → ${two}`;
}

/**
 * One room, shut.
 *
 * A room that is not the one you are in, drawn as a single line: its record, its name, its chain, what
 * went in and what came out, where it goes, and whether its clock is locked. The columns are stated
 * once (see `.house-lane`) so the readings line up down the page.
 *
 * It is a *tab*, and the caller places these in the house's own order with the open room in its own
 * place among them — the same arrangement the art face's wall makes, where the room you are listening
 * in is the wide panel standing between its neighbours' spines. Pressing one opens it, which is the
 * same gesture there too.
 */
export function HouseLane({
  zone,
  onSelect,
  drag,
  current,
}: {
  zone: ApiZoneState;
  onSelect: (zoneId: number) => void;
  /**
   * The gesture in the air, when there is one.
   *
   * A shut room is both ends of the house's two gestures: a record dropped on it goes there, and the
   * room itself can be carried onto the room you are in to play along with it. The same hook the art
   * face's wall uses — see `useRoomDrag`.
   */
  drag?: RoomDrag;
  /**
   * This is the room you are in, drawn shut.
   *
   * With the instrument folded away every room is a line, this one included — and it has to stay
   * findable in a column that can hold twenty-four of them. Pressing it opens the instrument again
   * rather than switching room.
   */
  current?: boolean;
}) {
  const api = useApi();
  const art = zoneCoverCss(api, zone, 320);
  const stages = stagesOf(zone);
  const altered = stages.some((stage) => stage.state === 'on' && stage.label !== 'Source');
  const sync = zone.output?.sync;
  const playing = zone.state === 'playing';

  return (
    <button
      type="button"
      className="house-lane"
      /* The column measures its rows by this between renders — see `useHouseSlide`. */
      data-lane-id={zone.id}
      data-playing={playing || undefined}
      data-current={current || undefined}
      /* A record in the hand can land here; the row says so before the pointer arrives. */
      data-room-drop={zone.id}
      data-room-drop-kind="room"
      data-hot={drag?.active?.kind === 'record' || undefined}
      data-over={drag?.over === zone.id || undefined}
      onPointerDown={(event) => drag?.begin({ kind: 'room', zoneId: zone.id, cover: art, name: zone.name }, event)}
      onClick={() => {
        /* A press that turned into a throw is not a press — see `useRoomDrag`. */
        if (drag?.consumed()) {
          return;
        }
        onSelect(zone.id);
      }}
      /*
       * No `title`.
       *
       * The row is a room's name, what it is playing, its chain and a chevron — it says what it is and
       * what pressing it does, and the browser's own tooltip is a grey OS box that lands in the middle
       * of the design a second after the pointer stops. `aria-label` carries the same sentence for
       * anyone who needs it spoken.
       */
      aria-label={current ? `Open ${zone.name}` : `Show ${zone.name}`}
    >
      {/*
       * Name and record, in the plate column the tall row's own name and sleeve stand in.
       *
       * A lane was three grey words where the art face gives a room a sliver of its own
       * artwork. The cover is what makes it a room rather than a row of a table — and it is
       * the same object, one size down.
       */}
      {/*
       * The room's own record, as a band across its line — the wall, turned ninety degrees.
       *
       * On the art face a shut room is a *sliver of its own artwork*, dimmed hard, with its name on it;
       * that is what makes the wall read as the house rather than as a menu. These rows had nothing but
       * type, so they sat in the dark with no edges and no identity. The band is the same device at this
       * face's temperature: grayscale, held far down, and faded out before it reaches the readings, so
       * the numbers stay the brightest thing on the line.
       */}
      {art && <span className="house-art" style={{ backgroundImage: art }} aria-hidden="true" />}

      {/*
       * The room, and what is on in it.
       *
       * The line named the room and then went straight to codecs — so an overview of twenty-four rooms
       * could tell you which ones were resampling and not one of them what it was playing. That is the
       * question a house gets asked. Title and artist under the name, dim, one line, ellipsised: it is
       * the same pairing the panel's nameplate makes, at the size a row can hold.
       */}
      <span className="house-plate">
        {/* The lamp stands where the open tab's does, in the same 36px, so every room's name — open or
            shut — begins on one edge. The record is the band behind the line now. */}
        <span className="house-lamp" data-lit={playing || undefined} aria-hidden="true" />
        <span className="house-text">
          <span className="house-name">{zone.name}</span>
          {zone.track && (
            <span className="house-now">
              {zone.track.title}
              {zone.track.artist ? <i> — {zone.track.artist}</i> : null}
            </span>
          )}
        </span>
      </span>

      {/* The chain, at a glance: one dot a station, lit where that station is doing work. */}
      <span className="house-chain" aria-hidden="true">
        {stages.map((stage) => (
          <i key={stage.label} data-state={dotState(stage.state)} />
        ))}
      </span>

      <span className="house-wire mono">{playing ? wire(zone) : 'idle'}</span>
      <span className="house-out mono">{zone.output?.protocol ?? ''}</span>

      {/*
       * The verdict, in one word.
       *
       * `UNTOUCHED` and `ALTERED` are the panel's own two answers; a lane has room for the
       * word and not the sentence, which is the right amount for a row you are scanning.
       */}
      {/*
       * Nothing, not a dash.
       *
       * These columns held `—` for every idle room, which was right when a lane was a row of a bordered
       * table: a column you scan is only worth scanning if every row answers. In a house of twenty-four
       * quiet rooms it is ninety-six dashes — noise in the shape of information. The grid keeps the
       * columns aligned whether the cells are filled or not, and a silent room says `idle` once, in the
       * one column that is about flow.
       */}
      <span className="house-verdict mono" data-altered={(playing && altered) || undefined}>
        {playing ? (altered ? 'altered' : 'untouched') : ''}
      </span>

      <span className="house-clock mono" data-locked={(playing && sync?.state === 'synchronized') || undefined}>
        {!playing || !sync
          ? ''
          : sync.state === 'synchronized'
            ? `locked${typeof sync.leadMs === 'number' ? ` · ${sync.leadMs} ms` : ''}`
            : sync.state}
      </span>
      {/* A shut tab has to say it opens, and on a line that ends in numbers the cheapest way to say
          it is the mark every list uses. */}
      <span className="house-open" aria-hidden="true" />
    </button>
  );
}
