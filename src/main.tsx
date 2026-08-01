/**
 * Entry point.
 *
 * `VITE_SERVER_ORIGIN` points a local dev build at a real server; left unset, everything is
 * same-origin — the built bundle is served by the audioserver itself, and the dev server
 * proxies `/api` to it. Either works, because the API sets `Access-Control-Allow-Origin: *`.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from '@/shell/Root';
import { ServerProvider } from '@/state/ServerContext';
/*
 * Three sheets, in dependency order: the technical player defines the tokens both other sheets read
 * (fonts, surfaces, the accent), the shell styles the splash and the choice between the two players,
 * and the art player's rules are all scoped under `.cx-root` so the two faces cannot leak into each
 * other. Order matters only for the tokens; nothing below overrides anything above.
 */
import '@/styles.css';
import '@/shell.css';
import '@/art.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}

createRoot(root).render(
  <StrictMode>
    {/* One provider above both players: switching face must not reopen the event stream, refetch
        the zones, or lose the selected room. */}
    <ServerProvider origin={import.meta.env.VITE_SERVER_ORIGIN ?? ''}>
      <Root />
    </ServerProvider>
  </StrictMode>,
);
