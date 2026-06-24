(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

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
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    statTotal: document.getElementById("stat-total"),
    statManufacturers: document.getElementById("stat-manufacturers"),
    statWithLogo: document.getElementById("stat-with-logo"),
    statCabinets: document.getElementById("stat-cabinets"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    tbody: document.getElementById("vendors-tbody"),
    listStatus: document.getElementById("list-status"),
    vendorLogo: document.getElementById("vendor-logo"),
    cabinetRow: document.getElementById("cabinet-row"),
    cardTitle: document.getElementById("card-title"),
    cardMeta: document.getElementById("card-meta"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
    detailFields: document.getElementById("detail-fields"),
    cabinetsTbody: document.getElementById("cabinets-tbody"),
    cabinetsStatus: document.getElementById("cabinets-status"),
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

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
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

  function renderSummary() {
    const s = state.summary;
    if (!s) return;
    els.statTotal.textContent = fmtNum(s.total);
    els.statManufacturers.textContent = fmtNum(s.manufacturers);
    els.statWithLogo.textContent = fmtNum(s.with_logo);
    els.statCabinets.textContent = fmtNum(s.cabinets);
  }

  function renderList() {
    els.tbody.innerHTML = state.items
      .map(
        (row) => `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.selectedKey ? "selected" : ""}">
          <td class="mono">${esc(row.reference_key)}</td>
          <td>${esc(row.vendor_name || "—")}</td>
          <td>${row.is_manufacturer ? "Yes" : "—"}</td>
          <td>${fmtNum(row.cabinet_count)}</td>
          <td>${fmtNum(row.theme_count)}</td>
        </tr>`
      )
      .join("");

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.total);
    const searchNote = state.search ? ` · matching “${state.search}”` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No vendors found${searchNote}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()}${searchNote}`;
  }

  function field(label, value) {
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
  }

  function renderDetailFields(d) {
    els.detailFields.innerHTML = [
      field("Vendor ID", d.reference_key),
      field("Name", d.vendor_name),
      field("Manufacturer", d.is_manufacturer ? "Yes" : "No"),
      field("Contracts", fmtNum(d.contract_count)),
      field("Assets", fmtNum(d.asset_count)),
      field("Updated", fmtDate(d.update_date)),
      field("Updated by", d.update_by || "—"),
    ].join("");
  }

  function renderCabinets(d) {
    const cabinets = d.cabinets || [];
    if (!cabinets.length) {
      els.cabinetsTbody.innerHTML = "";
      els.cabinetsStatus.textContent = "No cabinets on file for this vendor.";
      return;
    }
    els.cabinetsTbody.innerHTML = cabinets
      .map(
        (c) => `
        <tr>
          <td>${esc(c.cabinet_name || "—")}</td>
          <td>${esc(c.version_name || "—")}</td>
          <td>${fmtNum(c.theme_count)}</td>
        </tr>`
      )
      .join("");
    els.cabinetsStatus.textContent =
      cabinets.length >= 50 ? "Showing first 50 cabinets." : `${cabinets.length.toLocaleString()} cabinet(s).`;
  }

  async function renderImageCard(d) {
    if (!d) {
      els.vendorLogo.innerHTML = placeholderBox("Select a vendor");
      els.cabinetRow.innerHTML = "";
      els.cardTitle.textContent = "—";
      els.cardMeta.textContent = "Choose a row from the list";
      return;
    }

    const title = d.vendor_name || d.reference_key || "Vendor";
    els.cardTitle.textContent = title;
    els.cardMeta.textContent = `${d.reference_key} · ${fmtNum(d.cabinets?.length || 0)} cabinets · ${d.is_manufacturer ? "Manufacturer" : "Vendor"}`;

    const logoPath = d.logo_media_path;
    if (logoPath) {
      const url = await loadMediaUrl(logoPath);
      els.vendorLogo.innerHTML = url
        ? `<img src="${url}" alt="${esc(title)} logo" />`
        : placeholderBox(logoPath.split("/").pop());
    } else {
      els.vendorLogo.innerHTML = placeholderBox(title);
    }

    const thumbs = (d.cabinets || []).slice(0, 6);
    if (!thumbs.length) {
      els.cabinetRow.innerHTML = "";
      return;
    }
    const parts = await Promise.all(
      thumbs.map(async (c) => {
        const label = c.cabinet_name || c.reference_key;
        if (c.image_media_path) {
          const url = await loadMediaUrl(c.image_media_path);
          if (url) {
            return `<div class="dgs-v2-cabinet-thumb"><img src="${url}" alt="${esc(label)}" title="${esc(label)}" /></div>`;
          }
        }
        return `<div class="dgs-v2-cabinet-thumb">${placeholderBox(label)}</div>`;
      })
    );
    els.cabinetRow.innerHTML = parts.join("");
  }

  function setDetailEmpty(empty) {
    els.detailBody.classList.toggle("empty", empty);
    els.detailEmptyMsg.hidden = !empty;
    els.detailContent.hidden = empty;
  }

  async function openDetail(referenceKey) {
    state.selectedKey = referenceKey;
    revokeMediaUrls();
    renderList();

    setDetailEmpty(true);
    els.detailEmptyMsg.textContent = "Loading vendor…";
    els.vendorLogo.innerHTML = placeholderBox("Loading…");
    els.cabinetRow.innerHTML = "";

    try {
      state.detail = await fetchJson(`/api/commerce/vendors/${encodeURIComponent(referenceKey)}`);
      setDetailEmpty(false);
      renderDetailFields(state.detail);
      renderCabinets(state.detail);
      await renderImageCard(state.detail);
    } catch (err) {
      state.detail = null;
      setDetailEmpty(true);
      els.detailEmptyMsg.textContent = err.message || String(err);
      await renderImageCard(null);
      els.cabinetsTbody.innerHTML = "";
      els.cabinetsStatus.textContent = "";
    }
  }

  async function loadSummary() {
    state.summary = await fetchJson("/api/commerce/vendors/summary");
    renderSummary();
  }

  async function loadList() {
    const q = encodeURIComponent(state.search);
    const path = `/api/commerce/vendors?q=${q}&page=${state.page}&page_size=${state.pageSize}`;
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
    els.tbody.innerHTML = `<tr><td colspan="5" class="dgs-v2-lines-status">Loading…</td></tr>`;
    try {
      await Promise.all([loadSummary(), loadList()]);
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    }
  }

  function runSearch() {
    state.search = els.searchInput.value.trim();
    state.page = 1;
    state.selectedKey = null;
    revokeMediaUrls();
    loadList().catch((err) => showError(err.message || String(err)));
  }

  els.searchBtn.addEventListener("click", runSearch);
  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    state.selectedKey = null;
    revokeMediaUrls();
    loadList().catch((err) => showError(err.message || String(err)));
  });
  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  window.VendorsV2 = { init };
})();
