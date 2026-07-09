(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const AssetNav = window.DGSAssetNav || {
    hubHref: () => "",
    assetsHref: () => "assets-v2.html",
    assetsActionHtml: () => "",
  };

  const params = new URLSearchParams(window.location.search);

  const state = {
    assetId: (params.get("id") || "").trim(),
    hub: null,
    mediaUrls: {},
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    hubBody: document.getElementById("hub-body"),
    hubLoading: document.getElementById("hub-loading"),
    hubSubtitle: document.getElementById("hub-subtitle"),
    hubGrid: document.getElementById("hub-grid"),
    vendorLogo: document.getElementById("vendor-logo"),
    cabinetWrap: document.getElementById("cabinet-wrap"),
    captionId: document.getElementById("caption-id"),
    captionMeta: document.getElementById("caption-meta"),
    btnBack: document.getElementById("btn-back"),
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function pageUrl(path, extra) {
    const base = window.DGS ? DGS.withApi(path) : path;
    if (!extra) return base;
    const url = new URL(base, window.location.href);
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
    return url.pathname + url.search;
  }

  function hubUrl(assetId) {
    return pageUrl("asset-hub.html", { id: assetId });
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

  function fmtMoney(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

  function tile(title, bodyHtml, linkHref, linkLabel) {
    const action = linkHref
      ? `<a class="dgs-v2-hub-tile-link" href="${esc(linkHref)}">${esc(linkLabel || "Open →")}</a>`
      : "";
    return `
      <article class="dgs-v2-hub-tile">
        <div class="dgs-v2-hub-tile-head">
          <div class="dgs-v2-section-label">${esc(title)}</div>
          ${action}
        </div>
        <div class="dgs-v2-hub-tile-body">${bodyHtml}</div>
      </article>`;
  }

  function tileWide(title, bodyHtml, linkHref, linkLabel) {
    return tile(title, bodyHtml, linkHref, linkLabel).replace(
      'class="dgs-v2-hub-tile"',
      'class="dgs-v2-hub-tile dgs-v2-hub-tile--wide"'
    );
  }

  function kv(label, value) {
    return `<div class="dgs-v2-hub-kv"><span class="k">${esc(label)}</span><span class="v">${value}</span></div>`;
  }

  function renderAssetRecordTile(a) {
    const fields = [
      ["reference_key", `<span class="mono">${esc(a.reference_key)}</span>`],
      ["serial_number", `<span class="mono">${esc(a.serial_number || "—")}</span>`],
      ["vendor", esc(a.vendor_name || "—")],
      ["cabinet", esc(a.cabinet_name || "—")],
      ["class", esc(a.class || "—")],
      ["machine_type", esc(a.machine_type || "—")],
      ["date_received", esc(fmtDate(a.date_received))],
      ["sales_order", esc(a.sales_order || "—")],
      ["agreement_order", esc(a.agreement_order || "—")],
      ["machine_cost", esc(fmtMoney(a.machine_cost))],
      ["cabinet_type", esc(a.cabinet_type || "—")],
      ["update_by", esc(a.update_by || "—")],
    ];
    const body = `<div class="dgs-v2-hub-kv-grid">${fields.map(([k, v]) => kv(k, v)).join("")}</div>`;
    const assetsHref = AssetNav.assetsHref({ assetId: a.reference_key });
    return tileWide(
      "Asset record · inventory.assets",
      body,
      assetsHref,
      "Go to Assets →"
    );
  }

  function renderCompinfoTile(c) {
    if (!c) {
      return tile(
        "COMPINFO",
        `<p class="dgs-v2-hub-empty">No COMPINFO row linked to this asset.</p>`,
        AssetNav.assetsHref(),
        "Go to Assets →"
      );
    }
    const body = [
      `<div>compid · <span class="mono">${esc(c.compid)}</span></div>`,
      `<div>status · ${esc(c.status || "—")}</div>`,
      `<div>property · ${esc(c.property || "—")}</div>`,
      c.comp_desc ? `<div>title · ${esc(c.comp_desc)}</div>` : "",
    ].join("");
    return tile(
      "COMPINFO",
      body,
      AssetNav.assetsHref({ compid: c.compid }),
      "Go to Assets →"
    );
  }

  function renderContractTile(c) {
    if (!c) {
      return tile(
        "Contract line",
        `<p class="dgs-v2-hub-empty">Not linked on a contract serial.</p>`,
        pageUrl("contracts-v2.html"),
        "Go to Contracts →"
      );
    }
    const body = [
      `<div class="mono">${esc(c.agreement_id || c.contract_reference_key)}</div>`,
      `<div>${esc(c.asset_description || "Line item")}${c.quantity != null ? ` · Qty ${c.quantity}` : ""}</div>`,
      c.line_machine_cost != null ? `<div>${esc(fmtMoney(c.line_machine_cost))}</div>` : "",
    ].join("");
    const href = c.contract_reference_key
      ? pageUrl("contracts-v2.html")
      : pageUrl("contracts-v2.html");
    return tile("Contract line", body, href, "Go to Contracts →");
  }

  function renderSlotMasterTile(sm) {
    const active = sm?.active;
    if (!sm || !sm.history_count) {
      return tile(
        "Slot master",
        `<p class="dgs-v2-hub-empty">No slot master migration rows.</p>`,
        pageUrl("slot_master.html"),
        "Go to Slot Master →"
      );
    }
    let body;
    if (active) {
      body = [
        `<div><span class="dgs-v2-hub-badge dgs-v2-hub-badge--ok">Active on floor</span></div>`,
        `<div>${esc(active.casino_name || "—")}${active.zbl ? ` · ${esc(active.zbl)}` : ""}</div>`,
        active.theme_name ? `<div>Theme · ${esc(active.theme_name)} · <span class="mono">${esc(active.reference_key)}</span></div>` : "",
        sm.prior_count ? `<div class="dgs-v2-hub-muted">${sm.prior_count} prior row${sm.prior_count === 1 ? "" : "s"} in history</div>` : "",
      ].join("");
    } else {
      body = `<p class="dgs-v2-hub-empty">No active floor row · ${sm.history_count} historical row${sm.history_count === 1 ? "" : "s"}</p>`;
    }
    const slotHref = active?.casino_id
      ? pageUrl("slot_master.html", { casino: active.casino_id })
      : pageUrl("slot_master.html");
    return tile("Slot master", body, slotHref, "Go to Slot Master →");
  }

  function renderWarehouseTile(w, compinfo) {
    if (!w) {
      const note = compinfo && compinfo.property && !/warehouse/i.test(compinfo.property)
        ? "Not in warehouse inventory"
        : "Not in warehouse inventory";
      return tile(
        "Warehouse",
        `<p class="dgs-v2-hub-empty">${esc(note)}</p>`,
        pageUrl("warehouse.html"),
        "Go to Warehouse →"
      );
    }
    const body = [
      `<div>${esc(w.property || "—")}</div>`,
      w.status ? `<div>status · ${esc(w.status)}</div>` : "",
      w.compid ? `<div>compid · <span class="mono">${esc(w.compid)}</span></div>` : "",
    ].join("");
    return tile("Warehouse", body, pageUrl("warehouse.html"), "Go to Warehouse →");
  }

  function renderTiles(hub) {
    const a = hub.asset;
    els.hubGrid.innerHTML = [
      renderAssetRecordTile(a),
      renderCompinfoTile(hub.compinfo),
      renderContractTile(hub.contract),
      renderSlotMasterTile(hub.slot_master),
      renderWarehouseTile(hub.warehouse, hub.compinfo),
    ].join("");
  }

  async function renderMedia(a) {
    const vendorLabel = a.vendor_name || "—";
    const cabLabel = a.cabinet_name || "—";

    els.captionId.textContent = a.reference_key || "—";
    els.captionMeta.textContent = [a.serial_number, a.cabinet_name].filter(Boolean).join(" · ") || "—";

    const logoPath = a.vendor_logo_media_path;
    const cabPath = a.cabinet_image_media_path;

    const [logoUrl, cabUrl] = await Promise.all([
      logoPath ? loadMediaUrl(logoPath) : Promise.resolve(null),
      cabPath ? loadMediaUrl(cabPath) : Promise.resolve(null),
    ]);

    if (logoPath) {
      els.vendorLogo.innerHTML = logoUrl
        ? `<img src="${logoUrl}" alt="${esc(vendorLabel)} logo" />`
        : placeholderBox(logoPath.split("/").pop());
    } else {
      els.vendorLogo.innerHTML = placeholderBox(vendorLabel);
    }

    if (cabPath) {
      els.cabinetWrap.innerHTML = cabUrl
        ? `<img src="${cabUrl}" alt="${esc(cabLabel)}" title="${esc(cabLabel)}" />`
        : placeholderBox(cabLabel);
    } else {
      els.cabinetWrap.innerHTML = placeholderBox(cabLabel);
    }
  }

  async function loadHub() {
    if (!state.assetId) {
      throw new Error("Missing asset id — use asset-hub.html?id={reference_key}");
    }

    state.hub = await fetchJson(`/api/assets/hub/${encodeURIComponent(state.assetId)}`);
    document.title = `${state.assetId} — Asset hub — DGS Application`;
    els.hubSubtitle.textContent = `asset-hub.html?id=${state.assetId}`;

    renderTiles(state.hub);
    void renderMedia(state.hub.asset).catch(() => {});
  }

  async function init() {
    showError(null);
    els.hubBody.hidden = true;
    els.hubLoading.hidden = false;

    if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
      els.btnBack.hidden = false;
      els.btnBack.addEventListener("click", () => window.history.back());
    }

    try {
      await loadHub();
      els.hubLoading.hidden = true;
      els.hubBody.hidden = false;
    } catch (err) {
      els.hubLoading.hidden = true;
      showError(err.message || String(err));
    }
  }

  window.AssetHub = { init, hubUrl };
})();
