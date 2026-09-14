(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const params = new URLSearchParams(window.location.search);

  const state = {
    casinoId: (params.get("id") || "").trim(),
    detail: null,
    map: null,
    mapMarker: null,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    hubBody: document.getElementById("hub-body"),
    hubLoading: document.getElementById("hub-loading"),
    hubSubtitle: document.getElementById("hub-subtitle"),
    hubGrid: document.getElementById("hub-grid"),
    captionTitle: document.getElementById("caption-title"),
    captionId: document.getElementById("caption-id"),
    captionMeta: document.getElementById("caption-meta"),
    hubMap: document.getElementById("hub-map"),
    hubMapEmpty: document.getElementById("hub-map-empty"),
    hubMapLink: document.getElementById("hub-map-link"),
    btnBack: document.getElementById("btn-back"),
    btnSlotMaster: document.getElementById("btn-slot-master"),
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

  function hubUrl(casinoId) {
    return pageUrl("casino-hub.html", { id: casinoId });
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
    if (!iso) return "—";
    const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
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

  function fmtPercent(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return `${Number(n).toFixed(1)}%`;
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
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

  function kv(label, valueHtml) {
    return `<div class="dgs-v2-hub-kv"><span class="k">${esc(label)}</span><span class="v">${valueHtml}</span></div>`;
  }

  function locationLine(d) {
    return d.location_label || [d.address, d.city, d.zip].filter(Boolean).join(", ") || "—";
  }

  function casinosHref(casinoId) {
    return pageUrl("casinos-v2.html", { id: casinoId });
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

  function dealImsHref(casinoId, deal) {
    if (!deal?.ims_id) return null;
    return pageUrl("projects.html", { view: "ims", casino: casinoId, ims: deal.ims_id });
  }

  function contactRow(c) {
    const title = c.name || c.email || "Contact";
    const meta = [c.job_title, c.email, c.phone].filter(Boolean).join(" · ");
    return `
      <div class="dgs-v2-casino-hub-person">
        <div class="dgs-v2-casino-hub-person-name">${esc(title)}</div>
        <div class="dgs-v2-casino-hub-person-meta">${esc(meta || "—")}</div>
      </div>`;
  }

  function dealRow(casinoId, deal) {
    const title = deal.deal_name || deal.deal_key || "Deal";
    const amount = deal.amount != null && deal.amount !== "" ? fmtMoney(deal.amount) : null;
    const meta = [deal.deal_stage, amount, deal.close_date ? fmtDate(deal.close_date) : ""]
      .filter(Boolean)
      .join(" · ");
    const imsHref = dealImsHref(casinoId, deal);
    const projectLine = imsHref
      ? `<a class="dgs-v2-hub-serial-link" href="${esc(imsHref)}">Project ${esc(deal.ims_id)}</a>`
      : `<span class="dgs-v2-hub-muted">No project linked</span>`;
    const badge = deal.is_closed_won
      ? `<span class="dgs-prj-badge">Won</span>`
      : deal.is_closed
        ? `<span class="dgs-prj-badge">Closed</span>`
        : `<span class="dgs-v2-hub-badge dgs-v2-hub-badge--ok">Open</span>`;
    return `
      <div class="dgs-v2-casino-hub-person">
        <div class="dgs-v2-casino-hub-person-top">
          <div class="dgs-v2-casino-hub-person-name">${esc(title)}</div>
          ${badge}
        </div>
        <div class="dgs-v2-casino-hub-person-meta">${esc(meta || "—")}</div>
        <div>${projectLine}</div>
      </div>`;
  }

  function renderProfileTile(d) {
    const hs = d.hubspot;
    const company = hs?.company;
    const fields = [
      kv("Casino", esc(d.casino_name || d.casino_short || "—")),
      kv("Key", `<span class="mono">${esc(d.reference_key)}</span>`),
      kv("Tribe", esc(d.tribe_name || "—")),
      kv("State", esc(d.state_abbreviation || d.state || "—")),
      kv("Location", esc(locationLine(d))),
      kv("House average", esc(fmtNum(d.main_house_average))),
      kv("Total floor", esc(fmtNum(d.total_number_of_machines))),
      kv("DGS floor %", esc(fmtPercent(d.dgs_floor_percent))),
      kv("Active machines", esc(fmtNum(d.active_machines))),
      kv("Vendors", esc(d.available_vendors || "—")),
      kv("Sales", esc(d.sales || "—")),
      kv("Licensed", esc(d.licensed || "—")),
      kv("eMaint property", esc(d.emaint_property || "—")),
    ];
    if (hs?.linked && company) {
      if (company.owner_name) fields.push(kv("HubSpot owner", esc(company.owner_name)));
      if (company.phone) fields.push(kv("Company phone", esc(company.phone)));
      if (company.lifecycle_stage) fields.push(kv("Lifecycle", esc(company.lifecycle_stage)));
      if (company.domain) fields.push(kv("Domain", esc(company.domain)));
    }
    return tileWide(
      "Profile",
      `<div class="dgs-v2-hub-kv-grid">${fields.join("")}</div>`,
      casinosHref(d.reference_key),
      "Go to Casinos →"
    );
  }

  function renderAgreementTile(d) {
    const fields = [
      kv("Master agreement", esc(d.signed_master_agreement || "—")),
      kv("Type", esc(d.agreement_type || "—")),
      kv("Executed", esc(fmtDate(d.executed_on))),
      kv("Expiration", esc(fmtDate(d.expiration))),
      kv("Loss passed", esc(d.loss_passed || "—")),
    ];
    return tile(
      "Agreement",
      `<div class="dgs-v2-hub-kv-grid">${fields.join("")}</div>`,
      casinosHref(d.reference_key),
      "Go to Casinos →"
    );
  }

  function renderPerformanceTile(d) {
    const perf = d.performance;
    if (!perf) {
      return tile(
        "Performance",
        `<p class="dgs-v2-hub-empty">No recent Master_Revenue for this casino.</p>`,
        casinosHref(d.reference_key),
        "Go to Casinos →"
      );
    }
    const fields = [
      kv("Month", esc(fmtMonth(perf.month))),
      kv("Avg CIPD", esc(fmtMoney(perf.avg_cipd))),
      kv("Avg TDW", esc(fmtMoney(perf.avg_tdw))),
      kv("Avg ADW", esc(fmtMoney(perf.avg_adw))),
      kv("Win index", esc(perf.avg_win_index != null ? Number(perf.avg_win_index).toFixed(2) : "—")),
      kv("Actual index", esc(perf.avg_actual_index != null ? Number(perf.avg_actual_index).toFixed(2) : "—")),
      kv("Commission", esc(fmtMoney(perf.sum_commission))),
      kv("Machines", esc(fmtNum(perf.machine_count))),
    ];
    return tile(
      "Performance",
      `<div class="dgs-v2-hub-kv-grid">${fields.join("")}</div>`,
      casinosHref(d.reference_key),
      "Go to Casinos →"
    );
  }

  function renderFloorTile(d) {
    const n = Number(d.active_machines) || 0;
    const body = n
      ? `<div><span class="dgs-v2-hub-badge dgs-v2-hub-badge--ok">${esc(fmtNum(n))} active</span></div>
         <div class="dgs-v2-hub-muted">DGS floor ${esc(fmtPercent(d.dgs_floor_percent))} of ${esc(fmtNum(d.total_number_of_machines))} total</div>`
      : `<p class="dgs-v2-hub-empty">No active leased cabinets on Slot Master.</p>`;
    return tile("Floor · Slot Master", body, slotMasterHref(d.reference_key), "Go to Slot Master →");
  }

  function renderImsTile(d) {
    const rows = Array.isArray(d.ims_projects) ? d.ims_projects : [];
    const total = Number(d.project_count) || 0;
    if (!rows.length) {
      return tile(
        "IMS projects",
        `<p class="dgs-v2-hub-empty">No IMS projects for this casino.</p>`,
        projectsImsHref(d.reference_key),
        "Go to Projects →"
      );
    }
    const list = rows
      .slice(0, 8)
      .map((p) => {
        const title = p.project_no || p.reference_key || "Project";
        const dates = [p.date_start ? fmtDate(p.date_start) : "", p.date_end ? fmtDate(p.date_end) : ""]
          .filter(Boolean)
          .join(" – ");
        return `
          <a class="dgs-v2-casino-hub-person dgs-v2-casino-hub-person--link" href="${esc(imsProjectHref(d.reference_key, p))}">
            <div class="dgs-v2-casino-hub-person-name">${esc(title)}</div>
            <div class="dgs-v2-casino-hub-person-meta">${esc([p.status, dates].filter(Boolean).join(" · "))}</div>
          </a>`;
      })
      .join("");
    const more =
      total > rows.length
        ? `<div class="dgs-v2-hub-muted">${esc(fmtNum(total))} total · showing latest ${rows.length}</div>`
        : "";
    return tileWide(
      "IMS projects",
      `${list}${more}`,
      projectsImsHref(d.reference_key),
      total ? `View all (${fmtNum(total)}) →` : "Go to Projects →"
    );
  }

  function renderContactsTile(d) {
    const hs = d.hubspot;
    if (!hs?.linked) {
      return tileWide("Contacts", `<p class="dgs-v2-hub-empty">No HubSpot company linked.</p>`);
    }
    const contacts = hs.contacts || [];
    if (!contacts.length) {
      return tileWide("Contacts", `<p class="dgs-v2-hub-empty">No HubSpot contacts for this property.</p>`);
    }
    return tileWide(
      `Contacts (${contacts.length})`,
      `<div class="dgs-v2-casino-hub-people">${contacts.map(contactRow).join("")}</div>`
    );
  }

  function renderDealsTile(d) {
    const hs = d.hubspot;
    if (!hs?.linked) {
      return tileWide("Deals", `<p class="dgs-v2-hub-empty">No HubSpot company linked.</p>`);
    }
    const deals = hs.deals || [];
    if (!deals.length) {
      return tileWide("Deals", `<p class="dgs-v2-hub-empty">No HubSpot deals for this property.</p>`);
    }
    const open = deals.filter((x) => !x.is_closed);
    const closed = deals.filter((x) => x.is_closed);
    const openHtml = open.length
      ? `<div class="dgs-v2-casino-hub-people">${open.map((deal) => dealRow(d.reference_key, deal)).join("")}</div>`
      : `<p class="dgs-v2-hub-empty">No open deals.</p>`;
    const closedHtml = closed.length
      ? `<details class="dgs-v2-casino-deals-closed">
          <summary>Closed deals (${closed.length})</summary>
          <div class="dgs-v2-casino-hub-people">${closed
            .map((deal) => dealRow(d.reference_key, deal))
            .join("")}</div>
        </details>`
      : "";
    return tileWide(`Deals (${open.length} open)`, `${openHtml}${closedHtml}`);
  }

  function renderTiles(d) {
    els.hubGrid.innerHTML = [
      renderProfileTile(d),
      renderPerformanceTile(d),
      renderAgreementTile(d),
      renderFloorTile(d),
      renderImsTile(d),
      renderContactsTile(d),
      renderDealsTile(d),
    ].join("");
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
      els.hubMap.innerHTML = "";
      els.hubMap.hidden = true;
      els.hubMapEmpty.hidden = false;
      els.hubMapLink.hidden = true;
      return;
    }

    els.hubMapEmpty.hidden = true;
    els.hubMap.hidden = false;
    const lat = Number(d.latitude);
    const lon = Number(d.longitude);
    els.hubMapLink.hidden = false;
    els.hubMapLink.href = `https://www.google.com/maps?q=${lat},${lon}`;

    if (typeof window.L === "undefined") {
      els.hubMap.textContent = "Map unavailable (Leaflet failed to load).";
      return;
    }

    els.hubMap.innerHTML = "";
    state.map = L.map(els.hubMap, { zoomControl: true, attributionControl: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(state.map);
    state.mapMarker = L.marker([lat, lon]).addTo(state.map);
    state.map.setView([lat, lon], 12);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => state.map?.invalidateSize());
    });
  }

  function renderCaption(d) {
    const stateAbbr = d.state_abbreviation || d.state || "—";
    els.captionTitle.textContent = d.casino_name || d.casino_short || d.reference_key;
    els.captionId.textContent = `${stateAbbr} · ${d.reference_key}`;
    els.captionMeta.textContent = locationLine(d);
  }

  async function loadHub() {
    if (!state.casinoId) {
      throw new Error("Missing casino id — use casino-hub.html?id={CT-*}");
    }

    state.detail = await fetchJson(
      `/api/commerce/casinos/${encodeURIComponent(state.casinoId)}`
    );
    const name = state.detail.casino_name || state.detail.reference_key;
    document.title = `${name} — Casino hub — DGS Application`;
    els.hubSubtitle.textContent = `casino-hub.html?id=${state.casinoId}`;

    const n = Number(state.detail.active_machines) || 0;
    els.btnSlotMaster.href = slotMasterHref(state.detail.reference_key);
    els.btnSlotMaster.textContent = n ? `Slot Master (${fmtNum(n)})` : "Slot Master";

    renderCaption(state.detail);
    renderTiles(state.detail);
    renderMap(state.detail);
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

  window.CasinoHub = { init, hubUrl };
})();
