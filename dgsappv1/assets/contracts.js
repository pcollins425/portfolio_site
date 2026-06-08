(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");

  const state = {
    summary: null,
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    search: "",
    selectedKey: null,
    detail: null,
    detailOpen: false,
    expandedLine: null,
    serialCache: {},
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    statAgreements: document.getElementById("stat-agreements"),
    statLines: document.getElementById("stat-lines"),
    statSerials: document.getElementById("stat-serials"),
    statMissing: document.getElementById("stat-missing"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    tbody: document.getElementById("contracts-tbody"),
    listStatus: document.getElementById("list-status"),
    backdrop: document.getElementById("detail-backdrop"),
    drawer: document.getElementById("detail-drawer"),
    detailTitle: document.getElementById("detail-title"),
    detailSubtitle: document.getElementById("detail-subtitle"),
    detailFields: document.getElementById("detail-fields"),
    linesTbody: document.getElementById("lines-tbody"),
    linesStatus: document.getElementById("lines-status"),
    btnCloseDetail: document.getElementById("btn-close-detail"),
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
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function renderSummary() {
    const s = state.summary;
    if (!s) return;
    els.statAgreements.textContent = fmtNum(s.agreements);
    els.statLines.textContent = fmtNum(s.lines);
    els.statSerials.textContent = fmtNum(s.serials);
    els.statMissing.textContent = fmtNum(s.missing_assets);
  }

  function renderList() {
    els.tbody.innerHTML = state.items
      .map(
        (row) => `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.selectedKey ? "selected" : ""}">
          <td>${esc(row.agreement_id)}</td>
          <td>${esc(row.vendor_name)}</td>
          <td>${esc(row.sales_order || "—")}</td>
          <td>${esc(fmtDate(row.agreement_date))}</td>
          <td><strong>${esc(fmtMoney(row.total_price))}</strong></td>
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
        ? `No contracts found${searchNote}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()} · inventory.contract${searchNote}`;
  }

  function field(label, value, empty) {
    return `
      <label>${esc(label)}</label>
      <div class="value${empty ? " empty" : ""}">${empty ? "(blank)" : esc(value)}</div>`;
  }

  function renderDetailFields(d) {
    els.detailTitle.textContent = d.agreement_id || "Contract";
    els.detailSubtitle.textContent = `${d.vendor_name || "—"} · ${d.reference_key || ""}`;

    els.detailFields.innerHTML = [
      field("Vendor", d.vendor_name, !d.vendor_name),
      field("Sales order", d.sales_order, !d.sales_order),
      field("Agreement date", fmtDate(d.agreement_date), !d.agreement_date),
      field("Total price", fmtMoney(d.total_price), d.total_price == null),
      field("Date received", fmtDate(d.date_received), !d.date_received),
      field("Delivery location", d.delivery_location, !d.delivery_location),
      field("Payment terms", d.payment_terms, !d.payment_terms),
      field("Payment date", fmtDate(d.payment_date), !d.payment_date),
      field("Notes", d.notes, !d.notes),
    ].join("");
  }

  function renderLines() {
    const d = state.detail;
    if (!d) {
      els.linesTbody.innerHTML = "";
      return;
    }

    const rows = [];
    for (const line of d.lines || []) {
      const missing = line.serial_count - line.linked_serial_count;
      const serialLabel =
        line.serial_count === 0
          ? "—"
          : `${line.linked_serial_count}/${line.serial_count}${missing > 0 ? ` (${missing} missing)` : ""}`;

      rows.push(`
        <tr class="contract-line-row" data-line="${esc(line.reference_key)}">
          <td>${esc(line.asset_description)}</td>
          <td>${esc(line.cabinet_name || line.cabinet_id || "—")}</td>
          <td>${esc(fmtNum(line.quantity))}</td>
          <td>${esc(fmtMoney(line.machine_cost))}</td>
          <td>${esc(serialLabel)}</td>
        </tr>
        <tr class="contract-serial-row" data-serial-for="${esc(line.reference_key)}" hidden>
          <td colspan="5">
            <div class="contract-serial-panel" id="serial-panel-${esc(line.reference_key)}"></div>
          </td>
        </tr>`);
    }
    els.linesTbody.innerHTML = rows.join("");

    els.linesTbody.querySelectorAll(".contract-line-row").forEach((tr) => {
      tr.addEventListener("click", () => toggleLineSerials(tr.dataset.line));
    });

    const totalSerials = d.serial_count || 0;
    const linked = d.linked_serial_count || 0;
    els.linesStatus.textContent = `${(d.lines || []).length} line(s) · ${linked.toLocaleString()} / ${totalSerials.toLocaleString()} serials linked to assets`;
  }

  async function toggleLineSerials(lineKey) {
    if (state.expandedLine === lineKey) {
      state.expandedLine = null;
      hideSerialRow(lineKey);
      return;
    }
    if (state.expandedLine) hideSerialRow(state.expandedLine);
    state.expandedLine = lineKey;
    showSerialRow(lineKey);
    await loadSerials(lineKey);
  }

  function showSerialRow(lineKey) {
    const row = els.linesTbody.querySelector(`tr[data-serial-for="${lineKey}"]`);
    if (row) row.hidden = false;
  }

  function hideSerialRow(lineKey) {
    const row = els.linesTbody.querySelector(`tr[data-serial-for="${lineKey}"]`);
    if (row) row.hidden = true;
    const panel = document.getElementById(`serial-panel-${lineKey}`);
    if (panel) {
      panel.classList.remove("is-open");
      panel.innerHTML = "";
    }
  }

  async function loadSerials(lineKey) {
    const panel = document.getElementById(`serial-panel-${lineKey}`);
    if (!panel) return;
    panel.classList.add("is-open");
    panel.innerHTML = `<p class="subtitle">Loading serials…</p>`;

    try {
      let data = state.serialCache[lineKey];
      if (!data) {
        data = await fetchJson(`/api/contracts/lines/${encodeURIComponent(lineKey)}/serials`);
        state.serialCache[lineKey] = data;
      }
      if (!data.serials.length) {
        panel.innerHTML = `<p class="subtitle">No serials on this line.</p>`;
        return;
      }
      panel.innerHTML = `
        <p class="subtitle" style="margin: 0 0 8px;">
          ${data.linked.toLocaleString()} linked · ${data.missing.toLocaleString()} missing asset
        </p>
        <ul class="contract-serial-list">
          ${data.serials
            .map(
              (s) => `
            <li class="contract-serial-chip ${s.linked ? "linked" : "missing"}">
              ${esc(s.serial_number)}${s.asset_id ? ` · ${esc(s.asset_id)}` : ""}
            </li>`
            )
            .join("")}
        </ul>`;
    } catch (err) {
      panel.innerHTML = `<p class="subtitle error">${esc(err.message || String(err))}</p>`;
    }
  }

  function setDetailOpen(open) {
    state.detailOpen = open;
    document.body.classList.toggle("detail-open", open);
    document.body.classList.toggle("detail-split", open);
    els.backdrop.hidden = !open;
    els.drawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      state.selectedKey = null;
      state.detail = null;
      state.expandedLine = null;
      state.serialCache = {};
      renderList();
    }
  }

  async function openDetail(referenceKey) {
    state.selectedKey = referenceKey;
    state.expandedLine = null;
    state.serialCache = {};
    renderList();
    els.linesTbody.innerHTML = `<tr><td colspan="5" class="subtitle">Loading…</td></tr>`;
    setDetailOpen(true);

    try {
      state.detail = await fetchJson(`/api/contracts/${encodeURIComponent(referenceKey)}`);
      renderDetailFields(state.detail);
      renderLines();
    } catch (err) {
      els.detailFields.innerHTML = "";
      els.linesTbody.innerHTML = "";
      els.linesStatus.textContent = err.message || String(err);
    }
  }

  async function loadSummary() {
    state.summary = await fetchJson("/api/contracts/summary");
    renderSummary();
  }

  async function loadList() {
    const q = encodeURIComponent(state.search);
    const path = `/api/contracts?q=${q}&page=${state.page}&page_size=${state.pageSize}`;
    const data = await fetchJson(path);
    state.items = data.items || [];
    state.total = data.total || 0;
    state.totalPages = data.total_pages || 1;
    renderList();
  }

  async function init() {
    showError(null);
    els.tbody.innerHTML = `<tr><td colspan="5" class="subtitle">Loading…</td></tr>`;
    try {
      await Promise.all([loadSummary(), loadList()]);
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    }
  }

  els.searchBtn.addEventListener("click", () => {
    state.search = els.searchInput.value.trim();
    state.page = 1;
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.search = els.searchInput.value.trim();
      state.page = 1;
      loadList().catch((err) => showError(err.message || String(err)));
    }
  });

  els.btnCloseDetail.addEventListener("click", () => setDetailOpen(false));
  els.backdrop.addEventListener("click", () => setDetailOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.detailOpen) setDetailOpen(false);
  });

  window.ContractsApp = { init };
})();
