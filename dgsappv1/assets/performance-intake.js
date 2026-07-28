(function () {
  "use strict";

  function apiBase() {
    return window.DGSAuth ? DGSAuth.apiBase() : "";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(path, opts) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      window.DGSAuth ? DGSAuth.authHeaders() : {}
    );
    const res = await fetch(`${apiBase()}${path}`, Object.assign({ headers }, opts || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.detail || body.message || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return body;
  }

  function showError(msg) {
    const box = document.getElementById("error-box");
    if (!box) return;
    if (!msg) {
      box.hidden = true;
      box.textContent = "";
      return;
    }
    box.hidden = false;
    box.textContent = msg;
  }

  function candidates(caseData) {
    const fromPayload = (caseData.payload && caseData.payload.casino_candidates) || [];
    const fromIssue =
      (caseData.issues &&
        caseData.issues[0] &&
        caseData.issues[0].payload &&
        caseData.issues[0].payload.candidates) ||
      [];
    const list = fromPayload.length ? fromPayload : fromIssue;
    const shorts = list
      .map((c) => (typeof c === "string" ? c : c.casino_short || c.short || ""))
      .filter(Boolean);
    const proposed = caseData.proposed_casino_short;
    if (proposed && !shorts.includes(proposed)) shorts.unshift(proposed);
    return shorts;
  }

  function render(caseData) {
    const root = document.getElementById("root");
    const open = caseData.status === "open";
    const monthDefault = (caseData.proposed_month_end || "").toString().slice(0, 10);
    const shorts = candidates(caseData);
    const options =
      shorts
        .map(
          (s) =>
            `<option value="${esc(s)}"${
              s === caseData.proposed_casino_short ? " selected" : ""
            }>${esc(s)}</option>`
        )
        .join("") || `<option value="">(type casino_short below)</option>`;

    const discovery =
      (caseData.payload && caseData.payload.date_discovery) ||
      (caseData.issues && caseData.issues[0] && caseData.issues[0].payload && caseData.issues[0].payload.date_discovery) ||
      {};

    root.innerHTML = `
      <div class="perf-card">
        <p class="perf-meta">
          Status: <span class="perf-status ${esc(caseData.status)}">${esc(caseData.status)}</span>
          · Case <code>${esc(caseData.case_id)}</code>
        </p>
        <p class="perf-meta"><b>Subject:</b> ${esc(caseData.subject || "—")}</p>
        <p class="perf-meta"><b>From:</b> ${esc(caseData.gmail_from || "—")}</p>
        <p class="perf-meta"><b>Temp:</b> ${esc(caseData.temp_path || "—")}</p>
        <p class="perf-meta"><b>Date discovery:</b> ${esc(discovery.confidence || "—")} / ${esc(
      discovery.method || "—"
    )} → ${esc(discovery.month_end || "—")}</p>
        ${
          open
            ? `
        <label>Casino (casino_short)
          <select id="casino-select">${options}</select>
        </label>
        <label>Or enter casino_short
          <input id="casino-input" type="text" placeholder="e.g. 7Clans - First Council" value="" />
        </label>
        <label>Month end (YYYY-MM-DD)
          <input id="month-end" type="date" value="${esc(monthDefault)}" />
        </label>
        <label>Note (optional)
          <textarea id="note" rows="2"></textarea>
        </label>
        <div class="perf-actions">
          <button type="button" class="dgs-v2-btn-primary" id="btn-confirm">Confirm &amp; file later</button>
          <button type="button" id="btn-revoke">Revoke</button>
        </div>`
            : `
        <p class="perf-meta"><b>Confirmed casino:</b> ${esc(caseData.confirmed_casino_short || "—")}</p>
        <p class="perf-meta"><b>Confirmed period:</b> ${esc(caseData.confirmed_month_end || "—")}</p>
        <p class="perf-meta"><b>Dest:</b> ${esc(caseData.dest_path || "—")}</p>`
        }
      </div>`;

    if (!open) return;

    document.getElementById("btn-confirm").onclick = async () => {
      showError("");
      const sel = document.getElementById("casino-select");
      const typed = (document.getElementById("casino-input").value || "").trim();
      const casino = typed || (sel && sel.value) || "";
      const month_end = document.getElementById("month-end").value;
      const note = document.getElementById("note").value;
      if (!casino || !month_end) {
        showError("Casino and month end are required.");
        return;
      }
      try {
        const updated = await api(`/api/performance-intake/cases/${caseData.case_id}/confirm`, {
          method: "POST",
          body: JSON.stringify({ casino_short: casino, month_end, note }),
        });
        render(updated);
      } catch (e) {
        showError(e.message || String(e));
      }
    };

    document.getElementById("btn-revoke").onclick = async () => {
      showError("");
      const note = document.getElementById("note").value;
      try {
        const updated = await api(`/api/performance-intake/cases/${caseData.case_id}/revoke`, {
          method: "POST",
          body: JSON.stringify({ note }),
        });
        render(updated);
      } catch (e) {
        showError(e.message || String(e));
      }
    };
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const caseId = params.get("case");
    if (!caseId) {
      showError("Open this page from the confirmation email link (?case=…).");
      return;
    }
    try {
      const data = await api(`/api/performance-intake/cases/${caseId}`);
      render(data);
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  window.DGSPerfIntake = { init };
})();
