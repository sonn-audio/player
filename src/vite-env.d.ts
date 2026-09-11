/// <reference types="vite/client" />

/** This build's own version, baked in at build time. */
declare const __APP_VERSION__: string;
/** Oldest server core that can serve this build, or null when it states no minimum. */
declare const __MIN_CORE__: string | null;

interface ImportMetaEnv {
  /** Absolute origin of the audioserver, e.g. `http://192.168.1.209:7090`. Empty = same origin. */
  readonly VITE_SERVER_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
