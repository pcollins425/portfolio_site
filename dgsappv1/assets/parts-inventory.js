(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const state = {
    summary: null,
    families: [],
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    search: "",
    family: "",
    selectedItem: null,
    detail: null,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "error-box",
      "stat-total",
      "stat-families",
      "stat-onhand",
      "stat-balance",
      "family-filter",
      "search-input",
      "search-btn",
      "clear-search",
      "parts-tbody",
      "list-status",
      "page-prev",
      "page-next",
      "detail-body",
      "detail-empty-msg",
      "detail-content",
      "part-actions",
      "detail-fields",
      "balances-tbody",
      "balances-status",
    ].forEach((id) => {
      els[id.replace(/-/g, "_")] = $(id);
    });
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchJson(path, options) {
    const headers = window.DGSAuth ? DGSAuth.authHeaders(options?.headers) : {};
    const res = await fetch(apiUrl(path), { ...options, headers });
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

  function fmtNum(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (Number.isNaN(n)) return esc(v);
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  function showError(msg) {
    if (!els.error_box) return;
    if (!msg) {
      els.error_box.hidden = true;
      els.error_box.textContent = "";
      return;
    }
    els.error_box.hidden = false;
    els.error_box.textContent = msg;
  }

  function listQuery() {
    const params = new URLSearchParams({
      page: String(state.page),
      page_size: String(state.pageSize),
      exclude_software: "true",
    });
    if (state.search) params.set("q", state.search);
    if (state.family) params.set("family", state.family);
    return params.toString();
  }

  function renderSummary() {
    const s = state.summary;
    if (!s) return;
    els.stat_total.textContent = s.total_parts?.toLocaleString() ?? "—";
    els.stat_families.textContent = s.families?.toLocaleString() ?? "—";
    els.stat_onhand.textContent = s.with_onhand?.toLocaleString() ?? "—";
    els.stat_balance.textContent = s.items_with_balance?.toLocaleString() ?? "—";
  }

  function renderFamilies() {
    const select = els.family_filter;
    const current = state.family;
    select.innerHTML = '<option value="">All families</option>';
    state.families.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.item_family === "—" ? "" : f.item_family;
      opt.textContent = `${f.item_family} (${f.count})`;
      select.appendChild(opt);
    });
    select.value = current;
  }

  function renderList() {
    const tbody = els.parts_tbody;
    tbody.innerHTML = "";
    state.items.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.item = row.item;
      if (row.item === state.selectedItem) tr.classList.add("dgs-v2-row--selected");
      tr.innerHTML = `
        <td><code>${esc(row.item)}</code></td>
        <td>${esc(row.descrip || "—")}</td>
        <td class="dgs-v2-col--desktop">${esc(row.item_family || "—")}</td>
        <td class="dgs-v2-bin-qty">${fmtNum(row.onhand)}</td>
        <td class="dgs-v2-col--desktop">${esc(row.location || "—")}</td>`;
      tr.addEventListener("click", () => selectItem(row.item));
      tbody.appendChild(tr);
    });

    const start = state.total ? (state.page - 1) * state.pageSize + 1 : 0;
    const end = Math.min(state.page * state.pageSize, state.total);
    els.list_status.textContent = state.total
      ? `${start}–${end} of ${state.total.toLocaleString()} parts`
      : "No parts match your filters.";

    els.page_prev.disabled = state.page <= 1;
    els.page_next.disabled = state.page >= state.totalPages;
  }

  function fieldRow(label, value) {
    return `<div class="dgs-v2-field"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  }

  function renderDetail() {
    const d = state.detail;
    if (!d) {
      els.detail_body.classList.add("empty");
      els.detail_empty_msg.hidden = false;
      els.detail_content.hidden = true;
      els.part_actions.innerHTML = "";
      return;
    }

    els.detail_body.classList.remove("empty");
    els.detail_empty_msg.hidden = true;
    els.detail_content.hidden = false;

    const vaultNote = d.in_software_vault
      ? '<span class="dgs-v2-lines-status">Also in Software Vault</span>'
      : "";

    els.part_actions.innerHTML = d.emaint_url
      ? `<a class="dgs-v2-btn" href="${esc(d.emaint_url)}" target="_blank" rel="noopener noreferrer">Open in eMaint</a>${vaultNote}`
      : vaultNote;

    els.detail_fields.innerHTML = [
      fieldRow("Reference key", `<code>${esc(d.reference_key)}</code>`),
      fieldRow("Item", `<code>${esc(d.item)}</code>`),
      fieldRow("Description", esc(d.descrip || "—")),
      fieldRow("Family", esc(d.item_family || "—")),
      fieldRow("Sub-category", esc(d.item_subcategory || "—")),
      fieldRow("eMaint category", esc(d.emaint_category || "—")),
      fieldRow("Manufacturer", esc(d.mfr || "—")),
      fieldRow("MFR part no.", esc(d.mfrpartno || "—")),
      fieldRow("Supplier part no.", esc(d.vpartno || "—")),
      fieldRow("On hand", fmtNum(d.onhand)),
      fieldRow("Bin location", esc(d.location || "—")),
      fieldRow("Inventory location", esc(d.state || "—")),
      fieldRow("Unit cost", d.cost != null ? fmtNum(d.cost) : "—"),
      fieldRow("Supplier", esc(d.supplier || "—")),
      fieldRow("Stock item", d.stock == null ? "—" : d.stock ? "Yes" : "No"),
      fieldRow("Last edit", esc([d.editdate, d.edituser].filter(Boolean).join(" · ") || "—")),
    ].join("");

    const balances = d.balances || [];
    els.balances_tbody.innerHTML = balances.length
      ? balances.map((b) => `
          <tr>
            <td>${esc(b.bucket)}</td>
            <td>${esc(b.condition)}</td>
            <td class="dgs-v2-bin-qty">${fmtNum(b.qty)}</td>
          </tr>`).join("")
      : `<tr><td colspan="3">No stock_balance rows for this item.</td></tr>`;

    const positive = balances.filter((b) => Number(b.qty) > 0).length;
    els.balances_status.textContent = balances.length
      ? `${positive} bucket(s) with qty > 0`
      : "Stock buckets will appear after AppSheet migration / WO allocations.";
  }

  async function loadSummary() {
    state.summary = await fetchJson("/api/parts-inventory/summary?exclude_software=true");
    renderSummary();
  }

  async function loadFamilies() {
    const data = await fetchJson("/api/parts-inventory/families?exclude_software=true");
    state.families = data.families || [];
    renderFamilies();
  }

  async function loadList() {
    const data = await fetchJson(`/api/parts-inventory?${listQuery()}`);
    state.items = data.items || [];
    state.page = data.page || 1;
    state.total = data.total || 0;
    state.totalPages = data.total_pages || 1;
    renderList();
  }

  async function loadDetail(item) {
    state.detail = await fetchJson(`/api/parts-inventory/items/${encodeURIComponent(item)}`);
    renderDetail();
  }

  async function selectItem(item) {
    if (!item) return;
    state.selectedItem = item;
    renderList();
    showError("");
    try {
      await loadDetail(item);
    } catch (err) {
      state.detail = null;
      renderDetail();
      showError(err.message || String(err));
    }
  }

  async function refreshAll() {
    showError("");
    try {
      await Promise.all([loadSummary(), loadFamilies(), loadList()]);
      if (state.selectedItem) {
        await loadDetail(state.selectedItem);
      }
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  function bindEvents() {
    els.search_btn.addEventListener("click", () => {
      state.search = els.search_input.value.trim();
      state.page = 1;
      loadList().catch((err) => showError(err.message));
    });

    els.clear_search.addEventListener("click", () => {
      els.search_input.value = "";
      state.search = "";
      state.family = "";
      els.family_filter.value = "";
      state.page = 1;
      loadList().catch((err) => showError(err.message));
    });

    els.search_input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        els.search_btn.click();
      }
    });

    els.family_filter.addEventListener("change", () => {
      state.family = els.family_filter.value;
      state.page = 1;
      loadList().catch((err) => showError(err.message));
    });

    els.page_prev.addEventListener("click", () => {
      if (state.page <= 1) return;
      state.page -= 1;
      loadList().catch((err) => showError(err.message));
    });

    els.page_next.addEventListener("click", () => {
      if (state.page >= state.totalPages) return;
      state.page += 1;
      loadList().catch((err) => showError(err.message));
    });
  }

  async function init() {
    cacheEls();
    bindEvents();
    await refreshAll();
  }

  window.PartsInventoryApp = { init };
})();
