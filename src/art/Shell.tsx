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
import { artKeyOf } from '@/art/accent';
import { zoneCoverCss } from '@/art/cover';
import { serviceTint } from '@/art/Browse';
import { Timeline, Transport, VolumeRow, wireLabel } from '@/art/Stage';
import { HeartGlyph, QueueGlyph, SearchGlyph } from '@/art/glyphs';
import { mainTitle } from '@/lib/title';
import type { ContentService } from '@/api/content';
import type { Channel, Cur } from '@/art/useCur';

export type ShellView = 'home' | 'browse' | 'inputs' | 'signal' | 'rooms';

/** Two letters of a service's name, for a mark with no logo. Same rule as the hall's `initials`. */
function monogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2);
}

/**
 * A service, at sidebar size: its colour as a disc, its monogram on it. The official logo, where the
 * server ships one, is drawn by the hall at a size where a logo reads; at 18px a letter on the right
 * colour is the more honest mark.
 */
function ServiceDot({ service }: { service: ContentService }) {
  const key = service.id.split(':')[0] ?? service.id;
  return (
    <span
      className="cx-sdot disp"
      style={{ '--tint': serviceTint(key) ?? 'var(--t6)' } as React.CSSProperties}
      aria-hidden="true"
    >
      {monogram(service.name)}
    </span>
  );
}

export function Sidebar({
  view,
  sheet,
  services,
  channels,
  currentLeaderId,
  cur,
  onHome,
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="12" cy="12" r="2.2" />
          </svg>
          Now playing
        </button>
        <button type="button" className="cx-snav" data-on={view === 'browse' || undefined} onClick={() => onBrowse()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V6l10-2v12" />
            <circle cx="6.5" cy="18" r="2.5" />
            <circle cx="16.5" cy="16" r="2.5" />
          </svg>
          Music
        </button>
        <button type="button" className="cx-snav" onClick={onSearch}>
          <SearchGlyph size={16} />
          Search
          <span className="cx-snav-k mono">/</span>
        </button>
        <button type="button" className="cx-snav" data-on={view === 'inputs' || undefined} onClick={onInputs}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h10M4 12h16M4 17h7" />
            <circle cx="17" cy="7" r="2" />
            <circle cx="14" cy="17" r="2" />
          </svg>
          Inputs
        </button>
      </nav>

      {services.length > 0 && (
        <nav className="cx-sgroup" aria-label="Services">
          <span className="cx-sgroup-lbl mono">services</span>
          {services.map((service) => (
            <button
              type="button"
              className="cx-snav"
              key={service.id}
              onClick={() => onBrowse({ id: service.rootId, label: service.name })}
            >
              <ServiceDot service={service} />
              <span className="cx-snav-txt">{service.name}</span>
            </button>
          ))}
        </nav>
      )}

      {channels.length > 0 && (
        <nav className="cx-sgroup" aria-label="Rooms">
          <span className="cx-sgroup-lbl mono">
            rooms
            <button type="button" className="cx-sgroup-go" data-on={view === 'rooms' || undefined} onClick={onRooms}>
              desk ›
            </button>
          </span>
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

      <div className="cx-sgroup cx-sgroup-foot">
        {cur.hasTrack && (
          <button type="button" className="cx-snav" data-on={view === 'signal' || undefined} onClick={onSignal}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 13h3l2.5-7 4 13 3-9 1.5 3H21" />
            </svg>
            Signal
            <span className="cx-sdot-state" data-playing={cur.isPlaying || undefined} style={{ marginLeft: 'auto' }} aria-hidden="true" />
          </button>
        )}
        <a className="cx-snav" href="/admin/">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9" />
            <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
          </svg>
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
  onSignal,
  onRooms,
  onQueue,
  onCanvas,
  onHouse,
}: {
  cur: Cur;
  onHome: () => void;
  onBrowse: () => void;
  onSignal: () => void;
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
          <span className="cx-pbar-cov" data-empty aria-hidden="true" />
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
        {cur.hasTrack && (
          <button type="button" className="cx-wire mono cx-pbar-wire" onClick={onSignal} title="What is happening to the audio">
            {wireLabel(cur)}
          </button>
        )}
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
