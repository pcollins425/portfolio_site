/** Dev: relative **`/api/*`** hits the Vite proxy → **`backend_local`**. Prod: **`VITE_API_BASE_URL`** + path. Embedded dgs: **`?api=`** or **`window.DGS.apiBase()`**. */

declare global {
  interface Window {
    DGS?: { apiBase?: () => string };
  }
}

const RAW = import.meta.env.VITE_API_BASE_URL;
const BASE = typeof RAW === "string" ? RAW.trim().replace(/\/$/, "") : "";

function embeddedApiBase(): string {
  if (typeof window === "undefined") return "";
  if (window.DGS?.apiBase) return window.DGS.apiBase().replace(/\/$/, "");
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("api");
  if (fromQuery) return fromQuery.replace(/\/$/, "");
  return "";
}

/** Full URL for an API **`path`** (must start with **`/`**). */
export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const embedded = embeddedApiBase();
  if (embedded) return `${embedded}${path}`;
  return `${BASE}${path}`;
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}
