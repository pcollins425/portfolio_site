(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const AssetNav = window.DGSAssetNav || {
    hubHref: () => "",
    hubLinkHtml: (_, label) => String(label ?? "—"),
    hubActionHtml: () => "",
    assetsActionHtml: () => "",
  };

  const state = {
    summary: null,
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    search: "",
    selectedKey: null,
    detail: null,
    mediaUrls: {},
    prepStatusConfig: null,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    statTotal: document.getElementById("stat-total"),
    statProperties: document.getElementById("stat-properties"),
    statWithStatus: document.getElementById("stat-with-status"),
    statMissingLink: document.getElementById("stat-missing-link"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    tbody: document.getElementById("assets-tbody"),
    listStatus: document.getElementById("list-status"),
    vendorLogo: document.getElementById("vendor-logo"),
    cabinetRow: document.getElementById("cabinet-row"),
    cardTitle: document.getElementById("card-title"),
    cardMeta: document.getElementById("card-meta"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
    detailFields: document.getElementById("detail-fields"),
    assetNavActions: document.getElementById("asset-nav-actions"),
    prepActions: document.getElementById("prep-actions"),
    prepStatus: document.getElementById("prep-status"),
    prepHint: document.getElementById("prep-hint"),
  };

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
      els.cardMeta.textContent = "Choose a row from the list";
      return;
    }

    const title = d.comp_desc || d.compid || "Asset";
    els.cardTitle.textContent = title;
    const vendorLabel = d.vendor_name || d.manufac || "—";
    const cabLabel = d.cabinet_name || d.assettype || "—";
    els.cardMeta.textContent = `${vendorLabel} · ${d.serial_no || "no serial"} · ${d.property || "—"}`;

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
      els.cabinetRow.innerHTML = cabPath === undefined ? "" : `<div class="dgs-v2-cabinet-thumb">${placeholderBox(cabLabel)}</div>`;
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

  function renderList() {
    els.tbody.innerHTML = state.items
      .map((row) => {
        const serialCell = row.asset_id
          ? AssetNav.hubLinkHtml(row.asset_id, row.serial_no || row.asset_id)
          : esc(row.serial_no || "—");
        return `
        <tr data-key="${esc(row.compid)}" class="${row.compid === state.selectedKey ? "selected" : ""}">
          <td class="mono">${esc(row.compid)}</td>
          <td class="mono">${serialCell}</td>
          <td>${esc(row.comp_desc || "—")}</td>
          <td>${esc(row.property || "—")}</td>
          <td>${esc(row.status || "—")}</td>
        </tr>`;
      })
      .join("");

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });
    els.tbody.querySelectorAll("a.dgs-v2-hub-serial-link").forEach((link) => {
      link.addEventListener("click", (event) => event.stopPropagation());
    });

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.total);
    const searchNote = state.search ? ` · matching “${state.search}”` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No assets found${searchNote}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()}${searchNote}`;
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
    els.assetNavActions.innerHTML = AssetNav.hubActionHtml(d.asset_id);
  }

  function renderDetailFields(d) {
    const refKeyHtml = d.asset_id
      ? AssetNav.hubLinkHtml(d.asset_id, d.asset_id)
      : "—";
    els.detailFields.innerHTML = [
      field("Asset ID", d.compid),
      fieldHtml("Reference key", refKeyHtml),
      field("Serial", d.serial_no || "—"),
      field("Status", d.status || "—"),
      field("Game title", d.comp_desc || "—"),
      field("Vendor", d.vendor_name || d.manufac || "—"),
      field("Cabinet", d.cabinet_name || d.assettype || "—"),
      field("Model", d.model_no || "—"),
      field("Property", d.property || "—"),
      field("Zone / bank / loc", [d.zone, d.bank, d.location].filter(Boolean).join(" · ") || "—"),
      field("Class", d.class || "—"),
      field("Install date", fmtDate(d.date_instl)),
      field("Go live", fmtDate(d.golive001)),
      field("Removal", fmtDate(d.rmvl_date)),
      field("Denom / bet", [d.denom, d.bet_line].filter(Boolean).join(" · ") || "—"),
      field("Paytable / media", [d.paytable, d.prog_media].filter(Boolean).join(" · ") || "—"),
      field("Comments", d.comment || "—"),
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
      await Promise.all([loadSummary(), loadList()]);
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
    }
  }

  async function openDetail(compid) {
    state.selectedKey = compid;
    renderList();

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
    const skipAutoSelect = options && options.skipAutoSelect;
    const q = encodeURIComponent(state.search);
    const path = `/api/assets?q=${q}&page=${state.page}&page_size=${state.pageSize}`;
    const data = await fetchJson(path);
    state.items = data.items || [];
    state.total = data.total || 0;
    renderList();

    if (!skipAutoSelect && !state.selectedKey && state.items.length) {
      await openDetail(state.items[0].compid);
    }
  }

  async function init() {
    showError(null);
    els.tbody.innerHTML = `<tr><td colspan="5" class="dgs-v2-lines-status">Loading…</td></tr>`;
    await loadPrepStatusConfig();
    const params = new URLSearchParams(window.location.search);
    const deepAsset = (params.get("asset") || params.get("id") || "").trim();
    const deepCompid = (params.get("compid") || "").trim();
    try {
      await loadSummary();
      await loadList({ skipAutoSelect: !!(deepAsset || deepCompid) });
      if (deepCompid) {
        await openDetail(deepCompid);
      } else if (deepAsset) {
        await openDetailByAssetId(deepAsset);
      } else if (!state.selectedKey && state.items.length) {
        await openDetail(state.items[0].compid);
      }
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    }
  }

  els.searchBtn.addEventListener("click", () => {
    state.search = els.searchInput.value.trim();
    state.page = 1;
    state.selectedKey = null;
    revokeMediaUrls();
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    state.selectedKey = null;
    revokeMediaUrls();
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.search = els.searchInput.value.trim();
      state.page = 1;
      state.selectedKey = null;
      revokeMediaUrls();
      loadList().catch((err) => showError(err.message || String(err)));
    }
  });

  window.AssetsV2 = { init };
})();
