/**
 * The shell: nav on the left, content in the middle, the room and its output on the right, and
 * what is playing along the bottom.
 *
 * The layout is the argument. A player is two activities that interleave — deciding what to play
 * and controlling what is playing — and the previous shell made them exclusive tabs, so pausing
 * meant leaving the album you were reading. Here the rails are permanent and the bottom bar
 * carries transport everywhere, which means browsing never costs you the controls, and the
 * now-playing view is somewhere you go for the artwork and the queue rather than to press pause.
 *
 * Zones stay **optional but first-class**: the right rail and the bottom bar exist only when
 * there is a room, and a browse-only server is a legitimate configuration rather than a broken
 * one. The connection state is shown rather than hidden — a player whose stream has dropped is
 * displaying the past, and saying so beats letting someone press pause on stale state.
 */
import { useCallback, useMemo, useState } from 'react';
import { useServer } from '@/state/ServerContext';
import { useSelectedZone } from '@/state/useSelectedZone';
import { NavRail, type NavTarget } from '@/components/NavRail';
import { AppBar, type BarView } from '@/components/AppBar';
import { ZoneRail } from '@/components/ZoneRail';
import { NowBar } from '@/components/NowBar';
import { GroupingView } from '@/views/GroupingView';
import { NowPlayingView } from '@/views/NowPlayingView';
import { ContentView } from '@/views/ContentView';
import { Icon } from '@/components/Icon';
import { useLocalPlayback } from '@/state/useLocalPlayback';
import { useMediaSession } from '@/state/useMediaSession';
import type { ApiZoneState } from '@/api/types';

/**
 * What the middle column is showing.
 *
 * A `NavTarget` plus one flag. The target is the same value the rail highlights, so there is exactly
 * one piece of state deciding both what is rendered and what looks selected — the previous split
 * between a view mode and a nav target could disagree, and did.
 *
 * `focusSearch` is not part of the target because it is an *action* ("put the cursor in the field"),
 * not a place; two presses of the search button should both focus it, which a value compared for
 * equality cannot express. The counter does.
 */
type View = { target: NavTarget; searchNonce: number };

/**
 * What the bar says you are looking at.
 *
 * Derived from the same nav target the rail highlights, so the two cannot disagree — the earlier
 * version of this player kept a separate "view mode" beside the target and they did. The playing
 * label names the *room*, because "NOW PLAYING" on a screen showing three rooms' worth of controls is
 * ambiguous in exactly the way a bar should not be.
 */
function barViewOf(target: NavTarget, zone: ApiZoneState | null): BarView {
  if (target.kind === 'playing') {
    return { label: zone ? `now playing · ${zone.name}` : 'now playing', icon: 'wave' };
  }
  if (target.kind === 'grouping') {
    return { label: zone ? `grouping · ${zone.name}` : 'grouping', icon: 'group' };
  }
  if (target.kind === 'collection') {
    return {
      label: target.id === 'favorites' ? 'favourites' : 'recents',
      icon: target.id === 'favorites' ? 'star' : 'clock',
    };
  }
  return { label: target.label ?? 'browse', icon: 'search' };
}

