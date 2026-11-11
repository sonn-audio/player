/**
 * The crate: what this room played lately, as records you flip through.
 *
 * A shelf of twelve equal thumbnails says "here is a list"; a crate says "here are records". Seven
 * sleeves stand in perspective, the one in the middle upright and named, the others leaning away
 * on either side. Pressing a sleeve at the side brings it to the middle; pressing the middle one
 * plays it. The same recents the room's home shelf shows — nothing new is fetched, only drawn
 * differently.
 *
 * Positions are a function of the distance from the centre and nothing else, so the same seven
 * rules hold for three records or for twelve; `transform` transitions, so re-centring is a turn
 * of the crate rather than a redraw.
 */
import { useState } from 'react';
import { itemCoverCss } from '@/art/cover';
import { PlayGlyph } from '@/art/glyphs';

export type CrateItem = {
  key: string;
  title: string;
  sub: string;
  cover: string | undefined;
  play: () => void;
};

/** How many stand either side of the middle one. */
const REACH = 3;

export function Crate({ items, room }: { items: CrateItem[]; room: string }) {
  /* Open in the middle of the crate, so records stand on both sides of the one in front. */
  const [at, setAt] = useState(() => Math.min(REACH, Math.floor((items.length - 1) / 2)));
  const centre = Math.min(at, Math.max(0, items.length - 1));
  const lead = items[centre];
  if (!lead) {
    return null;
  }

  return (
    <div className="cx-crate">
      <div className="cx-crate-floor" aria-hidden="true" />
      <div className="cx-crate-row">
        {items.map((item, index) => {
          const d = index - centre;
          if (Math.abs(d) > REACH) {
            return null;
          }
          return (
            <button
              type="button"
              className="cx-crate-lp"
              key={item.key}
              style={{ '--d': d, '--ad': Math.abs(d), backgroundImage: itemCoverCss(item.cover) } as React.CSSProperties}
              data-centre={d === 0 || undefined}
              aria-label={d === 0 ? `Play ${item.title}` : item.title}
              onClick={() => (d === 0 ? item.play() : setAt(index))}
            >
              {/* No picture: a white label, with the name typed on it. */}
              {!item.cover && <span className="cx-crate-label mono">{item.title}</span>}
            </button>
          );
        })}
      </div>
      <div className="cx-crate-cap">
        <span className="disp cx-crate-title">{lead.title}</span>
        {lead.sub && <span className="cx-crate-sub">{lead.sub}</span>}
        <button type="button" className="mono cx-play-btn cx-crate-play" onClick={lead.play}>
          <PlayGlyph size={13} /> play in {room}
        </button>
        {items.length > 1 && (
          <span className="cx-crate-dots" aria-hidden="true">
            {items.slice(0, REACH * 2 + 1).map((item, index) => (
              <i key={item.key} data-on={index === centre || undefined} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
