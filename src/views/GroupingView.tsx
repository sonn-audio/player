/**
 * Grouping, and the alignment that only matters once things are grouped.
 *
 * This used to be a modal with a column of checkboxes, which is the right shape for the question
 * "which rooms play together" and the wrong shape for the one that follows it: *now line them up*.
 * A group of speakers is one instrument, and if one of them lands 20 ms early you hear it as a
 * smear rather than as a delay — so the moment a second room joins, the interesting control is a
 * per-player offset, and comparing offsets needs them side by side on one scale.
 *
 * Hence a screen. Every member gets a row with its own delay on the **same** axis, so the knob
 * positions are directly comparable and "the kitchen is 25 ms out" is something you can see rather
 * than work out. The leader is marked because it is the clock the others are measured against.
 *
 * The direction matters more than anything else on this screen, and it is not the intuitive one. The
 * value is how much delay a speaker's own chain adds *after* its audio output — an amplifier, an
 * active speaker — and the player compensates by playing that much **earlier**. So you raise it on
 * the room that arrives *late*, never on the one that runs ahead; the protocol has no negative form
 * and none is needed, because in any pair there is always one that lags.
 *
 * What this screen cannot do is measure the room, and no server can: sound takes about 3 ms to cross
 * a metre, so where you stand is part of the answer. A speaker at arm's length and one five metres
 * off are ~15 ms apart at your ear no matter what any of this reports, and that difference is in the
 * air rather than in the audio. Which is why the guidance below says where to stand — tuning from a
 * spot that is not equidistant corrects your own position instead of the system's, and the result is
 * only right from that one chair.
 *
 * So the screen gives the numbers it does have (the lock, the achieved lead, its floor) and makes the
 * adjustment fast and reversible, which is what dialling in by ear actually needs.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/Icon';
import type { ApiGroupResult, ApiZoneState } from '@/api/types';

/**
 * The slider's range, and the nudge step.
 *
 * The API accepts up to 10 s; speaker-to-speaker alignment lives in the tens of milliseconds, so a
 * 500 ms axis puts the useful travel across the whole width. 5 ms is roughly where a difference
 * stops being audible as a smear on transients — small enough to home in, large enough that the
 * buttons get you somewhere.
 */
const DELAY_MAX_MS = 500;
const NUDGE_MS = 5;

const REJECTION_REASONS: Record<ApiGroupResult['rejected'][number]['reason'], string> = {
  'protocol-mismatch': 'plays over a different output protocol',
  'zone-not-found': 'no longer exists',
};

/**
 * One member's offset.
 *
 * The write happens on release, not per step: each commit is a config write plus a push to the
 * device, and a drag across the axis would be a hundred of them. The nudge buttons commit
 * immediately — a single 5 ms step is exactly the "try it" gesture this screen is for.
 *
 * The value shown is the local one until the zone reports it back, because the PUT's response and
 * the `zone.changed` it triggers are two separate deliveries; dropping the local value on the
 * response makes the knob jump back to the old number for a frame.
 */
