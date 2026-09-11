(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const MAP_ATTRIBUTION =
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, TomTom, Garmin, FAO, NOAA, USGS';

  function addDarkBasemap(map) {
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 16, attribution: MAP_ATTRIBUTION }
    ).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 16 }
    ).addTo(map);
  }

  function casinoMapPin() {
    return L.divIcon({
      className: "dgs-casino-map-pin",
      html:
        '<div class="dgs-casino-map-pin-wrap"><div class="dgs-casino-map-pin-halo"></div><div class="dgs-casino-map-pin-core"></div></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  const COMPACT_MQ = window.matchMedia("(max-width: 1366px)");

  const state = {
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    search: "",
    leaseFilter: "all",
    selectedKey: null,
    detail: null,
    map: null,
    mapMarker: null,
    phoneDetailOpen: false,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    pageSubtitle: document.getElementById("page-subtitle"),
    leaseFilter: document.getElementById("lease-filter"),
    perfNote: document.getElementById("perf-note"),
    statRow: document.getElementById("stat-row"),
    statAdw: document.getElementById("stat-adw"),
    statWinIndex: document.getElementById("stat-win-index"),
    statCommission: document.getElementById("stat-commission"),
    statAdwLabel: document.getElementById("stat-adw-label"),
    statWinLabel: document.getElementById("stat-win-label"),
    statCommLabel: document.getElementById("stat-comm-label"),
    statAdwSub: document.getElementById("stat-adw-sub"),
    statWinSub: document.getElementById("stat-win-sub"),
    statCommSub: document.getElementById("stat-comm-sub"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    tbody: document.getElementById("casinos-tbody"),
    listStatus: document.getElementById("list-status"),
    detailPanel: document.getElementById("detail-panel"),
    detailBackdrop: document.getElementById("casinos-detail-backdrop"),
    detailBar: document.getElementById("detail-bar"),
    detailClose: document.getElementById("detail-close"),
    heroId: document.getElementById("hero-id"),
    heroTitle: document.getElementById("hero-title"),
    heroLocation: document.getElementById("hero-location"),
    mapWrap: document.getElementById("map-wrap"),
    mapEmpty: document.getElementById("map-empty"),
    mapEl: document.getElementById("casino-map"),
    mapLink: document.getElementById("map-external-link"),
    slotMasterLink: document.getElementById("slot-master-link"),
    imsViewAll: document.getElementById("ims-view-all"),
    imsPreviewList: document.getElementById("ims-preview-list"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
    detailFields: document.getElementById("detail-fields"),
    agreementFields: document.getElementById("agreement-fields"),
    contactFields: document.getElementById("contact-fields"),
  };

  const bootParams = new URLSearchParams(window.location.search);
  let deepLinkHandled = false;

  function isCompact() {
    return COMPACT_MQ.matches;
  }

  function invalidateMapSize() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => state.map?.invalidateSize());
    });
  }

  function openPhoneDetail() {
    if (!isCompact() || !els.detailPanel) return;
    state.phoneDetailOpen = true;
    document.body.classList.add("casinos-detail-open");
    els.detailPanel.classList.add("dgs-v2-detail--sheet");
    els.detailPanel.setAttribute("aria-hidden", "false");
    if (els.detailBackdrop) els.detailBackdrop.hidden = false;
    if (els.detailBar) els.detailBar.hidden = false;
    invalidateMapSize();
  }

  function closePhoneDetail() {
    state.phoneDetailOpen = false;
    document.body.classList.remove("casinos-detail-open");
    if (els.detailPanel) {
      els.detailPanel.classList.remove("dgs-v2-detail--sheet");
      if (isCompact()) els.detailPanel.setAttribute("aria-hidden", "true");
      else els.detailPanel.setAttribute("aria-hidden", "false");
    }
    if (els.detailBackdrop) els.detailBackdrop.hidden = true;
    if (els.detailBar) els.detailBar.hidden = true;
  }

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
    const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function fmtMonth(iso) {
    if (!iso) return null;
    const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }

  function fmtNum(n, digits) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: digits ?? 0,
      maximumFractionDigits: digits ?? 0,
    });
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return `$${Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }

  function fmtAdw(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return `$${Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }

  function fmtWinIndex(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Number(n).toFixed(2);
  }

  function fmtPercent(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return `${Number(n).toFixed(1)}%`;
  }

  function winIndexClass(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "";
    if (Number(n) >= 1) return "dgs-v2-win-index--good";
    if (Number(n) >= 0.9) return "dgs-v2-win-index--warn";
    return "dgs-v2-win-index--muted";
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function pageUrl(path, query) {
    if (window.DGS && typeof DGS.withApi === "function") {
      const base = DGS.withApi(path);
      if (!query || !Object.keys(query).length) return base;
      const url = new URL(base, window.location.href);
      for (const [k, v] of Object.entries(query)) {
        if (v != null && String(v).trim() !== "") url.searchParams.set(k, String(v));
      }
      return url.pathname + url.search;
    }
    const url = new URL(path, window.location.href);
    for (const [k, v] of Object.entries(query || {})) {
      if (v != null && String(v).trim() !== "") url.searchParams.set(k, String(v));
    }
    return url.pathname + url.search;
  }

  function slotMasterHref(casinoId) {
    return pageUrl("slot_master.html", { casino: casinoId });
  }

  function projectsImsHref(casinoId) {
    return pageUrl("projects.html", { view: "ims", casino: casinoId });
  }

  function imsProjectHref(casinoId, project) {
    const catalog = project.matching_catalog;
    if (catalog?.reference_key) {
      const q = { view: "catalog", ref: catalog.reference_key };
      if ((catalog.line_count || 0) > 0) q.printout = "1";
      return pageUrl("projects.html", q);
    }
    return pageUrl("projects.html", { view: "ims", casino: casinoId, ims: project.reference_key });
  }

  function performanceFromDetail(d) {
    return d?.performance || null;
  }

  function renderPerformanceMetrics(d) {
    const perf = performanceFromDetail(d);
    const month = perf?.month ? fmtMonth(perf.month) : null;
    const monthSuffix = month ? ` · ${month}` : "";

    els.statAdwLabel.textContent = `Avg ADW${monthSuffix}`;
    els.statWinLabel.textContent = `Avg Win Index${monthSuffix}`;
    els.statCommLabel.textContent = `Sum Commission${monthSuffix}`;

    els.statAdw.textContent = perf ? fmtAdw(perf.avg_adw) : "—";
    els.statWinIndex.textContent = perf ? fmtWinIndex(perf.avg_win_index) : "—";
    els.statWinIndex.className = `dgs-v2-metric-value ${winIndexClass(perf?.avg_win_index)}`;
    els.statCommission.textContent = perf ? fmtMoney(perf.sum_commission) : "—";

    els.statAdwSub.textContent = "per machine / day";
    els.statWinSub.textContent = "vs par 1.00";
    els.statCommSub.textContent = perf
      ? `${fmtNum(perf.machine_count)} machines with revenue`
      : "No recent performance";

    if (!d) {
      els.perfNote.textContent = "Select a casino for metrics";
    } else if (perf) {
      els.perfNote.textContent = `${d.casino_name || d.reference_key} · ${month || "latest month"}`;
    } else {
      els.perfNote.textContent = `${d.casino_name || d.reference_key} · no linked revenue yet`;
    }
  }

  function casinoRowHtml(row) {
    const winCls = winIndexClass(row.win_index);
    const actCls = winIndexClass(row.actual_index);
    return `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.selectedKey ? "selected" : ""}">
          <td class="mono dgs-v2-col--desktop">${esc(row.state_abbreviation || "—")}</td>
          <td class="dgs-v2-col--desktop">${esc(row.tribe_name || "—")}</td>
          <td>${esc(row.casino_name || row.casino_short || "—")}</td>
          <td class="num">${fmtNum(row.active_machines)}</td>
          <td class="mono dgs-v2-col--desktop">${esc(fmtMonth(row.last_report) || "—")}</td>
          <td class="num dgs-v2-col--desktop">${fmtAdw(row.cipd)}</td>
          <td class="num dgs-v2-col--desktop">${fmtAdw(row.tdw)}</td>
          <td class="num dgs-v2-col--desktop">${fmtAdw(row.avg_adw)}</td>
          <td class="num ${winCls}">${fmtWinIndex(row.win_index)}</td>
          <td class="num ${actCls}">${fmtWinIndex(row.actual_index)}</td>
        </tr>`;
  }

  function renderList() {
    if (!state.items.length) {
      els.tbody.innerHTML = "";
    } else if (!isCompact()) {
      els.tbody.innerHTML = state.items.map(casinoRowHtml).join("");
    } else {
      const sorted = [...state.items].sort((a, b) => {
        const sa = String(a.state_abbreviation || "—");
        const sb = String(b.state_abbreviation || "—");
        if (sa !== sb) return sa.localeCompare(sb);
        const ta = String(a.tribe_name || "—");
        const tb = String(b.tribe_name || "—");
        if (ta !== tb) return ta.localeCompare(tb);
        return String(a.casino_name || a.casino_short || "").localeCompare(
          String(b.casino_name || b.casino_short || "")
        );
      });
      const parts = [];
      let lastState = null;
      let lastTribe = null;
      for (const row of sorted) {
        const st = row.state_abbreviation || "—";
        const tribe = row.tribe_name || "—";
        if (st !== lastState) {
          parts.push(
            `<tr class="dgs-v2-group-row dgs-v2-group-row--state" aria-hidden="true"><td colspan="10">${esc(st)}</td></tr>`
          );
          lastState = st;
          lastTribe = null;
        }
        if (tribe !== lastTribe) {
          parts.push(
            `<tr class="dgs-v2-group-row dgs-v2-group-row--tribe" aria-hidden="true"><td colspan="10">${esc(tribe)}</td></tr>`
          );
          lastTribe = tribe;
        }
        parts.push(casinoRowHtml(row));
      }
      els.tbody.innerHTML = parts.join("");
    }

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.total);
    const noteBits = [];
    if (state.search) noteBits.push(`matching “${state.search}”`);
    if (state.leaseFilter === "leased") noteBits.push("leased only");
    if (state.leaseFilter === "prospecting") noteBits.push("prospecting only");
    const note = noteBits.length ? ` · ${noteBits.join(" · ")}` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No casinos found${note}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()}${note}`;
  }

  function field(label, value) {
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
  }

  function fieldHtml(label, html) {
    return `<dt>${esc(label)}</dt><dd>${html}</dd>`;
  }

  function contactField(name, email) {
    if (!name && !email) return field("—", "—");
    const label = name || email;
    const value = name && email ? `${name} · ${email}` : name || email;
    return field(label, value);
  }

  function locationLine(d) {
    const addr = d.location_label || [d.address, d.city, d.zip].filter(Boolean).join(", ");
    return addr || d.reference_key || "—";
  }

  function renderIdentity(d) {
    if (!d) {
      els.heroId.textContent = "—";
      els.heroTitle.textContent = "Select a casino";
      els.heroLocation.textContent = "Choose a row from the list";
      return;
    }
    const stateAbbr = d.state_abbreviation || d.state || "—";
    els.heroId.textContent = `${stateAbbr} · ${d.reference_key}`;
    els.heroTitle.textContent = d.casino_name || d.casino_short || d.reference_key;
    els.heroLocation.textContent = locationLine(d);
  }

  function destroyMap() {
    if (state.map) {
      state.map.remove();
      state.map = null;
      state.mapMarker = null;
    }
  }

  function renderMap(d) {
    destroyMap();
    if (!d) {
      els.mapWrap.hidden = true;
      if (els.mapEmpty) els.mapEmpty.hidden = true;
      return;
    }
    if (!d.has_map || d.latitude == null || d.longitude == null) {
      els.mapWrap.hidden = true;
      if (els.mapEmpty) els.mapEmpty.hidden = false;
      return;
    }
    if (els.mapEmpty) els.mapEmpty.hidden = true;

    if (typeof window.L === "undefined") {
      els.mapWrap.hidden = false;
      els.mapEl.innerHTML = "";
      els.mapEl.textContent = "Map unavailable (Leaflet failed to load).";
      els.mapLink.href = `https://www.google.com/maps?q=${Number(d.latitude)},${Number(d.longitude)}`;
      return;
    }

    els.mapWrap.hidden = false;
    els.mapEl.innerHTML = "";
    const lat = Number(d.latitude);
    const lon = Number(d.longitude);
    els.mapLink.href = `https://www.google.com/maps?q=${lat},${lon}`;

    try {
      state.map = L.map(els.mapEl, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      }).setView([lat, lon], 12);

      addDarkBasemap(state.map);
      state.mapMarker = L.marker([lat, lon], { icon: casinoMapPin() }).addTo(state.map);
      invalidateMapSize();
    } catch (err) {
      console.warn("Casinos map render failed:", err);
      els.mapEl.textContent = "Map could not be rendered.";
    }
  }

  function tribeFieldHtml(d) {
    const tribe = esc(d.tribe_name || "—");
    const sisters = Array.isArray(d.sister_casinos) ? d.sister_casinos : [];
    if (!sisters.length) return tribe;
    const chips = sisters
      .map((s) => {
        const name = s.casino_name || s.casino_short || s.reference_key;
        const stateAbbr = s.state_abbreviation ? `${s.state_abbreviation} · ` : "";
        return `<button type="button" class="dgs-v2-casino-sister" data-sister="${esc(s.reference_key)}">${esc(
          stateAbbr + name
        )}</button>`;
      })
      .join("");
    return `<div class="dgs-v2-casino-tribe-block"><div>${tribe}</div><div class="dgs-v2-casino-sister-list">${chips}</div></div>`;
  }

  function renderActions(d) {
    if (!els.slotMasterLink) return;
    if (!d) {
      els.slotMasterLink.href = "#";
      els.slotMasterLink.textContent = "Slot Master";
      return;
    }
    const n = Number(d.active_machines) || 0;
    els.slotMasterLink.href = slotMasterHref(d.reference_key);
    els.slotMasterLink.textContent = n ? `Slot Master (${fmtNum(n)})` : "Slot Master";
  }

  function renderImsPreview(d) {
    if (!els.imsPreviewList || !els.imsViewAll) return;
    if (!d) {
      els.imsPreviewList.innerHTML = "";
      els.imsViewAll.href = "#";
      els.imsViewAll.textContent = "View all";
      return;
    }

    const total = Number(d.project_count) || 0;
    els.imsViewAll.href = projectsImsHref(d.reference_key);
    els.imsViewAll.textContent = total ? `View all (${fmtNum(total)})` : "View all";

    const rows = Array.isArray(d.ims_projects) ? d.ims_projects : [];
    if (!rows.length) {
      els.imsPreviewList.innerHTML = `<p class="dgs-v2-lines-status">No IMS projects for this casino.</p>`;
      return;
    }

    els.imsPreviewList.innerHTML = rows
      .map((p) => {
        const title = p.project_no || p.reference_key || "Project";
        const dates = [p.date_start ? fmtDate(p.date_start) : "", p.date_end ? fmtDate(p.date_end) : ""]
          .filter(Boolean)
          .join(" – ");
        const badge = p.matching_catalog
          ? `<span class="dgs-prj-badge">Details Available</span>`
          : "";
        return `
          <a class="dgs-v2-casino-ims-row" href="${esc(imsProjectHref(d.reference_key, p))}">
            <div class="dgs-v2-casino-ims-row-top">
              <span class="dgs-v2-casino-ims-title">${esc(title)}</span>
              ${badge}
            </div>
            <div class="dgs-v2-casino-ims-meta">${esc([p.status, dates].filter(Boolean).join(" · "))}</div>
            <div class="dgs-v2-casino-ims-desc">${esc(p.proj_desc || "")}</div>
          </a>`;
      })
      .join("");
  }

  function renderDetailFields(d) {
    els.detailFields.innerHTML = [
      field("Casino Name", d.casino_name || d.casino_short || "—"),
      fieldHtml("Tribe", tribeFieldHtml(d)),
      field("House Average", fmtNum(d.main_house_average)),
      field("Total Floor Count", fmtNum(d.total_number_of_machines)),
      field("DGS Floor Percent", fmtPercent(d.dgs_floor_percent)),
      field("Available Vendors", d.available_vendors || "—"),
      field("Sales", d.sales || "—"),
    ].join("");

    els.detailFields.querySelectorAll("[data-sister]").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.sister));
    });

    els.agreementFields.innerHTML = [
      field("Master agreement", d.signed_master_agreement),
      field("Agreement type", d.agreement_type || "—"),
      field("Executed", fmtDate(d.executed_on)),
      field("Expiration", fmtDate(d.expiration)),
      field("Loss passed", d.loss_passed),
    ].join("");

    els.contactFields.innerHTML = [
      contactField("General manager", d.general_manager_name, d.general_manager_email),
      contactField("Slot director", d.slot_director_name, d.slot_director_email),
      contactField("Accounting", d.accounting_name, d.accounting_email),
    ].join("");
  }

  function setDetailEmpty(empty) {
    els.detailBody.classList.toggle("empty", empty);
    els.detailEmptyMsg.hidden = !empty;
    els.detailContent.hidden = empty;
  }

  async function openDetail(referenceKey) {
    state.selectedKey = referenceKey;
    renderList();
    if (isCompact()) openPhoneDetail();

    setDetailEmpty(true);
    els.detailEmptyMsg.textContent = "Loading casino…";
    renderIdentity(null);
    renderPerformanceMetrics(null);
    renderActions(null);
    renderImsPreview(null);
    destroyMap();
    els.mapWrap.hidden = true;
    if (els.mapEmpty) els.mapEmpty.hidden = true;
    els.heroTitle.textContent = "Loading…";

    try {
      state.detail = await fetchJson(`/api/commerce/casinos/${encodeURIComponent(referenceKey)}`);
      setDetailEmpty(false);
      renderDetailFields(state.detail);
      renderIdentity(state.detail);
      renderPerformanceMetrics(state.detail);
      renderActions(state.detail);
      renderImsPreview(state.detail);
      renderMap(state.detail);
      const u = new URL(window.location.href);
      u.searchParams.set("id", referenceKey);
      window.history.replaceState({}, "", u.pathname + u.search);
    } catch (err) {
      state.detail = null;
      setDetailEmpty(true);
      els.detailEmptyMsg.textContent = err.message || String(err);
      renderIdentity(null);
      renderPerformanceMetrics(null);
      renderActions(null);
      renderImsPreview(null);
      destroyMap();
      els.mapWrap.hidden = true;
      if (els.mapEmpty) els.mapEmpty.hidden = true;
    }
  }

  function setLeaseFilter(filter, { push = true } = {}) {
    const next = ["all", "leased", "prospecting"].includes(filter) ? filter : "all";
    state.leaseFilter = next;
    if (els.leaseFilter) {
      for (const btn of els.leaseFilter.querySelectorAll("button[data-filter]")) {
        btn.classList.toggle("active", btn.dataset.filter === next);
      }
    }
    const subtitles = {
      all: "All casinos · latest Master_Revenue month",
      leased: "Casinos with installed leased cabinets (Sold excluded)",
      prospecting: "Casinos without installed leased cabinets",
    };
    if (els.pageSubtitle) els.pageSubtitle.textContent = subtitles[next] || subtitles.all;
    if (push) {
      const u = new URL(window.location.href);
      if (next === "all") u.searchParams.delete("filter");
      else u.searchParams.set("filter", next);
      window.history.replaceState({}, "", u.pathname + u.search);
    }
  }

  async function loadList() {
    const q = encodeURIComponent(state.search);
    const filt = encodeURIComponent(state.leaseFilter || "all");
    const path = `/api/commerce/casinos?q=${q}&lease_filter=${filt}&page=${state.page}&page_size=${state.pageSize}`;
    const data = await fetchJson(path);
    state.items = data.items || [];
    state.total = data.total || 0;
    renderList();

    const deepId = !deepLinkHandled
      ? (bootParams.get("id") || bootParams.get("casino") || "").trim()
      : "";
    if (deepId) {
      deepLinkHandled = true;
      await openDetail(deepId);
      return;
    }

    // Compact: list-only until tap. Desktop: auto-open first row.
    if (isCompact()) {
      if (state.selectedKey && !state.items.some((r) => r.reference_key === state.selectedKey)) {
        state.selectedKey = null;
        closePhoneDetail();
        setDetailEmpty(true);
        els.detailEmptyMsg.textContent = "Select a casino to view profile and contacts.";
        renderIdentity(null);
        renderPerformanceMetrics(null);
        renderActions(null);
        renderImsPreview(null);
        destroyMap();
      }
      return;
    }

    if (!state.selectedKey && state.items.length) {
      await openDetail(state.items[0].reference_key);
    } else if (state.selectedKey && !state.items.some((r) => r.reference_key === state.selectedKey)) {
      state.selectedKey = null;
      if (state.items.length) await openDetail(state.items[0].reference_key);
      else {
        setDetailEmpty(true);
        els.detailEmptyMsg.textContent = "No casinos in this filter.";
        renderIdentity(null);
        renderPerformanceMetrics(null);
        renderActions(null);
        renderImsPreview(null);
        destroyMap();
        if (els.mapWrap) els.mapWrap.hidden = true;
        if (els.mapEmpty) els.mapEmpty.hidden = true;
      }
    }
  }

  function syncCompactChrome() {
    if (!isCompact()) {
      closePhoneDetail();
      if (els.detailPanel) els.detailPanel.setAttribute("aria-hidden", "false");
    } else if (!state.phoneDetailOpen && els.detailPanel) {
      els.detailPanel.setAttribute("aria-hidden", "true");
    }
    renderList();
    invalidateMapSize();
  }

  async function init() {
    showError(null);
    const requested = (bootParams.get("filter") || bootParams.get("lease_filter") || "all").trim().toLowerCase();
    setLeaseFilter(requested, { push: false });
    els.tbody.innerHTML = `<tr><td colspan="10" class="dgs-v2-lines-status">Loading…</td></tr>`;
    renderPerformanceMetrics(null);
    syncCompactChrome();
    try {
      await loadList();
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    }
  }

  function runSearch() {
    state.search = els.searchInput.value.trim();
    state.page = 1;
    state.selectedKey = null;
    closePhoneDetail();
    loadList().catch((err) => showError(err.message || String(err)));
  }

  els.leaseFilter?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-filter]");
    if (!btn) return;
    setLeaseFilter(btn.dataset.filter);
    state.page = 1;
    state.selectedKey = null;
    closePhoneDetail();
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.searchBtn.addEventListener("click", runSearch);
  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    state.selectedKey = null;
    closePhoneDetail();
    loadList().catch((err) => showError(err.message || String(err)));
  });
  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  els.detailClose?.addEventListener("click", closePhoneDetail);
  els.detailBackdrop?.addEventListener("click", closePhoneDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.phoneDetailOpen) closePhoneDetail();
  });
  if (COMPACT_MQ.addEventListener) COMPACT_MQ.addEventListener("change", syncCompactChrome);
  else if (COMPACT_MQ.addListener) COMPACT_MQ.addListener(syncCompactChrome);

  window.CasinosV2 = { init };
})();
