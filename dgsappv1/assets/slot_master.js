(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    params.get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const SUMMARY_FIELDS = [
    ["zone", "Zone"],
    ["bank", "Bank"],
    ["location", "Location"],
    ["asset_no", "Asset #"],
    ["Hold", "Hold"],
    ["denom", "Denom"],
    ["date_instl", "Installed"],
    ["lastconver", "Last conversion"],
  ];

  const state = {
    permissions: { can_write: false, editable_columns: [] },
    states: [],
    tribes: [],
    casinos: [],
    stateId: "",
    tribeId: "",
    casinoId: "",
    machines: [],
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1,
    search: "",
    stats: null,
    selectedKey: null,
    detail: null,
    history: [],
    historyAssetId: null,
    editDraft: null,
    editExpanded: false,
    detailOpen: false,
    saving: false,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    stateSelect: document.getElementById("state-select"),
    tribeSelect: document.getElementById("tribe-select"),
    casinoSelect: document.getElementById("casino-select"),
    statRow: document.getElementById("stat-row"),
    statActive: document.getElementById("stat-active"),
    statCabinets: document.getElementById("stat-cabinets"),
    statHistory: document.getElementById("stat-history"),
    listPanel: document.getElementById("list-panel"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    tbody: document.getElementById("machines-tbody"),
    listStatus: document.getElementById("list-status"),
    backdrop: document.getElementById("detail-backdrop"),
    drawer: document.getElementById("detail-drawer"),
    detailEyebrow: document.getElementById("detail-eyebrow"),
    detailTitle: document.getElementById("detail-title"),
    detailSubtitle: document.getElementById("detail-subtitle"),
    detailActiveBadge: document.getElementById("detail-active-badge"),
    fkChips: document.getElementById("fk-chips"),
    btnToggleSummary: document.getElementById("btn-toggle-summary"),
    summaryHint: document.getElementById("summary-hint"),
    summaryStrip: document.getElementById("summary-strip"),
    editPanel: document.getElementById("edit-panel"),
    editPanelSubtitle: document.getElementById("edit-panel-subtitle"),
    editGrid: document.getElementById("edit-grid"),
    editActions: document.getElementById("edit-actions"),
    btnCollapseEdit: document.getElementById("btn-collapse-edit"),
    btnApply: document.getElementById("btn-apply"),
    btnDiscard: document.getElementById("btn-discard"),
    historyTitle: document.getElementById("history-title"),
    historyCount: document.getElementById("history-count"),
    historyList: document.getElementById("history-list"),
    btnCloseDetail: document.getElementById("btn-close-detail"),
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (window.DGSAuth) Object.assign(headers, DGSAuth.authHeaders());
    return headers;
  }

  async function fetchJson(path, options) {
    const res = await fetch(apiUrl(path), Object.assign({ headers: authHeaders() }, options || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.detail || body.message || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return body;
  }

  async function patchJson(path, updates) {
    return fetchJson(path, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ updates }),
    });
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
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function setSelectOptions(select, items, valueKey, labelKey, placeholder, selected) {
    select.innerHTML = `<option value="">${esc(placeholder)}</option>`;
    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = item[valueKey];
      opt.textContent = `${item[labelKey]} (${fmtNum(item.active_count)})`;
      if (item[valueKey] === selected) opt.selected = true;
      select.appendChild(opt);
    }
  }

  function cloneDetail(d) {
    return JSON.parse(JSON.stringify(d || {}));
  }

  function renderStats() {
    const s = state.stats;
    if (!s || !state.casinoId) {
      els.statRow.hidden = true;
      return;
    }
    els.statRow.hidden = false;
    els.statActive.textContent = fmtNum(s.active_count);
    els.statCabinets.textContent = fmtNum(s.cabinet_types);
    els.statHistory.textContent = fmtNum(s.history_count);
  }

  function renderList() {
    els.tbody.innerHTML = state.machines
      .map(
        (row) => `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.selectedKey ? "selected" : ""}">
          <td class="mono">${esc(row.serial)}</td>
          <td>${esc(row.vendor_name)} · ${esc(row.cabinet_name)}</td>
          <td>${esc(row.theme_name || "—")}</td>
          <td>${esc(row.zbl || "—")}</td>
          <td>${esc(row.Hold || "—")}</td>
        </tr>`
      )
      .join("");

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.total);
    const searchNote = state.search ? ` · matching “${state.search}”` : "";
    const casino = state.casinos.find((c) => c.casino_id === state.casinoId);
    const casinoLabel = casino ? casino.casino_name : state.casinoId;
    els.listStatus.textContent =
      state.total === 0
        ? `No active machines${searchNote}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()} active · ${casinoLabel}${searchNote}`;
  }

  function assetHubHref(assetId) {
    if (!assetId) return "";
    if (window.DGS) {
      return DGS.withApi(`asset-hub.html?id=${encodeURIComponent(assetId)}`);
    }
    const url = new URL("asset-hub.html", window.location.href);
    url.searchParams.set("id", assetId);
    return url.pathname + url.search;
  }

  function renderFkChips(d) {
    const hub = d.asset_id ? assetHubHref(d.asset_id) : "";
    const assetChip = hub
      ? `<a class="dgs-v2-sm-fk-chip dgs-v2-sm-fk-chip--hub" href="${esc(hub)}">
        <span class="dgs-v2-sm-fk-chip__label">Asset</span>
        <span class="dgs-v2-wh-asset-link">${esc(d.asset_id)}</span>
        <span class="dgs-v2-sm-fk-chip__name">${esc(d.vendor_name)} · ${esc(d.cabinet_name)}</span>
      </a>`
      : `<div class="dgs-v2-sm-fk-chip">
        <span class="dgs-v2-sm-fk-chip__label">Asset</span>
        <span class="dgs-v2-sm-fk-chip__key">${esc(d.asset_id || "—")}</span>
        <span class="dgs-v2-sm-fk-chip__name">${esc(d.vendor_name)} · ${esc(d.cabinet_name)}</span>
      </div>`;

    els.fkChips.innerHTML = `
      ${assetChip}
      <div class="dgs-v2-sm-fk-chip">
        <span class="dgs-v2-sm-fk-chip__label">Casino</span>
        <span class="dgs-v2-sm-fk-chip__key">${esc(d.casino_id)}</span>
        <span class="dgs-v2-sm-fk-chip__name">${esc(d.casino_name)}</span>
      </div>
      <div class="dgs-v2-sm-fk-chip">
        <span class="dgs-v2-sm-fk-chip__label">Theme</span>
        <span class="dgs-v2-sm-fk-chip__key">${esc(d.theme_id)}</span>
        <span class="dgs-v2-sm-fk-chip__name">${esc(d.theme_name || "—")}</span>
      </div>`;
  }

  function renderSummaryStrip(d) {
    els.summaryStrip.innerHTML = SUMMARY_FIELDS.map(
      ([key, label]) => `
      <div class="dgs-v2-sm-summary-item">
        <span class="dgs-v2-sm-summary-item__label">${esc(label)}</span>
        <span class="dgs-v2-sm-summary-item__value">${esc(key.includes("date") ? fmtDate(d[key]) : d[key] || "—")}</span>
      </div>`
    ).join("");
  }

  function renderEditGrid() {
    const d = state.editDraft;
    const cols = state.permissions.editable_columns || [];
    if (!d || !cols.length) {
      els.editGrid.innerHTML = "";
      return;
    }

    els.editGrid.innerHTML = cols
      .map((col) => {
        const val = d[col];
        const display = val === null || val === undefined ? "" : String(val);
        const inputType = ["date_instl", "golive001", "lastconver", "rmvl_date"].includes(col) ? "date" : "text";
        let inputVal = display;
        if (inputType === "date" && display) {
          inputVal = display.slice(0, 10);
        }
        const disabled = state.permissions.can_write ? "" : " disabled";
        return `
          <label class="dgs-v2-sm-edit-field">
            <span class="dgs-v2-sm-edit-field__label">${esc(col)}</span>
            <input type="${inputType}" data-field="${esc(col)}" value="${esc(inputVal)}"${disabled} />
          </label>`;
      })
      .join("");

    els.editGrid.querySelectorAll("input[data-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        state.editDraft[field] = input.value;
      });
    });
  }

  function setEditExpanded(open) {
    state.editExpanded = open;
    els.editPanel.hidden = !open;
    els.btnToggleSummary.setAttribute("aria-expanded", open ? "true" : "false");
    els.summaryHint.textContent = open ? "▴ Hide attributes" : "▾ Show all attributes";
    if (open) renderEditGrid();
  }

  function renderHistory() {
    const items = state.history || [];
    els.historyTitle.textContent = state.historyAssetId
      ? `Asset history · ${state.historyAssetId}`
      : "Asset history";
    const prior = Math.max(0, items.length - 1);
    els.historyCount.textContent = prior ? `${prior} prior state${prior === 1 ? "" : "s"}` : "";

    els.historyList.innerHTML = items
      .map((row) => {
        const selected = state.selectedKey === row.reference_key;
        const active = row.is_active;
        return `
        <button type="button" class="dgs-v2-sm-history-row${selected ? " selected" : ""}${active ? " is-active" : ""}" data-key="${esc(row.reference_key)}">
          <span class="dgs-v2-sm-history-row__dot" aria-hidden="true"></span>
          <span class="dgs-v2-sm-history-row__main">
            <span class="dgs-v2-sm-history-row__title">${esc(row.reference_key)} · ${active ? "Active" : "Inactive"}</span>
            <span class="dgs-v2-sm-history-row__sub">${esc(row.theme_name || "—")} · ${esc(row.casino_name || "—")} · ${esc(row.zbl || "—")}</span>
          </span>
          <span class="dgs-v2-sm-history-row__date">${esc(fmtDate(row.lastconver || row.date_instl))}</span>
        </button>`;
      })
      .join("");

    els.historyList.querySelectorAll(".dgs-v2-sm-history-row").forEach((btn) => {
      btn.addEventListener("click", () => loadHistorySnapshot(btn.dataset.key));
    });
  }

  function renderDetail() {
    const d = state.detail;
    if (!d) return;

    els.detailEyebrow.textContent = d.is_active ? "Active deployment" : "Historical snapshot";
    els.detailTitle.textContent = d.serial || d.reference_key || "Machine";
    els.detailSubtitle.textContent = `${d.reference_key || ""} · ${d.asset_id || ""} · ${d.theme_id || ""}`;
    els.detailActiveBadge.hidden = !d.is_active;
    renderFkChips(d);
    renderSummaryStrip(d);
    els.editPanelSubtitle.textContent = `${d.reference_key || ""} · ${d.is_active ? "active row" : "inactive row"} · same edit form`;
    els.editActions.hidden = !state.permissions.can_write;
    renderHistory();
  }

  function openDrawer() {
    state.detailOpen = true;
    document.body.classList.add("detail-open", "detail-split");
    els.backdrop.hidden = false;
    els.drawer.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    state.detailOpen = false;
    state.selectedKey = null;
    state.detail = null;
    state.editDraft = null;
    state.history = [];
    state.historyAssetId = null;
    setEditExpanded(false);
    document.body.classList.remove("detail-open", "detail-split");
    els.backdrop.hidden = true;
    els.drawer.setAttribute("aria-hidden", "true");
    renderList();
  }

  async function loadHistory(assetId) {
    if (!assetId) {
      state.history = [];
      state.historyAssetId = null;
      return;
    }
    const data = await fetchJson(`/api/slot-master/assets/${encodeURIComponent(assetId)}/history`);
    state.history = data.items || [];
    state.historyAssetId = assetId;
    renderHistory();
  }

  async function openDetail(referenceKey) {
    showError(null);
    try {
      const d = await fetchJson(`/api/slot-master/machines/${encodeURIComponent(referenceKey)}`);
      state.selectedKey = referenceKey;
      state.detail = d;
      state.editDraft = cloneDetail(d);
      await loadHistory(d.asset_id);
      renderDetail();
      renderList();
      openDrawer();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  async function loadHistorySnapshot(referenceKey) {
    showError(null);
    try {
      const d = await fetchJson(`/api/slot-master/machines/${encodeURIComponent(referenceKey)}`);
      state.selectedKey = referenceKey;
      state.detail = d;
      state.editDraft = cloneDetail(d);
      renderDetail();
      renderList();
      if (state.editExpanded) renderEditGrid();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  async function applyEdits() {
    if (!state.permissions.can_write || !state.selectedKey || !state.editDraft) return;
    const d = state.detail;
    const updates = {};
    const cols = state.permissions.editable_columns || [];
    for (const col of cols) {
      const newVal = state.editDraft[col];
      const oldVal = d[col];
      const n = newVal === "" ? null : newVal;
      const o = oldVal === "" ? null : oldVal;
      if (String(n ?? "") !== String(o ?? "")) {
        updates[col] = n;
      }
    }
    if (!Object.keys(updates).length) {
      showError(null);
      return;
    }

    state.saving = true;
    els.btnApply.disabled = true;
    try {
      const updated = await patchJson(
        `/api/slot-master/machines/${encodeURIComponent(state.selectedKey)}`,
        updates
      );
      state.detail = updated;
      state.editDraft = cloneDetail(updated);
      renderDetail();
      if (state.editExpanded) renderEditGrid();
      await loadMachines();
      showError(null);
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      state.saving = false;
      els.btnApply.disabled = false;
    }
  }

  function discardEdits() {
    if (!state.detail) return;
    state.editDraft = cloneDetail(state.detail);
    renderEditGrid();
    showError(null);
  }

  async function loadStates() {
    const data = await fetchJson("/api/slot-master/states");
    state.states = data.items || [];
    setSelectOptions(els.stateSelect, state.states, "state_id", "state_name", "Select state…", state.stateId);
  }

  async function loadTribes() {
    if (!state.stateId) {
      state.tribes = [];
      els.tribeSelect.disabled = true;
      setSelectOptions(els.tribeSelect, [], "tribe_id", "tribe_name", "Select tribe…", "");
      return;
    }
    const data = await fetchJson(`/api/slot-master/tribes?state_id=${encodeURIComponent(state.stateId)}`);
    state.tribes = data.items || [];
    els.tribeSelect.disabled = false;
    setSelectOptions(els.tribeSelect, state.tribes, "tribe_id", "tribe_name", "Select tribe…", state.tribeId);
  }

  async function loadCasinos() {
    if (!state.tribeId) {
      state.casinos = [];
      els.casinoSelect.disabled = true;
      setSelectOptions(els.casinoSelect, [], "casino_id", "casino_name", "Select casino…", "");
      return;
    }
    const data = await fetchJson(`/api/slot-master/casinos?tribe_id=${encodeURIComponent(state.tribeId)}`);
    state.casinos = data.items || [];
    els.casinoSelect.disabled = false;
    setSelectOptions(els.casinoSelect, state.casinos, "casino_id", "casino_name", "Select casino…", state.casinoId);
  }

  async function loadMachines() {
    if (!state.casinoId) {
      state.machines = [];
      state.stats = null;
      els.listPanel.hidden = true;
      renderStats();
      renderList();
      return;
    }

    showError(null);
    const q = encodeURIComponent(state.search);
    const path = `/api/slot-master/machines?casino_id=${encodeURIComponent(state.casinoId)}&q=${q}&page=${state.page}&page_size=${state.pageSize}`;
    try {
      const data = await fetchJson(path);
      state.machines = data.items || [];
      state.total = data.total || 0;
      state.totalPages = data.total_pages || 1;
      state.stats = {
        active_count: data.active_count,
        cabinet_types: data.cabinet_types,
        history_count: data.history_count,
      };
      els.listPanel.hidden = false;
      renderStats();
      renderList();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  async function onStateChange() {
    state.stateId = els.stateSelect.value;
    state.tribeId = "";
    state.casinoId = "";
    els.tribeSelect.value = "";
    els.casinoSelect.value = "";
    closeDrawer();
    await loadTribes();
    await loadCasinos();
    await loadMachines();
  }

  async function onTribeChange() {
    state.tribeId = els.tribeSelect.value;
    state.casinoId = "";
    els.casinoSelect.value = "";
    closeDrawer();
    await loadCasinos();
    await loadMachines();
  }

  async function onCasinoChange() {
    state.casinoId = els.casinoSelect.value;
    state.page = 1;
    closeDrawer();
    await loadMachines();
  }

  async function loadPermissions() {
    try {
      state.permissions = await fetchJson("/api/slot-master/permissions");
    } catch {
      state.permissions = { can_write: false, editable_columns: [] };
    }
  }

  function wireEvents() {
    els.stateSelect.addEventListener("change", () => onStateChange());
    els.tribeSelect.addEventListener("change", () => onTribeChange());
    els.casinoSelect.addEventListener("change", () => onCasinoChange());

    els.searchBtn.addEventListener("click", () => {
      state.search = els.searchInput.value.trim();
      state.page = 1;
      loadMachines();
    });
    els.clearSearch.addEventListener("click", () => {
      els.searchInput.value = "";
      state.search = "";
      state.page = 1;
      loadMachines();
    });
    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        state.search = els.searchInput.value.trim();
        state.page = 1;
        loadMachines();
      }
    });

    els.btnCloseDetail.addEventListener("click", closeDrawer);
    els.backdrop.addEventListener("click", closeDrawer);

    els.btnToggleSummary.addEventListener("click", () => setEditExpanded(!state.editExpanded));
    els.btnCollapseEdit.addEventListener("click", () => setEditExpanded(false));
    els.btnApply.addEventListener("click", applyEdits);
    els.btnDiscard.addEventListener("click", discardEdits);
  }

  async function init() {
    showError(null);
    wireEvents();
    await loadPermissions();
    await loadStates();
  }

  window.SlotMasterApp = { init };
})();
