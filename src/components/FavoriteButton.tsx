/**
 * "Make this a favourite of that room."
 *
 * A zone favourite belongs to a zone, not to the library, so the button has to name one — and
 * the zone it targets is whichever room is selected. That is the whole reason this is a button
 * per row rather than a drag target or a menu: the answer to "favourite of where?" is already
 * on screen, so the interaction is one press.
 *
 * Disabled with an explanation rather than hidden when no zone is selected. A control that
 * vanishes leaves the user wondering whether the feature exists.
 */
import { Icon } from '@/components/Icon';
import type { ApiZoneState } from '@/api/types';

export function FavoriteButton({
  zone,
  uri,
  name,
  pending,
  saved,
  onAdd,
}: {
  zone: ApiZoneState | null;
  /** The opaque source id to store. */
  uri: string;
  /** What to call it — always sent, since the server will not name a browse id itself. */
  name: string;
  pending: boolean;
  saved: boolean;
  onAdd: (zoneId: number, uri: string, name: string) => void;
}) {
  const title = !zone
    ? 'Select a zone first'
    : saved
      ? `Saved to ${zone.name}`
      : `Add to ${zone.name}’s favourites`;

  return (
    <button
      type="button"
      className="icon-button small ghost favorite-add"
      data-saved={saved || undefined}
      data-pending={pending || undefined}
      disabled={!zone || pending}
      title={title}
      aria-label={title}
      onClick={(event) => {
        // The row underneath opens or plays; the star must not do both.
        event.stopPropagation();
        if (zone) {
          onAdd(zone.id, uri, name);
        }
      }}
    >
      <Icon name="star" />
    </button>
  );
}
