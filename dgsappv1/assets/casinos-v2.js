(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const state = {
    summary: null,
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    search: "",
    selectedKey: null,
    detail: null,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    statTotal: document.getElementById("stat-total"),
    statLicensed: document.getElementById("stat-licensed"),
    statStates: document.getElementById("stat-states"),
    statActive: document.getElementById("stat-active"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    tbody: document.getElementById("casinos-tbody"),
    listStatus: document.getElementById("list-status"),
    heroState: document.getElementById("hero-state"),
    heroTitle: document.getElementById("hero-title"),
    heroMeta: document.getElementById("hero-meta"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
    detailFields: document.getElementById("detail-fields"),
    agreementFields: document.getElementById("agreement-fields"),
    contactFields: document.getElementById("contact-fields"),
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchJson(path) {
    const headers = window.DGSAuth ? DGSAuth.authHeaders() : {};
    const res = await fetch(apiUrl(path), { headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.detail || body.message || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return body;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function slotMasterHref(casinoId) {
    if (!casinoId) return "";
    if (window.DGS) {
      return DGS.withApi(`slot_master.html?casino=${encodeURIComponent(casinoId)}`);
    }
    const url = new URL("slot_master.html", window.location.href);
    url.searchParams.set("casino", casinoId);
    return url.pathname + url.search;
  }

  function renderSummary() {
    const s = state.summary;
    if (!s) return;
    els.statTotal.textContent = fmtNum(s.total);
    els.statLicensed.textContent = fmtNum(s.licensed);
    els.statStates.textContent = fmtNum(s.states);
    els.statActive.textContent = fmtNum(s.active_casinos);
  }

  function licensedLabel(v) {
    if (v === null || v === undefined) return "—";
    return v ? "Yes" : "No";
  }

  function renderList() {
    els.tbody.innerHTML = state.items
      .map(
        (row) => `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.selectedKey ? "selected" : ""}">
          <td class="mono">${esc(row.state_abbreviation || "—")}</td>
          <td>${esc(row.casino_name || row.casino_short || "—")}</td>
          <td>${esc(row.tribe_name || "—")}</td>
          <td>${licensedLabel(row.licensed)}</td>
          <td>${fmtNum(row.active_machines)}</td>
        </tr>`
      )
      .join("");

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.total);
    const searchNote = state.search ? ` · matching “${state.search}”` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No casinos found${searchNote}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()}${searchNote}`;
  }

  function field(label, value) {
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
  }

  function fieldHtml(label, html) {
    return `<dt>${esc(label)}</dt><dd>${html}</dd>`;
  }

  function contactField(name, email) {
    if (!name && !email) return field("—", "—");
    const label = name || email;
    const value = name && email ? `${name} · ${email}` : name || email;
    return field(label, value);
  }

  function renderHero(d) {
    if (!d) {
      els.heroState.textContent = "—";
      els.heroTitle.textContent = "Select a casino";
      els.heroMeta.textContent = "Choose a row from the list";
      return;
    }
    els.heroState.textContent = d.state_abbreviation || d.state || "—";
    els.heroTitle.textContent = d.casino_name || d.casino_short || d.reference_key;
    const tribe = d.tribe_name ? `${d.tribe_name} · ` : "";
    els.heroMeta.textContent = `${tribe}${d.reference_key} · ${fmtNum(d.active_machines)} active machines`;
  }

  function renderDetailFields(d) {
    const slotLink =
      d.active_machines > 0
        ? `<a class="dgs-v2-hub-serial-link" href="${esc(slotMasterHref(d.reference_key))}">Slot Master (${fmtNum(d.active_machines)})</a>`
        : fmtNum(d.active_machines);

    els.detailFields.innerHTML = [
      field("Casino ID", d.reference_key),
      field("Name", d.casino_name),
      field("Short name", d.casino_short || "—"),
      field("Legal title", d.legal_title || "—"),
      field("Abbreviation", d.casino_abbreviation || "—"),
      field("Tribe", d.tribe_name || "—"),
      field("State", d.state ? `${d.state} (${d.state_abbreviation || "—"})` : d.state_abbreviation || "—"),
      field("Sales", d.sales || "—"),
      field("eMaint property", d.emaint_property || "—"),
      field("Licensed", d.licensed),
      field("Machine count (record)", fmtNum(d.total_number_of_machines)),
      fieldHtml("Active machines", slotLink),
      field("Projects", fmtNum(d.project_count)),
      field("Main house ADW", fmtNum(d.main_house_average)),
      field("Smoking ADW", fmtNum(d.smoking_adw)),
      field("High limit ADW", fmtNum(d.high_limit_adw)),
      field("Updated", fmtDate(d.update_date)),
      field("Updated by", d.update_by || "—"),
    ].join("");

    els.agreementFields.innerHTML = [
      field("Master agreement", d.signed_master_agreement),
      field("Agreement type", d.agreement_type || "—"),
      field("Executed", fmtDate(d.executed_on)),
      field("Expiration", fmtDate(d.expiration)),
      field("Loss passed", d.loss_passed),
    ].join("");

    els.contactFields.innerHTML = [
      contactField("General manager", d.general_manager_name, d.general_manager_email),
      contactField("Slot director", d.slot_director_name, d.slot_director_email),
      contactField("Accounting", d.accounting_name, d.accounting_email),
    ].join("");
  }

  function setDetailEmpty(empty) {
    els.detailBody.classList.toggle("empty", empty);
    els.detailEmptyMsg.hidden = !empty;
    els.detailContent.hidden = empty;
  }

  async function openDetail(referenceKey) {
    state.selectedKey = referenceKey;
    renderList();

    setDetailEmpty(true);
    els.detailEmptyMsg.textContent = "Loading casino…";
    renderHero(null);
    els.heroTitle.textContent = "Loading…";

    try {
      state.detail = await fetchJson(`/api/commerce/casinos/${encodeURIComponent(referenceKey)}`);
      setDetailEmpty(false);
      renderDetailFields(state.detail);
      renderHero(state.detail);
    } catch (err) {
      state.detail = null;
      setDetailEmpty(true);
      els.detailEmptyMsg.textContent = err.message || String(err);
      renderHero(null);
    }
  }

  async function loadSummary() {
    state.summary = await fetchJson("/api/commerce/casinos/summary");
    renderSummary();
  }

  async function loadList() {
    const q = encodeURIComponent(state.search);
    const path = `/api/commerce/casinos?q=${q}&page=${state.page}&page_size=${state.pageSize}`;
    const data = await fetchJson(path);
    state.items = data.items || [];
    state.total = data.total || 0;
    renderList();

    if (!state.selectedKey && state.items.length) {
      await openDetail(state.items[0].reference_key);
    }
  }

  async function init() {
    showError(null);
    els.tbody.innerHTML = `<tr><td colspan="5" class="dgs-v2-lines-status">Loading…</td></tr>`;
    try {
      await Promise.all([loadSummary(), loadList()]);
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    }
  }

  function runSearch() {
    state.search = els.searchInput.value.trim();
    state.page = 1;
    state.selectedKey = null;
    loadList().catch((err) => showError(err.message || String(err)));
  }

  els.searchBtn.addEventListener("click", runSearch);
  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    state.selectedKey = null;
    loadList().catch((err) => showError(err.message || String(err)));
  });
  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  window.CasinosV2 = { init };
})();
