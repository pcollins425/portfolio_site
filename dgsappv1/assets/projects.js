/* Projects module — Calendar (projects.ims) | Catalog (projects.project_catalog) | eMaint tab.
   Read-only v1. Calendar ported from ERM project_calendar.js (custom month grid). */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  const state = {
    view: null,
    permissions: { calendar: true, catalog: true, emaint: true },

    // calendar
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth() + 1, // 1-12
    projectsByDate: {},
    allProjects: [],
    loadedMonths: new Set(),
    calSelectedDate: null,
    calSearch: "",

    // catalog
    catItems: [],
    catPage: 1,
    catPageSize: 50,
    catTotal: 0,
    catSearch: "",
    catSelectedKey: null,
    catDetail: null,
    printoutCache: {},

    // emaint
    emColumns: [],
    emKeyColumn: "project_no",
    emRows: [],
    emOffset: 0,
    emLimit: 50,
    emSearch: "",
    emSelectedKey: null,
  };

  const els = {};
  const IDS = [
    "error-box", "view-toggle", "page-subtitle",
    "view-calendar", "view-catalog", "view-emaint",
    "cal-grid", "cal-month-year", "cal-prev-month", "cal-next-month",
    "cal-prev-year", "cal-next-year", "cal-today", "cal-search",
    "cal-clear-day", "cal-list-range", "cal-list-body",
    "cal-detail-drawer", "cal-detail-backdrop", "cal-detail-body", "cal-detail-title", "cal-detail-close",
    "cat-search", "cat-search-btn", "cat-prev", "cat-next", "cat-tbody", "cat-list-status",
    "cat-hero-state", "cat-hero-title", "cat-hero-meta",
    "cat-detail-body", "cat-detail-empty", "cat-detail-content", "cat-fields", "cat-notation-wrap", "cat-notation", "cat-actions",
    "cat-open-printout", "printout-overlay", "printout-title", "printout-meta", "printout-close", "printout-table",
    "em-search", "em-search-btn", "em-prev", "em-next", "em-thead", "em-tbody", "em-list-status",
    "em-detail-body", "em-detail-empty", "em-detail-content", "em-fields",
  ];

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const PRINTOUT_LABELS = {
    casino_name: "Casino",
    project_number: "Project #",
    zone: "Zone",
    bank: "Bank",
    location: "Location",
    serial_number: "Serial",
    class: "Class",
    theme_name: "Theme",
    vendor_name: "Vendor",
    cabinet_type: "Cabinet",
    work_notes: "Action",
    display_type: "Display",
    program_storage: "Program storage",
    paytable_id: "Paytable",
    denom: "Denom",
    theo_inc_prog: "Theo incl. prog",
    reels: "Reels",
    lines_or_ways: "Lines / ways",
    bet_per_line: "Bet per line",
    max_coin_bet: "Max coin bet",
    bet_multipliers: "Bet multipliers",
    progressive_level_count: "Prog levels",
    tribe_name: "Tribe",
  };

  function apiBase() {
    return window.DGSAuth ? DGSAuth.apiBase() : "";
  }

  async function fetchJson(path) {
    const headers = window.DGSAuth ? DGSAuth.authHeaders() : {};
    const res = await fetch(`${apiBase()}${path}`, { headers });
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

  function showError(msg) {
    els["error-box"].hidden = !msg;
    els["error-box"].textContent = msg || "";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  /* ================= view toggle ================= */

  function setView(view, { push = true } = {}) {
    if (!state.permissions[view]) view = firstAllowedView();
    if (!view) return;
    state.view = view;
    for (const btn of els["view-toggle"].querySelectorAll("button")) {
      btn.classList.toggle("active", btn.dataset.view === view);
    }
    els["view-calendar"].hidden = view !== "calendar";
    els["view-catalog"].hidden = view !== "catalog";
    els["view-emaint"].hidden = view !== "emaint";
    const subtitles = {
      calendar: "projects.ims + pre-eMaint catalog · month grid + day filter",
      catalog: "projects.project_catalog · machine lines + commission printout",
      emaint: "projects.emaint_landing · raw eMaint PROJECT mirror (read-only)",
    };
    els["page-subtitle"].textContent = subtitles[view];

    if (push) {
      const u = new URL(window.location.href);
      u.searchParams.set("view", view);
      window.history.replaceState({}, "", u.pathname + u.search);
    }

    if (view === "calendar" && !state.loadedMonths.size) loadCalendarMonths();
    if (view === "catalog" && !state.catItems.length) loadCatalogList();
    if (view === "emaint" && !state.emRows.length) loadEmaintRows();
  }

  function firstAllowedView() {
    for (const v of ["calendar", "catalog", "emaint"]) {
      if (state.permissions[v]) return v;
    }
    return null;
  }

  function applyPermissionsToToggle() {
    for (const btn of els["view-toggle"].querySelectorAll("button")) {
      const allowed = Boolean(state.permissions[btn.dataset.view]);
      btn.hidden = !allowed;
    }
  }

  /* ================= calendar ================= */

  function monthKey(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  function monthRange(year, month) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const last = new Date(Date.UTC(year, month, 0));
    return {
      firstStr: first.toISOString().slice(0, 10),
      lastStr: last.toISOString().slice(0, 10),
    };
  }

  async function loadCalendarMonths() {
    const y = state.calYear;
    const m = state.calMonth;
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    const wanted = [prev, { y, m }, next].filter(
      (mm) => !state.loadedMonths.has(monthKey(mm.y, mm.m))
    );

    if (!wanted.length) {
      renderCalendar();
      renderCalList();
      return;
    }

    const start = monthRange(wanted[0].y, wanted[0].m).firstStr;
    const end = monthRange(wanted[wanted.length - 1].y, wanted[wanted.length - 1].m).lastStr;

    els["cal-list-body"].innerHTML = `<div class="dgs-prj-cal-empty">Loading projects…</div>`;
    try {
      const data = await fetchJson(`/api/projects/calendar?start_date=${start}&end_date=${end}`);
      for (const [dateKey, list] of Object.entries(data.projects_by_date || {})) {
        const existing = state.projectsByDate[dateKey];
        if (!existing) {
          state.projectsByDate[dateKey] = list;
          continue;
        }
        const seen = new Set(existing.map((p) => p.reference_key));
        for (const p of list) {
          if (!seen.has(p.reference_key)) existing.push(p);
        }
      }
      wanted.forEach((mm) => state.loadedMonths.add(monthKey(mm.y, mm.m)));
      rebuildAllProjects();
      renderCalendar();
      renderCalList();
    } catch (err) {
      showError(err.message || String(err));
      renderCalendar();
      els["cal-list-body"].innerHTML = `<div class="dgs-prj-cal-empty">Could not load projects.</div>`;
    }
  }

  function rebuildAllProjects() {
    const map = new Map();
    for (const list of Object.values(state.projectsByDate)) {
      for (const p of list) {
        const key = p.reference_key || `${p.date_start}-${p.property}`;
        if (!map.has(key)) map.set(key, p);
      }
    }
    state.allProjects = Array.from(map.values());
  }

  function navigateMonth(delta) {
    state.calMonth += delta;
    if (state.calMonth < 1) {
      state.calMonth = 12;
      state.calYear -= 1;
    } else if (state.calMonth > 12) {
      state.calMonth = 1;
      state.calYear += 1;
    }
    resetCalFilters();
    loadCalendarMonths();
  }

  function navigateYear(delta) {
    state.calYear += delta;
    resetCalFilters();
    loadCalendarMonths();
  }

  function resetCalFilters() {
    state.calSelectedDate = null;
    state.calSearch = "";
    els["cal-search"].value = "";
    els["cal-clear-day"].hidden = true;
  }

  function goToToday() {
    const now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth() + 1;
    resetCalFilters();
    loadCalendarMonths();
  }

  function renderCalendar() {
    const grid = els["cal-grid"];
    grid.innerHTML = "";
    els["cal-month-year"].textContent = `${MONTH_NAMES[state.calMonth - 1]} ${state.calYear}`;

    const firstDay = new Date(state.calYear, state.calMonth - 1, 1);
    const daysInMonth = new Date(state.calYear, state.calMonth, 0).getDate();
    const startDow = firstDay.getDay();

    const today = new Date();
    const isCurrentMonth =
      today.getFullYear() === state.calYear && today.getMonth() + 1 === state.calMonth;

    const prevMonthLast = new Date(state.calYear, state.calMonth - 1, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
      grid.appendChild(dayCell(prevMonthLast - i, { other: true }));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${state.calYear}-${String(state.calMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      grid.appendChild(
        dayCell(day, {
          dateKey,
          projects: state.projectsByDate[dateKey] || [],
          today: isCurrentMonth && day === today.getDate(),
          selected: state.calSelectedDate === dateKey,
        })
      );
    }
    const filled = grid.children.length;
    const target = filled <= 35 ? 35 : 42;
    for (let day = 1; day <= target - filled; day++) {
      grid.appendChild(dayCell(day, { other: true }));
    }
  }

  function dayCell(dayNum, { other = false, dateKey, projects = [], today = false, selected = false } = {}) {
    const cell = document.createElement("div");
    cell.className = "dgs-prj-cal-day";
    if (other) cell.classList.add("is-other");
    if (today) cell.classList.add("is-today");
    if (selected) cell.classList.add("is-selected");

    const num = document.createElement("div");
    num.className = "dgs-prj-cal-day-num";
    num.textContent = dayNum;
    cell.appendChild(num);

    if (projects.length) {
      const box = document.createElement("div");
      box.className = "dgs-prj-cal-day-items";
      for (const p of projects.slice(0, 3)) {
        const chip = document.createElement("div");
        chip.className = "dgs-prj-cal-chip";
        if (p.matching_catalog) chip.classList.add("has-details");
        const label = [p.property, p.project_no].filter(Boolean).join(" ") || p.proj_desc || "Project";
        chip.textContent = label;
        chip.title = label;
        box.appendChild(chip);
      }
      if (projects.length > 3) {
        const more = document.createElement("div");
        more.className = "dgs-prj-cal-more";
        more.textContent = `+${projects.length - 3} more`;
        box.appendChild(more);
      }
      cell.appendChild(box);
    }

    if (!other && dateKey) {
      cell.addEventListener("click", () => {
        state.calSelectedDate = dateKey;
        els["cal-clear-day"].hidden = false;
        renderCalendar();
        renderCalList();
      });
    }
    return cell;
  }

  function calFilteredProjects() {
    let list;
    if (state.calSelectedDate) {
      list = state.projectsByDate[state.calSelectedDate] || [];
    } else {
      const prefix = monthKey(state.calYear, state.calMonth);
      list = state.allProjects.filter((p) => (p.date_start || "").startsWith(prefix));
    }
    if (state.calSearch) {
      const q = state.calSearch;
      list = list.filter((p) =>
        [p.property, p.project_no, p.proj_desc, p.proj_type, p.tech]
          .map((v) => String(v ?? "").toLowerCase())
          .some((v) => v.includes(q))
      );
    }
    return [...list].sort((a, b) => {
      const d = String(a.date_start || "").localeCompare(String(b.date_start || ""));
      if (d !== 0) return d;
      return (a.project_no || 0) - (b.project_no || 0);
    });
  }

  function renderCalList() {
    if (state.calSelectedDate) {
      const d = new Date(`${state.calSelectedDate}T00:00:00`);
      els["cal-list-range"].textContent = d.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });
    } else {
      els["cal-list-range"].textContent = `${MONTH_NAMES[state.calMonth - 1]} ${state.calYear}`;
    }

    const list = calFilteredProjects();
    if (!list.length) {
      els["cal-list-body"].innerHTML = `<div class="dgs-prj-cal-empty">No projects found.</div>`;
      return;
    }

    els["cal-list-body"].innerHTML = list
      .map((p) => {
        const title = [p.property, p.project_no].filter(Boolean).join(" ") || p.proj_desc || "Project";
        const noCasino = !p.casino_id;
        const badge = p.matching_catalog
          ? `<span class="dgs-prj-badge">Details Available</span>`
          : "";
        const dates = [p.date_start ? `Start ${fmtDate(p.date_start)}` : "", p.date_end ? `End ${fmtDate(p.date_end)}` : ""]
          .filter(Boolean)
          .join(" · ");
        return `
          <div class="dgs-prj-cal-item${noCasino ? " is-missing-casino" : ""}" data-key="${esc(p.reference_key)}">
            <div class="dgs-prj-cal-item-top">
              <span class="dgs-prj-cal-item-title">${esc(title)}</span>
              ${badge}
            </div>
            <div class="dgs-prj-cal-item-desc">${esc(p.proj_desc || "")}</div>
            <div class="dgs-prj-cal-item-meta">${esc([p.status, dates].filter(Boolean).join(" · "))}</div>
          </div>`;
      })
      .join("");

    els["cal-list-body"].querySelectorAll(".dgs-prj-cal-item").forEach((node) => {
      node.addEventListener("click", () => {
        const project = list.find((p) => p.reference_key === node.dataset.key);
        if (project) openCalDrawer(project);
      });
    });
  }

  function drawerField(label, value) {
    const val = value === null || value === undefined || value === "" ? "—" : value;
    return `
      <div class="dgs-prj-drawer-item">
        <div class="detail-label">${esc(label)}</div>
        <div class="dgs-prj-drawer-value">${esc(val)}</div>
      </div>`;
  }

  function catalogOpenLabel(catalog) {
    if (!catalog) return "Open in Catalog";
    const n = catalog.line_count || 0;
    if (n === 0) return "Open notation";
    return `Open in Catalog (${n} line${n === 1 ? "" : "s"})`;
  }

  function openCalDrawer(p) {
    els["cal-detail-title"].textContent =
      [p.property, p.project_no].filter(Boolean).join(" ") || "Project";

    let html = "";
    if (p.matching_catalog) {
      const ref = p.matching_catalog.reference_key;
      html += `
        <div class="dgs-prj-drawer-cta">
          <span class="dgs-prj-badge">Details Available</span>
          <button type="button" class="dgs-v2-btn dgs-v2-btn--primary" data-open-catalog="${esc(ref)}">
            ${esc(catalogOpenLabel(p.matching_catalog))}
          </button>
        </div>`;
      if (p.matching_catalog.notes) {
        html += `<div class="dgs-v2-section-label">Catalog notation</div>`;
        html += `<div class="dgs-prj-notation">${esc(p.matching_catalog.notes)}</div>`;
      }
    }
    html += `<div class="dgs-v2-section-label">Basic information</div>`;
    html += drawerField("Project number", p.project_no);
    html += drawerField("Type", p.proj_type);
    html += drawerField("Description", p.proj_desc);
    html += drawerField("Status", p.status);
    html += drawerField("Property", p.property);
    html += drawerField("Tribe", p.tribe);
    html += drawerField("State", p.state);
    html += `<div class="dgs-v2-section-label">Dates</div>`;
    html += drawerField("Start", fmtDate(p.date_start));
    html += drawerField("End", fmtDate(p.date_end));
    html += `<div class="dgs-v2-section-label">Assignment</div>`;
    html += drawerField("Lead tech", p.tech);
    html += drawerField("Assisting", p.assisting);
    if (p.comment) {
      html += `<div class="dgs-v2-section-label">Comments</div>`;
      html += drawerField("Comments", p.comment);
    }

    els["cal-detail-body"].innerHTML = html;
    const openBtn = els["cal-detail-body"].querySelector("[data-open-catalog]");
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        closeCalDrawer();
        setView("catalog");
        openCatalogDetail(openBtn.dataset.openCatalog).catch((err) =>
          showError(err.message || String(err))
        );
      });
    }

    els["cal-detail-drawer"].classList.add("open");
    els["cal-detail-drawer"].setAttribute("aria-hidden", "false");
    els["cal-detail-backdrop"].hidden = false;
  }

  function closeCalDrawer() {
    els["cal-detail-drawer"].classList.remove("open");
    els["cal-detail-drawer"].setAttribute("aria-hidden", "true");
    els["cal-detail-backdrop"].hidden = true;
  }

  /* ================= catalog ================= */

  async function loadCatalogList() {
    const q = encodeURIComponent(state.catSearch);
    els["cat-tbody"].innerHTML = `<tr><td colspan="6" class="dgs-v2-lines-status">Loading…</td></tr>`;
    try {
      const data = await fetchJson(
        `/api/projects/catalog?q=${q}&page=${state.catPage}&page_size=${state.catPageSize}`
      );
      state.catItems = data.items || [];
      state.catTotal = data.total || 0;
      renderCatalogList();
      if (!state.catSelectedKey && state.catItems.length) {
        await openCatalogDetail(state.catItems[0].reference_key);
      }
    } catch (err) {
      showError(err.message || String(err));
      els["cat-tbody"].innerHTML = "";
    }
  }

  function renderCatalogList() {
    els["cat-tbody"].innerHTML = state.catItems
      .map(
        (row) => `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.catSelectedKey ? "selected" : ""}">
          <td>${esc(row.project_name || row.reference_key)}</td>
          <td class="mono">${esc(row.ims_project_number || "—")}</td>
          <td>${esc(row.casino_name || "—")}</td>
          <td>${esc(row.status_name || row.status || "—")}</td>
          <td>${esc(row.line_count)}</td>
          <td>${esc(fmtDate(row.date_start))}</td>
        </tr>`
      )
      .join("");

    els["cat-tbody"].querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => {
        openCatalogDetail(tr.dataset.key).catch((err) => showError(err.message || String(err)));
      });
    });

    const start = state.catTotal === 0 ? 0 : (state.catPage - 1) * state.catPageSize + 1;
    const end = Math.min(state.catPage * state.catPageSize, state.catTotal);
    const note = state.catSearch ? ` · matching “${state.catSearch}”` : "";
    els["cat-list-status"].textContent =
      state.catTotal === 0
        ? `No projects found${note}.`
        : `Showing ${start}–${end} of ${state.catTotal}${note}`;
  }

  function catField(label, value) {
    const val = value === null || value === undefined || value === "" ? "—" : value;
    return `<dt>${esc(label)}</dt><dd>${esc(val)}</dd>`;
  }

  async function openCatalogDetail(referenceKey) {
    state.catSelectedKey = referenceKey;
    renderCatalogList();
    closePrintout();

    els["cat-detail-body"].classList.add("empty");
    els["cat-detail-empty"].hidden = false;
    els["cat-detail-empty"].textContent = "Loading project…";
    els["cat-detail-content"].hidden = true;
    els["cat-notation-wrap"].hidden = true;
    els["cat-hero-state"].textContent = "Project";
    els["cat-hero-title"].textContent = referenceKey;
    els["cat-hero-meta"].textContent = "Loading…";

    try {
      const d = await fetchJson(`/api/projects/catalog/${encodeURIComponent(referenceKey)}`);
      state.catDetail = d;

      els["cat-hero-state"].textContent = d.status_name || d.status || "Project";
      els["cat-hero-title"].textContent = d.project_name || d.reference_key;
      const metaBits = [
        d.casino_name,
        d.ims_project_number ? `IMS ${d.ims_project_number}` : null,
        `${d.line_count} machine line${d.line_count === 1 ? "" : "s"}`,
      ].filter(Boolean);
      els["cat-hero-meta"].textContent = metaBits.join(" · ");

      els["cat-fields"].innerHTML = [
        catField("Reference", d.reference_key),
        catField("Casino", d.casino_name),
        catField("Tribe", d.tribe_name),
        catField("IMS project", d.ims_project_number ? `${d.ims_project_number} (${d.ims_id || "no link"})` : "—"),
        catField("Type", d.project_type),
        catField("Status", d.status_name || d.status),
        catField("Start", fmtDate(d.date_start)),
        catField("End", fmtDate(d.date_end)),
        catField("Lead tech", d.ims_lead_tech),
        catField("Assisting", d.ims_assistant_techs),
        catField("Created by", d.created_by),
        catField("Description", d.description || d.ims_description),
      ].join("");

      const notation = (d.notes || "").trim();
      if (notation) {
        els["cat-notation"].textContent = notation;
        els["cat-notation-wrap"].hidden = false;
      } else {
        els["cat-notation"].textContent = "";
        els["cat-notation-wrap"].hidden = true;
      }

      els["cat-actions"].innerHTML = (d.actions || [])
        .map(
          (a) => `
          <div class="dgs-prj-action-row">
            <span class="dgs-prj-action-name">${esc(a.action_name || a.action_type)}</span>
            <span class="dgs-prj-action-count">${esc(a.line_count)}</span>
          </div>`
        )
        .join("") || `<p class="dgs-v2-lines-status">No machine lines.</p>`;

      els["cat-open-printout"].disabled = !d.line_count;
      els["cat-detail-body"].classList.remove("empty");
      els["cat-detail-empty"].hidden = true;
      els["cat-detail-content"].hidden = false;
    } catch (err) {
      state.catDetail = null;
      els["cat-detail-empty"].textContent = err.message || String(err);
      els["cat-hero-meta"].textContent = "Could not load project";
    }
  }

  async function openPrintout() {
    const d = state.catDetail;
    if (!d) return;
    const key = d.reference_key;

    els["printout-title"].textContent = d.project_name || key;
    els["printout-meta"].textContent = "Loading printout…";
    els["printout-table"].innerHTML = "";
    els["printout-overlay"].hidden = false;

    try {
      let data = state.printoutCache[key];
      if (!data) {
        data = await fetchJson(`/api/projects/catalog/${encodeURIComponent(key)}/printout`);
        state.printoutCache[key] = data;
      }

      const cols = data.columns.filter((c) =>
        data.rows.some((r) => r[c] !== null && r[c] !== undefined && r[c] !== "")
      );
      els["printout-meta"].textContent = `${data.total} line${data.total === 1 ? "" : "s"} · projects.project_printout`;
      els["printout-table"].innerHTML = `
        <thead>
          <tr>${cols.map((c) => `<th>${esc(PRINTOUT_LABELS[c] || c.replaceAll("_", " "))}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${data.rows
            .map(
              (r) =>
                `<tr>${cols
                  .map((c) => `<td>${esc(r[c] ?? "").replaceAll("\n", "<br>")}</td>`)
                  .join("")}</tr>`
            )
            .join("")}
        </tbody>`;
    } catch (err) {
      els["printout-meta"].textContent = err.message || String(err);
    }
  }

  function closePrintout() {
    els["printout-overlay"].hidden = true;
  }

  /* ================= eMaint tab ================= */

  const EM_BROWSE_LABELS = {
    project_no: "Project #",
    property: "Property",
    g_t_s: "Good to schedule",
    exp_instal: "Expected install",
    cab_date: "Cabinet date",
    editdate: "Edit date",
  };

  async function loadEmaintRows() {
    const q = state.emSearch ? `&q=${encodeURIComponent(state.emSearch)}` : "";
    els["em-tbody"].innerHTML = `<tr><td colspan="9" class="dgs-v2-lines-status">Loading…</td></tr>`;
    try {
      const data = await fetchJson(
        `/api/emaint-demo/projects/rows?limit=${state.emLimit}&offset=${state.emOffset}${q}`
      );
      state.emRows = data.rows || [];
      state.emKeyColumn = data.key_column || "project_no";
      state.emColumns = state.emRows.length
        ? Object.keys(state.emRows[0])
        : Object.keys(EM_BROWSE_LABELS);
      renderEmaintRows();
    } catch (err) {
      showError(err.message || String(err));
      els["em-tbody"].innerHTML = "";
      els["em-list-status"].textContent = "";
    }
  }

  function renderEmaintRows() {
    const cols = state.emColumns;
    els["em-thead"].innerHTML = `<tr>${cols
      .map((c) => `<th>${esc(EM_BROWSE_LABELS[c] || c.replaceAll("_", " "))}</th>`)
      .join("")}</tr>`;

    els["em-tbody"].innerHTML = state.emRows
      .map((row) => {
        const key = row[state.emKeyColumn];
        return `
        <tr data-key="${esc(key)}" class="${String(key) === String(state.emSelectedKey) ? "selected" : ""}">
          ${cols.map((c) => `<td>${esc(row[c] ?? "")}</td>`).join("")}
        </tr>`;
      })
      .join("");

    els["em-tbody"].querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => {
        openEmaintDetail(tr.dataset.key).catch((err) => showError(err.message || String(err)));
      });
    });

    const from = state.emOffset + 1;
    const to = state.emOffset + state.emRows.length;
    els["em-list-status"].textContent = state.emRows.length
      ? `Rows ${from}–${to}${state.emSearch ? ` · matching “${state.emSearch}”` : ""}`
      : "No rows found.";
  }

  async function openEmaintDetail(key) {
    state.emSelectedKey = key;
    renderEmaintRows();

    els["em-detail-body"].classList.add("empty");
    els["em-detail-empty"].hidden = false;
    els["em-detail-empty"].textContent = "Loading record…";
    els["em-detail-content"].hidden = true;

    try {
      const record = await fetchJson(
        `/api/emaint-demo/projects/rows/${encodeURIComponent(key)}`
      );
      els["em-fields"].innerHTML = Object.entries(record.fields || {})
        .map(([label, value]) => catField(label, value))
        .join("");
      els["em-detail-body"].classList.remove("empty");
      els["em-detail-empty"].hidden = true;
      els["em-detail-content"].hidden = false;
    } catch (err) {
      els["em-detail-empty"].textContent = err.message || String(err);
    }
  }

  /* ================= init ================= */

  function bindEvents() {
    els["view-toggle"].addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-view]");
      if (btn) setView(btn.dataset.view);
    });

    els["cal-prev-month"].addEventListener("click", () => navigateMonth(-1));
    els["cal-next-month"].addEventListener("click", () => navigateMonth(1));
    els["cal-prev-year"].addEventListener("click", () => navigateYear(-1));
    els["cal-next-year"].addEventListener("click", () => navigateYear(1));
    els["cal-today"].addEventListener("click", goToToday);
    els["cal-search"].addEventListener("input", (e) => {
      state.calSearch = e.target.value.toLowerCase().trim();
      renderCalList();
    });
    els["cal-clear-day"].addEventListener("click", () => {
      state.calSelectedDate = null;
      els["cal-clear-day"].hidden = true;
      renderCalendar();
      renderCalList();
    });
    els["cal-detail-close"].addEventListener("click", closeCalDrawer);
    els["cal-detail-backdrop"].addEventListener("click", closeCalDrawer);

    const runCatSearch = () => {
      state.catSearch = els["cat-search"].value.trim();
      state.catPage = 1;
      state.catSelectedKey = null;
      loadCatalogList();
    };
    els["cat-search-btn"].addEventListener("click", runCatSearch);
    els["cat-search"].addEventListener("keydown", (e) => {
      if (e.key === "Enter") runCatSearch();
    });
    els["cat-prev"].addEventListener("click", () => {
      if (state.catPage <= 1) return;
      state.catPage -= 1;
      loadCatalogList();
    });
    els["cat-next"].addEventListener("click", () => {
      if (state.catPage * state.catPageSize >= state.catTotal) return;
      state.catPage += 1;
      loadCatalogList();
    });
    els["cat-open-printout"].addEventListener("click", openPrintout);
    els["printout-close"].addEventListener("click", closePrintout);

    const runEmSearch = () => {
      state.emSearch = els["em-search"].value.trim();
      state.emOffset = 0;
      loadEmaintRows();
    };
    els["em-search-btn"].addEventListener("click", runEmSearch);
    els["em-search"].addEventListener("keydown", (e) => {
      if (e.key === "Enter") runEmSearch();
    });
    els["em-prev"].addEventListener("click", () => {
      if (state.emOffset === 0) return;
      state.emOffset = Math.max(0, state.emOffset - state.emLimit);
      loadEmaintRows();
    });
    els["em-next"].addEventListener("click", () => {
      if (state.emRows.length < state.emLimit) return;
      state.emOffset += state.emLimit;
      loadEmaintRows();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!els["printout-overlay"].hidden) closePrintout();
      else closeCalDrawer();
    });
  }

  async function init() {
    for (const id of IDS) els[id] = document.getElementById(id);
    bindEvents();

    try {
      const p = await fetchJson("/api/projects/permissions");
      state.permissions = {
        calendar: Boolean(p.calendar),
        catalog: Boolean(p.catalog),
        emaint: Boolean(p.emaint),
      };
    } catch (_err) {
      /* endpoint unavailable — leave all views enabled and let per-call 403s surface */
    }
    applyPermissionsToToggle();

    const requested = params.get("view");
    const view = ["calendar", "catalog", "emaint"].includes(requested) ? requested : "calendar";
    setView(view, { push: false });

    if (!firstAllowedView()) {
      showError("You do not have access to any Projects views. Ask an admin for dgs_projects_calendar / dgs_projects_catalog.");
    }
  }

  window.DGSProjects = { init };
})();
