(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");

  const state = {
    cardholders: [],
    glSource: [],
    glLabels: new Set(),
    glCodes: new Set(),
    baseline: new Map(),
    table: null,
    rows: [],
    filteredIndices: [],
    dirty: new Set(),
    pending: new Map(),
    invalid: new Map(),
    totalAmount: 0,
    cardholder: "",
    dateFrom: "",
    dateTo: "",
    search: "",
    loading: false,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    searchInput: document.getElementById("search-input"),
    cardholderSelect: document.getElementById("cardholder-select"),
    dateFrom: document.getElementById("date-from"),
    dateTo: document.getElementById("date-to"),
    applyBtn: document.getElementById("btn-apply"),
    grid: document.getElementById("mass-edit-grid"),
    statusSelection: document.getElementById("status-selection"),
    statusSum: document.getElementById("status-sum"),
    statusChanges: document.getElementById("status-changes"),
    statusErrors: document.getElementById("status-errors"),
    btnDiscard: document.getElementById("btn-discard"),
    btnSave: document.getElementById("btn-save"),
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchJson(path, options) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      window.DGSAuth ? DGSAuth.authHeaders() : {}
    );
    const res = await fetch(apiUrl(path), Object.assign({ headers }, options || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.detail || body.message || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return body;
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

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return null;
    return Number(n);
  }

  function normalizeGl(value) {
    return String(value || "").trim().toUpperCase();
  }

  function isValidGl(value) {
    const v = String(value || "").trim();
    if (!v) return true;
    const upper = normalizeGl(v);
    if (state.glLabels.has(upper)) return true;
    for (const code of state.glCodes) {
      if (upper.startsWith(code + " ") || upper.startsWith(code + " -") || upper === code) return true;
    }
    return false;
  }

  function itemToData(item) {
    const ref = item.reference_key;
    const pending = state.pending.get(ref);
    const data = {
      reference_key: ref,
      date: fmtDate(item.date),
      amount: fmtMoney(item.amount),
      employee_name: item.employee_name || "",
      state_abbr: item.state_abbr || "",
      tribe_name: item.tribe_name || "",
      casino_name: item.casino_name || "",
      expense_account: item.expense_account_display || item.expense_account || "",
      description: item.description || "",
      has_receipt: item.has_receipt ? "Y" : "",
      amex_matched: item.amex_matched ? "Matched" : "",
    };
    if (pending) {
      data.expense_account = pending.expense_account;
      data.description = pending.description;
    }
    return data;
  }

  function rowMatchesSearch(item, q) {
    if (!q) return true;
    const hay = [
      item.reference_key,
      item.description,
      item.expense_account,
      item.expense_account_display,
      item.employee_name,
      String(item.amount),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function rebuildGlValid(source) {
    state.glLabels = new Set();
    state.glCodes = new Set();
    for (const label of source || []) {
      state.glLabels.add(normalizeGl(label));
      const m = String(label).match(/^(\d{4})/);
      if (m) state.glCodes.add(m[1]);
    }
  }

  function snapshotBaseline(items) {
    state.baseline.clear();
    for (const item of items) {
      state.baseline.set(item.reference_key, {
        expense_account: item.expense_account_display || item.expense_account || "",
        description: item.description || "",
      });
    }
  }

  function markDirtyFromData(ref, data) {
    if (!ref) return;
    const base = state.baseline.get(ref);
    if (!base || !data) return;

    const gl = data.expense_account ?? "";
    const desc = data.description ?? "";
    const changed = gl !== base.expense_account || desc !== base.description;
    if (changed) {
      state.dirty.add(ref);
      state.pending.set(ref, { expense_account: gl, description: desc });
    } else {
      state.dirty.delete(ref);
      state.pending.delete(ref);
    }

    if (!isValidGl(gl)) state.invalid.set(ref, "Invalid GL");
    else state.invalid.delete(ref);

    refreshActionState();
    refreshStatusBar();
  }

  function markDirtyFromRow(row) {
    const data = row.getData();
    markDirtyFromData(data.reference_key, data);
  }

  function rescanDirtyFromTable() {
    if (!state.table) return;
    for (const row of state.table.getRows()) {
      markDirtyFromRow(row);
    }
    state.table.redraw(true);
  }

  function refreshActionState() {
    const n = state.dirty.size;
    els.btnDiscard.disabled = n === 0 || state.loading;
    els.btnSave.disabled = n === 0 || state.invalid.size > 0 || state.loading;
    els.btnSave.textContent = n ? `Save ${n} change${n === 1 ? "" : "s"}` : "Save changes";
  }

  function refreshStatusBar(extra) {
    const loaded = state.filteredIndices.length;
    els.statusSelection.textContent =
      extra || `${loaded.toLocaleString()} row${loaded === 1 ? "" : "s"} loaded · newest first`;
    els.statusSum.textContent = state.totalAmount
      ? `SUM(Amount): ${Number(state.totalAmount).toLocaleString(undefined, { style: "currency", currency: "USD" })}`
      : "";
    const n = state.dirty.size;
    els.statusChanges.textContent = n ? `${n} unsaved change${n === 1 ? "" : "s"}` : "";
    els.statusErrors.textContent = state.invalid.size
      ? `${state.invalid.size} GL validation error${state.invalid.size === 1 ? "" : "s"}`
      : "";
  }

  function filteredData() {
    return state.filteredIndices.map((idx) => itemToData(state.rows[idx]));
  }

  function applyFilter() {
    const q = state.search.trim().toLowerCase();
    state.filteredIndices = state.rows
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => rowMatchesSearch(item, q))
      .map(({ idx }) => idx);

    if (state.table) {
      state.table.setData(filteredData());
    }
    refreshStatusBar();
  }

  function glEditorParams() {
    return {
      values: state.glSource,
      autocomplete: true,
      listOnEmpty: true,
      freetext: true,
      clearable: false,
    };
  }

  function buildColumns() {
    return [
      { title: "Ref", field: "reference_key", width: 110, frozen: true, editor: false },
      { title: "Date", field: "date", width: 95, editor: false },
      {
        title: "Amount",
        field: "amount",
        width: 100,
        hozAlign: "right",
        editor: false,
        formatter: "money",
        formatterParams: { decimal: ".", thousand: ",", symbol: "$", precision: 2 },
      },
      { title: "Employee", field: "employee_name", width: 140, editor: false },
      { title: "St", field: "state_abbr", width: 48, hozAlign: "center", editor: false },
      { title: "Tribe", field: "tribe_name", width: 120, editor: false },
      { title: "Casino", field: "casino_name", width: 120, editor: false },
      {
        title: "GL Account",
        field: "expense_account",
        width: 220,
        cssClass: "mass-edit-gl-col",
        editor: "list",
        editorParams: glEditorParams(),
        formatter(cell) {
          const el = cell.getElement();
          const ref = cell.getRow().getData().reference_key;
          el.classList.toggle("mass-edit-gl-invalid", state.invalid.has(ref));
          return cell.getValue() ?? "";
        },
      },
      { title: "Description", field: "description", width: 220, editor: "input" },
      { title: "Rcpt", field: "has_receipt", width: 52, hozAlign: "center", editor: false },
      { title: "Amex", field: "amex_matched", width: 72, hozAlign: "center", editor: false },
    ];
  }

  function updateSelectionStatus() {
    if (!state.table) return;
    const ranges = state.table.getRanges();
    if (!ranges.length) {
      refreshStatusBar();
      return;
    }

    const rows = ranges[0].getRows();
    if (rows.length <= 1) {
      refreshStatusBar();
      return;
    }

    let sum = 0;
    for (const row of rows) {
      const amt = row.getData().amount;
      if (typeof amt === "number" && !Number.isNaN(amt)) sum += amt;
    }
    els.statusSelection.textContent = `${rows.length} rows selected`;
    els.statusSum.textContent = `SUM(Amount): ${sum.toLocaleString(undefined, { style: "currency", currency: "USD" })}`;
  }

  function initGrid() {
    if (typeof Tabulator === "undefined") {
      showError("Tabulator failed to load — check network connection or try again in a minute.");
      return;
    }

    if (state.table) {
      state.table.destroy();
      state.table = null;
    }

    state.table = new Tabulator(els.grid, {
      height: "100%",
      data: filteredData(),
      layout: "fitColumns",
      renderVertical: "virtual",
      placeholder: "Load expenses to begin editing",
      editTriggerEvent: "dblclick",
      selectableRange: 1,
      selectableRangeColumns: true,
      selectableRangeRows: true,
      selectableRangeClearCells: false,
      clipboard: true,
      clipboardCopyStyled: false,
      clipboardCopyConfig: {
        rowHeaders: false,
        columnHeaders: false,
      },
      clipboardCopyRowRange: "range",
      clipboardPasteParser: "range",
      clipboardPasteAction: "range",
      rowHeader: {
        resizable: false,
        frozen: true,
        width: 44,
        hozAlign: "center",
        formatter: "rownum",
        field: "rownum",
        headerSort: false,
        editor: false,
      },
      columnDefaults: {
        headerSort: false,
        resizable: "header",
        headerHozAlign: "center",
      },
      columns: buildColumns(),
    });

    state.table.on("cellEdited", (cell) => {
      markDirtyFromRow(cell.getRow());
      cell.getTable().redraw(true);
    });

    state.table.on("clipboardPasted", () => {
      rescanDirtyFromTable();
    });

    state.table.on("rangeAdded", updateSelectionStatus);
    state.table.on("rangeChanged", updateSelectionStatus);
    state.table.on("rangeRemoved", updateSelectionStatus);
  }

  async function loadCardholders() {
    const data = await fetchJson("/api/expenses/cardholders");
    state.cardholders = data.items || [];
    const current = state.cardholder;
    els.cardholderSelect.innerHTML =
      '<option value="">All cardholders</option>' +
      state.cardholders
        .map(
          (c) =>
            `<option value="${c.employee_id}"${c.employee_id === current ? " selected" : ""}>${c.label}</option>`
        )
        .join("");
  }

  async function loadGlAccounts() {
    const data = await fetchJson("/api/expenses/gl-accounts");
    state.glSource = data.source || [];
    rebuildGlValid(state.glSource);
  }

  async function loadRows() {
    if (state.dirty.size && !window.confirm("Discard unsaved changes and reload?")) {
      return;
    }

    state.loading = true;
    showError(null);
    refreshActionState();

    const q = new URLSearchParams();
    if (state.search) q.set("q", state.search);
    if (state.cardholder) q.set("cardholder", state.cardholder);
    if (state.dateFrom) q.set("date_from", state.dateFrom);
    if (state.dateTo) q.set("date_to", state.dateTo);
    q.set("page", "1");
    q.set("page_size", "2000");

    try {
      const data = await fetchJson(`/api/expenses?${q.toString()}`);
      if (data.total > 2000) {
        showError(`Showing first 2,000 of ${data.total.toLocaleString()} rows — narrow the date range or cardholder.`);
      }
      state.rows = data.items || [];
      state.totalAmount = data.total_amount || 0;
      state.filteredIndices = state.rows.map((_, idx) => idx);
      state.dirty.clear();
      state.pending.clear();
      state.invalid.clear();
      snapshotBaseline(state.rows);
      initGrid();
      applyFilter();
      refreshActionState();
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      state.loading = false;
      refreshActionState();
    }
  }

  function readFilters() {
    state.search = (els.searchInput && els.searchInput.value.trim()) || "";
    state.cardholder = (els.cardholderSelect && els.cardholderSelect.value) || "";
    state.dateFrom = (els.dateFrom && els.dateFrom.value) || "";
    state.dateTo = (els.dateTo && els.dateTo.value) || "";
  }

  function collectUpdates() {
    const updates = [];
    for (const ref of state.dirty) {
      const base = state.baseline.get(ref);
      const pending = state.pending.get(ref);
      if (!base || !pending) continue;
      const payload = { reference_key: ref };
      if (pending.expense_account !== base.expense_account) {
        payload.expense_account = pending.expense_account;
      }
      if (pending.description !== base.description) {
        payload.description = pending.description;
      }
      if (payload.expense_account !== undefined || payload.description !== undefined) {
        updates.push(payload);
      }
    }
    return updates;
  }

  async function saveChanges() {
    const updates = collectUpdates();
    if (!updates.length) return;

    state.loading = true;
    refreshActionState();
    showError(null);

    try {
      const result = await fetchJson("/api/expenses/batch", {
        method: "POST",
        body: JSON.stringify({ updates }),
      });
      if (result.errors && result.errors.length) {
        showError(
          `Saved ${result.updated}, but ${result.errors.length} row(s) failed: ${result.errors
            .map((e) => `${e.reference_key}: ${e.error}`)
            .slice(0, 3)
            .join("; ")}`
        );
      }
      await loadRows();
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      state.loading = false;
      refreshActionState();
    }
  }

  async function init() {
    const bounds = monthBounds();
    state.dateFrom = bounds.from;
    state.dateTo = bounds.to;
    els.dateFrom.value = bounds.from;
    els.dateTo.value = bounds.to;

    try {
      await Promise.all([loadCardholders(), loadGlAccounts()]);
      await loadRows();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  els.applyBtn.addEventListener("click", () => {
    readFilters();
    loadRows();
  });

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim();
    applyFilter();
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      readFilters();
      loadRows();
    }
  });

  els.cardholderSelect.addEventListener("change", () => {
    readFilters();
    loadRows();
  });

  els.dateFrom.addEventListener("change", () => {
    readFilters();
    loadRows();
  });

  els.dateTo.addEventListener("change", () => {
    readFilters();
    loadRows();
  });

  els.btnDiscard.addEventListener("click", () => loadRows());
  els.btnSave.addEventListener("click", () => saveChanges());

  window.ExpensesMassEdit = { init };
})();