export function App() {
  const { zones: serverZones, status, synced } = useServer();
  const [view, setView] = useState<View>({ target: { kind: 'playing' }, searchNonce: 0 });
  const local = useLocalPlayback();

  /**
   * This browser takes its place among the rooms.
   *
   * A local destination *is* a zone — every zone route works on it — it is simply absent from the
   * listings, because a browser tab is not a room and would otherwise appear in everyone's list.
   * Adding our own back in is what the visibility rule leaves to the client, and it means the
   * browser is selectable and controllable through exactly the same components as the hardware
   * zones rather than a read-only lookalike.
   *
   * First in the list on purpose: someone who just pressed play here is looking for it.
   */
  const zones = useMemo(
    () => (local.zone ? [local.zone, ...serverZones] : serverZones),
    [local.zone, serverZones],
  );
  const { zone, zoneId, select } = useSelectedZone(zones, synced);

  /*
   * The platform's media surface — lock screen, media keys — follows the selected room.
   *
   * Pointed at the group *leader* rather than the selection itself, because a follower mirrors
   * its leader for everything a lock screen shows and its own track fields can be stale — the
   * same rule the art face's `useCur` applies before rendering anything.
   */
  const mediaZone = useMemo(() => {
    if (!zone) {
      return null;
    }
    const leaderId = zone.group?.leader ?? zone.id;
    return zones.find((candidate) => candidate.id === leaderId) ?? zone;
  }, [zone, zones]);
  useMediaSession(mediaZone);

  /*
   * The page's colour does *not* follow the music.
   *
   * It did: `track.colors` is derived server-side from the cover, and the shell tinted every
   * translucent surface from it so one wash read through the whole player. It was pretty per album and
   * incoherent across them — a warm sleeve and a cool one turned the same screen into two different
   * products, and switching rooms changed the temperature of the furniture. So the wash is now one
   * fixed palette, set in `:root` (see styles.css), and this stopped overriding it.
   *
   * What is lost with it: the glow under the sleeve and the analyser's unlit ground no longer take the
   * record's own colour — they take the same fixed tint as everything else. That was the point of
   * keeping the wash, and it is a handful of lines to bring back for the cover alone if the sleeve
   * should light itself again.
   *
   * `track.colors` stays in the contract and stays useful: the art face is where a record's own colour
   * belongs, and nothing here forecloses that.
   */

  const navigate = useCallback((target: NavTarget) => {
    setView((prev) => ({ ...prev, target }));
  }, []);

  /**
   * Search is a destination *and* an action: it goes to the browser and puts the cursor in the
   * field. Bumping the nonce is what makes a second press focus it again rather than being a no-op
   * because the target had not changed.
   */
  const openSearch = useCallback(() => {
    setView((prev) => ({
      // Stay where you are if already browsing — searching from inside an album should not throw
      // away the folder you were in when you clear the field.
      target: prev.target.kind === 'browse' ? prev.target : { kind: 'browse' },
      searchNonce: prev.searchNonce + 1,
    }));
  }, []);

  const navTarget = view.target;

  return (
    <div className="app">
      {/*
        The bar carries the identity, where you are, and the switch to the other face — and nothing
        else, on purpose (see `AppBar`). The rail below is then only about where to go, which is what
        made it legible: it used to hold the wordmark, the picker, search, every destination and the
        exit from the face, and the first job it dropped was being readable.
      */}
      <AppBar view={barViewOf(navTarget, zone)} />

      <div className="app-body">
        <NavRail
          active={navTarget}
          onNavigate={navigate}
          onSearch={openSearch}
          zones={zones}
          selectedZoneId={zoneId}
          onSelectZone={select}
        />

        <main className="main">
          {navTarget.kind === 'grouping' && zone ? (
            <GroupingView zone={zone} zones={zones} />
          ) : navTarget.kind !== 'playing' ? (
            <ContentView
              zone={zone}
              {...(navTarget.kind === 'browse' && navTarget.id
                ? { initialId: navTarget.id, initialLabel: navTarget.label }
                : {})}
              {...(navTarget.kind === 'collection' ? { collection: navTarget.id } : {})}
              searchNonce={view.searchNonce}
            />
          ) : zone ? (
            <NowPlayingView zone={zone} zones={zones} isLocal={local.zone?.id === zone.id} />
          ) : (
            <div className="content-empty">
              <Icon name="speaker" className="content-empty-icon" />
              <h2>{status === 'open' ? 'No zones on this server' : 'Connecting…'}</h2>
              <p>
                {status === 'open'
                  ? 'Add a zone in the admin UI, or pick a service in the sidebar to look around.'
                  : 'Waiting for the server’s event stream.'}
              </p>
            </div>
          )}
        </main>

        {/* Absent rather than empty without a room: the rail is about where audio goes, and
            there is nowhere for it to go. */}
        {zone && <ZoneRail zone={zone} />}
      </div>

      {/*
        The bar exists for one situation: you are looking at something else and want the music without
        leaving it. In the now-playing view it was that situation's opposite — a second cover, a second
        title, a second set of chips, a second transport and a second position, 900px under the first —
        so it is absent there and present everywhere else.
      */}
      {zone && navTarget.kind !== 'playing' && (
        <NowBar zone={zone} onOpen={() => navigate({ kind: 'playing' })} />
      )}

    </div>
  );
}
