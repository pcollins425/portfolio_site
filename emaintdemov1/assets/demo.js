(function () {
  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
  const TABLE_ID = params.get("t") || "compinfo";

  const state = {
    config: null,
    table: null,
    offset: 0,
    limit: 50,
    q: "",
    rows: [],
    selectedKey: null,
  };

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
    const v = row[state.table.key_column];
    if (v === null || v === undefined || v === "") return null;
    return String(v);
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

  function renderNav() {
    const nav = el("nav");
    if (!nav || !state.config) return;
    nav.innerHTML = "";
    for (const t of state.config.tables) {
      const a = document.createElement("a");
      a.href = `table.html?t=${encodeURIComponent(t.id)}&api=${encodeURIComponent(API_BASE)}`;
      a.textContent = t.title;
      if (t.id === TABLE_ID) a.classList.add("active");
      nav.appendChild(a);
    }
  }

  function renderGrid() {
    const thead = el("grid-head");
    const tbody = el("grid-body");
    if (!thead || !tbody || !state.table) return;

    const cols = state.table.browse_columns;
    thead.innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;

    tbody.innerHTML = "";
    for (const row of state.rows) {
      const tr = document.createElement("tr");
      const key = rowKey(row);
      if (key !== null && key === state.selectedKey) tr.classList.add("selected");
      tr.addEventListener("click", () => selectRow(key));
      tr.innerHTML = cols.map((c) => `<td title="${fmtCell(row[c])}">${fmtCell(row[c])}</td>`).join("");
      tbody.appendChild(tr);
    }
  }

  function renderForm(record) {
    const wrap = el("form-fields");
    const head = el("form-head");
    if (!wrap) return;

    if (!record) {
      if (head) head.textContent = "Record";
      wrap.innerHTML = '<p class="status">Select a row from the browse grid.</p>';
      return;
    }

    if (head) {
      head.textContent = `Record — ${state.table.key_column}: ${record.key}`;
    }

    const parts = [];
    for (const [label, value] of Object.entries(record.fields)) {
      const f = fmtField(value);
      parts.push(
        `<label>${label}</label><div class="value${f.empty ? " empty" : ""}">${escapeHtml(f.text)}</div>`
      );
    }
    wrap.innerHTML = `<div class="form-grid">${parts.join("")}</div>`;
  }

  function escapeHtml(s) {
    return s
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
    renderGrid();
    setStatus("Loading record…");
    try {
      const record = await api(`/api/emaint-demo/${TABLE_ID}/rows/${encodeURIComponent(key)}`);
      renderForm(record);
      setStatus("");
    } catch (err) {
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
      setStatus(`${state.rows.length} row(s) shown (offset ${state.offset})`);
      el("btn-prev").disabled = state.offset <= 0;
      el("btn-next").disabled = state.rows.length < state.limit;
    } catch (err) {
      state.rows = [];
      renderGrid();
      setStatus(String(err.message || err), true);
    }
  }

  async function initTablePage() {
    document.title = `eMaint demo — ${TABLE_ID}`;
    const title = el("page-title");
    if (title) title.textContent = "DGS Operations (demo)";

    state.config = await api("/api/emaint-demo/config");
    state.table = state.config.tables.find((t) => t.id === TABLE_ID);
    if (!state.table) {
      setStatus(`Unknown table id: ${TABLE_ID}`, true);
      return;
    }

    renderNav();
    const sub = el("table-subtitle");
    if (sub) {
      sub.textContent = `${state.table.title} — ${state.table.emaint_table} → ${state.table.sql_object}`;
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

    await loadRows(true);
    renderForm(null);
  }

  async function initHubPage() {
    const apiParam = params.get("api");
    const apiSuffix = apiParam ? `&api=${encodeURIComponent(apiParam)}` : "";
    const list = document.querySelector(".hub ul");
    if (list) {
      list.innerHTML = [
        ["compinfo", "Assets", "inventory.compinfo_landing"],
        ["work_orders", "Work Orders", "projects.work_orders"],
        ["projects", "Projects", "projects.emaint_landing"],
      ]
        .map(
          ([id, title, sql]) =>
            `<li><a href="table.html?t=${id}${apiSuffix}">${title}</a> — <code>${sql}</code></li>`
        )
        .join("");
    }

    try {
      const health = await api("/api/emaint-demo/health");
      const status = el("health-status");
      if (status) {
        status.textContent = health.ok
          ? `API OK — ${JSON.stringify(health.row_counts)}`
          : `API error: ${health.error || "unknown"}`;
        status.className = health.ok ? "status" : "status error";
      }
    } catch (err) {
      const status = el("health-status");
      if (status) {
        status.textContent = String(err.message || err);
        status.className = "status error";
      }
    }
  }

  window.EmaintDemo = {
    initTablePage,
    initHubPage,
    API_BASE,
    TABLE_ID,
  };
})();
