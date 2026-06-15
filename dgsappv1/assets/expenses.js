(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");

  const state = {
    cardholders: [],
    items: [],
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1,
    totalAmount: 0,
    search: "",
    cardholder: "",
    dateFrom: "",
    dateTo: "",
    selectedKey: null,
    detail: null,
    detailOpen: false,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    searchInput: document.getElementById("search-input"),
    cardholderSelect: document.getElementById("cardholder-select"),
    dateFrom: document.getElementById("date-from"),
    dateTo: document.getElementById("date-to"),
    applyBtn: document.getElementById("btn-apply"),
    prevBtn: document.getElementById("btn-prev"),
    nextBtn: document.getElementById("btn-next"),
    tbody: document.getElementById("expenses-tbody"),
    tfoot: document.getElementById("expenses-tfoot"),
    listStatus: document.getElementById("list-status"),
    backdrop: document.getElementById("detail-backdrop"),
    drawer: document.getElementById("detail-drawer"),
    detailTitle: document.getElementById("detail-title"),
    detailSubtitle: document.getElementById("detail-subtitle"),
    detailFields: document.getElementById("detail-fields"),
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
    return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  function monthBounds() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const iso = (d) => d.toISOString().slice(0, 10);
    return { from: iso(from), to: iso(to) };
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function readFiltersFromUi() {
    state.search = (els.searchInput && els.searchInput.value.trim()) || "";
    state.cardholder = (els.cardholderSelect && els.cardholderSelect.value) || "";
    state.dateFrom = (els.dateFrom && els.dateFrom.value) || "";
    state.dateTo = (els.dateTo && els.dateTo.value) || "";
  }

  function buildListPath() {
    const q = new URLSearchParams();
    if (state.search) q.set("q", state.search);
    if (state.cardholder) q.set("cardholder", state.cardholder);
    if (state.dateFrom) q.set("date_from", state.dateFrom);
    if (state.dateTo) q.set("date_to", state.dateTo);
    q.set("page", String(state.page));
    q.set("page_size", String(state.pageSize));
    return `/api/expenses?${q.toString()}`;
  }

  function renderCardholders() {
    if (!els.cardholderSelect) return;
    const current = state.cardholder;
    els.cardholderSelect.innerHTML =
      '<option value="">All cardholders</option>' +
      state.cardholders
        .map(
          (c) =>
            `<option value="${esc(c.employee_id)}"${c.employee_id === current ? " selected" : ""}>${esc(c.label)}</option>`
        )
        .join("");
  }

  function receiptCell(row) {
    if (!row.has_receipt) return '<span class="muted">—</span>';
    return '<span class="expense-receipt">Y</span>';
  }

  function amexCell(row) {
    if (row.amex_matched) {
      return '<span class="expense-badge expense-badge--ok">Matched</span>';
    }
    return '<span class="expense-badge expense-badge--warn">Unmatched</span>';
  }

  function renderList() {
    els.tbody.innerHTML = state.items
      .map((row) => {
        const selected = row.reference_key === state.selectedKey ? " selected" : "";
        return `
        <tr data-key="${esc(row.reference_key)}" class="${selected}">
          <td class="mono">${esc(row.reference_key)}</td>
          <td>${esc(fmtDate(row.date))}</td>
          <td class="num">${esc(fmtMoney(row.amount))}</td>
          <td>${esc(row.employee_name || "—")}</td>
          <td>${esc(row.state_abbr || "—")}</td>
          <td>${esc(row.tribe_name || "—")}</td>
          <td>${esc(row.casino_name || "—")}</td>
          <td>${esc(row.expense_account_display || row.expense_account || "—")}</td>
          <td>${esc(row.description || "—")}</td>
          <td>${receiptCell(row)}</td>
          <td>${amexCell(row)}</td>
        </tr>`;
      })
      .join("");

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });

    els.tfoot.innerHTML = `
      <tr class="expenses-total-row">
        <td colspan="2"></td>
        <td class="num"><strong>${esc(fmtMoney(state.totalAmount))}</strong></td>
        <td colspan="8" class="muted">Filtered total · ${state.total.toLocaleString()} row${state.total === 1 ? "" : "s"}</td>
      </tr>`;

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.total);
    const filterBits = [];
    if (state.cardholder) {
      const holder = state.cardholders.find((c) => c.employee_id === state.cardholder);
      filterBits.push(holder ? holder.label : state.cardholder);
    }
    if (state.dateFrom || state.dateTo) {
      filterBits.push(`${state.dateFrom || "…"} → ${state.dateTo || "…"}`);
    }
    if (state.search) filterBits.push(`“${state.search}”`);
    const filterNote = filterBits.length ? ` · ${filterBits.join(" · ")}` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No expenses found${filterNote}.`
        : `Showing ${start}–${end} of ${state.total.toLocaleString()} · newest first${filterNote}`;

    if (els.prevBtn) els.prevBtn.disabled = state.page <= 1;
    if (els.nextBtn) els.nextBtn.disabled = state.page >= state.totalPages;
  }

  function fieldRow(label, value, empty) {
    return `
      <label>${esc(label)}</label>
      <div class="value${empty ? " empty" : ""}">${empty ? "(blank)" : esc(value)}</div>`;
  }

  function renderDetailFields(detail) {
    if (!detail) {
      els.detailFields.innerHTML = '<p class="subtitle">Could not load this expense.</p>';
      return;
    }
    els.detailTitle.textContent = detail.reference_key || "Expense";
    els.detailSubtitle.textContent = `${fmtDate(detail.date)} · ${fmtMoney(detail.amount)}`;
    els.detailFields.innerHTML = [
      fieldRow("Reference", detail.reference_key, !detail.reference_key),
      fieldRow("Date", fmtDate(detail.date), !detail.date),
      fieldRow("Amount", fmtMoney(detail.amount), detail.amount == null),
      fieldRow("Employee", detail.employee_name, !detail.employee_name),
      fieldRow("State", detail.state_abbr || detail.state_name, !(detail.state_abbr || detail.state_name)),
      fieldRow("Tribe", detail.tribe_name, !detail.tribe_name),
      fieldRow("Casino", detail.casino_name, !detail.casino_name),
      fieldRow("GL account", detail.expense_account_display || detail.expense_account, !(detail.expense_account_display || detail.expense_account)),
      fieldRow("Description", detail.description, !detail.description),
      fieldRow("Comments", detail.comments, !detail.comments),
      fieldRow("Receipt", detail.has_receipt ? "Yes" : "No", !detail.has_receipt),
      fieldRow("Override receipt", detail.override_receipt ? "Yes" : "No", !detail.override_receipt),
      fieldRow("Amex", detail.amex_matched ? detail.amex_id : "Unmatched", !detail.amex_matched),
      fieldRow(
        "Updated",
        detail.update_date ? `${fmtDate(detail.update_date)}${detail.update_by ? ` · ${detail.update_by}` : ""}` : null,
        !detail.update_date
      ),
    ].join("");
  }

  function setDetailOpen(open) {
    state.detailOpen = open;
    document.body.classList.toggle("detail-open", open);
    els.backdrop.hidden = !open;
    els.drawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      state.selectedKey = null;
      state.detail = null;
      renderList();
      els.detailFields.innerHTML = "";
      els.detailTitle.textContent = "—";
      els.detailSubtitle.textContent = "";
    }
  }

  async function openDetail(referenceKey) {
    state.selectedKey = referenceKey;
    renderList();
    setDetailOpen(true);
    els.detailFields.innerHTML = '<p class="subtitle">Loading…</p>';

    try {
      state.detail = await fetchJson(`/api/expenses/${encodeURIComponent(referenceKey)}`);
      renderDetailFields(state.detail);
    } catch (err) {
      state.detail = null;
      els.detailFields.innerHTML = `<p class="subtitle error">${esc(err.message || String(err))}</p>`;
    }
  }

  async function loadCardholders() {
    const data = await fetchJson("/api/expenses/cardholders");
    state.cardholders = data.items || [];
    renderCardholders();
  }

  async function loadList() {
    const data = await fetchJson(buildListPath());
    state.items = data.items || [];
    state.total = data.total || 0;
    state.totalPages = data.total_pages || 1;
    state.totalAmount = data.total_amount || 0;
    renderList();
  }

  function applyFilters(resetPage) {
    readFiltersFromUi();
    if (resetPage) state.page = 1;
    return loadList();
  }

  async function init() {
    showError(null);
    const bounds = monthBounds();
    state.dateFrom = bounds.from;
    state.dateTo = bounds.to;
    if (els.dateFrom) els.dateFrom.value = bounds.from;
    if (els.dateTo) els.dateTo.value = bounds.to;
    els.tbody.innerHTML = '<tr><td colspan="11" class="subtitle">Loading…</td></tr>';

    try {
      await loadCardholders();
      await loadList();
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    }
  }

  els.applyBtn.addEventListener("click", () => {
    applyFilters(true).catch((err) => showError(err.message || String(err)));
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFilters(true).catch((err) => showError(err.message || String(err)));
    }
  });

  els.cardholderSelect.addEventListener("change", () => {
    applyFilters(true).catch((err) => showError(err.message || String(err)));
  });

  els.dateFrom.addEventListener("change", () => {
    applyFilters(true).catch((err) => showError(err.message || String(err)));
  });

  els.dateTo.addEventListener("change", () => {
    applyFilters(true).catch((err) => showError(err.message || String(err)));
  });

  els.prevBtn.addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.nextBtn.addEventListener("click", () => {
    if (state.page >= state.totalPages) return;
    state.page += 1;
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.btnCloseDetail.addEventListener("click", () => setDetailOpen(false));

  window.ExpensesApp = { init };
})();
