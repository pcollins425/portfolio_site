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
    importUpdates: [],
  };

  const EXPORT_COLUMNS = [
    { key: "reference_key", header: "reference_key" },
    { key: "date", header: "date" },
    { key: "amount", header: "amount" },
    { key: "employee_name", header: "employee_name" },
    { key: "state_abbr", header: "state_abbr" },
    { key: "tribe_name", header: "tribe_name" },
    { key: "casino_name", header: "casino_name" },
    { key: "expense_account", header: "expense_account" },
    { key: "description", header: "description" },
  ];

  const REF_HEADERS = ["reference_key", "ref", "expense_id", "expense ref"];
  const GL_HEADERS = ["expense_account", "gl", "gl account", "gl_account"];
  const DESC_HEADERS = ["description", "desc"];

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
    btnDownload: document.getElementById("btn-download"),
    btnImportEdit: document.getElementById("btn-import-edit"),
    importModal: document.getElementById("import-edit-modal"),
    importDropzone: document.getElementById("import-edit-dropzone"),
    importFileInput: document.getElementById("import-edit-file"),
    btnImportBrowse: document.getElementById("btn-import-browse"),
    btnCloseImport: document.getElementById("btn-close-import-edit"),
    btnImportCancel: document.getElementById("btn-import-cancel"),
    btnImportApply: document.getElementById("btn-import-apply"),
    importFileName: document.getElementById("import-edit-file-name"),
    importPreviewWrap: document.getElementById("import-edit-preview-wrap"),
    importPreviewTbody: document.getElementById("import-edit-preview-tbody"),
    importSummary: document.getElementById("import-edit-summary"),
    importError: document.getElementById("import-edit-error"),
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

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\s+/g, " ");
  }

  function findHeaderIndex(headers, aliases) {
    const normalized = headers.map((h) => normalizeHeader(h));
    for (let i = 0; i < normalized.length; i += 1) {
      if (aliases.includes(normalized[i])) return i;
    }
    return -1;
  }

  function csvEscape(value) {
    const s = value === null || value === undefined ? "" : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function exportRowValues(item) {
    const gl = item.expense_account_display || item.expense_account || "";
    return {
      reference_key: item.reference_key || "",
      date: item.date || "",
      amount: item.amount ?? "",
      employee_name: item.employee_name || "",
      state_abbr: item.state_abbr || "",
      tribe_name: item.tribe_name || "",
      casino_name: item.casino_name || "",
      expense_account: gl,
      description: item.description || "",
    };
  }

  function downloadExport() {
    if (!state.rows.length) return;

    const headerLine = EXPORT_COLUMNS.map((c) => csvEscape(c.header)).join(",");
    const lines = [headerLine];
    for (const item of state.rows) {
      const values = exportRowValues(item);
      lines.push(EXPORT_COLUMNS.map((c) => csvEscape(values[c.key])).join(","));
    }

    const from = state.dateFrom || "start";
    const to = state.dateTo || "end";
    const filename = `expenses_mass_edit_${from}_${to}.csv`;
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          field += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(field);
        field = "";
        if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }

    row.push(field);
    if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
    return rows;
  }

  function sheetRowsFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const name = (file.name || "").toLowerCase();

      reader.onerror = () => reject(new Error("Could not read file"));

      if (name.endsWith(".csv") || file.type === "text/csv") {
        reader.onload = () => {
          const text = String(reader.result || "").replace(/^\uFEFF/, "");
          resolve(parseCsvRows(text));
        };
        reader.readAsText(file);
        return;
      }

      if (typeof XLSX === "undefined") {
        reject(new Error("Excel support did not load — try CSV or refresh the page."));
        return;
      }

      reader.onload = () => {
        try {
          const data = new Uint8Array(reader.result);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function cellValue(row, index) {
    if (index < 0 || index >= row.length) return "";
    const v = row[index];
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  function changeLabel(before, after) {
    const from = before || "—";
    const to = after || "—";
    if (from === to) return "—";
    return `${from} → ${to}`;
  }

  function findBaseline(ref) {
    const trimmed = String(ref || "").trim();
    if (!trimmed) return null;
    if (state.baseline.has(trimmed)) {
      return { key: trimmed, base: state.baseline.get(trimmed) };
    }
    const upper = trimmed.toUpperCase();
    for (const [key, base] of state.baseline.entries()) {
      if (key.toUpperCase() === upper) return { key, base };
    }
    return null;
  }

  function editableCellValue(row, index) {
    if (index < 0) return null;
    const value = cellValue(row, index);
    return value === "" ? null : value;
  }

  function buildImportPreview(rows) {
    if (!rows.length) {
      throw new Error("File is empty.");
    }
    if (!state.baseline.size) {
      throw new Error("Load expenses first so Import Edit can match your selection.");
    }

    const headers = rows[0].map((h) => String(h ?? ""));
    const refIdx = findHeaderIndex(headers, REF_HEADERS);
    const glIdx = findHeaderIndex(headers, GL_HEADERS);
    const descIdx = findHeaderIndex(headers, DESC_HEADERS);

    if (refIdx < 0) {
      throw new Error('Missing reference column — use "reference_key" or "expense_id".');
    }
    if (glIdx < 0 && descIdx < 0) {
      throw new Error('No editable columns found — include "expense_account" and/or "description".');
    }

    const preview = [];
    const updates = [];
    let updateCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;

    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      if (!row || !row.length) continue;

      const refRaw = cellValue(row, refIdx);
      if (!refRaw) continue;

      const matched = findBaseline(refRaw);
      const newGl = editableCellValue(row, glIdx);
      const newDesc = editableCellValue(row, descIdx);

      let status = "unchanged";
      let statusClass = "status-unchanged";
      let glChange = "—";
      let descChange = "—";
      const ref = matched ? matched.key : refRaw;

      if (!matched) {
        status = "Not in selection";
        statusClass = "status-error";
        errorCount += 1;
      } else {
        const { base } = matched;
        const glFrom = base.expense_account;
        const descFrom = base.description;
        const glTo = newGl === null ? glFrom : newGl;
        const descTo = newDesc === null ? descFrom : newDesc;
        glChange = changeLabel(glFrom, glTo);
        descChange = changeLabel(descFrom, descTo);

        const glChanged = newGl !== null && glTo !== glFrom;
        const descChanged = newDesc !== null && descTo !== descFrom;

        if (!glChanged && !descChanged) {
          status = "No change";
          unchangedCount += 1;
        } else if (newGl !== null && !isValidGl(glTo)) {
          status = "Invalid GL";
          statusClass = "status-error";
          errorCount += 1;
        } else {
          status = "Update";
          statusClass = "status-update";
          updateCount += 1;
          const payload = { reference_key: ref };
          if (glChanged) payload.expense_account = glTo;
          if (descChanged) payload.description = descTo;
          updates.push(payload);
        }
      }

      preview.push({ ref, status, statusClass, glChange, descChange });
    }

    if (!preview.length) {
      throw new Error("No data rows found below the header row.");
    }

    return { preview, updates, updateCount, unchangedCount, errorCount, total: preview.length };
  }

  function setImportError(msg) {
    els.importError.hidden = !msg;
    els.importError.textContent = msg || "";
  }

  function renderImportPreview(result) {
    state.importUpdates = result.updates;
    els.importPreviewWrap.hidden = false;
    els.importSummary.innerHTML =
      `${result.total.toLocaleString()} row${result.total === 1 ? "" : "s"} in file · ` +
      `<strong>${result.updateCount.toLocaleString()} update${result.updateCount === 1 ? "" : "s"}</strong> · ` +
      `${result.unchangedCount.toLocaleString()} unchanged · ` +
      `${result.errorCount.toLocaleString()} skipped`;

    const show = result.preview.slice(0, 200);
    els.importPreviewTbody.innerHTML = show
      .map(
        (row) => `<tr>
          <td class="mono">${escHtml(row.ref)}</td>
          <td class="${row.statusClass}">${escHtml(row.status)}</td>
          <td>${escHtml(row.glChange)}</td>
          <td>${escHtml(row.descChange)}</td>
        </tr>`
      )
      .join("");

    if (result.preview.length > show.length) {
      els.importPreviewTbody.innerHTML += `<tr><td colspan="4" class="muted">…and ${(result.preview.length - show.length).toLocaleString()} more rows</td></tr>`;
    }

    const n = result.updateCount;
    els.btnImportApply.disabled = n === 0 || state.loading;
    els.btnImportApply.textContent = n ? `Apply ${n} update${n === 1 ? "" : "s"}` : "Apply updates";
    setImportError(null);
  }

  function resetImportModal() {
    state.importUpdates = [];
    els.importFileInput.value = "";
    els.importFileName.hidden = true;
    els.importFileName.textContent = "";
    els.importPreviewWrap.hidden = true;
    els.importPreviewTbody.innerHTML = "";
    els.importSummary.textContent = "";
    els.btnImportApply.disabled = true;
    els.btnImportApply.textContent = "Apply updates";
    setImportError(null);
    els.importDropzone.classList.remove("is-dragover");
  }

  function openImportModal() {
    resetImportModal();
    els.importModal.hidden = false;
    els.importModal.setAttribute("aria-hidden", "false");
  }

  function closeImportModal() {
    els.importModal.hidden = true;
    els.importModal.setAttribute("aria-hidden", "true");
    resetImportModal();
  }

  async function handleImportFile(file) {
    if (!file) return;
    resetImportModal();
    els.importFileName.hidden = false;
    els.importFileName.textContent = file.name;

    try {
      const rows = await sheetRowsFromFile(file);
      const result = buildImportPreview(rows);
      renderImportPreview(result);
    } catch (err) {
      setImportError(err.message || String(err));
      els.importPreviewWrap.hidden = true;
      els.btnImportApply.disabled = true;
    }
  }

  async function applyImportUpdates() {
    const updates = state.importUpdates || [];
    if (!updates.length) return;

    if (state.dirty.size && !window.confirm("Discard unsaved grid changes before applying import?")) {
      return;
    }
    state.dirty.clear();
    state.pending.clear();
    state.invalid.clear();

    state.loading = true;
    els.btnImportApply.disabled = true;
    showError(null);
    setImportError(null);

    try {
      const result = await fetchJson("/api/expenses/batch", {
        method: "POST",
        body: JSON.stringify({ updates }),
      });
      if (result.errors && result.errors.length) {
        setImportError(
          `Applied ${result.updated}, but ${result.errors.length} row(s) failed: ${result.errors
            .map((e) => `${e.reference_key}: ${e.error}`)
            .slice(0, 3)
            .join("; ")}`
        );
      } else {
        closeImportModal();
      }
      await loadRows();
    } catch (err) {
      setImportError(err.message || String(err));
    } finally {
      state.loading = false;
      const n = state.importUpdates.length;
      els.btnImportApply.disabled = n === 0;
      refreshActionState();
    }
  }

  function refreshDownloadState() {
    if (els.btnDownload) {
      els.btnDownload.disabled = !state.rows.length || state.loading;
    }
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

  function refreshGlInvalidCell(ref) {
    if (!state.table || !ref) return;
    const row = state.table.getRows().find((r) => r.getData().reference_key === ref);
    if (!row) return;
    const cell = row.getCell("expense_account");
    if (cell) {
      cell.getElement().classList.toggle("mass-edit-gl-invalid", state.invalid.has(ref));
    }
  }

  function refreshAllGlInvalidCells() {
    if (!state.table) return;
    for (const row of state.table.getRows()) {
      refreshGlInvalidCell(row.getData().reference_key);
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

    refreshGlInvalidCell(ref);
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
    refreshAllGlInvalidCells();
  }

  function preventPageScrollOnGridFocus() {
    let pageScrollY = 0;
    els.grid.addEventListener(
      "mousedown",
      () => {
        pageScrollY = window.scrollY;
      },
      true
    );
    els.grid.addEventListener(
      "focusin",
      () => {
        const y = pageScrollY;
        requestAnimationFrame(() => {
          if (window.scrollY !== y) {
            window.scrollTo({ top: y, left: 0, behavior: "instant" });
          }
        });
      },
      true
    );
  }

  function refreshActionState() {
    const n = state.dirty.size;
    els.btnDiscard.disabled = n === 0 || state.loading;
    els.btnSave.disabled = n === 0 || state.invalid.size > 0 || state.loading;
    els.btnSave.textContent = n ? `Save ${n} change${n === 1 ? "" : "s"}` : "Save changes";
    refreshDownloadState();
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
      elementAttributes: {
        autocomplete: "off",
      },
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
        editor: "input",
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
      selectableRangeAutoFocus: false,
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
    preventPageScrollOnGridFocus();

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
  els.btnDownload.addEventListener("click", () => downloadExport());
  els.btnImportEdit.addEventListener("click", () => openImportModal());
  els.btnCloseImport.addEventListener("click", () => closeImportModal());
  els.btnImportCancel.addEventListener("click", () => closeImportModal());
  els.btnImportApply.addEventListener("click", () => applyImportUpdates());
  els.btnImportBrowse.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.importFileInput.click();
  });
  els.importDropzone.addEventListener("click", () => els.importFileInput.click());
  els.importFileInput.addEventListener("change", () => {
    const file = els.importFileInput.files && els.importFileInput.files[0];
    handleImportFile(file);
  });
  els.importDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.importDropzone.classList.add("is-dragover");
  });
  els.importDropzone.addEventListener("dragleave", () => {
    els.importDropzone.classList.remove("is-dragover");
  });
  els.importDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.importDropzone.classList.remove("is-dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleImportFile(file);
  });
  els.importModal.addEventListener("click", (e) => {
    if (e.target === els.importModal) closeImportModal();
  });

  window.ExpensesMassEdit = { init };
})();
