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
    selectedKey: "",
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

  function themeLink(theme) {
    const id = theme.reference_key;
    const label = theme.theme_name || id || "Theme";
    if (!id) return esc(label);
    return `<a class="dgs-v2-hub-serial-link" href="${esc(pageUrl("theme-hub.html", { id }))}">${esc(label)}</a>`;
  }

  function themeList(themes) {
    if (!themes.length) return `<p class="dgs-v2-lines-status">No themes for this cabinet.</p>`;
    return `<ul class="vh-themes">${themes
      .map((theme) => `<li>${themeLink(theme)}</li>`)
      .join("")}</ul>`;
  }

  function cabinetButtons(cabinets, looseCount) {
    const rows = cabinets.map((cabinet) => {
      const key = cabinet.reference_key || "";
      const name = cabinet.cabinet_name || key || "Cabinet";
      const count = (cabinet.themes || []).length;
      const selected = key === state.selectedKey ? " is-selected" : "";
      return `<button type="button" class="vh-cab-btn${selected}" data-cab="${esc(key)}">
        <span>${esc(name)}</span>
        <span class="vh-cab-count">${count.toLocaleString()}</span>
      </button>`;
    });
    if (looseCount) {
      const selected = state.selectedKey === "__loose__" ? " is-selected" : "";
      rows.push(`<button type="button" class="vh-cab-btn${selected}" data-cab="__loose__">
        <span>No cabinet</span>
        <span class="vh-cab-count">${looseCount.toLocaleString()}</span>
      </button>`);
    }
    return rows.join("") || `<p class="dgs-v2-lines-status">No cabinets on file.</p>`;
  }

  function selectedThemes(data) {
    if (state.selectedKey === "__loose__") return data.themes_without_cabinet || [];
    const cabinet = (data.cabinets || []).find((row) => row.reference_key === state.selectedKey);
    return cabinet ? cabinet.themes || [] : [];
  }

  function selectedTitle(data) {
    if (state.selectedKey === "__loose__") return "No cabinet";
    const cabinet = (data.cabinets || []).find((row) => row.reference_key === state.selectedKey);
    return (cabinet && cabinet.cabinet_name) || "Themes";
  }

  function bindCabinets() {
    els.hubGrid.querySelectorAll(".vh-cab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedKey = btn.dataset.cab || "";
        paint();
      });
    });
  }

  function paint() {
    const data = state.data;
    if (!data) return;
    const cabinets = data.cabinets || [];
    const loose = data.themes_without_cabinet || [];
    els.hubGrid.innerHTML = `
      <article class="dgs-v2-hub-tile">
        <div class="dgs-v2-hub-tile-head">
          <div class="dgs-v2-section-label">Cabinets</div>
        </div>
        <div class="dgs-v2-hub-tile-body vh-scroll">${cabinetButtons(cabinets, loose.length)}</div>
      </article>
      <article class="dgs-v2-hub-tile">
        <div class="dgs-v2-hub-tile-head">
          <div class="dgs-v2-section-label">Themes · ${esc(selectedTitle(data))}</div>
        </div>
        <div class="dgs-v2-hub-tile-body vh-scroll">${themeList(selectedThemes(data))}</div>
      </article>`;
    bindCabinets();
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
    const loose = data.themes_without_cabinet || [];
    const themeCount = cabinets.reduce((n, cab) => n + (cab.themes || []).length, 0) + loose.length;
    els.captionMeta.textContent = `${cabinets.length.toLocaleString()} cabinets · ${themeCount.toLocaleString()} themes`;
    els.btnBack.href = pageUrl("vendors-v2.html", { id: data.reference_key });
    if (!state.selectedKey) {
      state.selectedKey = (cabinets[0] && cabinets[0].reference_key) || (loose.length ? "__loose__" : "");
    }
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
