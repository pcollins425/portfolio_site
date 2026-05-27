/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Tunnel / API origin (**no** trailing slash). Example: **`https://api.collinsmediallc.com`**. Omit in dev (**`/api`** → Vite proxy). */
  readonly VITE_API_BASE_URL?: string;
}
