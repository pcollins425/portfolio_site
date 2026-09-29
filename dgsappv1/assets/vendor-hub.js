(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const params = new URLSearchParams(window.location.search);
  const vendorId = (params.get("id") || "").trim();

  const state = {
    mediaUrls: {},
    data: null,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    hubBody: document.getElementById("hub-body"),
    hubLoading: document.getElementById("hub-loading"),
    hubGrid: document.getElementById("hub-grid"),
    hubLogo: document.getElementById("hub-logo"),
    captionTitle: document.getElementById("caption-title"),
    captionId: document.getElementById("caption-id"),
    captionMeta: document.getElementById("caption-meta"),
    btnBack: document.getElementById("btn-back"),
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function pageUrl(path, extra) {
    const base = window.DGS ? DGS.withApi(path) : path;
    const url = new URL(base, window.location.href);
    for (const [key, value] of Object.entries(extra || {})) {
      if (value != null && String(value).trim() !== "") url.searchParams.set(key, String(value));
    }
    return url.pathname + url.search;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function themeList(themes) {
    if (!themes.length) return `<p class="dgs-v2-lines-status">No themes on file.</p>`;
    return `<div class="vh-themes">${themes
      .map((theme) => {
        const id = theme.reference_key;
        const label = theme.theme_name || id || "Theme";
        if (!id) return `<div class="vh-theme-row">${esc(label)}</div>`;
        return `<a class="vh-theme-row" href="${esc(pageUrl("theme-hub.html", { id }))}">${esc(label)}</a>`;
      })
      .join("")}</div>`;
  }

  function cabinetRows(cabinets) {
    if (!cabinets.length) return `<p class="dgs-v2-lines-status">No cabinets on file.</p>`;
    return cabinets
      .map((cabinet) => {
        const name = cabinet.cabinet_name || cabinet.reference_key || "Cabinet";
        const count = (cabinet.themes || []).length;
        return `<div class="vh-cab-btn">
          <span>${esc(name)}</span>
          <span class="vh-cab-count">${count.toLocaleString()}</span>
        </div>`;
      })
      .join("");
  }

  function allThemes(data) {
    const seen = new Set();
    const themes = [];
    function add(theme) {
      const id = theme && theme.reference_key;
      if (!id || seen.has(id)) return;
      seen.add(id);
      themes.push(theme);
    }
    (data.cabinets || []).forEach((cabinet) => (cabinet.themes || []).forEach(add));
    (data.themes_without_cabinet || []).forEach(add);
    themes.sort((a, b) =>
      String(a.theme_name || a.reference_key || "").localeCompare(
        String(b.theme_name || b.reference_key || ""),
        undefined,
        { sensitivity: "base" }
      )
    );
    return themes;
  }

  function paint() {
    const data = state.data;
    if (!data) return;
    const cabinets = data.cabinets || [];
    els.hubGrid.innerHTML = `
      <article class="dgs-v2-hub-tile">
        <div class="dgs-v2-hub-tile-head">
          <div class="dgs-v2-section-label">Cabinets</div>
        </div>
        <div class="dgs-v2-hub-tile-body vh-scroll">${cabinetRows(cabinets)}</div>
      </article>
      <article class="dgs-v2-hub-tile">
        <div class="dgs-v2-hub-tile-head">
          <div class="dgs-v2-section-label">Themes</div>
        </div>
        <div class="dgs-v2-hub-tile-body vh-scroll">${themeList(allThemes(data))}</div>
      </article>`;
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

  function render(data) {
    state.data = data;
    const title = data.vendor_name || data.reference_key || "Vendor";
    els.captionTitle.textContent = title;
    els.captionId.textContent = data.reference_key || "—";
    const cabinets = data.cabinets || [];
    const themeCount = allThemes(data).length;
    els.captionMeta.textContent = `${cabinets.length.toLocaleString()} cabinets · ${themeCount.toLocaleString()} themes`;
    els.btnBack.href = pageUrl("vendors-v2.html", { id: data.reference_key });
    paint();

    if (data.logo_media_path) {
      loadMediaUrl(data.logo_media_path).then((url) => {
        els.hubLogo.innerHTML = url
          ? `<img src="${url}" alt="${esc(title)} logo" />`
          : `<span class="placeholder">${esc(title)}</span>`;
      });
    } else {
      els.hubLogo.innerHTML = `<span class="placeholder">${esc(title)}</span>`;
    }
  }

  async function init() {
    if (!vendorId) {
      els.hubLoading.textContent = "Open Vendor hub from a vendor.";
      return;
    }
    try {
      const headers = window.DGSAuth ? DGSAuth.authHeaders() : {};
      const res = await fetch(apiUrl(`/api/commerce/vendors/${encodeURIComponent(vendorId)}/hub`), { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.detail || body.message || res.statusText;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      render(body);
      els.hubLoading.hidden = true;
      els.hubBody.hidden = false;
    } catch (err) {
      showError(err.message || String(err));
      els.hubLoading.textContent = "Could not load this vendor.";
    }
  }

  window.VendorHub = { init };
})();
