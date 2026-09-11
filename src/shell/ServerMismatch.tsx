/**
 * The one thing this build says about itself: that it is the wrong one for this server.
 *
 * The server refuses to *install* a player that needs a newer core than it runs, so this state is
 * not reachable by pressing update. It is reachable two other ways — the core was rolled back under
 * a player that was fine before it, or the bundle arrived at build time, where the same check exists
 * but can be waived. Both are rare, and both otherwise present as a player that loads and then
 * behaves oddly with nothing on screen to explain it.
 *
 * Deliberately not a version check on features. `ServerContext` settles that question by *asking* —
 * `/services` answers or it does not — and that is a better test than a number, because it says what
 * this server can do rather than what its version implies. This is the other question: whether the
 * bundle as a whole belongs here at all, which no single endpoint can answer.
 *
 * One line, in the corner, in a room where the audience is whoever walked past the screen. A guest
 * cannot fix a version mismatch, so the note names the console rather than explaining itself.
 */
import { useEffect, useState } from 'react';
import { useServer } from '@/state/ServerContext';
import { satisfiesMin } from '@/lib/semver';

export function ServerMismatch() {
  const { api } = useServer();
  const [needed, setNeeded] = useState<string | null>(null);

  useEffect(() => {
    if (!__MIN_CORE__) {
      return;
    }
    let current = true;
    api
      .getHealth()
      .then((health) => {
        // Open on an unreadable version, exactly as the server is: a core running from a working
        // copy reports `dev`, and accusing a developer's own build of being too old is noise.
        if (current && !satisfiesMin(health.version, __MIN_CORE__)) {
          setNeeded(__MIN_CORE__);
        }
      })
      .catch(() => {
        // A server that will not answer is a different problem, and the shell already says so.
      });
    return () => {
      current = false;
    };
  }, [api]);

  if (!needed) {
    return null;
  }
  return (
    <div className="server-mismatch mono" role="status">
      This player needs server {needed} or newer. Update it in <a href="/admin/">admin</a>.
    </div>
  );
}
