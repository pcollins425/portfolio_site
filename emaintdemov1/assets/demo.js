(function () {
  const AUTH_TOKEN_KEY = "emaint_demo_token";
  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
  const TABLE_ID = params.get("t") || "projects";
  const NAV_ORDER = [
    "projects",
    "work_orders",
    "compinfo",
    "inventory",
    "purchase_orders",
  ];

  const state = {
    config: null,
    table: null,
    offset: 0,
    limit: 50,
    q: "",
    rows: [],
    selectedKey: null,
    currentRecord: null,
    detailOpen: false,
    scanOpen: false,
    authRequired: false,
    user: null,
    allowedTableIds: null,
  };

  let loadSeq = 0;
  let scanSeq = 0;
  let qrScanner = null;
  let qrLibPromise = null;
  let prepStatusConfig = null;
  let scanAsset = null;

  function el(id) {
    return document.getElementById(id);
  }

  function getAuthToken() {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  }

  function setAuthToken(token) {
    if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    else sessionStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function captureAuthTokenFromUrl() {
    const token = params.get("auth_token");
    if (!token) return;
    setAuthToken(token);
    params.delete("auth_token");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState({}, "", next);
  }

  function loginPageUrl() {
    let path = window.location.pathname;
    if (path.endsWith("/table") && !path.endsWith(".html")) {
      path = path.replace(/\/table$/, "/table.html");
    }
    const returnTo = `${window.location.origin}${path}?${params.toString()}`;
    return `login.html?api=${encodeURIComponent(API_BASE)}&return_to=${encodeURIComponent(returnTo)}`;
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function canWriteTable(tableId) {
    if (!state.authRequired || !state.user) return true;
    const level = (state.user.permissions || {})[`emaint_demo_${tableId}`];
    return level === "UPDATES_ONLY" || level === "ADDS_AND_UPDATES" || level === "ALL_CHANGES";
  }

  function renderAccount() {
    const box = el("sidebar-account");
    const label = el("user-label");
    if (!box || !label) return;
    if (!state.authRequired || !state.user) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    label.textContent = state.user.name || state.user.email || "Signed in";
  }

  function signOut() {
    setAuthToken(null);
    window.location.replace(loginPageUrl());
  }

  async function ensureAuth() {
    captureAuthTokenFromUrl();
    let cfg = { required: false };
    try {
      const res = await fetch(`${API_BASE}/api/auth/config`);
      if (res.ok) cfg = await res.json();
    } catch (_err) {
      /* offline / old API — allow browse until server is updated */
    }
    state.authRequired = cfg.required === true;
    if (!state.authRequired) return true;

    const token = getAuthToken();
    if (!token) {
      window.location.replace(loginPageUrl());
      return false;
    }
    try {
      const me = await api("/api/auth/me");
      state.user = me.user;
      state.allowedTableIds = new Set(me.user.tables || []);
      renderAccount();
      return true;
    } catch (_err) {
      setAuthToken(null);
      window.location.replace(loginPageUrl());
      return false;
    }
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

  function hasSplitDetail() {
    const ch = state.table && state.table.detail_children;
    if (!ch) return false;
    if (TABLE_ID === "purchase_orders" && ch.lines) return true;
    if (TABLE_ID === "work_orders" && ch.materials) return true;
    return false;
  }

  function primaryChildId() {
    if (TABLE_ID === "purchase_orders") return "lines";
    if (TABLE_ID === "work_orders") return "materials";
    return null;
  }

  function detailLinesTitle() {
    if (TABLE_ID === "work_orders") return "Parts / materials";
    return "Line items";
  }

  function canWriteInventory() {
    return canWriteTable("inventory");
  }

  function applyDetailLayout() {
    const split = hasSplitDetail();
    document.body.classList.toggle("detail-split", split);
    const section = el("detail-lines-section");
    if (section) {
      section.hidden = !split;
      section.classList.toggle("is-visible", split);
    }
    const title = el("detail-lines-title");
    if (title) title.textContent = detailLinesTitle();
    const woActions = el("wo-materials-actions");
    if (woActions) {
      woActions.hidden = !(split && TABLE_ID === "work_orders");
    }
  }

  function rowKey(row) {
    const cols = [state.table.key_column];
    const alt = state.table.alternate_key_column;
    if (alt) cols.push(alt);
    for (const col of cols) {
      const v = row[col];
      if (v !== null && v !== undefined && v !== "") return String(v);
    }
    return null;
  }

  async function api(path, options) {
    const opts = options || {};
    opts.headers = authHeaders(opts.headers);
    const res = await fetch(`${API_BASE}${path}`, opts);
    if (res.status === 401 && state.authRequired) {
      setAuthToken(null);
      window.location.replace(loginPageUrl());
      throw new Error("Sign in required");
    }
    if (!res.ok) {
      const body = await res.text();
      let detail = body || res.statusText;
      try {
        const parsed = JSON.parse(body);
        if (parsed.detail) detail = parsed.detail;
      } catch (_err) {}
      throw new Error(detail);
    }
    return res.json();
  }

  async function apiPost(path, body) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function apiPatch(path, body) {
    return api(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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
    return NAV_ORDER.map((id) => byId.get(id))
      .filter(Boolean)
      .filter((t) => !state.allowedTableIds || state.allowedTableIds.has(t.id));
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
    applyDetailLayout();
    const drawer = el("detail-drawer");
    const backdrop = el("detail-backdrop");
    if (drawer) drawer.setAttribute("aria-hidden", "false");
    if (backdrop) backdrop.hidden = false;
  }

  function closeDetail() {
    state.detailOpen = false;
    state.selectedKey = null;
    loadSeq += 1;
    document.body.classList.remove("detail-open", "detail-split");
    const drawer = el("detail-drawer");
    const backdrop = el("detail-backdrop");
    if (drawer) drawer.setAttribute("aria-hidden", "true");
    if (backdrop) backdrop.hidden = true;
    const section = el("detail-lines-section");
    if (section) {
      section.hidden = true;
      section.classList.remove("is-visible");
    }
    clearWoMaterialsForm();
    renderGrid();
    const wrap = el("form-fields");
    if (wrap) wrap.innerHTML = "";
    clearLinesGrid();
    const head = el("form-head");
    if (head) head.textContent = "Record";
  }

  function clearLinesGrid() {
    const thead = el("lines-grid-head");
    const tbody = el("lines-grid-body");
    const status = el("lines-status");
    if (thead) thead.innerHTML = "";
    if (tbody) tbody.innerHTML = "";
    if (status) status.textContent = "";
  }

  function clearWoMaterialsForm() {
    const item = el("wo-mat-item");
    const qty = el("wo-mat-qty");
    const hint = el("wo-mat-assignable");
    const st = el("wo-mat-actions-status");
    if (item) item.value = "";
    if (qty) qty.value = "";
    if (hint) hint.textContent = "";
    if (st) st.textContent = "";
  }

  function setWoMaterialsStatus(msg, isError) {
    const node = el("wo-mat-actions-status");
    if (!node) return;
    node.textContent = msg || "";
    node.className = isError ? "editor-status error" : "editor-status ok";
    if (!msg) node.className = "editor-status";
  }

  async function refreshWoAssignableHint() {
    const hint = el("wo-mat-assignable");
    const itemInput = el("wo-mat-item");
    if (!hint || !itemInput) return;
    const item = itemInput.value.trim();
    if (!item) {
      hint.textContent = "";
      return;
    }
    hint.textContent = "Checking assignable qty…";
    try {
      const data = await api(`/api/emaint-demo/inventory/items/${encodeURIComponent(item)}/assignable`);
      hint.textContent = `Assignable: ${data.qty_assignable} (warehouse available; refurb: ${data.qty_refurb}; eMaint on hand: ${data.onhand})`;
    } catch (err) {
      hint.textContent = String(err.message || err);
    }
  }

  async function addWoMaterialLine() {
    if (!state.selectedKey) return;
    const item = (el("wo-mat-item") && el("wo-mat-item").value.trim()) || "";
    const qtyRaw = el("wo-mat-qty") && el("wo-mat-qty").value;
    const qty = parseFloat(qtyRaw);
    if (!item || !qty || qty <= 0) {
      setWoMaterialsStatus("Enter item number and a positive quantity.", true);
      return;
    }
    setWoMaterialsStatus("Adding line…", false);
    try {
      await apiPost(`/api/emaint-demo/work-orders/${encodeURIComponent(state.selectedKey)}/materials`, {
        item,
        qty_requested: qty,
      });
      setWoMaterialsStatus("Line saved.", false);
      clearWoMaterialsForm();
      await loadDetailLines(state.selectedKey, loadSeq);
    } catch (err) {
      setWoMaterialsStatus(String(err.message || err), true);
    }
  }

  async function allocateWoMaterial(item) {
    if (!state.selectedKey || !item) return;
    setWoMaterialsStatus(`Allocating ${item}…`, false);
    try {
      await apiPost(
        `/api/emaint-demo/work-orders/${encodeURIComponent(state.selectedKey)}/materials/allocate`,
        { item }
      );
      setWoMaterialsStatus(`Allocated ${item}.`, false);
      await loadDetailLines(state.selectedKey, loadSeq);
    } catch (err) {
      setWoMaterialsStatus(String(err.message || err), true);
    }
  }

  function renderLinesGrid(data) {
    const thead = el("lines-grid-head");
    const tbody = el("lines-grid-body");
    const status = el("lines-status");
    if (!thead || !tbody || !data) return;

    const cols = data.browse_columns || [];
    const showAllocate = TABLE_ID === "work_orders" && canWriteInventory();
    thead.innerHTML = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}${
      showAllocate ? "<th></th>" : ""
    }</tr>`;
    tbody.innerHTML = "";
    const rows = data.rows || [];
    for (const row of rows) {
      const tr = document.createElement("tr");
      let cells = cols
        .map((c) => {
          const text = fmtCell(row[c]);
          return `<td title="${escapeHtml(text)}">${escapeHtml(text)}</td>`;
        })
        .join("");
      if (showAllocate) {
        const requested = parseFloat(row.qty_requested) || 0;
        const allocated = parseFloat(row.qty_allocated) || 0;
        const remaining = requested - allocated;
        if (remaining > 0 && row.item) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn-accent";
          btn.textContent = `Allocate ${remaining}`;
          btn.addEventListener("click", () => allocateWoMaterial(String(row.item)));
          const td = document.createElement("td");
          td.appendChild(btn);
          tr.innerHTML = cells;
          tr.appendChild(td);
        } else {
          cells += "<td></td>";
          tr.innerHTML = cells;
        }
      } else {
        tr.innerHTML = cells;
      }
      tbody.appendChild(tr);
    }
    if (status) {
      const emptyMsg =
        TABLE_ID === "work_orders"
          ? "No parts on this work order yet."
          : "No lines on this purchase order.";
      status.textContent = rows.length ? `${rows.length} line(s)` : emptyMsg;
      status.className = "lines-status";
    }
  }

  async function loadDetailLines(key, seq) {
    const childId = primaryChildId();
    if (!childId) return;
    const status = el("lines-status");
    if (status) status.textContent = "Loading lines…";
    try {
      const data = await api(
        `/api/emaint-demo/${TABLE_ID}/rows/${encodeURIComponent(key)}/children/${encodeURIComponent(childId)}`
      );
      if (seq !== loadSeq) return;
      renderLinesGrid(data);
    } catch (err) {
      if (seq !== loadSeq) return;
      clearLinesGrid();
      if (status) status.textContent = String(err.message || err);
      if (status) status.className = "lines-status error";
    }
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

  function prettyJson(raw) {
    if (raw === null || raw === undefined || raw === "") return "{\n  \"notes\": \"\"\n}";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch (_err) {
      return String(raw);
    }
  }

  function renderForm(record) {
    const wrap = el("form-fields");
    const head = el("form-head");
    if (!wrap) return;

    state.currentRecord = record || null;

    if (!record) {
      if (head) head.textContent = "Record unavailable";
      wrap.innerHTML = '<p class="detail-loading">Could not load this record.</p>';
      return;
    }

    if (head) {
      head.textContent =
        record.fields["PO No."] ||
        record.fields["Project #"] ||
        record.fields["WO No"] ||
        record.fields["Reference Key"] ||
        record.fields["Asset ID"] ||
        record.fields["Item No"] ||
        String(record.key);
    }

    const editable = new Set(
      canWriteTable(TABLE_ID) ? record.editable_columns || [] : []
    );
    const skipLabels = new Set(["— attributes (summary) —", "— attributes (JSON) —"]);
    const parts = [];
    for (const [label, value] of Object.entries(record.fields)) {
      if (skipLabels.has(label) || label.startsWith("  ")) continue;
      const f = fmtField(value);
      parts.push(
        `<label>${escapeHtml(label)}</label><div class="value${f.empty ? " empty" : ""}">${escapeHtml(f.text)}</div>`
      );
    }

    const attrLines = [];
    for (const [label, value] of Object.entries(record.fields)) {
      if (!label.startsWith("  ")) continue;
      const f = fmtField(value);
      attrLines.push(
        `<div class="attr-line"><span class="attr-key">${escapeHtml(label.trim())}</span><span class="attr-val${f.empty ? " empty" : ""}">${escapeHtml(f.text)}</span></div>`
      );
    }

    let editor = "";
    if (editable.has("attributes")) {
      const rawAttr = record.raw && record.raw.attributes;
      editor = `
        <section class="attributes-editor">
          <h3 class="editor-title">Custom attributes (JSON)</h3>
          <p class="editor-hint">Spine fields sync from eMaint; <strong>attributes</strong> are curated here — family-specific options (software stack, cable ends, cabinet fit, …).</p>
          <textarea id="attributes-json" class="attributes-json" spellcheck="false">${escapeHtml(prettyJson(rawAttr))}</textarea>
          <div class="editor-actions">
            <button type="button" id="btn-save-attributes" class="btn-accent">Save attributes</button>
            <span id="attributes-save-status" class="editor-status"></span>
          </div>
        </section>`;
    }

    let prepSection = "";
    if (TABLE_ID === "compinfo") {
      prepSection = `
        <section class="prep-status-section">
          <h3 class="editor-title">Prep status</h3>
          <p class="editor-hint">Warehouse prep stage — updates eMaint <strong>status</strong>; <strong>property</strong> stays at the warehouse.</p>
          <div id="detail-prep-actions" class="scan-prep-actions"></div>
          <span id="detail-prep-status" class="editor-status"></span>
        </section>`;
    }

    wrap.innerHTML = `
      <div class="form-grid">${parts.join("")}</div>
      ${attrLines.length ? `<section class="attributes-summary"><h3 class="editor-title">Attributes (read-only summary)</h3>${attrLines.join("")}</section>` : ""}
      ${prepSection}
      ${editor}`;

    const saveBtn = el("btn-save-attributes");
    if (saveBtn) {
      saveBtn.addEventListener("click", saveAttributes);
    }

    if (TABLE_ID === "compinfo") {
      renderDetailPrepActions(record);
    }
  }

  async function saveAttributes() {
    const record = state.currentRecord;
    const ta = el("attributes-json");
    const statusNode = el("attributes-save-status");
    if (!record || !ta) return;

    let parsed;
    try {
      parsed = JSON.parse(ta.value);
    } catch (err) {
      if (statusNode) {
        statusNode.textContent = `Invalid JSON: ${err.message}`;
        statusNode.className = "editor-status error";
      }
      return;
    }

    const key = record.key;
    if (statusNode) {
      statusNode.textContent = "Saving…";
      statusNode.className = "editor-status";
    }
    try {
      const updated = await apiPatch(
        `/api/emaint-demo/${TABLE_ID}/rows/${encodeURIComponent(key)}`,
        { updates: { attributes: JSON.stringify(parsed) } }
      );
      state.currentRecord = updated;
      renderForm(updated);
      if (statusNode) {
        statusNode.textContent = "Saved.";
        statusNode.className = "editor-status ok";
      }
      setStatus("Attributes updated (not sent to eMaint).");
    } catch (err) {
      if (statusNode) {
        statusNode.textContent = String(err.message || err);
        statusNode.className = "editor-status error";
      }
    }
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

    const seq = ++loadSeq;
    state.selectedKey = key;
    openDetail();
    renderGrid();
    setDetailLoading();
    if (hasSplitDetail()) {
      clearLinesGrid();
      const status = el("lines-status");
      if (status) {
        status.textContent = "Loading lines…";
        status.className = "lines-status";
      }
    }
    try {
      const record = await api(
        `/api/emaint-demo/${TABLE_ID}/rows/${encodeURIComponent(key)}`
      );
      if (seq !== loadSeq) return;
      renderForm(record);
      if (hasSplitDetail()) {
        await loadDetailLines(key, seq);
      }
      if (seq !== loadSeq) return;
      setStatus("");
    } catch (err) {
      if (seq !== loadSeq) return;
      renderForm(null);
      clearLinesGrid();
      setStatus(String(err.message || err), true);
    }
  }

  function setScanStatus(msg, isError) {
    const node = el("scan-status");
    if (!node) return;
    node.textContent = msg;
    node.className = isError ? "scan-status error" : "scan-status";
  }

  function loadQrLibrary() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (qrLibPromise) return qrLibPromise;
    qrLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Camera library failed to load."));
      document.head.appendChild(script);
    });
    return qrLibPromise;
  }

  async function stopScanCamera() {
    if (!qrScanner) return;
    try {
      await qrScanner.stop();
    } catch (_err) {}
    try {
      qrScanner.clear();
    } catch (_err) {}
    qrScanner = null;
  }

  async function startScanCamera() {
    const restartBtn = el("btn-scan-restart");
    if (restartBtn) restartBtn.hidden = true;
    setScanStatus("Requesting camera permission…");

    try {
      await loadQrLibrary();
    } catch (err) {
      setScanStatus(String(err.message || err), true);
      if (restartBtn) restartBtn.hidden = false;
      return;
    }

    await stopScanCamera();
    qrScanner = new Html5Qrcode("scan-reader");
    try {
      await qrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 },
        (decoded) => {
          handleScanResult(decoded, "camera");
        },
        () => {}
      );
      setScanStatus("Camera live — point at a barcode or QR code.");
    } catch (err) {
      setScanStatus(String(err.message || err), true);
      if (restartBtn) restartBtn.hidden = false;
    }
  }

  function clearScanResult() {
    scanAsset = null;
    const result = el("scan-result");
    const card = el("scan-asset-card");
    const actions = el("scan-prep-actions");
    if (result) result.hidden = true;
    if (card) card.innerHTML = "";
    if (actions) actions.innerHTML = "";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function assetFromRecord(record) {
    if (!record || !record.raw) return null;
    const raw = record.raw;
    return {
      compid: raw.compid,
      serial_no: raw.serial_no,
      asset_id: raw.asset_id,
      property: raw.property,
      status: raw.status,
      comp_desc: raw.comp_desc,
    };
  }

  function loadPrepStatusConfig() {
    if (prepStatusConfig) return Promise.resolve(prepStatusConfig);
    return api("/api/emaint-demo/compinfo/prep-statuses")
      .then((cfg) => {
        prepStatusConfig = cfg;
        return cfg;
      })
      .catch(() => null);
  }

  function setDetailPrepStatus(msg, isError) {
    const node = el("detail-prep-status");
    if (!node) return;
    node.textContent = msg || "";
    node.className = isError ? "editor-status error" : "editor-status ok";
    if (!msg) node.className = "editor-status";
  }

  function fillPrepActionButtons(container, asset, onChoose) {
    if (!container) return;
    container.innerHTML = "";
    if (!prepStatusConfig) {
      const note = document.createElement("p");
      note.className = "editor-hint";
      note.textContent = "Loading prep status options…";
      container.appendChild(note);
      loadPrepStatusConfig().then(() => fillPrepActionButtons(container, asset, onChoose));
      return;
    }

    const canWrite = canWriteTable("compinfo");
    const current = (asset && asset.status ? String(asset.status) : "").trim();

    if (!canWrite) {
      const note = document.createElement("p");
      note.className = "editor-hint";
      note.textContent = "You have read-only access to Assets — prep moves are not available.";
      container.appendChild(note);
      return;
    }

    for (const item of prepStatusConfig.values || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.button_label || item.status;
      btn.className = "btn-accent";
      const isCurrent = current && current.toLowerCase() === String(item.status).toLowerCase();
      if (isCurrent) {
        btn.classList.add("is-current");
        btn.disabled = true;
        btn.textContent = `${btn.textContent} (current)`;
      } else {
        btn.addEventListener("click", () => {
          onChoose(item.status, item.button_label || item.status);
        });
      }
      container.appendChild(btn);
    }
  }

  function renderDetailPrepActions(record) {
    const container = el("detail-prep-actions");
    const asset = assetFromRecord(record);
    if (!container || !asset || !asset.compid) return;
    setDetailPrepStatus("");
    fillPrepActionButtons(container, asset, (status, label) => {
      applyPrepStatus(String(asset.compid), status, label, {
        setFeedback: setDetailPrepStatus,
      });
    });
  }

  function renderScanAssetCard(asset) {
    const card = el("scan-asset-card");
    const result = el("scan-result");
    if (!card || !result || !asset) return;

    const title = asset.comp_desc || asset.compid || "Asset";
    const statusText = asset.status ? String(asset.status) : "(no status)";
    card.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <p>Asset ID: ${escapeHtml(fmtCell(asset.compid))}</p>
      <p>Serial: ${escapeHtml(fmtCell(asset.serial_no))}</p>
      <p>Reference key: ${escapeHtml(fmtCell(asset.asset_id))}</p>
      <p>Property: ${escapeHtml(fmtCell(asset.property))}</p>
      <p class="scan-current-status"><strong>Status:</strong> ${escapeHtml(statusText)}</p>
    `;
    result.hidden = false;
  }

  function renderScanPrepActions(asset) {
    const actions = el("scan-prep-actions");
    if (!actions || !asset) return;
    fillPrepActionButtons(actions, asset, (status, label) => {
      applyPrepStatus(String(asset.compid), status, label, {
        scanContext: true,
        setFeedback: setScanStatus,
      });
    });
  }

  async function applyPrepStatus(compid, status, label, options) {
    options = options || {};
    const setFeedback = options.setFeedback || setDetailPrepStatus;
    const scanContext = options.scanContext === true;
    if (!compid) return;

    setFeedback(`Setting status to ${label}…`, false);
    const seq = scanContext ? scanSeq : null;
    try {
      const out = await apiPost("/api/emaint-demo/compinfo/prep-status", {
        compid: String(compid),
        status,
      });
      if (scanContext && seq !== scanSeq) return;

      const asset = out.asset || { compid, status };
      if (scanAsset && String(scanAsset.compid) === String(compid)) {
        scanAsset = asset;
        renderScanAssetCard(scanAsset);
        renderScanPrepActions(scanAsset);
      }

      const msg = `Status set to ${status} (eMaint + landing updated).`;
      setFeedback(msg, false);
      setStatus(msg);

      if (asset.serial_no || asset.compid) {
        el("search").value = asset.serial_no || asset.compid || "";
        state.q = el("search").value.trim();
      }
      await loadRows(true);
      await selectRow(String(compid));
    } catch (err) {
      if (scanContext && seq !== scanSeq) return;
      setFeedback(String(err.message || err), true);
    }
  }

  async function resolveScannedAsset(token, source) {
    const seq = ++scanSeq;
    setScanStatus(`Looking up ${token}…`);
    clearScanResult();
    try {
      const data = await api(`/api/emaint-demo/compinfo/resolve?token=${encodeURIComponent(token)}`);
      if (seq !== scanSeq) return;
      scanAsset = data.asset;
      if (!scanAsset || !scanAsset.compid) {
        throw new Error("Asset found but missing compid.");
      }
      if (!prepStatusConfig && data.prep_statuses) {
        prepStatusConfig = data.prep_statuses;
      }
      renderScanAssetCard(scanAsset);
      renderScanPrepActions(scanAsset);
      setScanStatus(
        `Found ${scanAsset.comp_desc || scanAsset.compid}${source ? ` (${source})` : ""} — choose a prep status.`
      );
    } catch (err) {
      if (seq !== scanSeq) return;
      setScanStatus(String(err.message || err), true);
    }
  }

  async function openScanModal() {
    const modal = el("scan-modal");
    if (!modal) return;
    state.scanOpen = true;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    clearScanResult();
    setScanStatus("Starting camera…");
    const wedge = el("scan-wedge");
    if (wedge) {
      wedge.value = "";
      wedge.focus();
    }
    await startScanCamera();
  }

  async function closeScanModal() {
    state.scanOpen = false;
    scanSeq += 1;
    await stopScanCamera();
    clearScanResult();
    const modal = el("scan-modal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    const wedge = el("scan-wedge");
    if (wedge) wedge.value = "";
    setScanStatus("Open scan to start camera.");
    const restartBtn = el("btn-scan-restart");
    if (restartBtn) restartBtn.hidden = true;
  }

  async function handleScanResult(serial, source) {
    const token = String(serial || "").trim();
    if (!token) return;
    await resolveScannedAsset(token, source);
  }

  function initScan() {
    const scanBtn = el("btn-scan");
    if (!scanBtn) return;
    scanBtn.hidden = false;

    loadPrepStatusConfig();

    scanBtn.addEventListener("click", () => {
      openScanModal();
    });
    el("btn-close-scan").addEventListener("click", () => {
      closeScanModal();
    });
    el("scan-modal").addEventListener("click", (e) => {
      if (e.target.id === "scan-modal") closeScanModal();
    });
    el("btn-scan-restart").addEventListener("click", () => {
      startScanCamera();
    });

    const wedge = el("scan-wedge");
    wedge.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      handleScanResult(wedge.value, "USB / keyboard");
      wedge.value = "";
      wedge.focus();
    });
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
    if (!(await ensureAuth())) return;

    state.config = await api("/api/emaint-demo/config");
    state.table = state.config.tables.find((t) => t.id === TABLE_ID);
    if (!state.table) {
      const first = sortedTables()[0];
      if (first && first.id !== TABLE_ID) {
        window.location.replace(tableHref(first.id));
        return;
      }
      setStatus(`No access to table "${TABLE_ID}" or it does not exist.`, true);
      return;
    }

    document.title = `${state.table.title} — DGS Operations`;

    renderNav();
    applyDetailLayout();

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
      if (e.key !== "Escape") return;
      if (state.scanOpen) {
        closeScanModal();
        return;
      }
      if (state.detailOpen) closeDetail();
    });

    if (TABLE_ID === "compinfo") {
      initScan();
      loadPrepStatusConfig();
    }

    const woMatItem = el("wo-mat-item");
    if (woMatItem) {
      woMatItem.addEventListener("blur", refreshWoAssignableHint);
      woMatItem.addEventListener("keydown", (e) => {
        if (e.key === "Enter") refreshWoAssignableHint();
      });
    }
    const btnWoMatAdd = el("btn-wo-mat-add");
    if (btnWoMatAdd) btnWoMatAdd.addEventListener("click", addWoMaterialLine);

    const signOutBtn = el("btn-sign-out");
    if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    await loadRows(true);
  }

  async function initLoginPage() {
    const err = params.get("error");
    const errNode = el("login-error");
    if (err && errNode) {
      errNode.textContent = err;
      errNode.hidden = false;
    }
    const btn = el("btn-google-signin");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const returnTo =
        params.get("return_to") ||
        `${window.location.origin}/emaintdemov1/table.html?t=projects&api=${encodeURIComponent(API_BASE)}`;
      window.location.href = `${API_BASE}/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`;
    });
  }

  window.EmaintDemo = {
    initTablePage,
    initLoginPage,
    API_BASE,
    TABLE_ID,
  };
})();
