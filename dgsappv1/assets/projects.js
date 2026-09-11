/* Projects module — Calendar (projects.ims) | Catalog (projects.project_catalog).
   Read-only v1. Calendar ported from ERM project_calendar.js (custom month grid). */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  // Compact = phone + tablet (incl. landscape). Desk layout only above 1366px.
  const COMPACT_MQ = window.matchMedia("(max-width: 1366px)");

  const state = {
    view: null,
    permissions: { calendar: true, catalog: true },

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
    catCasinoId: "",
    printoutCache: {},
    printoutCols: [],
    printoutRows: [],
    phoneDetailOpen: false,
  };

  const els = {};
  const IDS = [
    "error-box", "view-toggle", "page-subtitle",
    "view-calendar", "view-catalog",
    "cal-grid", "cal-month-year", "cal-prev-month", "cal-next-month",
    "cal-prev-year", "cal-next-year", "cal-today", "cal-search",
    "cal-clear-day", "cal-list-range", "cal-list-body",
    "cal-detail-drawer", "cal-detail-backdrop", "cal-detail-body", "cal-detail-title", "cal-detail-close",
    "cat-search", "cat-search-btn", "cat-prev", "cat-next", "cat-page-label", "cat-tbody", "cat-list-status",
    "cat-detail-panel", "cat-detail-backdrop", "cat-detail-bar", "cat-detail-close",
    "cat-hero-state", "cat-hero-title", "cat-hero-meta",
    "cat-detail-body", "cat-detail-empty", "cat-detail-content", "cat-fields", "cat-notation-wrap", "cat-notation", "cat-actions",
    "cat-open-printout", "printout-overlay", "printout-title", "printout-meta", "printout-close",
    "printout-table", "printout-list", "printout-line-backdrop", "printout-line-sheet",
    "printout-line-title", "printout-line-body", "printout-line-close",
  ];

  function isCompact() {
    return COMPACT_MQ.matches;
  }

  function openPhoneDetail() {
    if (!isCompact() || !els["cat-detail-panel"]) return;
    state.phoneDetailOpen = true;
    document.body.classList.add("projects-detail-open");
    els["cat-detail-panel"].classList.add("dgs-v2-detail--sheet");
    els["cat-detail-panel"].setAttribute("aria-hidden", "false");
    if (els["cat-detail-backdrop"]) els["cat-detail-backdrop"].hidden = false;
    if (els["cat-detail-bar"]) els["cat-detail-bar"].hidden = false;
  }

  function closePhoneDetail() {
    state.phoneDetailOpen = false;
    document.body.classList.remove("projects-detail-open");
    if (els["cat-detail-panel"]) {
      els["cat-detail-panel"].classList.remove("dgs-v2-detail--sheet");
      if (isCompact()) els["cat-detail-panel"].setAttribute("aria-hidden", "true");
      else els["cat-detail-panel"].setAttribute("aria-hidden", "false");
    }
    if (els["cat-detail-backdrop"]) els["cat-detail-backdrop"].hidden = true;
    if (els["cat-detail-bar"]) els["cat-detail-bar"].hidden = true;
  }

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

  function printoutLabel(col) {
    return PRINTOUT_LABELS[col] || col.replaceAll("_", " ");
  }

  function printoutVal(v) {
    if (v === null || v === undefined || v === "") return "";
    return String(v);
  }

  function activePrintoutCols(data) {
    return data.columns.filter((c) =>
      data.rows.some((r) => printoutVal(r[c]) !== "")
    );
  }

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
    const subtitles = {
      calendar: "projects.ims + pre-eMaint catalog · month grid + day filter",
      catalog: "projects.project_catalog · machine lines + commission printout",
    };
    els["page-subtitle"].textContent = subtitles[view];

    if (push) {
      const u = new URL(window.location.href);
      u.searchParams.set("view", view);
      window.history.replaceState({}, "", u.pathname + u.search);
    }

    if (view === "calendar" && !state.loadedMonths.size) loadCalendarMonths();
    if (view === "catalog" && !state.catItems.length) loadCatalogList();
    if (view !== "catalog") closePhoneDetail();
  }

  function firstAllowedView() {
    for (const v of ["calendar", "catalog"]) {
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
    if (projects.length) cell.classList.add("has-projects");
    if (projects.some((p) => p.matching_catalog)) cell.classList.add("has-details");

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
    return `Open printout (${n} line${n === 1 ? "" : "s"})`;
  }

  function openCalDrawer(p) {
    els["cal-detail-title"].textContent =
      [p.property, p.project_no].filter(Boolean).join(" ") || "Project";

    let html = "";
    if (p.matching_catalog) {
      const ref = p.matching_catalog.reference_key;
      const lineCount = p.matching_catalog.line_count || 0;
      const openPrintout = lineCount > 0;
      html += `
        <div class="dgs-prj-drawer-cta">
          <span class="dgs-prj-badge">Details Available</span>
          <button type="button" class="dgs-v2-btn dgs-v2-btn--primary"
            data-open-catalog="${esc(ref)}"
            data-open-printout="${openPrintout ? "1" : "0"}">
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
        const ref = openBtn.dataset.openCatalog;
        const wantPrintout = openBtn.dataset.openPrintout === "1";
        closeCalDrawer();
        setView("catalog");
        openCatalogDetail(ref, { openSheet: !wantPrintout })
          .then(() => {
            if (wantPrintout) return openPrintout();
          })
          .catch((err) => showError(err.message || String(err)));
      });
    }

    els["cal-detail-drawer"].classList.add("open");
    els["cal-detail-drawer"].setAttribute("aria-hidden", "false");
    els["cal-detail-backdrop"].hidden = false;
    document.body.classList.add("projects-cal-drawer-open");
  }

  function closeCalDrawer() {
    els["cal-detail-drawer"].classList.remove("open");
    els["cal-detail-drawer"].setAttribute("aria-hidden", "true");
    els["cal-detail-backdrop"].hidden = true;
    document.body.classList.remove("projects-cal-drawer-open");
  }

  /* ================= catalog ================= */

  async function loadCatalogList() {
    const q = encodeURIComponent(state.catSearch);
    const casino = encodeURIComponent(state.catCasinoId || "");
    els["cat-tbody"].innerHTML = `<tr><td colspan="6" class="dgs-v2-lines-status">Loading…</td></tr>`;
    try {
      let path = `/api/projects/catalog?q=${q}&page=${state.catPage}&page_size=${state.catPageSize}`;
      if (state.catCasinoId) path += `&casino_id=${casino}`;
      const data = await fetchJson(path);
      state.catItems = data.items || [];
      state.catTotal = data.total || 0;
      renderCatalogList();
      // Wide desktop only: auto-select first row. Compact uses sheet — don't auto-open.
      if (!isCompact() && !state.catSelectedKey && state.catItems.length) {
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
          <td class="mono dgs-v2-col--desktop">${esc(row.ims_project_number || "—")}</td>
          <td>${esc(row.casino_name || "—")}</td>
          <td>${esc(row.status_name || row.status || "—")}</td>
          <td class="dgs-v2-col--desktop">${esc(row.line_count)}</td>
          <td class="dgs-v2-col--desktop">${esc(fmtDate(row.date_start))}</td>
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
    const noteBits = [];
    if (state.catSearch) noteBits.push(`matching “${state.catSearch}”`);
    if (state.catCasinoId) noteBits.push(`casino ${state.catCasinoId}`);
    const note = noteBits.length ? ` · ${noteBits.join(" · ")}` : "";
    els["cat-list-status"].textContent =
      state.catTotal === 0
        ? `No projects found${note}.`
        : `Showing ${start}–${end} of ${state.catTotal}${note}`;

    const totalPages = Math.max(1, Math.ceil(state.catTotal / state.catPageSize) || 1);
    if (els["cat-page-label"]) {
      els["cat-page-label"].textContent =
        state.catTotal === 0 ? "Page 0" : `Page ${state.catPage} of ${totalPages}`;
    }
  }

  function catField(label, value) {
    const val = value === null || value === undefined || value === "" ? "—" : value;
    return `<dt>${esc(label)}</dt><dd>${esc(val)}</dd>`;
  }

  async function openCatalogDetail(referenceKey, { openSheet = true } = {}) {
    state.catSelectedKey = referenceKey;
    renderCatalogList();
    closePrintout();
    if (isCompact() && openSheet) openPhoneDetail();

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

  function printoutSerialHtml(row) {
    const serial = printoutVal(row.serial_number);
    if (!serial) return "—";
    const assetId = printoutVal(row.asset_id);
    if (assetId && window.DGSAssetNav) {
      return DGSAssetNav.hubLinkHtml(assetId, serial, "dgs-v2-hub-serial-link");
    }
    return esc(serial);
  }

  function renderPrintoutTable(cols, rows) {
    els["printout-table"].innerHTML = `
      <thead>
        <tr>${cols.map((c) => `<th>${esc(printoutLabel(c))}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr>${cols
                .map((c) => {
                  if (c === "serial_number") return `<td>${printoutSerialHtml(r)}</td>`;
                  return `<td>${esc(printoutVal(r[c])).replaceAll("\n", "<br>")}</td>`;
                })
                .join("")}</tr>`
          )
          .join("")}
      </tbody>`;
  }

  function renderPrintoutList(rows) {
    if (!rows.length) {
      els["printout-list"].innerHTML = `<p class="dgs-prj-cal-empty">No printout lines.</p>`;
      return;
    }
    els["printout-list"].innerHTML = rows
      .map(
        (r, i) => `
        <button type="button" class="dgs-prj-printout-row" data-idx="${i}">
          <span class="dgs-prj-printout-row-serial">${esc(printoutVal(r.serial_number) || "—")}</span>
          <span class="dgs-prj-printout-row-grid">
            <span><strong>Cabinet</strong><span class="dgs-prj-printout-row-val">${esc(printoutVal(r.cabinet_type) || "—")}</span></span>
            <span><strong>Theme</strong><span class="dgs-prj-printout-row-val">${esc(printoutVal(r.theme_name) || "—")}</span></span>
          </span>
          <span class="dgs-prj-printout-row-action">${esc(printoutVal(r.work_notes) || "—")}</span>
        </button>`
      )
      .join("");
  }

  function applyPrintoutMode() {
    const compact = isCompact();
    if (els["printout-table"]) els["printout-table"].hidden = compact;
    if (els["printout-list"]) els["printout-list"].hidden = !compact;
    if (!compact) closePrintoutLine();
  }

  function openPrintoutLine(idx) {
    if (!isCompact()) return;
    const row = state.printoutRows[idx];
    if (!row) return;

    const serial = printoutVal(row.serial_number) || "Line";
    const action = printoutVal(row.work_notes);
    els["printout-line-title"].textContent = action ? `${serial} · ${action}` : serial;

    const fields = state.printoutCols
      .map((c) => {
        const v = printoutVal(row[c]);
        if (!v) return "";
        const valueHtml =
          c === "serial_number" ? printoutSerialHtml(row) : esc(v).replaceAll("\n", "<br>");
        return `<div class="dgs-prj-printout-field"><dt>${esc(printoutLabel(c))}</dt><dd>${valueHtml}</dd></div>`;
      })
      .filter(Boolean)
      .join("");

    els["printout-line-body"].innerHTML = fields
      ? `<dl>${fields}</dl>`
      : `<p class="dgs-prj-cal-empty">No field values on this line.</p>`;

    els["printout-line-backdrop"].hidden = false;
    els["printout-line-sheet"].hidden = false;
    els["printout-line-sheet"].setAttribute("aria-hidden", "false");
    document.body.classList.add("projects-printout-line-open");
  }

  function closePrintoutLine() {
    document.body.classList.remove("projects-printout-line-open");
    if (els["printout-line-backdrop"]) els["printout-line-backdrop"].hidden = true;
    if (els["printout-line-sheet"]) {
      els["printout-line-sheet"].hidden = true;
      els["printout-line-sheet"].setAttribute("aria-hidden", "true");
    }
  }

  async function openPrintout() {
    const d = state.catDetail;
    if (!d) return;
    const key = d.reference_key;

    els["printout-title"].textContent = d.project_name || key;
    els["printout-meta"].textContent = "Loading printout…";
    els["printout-table"].innerHTML = "";
    els["printout-list"].innerHTML = "";
    els["printout-overlay"].hidden = false;
    document.body.classList.add("projects-printout-open");
    closePrintoutLine();
    applyPrintoutMode();

    try {
      let data = state.printoutCache[key];
      if (!data) {
        data = await fetchJson(`/api/projects/catalog/${encodeURIComponent(key)}/printout`);
        state.printoutCache[key] = data;
      }

      const cols = activePrintoutCols(data);
      state.printoutCols = cols;
      state.printoutRows = data.rows || [];
      els["printout-meta"].textContent = `${data.total} line${data.total === 1 ? "" : "s"} · projects.project_printout`;
      renderPrintoutTable(cols, state.printoutRows);
      renderPrintoutList(state.printoutRows);
      applyPrintoutMode();
    } catch (err) {
      els["printout-meta"].textContent = err.message || String(err);
    }
  }

  function closePrintout() {
    closePrintoutLine();
    els["printout-overlay"].hidden = true;
    document.body.classList.remove("projects-printout-open");
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
      closePhoneDetail();
      loadCatalogList();
    };
    els["cat-search-btn"].addEventListener("click", runCatSearch);
    els["cat-search"].addEventListener("keydown", (e) => {
      if (e.key === "Enter") runCatSearch();
    });
    els["cat-prev"].addEventListener("click", () => {
      if (state.catPage <= 1) return;
      state.catPage -= 1;
      state.catSelectedKey = null;
      closePhoneDetail();
      loadCatalogList();
    });
    els["cat-next"].addEventListener("click", () => {
      if (state.catPage * state.catPageSize >= state.catTotal) return;
      state.catPage += 1;
      state.catSelectedKey = null;
      closePhoneDetail();
      loadCatalogList();
    });
    els["cat-open-printout"].addEventListener("click", openPrintout);
    els["printout-close"].addEventListener("click", closePrintout);
    els["printout-line-close"]?.addEventListener("click", closePrintoutLine);
    els["printout-line-backdrop"]?.addEventListener("click", closePrintoutLine);
    els["printout-list"]?.addEventListener("click", (e) => {
      const row = e.target.closest(".dgs-prj-printout-row[data-idx]");
      if (!row) return;
      openPrintoutLine(Number(row.dataset.idx));
    });
    els["cat-detail-close"]?.addEventListener("click", closePhoneDetail);
    els["cat-detail-backdrop"]?.addEventListener("click", closePhoneDetail);

    const onCompactChange = () => {
      if (!els["printout-overlay"].hidden) applyPrintoutMode();
      if (!isCompact()) {
        closePhoneDetail();
        if (els["cat-detail-panel"]) els["cat-detail-panel"].setAttribute("aria-hidden", "false");
      } else if (!state.phoneDetailOpen && els["cat-detail-panel"]) {
        els["cat-detail-panel"].setAttribute("aria-hidden", "true");
      }
    };
    if (COMPACT_MQ.addEventListener) COMPACT_MQ.addEventListener("change", onCompactChange);
    else if (COMPACT_MQ.addListener) COMPACT_MQ.addListener(onCompactChange);
    onCompactChange();

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (document.body.classList.contains("projects-printout-line-open")) closePrintoutLine();
      else if (!els["printout-overlay"].hidden) closePrintout();
      else if (state.phoneDetailOpen) closePhoneDetail();
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
      };
    } catch (_err) {
      /* endpoint unavailable — leave all views enabled and let per-call 403s surface */
    }
    applyPermissionsToToggle();

    const deepCasino = (params.get("casino") || params.get("casino_id") || "").trim();
    if (deepCasino) state.catCasinoId = deepCasino;

    const requested = params.get("view");
    let view = ["calendar", "catalog"].includes(requested) ? requested : "calendar";
    if (deepCasino && state.permissions.catalog) view = "catalog";
    setView(view, { push: false });

    if (!firstAllowedView()) {
      showError("You do not have access to any Projects views. Ask an admin for dgs_projects_calendar / dgs_projects_catalog.");
    }
  }

  window.DGSProjects = { init };
})();
