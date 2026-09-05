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
  const two = output
    ? `${output.codec.toUpperCase()} ${output.sampleRate / 1000}/${output.bitDepth}`
    : '—';
  return `${one} → ${two}`;
}

export function HouseLanes({
  zones,
  onSelect,
}: {
  /** The rooms that are *not* the panel — the caller has already taken itself out. */
  zones: ApiZoneState[];
  onSelect: (zoneId: number) => void;
}) {
  if (zones.length === 0) {
    return null;
  }

  /*
   * No heading.
   *
   * `THE HOUSE` over a block of rows made this a section *about* the house, parked under the player —
   * which is what it was, and why it read as an extra widget. Without it the rows are simply the other
   * rooms of the same column the panel above is the first row of, and the name column running down the
   * page says everything a label would have.
   */
  return (
    <section className="house">
      <ul className="house-lanes">
        {zones.map((zone) => {
          const stages = stagesOf(zone);
          const altered = stages.some((stage) => stage.state === 'on' && stage.label !== 'Source');
          const sync = zone.output?.sync;
          const playing = zone.state === 'playing';

          return (
            <li key={zone.id}>
              <button
                type="button"
                className="house-lane"
                data-playing={playing || undefined}
                onClick={() => onSelect(zone.id)}
                title={`Show ${zone.name}`}
              >
                <span className="house-name">{zone.name}</span>

                {/* The chain, at a glance: one dot a station, lit where that station is doing work. */}
                <span className="house-chain" aria-hidden="true">
                  {stages.map((stage) => (
                    <i key={stage.label} data-state={dotState(stage.state)} />
                  ))}
                </span>

                <span className="house-wire mono">{playing ? wire(zone) : 'idle'}</span>
                <span className="house-out mono">{zone.output?.protocol ?? '—'}</span>

                {/*
                 * The verdict, in one word.
                 *
                 * `UNTOUCHED` and `ALTERED` are the panel's own two answers; a lane has room for the
                 * word and not the sentence, which is the right amount for a row you are scanning.
                 */}
                <span className="house-verdict mono" data-altered={altered || undefined}>
                  {playing ? (altered ? 'altered' : 'untouched') : ''}
                </span>

                <span className="house-clock mono" data-locked={sync?.state === 'synchronized' || undefined}>
                  {sync
                    ? sync.state === 'synchronized'
                      ? `locked${typeof sync.leadMs === 'number' ? ` · ${sync.leadMs} ms` : ''}`
                      : sync.state
                    : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
