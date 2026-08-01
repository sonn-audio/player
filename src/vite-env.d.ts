/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin of the audioserver, e.g. `http://192.168.1.209:7090`. Empty = same origin. */
  readonly VITE_SERVER_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
