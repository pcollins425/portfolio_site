(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const PIPE_ALL = "";
  const PIPE_STORAGE_KEY = "dgs-deals-pipeline";

  const state = {
    view: "board",
    status: "open",
    pipeline: PIPE_ALL,
    search: "",
    items: [],
    stages: [],
    pipelines: [],
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
    pipelineFilter: document.getElementById("pipeline-filter"),
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
    lineItemsTbody: document.getElementById("line-items-tbody"),
    lineItemsStatus: document.getElementById("line-items-status"),
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

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function selectedDeal() {
    return state.items.find((d) => String(d.hubspot_deal_id) === String(state.selectedId)) || null;
  }

  function defaultPipelineId() {
    const preferred = state.pipelines.find((p) => p.is_default) ||
      state.pipelines.find((p) => p.pipeline_id === "default") ||
      state.pipelines[0];
    return preferred ? preferred.pipeline_id : PIPE_ALL;
  }

  function ensurePipelineForView() {
    if (state.view === "board" && !state.pipeline) {
      state.pipeline = defaultPipelineId();
    }
  }

  function renderPipelineOptions() {
    const opts = [];
    if (state.view === "catalog") {
      opts.push(`<option value="">All pipelines</option>`);
    }
    for (const p of state.pipelines) {
      const id = p.pipeline_id || "";
      const label = p.label || id;
      const count = p.deal_count != null ? ` (${Number(p.deal_count).toLocaleString()})` : "";
      opts.push(`<option value="${esc(id)}">${esc(label)}${esc(count)}</option>`);
    }
    els.pipelineFilter.innerHTML = opts.join("");

    ensurePipelineForView();
    const allowed = new Set(
      [...els.pipelineFilter.options].map((o) => o.value)
    );
    if (!allowed.has(state.pipeline)) {
      state.pipeline = state.view === "board" ? defaultPipelineId() : PIPE_ALL;
    }
    els.pipelineFilter.value = state.pipeline;
  }

  function persistPipeline() {
    try {
      localStorage.setItem(PIPE_STORAGE_KEY, state.pipeline || "");
    } catch (_) {
      /* ignore */
    }
  }

  function loadPersistedPipeline() {
    try {
      const saved = localStorage.getItem(PIPE_STORAGE_KEY);
      if (saved != null) state.pipeline = saved;
    } catch (_) {
      /* ignore */
    }
  }

  function renderSummary() {
    const s = state.summary || {};
    els.statOpen.textContent = s.open_count != null ? Number(s.open_count).toLocaleString() : "—";
    els.statOpenAmount.textContent = fmtMoney(s.open_amount);
    els.statWon.textContent = s.won_count != null ? Number(s.won_count).toLocaleString() : "—";
    els.statSync.textContent = fmtSync(s.last_sync);
  }

  function renderDetail(detail) {
    const d = detail || selectedDeal();
    if (!d) {
      els.cardTitle.textContent = "Select a deal";
      els.cardMeta.textContent = "";
      els.detailBody.classList.add("empty");
      els.detailEmptyMsg.hidden = false;
      els.detailContent.hidden = true;
      els.lineItemsTbody.innerHTML = "";
      els.lineItemsStatus.textContent = "";
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
      ["Pipeline", d.pipeline_label || d.pipeline],
      ["Stage", d.deal_stage_label || d.deal_stage],
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

    const lines = Array.isArray(d.line_items) ? d.line_items : null;
    if (lines == null) {
      els.lineItemsTbody.innerHTML = "";
      els.lineItemsStatus.textContent = "Loading line items…";
      return;
    }
    if (!lines.length) {
      els.lineItemsTbody.innerHTML = "";
      els.lineItemsStatus.textContent = "No line items on this deal.";
      return;
    }
    els.lineItemsTbody.innerHTML = lines
      .map((li) => {
        const qty = li.quantity == null || li.quantity === "" ? "—" : Number(li.quantity).toLocaleString();
        return `<tr>
          <td>${esc(li.product_type || "—")}</td>
          <td>${esc(li.line_name || "—")}</td>
          <td>${esc(qty)}</td>
          <td>${esc(fmtMoney(li.amount))}</td>
        </tr>`;
      })
      .join("");
    els.lineItemsStatus.textContent = `${lines.length} line item${lines.length === 1 ? "" : "s"}`;
  }

  async function selectDeal(id) {
    state.selectedId = id;
    document.querySelectorAll(".dgs-deal-card.is-selected, #deals-tbody tr.is-selected").forEach((el) => {
      el.classList.remove("is-selected");
    });
    if (id != null) {
      document.querySelectorAll(`[data-deal-id="${CSS.escape(String(id))}"]`).forEach((el) => {
        el.classList.add("is-selected");
      });
    }
    const base = selectedDeal();
    renderDetail(base ? { ...base, line_items: null } : null);
    if (id == null) return;
    try {
      const detail = await fetchJson(`/api/commerce/deals/${encodeURIComponent(String(id))}`);
      if (String(state.selectedId) !== String(id)) return;
      renderDetail(detail);
    } catch (err) {
      if (String(state.selectedId) !== String(id)) return;
      els.lineItemsStatus.textContent = err.message || String(err);
    }
  }

  function renderBoard() {
    const byStage = new Map();
    for (const st of state.stages) {
      const key = String(st.deal_stage || "(no stage)");
      byStage.set(key, {
        label: st.deal_stage_label || st.deal_stage || "(no stage)",
        deals: [],
      });
    }
    for (const d of state.items) {
      const key = String(d.deal_stage || "").trim() || "(no stage)";
      if (!byStage.has(key)) {
        byStage.set(key, {
          label: d.deal_stage_label || d.deal_stage || "(no stage)",
          deals: [],
        });
      }
      byStage.get(key).deals.push(d);
    }

    const cols = [...byStage.entries()];
    if (!cols.length) {
      els.boardView.innerHTML = `<p class="dgs-v2-empty">No deals match this filter.</p>`;
      return;
    }

    els.boardView.innerHTML = cols
      .map(([stageId, col]) => {
        const cards = col.deals
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
          <div class="dgs-deal-column" data-stage-id="${esc(stageId)}">
            <div class="dgs-deal-column-head">
              <span class="dgs-deal-column-title" title="${esc(col.label)}">${esc(col.label)}</span>
              <span class="dgs-deal-column-count">${col.deals.length}</span>
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
        const stage = d.deal_stage_label || d.deal_stage || "—";
        return `
          <tr class="${selected.trim()}" data-deal-id="${esc(d.hubspot_deal_id)}" tabindex="0">
            <td>${esc(d.deal_name || d.deal_key || "—")}</td>
            <td>${esc(d.casino_name || d.casino_id || "—")}</td>
            <td title="${esc(stage)}">${esc(stage)}</td>
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
    document.body.classList.toggle("dgs-deals-view-board", board);
    document.body.classList.toggle("dgs-deals-view-catalog", !board);
    els.boardView.hidden = !board;
    els.catalogView.hidden = board;
    els.viewToggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === state.view);
    });
    renderPipelineOptions();
    if (board) renderBoard();
    else renderCatalog();
    renderDetail();
  }

  async function loadSummary() {
    state.summary = await fetchJson("/api/commerce/deals/summary");
    renderSummary();
  }

  async function loadMeta() {
    const data = await fetchJson("/api/commerce/deals/meta");
    state.pipelines = data.pipelines || [];
    renderPipelineOptions();
  }

  async function loadDeals() {
    state.loading = true;
    els.listStatus.textContent = "Loading…";
    showError("");
    ensurePipelineForView();
    try {
      const params = new URLSearchParams({
        status: state.status,
        page: "1",
        page_size: "500",
      });
      if (state.pipeline) params.set("pipeline", state.pipeline);
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
      const next = btn.getAttribute("data-view");
      if (next === state.view) return;
      state.view = next;
      ensurePipelineForView();
      persistPipeline();
      renderPipelineOptions();
      loadDeals();
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
    els.pipelineFilter.addEventListener("change", () => {
      state.pipeline = els.pipelineFilter.value || PIPE_ALL;
      if (state.view === "board" && !state.pipeline) {
        state.pipeline = defaultPipelineId();
        els.pipelineFilter.value = state.pipeline;
      }
      persistPipeline();
      loadDeals();
    });
  }

  async function init() {
    loadPersistedPipeline();
    bind();
    applyView();
    try {
      await Promise.all([loadSummary(), loadMeta()]);
      await loadDeals();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  window.DealsV2 = { init };
})();
