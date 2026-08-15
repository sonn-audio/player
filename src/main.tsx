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

/*
 * Mark the document when the app is running installed — see the note on `.face` for what that buys.
 *
 * `navigator.standalone` is the reliable signal on iOS, which is the platform this is about; the
 * media query is the one everywhere else. Read once: a page cannot become installed while it is
 * open.
 */
if (
  (navigator as Navigator & { standalone?: boolean }).standalone === true ||
  window.matchMedia?.('(display-mode: standalone)').matches === true
) {
  document.documentElement.dataset.standalone = '';
}

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

/*
 * The service worker, which is what makes this installable — see `public/sw.js` for why it is
 * network-first and what it deliberately never touches.
 *
 * Production only. In dev the module graph is served by Vite and a worker sitting in front of it
 * is a way to spend an afternoon wondering why an edit did nothing.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}
