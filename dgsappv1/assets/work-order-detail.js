/* Shared work-order detail drawer (Field + Work Orders). */
(function () {
  "use strict";

  let selectedWo = null;
  let onCloseCb = null;

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

  function ensureDrawer() {
    let backdrop = document.getElementById("wo-detail-backdrop");
    let drawer = document.getElementById("wo-detail-drawer");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "wo-detail-backdrop";
      backdrop.className = "dgs-capacity-drawer-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", close);
    }
    if (!drawer) {
      drawer = document.createElement("aside");
      drawer.id = "wo-detail-drawer";
      drawer.className = "dgs-capacity-drawer is-wo-detail";
      drawer.setAttribute("aria-label", "Work order detail");
      document.body.appendChild(drawer);
      drawer.addEventListener("click", (event) => {
        if (event.target.closest("#wo-detail-close")) close();
      });
    }
    return { backdrop, drawer };
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

  function close() {
    const wo = selectedWo;
    selectedWo = null;
    document.body.classList.remove("wo-detail-open");
    const drawer = document.getElementById("wo-detail-drawer");
    if (drawer) {
      drawer.innerHTML = "";
      drawer.classList.remove("is-wo-detail");
    }
    document.querySelectorAll(".dgs-wo-row.is-active, .dgs-field-wo-row.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
    const cb = onCloseCb;
    onCloseCb = null;
    if (typeof cb === "function") cb(wo);
  }

  async function open(wo, options) {
    if (!wo || !window.DGSAuth) return;
    const opts = options || {};
    onCloseCb = typeof opts.onClose === "function" ? opts.onClose : null;
    const { drawer } = ensureDrawer();
    selectedWo = wo;
    document.querySelectorAll(".dgs-wo-row.is-active, .dgs-field-wo-row.is-active").forEach((el) => {
      el.classList.toggle("is-active", el.getAttribute("data-wo") === wo);
    });
    document.body.classList.add("wo-detail-open");
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

  function isOpen() {
    return !!selectedWo && document.body.classList.contains("wo-detail-open");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("wo-detail-open")) {
      close();
    }
  });

  window.DGSWorkOrderDetail = { open, close, isOpen };
})();
