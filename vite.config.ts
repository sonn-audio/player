import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `version.json`, beside `index.html`, saying which build this is.
 *
 * The audioserver reads it (`readPlayerVersion` in `miscHandlers.ts`) to report the installed player
 * on its status endpoint, which is how the console knows whether the bundle it is serving is behind
 * the latest release. Nothing emitted it, so that reading was permanently `null` and the player was
 * the one component the update surface could not name a version for.
 *
 * Emitted through `emitFile` rather than written to disk, so it is part of the build output wherever
 * that output goes: the release tarball, a local `npm run build`, and `npm run fetch:player`'s copy of
 * `dist/` all carry it without any of them knowing about it.
 */
function versionManifest(): Plugin {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
  ) as { version?: string };

  return {
    name: 'sonn-version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: pkg.version ?? '0.0.0' }, null, 2)}\n`,
      });
    },
  };
}

/**
 * Dev server proxies `/api` to a running audioserver so the app runs same-origin during
 * development. Point it elsewhere with `AUDIOSERVER_URL`.
 *
 * The proxy is a convenience, not a requirement: the API sets
 * `Access-Control-Allow-Origin: *`, so `VITE_SERVER_ORIGIN` can name any reachable server
 * directly. It matters for SSE in particular — `EventSource` needs no special handling
 * either way, which is one of the reasons the contract chose it over a socket.
 *
 * `base: '/player/'` matches where the audioserver serves the built bundle.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.AUDIOSERVER_URL ?? 'http://localhost:7090';

  return {
    base: '/player/',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [react(), versionManifest()],
    server: {
      // Bind all interfaces: Vite's default `localhost` resolves to IPv6 only, which a
      // devcontainer's IPv4 port-forward never reaches.
      host: true,
      port: 5175,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          // SSE must stream rather than buffer, or `server.snapshot` never arrives.
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
                delete proxyRes.headers['content-length'];
              }
            });
          },
        },
        // The service logos (`/admin/providers/*.svg`) are the server's own assets, shared with
        // the admin UI. Same-origin in a real deployment, so this is dev-only plumbing — but
        // without it every provider falls back to a letter chip and the feature looks absent
        // exactly where it is being worked on.
        '/admin/providers': {
          target,
          changeOrigin: true,
        },
        // Local playback rides this socket. `streamUrl` is built from the address the
        // registration arrived on, which in dev is the Vite server — so without `ws: true`
        // here the client dials 5175, nothing answers, and the connect hangs forever.
        '/sendspin': {
          target,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
