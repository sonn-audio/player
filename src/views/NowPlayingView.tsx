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
import { useEffect, useState } from 'react';
import { Cover } from '@/components/Cover';
import { Transport } from '@/components/Transport';
import { Volume } from '@/components/Volume';
import { Waveform } from '@/components/Waveform';
import { FormatChips, SourceChip } from '@/components/StreamFormat';
import { QueuePanel } from '@/components/QueuePanel';
import { FavoritesPanel } from '@/components/FavoritesPanel';
import { RecentsPanel } from '@/components/RecentsPanel';
import { AnalysisPanel } from '@/components/AnalysisPanel';
import { Icon } from '@/components/Icon';
import { splitQualifier } from '@/lib/format';
import { useZoneFavorite } from '@/state/useZoneFavorite';
import { useApi } from '@/state/ServerContext';
import { useCoverAnchor } from '@/shell/coverMorph';
import type { ApiZoneState } from '@/api/types';

type Tab = 'queue' | 'favorites' | 'recents';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'queue', label: 'Queue' },
  { id: 'favorites', label: 'Favourites' },
  { id: 'recents', label: 'Recents' },
];

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
    <button
      type="button"
      className="np-action"
      data-on={saved ? '' : undefined}
      title={title}
      aria-label={title}
      onClick={toggle}
    >
      <Icon name="star" />
    </button>
  );
}


export function NowPlayingView({
  zone,
  zones,
  isLocal = false,
}: {
  zone: ApiZoneState;
  zones: ApiZoneState[];
  isLocal?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('queue');
  const api = useApi();
  const coverAnchor = useCoverAnchor();
  const tabs = isLocal ? TABS.filter((entry) => entry.id !== 'favorites' && entry.id !== 'recents') : TABS;

  // A zone switch keeps this view mounted. Do not leave the user on a tab that is not available
  // for the temporary browser destination.
  useEffect(() => {
    if (isLocal && (tab === 'favorites' || tab === 'recents')) {
      setTab('queue');
    }
  }, [isLocal, tab]);

  const track = zone.track;

  return (
    <div className="now-playing">
      {/*
        The player itself: pinned, so it stays put while the queue moves under it.
        No card around it — the artwork's colour is the page's background now, and a bordered box
        floating on its own wash reads as a panel that failed to fill.
      */}
      <div className="np-player">
        {/*
          The hero and the light it throws, lit the way the art player lights it.
          The bloom is the sleeve blurred behind the sleeve — see `.np-bloom`.
        */}
        <div className="np-cover" data-playing={zone.state === 'playing' || undefined}>
          {track && (
            <span
              className="np-bloom"
              style={{ backgroundImage: `url("${api.coverUrl(zone.id, { size: 320, cacheKey: track.coverUrl })}")` }}
              aria-hidden="true"
            />
          )}
          <Cover
            zone={zone}
            {...(track?.animatedCoverUrl ? { animatedUrl: track.animatedCoverUrl } : {})}
            size={480}
            className="hero"
            // The one object both faces have in common: switching to the art player flies this sleeve to
            // where that player puts it, rather than crossfading one screen into another.
            anchor={coverAnchor}
          />
        </div>

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
            {/*
              The edition, at a size that matches its importance.
              `(Radio Version)`, `(2010 Remastered Version)`, `[Explicit]` — the catalogue puts these
              inside the title, so at 46px they arrive with the same weight as the song's name while
              usually being the longer half of it. Same line, smaller and quieter; see
              `splitQualifier` for why only a trailing group is treated this way.
            */}
            <h1 className="np-title">
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

            {track?.artist && <p className="np-artist">{track.artist}</p>}

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
              repeats the verdict — see `FormatChips` and `SignalPath`. */}
          <p className="format-chips">
            {zone.source && <SourceChip source={zone.source} />}
            <FormatChips format={zone.format} />
          </p>

          {/* The envelope of what has played, the position, and the seek gesture — one element. A slim
              bar under it drew the position a second time; see `Waveform`. */}
          <Waveform zone={zone} />

          {/*
            Transport, the room's volume beside it, and the one per-track action opposite.

            The volume is *here* rather than in a bar because that is where a hand already is: it was in
            the top bar for a while and adjusting it meant crossing the window while looking at the
            player. And it has to be here now — the bar along the bottom is absent in this view, so
            there is nothing else in sight that carries it.
          */}
          <div className="np-controls">
            <Transport zone={zone} />
            <Volume zone={zone} compact percent />
            {/* One action beside the transport, not two: the "…" that used to sit here held things
                that belong to the room rather than to the track. */}
            <div className="np-actions">
              <TrackHeart zone={zone} />
            </div>
          </div>

          {/*
            No Stop / Power off row: three controls and a sentence at the bottom of a block whose subject
            is the music, two of which act on the *room* rather than on it. The Zone tab that held them —
            along with the room's inputs — is gone too: this view is about what is playing, and the tabs
            under it are the three lists that feed it.
          */}
        </div>

        {/*
          The spectrum runs the full width, under the artwork as well as the controls.
          It is the one element with no natural width — it is a reading of the audio, not a piece
          of metadata — so it takes the space beneath the cover that nothing else was using.
        */}
        <AnalysisPanel
          zoneId={zone.id}
          active={zone.state === 'playing'}
          capabilities={zone.output?.capabilities}
        />
      </div>

      {/*
        The tabs belong to the pinned half, not the scrolling one.
        Sticky-inside-the-scroller would work, but a sticky strip needs an opaque fill to hide the
        rows passing under it — and any fill is a visible band across the artwork wash. Keeping them
        above the scroll boundary means they stay put with no fill at all.
      */}
      <nav className="tabs">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="tab"
            data-active={tab === entry.id || undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {/* The only part that scrolls. */}
      <div className="tab-body">
        {tab === 'queue' && <QueuePanel zone={zone} zones={zones} />}
        {tab === 'favorites' && <FavoritesPanel zone={zone} />}
        {tab === 'recents' && <RecentsPanel zone={zone} />}
      </div>
    </div>
  );
}
