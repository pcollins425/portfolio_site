(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    params.get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const AssetNav = window.DGSAssetNav || {
    hubHref: () => "",
    hubLinkHtml: (_, label) => String(label ?? "—"),
  };

  const COMPACT_MQ = window.matchMedia("(max-width: 1366px)");
  const PAGE_SIZE = 50;

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
    pageSize: PAGE_SIZE,
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
    phoneDetailOpen: false,
    loadingMore: false,
    saving: false,
  };
  let listGen = 0;

  const els = {
    errorBox: document.getElementById("error-box"),
    stateSelect: document.getElementById("state-select"),
    tribeSelect: document.getElementById("tribe-select"),
    casinoSelect: document.getElementById("casino-select"),
    statRow: document.getElementById("stat-row"),
    statActive: document.getElementById("stat-active"),
    statCabinets: document.getElementById("stat-cabinets"),
    statHistory: document.getElementById("stat-history"),
    split: document.getElementById("sm-split"),
    listPanel: document.getElementById("list-panel"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    gridWrap: document.getElementById("machines-grid-wrap"),
    scrollSentinel: document.getElementById("machines-scroll-sentinel"),
    tbody: document.getElementById("machines-tbody"),
    listStatus: document.getElementById("list-status"),
    detailPanel: document.getElementById("detail-panel"),
    detailBackdrop: document.getElementById("sm-detail-backdrop"),
    detailBar: document.getElementById("detail-bar"),
    detailBarTitle: document.getElementById("detail-bar-title"),
    detailClose: document.getElementById("detail-close"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
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
  };

  function isCompact() {
    return COMPACT_MQ.matches;
  }

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

  function hasMore() {
    return state.machines.length < state.total;
  }

  function setDetailEmpty(empty) {
    if (!els.detailBody) return;
    els.detailBody.classList.toggle("empty", empty);
    if (els.detailContent) els.detailContent.hidden = empty;
    if (els.detailEmptyMsg) els.detailEmptyMsg.hidden = !empty;
  }

  function openPhoneDetail() {
    if (!isCompact() || !els.detailPanel) return;
    state.phoneDetailOpen = true;
    document.body.classList.add("sm-detail-open");
    els.detailPanel.classList.add("dgs-v2-detail--sheet");
    els.detailPanel.setAttribute("aria-hidden", "false");
    if (els.detailBackdrop) els.detailBackdrop.hidden = false;
    if (els.detailBar) els.detailBar.hidden = false;
  }

  function closePhoneDetail() {
    state.phoneDetailOpen = false;
    document.body.classList.remove("sm-detail-open");
    if (els.detailPanel) {
      els.detailPanel.classList.remove("dgs-v2-detail--sheet");
      if (isCompact()) els.detailPanel.setAttribute("aria-hidden", "true");
      else els.detailPanel.setAttribute("aria-hidden", "false");
    }
    if (els.detailBackdrop) els.detailBackdrop.hidden = true;
    if (els.detailBar) els.detailBar.hidden = true;
  }

  function showDetail() {
    setDetailEmpty(false);
    if (isCompact()) openPhoneDetail();
    else if (els.detailPanel) els.detailPanel.setAttribute("aria-hidden", "false");
  }

  function clearDetail() {
    state.selectedKey = null;
    state.detail = null;
    state.editDraft = null;
    state.history = [];
    state.historyAssetId = null;
    setEditExpanded(false);
    closePhoneDetail();
    setDetailEmpty(true);
    if (els.detailEmptyMsg) {
      els.detailEmptyMsg.textContent = state.casinoId
        ? "Select a machine to view deployment and history."
        : "Pick a casino to load the floor.";
    }
    renderList();
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

  function vendorLabel(row) {
    return row.vendor_name || "—";
  }

  function cabinetLabel(row) {
    return row.cabinet_name || "—";
  }

  function machineRowHtml(row) {
    const serialLabel = row.serial || "—";
    const serialCell = row.asset_id
      ? AssetNav.hubLinkHtml(row.asset_id, serialLabel)
      : esc(serialLabel);
    return `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.selectedKey ? "selected" : ""}">
          <td class="mono">${serialCell}</td>
          <td class="dgs-v2-col--desktop">${esc(row.vendor_name)} · ${esc(row.cabinet_name)}</td>
          <td>${esc(row.theme_name || "—")}</td>
          <td>${esc(row.zbl || "—")}</td>
          <td class="dgs-v2-col--desktop">${esc(row.Hold || "—")}</td>
        </tr>`;
  }

  function renderList() {
    if (!els.tbody) return;
    if (!state.machines.length) {
      els.tbody.innerHTML = "";
    } else if (!isCompact()) {
      els.tbody.innerHTML = state.machines.map(machineRowHtml).join("");
    } else {
      const sorted = [...state.machines].sort((a, b) => {
        const va = vendorLabel(a).localeCompare(vendorLabel(b));
        if (va) return va;
        const ca = cabinetLabel(a).localeCompare(cabinetLabel(b));
        if (ca) return ca;
        return String(a.serial || "").localeCompare(String(b.serial || ""));
      });
      const parts = [];
      let lastVendor = null;
      let lastCabinet = null;
      for (const row of sorted) {
        const vendor = vendorLabel(row);
        const cabinet = cabinetLabel(row);
        if (vendor !== lastVendor) {
          parts.push(
            `<tr class="dgs-v2-group-row dgs-v2-group-row--state"><td colspan="5"><span class="dgs-v2-group-label">${esc(vendor)}</span></td></tr>`
          );
          lastVendor = vendor;
          lastCabinet = null;
        }
        if (cabinet !== lastCabinet) {
          parts.push(
            `<tr class="dgs-v2-group-row dgs-v2-group-row--tribe"><td colspan="5"><span class="dgs-v2-group-label">${esc(cabinet)}</span></td></tr>`
          );
          lastCabinet = cabinet;
        }
        parts.push(machineRowHtml(row));
      }
      els.tbody.innerHTML = parts.join("");
    }

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });
    els.tbody.querySelectorAll("a.dgs-v2-hub-serial-link").forEach((link) => {
      link.addEventListener("click", (event) => event.stopPropagation());
    });

    const loaded = state.machines.length;
    const searchNote = state.search ? `matching “${state.search}”` : "";
    const casino = state.casinos.find((c) => c.casino_id === state.casinoId);
    const casinoLabel = casino ? casino.casino_name : state.casinoId;
    const noteBits = [];
    if (searchNote) noteBits.push(searchNote);
    if (casinoLabel) noteBits.push(casinoLabel);
    if (state.loadingMore) noteBits.push("loading more");
    else if (hasMore()) noteBits.push("scroll for more");
    const note = noteBits.length ? ` · ${noteBits.join(" · ")}` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No active machines${note}.`
        : `Showing ${loaded.toLocaleString()} of ${state.total.toLocaleString()} active${note}`;
    if (els.scrollSentinel) els.scrollSentinel.hidden = !hasMore();
  }

  function renderFkChips(d) {
    const hub = d.asset_id ? AssetNav.hubHref(d.asset_id) : "";
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
    if (els.editPanel) els.editPanel.hidden = !open;
    if (els.btnToggleSummary) els.btnToggleSummary.setAttribute("aria-expanded", open ? "true" : "false");
    if (els.summaryHint) els.summaryHint.textContent = open ? "▴ Hide attributes" : "▾ Show all attributes";
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

    const title = d.serial || d.reference_key || "Machine";
    els.detailEyebrow.textContent = d.is_active ? "Active deployment" : "Historical snapshot";
    els.detailTitle.textContent = title;
    if (els.detailBarTitle) els.detailBarTitle.textContent = title;
    const assetPart = d.asset_id
      ? AssetNav.hubLinkHtml(d.asset_id, d.asset_id)
      : "—";
    els.detailSubtitle.innerHTML = `${esc(d.reference_key || "")} · ${assetPart} · ${esc(d.theme_id || "")}`;
    els.detailActiveBadge.hidden = !d.is_active;
    renderFkChips(d);
    renderSummaryStrip(d);
    els.editPanelSubtitle.textContent = `${d.reference_key || ""} · ${d.is_active ? "active row" : "inactive row"} · same edit form`;
    els.editActions.hidden = !state.permissions.can_write;
    renderHistory();
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
      showDetail();
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
      await loadMachines({ keepSelection: true });
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

  async function stillSelected() {
    return state.selectedKey && state.machines.some((r) => r.reference_key === state.selectedKey);
  }

  async function syncSelectionAfterLoad() {
    if (isCompact()) {
      if (state.selectedKey && !(await stillSelected())) {
        clearDetail();
      }
      return;
    }
    if (!state.selectedKey && state.machines.length) {
      await openDetail(state.machines[0].reference_key);
    } else if (state.selectedKey && !(await stillSelected())) {
      if (state.machines.length) await openDetail(state.machines[0].reference_key);
      else {
        clearDetail();
        if (els.detailEmptyMsg) els.detailEmptyMsg.textContent = "No active machines in this filter.";
      }
    }
  }

  async function loadMachines(opts) {
    const append = !!(opts && opts.append);
    const gen = append ? listGen : ++listGen;

    if (!state.casinoId) {
      state.machines = [];
      state.stats = null;
      state.total = 0;
      if (els.split) els.split.hidden = true;
      renderStats();
      clearDetail();
      return;
    }

    showError(null);
    const q = encodeURIComponent(state.search);
    const path = `/api/slot-master/machines?casino_id=${encodeURIComponent(state.casinoId)}&q=${q}&page=${state.page}&page_size=${state.pageSize}`;
    try {
      const data = await fetchJson(path);
      if (gen !== listGen) return;
      const incoming = data.items || [];
      if (append) {
        const seen = new Set(state.machines.map((r) => r.reference_key));
        for (const row of incoming) {
          if (row.reference_key && !seen.has(row.reference_key)) {
            seen.add(row.reference_key);
            state.machines.push(row);
          }
        }
      } else {
        state.machines = incoming;
      }
      state.total = data.total || 0;
      state.totalPages = data.total_pages || 1;
      state.page = data.page || state.page;
      state.stats = {
        active_count: data.active_count,
        cabinet_types: data.cabinet_types,
        history_count: data.history_count,
      };
      if (els.split) els.split.hidden = false;
      renderStats();
      renderList();
      if (append) return;
      if (opts && opts.keepSelection) return;
      await syncSelectionAfterLoad();
    } catch (err) {
      if (gen !== listGen) return;
      showError(err.message || String(err));
    }
  }

  async function loadMore() {
    if (state.loadingMore || !hasMore()) return;
    state.loadingMore = true;
    const prevPage = state.page;
    state.page += 1;
    renderList();
    try {
      await loadMachines({ append: true });
    } catch (err) {
      state.page = prevPage;
      throw err;
    } finally {
      state.loadingMore = false;
      renderList();
    }
  }

  async function onStateChange() {
    state.stateId = els.stateSelect.value;
    state.tribeId = "";
    state.casinoId = "";
    state.page = 1;
    els.tribeSelect.value = "";
    els.casinoSelect.value = "";
    clearDetail();
    await loadTribes();
    await loadCasinos();
    await loadMachines();
  }

  async function onTribeChange() {
    state.tribeId = els.tribeSelect.value;
    state.casinoId = "";
    state.page = 1;
    els.casinoSelect.value = "";
    clearDetail();
    await loadCasinos();
    await loadMachines();
  }

  async function onCasinoChange() {
    state.casinoId = els.casinoSelect.value;
    state.page = 1;
    clearDetail();
    await loadMachines();
  }

  async function loadPermissions() {
    try {
      state.permissions = await fetchJson("/api/slot-master/permissions");
    } catch {
      state.permissions = { can_write: false, editable_columns: [] };
    }
  }

  function resetListAndLoad() {
    state.page = 1;
    loadMachines().catch((err) => showError(err.message || String(err)));
  }

  function syncCompactChrome() {
    if (!isCompact()) {
      closePhoneDetail();
      if (els.detailPanel) els.detailPanel.setAttribute("aria-hidden", "false");
    } else if (!state.phoneDetailOpen && els.detailPanel) {
      els.detailPanel.setAttribute("aria-hidden", "true");
    }
    renderList();
  }

  function wireEvents() {
    els.stateSelect.addEventListener("change", () => onStateChange());
    els.tribeSelect.addEventListener("change", () => onTribeChange());
    els.casinoSelect.addEventListener("change", () => onCasinoChange());

    els.searchBtn.addEventListener("click", () => {
      state.search = els.searchInput.value.trim();
      resetListAndLoad();
    });
    els.clearSearch.addEventListener("click", () => {
      els.searchInput.value = "";
      state.search = "";
      resetListAndLoad();
    });
    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        state.search = els.searchInput.value.trim();
        resetListAndLoad();
      }
    });

    els.detailClose?.addEventListener("click", closePhoneDetail);
    els.detailBackdrop?.addEventListener("click", closePhoneDetail);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.phoneDetailOpen) closePhoneDetail();
    });

    els.btnToggleSummary.addEventListener("click", () => setEditExpanded(!state.editExpanded));
    els.btnCollapseEdit.addEventListener("click", () => setEditExpanded(false));
    els.btnApply.addEventListener("click", applyEdits);
    els.btnDiscard.addEventListener("click", discardEdits);

    if (COMPACT_MQ.addEventListener) COMPACT_MQ.addEventListener("change", syncCompactChrome);
    else if (COMPACT_MQ.addListener) COMPACT_MQ.addListener(syncCompactChrome);
  }

  async function init() {
    showError(null);
    wireEvents();
    syncCompactChrome();
    if (window.DGS && typeof DGS.bindInfiniteScroll === "function") {
      DGS.bindInfiniteScroll(els.gridWrap, {
        sentinel: els.scrollSentinel,
        rootMargin: "280px",
        hasMore,
        isBusy: () => state.loadingMore,
        loadMore: () => loadMore().catch((err) => showError(err.message || String(err))),
      });
    }
    await loadPermissions();
    await loadStates();

    const deepCasino = (params.get("casino") || params.get("casino_id") || "").trim();
    if (deepCasino) {
      try {
        await hydrateFromCasino(deepCasino);
      } catch (err) {
        showError(err.message || String(err));
      }
    }
  }

  async function hydrateFromCasino(casinoId) {
    const ctx = await fetchJson(`/api/slot-master/casino-context/${encodeURIComponent(casinoId)}`);
    if (!ctx.state_id || !ctx.tribe_id || !ctx.casino_id) {
      throw new Error(`Could not resolve casino ${casinoId} for Slot Master filters.`);
    }
    state.stateId = ctx.state_id;
    state.tribeId = ctx.tribe_id;
    state.casinoId = ctx.casino_id;
    state.page = 1;
    els.stateSelect.value = state.stateId;
    await loadTribes();
    els.tribeSelect.value = state.tribeId;
    await loadCasinos();
    els.casinoSelect.value = state.casinoId;
    await loadMachines();
  }

  window.SlotMasterApp = { init };
})();
