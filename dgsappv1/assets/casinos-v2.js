(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  // Bootleaf uses Carto light_all for readable roads/labels; dark equivalent = Esri Dark Gray Canvas.
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

  const state = {
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    search: "",
    selectedKey: null,
    detail: null,
    map: null,
    mapMarker: null,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    perfNote: document.getElementById("perf-note"),
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
    heroId: document.getElementById("hero-id"),
    heroTitle: document.getElementById("hero-title"),
    heroLocation: document.getElementById("hero-location"),
    mapWrap: document.getElementById("map-wrap"),
    mapEl: document.getElementById("casino-map"),
    mapLink: document.getElementById("map-external-link"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
    detailFields: document.getElementById("detail-fields"),
    agreementFields: document.getElementById("agreement-fields"),
    contactFields: document.getElementById("contact-fields"),
  };

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

  function slotMasterHref(casinoId) {
    if (!casinoId) return "";
    if (window.DGS) {
      return DGS.withApi(`slot_master.html?casino=${encodeURIComponent(casinoId)}`);
    }
    const url = new URL("slot_master.html", window.location.href);
    url.searchParams.set("casino", casinoId);
    return url.pathname + url.search;
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

  function renderList() {
    els.tbody.innerHTML = state.items
      .map((row) => {
        const winCls = winIndexClass(row.win_index);
        return `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.selectedKey ? "selected" : ""}">
          <td class="mono">${esc(row.state_abbreviation || "—")}</td>
          <td>${esc(row.tribe_name || "—")}</td>
          <td>${esc(row.casino_name || row.casino_short || "—")}</td>
          <td class="num">${fmtNum(row.active_machines)}</td>
          <td class="num">${fmtAdw(row.avg_adw)}</td>
          <td class="num ${winCls}">${fmtWinIndex(row.win_index)}</td>
        </tr>`;
      })
      .join("");

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.total);
    const searchNote = state.search ? ` · matching “${state.search}”` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No casinos found${searchNote}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()}${searchNote}`;
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
    const tribe = d.tribe_name ? `${d.tribe_name}` : "";
    const addr = d.location_label || [d.address, d.city, d.zip].filter(Boolean).join(", ");
    if (tribe && addr) return `${tribe} · ${addr}`;
    return tribe || addr || d.reference_key || "—";
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
    if (!d?.has_map || d.latitude == null || d.longitude == null) {
      els.mapWrap.hidden = true;
      return;
    }

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
    const gmaps = `https://www.google.com/maps?q=${lat},${lon}`;
    els.mapLink.href = gmaps;

    try {
      state.map = L.map(els.mapEl, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      }).setView([lat, lon], 12);

      addDarkBasemap(state.map);

      state.mapMarker = L.marker([lat, lon], { icon: casinoMapPin() }).addTo(state.map);

      requestAnimationFrame(() => state.map?.invalidateSize());
    } catch (err) {
      console.warn("Casinos map render failed:", err);
      els.mapEl.textContent = "Map could not be rendered.";
    }
  }

  function renderDetailFields(d) {
    const slotLink =
      d.active_machines > 0
        ? `<a class="dgs-v2-hub-serial-link" href="${esc(slotMasterHref(d.reference_key))}">Slot Master (${fmtNum(d.active_machines)})</a>`
        : fmtNum(d.active_machines);

    els.detailFields.innerHTML = [
      field("Casino ID", d.reference_key),
      field("Name", d.casino_name),
      field("Short name", d.casino_short || "—"),
      field("Legal title", d.legal_title || "—"),
      field("Abbreviation", d.casino_abbreviation || "—"),
      field("Tribe", d.tribe_name || "—"),
      field("State", d.state ? `${d.state} (${d.state_abbreviation || "—"})` : d.state_abbreviation || "—"),
      field("Address", d.location_label || "—"),
      field("Sales", d.sales || "—"),
      field("eMaint property", d.emaint_property || "—"),
      field("Licensed", d.licensed),
      field("Machine count (record)", fmtNum(d.total_number_of_machines)),
      fieldHtml("Active machines", slotLink),
      field("Projects", fmtNum(d.project_count)),
      field("Main house ADW", fmtNum(d.main_house_average)),
      field("Smoking ADW", fmtNum(d.smoking_adw)),
      field("High limit ADW", fmtNum(d.high_limit_adw)),
      field("Updated", fmtDate(d.update_date)),
      field("Updated by", d.update_by || "—"),
    ].join("");

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

    setDetailEmpty(true);
    els.detailEmptyMsg.textContent = "Loading casino…";
    renderIdentity(null);
    renderPerformanceMetrics(null);
    destroyMap();
    els.mapWrap.hidden = true;
    els.heroTitle.textContent = "Loading…";

    try {
      state.detail = await fetchJson(`/api/commerce/casinos/${encodeURIComponent(referenceKey)}`);
      setDetailEmpty(false);
      renderDetailFields(state.detail);
      renderIdentity(state.detail);
      renderPerformanceMetrics(state.detail);
      renderMap(state.detail);
    } catch (err) {
      state.detail = null;
      setDetailEmpty(true);
      els.detailEmptyMsg.textContent = err.message || String(err);
      renderIdentity(null);
      renderPerformanceMetrics(null);
      destroyMap();
      els.mapWrap.hidden = true;
    }
  }

  async function loadList() {
    const q = encodeURIComponent(state.search);
    const path = `/api/commerce/casinos?q=${q}&page=${state.page}&page_size=${state.pageSize}`;
    const data = await fetchJson(path);
    state.items = data.items || [];
    state.total = data.total || 0;
    renderList();

    if (!state.selectedKey && state.items.length) {
      await openDetail(state.items[0].reference_key);
    }
  }

  async function init() {
    showError(null);
    els.tbody.innerHTML = `<tr><td colspan="6" class="dgs-v2-lines-status">Loading…</td></tr>`;
    renderPerformanceMetrics(null);
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
    loadList().catch((err) => showError(err.message || String(err)));
  }

  els.searchBtn.addEventListener("click", runSearch);
  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    state.selectedKey = null;
    loadList().catch((err) => showError(err.message || String(err)));
  });
  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  window.CasinosV2 = { init };
})();
