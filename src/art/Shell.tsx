/**
 * The app's frame on a desk: a sidebar down the left, a player bar along the foot, and between them the
 * pane that holds whatever the room is showing.
 *
 * Why a frame at all, when this face spent its design becoming a poster: the product is a house with
 * several rooms and several services, and both lists were one press away behind a word. Now they stand
 * where every desktop music app keeps them — always visible, one column, so "which room is this going
 * to play in" and "where do I look for it" are answered before they are asked. The poster is still
 * there: it is what the pane shows, and when the room is left alone the frame steps back and the
 * record has the whole screen again (see `.cx-root[data-idle]` in `app.css`).
 *
 * Nothing here knows about providers or protocols. Services come from `GET /services`, rooms from the
 * zones, and the bar is the same `Transport`, `Timeline` and `VolumeRow` the stage draws — one object
 * for "what is playing", not two that drift apart.
 */
import { useApi, useServer } from '@/state/ServerContext';
import { useZoneFavorite } from '@/state/useZoneFavorite';
import { Mark } from '@/components/Mark';
import { Crossfade } from '@/art/Crossfade';
import { artKeyOf } from '@/art/artKey';
import { zoneCoverCss } from '@/art/cover';
import { Timeline, Transport, VolumeRow } from '@/art/Stage';
import { HeartGlyph, QueueGlyph } from '@/art/glyphs';
import { mainTitle } from '@/lib/title';
import type { ContentService } from '@/api/content';
import type { Channel, Cur } from '@/art/useCur';

export type ShellView = 'home' | 'browse' | 'inputs' | 'signal' | 'rooms' | 'house';

/** Two letters of a service's name, for a mark with no logo. Same rule as the hall's `initials`. */
export function Sidebar({
  view,
  sheet,
  services,
  channels,
  currentLeaderId,
  cur,
  onHome,
  onHouse,
  onBrowse,
  onSearch,
  onInputs,
  onSignal,
  onRooms,
  onSelect,
}: {
  view: ShellView;
  sheet: 'rooms' | 'queue' | 'more' | null;
  services: ContentService[];
  channels: Channel[];
  currentLeaderId: number | null;
  cur: Cur;
  onHome: () => void;
  /** The house as light — the desk's home. */
  onHouse: () => void;
  onBrowse: (node?: { id?: string; label?: string }) => void;
  onSearch: () => void;
  onInputs: () => void;
  onSignal: () => void;
  onRooms: () => void;
  onSelect: (zoneId: number) => void;
}) {
  const { status } = useServer();
  return (
    <aside className="cx-side">
      <a className="cx-side-brand" href="/admin/" aria-label="Sonn">
        <Mark className="cx-side-mark" />
        <span className="cx-side-word disp">Sonn</span>
        {/* Out of touch with the house: a dot, as the old bar had. */}
        {status !== 'open' && <span className="cx-stale" title="Not in touch with the house right now" />}
      </a>

      <nav className="cx-sgroup" aria-label="Player">
        <button type="button" className="cx-snav" data-on={(view === 'home' && !sheet) || undefined} onClick={onHome}>
          Now playing
        </button>
        <button type="button" className="cx-snav" data-on={(view === 'house' && !sheet) || undefined} onClick={onHouse}>
          Home
        </button>
        <button type="button" className="cx-snav" data-on={view === 'browse' || undefined} onClick={() => onBrowse()}>
          Music
        </button>
        <button type="button" className="cx-snav" onClick={onSearch}>
          Search
          <span className="cx-snav-k mono">/</span>
        </button>
        <button type="button" className="cx-snav" data-on={view === 'rooms' || undefined} onClick={onRooms}>
          Rooms
        </button>
      </nav>

      <nav className="cx-sgroup" aria-label="Sources">
        <span className="cx-sgroup-lbl mono">sources</span>
        {services.map((service) => (
          <button
            type="button"
            className="cx-snav"
            key={service.id}
            onClick={() => onBrowse({ id: service.rootId, label: service.name })}
          >
            <span className="cx-snav-txt">{service.name}</span>
          </button>
        ))}
        <button type="button" className="cx-snav" data-on={view === 'inputs' || undefined} onClick={onInputs}>
          Inputs
        </button>
      </nav>

      {channels.length > 0 && (
        <nav className="cx-sgroup" aria-label="Rooms">
          <span className="cx-sgroup-lbl mono">rooms</span>
          {channels.map((channel) => {
            const extra = channel.members.length - 1;
            const off = channel.leader.powerState?.power === 'off';
            return (
              <button
                type="button"
                className="cx-snav"
                key={channel.leader.id}
                data-on={channel.leader.id === currentLeaderId || undefined}
                data-quiet={(!channel.hasTrack || off) || undefined}
                onClick={() => onSelect(channel.leader.id)}
              >
                <span
                  className="cx-sdot-state"
                  data-playing={(channel.playing && channel.hasTrack) || undefined}
                  data-paused={(!channel.playing && channel.hasTrack) || undefined}
                  aria-hidden="true"
                />
                <span className="cx-snav-txt">
                  {channel.leader.name}
                  {extra > 0 && <i className="cx-snav-extra"> +{extra}</i>}
                </span>
                {!off && <span className="cx-snav-k mono">{channel.leader.volume}</span>}
              </button>
            );
          })}
        </nav>
      )}

      {/* The foot: the instrument, and the way to the console. The lamp is the verdict — green only when
          the server says the file's own samples reach the room. */}
      <div className="cx-sgroup cx-sgroup-foot">
        {cur.hasTrack && (
          <button type="button" className="cx-snav" data-on={view === 'signal' || undefined} onClick={onSignal}>
            <span className="cx-sdot-state" data-ok={cur.leader?.format?.bitPerfect || undefined} aria-hidden="true" />
            Signal
            {cur.leader?.format?.bitPerfect && <span className="cx-snav-k mono">bit-perfect</span>}
          </button>
        )}
        <a className="cx-snav" href="/admin/" data-quiet>
          Admin
        </a>
      </div>
    </aside>
  );
}

