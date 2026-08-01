/**
 * Play/pause, skip, shuffle and repeat for one zone.
 *
 * No optimistic state anywhere. Every command is followed by a `zone.changed`, so the
 * button reflects the zone rather than what we just asked for — which is what makes two
 * open tabs, a Loxone wall panel and a physical remote agree instead of fighting.
 *
 * `stop` is offered next to `pause` because the contract makes them genuinely different:
 * `pause` keeps the zone's place and `stop` gives it up, and both allow power management
 * to switch an amplifier off. Hiding one would remove a capability rather than simplify.
 */
import { useApi } from '@/state/ServerContext';
import type { ApiRepeatMode, ApiZoneState } from '@/api/types';
import { Icon } from '@/components/Icon';

/** The order the repeat button cycles through. */
const REPEAT_CYCLE: ApiRepeatMode[] = ['off', 'all', 'one'];

export function Transport({ zone }: { zone: ApiZoneState }) {
  const api = useApi();
  const playing = zone.state === 'playing';

  const nextRepeat = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(zone.repeat) + 1) % REPEAT_CYCLE.length]!;

  return (
    <div className="transport">
      <button
        type="button"
        className="icon-button"
        data-active={zone.shuffle || undefined}
        title={zone.shuffle ? 'Shuffle on' : 'Shuffle off'}
        onClick={() => void api.setShuffle(zone.id, !zone.shuffle)}
      >
        <Icon name="shuffle" />
      </button>

      <button
        type="button"
        className="icon-button"
        title="Previous"
        onClick={() => void api.previous(zone.id)}
      >
        <Icon name="previous" />
      </button>

      <button
        type="button"
        className="icon-button primary"
        title={playing ? 'Pause' : 'Play'}
        onClick={() => void (playing ? api.pause(zone.id) : api.play(zone.id))}
      >
        <Icon name={playing ? 'pause' : 'play'} />
      </button>

      <button
        type="button"
        className="icon-button"
        title="Next"
        onClick={() => void api.next(zone.id)}
      >
        <Icon name="next" />
      </button>

      <button
        type="button"
        className="icon-button"
        data-active={zone.repeat !== 'off' || undefined}
        title={`Repeat: ${zone.repeat}`}
        onClick={() => void api.setRepeat(zone.id, nextRepeat)}
      >
        <Icon name={zone.repeat === 'one' ? 'repeat-one' : 'repeat'} />
      </button>
    </div>
  );
}

/*
 * Stop and power used to live here as `ZoneActions`, a row under the transport. They are gone: both
 * act on the *room* rather than on the music, they are pressed once rather than while listening, and a
 * row of them plus a sentence about idle timeouts was the heaviest thing at the bottom of the block.
 * `NowPlayingView`'s overflow menu carries them, with the timeout as the power item's sub-line.
 */
