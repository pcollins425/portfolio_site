(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const state = {
    view: "board",
    status: "open",
    search: "",
    items: [],
    stages: [],
    summary: null,
    selectedId: null,
    loading: false,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    statOpen: document.getElementById("stat-open"),
    statOpenAmount: document.getElementById("stat-open-amount"),
    statWon: document.getElementById("stat-won"),
    statSync: document.getElementById("stat-sync"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    statusFilter: document.getElementById("status-filter"),
    listStatus: document.getElementById("list-status"),
    viewToggle: document.getElementById("view-toggle"),
    boardView: document.getElementById("board-view"),
    catalogView: document.getElementById("catalog-view"),
    tbody: document.getElementById("deals-tbody"),
    cardTitle: document.getElementById("card-title"),
    cardMeta: document.getElementById("card-meta"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
    detailFields: document.getElementById("detail-fields"),
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

  function fmtMoney(n) {
    if (n === null || n === undefined || n === "") return "—";
    const num = Number(n);
    if (Number.isNaN(num)) return String(n);
    return num.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function fmtSync(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function stageLabel(stage) {
    const s = String(stage || "").trim() || "(no stage)";
    if (s.length <= 18) return s;
    return `…${s.slice(-12)}`;
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function selectedDeal() {
    return state.items.find((d) => String(d.hubspot_deal_id) === String(state.selectedId)) || null;
  }

  function renderSummary() {
    const s = state.summary || {};
    els.statOpen.textContent = s.open_count != null ? Number(s.open_count).toLocaleString() : "—";
    els.statOpenAmount.textContent = fmtMoney(s.open_amount);
    els.statWon.textContent = s.won_count != null ? Number(s.won_count).toLocaleString() : "—";
    els.statSync.textContent = fmtSync(s.last_sync);
  }

  function renderDetail() {
    const d = selectedDeal();
    if (!d) {
      els.cardTitle.textContent = "Select a deal";
      els.cardMeta.textContent = "";
      els.detailBody.classList.add("empty");
      els.detailEmptyMsg.hidden = false;
      els.detailContent.hidden = true;
      return;
    }
    els.cardTitle.textContent = d.deal_name || d.deal_key || `Deal ${d.hubspot_deal_id}`;
    els.cardMeta.textContent = [d.deal_key, d.casino_name].filter(Boolean).join(" · ");
    els.detailBody.classList.remove("empty");
    els.detailEmptyMsg.hidden = true;
    els.detailContent.hidden = false;

    const fields = [
      ["HubSpot ID", d.hubspot_deal_id],
      ["Key", d.deal_key],
      ["Casino", d.casino_name || d.casino_id],
      ["Pipeline", d.pipeline],
      ["Stage", d.deal_stage],
      ["Amount", fmtMoney(d.amount)],
      ["Close date", fmtDate(d.close_date)],
      ["Create date", fmtDate(d.create_date)],
      ["Project date", fmtDate(d.project_date)],
      ["Sales order", d.sales_order],
      ["Units", d.product_units],
      ["Payout", d.payout_type],
      ["IMS", d.ims_id],
      ["Owner", d.owner_name],
      ["Closed", d.is_closed ? "Yes" : "No"],
      ["Won", d.is_closed_won ? "Yes" : "No"],
      ["Synced", fmtSync(d.synced_at)],
    ];
    els.detailFields.innerHTML = fields
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v == null || v === "" ? "—" : v)}</dd>`)
      .join("");
  }

  function selectDeal(id) {
    state.selectedId = id;
    document.querySelectorAll(".dgs-deal-card.is-selected, #deals-tbody tr.is-selected").forEach((el) => {
      el.classList.remove("is-selected");
    });
    if (id != null) {
      document.querySelectorAll(`[data-deal-id="${CSS.escape(String(id))}"]`).forEach((el) => {
        el.classList.add("is-selected");
      });
    }
    renderDetail();
  }

  function renderBoard() {
    const byStage = new Map();
    for (const st of state.stages) {
      const key = String(st.deal_stage || "(no stage)");
      byStage.set(key, []);
    }
    for (const d of state.items) {
      const key = String(d.deal_stage || "").trim() || "(no stage)";
      if (!byStage.has(key)) byStage.set(key, []);
      byStage.get(key).push(d);
    }

    const cols = [...byStage.entries()];
    if (!cols.length) {
      els.boardView.innerHTML = `<p class="dgs-v2-empty">No deals match this filter.</p>`;
      return;
    }

    els.boardView.innerHTML = cols
      .map(([stage, deals]) => {
        const cards = deals
          .map((d) => {
            const selected = String(d.hubspot_deal_id) === String(state.selectedId) ? " is-selected" : "";
            return `
              <button type="button" class="dgs-deal-card${selected}" data-deal-id="${esc(d.hubspot_deal_id)}">
                <span class="dgs-deal-card-title">${esc(d.deal_name || d.deal_key || "Untitled")}</span>
                <span class="dgs-deal-card-meta">${esc(d.casino_name || d.casino_id || "—")}</span>
                <span class="dgs-deal-card-amount">${esc(fmtMoney(d.amount))}</span>
              </button>`;
          })
          .join("");
        return `
          <div class="dgs-deal-column">
            <div class="dgs-deal-column-head">
              <span class="dgs-deal-column-title" title="${esc(stage)}">${esc(stageLabel(stage))}</span>
              <span class="dgs-deal-column-count">${deals.length}</span>
            </div>
            <div class="dgs-deal-column-body">${cards || `<p class="dgs-v2-empty">Empty</p>`}</div>
          </div>`;
      })
      .join("");

    els.boardView.querySelectorAll(".dgs-deal-card").forEach((btn) => {
      btn.addEventListener("click", () => selectDeal(btn.getAttribute("data-deal-id")));
    });
  }

  function renderCatalog() {
    if (!state.items.length) {
      els.tbody.innerHTML = `<tr><td colspan="6" class="dgs-v2-empty">No deals match this filter.</td></tr>`;
      return;
    }
    els.tbody.innerHTML = state.items
      .map((d) => {
        const selected = String(d.hubspot_deal_id) === String(state.selectedId) ? " is-selected" : "";
        return `
          <tr class="${selected.trim()}" data-deal-id="${esc(d.hubspot_deal_id)}" tabindex="0">
            <td>${esc(d.deal_name || d.deal_key || "—")}</td>
            <td>${esc(d.casino_name || d.casino_id || "—")}</td>
            <td title="${esc(d.deal_stage || "")}">${esc(stageLabel(d.deal_stage))}</td>
            <td>${esc(fmtMoney(d.amount))}</td>
            <td>${esc(fmtDate(d.close_date))}</td>
            <td>${esc(d.owner_name || "—")}</td>
          </tr>`;
      })
      .join("");

    els.tbody.querySelectorAll("tr[data-deal-id]").forEach((tr) => {
      const pick = () => selectDeal(tr.getAttribute("data-deal-id"));
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      });
    });
  }

  function applyView() {
    const board = state.view === "board";
    els.boardView.hidden = !board;
    els.catalogView.hidden = board;
    els.viewToggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === state.view);
    });
    if (board) renderBoard();
    else renderCatalog();
    renderDetail();
  }

  async function loadSummary() {
    state.summary = await fetchJson("/api/commerce/deals/summary");
    renderSummary();
  }

  async function loadDeals() {
    state.loading = true;
    els.listStatus.textContent = "Loading…";
    showError("");
    try {
      const params = new URLSearchParams({
        status: state.status,
        page: "1",
        page_size: "500",
      });
      if (state.search) params.set("q", state.search);
      const data = await fetchJson(`/api/commerce/deals?${params}`);
      state.items = data.items || [];
      state.stages = data.stages || [];
      const shown = state.items.length;
      const total = data.total != null ? data.total : shown;
      els.listStatus.textContent =
        total > shown
          ? `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}`
          : `${shown.toLocaleString()} deal${shown === 1 ? "" : "s"}`;
      if (state.selectedId && !selectedDeal()) state.selectedId = null;
      applyView();
    } catch (err) {
      showError(err.message || String(err));
      els.listStatus.textContent = "";
    } finally {
      state.loading = false;
    }
  }

  function bind() {
    els.viewToggle.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-view]");
      if (!btn) return;
      state.view = btn.getAttribute("data-view");
      applyView();
    });

    els.searchBtn.addEventListener("click", () => {
      state.search = (els.searchInput.value || "").trim();
      loadDeals();
    });
    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        state.search = (els.searchInput.value || "").trim();
        loadDeals();
      }
    });
    els.clearSearch.addEventListener("click", () => {
      els.searchInput.value = "";
      state.search = "";
      loadDeals();
    });
    els.statusFilter.addEventListener("change", () => {
      state.status = els.statusFilter.value || "open";
      loadDeals();
    });
  }

  async function init() {
    bind();
    applyView();
    try {
      await Promise.all([loadSummary(), loadDeals()]);
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  window.DealsV2 = { init };
})();
