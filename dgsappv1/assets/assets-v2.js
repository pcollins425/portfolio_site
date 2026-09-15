(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const COMPACT_MQ = window.matchMedia("(max-width: 1366px)");

  const AssetNav = window.DGSAssetNav || {
    hubHref: () => "",
    hubLinkHtml: (_, label) => String(label ?? "—"),
    hubActionHtml: () => "",
    assetsActionHtml: () => "",
  };

  const state = {
    summary: null,
    items: [],
    fleet: [],
    page: 1,
    pageSize: 50,
    total: 0,
    search: "",
    selectedKey: null,
    detail: null,
    mediaUrls: {},
    prepStatusConfig: null,
    phoneDetailOpen: false,
    loadingMore: false,
  };

  let listGen = 0;

  const els = {
    errorBox: document.getElementById("error-box"),
    statTotal: document.getElementById("stat-total"),
    statProperties: document.getElementById("stat-properties"),
    statWithStatus: document.getElementById("stat-with-status"),
    statMissingLink: document.getElementById("stat-missing-link"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    fleetStrip: document.getElementById("fleet-strip"),
    gridWrap: document.querySelector(".dgs-v2-grid-wrap"),
    scrollSentinel: document.getElementById("assets-scroll-sentinel"),
    tbody: document.getElementById("assets-tbody"),
    listStatus: document.getElementById("list-status"),
    detailPanel: document.getElementById("detail-panel"),
    detailBackdrop: document.getElementById("assets-detail-backdrop"),
    detailBar: document.getElementById("detail-bar"),
    detailClose: document.getElementById("detail-close"),
    vendorLogo: document.getElementById("vendor-logo"),
    cabinetRow: document.getElementById("cabinet-row"),
    cardTitle: document.getElementById("card-title"),
    cardMeta: document.getElementById("card-meta"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
    detailFields: document.getElementById("detail-fields"),
    missingLinkWarn: document.getElementById("missing-link-warn"),
    assetNavActions: document.getElementById("asset-nav-actions"),
    prepActions: document.getElementById("prep-actions"),
    prepStatus: document.getElementById("prep-status"),
    prepHint: document.getElementById("prep-hint"),
  };

  function isCompact() {
    return COMPACT_MQ.matches;
  }

  function openPhoneDetail() {
    if (!isCompact() || !els.detailPanel) return;
    state.phoneDetailOpen = true;
    document.body.classList.add("assets-detail-open");
    els.detailPanel.classList.add("dgs-v2-detail--sheet");
    els.detailPanel.setAttribute("aria-hidden", "false");
    if (els.detailBackdrop) els.detailBackdrop.hidden = false;
    if (els.detailBar) els.detailBar.hidden = false;
  }

  function closePhoneDetail() {
    state.phoneDetailOpen = false;
    document.body.classList.remove("assets-detail-open");
    if (els.detailPanel) {
      els.detailPanel.classList.remove("dgs-v2-detail--sheet");
      if (isCompact()) els.detailPanel.setAttribute("aria-hidden", "true");
      else els.detailPanel.setAttribute("aria-hidden", "false");
    }
    if (els.detailBackdrop) els.detailBackdrop.hidden = true;
    if (els.detailBar) els.detailBar.hidden = true;
  }

  function syncCompactChrome() {
    document.body.classList.toggle("dgs-assets-compact", isCompact());
    if (!isCompact()) closePhoneDetail();
    else if (!state.phoneDetailOpen && els.detailPanel) {
      els.detailPanel.setAttribute("aria-hidden", "true");
    }
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchJson(path, options) {
    const headers = window.DGSAuth ? DGSAuth.authHeaders(options?.headers) : {};
    const res = await fetch(apiUrl(path), { ...options, headers });
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

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function canWriteAssets() {
    const user = window.DGSAuth ? DGSAuth.getUser() : null;
    if (!user) return true;
    const level = (user.permissions || {}).emaint_demo_compinfo;
    return level === "UPDATES_ONLY" || level === "ADDS_AND_UPDATES" || level === "ALL_CHANGES";
  }

  function revokeMediaUrls() {
    for (const url of Object.values(state.mediaUrls)) {
      if (url) URL.revokeObjectURL(url);
    }
    state.mediaUrls = {};
  }

  async function loadMediaUrl(relPath) {
    if (!relPath) return null;
    if (state.mediaUrls[relPath]) return state.mediaUrls[relPath];
    const headers = window.DGSAuth ? DGSAuth.authHeaders() : {};
    const res = await fetch(apiUrl(`/api/media/${encodeURIComponent(relPath)}`), { headers });
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    state.mediaUrls[relPath] = url;
    return url;
  }

  function placeholderBox(label) {
    return `<span class="placeholder">${esc(label)}</span>`;
  }

  async function renderImageCard(d) {
    if (!d) {
      els.vendorLogo.innerHTML = placeholderBox("Select an asset");
      els.cabinetRow.innerHTML = "";
      els.cardTitle.textContent = "—";
      els.cardMeta.textContent = "Search or pick a row";
      return;
    }

    const title = d.comp_desc || d.serial_no || d.compid || "Asset";
    els.cardTitle.textContent = title;
    const vendorLabel = d.vendor_name || d.manufac || "—";
    const cabLabel = d.cabinet_name || d.assettype || "—";
    els.cardMeta.textContent = `${vendorLabel} · ${cabLabel} · ${d.property || "—"}`;

    const logoPath = d.vendor_logo_media_path;
    if (logoPath) {
      const url = await loadMediaUrl(logoPath);
      els.vendorLogo.innerHTML = url
        ? `<img src="${url}" alt="${esc(vendorLabel)} logo" />`
        : placeholderBox(logoPath.split("/").pop());
    } else {
      els.vendorLogo.innerHTML = placeholderBox(vendorLabel);
    }

    const cabPath = d.cabinet_image_media_path;
    if (cabPath) {
      const url = await loadMediaUrl(cabPath);
      els.cabinetRow.innerHTML = url
        ? `<div class="dgs-v2-cabinet-thumb"><img src="${url}" alt="${esc(cabLabel)}" title="${esc(cabLabel)}" /></div>`
        : `<div class="dgs-v2-cabinet-thumb">${placeholderBox(cabLabel)}</div>`;
    } else {
      els.cabinetRow.innerHTML = `<div class="dgs-v2-cabinet-thumb">${placeholderBox(cabLabel)}</div>`;
    }
  }

  function renderSummary() {
    const s = state.summary;
    if (!s) return;
    els.statTotal.textContent = fmtNum(s.total);
    els.statProperties.textContent = fmtNum(s.properties);
    els.statWithStatus.textContent = fmtNum(s.with_status);
    els.statMissingLink.textContent = fmtNum(s.missing_asset_links);
  }

  function hasMore() {
    return state.items.length < state.total;
  }

  function renderFleet() {
    if (!els.fleetStrip) return;
    const rows = state.fleet || [];
    if (!state.search || !rows.length) {
      els.fleetStrip.hidden = true;
      els.fleetStrip.innerHTML = "";
      return;
    }
    els.fleetStrip.hidden = false;
    els.fleetStrip.innerHTML =
      `<div class="dgs-assets-fleet-head">How many · matching “${esc(state.search)}”</div>` +
      rows
        .map((f) => {
          const label = [f.vendor_name, f.cabinet_name].filter(Boolean).join(" · ");
          return `<div class="dgs-assets-fleet-row">
            <span class="dgs-assets-fleet-name">${esc(label)}</span>
            <span class="dgs-assets-fleet-counts">
              <span title="In warehouse / TBR">${fmtNum(f.in_warehouse)} WH</span>
              <span title="On floor (incl. active leases)">${fmtNum(f.on_floor)} floor</span>
              <span class="dgs-assets-fleet-total">${fmtNum(f.total)} total</span>
            </span>
          </div>`;
        })
        .join("");
  }

  function renderList() {
    if (!state.items.length) {
      els.tbody.innerHTML = `<tr><td colspan="4" class="dgs-v2-empty">No assets match this search.</td></tr>`;
    } else {
      els.tbody.innerHTML = state.items
        .map((row) => {
          const selected = row.compid === state.selectedKey ? " selected" : "";
          const title = row.comp_desc || row.serial_no || row.compid || "—";
          const serial = row.serial_no || "—";
          const metaBits = [
            row.property || null,
            row.status || null,
            [row.vendor_name, row.cabinet_name].filter(Boolean).join(" · ") || null,
          ].filter(Boolean);
          const serialCell = row.asset_id
            ? AssetNav.hubLinkHtml(row.asset_id, serial)
            : esc(serial);
          return `
          <tr data-key="${esc(row.compid)}" class="${selected.trim()}" tabindex="0">
            <td>
              <span class="dgs-assets-row-title">${esc(title)}</span>
              <span class="dgs-assets-row-meta">${esc(metaBits.join(" · ") || "—")}</span>
              <span class="dgs-assets-row-serial dgs-v2-phone-only mono">${serialCell}</span>
            </td>
            <td class="mono dgs-v2-col--desktop">${serialCell}</td>
            <td class="dgs-v2-col--desktop">${esc(row.property || "—")}</td>
            <td class="dgs-v2-col--desktop">${esc(row.status || "—")}</td>
          </tr>`;
        })
        .join("");
    }

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      const pick = () => openDetail(tr.dataset.key);
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      });
    });
    els.tbody.querySelectorAll("a.dgs-v2-hub-serial-link").forEach((link) => {
      link.addEventListener("click", (event) => event.stopPropagation());
    });

    const loaded = state.items.length;
    const noteBits = [];
    if (state.search) noteBits.push(`matching “${state.search}”`);
    if (state.loadingMore) noteBits.push("loading more");
    else if (hasMore()) noteBits.push("scroll for more");
    const note = noteBits.length ? ` · ${noteBits.join(" · ")}` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No assets found${note}.`
        : `Showing ${loaded.toLocaleString()} of ${state.total.toLocaleString()}${note}`;
    if (els.scrollSentinel) els.scrollSentinel.hidden = !hasMore();
  }

  function field(label, value) {
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
  }

  function fieldHtml(label, valueHtml) {
    return `<dt>${esc(label)}</dt><dd>${valueHtml}</dd>`;
  }

  function renderAssetNavActions(d) {
    if (!els.assetNavActions) return;
    if (!d || !d.asset_id) {
      els.assetNavActions.hidden = true;
      els.assetNavActions.innerHTML = "";
      return;
    }
    els.assetNavActions.hidden = false;
    els.assetNavActions.innerHTML = AssetNav.hubActionHtml(d.asset_id, "Open Asset hub →");
  }

  function renderDetailFields(d) {
    const missing = !d.asset_id;
    if (els.missingLinkWarn) {
      els.missingLinkWarn.hidden = !missing;
    }
    const refKeyHtml = d.asset_id
      ? AssetNav.hubLinkHtml(d.asset_id, d.asset_id)
      : "—";
    const zbl = [d.zone, d.bank, d.location].filter(Boolean).join(" · ") || "—";
    els.detailFields.innerHTML = [
      field("Serial", d.serial_no || "—"),
      fieldHtml("AST / ref", refKeyHtml),
      field("Property", d.property || "—"),
      field("Status", d.status || "—"),
      field("Vendor", d.vendor_name || d.manufac || "—"),
      field("Cabinet", d.cabinet_name || d.assettype || "—"),
      field("ZBL", zbl),
      field("Install", fmtDate(d.date_instl)),
      field("COMPINFO id", d.compid),
    ].join("");
  }

  function setPrepFeedback(msg, isError) {
    if (!els.prepStatus) return;
    els.prepStatus.textContent = msg || "";
    els.prepStatus.style.color = isError ? "#fca5a5" : "";
  }

  async function loadPrepStatusConfig() {
    if (state.prepStatusConfig) return state.prepStatusConfig;
    try {
      state.prepStatusConfig = await fetchJson("/api/emaint-demo/compinfo/prep-statuses");
    } catch (_err) {
      state.prepStatusConfig = null;
    }
    return state.prepStatusConfig;
  }

  function renderPrepActions(d) {
    if (!els.prepActions) return;
    els.prepActions.innerHTML = "";
    setPrepFeedback("");

    if (!d) return;

    if (!canWriteAssets()) {
      if (els.prepHint) {
        els.prepHint.textContent = "Read-only access — prep moves are not available.";
      }
      return;
    }

    if (els.prepHint) {
      els.prepHint.textContent = "Warehouse prep stage — updates eMaint status.";
    }

    if (!state.prepStatusConfig) {
      els.prepActions.innerHTML = `<span class="dgs-v2-lines-status">Loading prep options…</span>`;
      loadPrepStatusConfig().then(() => renderPrepActions(state.detail));
      return;
    }

    const current = (d.status || "").trim();
    const values = state.prepStatusConfig.values || [];
    if (!values.length) {
      els.prepActions.innerHTML = `<span class="dgs-v2-lines-status">No prep statuses configured.</span>`;
      return;
    }

    for (const item of values) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dgs-v2-btn";
      const label = item.button_label || item.status;
      const isCurrent = current && current.toLowerCase() === String(item.status).toLowerCase();
      if (isCurrent) {
        btn.classList.add("dgs-v2-btn--primary");
        btn.disabled = true;
        btn.textContent = `${label} (current)`;
      } else {
        btn.textContent = label;
        btn.addEventListener("click", () => applyPrepStatus(d.compid, item.status, label));
      }
      els.prepActions.appendChild(btn);
    }
  }

  async function applyPrepStatus(compid, status, label) {
    if (!compid) return;
    setPrepFeedback(`Setting status to ${label}…`);
    try {
      const out = await fetchJson("/api/emaint-demo/compinfo/prep-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compid: String(compid), status }),
      });
      const asset = out.asset || { compid, status };
      setPrepFeedback(`Status set to ${status} (eMaint + landing updated).`);
      if (state.detail && state.detail.compid === compid) {
        state.detail.status = asset.status || status;
        renderDetailFields(state.detail);
        renderPrepActions(state.detail);
      }
      await Promise.all([loadSummary(), loadList({ skipAutoSelect: true })]);
      if (state.selectedKey === compid) {
        state.detail = await fetchJson(`/api/assets/${encodeURIComponent(compid)}`);
        renderDetailFields(state.detail);
        renderPrepActions(state.detail);
        await renderImageCard(state.detail);
      }
    } catch (err) {
      setPrepFeedback(err.message || String(err), true);
    }
  }

  function setDetailEmpty(empty) {
    els.detailBody.classList.toggle("empty", empty);
    els.detailEmptyMsg.hidden = !empty;
    els.detailContent.hidden = empty;
    if (empty) {
      renderAssetNavActions(null);
      if (els.missingLinkWarn) els.missingLinkWarn.hidden = true;
    }
  }

  async function openDetail(compid) {
    state.selectedKey = compid;
    renderList();
    openPhoneDetail();

    setDetailEmpty(true);
    els.detailEmptyMsg.textContent = "Loading asset…";
    els.vendorLogo.innerHTML = placeholderBox("Loading…");
    els.cabinetRow.innerHTML = "";

    try {
      state.detail = await fetchJson(`/api/assets/${encodeURIComponent(compid)}`);
      setDetailEmpty(false);
      renderAssetNavActions(state.detail);
      renderDetailFields(state.detail);
      renderPrepActions(state.detail);
      await renderImageCard(state.detail);
    } catch (err) {
      state.detail = null;
      setDetailEmpty(true);
      els.detailEmptyMsg.textContent = err.message || String(err);
      await renderImageCard(null);
    }
  }

  async function loadSummary() {
    state.summary = await fetchJson("/api/assets/summary");
    renderSummary();
  }

  async function openDetailByAssetId(assetId) {
    const target = String(assetId || "").trim();
    if (!target) return;

    let match = state.items.find((row) => row.asset_id === target);
    if (match) {
      await openDetail(match.compid);
      return;
    }

    state.search = target;
    els.searchInput.value = target;
    state.page = 1;
    state.selectedKey = null;
    await loadList({ skipAutoSelect: true });
    match = state.items.find((row) => row.asset_id === target);
    if (match) {
      await openDetail(match.compid);
      return;
    }
    if (state.items.length === 1) {
      await openDetail(state.items[0].compid);
    }
  }

  async function loadList(options) {
    const append = !!(options && options.append);
    const skipAutoSelect = !!(options && options.skipAutoSelect);
    const gen = append ? listGen : ++listGen;
    if (!append) {
      state.page = 1;
      state.items = [];
      state.loadingMore = false;
    }

    const q = encodeURIComponent(state.search);
    const path = `/api/assets?q=${q}&page=${state.page}&page_size=${state.pageSize}`;
    const data = await fetchJson(path);
    if (gen !== listGen) return;

    const incoming = data.items || [];
    if (append) {
      const seen = new Set(state.items.map((r) => r.compid));
      for (const row of incoming) {
        if (row.compid && !seen.has(row.compid)) {
          seen.add(row.compid);
          state.items.push(row);
        }
      }
    } else {
      state.items = incoming;
      state.fleet = data.fleet || [];
      renderFleet();
    }
    state.total = data.total || 0;
    state.page = data.page || state.page;
    renderList();

    if (append) return;

    if (!skipAutoSelect && !state.selectedKey && state.items.length && !isCompact()) {
      await openDetail(state.items[0].compid);
    }
  }

  async function loadMore() {
    if (state.loadingMore || !hasMore()) return;
    state.loadingMore = true;
    const prevPage = state.page;
    state.page += 1;
    renderList();
    try {
      await loadList({ append: true });
    } catch (err) {
      state.page = prevPage;
      throw err;
    } finally {
      state.loadingMore = false;
      renderList();
    }
  }

  function runSearch() {
    state.search = els.searchInput.value.trim();
    state.page = 1;
    state.selectedKey = null;
    closePhoneDetail();
    revokeMediaUrls();
    loadList({ skipAutoSelect: true }).catch((err) => showError(err.message || String(err)));
  }

  async function init() {
    showError(null);
    syncCompactChrome();
    els.tbody.innerHTML = `<tr><td colspan="4" class="dgs-v2-lines-status">Loading…</td></tr>`;
    await loadPrepStatusConfig();
    if (window.DGS && typeof DGS.bindInfiniteScroll === "function") {
      DGS.bindInfiniteScroll(els.gridWrap, {
        sentinel: els.scrollSentinel,
        rootMargin: "280px",
        hasMore,
        isBusy: () => state.loadingMore,
        loadMore: () => loadMore().catch((err) => showError(err.message || String(err))),
      });
    }
    const params = new URLSearchParams(window.location.search);
    const deepAsset = (params.get("asset") || params.get("id") || "").trim();
    const deepCompid = (params.get("compid") || "").trim();
    try {
      await loadSummary();
      await loadList({ skipAutoSelect: !!(deepAsset || deepCompid) || isCompact() });
      if (deepCompid) {
        await openDetail(deepCompid);
      } else if (deepAsset) {
        await openDetailByAssetId(deepAsset);
      } else if (!isCompact() && !state.selectedKey && state.items.length) {
        await openDetail(state.items[0].compid);
      }
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    }
  }

  els.searchBtn.addEventListener("click", runSearch);
  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    runSearch();
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

  window.AssetsV2 = { init };
})();
