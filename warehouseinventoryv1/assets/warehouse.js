(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");

  const state = {
    warehouses: [],
    activeProperty: null,
    detail: null,
    page: 1,
    search: "",
    loading: false,
    error: null,
  };

  const els = {
    grandTotal: document.getElementById("grand-total"),
    summaryGrid: document.getElementById("summary-grid"),
    tabs: document.getElementById("warehouse-tabs"),
    panel: document.getElementById("warehouse-panel"),
    panelTitle: document.getElementById("panel-title"),
    cabinetSummary: document.getElementById("cabinet-summary"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    statusLine: document.getElementById("status-line"),
    tbody: document.getElementById("asset-tbody"),
    pager: document.getElementById("pager"),
    prevPage: document.getElementById("prev-page"),
    nextPage: document.getElementById("next-page"),
    errorBox: document.getElementById("error-box"),
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchJson(path) {
    const res = await fetch(apiUrl(path));
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
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function showError(msg) {
    state.error = msg;
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function renderSummary() {
    const total = state.warehouses.reduce((n, w) => n + w.total, 0);
    els.grandTotal.textContent = total.toLocaleString();

    els.summaryGrid.innerHTML = state.warehouses
      .map(
        (w) => `
        <button type="button" class="summary-card${w.property === state.activeProperty ? " active" : ""}" data-property="${esc(w.property)}">
          <span class="summary-card__count">${w.total.toLocaleString()}</span>
          <span class="summary-card__label">${esc(w.property)}</span>
        </button>`
      )
      .join("");

    els.summaryGrid.querySelectorAll("[data-property]").forEach((btn) => {
      btn.addEventListener("click", () => selectWarehouse(btn.dataset.property));
    });

    els.tabs.innerHTML = state.warehouses
      .map(
        (w) => `
        <button type="button" class="tab${w.property === state.activeProperty ? " active" : ""}" data-property="${esc(w.property)}">
          ${esc(w.property)}
          <span class="tab__badge">${w.total.toLocaleString()}</span>
        </button>`
      )
      .join("");

    els.tabs.querySelectorAll("[data-property]").forEach((btn) => {
      btn.addEventListener("click", () => selectWarehouse(btn.dataset.property));
    });
  }

  function renderDetail() {
    const d = state.detail;
    if (!d) {
      els.panel.hidden = true;
      return;
    }
    els.panel.hidden = false;
    els.panelTitle.textContent = d.property;

    els.cabinetSummary.innerHTML = d.cabinet_counts
      .map(
        (c) => `
        <div class="cabinet-chip">
          <span class="cabinet-chip__count">${c.count.toLocaleString()}</span>
          <span class="cabinet-chip__name">${esc(c.manufacturer || "—")} · ${esc(c.cabinet || "—")}</span>
        </div>`
      )
      .join("");

    const start = (d.page - 1) * d.page_size + 1;
    const end = Math.min(d.page * d.page_size, d.total_assets);
    const searchNote = d.search ? ` matching “${d.search}”` : "";
    els.statusLine.textContent =
      d.total_assets === 0
        ? `No assets${searchNote}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${d.total_assets.toLocaleString()} assets${searchNote} · ${d.distinct_cabinets.toLocaleString()} cabinet types`;

    els.tbody.innerHTML = d.items
      .map(
        (row) => `
        <tr>
          <td class="mono">${esc(row.serial)}</td>
          <td>${esc(row.manufacturer)}</td>
          <td>${esc(row.cabinet)}</td>
          <td>${esc(fmtDate(row.date_received))}</td>
          <td>${esc(row.previous_location || "—")}</td>
        </tr>`
      )
      .join("");

    els.pager.hidden = d.total_pages <= 1;
    els.prevPage.disabled = d.page <= 1;
    els.nextPage.disabled = d.page >= d.total_pages;
    els.pager.querySelector(".pager__label").textContent = `Page ${d.page} of ${d.total_pages}`;
  }

  async function loadDetail() {
    if (!state.activeProperty) return;
    state.loading = true;
    showError(null);
    els.tbody.innerHTML = `<tr><td colspan="5" class="muted">Loading…</td></tr>`;

    const q = encodeURIComponent(state.search);
    const prop = encodeURIComponent(state.activeProperty);
    const path = `/api/warehouse-inventory/warehouse?property=${prop}&q=${q}&page=${state.page}&page_size=100`;

    try {
      state.detail = await fetchJson(path);
      renderDetail();
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    } finally {
      state.loading = false;
    }
  }

  function selectWarehouse(property) {
    if (state.activeProperty === property && state.page === 1 && !state.search) {
      renderSummary();
      return;
    }
    state.activeProperty = property;
    state.page = 1;
    renderSummary();
    loadDetail();
  }

  async function init() {
    showError(null);
    els.panel.hidden = true;
    try {
      const data = await fetchJson("/api/warehouse-inventory/summary");
      state.warehouses = data.warehouses || [];
      renderSummary();
      if (state.warehouses.length) {
        selectWarehouse(state.warehouses[0].property);
      }
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  els.searchBtn.addEventListener("click", () => {
    state.search = els.searchInput.value.trim();
    state.page = 1;
    loadDetail();
  });

  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    loadDetail();
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.search = els.searchInput.value.trim();
      state.page = 1;
      loadDetail();
    }
  });

  els.prevPage.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      loadDetail();
    }
  });

  els.nextPage.addEventListener("click", () => {
    if (state.detail && state.page < state.detail.total_pages) {
      state.page += 1;
      loadDetail();
    }
  });

  init();
})();
