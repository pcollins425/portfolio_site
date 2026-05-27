/** Dev: relative **`/api/*`** hits the Vite proxy → **`backend_local`**. Prod: **`VITE_API_BASE_URL`** + path. */

const RAW = import.meta.env.VITE_API_BASE_URL;
const BASE = typeof RAW === "string" ? RAW.trim().replace(/\/$/, "") : "";

/** Full URL for an API **`path`** (must start with **`/`). */
export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
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
