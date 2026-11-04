/**
 * SPA shell for client routes under dashboard paths when no static file matches.
 * Also handles Collins Media public inquire (Resend) so the form does not need Slot Server.
 * Kept in sync with vite.config.ts base paths.
 */
const DASHBOARD_PREFIX = "/dashboardtestv1";
const DGS_DASHBOARD_PREFIX = "/dgsappv1/dashboard";
const RESEND_URL = "https://api.resend.com/emails";

/**
 * @param {Request} request
 * @param {{ RESEND_API_KEY?: string, COLLINS_INQUIRE_TO?: string, COLLINS_INQUIRE_FROM?: string }} env
 */
async function handleInquire(request, env) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return Response.json({ detail: "Method not allowed" }, { status: 405, headers: cors });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ detail: "Invalid JSON" }, { status: 400, headers: cors });
  }

  // Honeypot
  if (String(body.website || "").trim()) {
    return Response.json({ ok: true }, { headers: cors });
  }

  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 200);
  const company = String(body.company || "").trim().slice(0, 160);
  const message = String(body.message || "").trim().slice(0, 4000);
  const mix = Array.isArray(body.mix)
    ? body.mix.map((x) => String(x || "").trim().slice(0, 120)).filter(Boolean).slice(0, 40)
    : [];

  if (!name || !message) {
    return Response.json({ detail: "Name and message are required." }, { status: 400, headers: cors });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ detail: "Enter a valid email address." }, { status: 400, headers: cors });
  }

  const apiKey = (env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    return Response.json(
      { detail: "Inquire mail is not configured on the edge yet (RESEND_API_KEY)." },
      { status: 503, headers: cors }
    );
  }

  const to = (env.COLLINS_INQUIRE_TO || "pcollins425@gmail.com").trim();
  const from = (env.COLLINS_INQUIRE_FROM || "Collins Media <hello@collinsmediallc.com>").trim();
  const mixText = mix.length ? mix.map((item) => `- ${item}`).join("\n") : "- (none selected)";
  const subject = mix.length
    ? `Collins Media inquiry — ${mix.length} item${mix.length === 1 ? "" : "s"}`
    : "Collins Media inquiry";
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company || "—"}`,
    "",
    "Mix:",
    mixText,
    "",
    "Message:",
    message,
  ].join("\n");
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const html = `<p><strong>Name:</strong> ${esc(name)}<br><strong>Email:</strong> ${esc(email)}<br><strong>Company:</strong> ${esc(company || "—")}</p><p><strong>Mix</strong></p><ul>${(mix.length ? mix : ["(none selected)"]).map((item) => `<li>${esc(item)}</li>`).join("")}</ul><p><strong>Message</strong></p><p>${esc(message).replace(/\n/g, "<br>")}</p>`;

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject,
      text,
      html,
    }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    return Response.json(
      { detail: `Could not send inquiry: Resend HTTP ${res.status}` },
      { status: 502, headers: cors }
    );
  }
  return Response.json({ ok: true, id: result.id || null }, { headers: cors });
}

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> }, RESEND_API_KEY?: string, COLLINS_INQUIRE_TO?: string, COLLINS_INQUIRE_FROM?: string }} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/public/inquire") {
      return handleInquire(request, env);
    }

    for (const prefix of [DASHBOARD_PREFIX, DGS_DASHBOARD_PREFIX]) {
      const isDashboardBoot =
        pathname === prefix ||
        (pathname.startsWith(`${prefix}/`) &&
          !pathname.startsWith(`${prefix}/assets/`) &&
          !pathname.endsWith(".html"));

      if (isDashboardBoot) {
        url.pathname = `${prefix}/index.html`;
        return env.ASSETS.fetch(new Request(url.toString(), request));
      }
    }

    return env.ASSETS.fetch(request);
  },
};
