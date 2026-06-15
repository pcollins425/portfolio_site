(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
  const COL = {
    REF: 0,
    DATE: 1,
    AMOUNT: 2,
    EMPLOYEE: 3,
    STATE: 4,
    TRIBE: 5,
    CASINO: 6,
    GL: 7,
    DESCRIPTION: 8,
    RECEIPT: 9,
    AMEX: 10,
  };
  const HEADERS = [
    "Ref",
    "Date",
    "Amount",
    "Employee",
    "St",
    "Tribe",
    "Casino",
    "GL Account",
    "Description",
    "Rcpt",
    "Amex",
  ];

  const state = {
    cardholders: [],
    glSource: [],
    glLabels: new Set(),
    glCodes: new Set(),
    baseline: new Map(),
    hot: null,
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
    if (n === null || n === undefined || Number.isNaN(n)) return "";
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

  function itemToRow(item) {
    return [
      item.reference_key,
      fmtDate(item.date),
      fmtMoney(item.amount),
      item.employee_name || "",
      item.state_abbr || "",
      item.tribe_name || "",
      item.casino_name || "",
      item.expense_account_display || item.expense_account || "",
      item.description || "",
      item.has_receipt ? "Y" : "",
      item.amex_matched ? "Matched" : "",
    ];
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

  function rowIndexToRef(visualRow) {
    const item = state.filteredIndices[visualRow];
    return item != null ? state.rows[item].reference_key : null;
  }

  function markDirty(visualRow, prop) {
    const ref = rowIndexToRef(visualRow);
    if (!ref) return;
    const base = state.baseline.get(ref);
    const row = state.hot.getDataAtRow(visualRow);
    if (!base || !row) return;

    const gl = row[COL.GL] ?? "";
    const desc = row[COL.DESCRIPTION] ?? "";
    const changed = gl !== base.expense_account || desc !== base.description;
    if (changed) {
      state.dirty.add(ref);
      state.pending.set(ref, { expense_account: gl, description: desc });
    } else {
      state.dirty.delete(ref);
      state.pending.delete(ref);
    }

    if (prop === COL.GL || prop == null) {
      if (!isValidGl(gl)) state.invalid.set(ref, "Invalid GL");
      else state.invalid.delete(ref);
    }

    refreshActionState();
    refreshStatusBar();
  }

  function refreshActionState() {
    const n = state.dirty.size;
    els.btnDiscard.disabled = n === 0 || state.loading;
    els.btnSave.disabled = n === 0 || state.invalid.size > 0 || state.loading;
    els.btnSave.textContent = n ? `Save ${n} change${n === 1 ? "" : "s"}` : "Save changes";
  }

  function refreshStatusBar(extra) {
    const loaded = state.filteredIndices.length;
    els.statusSelection.textContent = extra || `${loaded.toLocaleString()} row${loaded === 1 ? "" : "s"} loaded · newest first`;
    els.statusSum.textContent = state.totalAmount
      ? `SUM(Amount): ${Number(state.totalAmount).toLocaleString(undefined, { style: "currency", currency: "USD" })}`
      : "";
    const n = state.dirty.size;
    els.statusChanges.textContent = n ? `${n} unsaved change${n === 1 ? "" : "s"}` : "";
    els.statusErrors.textContent = state.invalid.size
      ? `${state.invalid.size} GL validation error${state.invalid.size === 1 ? "" : "s"}`
      : "";
  }

  function applyFilter() {
    const q = state.search.trim().toLowerCase();
    state.filteredIndices = state.rows
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => rowMatchesSearch(item, q))
      .map(({ idx }) => idx);

    const data = state.filteredIndices.map((idx) => itemToRow(state.rows[idx]));
    if (state.hot) {
      state.hot.loadData(data);
    }
    refreshStatusBar();
  }

  function initGrid() {
    if (state.hot) {
      state.hot.destroy();
      state.hot = null;
    }

    const data = state.filteredIndices.map((idx) => itemToRow(state.rows[idx]));
    state.hot = new Handsontable(els.grid, {
      data,
      colHeaders: HEADERS,
      rowHeaders: true,
      licenseKey: "non-commercial-and-evaluation",
      height: "100%",
      width: "100%",
      stretchH: "all",
      manualColumnResize: true,
      fillHandle: { direction: "vertical", autoInsertRow: false },
      copyPaste: true,
      undo: true,
      selectionMode: "multiple",
      outsideClickDeselects: false,
      columns: [
        { readOnly: true },
        { readOnly: true, className: "htLeft" },
        { readOnly: true, type: "numeric", numericFormat: { pattern: "$0,0.00" }, className: "htRight" },
        { readOnly: true },
        { readOnly: true },
        { readOnly: true },
        { readOnly: true },
        {
          type: "autocomplete",
          source: state.glSource,
          strict: false,
          allowInvalid: true,
          className: "htLeft mass-edit-gl-col",
        },
        { type: "text" },
        { readOnly: true, className: "htCenter" },
        { readOnly: true, className: "htCenter" },
      ],
      cells(row, col) {
        const props = {};
        if (col === COL.GL) {
          const ref = rowIndexToRef(row);
          if (ref && state.invalid.has(ref)) {
            props.className = "mass-edit-gl-invalid";
          }
        }
        return props;
      },
      afterChange(changes, source) {
        if (!changes || source === "loadData") return;
        for (const [row, prop] of changes) {
          markDirty(row, prop);
        }
        state.hot.render();
      },
      afterSelectionEnd(row, col, row2) {
        const start = Math.min(row, row2);
        const end = Math.max(row, row2);
        let sum = 0;
        let count = 0;
        for (let r = start; r <= end; r += 1) {
          const amt = state.hot.getDataAtCell(r, COL.AMOUNT);
          if (typeof amt === "number" && !Number.isNaN(amt)) {
            sum += amt;
            count += 1;
          }
        }
        if (count > 1) {
          els.statusSelection.textContent = `${count} rows selected`;
          els.statusSum.textContent = `SUM(Amount): ${sum.toLocaleString(undefined, { style: "currency", currency: "USD" })}`;
        } else {
          refreshStatusBar();
        }
      },
    });
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
