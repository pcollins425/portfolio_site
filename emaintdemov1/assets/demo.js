(function () {
  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
  const TABLE_ID = params.get("t") || "projects";
  const NAV_ORDER = ["projects", "work_orders", "compinfo"];

  const state = {
    config: null,
    table: null,
    offset: 0,
    limit: 50,
    q: "",
    rows: [],
    selectedKey: null,
    detailOpen: false,
  };

  let loadSeq = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function fmtCell(v) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  }

  function fmtField(v) {
    if (v === null || v === undefined || v === "") return { text: "(blank)", empty: true };
    if (typeof v === "boolean") return { text: v ? "Yes" : "No", empty: false };
    return { text: String(v), empty: false };
  }

  function rowKey(row) {
    const cols = [state.table.key_column];
    const alt =
      state.table.alternate_key_column ||
      (state.table.id === "work_orders" ? "wo" : null);
    if (alt) cols.push(alt);
    for (const col of cols) {
      const v = row[col];
      if (v !== null && v !== undefined && v !== "") return String(v);
    }
    return null;
  }

  async function api(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || res.statusText);
    }
    return res.json();
  }

  function setStatus(msg, isError) {
    const node = el("status");
    if (!node) return;
    node.textContent = msg;
    node.className = isError ? "status error" : "status";
  }

  function tableHref(tableId) {
    return `table.html?t=${encodeURIComponent(tableId)}&api=${encodeURIComponent(API_BASE)}`;
  }

  function sortedTables() {
    if (!state.config) return [];
    const byId = new Map(state.config.tables.map((t) => [t.id, t]));
    return NAV_ORDER.map((id) => byId.get(id)).filter(Boolean);
  }

  function renderNav() {
    const nav = el("nav");
    if (!nav || !state.config) return;
    nav.innerHTML = "";
    for (const t of sortedTables()) {
      const a = document.createElement("a");
      a.href = tableHref(t.id);
      a.textContent = t.title;
      if (t.id === TABLE_ID) a.classList.add("active");
      nav.appendChild(a);
    }
  }

  function openDetail() {
    state.detailOpen = true;
    document.body.classList.add("detail-open");
    const drawer = el("detail-drawer");
    const backdrop = el("detail-backdrop");
    if (drawer) drawer.setAttribute("aria-hidden", "false");
    if (backdrop) backdrop.hidden = false;
  }

  function closeDetail() {
    state.detailOpen = false;
    state.selectedKey = null;
    loadSeq += 1;
    document.body.classList.remove("detail-open");
    const drawer = el("detail-drawer");
    const backdrop = el("detail-backdrop");
    if (drawer) drawer.setAttribute("aria-hidden", "true");
    if (backdrop) backdrop.hidden = true;
    renderGrid();
    const wrap = el("form-fields");
    if (wrap) wrap.innerHTML = "";
    const head = el("form-head");
    if (head) head.textContent = "Record";
  }

  function setDetailLoading() {
    const wrap = el("form-fields");
    const head = el("form-head");
    if (head) head.textContent = "Loading…";
    if (wrap) wrap.innerHTML = '<p class="detail-loading">Loading record…</p>';
  }

  function renderGrid() {
    const thead = el("grid-head");
    const tbody = el("grid-body");
    if (!thead || !tbody || !state.table) return;

    const cols = state.table.browse_columns;
    thead.innerHTML = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;

    tbody.innerHTML = "";
    for (const row of state.rows) {
      const tr = document.createElement("tr");
      const key = rowKey(row);
      if (state.detailOpen && key !== null && key === state.selectedKey) {
        tr.classList.add("selected");
      }
      tr.addEventListener("click", () => selectRow(key));
      tr.innerHTML = cols
        .map((c) => {
          const text = fmtCell(row[c]);
          return `<td title="${escapeHtml(text)}">${escapeHtml(text)}</td>`;
        })
        .join("");
      tbody.appendChild(tr);
    }
  }

  function renderForm(record) {
    const wrap = el("form-fields");
    const head = el("form-head");
    if (!wrap) return;

    if (!record) {
      if (head) head.textContent = "Record unavailable";
      wrap.innerHTML = '<p class="detail-loading">Could not load this record.</p>';
      return;
    }

    if (head) {
      head.textContent = record.fields["Project #"] ||
        record.fields["WO No"] ||
        record.fields["Asset ID"] ||
        String(record.key);
    }

    const parts = [];
    for (const [label, value] of Object.entries(record.fields)) {
      const f = fmtField(value);
      parts.push(
        `<label>${escapeHtml(label)}</label><div class="value${f.empty ? " empty" : ""}">${escapeHtml(f.text)}</div>`
      );
    }
    wrap.innerHTML = `<div class="form-grid">${parts.join("")}</div>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function selectRow(key) {
    if (key === null) {
      setStatus("This row has no key value; cannot open the record.", true);
      return;
    }

    state.selectedKey = key;
    openDetail();
    renderGrid();
    setDetailLoading();

    const seq = ++loadSeq;
    try {
      const record = await api(
        `/api/emaint-demo/${TABLE_ID}/rows/${encodeURIComponent(key)}`
      );
      if (seq !== loadSeq) return;
      renderForm(record);
      setStatus("");
    } catch (err) {
      if (seq !== loadSeq) return;
      renderForm(null);
      setStatus(String(err.message || err), true);
    }
  }

  async function loadRows(resetOffset) {
    if (resetOffset) state.offset = 0;
    setStatus("Loading rows…");
    try {
      const qParam = state.q ? `&q=${encodeURIComponent(state.q)}` : "";
      const data = await api(
        `/api/emaint-demo/${TABLE_ID}/rows?limit=${state.limit}&offset=${state.offset}${qParam}`
      );
      state.rows = data.rows || [];
      renderGrid();
      setStatus(`${state.rows.length} row(s) shown · offset ${state.offset}`);
      el("btn-prev").disabled = state.offset <= 0;
      el("btn-next").disabled = state.rows.length < state.limit;
    } catch (err) {
      state.rows = [];
      renderGrid();
      setStatus(String(err.message || err), true);
    }
  }

  async function initTablePage() {
    state.config = await api("/api/emaint-demo/config");
    state.table = state.config.tables.find((t) => t.id === TABLE_ID);
    if (!state.table) {
      setStatus(`Unknown table id: ${TABLE_ID}`, true);
      return;
    }

    document.title = `${state.table.title} — DGS Operations`;

    renderNav();

    const title = el("table-title");
    if (title) title.textContent = state.table.title;

    const sub = el("table-subtitle");
    if (sub) {
      sub.textContent = `${state.table.emaint_table} → ${state.table.sql_object}`;
    }

    el("search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        state.q = el("search").value.trim();
        loadRows(true);
      }
    });
    el("btn-search").addEventListener("click", () => {
      state.q = el("search").value.trim();
      loadRows(true);
    });
    el("btn-prev").addEventListener("click", () => {
      state.offset = Math.max(0, state.offset - state.limit);
      loadRows(false);
    });
    el("btn-next").addEventListener("click", () => {
      state.offset += state.limit;
      loadRows(false);
    });

    el("btn-close-detail").addEventListener("click", closeDetail);
    el("detail-backdrop").addEventListener("click", closeDetail);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.detailOpen) closeDetail();
    });

    await loadRows(true);
  }

  window.EmaintDemo = {
    initTablePage,
    API_BASE,
    TABLE_ID,
  };
})();
