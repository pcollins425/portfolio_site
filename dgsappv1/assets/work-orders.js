/* Work Orders — Operations browse + detail drawer (read-only). */
(function () {
  "use strict";

  const PAGE_SIZE = 100;

  let state = {
    q: "",
    status: "open",
    woType: "",
    offset: 0,
    total: 0,
    orders: [],
    meta: null,
    scope: "all",
    hasPriority: false,
    loading: false,
    error: "",
    selectedWo: null,
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(n, digits) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString(undefined, {
      maximumFractionDigits: digits == null ? 1 : digits,
      minimumFractionDigits: 0,
    });
  }

  function fmtMoney(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function statusLabel(row) {
    const parts = [row.stattype || null, row.workstatus ? `(${row.workstatus})` : null].filter(
      Boolean
    );
    return parts.join(" ") || "—";
  }

  function hubCell(href, text) {
    const label = text == null || text === "" ? "—" : String(text);
    if (!href) return esc(label);
    return `<a class="dgs-field-asset" href="${esc(href)}">${esc(label)}</a>`;
  }

  function serialHtml(row) {
    const href =
      row.asset_id && window.DGSAssetNav ? DGSAssetNav.hubHref(row.asset_id) : "";
    return hubCell(href, row.serial);
  }

  function propertyHtml(row) {
    const href =
      row.casino_id && window.DGSCasinoNav ? DGSCasinoNav.hubHref(row.casino_id) : "";
    return hubCell(href, row.property);
  }

  function vendorHtml(row) {
    const href =
      row.vendor_id && window.DGSVendorNav ? DGSVendorNav.hubHref(row.vendor_id) : "";
    return hubCell(href, row.vendor);
  }

  function cabinetHtml(row) {
    const href =
      row.vendor_id && row.cabinet_id && window.DGSVendorNav
        ? DGSVendorNav.hubHref(row.vendor_id, row.cabinet_id)
        : "";
    return hubCell(href, row.cabinet);
  }

  function themeHtml(row) {
    const href =
      row.theme_id && window.DGSThemeNav ? DGSThemeNav.hubHref(row.theme_id) : "";
    return hubCell(href, row.theme);
  }

  async function fetchJson(path) {
    const res = await fetch(`${DGSAuth.apiBase()}${path}`, {
      headers: DGSAuth.authHeaders(),
    });
    if (!res.ok) {
      let detail = await res.text();
      try {
        const parsed = JSON.parse(detail);
        if (parsed && parsed.detail) detail = parsed.detail;
      } catch (_) {
        /* keep */
      }
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return res.json();
  }

  function queryString(extra) {
    const q = new URLSearchParams();
    q.set("status", state.status || "open");
    q.set("limit", String(PAGE_SIZE));
    q.set("offset", String(state.offset));
    if (state.q) q.set("q", state.q);
    if (state.woType) q.set("wo_type", state.woType);
    if (extra) {
      Object.keys(extra).forEach((key) => {
        if (extra[key] != null && extra[key] !== "") q.set(key, extra[key]);
      });
    }
    return q.toString();
  }

  function ensureDrawer() {
    let backdrop = document.getElementById("wo-detail-backdrop");
    let drawer = document.getElementById("wo-detail-drawer");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "wo-detail-backdrop";
      backdrop.className = "dgs-capacity-drawer-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", closeDetail);
    }
    if (!drawer) {
      drawer = document.createElement("aside");
      drawer.id = "wo-detail-drawer";
      drawer.className = "dgs-capacity-drawer is-wo-detail";
      drawer.setAttribute("aria-label", "Work order detail");
      document.body.appendChild(drawer);
      drawer.addEventListener("click", (event) => {
        if (event.target.closest("#wo-detail-close")) closeDetail();
      });
    }
    return { backdrop, drawer };
  }

  function closeDetail() {
    state.selectedWo = null;
    document.body.classList.remove("capacity-drill-open");
    const drawer = document.getElementById("wo-detail-drawer");
    if (drawer) {
      drawer.innerHTML = "";
      drawer.classList.remove("is-wo-detail");
    }
    document.querySelectorAll(".dgs-wo-row.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
  }

  function field(label, valueHtml) {
    if (valueHtml == null || valueHtml === "" || valueHtml === "—") return "";
    return `<div class="dgs-wo-field"><span class="dgs-wo-field-label">${esc(
      label
    )}</span><div class="dgs-wo-field-value">${valueHtml}</div></div>`;
  }

  function textField(label, value) {
    if (value == null || value === "") return "";
    return field(label, esc(value));
  }

  function preField(label, value) {
    if (value == null || value === "") return "";
    return field(label, `<pre class="dgs-wo-pre">${esc(value)}</pre>`);
  }

  function sourceLabel(source) {
    const raw = String(source || "").trim().toUpperCase();
    if (raw === "EMAINT") return "eMaint";
    if (raw === "APPSHEET") return "AppSheet";
    return source || "—";
  }

  function materialsHtml(materials, total) {
    if (!materials || !materials.length) {
      return `<p class="dgs-field-empty">No charge lines.</p>`;
    }
    const head =
      "<tr><th>Item</th><th class='dgs-field-num'>Qty</th><th class='dgs-field-num'>Unit</th><th class='dgs-field-num'>Ext</th><th>Source</th><th>Status</th></tr>";
    const body = materials
      .map((row) => {
        const qty =
          row.qty_issued != null && Number(row.qty_issued) !== 0
            ? row.qty_issued
            : row.qty_requested;
        const meta = [row.mfr, row.mfrpartno].filter(Boolean).join(" · ");
        const descrip = row.descrip
          ? `<div class="dgs-wo-mat-descrip">${esc(row.descrip)}</div>`
          : "";
        const metaHtml = meta ? `<div class="dgs-wo-mat-meta">${esc(meta)}</div>` : "";
        return `<tr>
          <td><div class="dgs-wo-mat-item">${esc(row.item || "—")}</div>${descrip}${metaHtml}</td>
          <td class="dgs-field-num">${esc(fmtNum(qty, 2))}</td>
          <td class="dgs-field-num">${esc(fmtMoney(row.unit_cost))}</td>
          <td class="dgs-field-num">${esc(fmtMoney(row.ext_cost))}</td>
          <td>${esc(sourceLabel(row.source))}</td>
          <td>${esc(row.status || "—")}</td>
        </tr>`;
      })
      .join("");
    const foot =
      total == null
        ? ""
        : `<tfoot><tr><td colspan="3">Total</td><td class="dgs-field-num">${esc(
            fmtMoney(total)
          )}</td><td colspan="2"></td></tr></tfoot>`;
    return `<div class="dgs-field-scroll"><table class="dgs-field-table dgs-wo-mat-table"><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div>`;
  }

  async function openDetail(root, wo) {
    const { drawer } = ensureDrawer(root);
    state.selectedWo = wo;
    document.querySelectorAll(".dgs-wo-row.is-active").forEach((el) => {
      el.classList.toggle("is-active", el.getAttribute("data-wo") === wo);
    });
    document.body.classList.add("capacity-drill-open");
    drawer.classList.add("is-wo-detail");
    drawer.innerHTML = `<div class="dgs-capacity-drawer-inner"><p class="dgs-v2-loading">Loading work order…</p></div>`;
    try {
      const data = await fetchJson(`/api/work-orders/${encodeURIComponent(wo)}`);
      const badges = [];
      if (data.moneypenny) badges.push(`<span class="dgs-wo-badge">Moneypenny</span>`);
      if (data.priority) badges.push(`<span class="dgs-wo-badge is-priority">P${esc(data.priority)}</span>`);
      if (data.wo_type) badges.push(`<span class="dgs-wo-badge">${esc(data.wo_type)}</span>`);
      drawer.innerHTML = `
        <div class="dgs-capacity-drawer-head">
          <div>
            <p class="dgs-capacity-drawer-kicker">Work order</p>
            <h2>${esc(data.wo || wo)}</h2>
            <p class="dgs-capacity-drawer-meta">${esc(statusLabel(data))} · ${esc(
        data.date_wo || "—"
      )}</p>
            <div class="dgs-wo-badges">${badges.join("")}</div>
          </div>
          <button type="button" class="dgs-v2-btn" id="wo-detail-close">Close</button>
        </div>
        <div class="dgs-capacity-drawer-body dgs-wo-detail-body">
          <section class="dgs-wo-section">
            <h3>Summary</h3>
            <div class="dgs-wo-fields">
              ${textField("Brief", data.brief_desc)}
              ${field("Property", propertyHtml(data))}
              ${field("Serial", serialHtml(data))}
              ${field("Vendor", vendorHtml(data))}
              ${field("Cabinet", cabinetHtml(data))}
              ${field("Theme", themeHtml(data))}
              ${textField("Assigned to", data.assignto)}
              ${textField("Project #", data.project_no)}
              ${textField("Priority", data.priority)}
              ${textField("Problem type", data.probtype)}
            </div>
          </section>
          <section class="dgs-wo-section">
            <h3>Requestor</h3>
            <div class="dgs-wo-fields">
              ${textField("Name", data.requestor) || `<p class="dgs-field-empty">No requestor on file.</p>`}
              ${textField("Telephone", data.req_tele)}
              ${textField("Game OOS", data.game_oos)}
              ${textField("Asset down", data.asst_dwn)}
              ${textField("In service", data.in_serv)}
            </div>
          </section>
          <section class="dgs-wo-section">
            <h3>Downtime & hours</h3>
            <div class="dgs-wo-fields">
              ${textField("Down start", data.downstart)}
              ${textField("Down end", data.downend)}
              ${textField("Downtime (days)", data.hours == null ? null : fmtNum(data.hours))}
              ${textField("Actual hours", data.act_hours == null ? null : fmtNum(data.act_hours))}
              ${textField("Work man hours", data.workmhours == null ? null : fmtNum(data.workmhours))}
              ${textField("Drive time", data.drivetime == null ? null : fmtNum(data.drivetime))}
            </div>
          </section>
          <section class="dgs-wo-section">
            <h3>Work description</h3>
            ${
              data.work_desc
                ? `<pre class="dgs-wo-pre">${esc(data.work_desc)}</pre>`
                : `<p class="dgs-field-empty">No work description.</p>`
            }
          </section>
          ${
            data.comments
              ? `<section class="dgs-wo-section"><h3>Comments</h3><pre class="dgs-wo-pre">${esc(
                  data.comments
                )}</pre></section>`
              : ""
          }
          <section class="dgs-wo-section">
            <h3>Materials</h3>
            <p class="dgs-wo-section-note">Charge lines from eMaint and AppSheet.</p>
            ${materialsHtml(data.materials, data.materials_total)}
          </section>
          <section class="dgs-wo-section">
            <h3>Record</h3>
            <div class="dgs-wo-fields">
              ${textField("Reference", data.reference_key)}
              ${textField("Bank / location", [data.bank, data.location].filter(Boolean).join(" · ") || null)}
              ${textField("Scheduled", data.sch_date)}
              ${textField("Completed", data.date_cmpl)}
              ${textField("Closed by", data.clsdby)}
              ${textField("Added", [data.adduser, data.adddate].filter(Boolean).join(" · ") || null)}
              ${textField("Edited", [data.edituser, data.editdate].filter(Boolean).join(" · ") || null)}
            </div>
          </section>
        </div>`;
    } catch (err) {
      drawer.innerHTML = `
        <div class="dgs-capacity-drawer-head">
          <h2>Work order</h2>
          <button type="button" class="dgs-v2-btn" id="wo-detail-close">Close</button>
        </div>
        <div class="dgs-capacity-drawer-body"><p class="error-box">${esc(
          err.message || err
        )}</p></div>`;
    }
  }

  function renderList(root) {
    const types = (state.meta && state.meta.wo_types) || [];
    const typeOptions = [`<option value="">All types</option>`]
      .concat(
        types.map(
          (value) =>
            `<option value="${esc(value)}"${
              state.woType === value ? " selected" : ""
            }>${esc(value)}</option>`
        )
      )
      .join("");
    const scopeNote =
      state.scope === "route" ? "Your route" : "All properties";
    const rows = state.orders
      .map((row) => {
        const active = state.selectedWo === row.wo ? " is-active" : "";
        const mp = row.moneypenny
          ? `<span class="dgs-wo-badge is-compact">MP</span>`
          : "";
        const pri =
          state.hasPriority && row.priority
            ? `<span class="dgs-wo-badge is-compact is-priority">P${esc(
                row.priority
              )}</span>`
            : "";
        return `<tr class="dgs-wo-row${active}" data-wo="${esc(row.wo)}">
          <td class="dgs-field-date">${esc(row.date_wo || "—")}</td>
          <td class="dgs-field-num">${esc(row.wo || "—")} ${mp}${pri}</td>
          <td>${propertyHtml(row)}</td>
          <td>${serialHtml(row)}</td>
          <td>${esc(statusLabel(row))}</td>
          <td>${esc(row.wo_type || "—")}</td>
          <td>${esc(row.assignto || "—")}</td>
          <td>${esc(row.brief_desc || "—")}</td>
        </tr>`;
      })
      .join("");

    root.innerHTML = `
      <div class="dgs-wo">
        <div class="dgs-wo-toolbar">
          <input type="search" id="wo-search" placeholder="Search WO #, serial, property, requestor…" value="${esc(
            state.q
          )}" autocomplete="off" />
          <select id="wo-status" aria-label="Status">
            <option value="open"${state.status === "open" ? " selected" : ""}>Open</option>
            <option value="closed"${state.status === "closed" ? " selected" : ""}>Closed</option>
            <option value="all"${state.status === "all" ? " selected" : ""}>All</option>
          </select>
          <select id="wo-type" aria-label="Type">${typeOptions}</select>
          <button type="button" class="dgs-v2-btn" id="wo-apply">Apply</button>
          <span class="dgs-wo-meta">${esc(scopeNote)} · ${esc(
      String(state.total)
    )} match${state.total === 1 ? "" : "es"}</span>
        </div>
        ${state.error ? `<p class="error-box">${esc(state.error)}</p>` : ""}
        <section class="dgs-field-panel dgs-wo-panel">
          ${
            state.orders.length
              ? `<div class="dgs-field-scroll"><table class="dgs-field-table dgs-wo-table">
                  <thead><tr>
                    <th class="dgs-field-date">Date</th>
                    <th class="dgs-field-num">WO #</th>
                    <th>Property</th>
                    <th>Serial</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Assigned</th>
                    <th>Brief</th>
                  </tr></thead>
                  <tbody>${rows}</tbody>
                </table></div>`
              : `<p class="dgs-field-empty">${
                  state.loading ? "Loading…" : "No work orders for this filter."
                }</p>`
          }
          <div class="dgs-wo-pager">
            <button type="button" class="dgs-v2-btn" id="wo-prev"${
              state.offset <= 0 ? " disabled" : ""
            }>Prev</button>
            <span>${esc(String(state.offset + 1))}–${esc(
      String(Math.min(state.offset + state.orders.length, state.total))
    )} of ${esc(String(state.total))}</span>
            <button type="button" class="dgs-v2-btn" id="wo-next"${
              state.offset + state.orders.length >= state.total ? " disabled" : ""
            }>Next</button>
          </div>
        </section>
      </div>`;

    document.getElementById("wo-apply")?.addEventListener("click", () => {
      state.q = document.getElementById("wo-search")?.value.trim() || "";
      state.status = document.getElementById("wo-status")?.value || "open";
      state.woType = document.getElementById("wo-type")?.value || "";
      state.offset = 0;
      loadList(root);
    });
    document.getElementById("wo-search")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") document.getElementById("wo-apply")?.click();
    });
    document.getElementById("wo-prev")?.addEventListener("click", () => {
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      loadList(root);
    });
    document.getElementById("wo-next")?.addEventListener("click", () => {
      state.offset += PAGE_SIZE;
      loadList(root);
    });
    root.querySelectorAll(".dgs-wo-row").forEach((row) => {
      row.addEventListener("click", () => {
        openDetail(root, row.getAttribute("data-wo"));
      });
    });
  }

  async function loadList(root) {
    state.loading = true;
    state.error = "";
    renderList(root);
    try {
      const data = await fetchJson(`/api/work-orders?${queryString()}`);
      state.orders = data.orders || [];
      state.total = Number(data.total) || 0;
      state.scope = data.scope || "all";
      state.hasPriority = !!data.has_priority;
      state.loading = false;
      renderList(root);
    } catch (err) {
      state.loading = false;
      state.error = err.message || String(err);
      renderList(root);
    }
  }

  async function load(root) {
    if (!root || !window.DGSAuth) return;
    root.innerHTML = '<p class="dgs-v2-loading">Loading work orders…</p>';
    try {
      state.meta = await fetchJson("/api/work-orders/meta");
      state.hasPriority = !!(state.meta && state.meta.has_priority);
      await loadList(root);
    } catch (err) {
      root.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
    }
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("capacity-drill-open")) {
      closeDetail();
    }
  });

  window.DGSWorkOrders = { load };
})();
