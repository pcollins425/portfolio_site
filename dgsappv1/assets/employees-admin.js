(function () {
  "use strict";

  const LEVEL_LABELS = {
    "": "Off / role default",
    NONE: "Off (subtract)",
    READ_ONLY: "Read",
    UPDATES_ONLY: "Updates",
    ADDS_ONLY: "Adds only",
    ADDS_AND_UPDATES: "Adds + updates",
    ALL_CHANGES: "All changes",
  };

  const state = {
    view: "employees",
    catalog: null,
    actor: null,
    employees: [],
    roles: [],
    selected: null,
    selectedKind: null,
    draftEffective: {},
    draftRoleMap: {},
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    deniedBox: document.getElementById("denied-box"),
    browsePanel: document.getElementById("browse-panel"),
    searchInput: document.getElementById("search-input"),
    activeFilter: document.getElementById("active-filter"),
    activeWrap: document.getElementById("active-filter-wrap"),
    refreshBtn: document.getElementById("btn-refresh"),
    thead: document.getElementById("browse-thead"),
    tbody: document.getElementById("browse-tbody"),
    listStatus: document.getElementById("list-status"),
    backdrop: document.getElementById("detail-backdrop"),
    drawer: document.getElementById("detail-drawer"),
    detailLabel: document.getElementById("detail-label"),
    detailTitle: document.getElementById("detail-title"),
    detailSubtitle: document.getElementById("detail-subtitle"),
    detailBody: document.getElementById("detail-body"),
    detailActions: document.getElementById("detail-actions"),
    resetModal: document.getElementById("reset-modal"),
    resetMessage: document.getElementById("reset-message"),
    tabEmployees: document.getElementById("tab-employees"),
    tabRoles: document.getElementById("tab-roles"),
  };

  function showError(msg) {
    if (!els.errorBox) return;
    if (!msg) {
      els.errorBox.hidden = true;
      els.errorBox.textContent = "";
      return;
    }
    els.errorBox.hidden = false;
    els.errorBox.textContent = msg;
  }

  async function api(path, opts) {
    const res = await fetch(`${DGSAuth.apiBase()}${path}`, {
      ...opts,
      headers: DGSAuth.authHeaders({
        "Content-Type": "application/json",
        ...(opts && opts.headers),
      }),
    });
    if (res.status === 401) throw new Error("Sign in required");
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_e) {
      body = { detail: text };
    }
    if (!res.ok) {
      const detail = (body && body.detail) || text || res.statusText;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return body;
  }

  function setView(view) {
    state.view = view;
    els.tabEmployees.classList.toggle("active", view === "employees");
    els.tabRoles.classList.toggle("active", view === "roles");
    els.activeWrap.hidden = view !== "employees";
    els.searchInput.placeholder =
      view === "employees" ? "Search name, email, EMP-…" : "Search role name, RT-…";
    closeDetail();
    loadList();
  }

  function isCompactDrawer() {
    return window.matchMedia("(max-width: 1366px)").matches;
  }

  function markSelectedRow(ref) {
    els.tbody.querySelectorAll("tr").forEach((tr) => {
      tr.classList.toggle("dgs-v2-row--selected", !!ref && tr.dataset.ref === ref);
    });
  }

  function closeDetail() {
    state.selected = null;
    state.selectedKind = null;
    document.body.classList.remove("detail-open", "dgs-emp-drawer-compact");
    if (els.drawer) els.drawer.setAttribute("aria-hidden", "true");
    if (els.backdrop) els.backdrop.hidden = true;
    if (els.detailActions) {
      els.detailActions.hidden = true;
      els.detailActions.innerHTML = "";
    }
    markSelectedRow(null);
  }

  function setDetailActions(html) {
    if (!els.detailActions) return;
    const content = (html || "").trim();
    els.detailActions.innerHTML = content;
    els.detailActions.hidden = !content;
  }

  function openDetail() {
    document.body.classList.add("detail-open");
    document.body.classList.toggle("dgs-emp-drawer-compact", isCompactDrawer());
    if (els.drawer) els.drawer.setAttribute("aria-hidden", "false");
    if (els.backdrop) els.backdrop.hidden = false;
  }

  async function loadCatalog() {
    const data = await api("/api/admin/permission-catalog");
    state.catalog = data;
    state.actor = data.actor || {};
    const can =
      state.actor.employees_read ||
      state.actor.roles_read;
    if (!can) {
      els.deniedBox.hidden = false;
      els.browsePanel.hidden = true;
      return false;
    }
    els.deniedBox.hidden = true;
    els.browsePanel.hidden = false;
    if (!state.actor.employees_read) {
      els.tabEmployees.disabled = true;
      if (state.view === "employees") setView("roles");
    }
    if (!state.actor.roles_read) {
      els.tabRoles.disabled = true;
    }
    return true;
  }

  async function loadList() {
    showError("");
    const q = encodeURIComponent(els.searchInput.value.trim());
    try {
      if (state.view === "employees") {
        const active = els.activeFilter.value;
        const data = await api(`/api/admin/employees?q=${q}&active=${active}`);
        state.employees = data.employees || [];
        renderEmployees();
      } else {
        const data = await api(`/api/admin/roles?q=${q}`);
        let roles = data.roles || [];
        const needle = els.searchInput.value.trim().toLowerCase();
        if (needle) {
          roles = roles.filter(
            (r) =>
              String(r.role || "").toLowerCase().includes(needle) ||
              String(r.reference_key || "").toLowerCase().includes(needle)
          );
        }
        state.roles = roles;
        renderRoles();
      }
    } catch (err) {
      showError(String(err.message || err));
    }
  }

  function renderEmployees() {
    els.thead.innerHTML =
      "<tr><th>Name</th><th class=\"dgs-v2-col--desktop\">Email</th><th>Role</th><th class=\"dgs-v2-col--desktop\">Active</th><th class=\"dgs-v2-col--desktop\">Overrides</th></tr>";
    els.tbody.innerHTML = "";
    for (const e of state.employees) {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.dataset.ref = e.reference_key || "";
      const ov = e.override_map && Object.keys(e.override_map).length
        ? Object.keys(e.override_map).length
        : "—";
      const inactive = e.active
        ? ""
        : ' <span class="dgs-emp-inactive dgs-v2-phone-only">Inactive</span>';
      tr.innerHTML = `<td>${esc(e.name || "—")}${inactive}</td><td class="dgs-v2-col--desktop">${esc(
        e.email || ""
      )}</td><td>${esc(
        e.role_name || e.role_id || "—"
      )}</td><td class="dgs-v2-col--desktop">${e.active ? "Yes" : "No"}</td><td class="dgs-v2-col--desktop">${ov}</td>`;
      tr.addEventListener("click", () => selectEmployee(e.reference_key));
      els.tbody.appendChild(tr);
    }
    els.listStatus.textContent = `${state.employees.length} employee(s)`;
    if (state.selectedKind === "employee" && state.selected) {
      markSelectedRow(state.selected.reference_key);
    }
  }

  function renderRoles() {
    els.thead.innerHTML =
      "<tr><th>Role</th><th class=\"dgs-v2-col--desktop\">Key</th><th class=\"dgs-v2-col--desktop\">Areas</th></tr>";
    els.tbody.innerHTML = "";
    for (const r of state.roles) {
      const tr = document.createElement("tr");
      tr.dataset.ref = r.reference_key || "";
      const n = r.permission_map ? Object.keys(r.permission_map).length : 0;
      tr.innerHTML = `<td>${esc(r.role || "—")}<span class="dgs-emp-role-meta dgs-v2-phone-only">${esc(
        r.reference_key || ""
      )} · ${n} area${n === 1 ? "" : "s"}</span></td><td class="dgs-v2-col--desktop">${esc(
        r.reference_key || ""
      )}</td><td class="dgs-v2-col--desktop">${n}</td>`;
      tr.addEventListener("click", () => selectRole(r.reference_key));
      els.tbody.appendChild(tr);
    }
    els.listStatus.textContent = `${state.roles.length} role(s)`;
    if (state.selectedKind === "role" && state.selected) {
      markSelectedRow(state.selected.reference_key);
    }
  }

  async function selectEmployee(ref) {
    showError("");
    try {
      const e = await api(`/api/admin/employees/${encodeURIComponent(ref)}`);
      state.selected = e;
      state.selectedKind = "employee";
      state.draftEffective = { ...(e.effective || {}) };
      markSelectedRow(e.reference_key);
      renderEmployeeDetail();
      openDetail();
    } catch (err) {
      showError(String(err.message || err));
    }
  }

  async function selectRole(ref) {
    showError("");
    try {
      const r = await api(`/api/admin/roles/${encodeURIComponent(ref)}`);
      state.selected = r;
      state.selectedKind = "role";
      state.draftRoleMap = { ...(r.permission_map || {}) };
      markSelectedRow(r.reference_key);
      renderRoleDetail();
      openDetail();
    } catch (err) {
      showError(String(err.message || err));
    }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function levelOptions(areaId, current, { allowNone, roleDefault }) {
    const grantable = (state.actor.grantable && state.actor.grantable[areaId]) || ["NONE"];
    const area = findArea(areaId);
    const levels = area ? area.levels : ["READ_ONLY", "UPDATES_ONLY", "ADDS_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"];
    const opts = [];
    if (allowNone) {
      const label = roleDefault
        ? `Role default (${LEVEL_LABELS[roleDefault] || roleDefault || "Off"})`
        : "Off / role default";
      opts.push(`<option value="">${esc(label)}</option>`);
      opts.push(`<option value="NONE"${current === "NONE" ? " selected" : ""}>Off (subtract from role)</option>`);
    } else {
      opts.push(`<option value=""${current ? "" : " selected"}>Off</option>`);
    }
    for (const lv of levels) {
      const allowed = grantable.map((g) => g.toUpperCase()).includes(lv.toUpperCase()) ||
        (state.actor.employees_write && state.selectedKind === "employee" && current === lv) ||
        (state.actor.roles_write && state.selectedKind === "role" && current === lv);
      // Always show current value even if actor can't raise further
      const show = allowed || current === lv;
      if (!show) continue;
      const disabled = !grantable.map((g) => g.toUpperCase()).includes(lv.toUpperCase()) && current !== lv;
      opts.push(
        `<option value="${esc(lv)}"${current === lv ? " selected" : ""}${
          disabled ? " disabled" : ""
        }>${esc(LEVEL_LABELS[lv] || lv)}</option>`
      );
    }
    return opts.join("");
  }

  function findArea(id) {
    if (!state.catalog) return null;
    for (const g of state.catalog.groups || []) {
      for (const a of g.areas || []) {
        if (a.id === id) return a;
      }
    }
    return null;
  }

  function renderPermGrid(mode) {
    const groups = (state.catalog && state.catalog.groups) || [];
    const parts = ['<div class="perm-admin-grid">'];
    for (const g of groups) {
      parts.push(`<div class="perm-group"><h3>${esc(g.id)}</h3>`);
      for (const area of g.areas || []) {
        let current = "";
        let hint = "";
        if (mode === "employee") {
          const roleLevel = (state.selected.role_map || {})[area.id];
          const ov = (state.selected.override_map || {})[area.id];
          const eff = state.draftEffective[area.id];
          if (ov === "NONE") {
            current = "NONE";
            hint = "Override: subtracted";
          } else if (ov) {
            current = ov;
            hint = "Override";
          } else if (eff) {
            // editing draft may differ
            current = eff === roleLevel ? "" : eff;
            hint = roleLevel ? `Role: ${LEVEL_LABELS[roleLevel] || roleLevel}` : "";
          } else {
            current = "";
            hint = roleLevel ? `Role: ${LEVEL_LABELS[roleLevel] || roleLevel}` : "";
          }
          // Prefer draftEffective for select display
          const draft = state.draftEffective[area.id];
          if (draft === undefined || draft === null || draft === "") {
            current = ov === "NONE" ? "NONE" : ov || "";
          } else if (draft === roleLevel) {
            current = "";
          } else {
            current = draft;
          }
          parts.push(`<div class="perm-row">
            <span class="perm-row-name">${esc(area.label)}</span>
            <select data-area="${esc(area.id)}">${levelOptions(area.id, current, {
              allowNone: true,
              roleDefault: roleLevel,
            })}</select>
            <span class="perm-hint">${esc(hint)}</span>
          </div>`);
        } else {
          current = state.draftRoleMap[area.id] || "";
          parts.push(`<div class="perm-row">
            <span class="perm-row-name">${esc(area.label)}</span>
            <select data-area="${esc(area.id)}">${levelOptions(area.id, current, {
              allowNone: false,
            })}</select>
            <span class="perm-hint"></span>
          </div>`);
        }
      }
      parts.push("</div>");
    }
    parts.push("</div>");
    return parts.join("");
  }

  function effectiveChips(map) {
    const entries = Object.entries(map || {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) return '<span class="perm-hint">No grants</span>';
    return entries
      .map(
        ([k, v]) =>
          `<span class="perm-chip">${esc(k)}: ${esc(LEVEL_LABELS[v] || v)}</span>`
      )
      .join("");
  }

  function renderEmployeeDetail() {
    const e = state.selected;
    const canWrite = !!state.actor.employees_write;
    els.detailLabel.textContent = "Employee";
    els.detailTitle.textContent = e.name || e.reference_key;
    els.detailSubtitle.textContent = e.reference_key || "";

    const roleOpts = state.roles.length
      ? state.roles
      : [{ reference_key: e.role_id, role: e.role_name }];

    // Ensure roles list for picker
    const roleSelect = roleOpts
      .map(
        (r) =>
          `<option value="${esc(r.reference_key)}"${
            r.reference_key === e.role_id ? " selected" : ""
          }>${esc(r.role || r.reference_key)}</option>`
      )
      .join("");

    els.detailBody.innerHTML = `
      <div class="perm-identity">
        <label class="dgs-emp-field dgs-emp-field--full">
          <span class="dgs-emp-field-label">Name</span>
          <input id="fld-name" ${canWrite ? "" : "disabled"} value="${esc(e.name || "")}" />
        </label>
        <label class="dgs-emp-field dgs-emp-field--full">
          <span class="dgs-emp-field-label">Email</span>
          <input id="fld-email" type="email" ${canWrite ? "" : "disabled"} value="${esc(e.email || "")}" />
        </label>
        <label class="dgs-emp-field">
          <span class="dgs-emp-field-label">Role</span>
          <select id="fld-role" ${canWrite ? "" : "disabled"}>${roleSelect}</select>
        </label>
        <label class="dgs-emp-field">
          <span class="dgs-emp-field-label">Active</span>
          <select id="fld-active" ${canWrite ? "" : "disabled"}>
            <option value="1"${e.active ? " selected" : ""}>Yes</option>
            <option value="0"${e.active ? "" : " selected"}>No</option>
          </select>
        </label>
      </div>
      <p class="dgs-v2-section-label">Effective permissions</p>
      <div class="perm-effective" id="eff-chips">${effectiveChips(state.draftEffective)}</div>
      <p class="dgs-v2-section-label">Area toggles (overrides vs role)</p>
      ${renderPermGrid("employee")}
    `;
    setDetailActions(
      canWrite
        ? `<button type="button" class="dgs-v2-btn dgs-v2-btn--primary" id="btn-save-emp">Save</button>
           <button type="button" class="dgs-v2-btn" id="btn-reset-ov">Reset overrides…</button>`
        : `<span class="perm-hint">Read-only</span>`
    );

    els.detailBody.querySelectorAll("select[data-area]").forEach((sel) => {
      sel.disabled = !canWrite;
      sel.addEventListener("change", () => {
        const area = sel.getAttribute("data-area");
        const roleLevel = (e.role_map || {})[area];
        const val = sel.value;
        if (!val) {
          if (roleLevel) state.draftEffective[area] = roleLevel;
          else delete state.draftEffective[area];
        } else if (val === "NONE") {
          delete state.draftEffective[area];
        } else {
          state.draftEffective[area] = val;
        }
        const chips = document.getElementById("eff-chips");
        if (chips) chips.innerHTML = effectiveChips(state.draftEffective);
      });
    });

    const saveBtn = document.getElementById("btn-save-emp");
    if (saveBtn) saveBtn.addEventListener("click", saveEmployee);
    const resetBtn = document.getElementById("btn-reset-ov");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        els.resetMessage.textContent = `Clears all personal overrides and restores role “${
          e.role_name || e.role_id || "base"
        }” permissions.`;
        els.resetModal.hidden = false;
      });
    }
  }

  function renderRoleDetail() {
    const r = state.selected;
    const canWrite = !!state.actor.roles_write;
    els.detailLabel.textContent = "Role";
    els.detailTitle.textContent = r.role || r.reference_key;
    els.detailSubtitle.textContent = r.reference_key || "";

    els.detailBody.innerHTML = `
      <div class="perm-identity">
        <label class="dgs-emp-field dgs-emp-field--full">
          <span class="dgs-emp-field-label">Name</span>
          <input id="fld-role-name" ${canWrite ? "" : "disabled"} value="${esc(r.role || "")}" />
        </label>
      </div>
      <p class="dgs-v2-section-label">Template permissions</p>
      <div class="perm-effective">${effectiveChips(state.draftRoleMap)}</div>
      ${renderPermGrid("role")}
    `;
    setDetailActions(
      canWrite
        ? '<button type="button" class="dgs-v2-btn dgs-v2-btn--primary" id="btn-save-role">Save role</button>'
        : '<span class="perm-hint">Read-only</span>'
    );

    els.detailBody.querySelectorAll("select[data-area]").forEach((sel) => {
      sel.disabled = !canWrite;
      sel.addEventListener("change", () => {
        const area = sel.getAttribute("data-area");
        const val = sel.value;
        if (!val) delete state.draftRoleMap[area];
        else state.draftRoleMap[area] = val;
      });
    });
    const saveBtn = document.getElementById("btn-save-role");
    if (saveBtn) saveBtn.addEventListener("click", saveRole);
  }

  async function saveEmployee() {
    const e = state.selected;
    showError("");
    const effective_map = {};
    // Build full desired map from selects
    els.detailBody.querySelectorAll("select[data-area]").forEach((sel) => {
      const area = sel.getAttribute("data-area");
      const val = sel.value;
      const roleLevel = (e.role_map || {})[area];
      if (!val) {
        if (roleLevel) effective_map[area] = roleLevel;
        else effective_map[area] = null;
      } else if (val === "NONE") {
        effective_map[area] = null;
      } else {
        effective_map[area] = val;
      }
    });
    try {
      const updated = await api(`/api/admin/employees/${encodeURIComponent(e.reference_key)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: document.getElementById("fld-name").value,
          email: document.getElementById("fld-email").value,
          role_id: document.getElementById("fld-role").value,
          active: document.getElementById("fld-active").value === "1",
          effective_map,
        }),
      });
      state.selected = updated;
      state.draftEffective = { ...(updated.effective || {}) };
      renderEmployeeDetail();
      await loadList();
    } catch (err) {
      showError(String(err.message || err));
    }
  }

  async function saveRole() {
    const r = state.selected;
    showError("");
    const permission_map = {};
    els.detailBody.querySelectorAll("select[data-area]").forEach((sel) => {
      const area = sel.getAttribute("data-area");
      const val = sel.value;
      permission_map[area] = val || null;
    });
    try {
      const updated = await api(`/api/admin/roles/${encodeURIComponent(r.reference_key)}`, {
        method: "PATCH",
        body: JSON.stringify({
          role: document.getElementById("fld-role-name").value,
          permission_map,
        }),
      });
      state.selected = updated;
      state.draftRoleMap = { ...(updated.permission_map || {}) };
      renderRoleDetail();
      await loadList();
    } catch (err) {
      showError(String(err.message || err));
    }
  }

  async function confirmReset() {
    const e = state.selected;
    els.resetModal.hidden = true;
    if (!e) return;
    showError("");
    try {
      const updated = await api(
        `/api/admin/employees/${encodeURIComponent(e.reference_key)}/reset-overrides`,
        { method: "POST", body: JSON.stringify({ confirm: true }) }
      );
      state.selected = updated;
      state.draftEffective = { ...(updated.effective || {}) };
      renderEmployeeDetail();
      await loadList();
    } catch (err) {
      showError(String(err.message || err));
    }
  }

  async function init() {
    els.tabEmployees.addEventListener("click", () => setView("employees"));
    els.tabRoles.addEventListener("click", () => setView("roles"));
    els.refreshBtn.addEventListener("click", loadList);
    els.searchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") loadList();
    });
    els.activeFilter.addEventListener("change", loadList);
    document.getElementById("btn-close-detail").addEventListener("click", closeDetail);
    els.backdrop.addEventListener("click", closeDetail);
    document.getElementById("btn-reset-cancel").addEventListener("click", () => {
      els.resetModal.hidden = true;
    });
    document.getElementById("btn-reset-confirm").addEventListener("click", confirmReset);
    window.addEventListener("resize", () => {
      if (!document.body.classList.contains("detail-open")) return;
      document.body.classList.toggle("dgs-emp-drawer-compact", isCompactDrawer());
    });

    try {
      const ok = await loadCatalog();
      if (!ok) return;
      // Prefetch roles for employee picker
      try {
        const data = await api("/api/admin/roles");
        state.roles = data.roles || [];
      } catch (_e) {
        /* roles read may be missing */
      }
      await loadList();
    } catch (err) {
      if (String(err.message || "").includes("403") || String(err.message || "").includes("No employees")) {
        els.deniedBox.hidden = false;
        els.browsePanel.hidden = true;
      } else {
        showError(String(err.message || err));
      }
    }
  }

  window.DGSEmployeesAdmin = { init };
})();