/** The heart, bound to the leader — the same rule the stage's `Favourite` follows. */
function BarFavourite({ cur }: { cur: Cur }) {
  const { available, saved, toggle } = useZoneFavorite(cur.leader);
  if (!available) {
    return null;
  }
  return (
    <button
      type="button"
      className="cx-pbar-fav"
      data-on={saved ? '' : undefined}
      aria-label={saved ? 'Remove from favourites' : 'Add to favourites'}
      onClick={toggle}
    >
      <HeartGlyph size={16} filled={Boolean(saved)} />
    </button>
  );
}

export function PlayerBar({
  cur,
  onHome,
  onBrowse,
  onRooms,
  onQueue,
  onCanvas,
  onHouse,
}: {
  cur: Cur;
  onHome: () => void;
  onBrowse: () => void;
  onRooms: () => void;
  onQueue: () => void;
  /** The record alone, full screen — the canvas rest, asked for. */
  onCanvas: () => void;
  /** The whole house, full screen — the gallery rest. Absent with one room. */
  onHouse?: (() => void) | undefined;
}) {
  const api = useApi();
  const leader = cur.leader;
  const artKey = artKeyOf(leader?.track);

  return (
    <footer className="cx-pbar" data-empty={!cur.hasTrack || undefined}>
      <div className="cx-pbar-np">
        {leader && cur.hasTrack ? (
          <button type="button" className="cx-pbar-cov" onClick={onHome} aria-label="Now playing">
            <Crossfade
              artKey={artKey}
              cover={zoneCoverCss(api, leader, 120)}
              ms={700}
              render={(slot) => <span className="cx-pbar-cov-art" style={{ backgroundImage: slot.cover }} />}
            />
          </button>
        ) : (
          <span className="cx-pbar-cov" data-empty aria-hidden="true">
            <Mark className="cx-pbar-cov-mark" />
          </span>
        )}
        <div className="cx-pbar-meta">
          {cur.hasTrack ? (
            <>
              <span className="cx-pbar-title">{mainTitle(cur.title)}</span>
              <span className="cx-pbar-sub">
                {[cur.artist, cur.album].filter(Boolean).join(' · ')}
              </span>
            </>
          ) : (
            <>
              <span className="cx-pbar-title">{cur.name || 'No room'}</span>
              <button type="button" className="cx-pbar-sub cx-pbar-link" onClick={onBrowse}>
                nothing playing · browse music
              </button>
            </>
          )}
        </div>
        {cur.hasTrack && <BarFavourite cur={cur} />}
      </div>

      <div className="cx-pbar-mid">
        <Transport cur={cur} size="bar" />
        {cur.showBar ? (
          <div className="cx-pbar-tl mono">
            <span className="cx-pbar-time">{cur.elapsed}</span>
            <Timeline cur={cur} bare />
            <span className="cx-pbar-time">{cur.remain}</span>
          </div>
        ) : cur.isLive ? (
          <div className="cx-pbar-tl mono">
            <span className="cx-pbar-live">
              <i aria-hidden="true" />
              live
            </span>
          </div>
        ) : (
          <div className="cx-pbar-tl" aria-hidden="true" />
        )}
      </div>

      <div className="cx-pbar-right">
        {cur.zone && <VolumeRow cur={cur} className="cx-vol cx-pbar-vol" />}
        <button type="button" className="cx-pbar-room mono" onClick={onRooms}>
          <span className="cx-sdot-state" data-playing={cur.isPlaying || undefined} aria-hidden="true" />
          {cur.name || 'rooms'}
          {cur.grouped ? ` +${cur.groupExtra}` : ''}
        </button>
        {cur.hasTrack && !cur.isLive && (
          <button type="button" className="cx-pbar-ic" onClick={onQueue} aria-label="Up next">
            <QueueGlyph size={17} />
          </button>
        )}
        {onHouse && (
          <button type="button" className="cx-pbar-ic" onClick={onHouse} aria-label="The house, full screen" title="Every room, full screen">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <rect x="4" y="4" width="7" height="7" rx="1.5" />
              <rect x="13" y="4" width="7" height="7" rx="1.5" />
              <rect x="4" y="13" width="7" height="7" rx="1.5" />
              <rect x="13" y="13" width="7" height="7" rx="1.5" />
            </svg>
          </button>
        )}
        {cur.hasTrack && (
          <button type="button" className="cx-pbar-ic" onClick={onCanvas} aria-label="Full screen" title="The record, full screen">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </button>
        )}
      </div>
    </footer>
  );
}
