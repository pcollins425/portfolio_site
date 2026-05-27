/** Fetch JSON from the Vite **`/api/*`** proxy (FastAPI **`backend_local`**, default :9002). */

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}