function DelayRow({ zone, isLeader }: { zone: ApiZoneState; isLeader: boolean }) {
  const api = useApi();
  const sync = zone.output?.sync;
  const [pending, setPending] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (pending !== null && sync?.delayMs === pending) {
      setPending(null);
    }
  }, [pending, sync?.delayMs]);

  const settable = sync != null;
  const delayMs = dragging ?? pending ?? sync?.delayMs ?? 0;

  const commit = (next: number): void => {
    const clamped = Math.max(0, Math.min(DELAY_MAX_MS, next));
    setDragging(null);
    setFailed(false);
    setPending(clamped);
    void api.setOutputDelay(zone.id, clamped).catch(() => {
      setPending(null);
      setFailed(true);
    });
  };

  const lock =
    sync?.state === 'synchronized'
      ? { label: 'Locked', tone: 'ok' as const }
      : sync?.state === 'error'
        ? { label: 'Lost', tone: 'bad' as const }
        : sync?.state === 'external_source'
          ? { label: 'Elsewhere', tone: 'warn' as const }
          : { label: sync ? 'Not reported' : 'No clock', tone: 'idle' as const };

  return (
    <li className="align-row" data-leader={isLeader || undefined}>
      <div className="align-head">
        <span className="align-name">
          {zone.name}
          {isLeader && <span className="align-tag">leader · clock reference</span>}
        </span>
        <span className="align-lock" data-tone={lock.tone}>
          {lock.label}
        </span>
      </div>

      {/*
        The readings, and only for the zone that is actually sending. A group member's frames are
        mirrored from the leader, so it has no send loop of its own to measure — showing an empty
        Lead for it would read as a fault rather than as "the leader is the one being measured".
      */}
      {sync != null && sync.leadMs !== null && (
        <p className="align-metrics">
          <span>
            lead <b>{sync.leadMs}</b> ms in {sync.targetLeadMs}–
            {sync.targetLeadMs + sync.leadMarginMs}
          </span>
          {sync.leadMinMs !== null && (
            <span>
              floor <b>{sync.leadMinMs}</b> ms
            </span>
          )}
          {sync.driftMs !== null && (
            <span>
              drift{' '}
              <b>
                {sync.driftMs > 0 ? '+' : ''}
                {sync.driftMs}
              </b>{' '}
              ms
            </span>
          )}
        </p>
      )}

      <div className="align-delay">
        <button
          type="button"
          className="icon-button small"
          disabled={!settable || delayMs <= 0}
          title={`${NUDGE_MS} ms less compensation — this room plays later`}
          onClick={() => commit(delayMs - NUDGE_MS)}
        >
          <Icon name="minus" />
        </button>

        <input
          type="range"
          min={0}
          max={DELAY_MAX_MS}
          step={NUDGE_MS}
          value={delayMs}
          disabled={!settable}
          style={{ '--fill': `${(delayMs / DELAY_MAX_MS) * 100}%` } as React.CSSProperties}
          onChange={(event) => setDragging(Number(event.target.value))}
          onPointerUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
          onKeyUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
          aria-label={`Delay for ${zone.name}, milliseconds`}
        />

        <button
          type="button"
          className="icon-button small"
          disabled={!settable || delayMs >= DELAY_MAX_MS}
          title={`${NUDGE_MS} ms more compensation — this room plays earlier`}
          onClick={() => commit(delayMs + NUDGE_MS)}
        >
          <Icon name="plus" />
        </button>

        <span className="align-value">{settable ? `${delayMs} ms` : '—'}</span>
      </div>

      {failed && <p className="align-warn">That delay could not be applied.</p>}
    </li>
  );
}

