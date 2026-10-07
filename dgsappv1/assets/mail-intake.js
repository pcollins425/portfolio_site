(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");

  const state = {
    items: [],
    selected: new Set(),
    canWrite: false,
    detailUuid: null,
    unsetCount: 0,
  };

  const els = {};

  function authHeaders() {
    const h = { Accept: "application/json", "Content-Type": "application/json" };
    if (window.DGSAuth && DGSAuth.getAuthHeader) {
      const a = DGSAuth.getAuthHeader();
      if (a) Object.assign(h, a);
    }
    return h;
  }

  async function api(path, opts) {
    const res = await fetch(API_BASE + path, {
      ...opts,
      headers: { ...authHeaders(), ...(opts && opts.headers) },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { raw: text };
    }
    if (!res.ok) {
      const detail = (data && (data.detail || data.error)) || res.statusText;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data;
  }

  function showError(msg) {
    if (!els.errorBox) return;
    if (!msg) {
      els.errorBox.hidden = true;
      els.errorBox.textContent = "";
      return;
    }
    els.errorBox.hidden = false;
    els.errorBox.textContent = msg;
  }

  function mailboxChip(mb) {
    const low = (mb || "").toLowerCase();
    if (low.startsWith("accounting@")) return '<span class="mi-chip acct">accounting@</span>';
    if (low.startsWith("paulc@")) return '<span class="mi-chip paulc">paulc@</span>';
    return `<span class="mi-chip">${escapeHtml(mb || "")}</span>`;
  }

  function desigChip(d) {
    const v = d || "unset";
    return `<span class="mi-chip ${escapeHtml(v)}">${escapeHtml(v)}</span>`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return escapeHtml(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function selectedUuids() {
    return Array.from(state.selected);
  }

  function renderList() {
    const rows = state.items
      .map((row) => {
        const id = row.uuid;
        const checked = state.selected.has(id) ? "checked" : "";
        const sel = state.selected.has(id) ? " is-selected" : "";
        const att = row.has_attachments
          ? escapeHtml((row.attachment_names || "yes").split(";")[0].trim().slice(0, 28))
          : "—";
        return `<tr data-uuid="${escapeHtml(id)}" class="${sel}">
          <td><input type="checkbox" class="mi-row-chk" data-uuid="${escapeHtml(id)}" ${checked} /></td>
          <td>${mailboxChip(row.mailbox)}</td>
          <td>${shortWhen(row.internal_date || row.checked_at)}</td>
          <td>
            <div class="mi-subject">${escapeHtml(row.subject || "(no subject)")}</div>
            <div class="mi-from">${escapeHtml(row.gmail_from || "")}</div>
          </td>
          <td>${att}</td>
          <td>${desigChip(row.designation)}</td>
          <td><span class="mi-chip">${escapeHtml(row.process_status || "none")}</span></td>
        </tr>`;
      })
      .join("");
    els.tbody.innerHTML = rows || `<tr><td colspan="7">No messages match.</td></tr>`;
    els.status.textContent = `${state.items.length} shown · ${state.unsetCount} unset · ${state.selected.size} selected`;
  }

  async function loadList() {
    showError("");
    const desig = els.filterDesig.value;
    const mailbox = els.filterMailbox.value;
    const q = els.search.value.trim();
    const qs = new URLSearchParams();
    if (desig) qs.set("designation", desig);
    if (mailbox) qs.set("mailbox", mailbox);
    if (q) qs.set("q", q);
    qs.set("limit", "150");
    els.status.textContent = "Loading…";
    const data = await api("/api/mail-intake?" + qs.toString());
    state.items = data.items || [];
    state.unsetCount = data.unset_count || 0;
    const keep = new Set(state.items.map((r) => r.uuid));
    state.selected = new Set([...state.selected].filter((id) => keep.has(id)));
    renderList();
  }

  async function loadPerms() {
    const data = await api("/api/mail-intake/permissions");
    state.canWrite = Boolean(data.can_write);
    state.unsetCount = data.unset_count || 0;
    ["btnDesigRevenue", "btnDesigFsr", "btnDesigIgnore", "btnDesigUnset", "btnProcess", "btnApply"].forEach(
      (k) => {
        if (els[k]) els[k].disabled = !state.canWrite;
      }
    );
  }

  async function designate(designation) {
    const uuids = selectedUuids();
    if (!uuids.length) {
      showError("Select one or more messages first.");
      return;
    }
    showError("");
    await api("/api/mail-intake/designate", {
      method: "POST",
      body: JSON.stringify({ uuids, designation }),
    });
    state.selected.clear();
    await loadList();
  }

  async function enqueue(path) {
    const uuids = selectedUuids();
    if (!uuids.length) {
      showError("Select designated Revenue/FSR messages first.");
      return;
    }
    showError("");
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify({ uuids }),
    });
    const failed = (data.results || []).filter((r) => !r.ok);
    if (failed.length) {
      showError(failed.map((r) => `${r.uuid.slice(0, 8)}: ${r.error}`).join("; "));
    }
    await loadList();
  }

  async function openDetail(uuid) {
    const row = await api("/api/mail-intake/" + encodeURIComponent(uuid));
    state.detailUuid = uuid;
    document.body.classList.add("detail-open");
    els.backdrop.hidden = false;
    els.detailTitle.textContent = row.subject || "(no subject)";
    const jobs = (row.jobs || [])
      .map((j) => {
        const note =
          j.summary && (j.summary.note || j.summary.verdict)
            ? escapeHtml(j.summary.note || j.summary.verdict)
            : escapeHtml(j.error_text || "");
        return `<div class="mi-job">
          <div><strong>${escapeHtml(j.mode)}</strong> · ${escapeHtml(j.status)} · ${escapeHtml(j.designation)}</div>
          <div class="mi-from">${escapeHtml(j.job_id)}</div>
          ${note ? `<div>${note}</div>` : ""}
          ${j.stage_path ? `<div class="mi-from">${escapeHtml(j.stage_path)}</div>` : ""}
        </div>`;
      })
      .join("");
    els.detailBody.innerHTML = `
      <dl class="mi-field"><dt>Mailbox</dt><dd>${escapeHtml(row.mailbox)}</dd></dl>
      <dl class="mi-field"><dt>From</dt><dd>${escapeHtml(row.gmail_from)}</dd></dl>
      <dl class="mi-field"><dt>When</dt><dd>${escapeHtml(row.internal_date || row.checked_at || "")}</dd></dl>
      <dl class="mi-field"><dt>Designation</dt><dd>${desigChip(row.designation)}</dd></dl>
      <dl class="mi-field"><dt>Process</dt><dd>${escapeHtml(row.process_status)}</dd></dl>
      <dl class="mi-field"><dt>Attachments</dt><dd>${escapeHtml(row.attachment_names || "(none)")}</dd></dl>
      <dl class="mi-field"><dt>Snippet</dt><dd>${escapeHtml(row.snippet || "")}</dd></dl>
      <dl class="mi-field"><dt>Gmail</dt><dd>${
        row.gmail_url
          ? `<a href="${escapeHtml(row.gmail_url)}" target="_blank" rel="noopener">Open in Gmail</a>`
          : "—"
      }</dd></dl>
      <h3 style="margin:16px 0 8px;font-size:.95rem;color:#e8ecf2">Jobs</h3>
      ${jobs || '<p class="mi-from">No process jobs yet.</p>'}
    `;
  }

  function closeDetail() {
    document.body.classList.remove("detail-open");
    els.backdrop.hidden = true;
    state.detailUuid = null;
  }

  function bind() {
    els.errorBox = document.getElementById("error-box");
    els.filterDesig = document.getElementById("filter-designation");
    els.filterMailbox = document.getElementById("filter-mailbox");
    els.search = document.getElementById("search-input");
    els.status = document.getElementById("list-status");
    els.tbody = document.getElementById("mail-tbody");
    els.chkAll = document.getElementById("chk-all");
    els.btnRefresh = document.getElementById("btn-refresh");
    els.btnDesigRevenue = document.getElementById("btn-desig-revenue");
    els.btnDesigFsr = document.getElementById("btn-desig-fsr");
    els.btnDesigIgnore = document.getElementById("btn-desig-ignore");
    els.btnDesigUnset = document.getElementById("btn-desig-unset");
    els.btnProcess = document.getElementById("btn-process");
    els.btnApply = document.getElementById("btn-apply");
    els.backdrop = document.getElementById("detail-backdrop");
    els.drawer = document.getElementById("detail-drawer");
    els.detailTitle = document.getElementById("detail-title");
    els.detailBody = document.getElementById("detail-body");
    els.btnClose = document.getElementById("btn-close-drawer");

    els.btnRefresh.addEventListener("click", () => loadList().catch((e) => showError(e.message)));
    els.filterDesig.addEventListener("change", () => loadList().catch((e) => showError(e.message)));
    els.filterMailbox.addEventListener("change", () => loadList().catch((e) => showError(e.message)));
    let t = null;
    els.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => loadList().catch((e) => showError(e.message)), 300);
    });
    els.chkAll.addEventListener("change", () => {
      if (els.chkAll.checked) state.items.forEach((r) => state.selected.add(r.uuid));
      else state.selected.clear();
      renderList();
    });
    els.tbody.addEventListener("click", (ev) => {
      const chk = ev.target.closest(".mi-row-chk");
      if (chk) {
        const id = chk.getAttribute("data-uuid");
        if (chk.checked) state.selected.add(id);
        else state.selected.delete(id);
        renderList();
        ev.stopPropagation();
        return;
      }
      const tr = ev.target.closest("tr[data-uuid]");
      if (tr) openDetail(tr.getAttribute("data-uuid")).catch((e) => showError(e.message));
    });
    els.btnClose.addEventListener("click", closeDetail);
    els.btnDesigRevenue.addEventListener("click", () => designate("revenue").catch((e) => showError(e.message)));
    els.btnDesigFsr.addEventListener("click", () => designate("fsr").catch((e) => showError(e.message)));
    els.btnDesigIgnore.addEventListener("click", () => designate("ignore").catch((e) => showError(e.message)));
    els.btnDesigUnset.addEventListener("click", () => designate("unset").catch((e) => showError(e.message)));
    els.btnProcess.addEventListener("click", () =>
      enqueue("/api/mail-intake/process").catch((e) => showError(e.message))
    );
    els.btnApply.addEventListener("click", () =>
      enqueue("/api/mail-intake/apply").catch((e) => showError(e.message))
    );
  }

  async function init() {
    bind();
    try {
      await loadPerms();
      await loadList();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  window.DGSMailIntake = { init };
})();
