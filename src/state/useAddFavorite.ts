/**
 * Making a zone favourite out of anything that has a source id.
 *
 * `POST /zones/{id}/favorites` takes any `uri` the API handed out, so a favourite can be made
 * from a browse row, a search hit, a queue entry, a recent, or what is playing — the API never
 * cared where the id came from. What was missing was a client that offered it anywhere other
 * than "save what's playing".
 *
 * **Always send a name.** The docs say a missing one is filled in from what the server knows
 * about the source, and for a browse id it is not: the favourite is created with
 * `name: ""` and stays blank, which is a permanently unreadable row. Every caller here has the
 * name already — it is the row the user clicked — so passing it costs nothing and avoids the
 * gap entirely.
 */
import { useCallback, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { ApiError } from '@/api/client';

export type AddFavoriteState = {
  /** Adds one; resolves true on success. */
  add: (zoneId: number, uri: string, name: string) => Promise<boolean>;
  /** The uri currently being saved, so a row can show progress on itself. */
  pending: string | null;
  /** The uri that was saved last, for a brief confirmation. */
  saved: string | null;
  /** The API's error code, or null. */
  error: string | null;
};

/** How long a row stays marked as saved. Long enough to notice, short enough not to linger. */
const SAVED_MS = 2000;

export function useAddFavorite(): AddFavoriteState {
  const api = useApi();
  const [pending, setPending] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (zoneId: number, uri: string, name: string): Promise<boolean> => {
      setPending(uri);
      setError(null);
      try {
        await api.addFavorite(zoneId, uri, name);
        setSaved(uri);
        // No refresh here: `favorites.changed` tells every panel showing the list, including
        // ones this component knows nothing about.
        window.setTimeout(() => {
          setSaved((current) => (current === uri ? null : current));
        }, SAVED_MS);
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network-error');
        return false;
      } finally {
        setPending((current) => (current === uri ? null : current));
      }
    },
    [api],
  );

  return { add, pending, saved, error };
}