export function GroupingView({ zone, zones }: { zone: ApiZoneState; zones: ApiZoneState[] }) {
  const api = useApi();
  const [result, setResult] = useState<ApiGroupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keeps the list responsive while the server's `zone.changed` makes the round trip; without it
  // React renders the old membership again the moment you click.
  const [pendingMembers, setPendingMembers] = useState<number[] | null>(null);

  /*
   * A group is owned by its leader.
   *
   * Editing a follower as though it were a new leader makes grouping appear to work while quietly
   * creating a second group, and ungrouping a follower cannot remove anything — the server indexes
   * removal by leader. So every write here goes to `leaderId`, whichever room you arrived from.
   */
  const leaderId = zone.group?.leader ?? zone.id;
  const serverMembers = (zone.group?.members ?? []).filter((id) => id !== leaderId);
  const memberIds = pendingMembers ?? serverMembers;
  const members = new Set(memberIds);

  useEffect(() => {
    setPendingMembers(null);
    setResult(null);
  }, [zone.group?.leader, zone.group?.members?.join(',')]);

  const apply = async (next: Set<number>): Promise<void> => {
    setError(null);
    setPendingMembers([...next]);
    try {
      const applied = await api.setGroup(leaderId, [...next]);
      setResult(applied);
      setPendingMembers(applied.members.filter((id) => id !== applied.leader));
    } catch (err) {
      setPendingMembers(null);
      setError(err instanceof ApiError ? err.code : 'network-error');
    }
  };

  const toggle = (id: number): void => {
    const next = new Set(members);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void apply(next);
  };

  const leader = zones.find((candidate) => candidate.id === leaderId) ?? zone;
  // A member id can outlive the zone it named (a browser destination that closed), so the lookup is
  // filtered rather than trusted: a row for a zone that is gone has nothing to show or set.
  const playing: ApiZoneState[] = [
    leader,
    ...memberIds
      .map((id) => zones.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is ApiZoneState => candidate !== undefined),
  ];
  const others = zones.filter((candidate) => candidate.id !== leaderId && !members.has(candidate.id));
  const rejected = result?.rejected ?? [];

  return (
    <div className="grouping">
      <header className="grouping-head">
        <div>
          <h1 className="disp">Grouping</h1>
          <p className="grouping-lede">
            {members.size === 0
              ? `${leader.name} is playing on its own.`
              : `${playing.length} rooms playing as one, led by ${leader.name}.`}
          </p>
        </div>
        {members.size > 0 && (
          <button type="button" className="text-button" onClick={() => void apply(new Set())}>
            Ungroup all
          </button>
        )}
      </header>

      {/*
        The alignment half. Present even for a single room — its delay is still the knob that lines
        it up against a television, and hiding the control until a second room joins would make it
        look like grouping is what created it.
      */}
      <section className="grouping-section">
        <h2 className="grouping-section-head">
          Alignment
          <span className="grouping-section-note">
            Raise the room that arrives late — the value is delay after its own output, so the player
            compensates by playing earlier. Applies while playing.
          </span>
        </h2>

        {/*
          Read once, then ignored — but worth saying, because the most common way to get this wrong is
          to tune from the sofa and wonder why it falls apart when you stand up.
        */}
        <p className="grouping-guide">
          Stand where the speakers are equally far away. Sound crosses a metre in about 3 ms, so one
          speaker five metres further off arrives ~15 ms later at your ear whatever the numbers say —
          tune from anywhere else and you are correcting your own position, which only holds from that
          spot.
        </p>
        <ul className="align-list">
          {playing.map((member) => (
            <DelayRow key={member.id} zone={member} isLeader={member.id === leaderId} />
          ))}
        </ul>
      </section>

      <section className="grouping-section">
        <h2 className="grouping-section-head">
          Rooms
          <span className="grouping-section-note">
            Frame mirroring works within one output protocol, so a room on another cannot join.
          </span>
        </h2>

        {zones.length < 2 ? (
          <p className="hint">There is only one room on this server.</p>
        ) : (
          <ul className="grouping-rooms">
            {[...playing.slice(1), ...others].map((other) => {
              const joined = members.has(other.id);
              const refusal = rejected.find((entry) => entry.id === other.id);
              return (
                <li key={other.id} className="grouping-room" data-joined={joined || undefined}>
                  <button
                    type="button"
                    className="grouping-room-toggle"
                    onClick={() => toggle(other.id)}
                    aria-pressed={joined}
                  >
                    <span className="grouping-room-mark" aria-hidden="true">
                      <Icon name={joined ? 'check' : 'plus'} />
                    </span>
                    <span className="grouping-room-text">
                      <span className="grouping-room-name">{other.name}</span>
                      <span className="grouping-room-meta">
                        {other.output?.protocol ?? 'no output'}
                        {refusal && ` — could not join: it ${REJECTION_REASONS[refusal.reason]}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error && <p className="align-warn">Could not change the group ({error}).</p>}
    </div>
  );
}
