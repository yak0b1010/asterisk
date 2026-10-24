/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute API origin. Empty means same-origin (Vite proxy/nginx). */
  readonly VITE_API_BASE_URL?: string;
  /** Development proxy target used by vite.config.ts. */
  readonly VITE_API_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
