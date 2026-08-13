/** Dev: relative **`/api/*`** hits the Vite proxy → **`backend_local`**. Prod: **`VITE_API_BASE_URL`** + path. Embedded dgs: **`?api=`** or **`window.DGS.apiBase()`**. */

declare global {
  interface Window {
    DGS?: { apiBase?: () => string };
    DGSAuth?: {
      apiBase?: () => string;
      authHeaders?: (extra?: Record<string, string>) => Record<string, string>;
    };
  }
}

const RAW = import.meta.env.VITE_API_BASE_URL;
const BASE = typeof RAW === "string" ? RAW.trim().replace(/\/$/, "") : "";

function embeddedApiBase(): string {
  if (typeof window === "undefined") return "";
  if (window.DGSAuth?.apiBase) return window.DGSAuth.apiBase().replace(/\/$/, "");
  if (window.DGS?.apiBase) return window.DGS.apiBase().replace(/\/$/, "");
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("api");
  if (fromQuery) return fromQuery.replace(/\/$/, "");
  return "";
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  if (typeof window !== "undefined" && window.DGSAuth?.authHeaders) {
    return window.DGSAuth.authHeaders(extra);
  }
  return { ...(extra || {}) };
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

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 240);
    try {
      const body = JSON.parse(text) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
      else if (body.detail != null) detail = JSON.stringify(body.detail);
    } catch {
      /* raw text */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: authHeaders() });
  return parseJson<T>(res);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return parseJson<T>(res);
}
