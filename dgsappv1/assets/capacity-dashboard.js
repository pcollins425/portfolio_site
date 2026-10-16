/* Capacity dashboard — downtime and part cost for Ops / Finance. */
(function () {
  "use strict";

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
    return `$${Number(n).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;
  }

  function monthInputValue(ym) {
    return ym || new Date().toISOString().slice(0, 7);
  }

  function hubCell(href, text) {
    const label = text == null || text === "" ? "—" : String(text);
    if (!href) return esc(label);
    if (window.DGSAssetNav && typeof DGSAssetNav.linkHtml === "function") {
      return DGSAssetNav.linkHtml(href, label, "dgs-field-asset");
    }
    return `<a class="dgs-field-asset" href="${esc(href)}">${esc(label)}</a>`;
  }

  function serialCell(row) {
    const href =
      row.asset_id && window.DGSAssetNav ? DGSAssetNav.hubHref(row.asset_id) : "";
    return hubCell(href, row.serial);
  }

  function propertyCell(row) {
    const href =
      row.casino_id && window.DGSCasinoNav ? DGSCasinoNav.hubHref(row.casino_id) : "";
    return hubCell(href, row.property);
  }

  function vendorCell(row) {
    const href =
      row.vendor_id && window.DGSVendorNav ? DGSVendorNav.hubHref(row.vendor_id) : "";
    return hubCell(href, row.vendor);
  }

  function cabinetCell(row) {
    const href =
      row.vendor_id && row.cabinet_id && window.DGSVendorNav
        ? DGSVendorNav.hubHref(row.vendor_id, row.cabinet_id)
        : "";
    return hubCell(href, row.cabinet);
  }

  function themeCell(row) {
    const href =
      row.theme_id && window.DGSThemeNav ? DGSThemeNav.hubHref(row.theme_id) : "";
    return hubCell(href, row.theme);
  }

  function table(headers, rows, empty) {
    if (!rows.length) {
      return `<p class="dgs-field-empty">${esc(empty)}</p>`;
    }
    const head = headers
      .map((col) => `<th${col.cls ? ` class="${col.cls}"` : ""}>${esc(col.label)}</th>`)
      .join("");
    const body = rows
      .map(
        (row) =>
          `<tr>${row
            .map((value, i) => {
              const cls = headers[i].cls ? ` class="${headers[i].cls}"` : "";
              if (value && typeof value === "object" && "html" in value) {
                return `<td${cls}>${value.html}</td>`;
              }
              return `<td${cls}>${esc(value == null || value === "" ? "—" : value)}</td>`;
            })
            .join("")}</tr>`
      )
      .join("");
    return `<div class="dgs-field-scroll"><table class="dgs-field-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function rankTable(dim, rows, valueKey, valueFmt) {
    if (!rows.length) {
      return `<p class="dgs-field-empty">No rows.</p>`;
    }
    const head = `<tr><th>Name</th><th class="dgs-field-num">Downtime (days)</th><th class="dgs-field-num">WOs</th><th class="dgs-field-num">Assets</th></tr>`;
    const body = rows
      .map((row) => {
        const value =
          valueKey === "part_cost" ? valueFmt(row.part_cost) : valueFmt(row.downtime);
        return `<tr class="dgs-capacity-rank-row" data-dim="${esc(dim)}" data-key="${esc(
          row.key
        )}">
          <td>${esc(row.label)}</td>
          <td class="dgs-field-num">${esc(value)}</td>
          <td class="dgs-field-num">${esc(fmtNum(row.wo_count ?? row.line_count, 0))}</td>
          <td class="dgs-field-num">${esc(
            row.asset_count == null ? "—" : fmtNum(row.asset_count, 0)
          )}</td>
        </tr>`;
      })
      .join("");
    return `<div class="dgs-field-scroll"><table class="dgs-field-table dgs-capacity-rank"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function partTable(rows) {
    if (!rows.length) {
      return `<p class="dgs-field-empty">No part cost for this month.</p>`;
    }
    const head = `<tr><th>Casino</th><th class="dgs-field-num">Part cost</th><th class="dgs-field-num">Lines</th></tr>`;
    const body = rows
      .map((row) => {
        const href =
          row.key && row.key !== "Unassigned" && window.DGSCasinoNav
            ? DGSCasinoNav.hubHref(row.key)
            : "";
        const name = href
          ? hubCell(href, row.label)
          : esc(row.label);
        return `<tr>
          <td>${name}</td>
          <td class="dgs-field-num">${esc(fmtMoney(row.part_cost))}</td>
          <td class="dgs-field-num">${esc(fmtNum(row.line_count, 0))}</td>
        </tr>`;
      })
      .join("");
    return `<div class="dgs-field-scroll"><table class="dgs-field-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function niceCeiling(value) {
    const n = Math.max(Number(value) || 0, 1);
    const mag = Math.pow(10, Math.floor(Math.log10(n)));
    const scaled = n / mag;
    const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return nice * mag;
  }

  function trendBars(trend) {
    if (!trend.length) {
      return `<p class="dgs-field-empty">No downtime trend yet.</p>`;
    }
    const rawMax = Math.max(...trend.map((row) => Number(row.downtime) || 0), 0);
    const yMax = niceCeiling(rawMax || 1);
    const ticks = [yMax, yMax * 0.75, yMax * 0.5, yMax * 0.25, 0];
    const tickHtml = ticks
      .map(
        (tick) =>
          `<div class="dgs-capacity-trend-tick"><span>${esc(fmtNum(tick))}</span></div>`
      )
      .join("");
    const gridHtml = ticks
      .map(
        (tick) =>
          `<div class="dgs-capacity-trend-gridline" style="bottom:${(tick / yMax) * 100}%"></div>`
      )
      .join("");
    const cols = trend
      .map((row) => {
        const value = Number(row.downtime) || 0;
        const pct = yMax ? (value / yMax) * 100 : 0;
        return `<div class="dgs-capacity-trend-col" title="${esc(row.month)}: ${esc(
          fmtNum(value)
        )} downtime days · ${esc(fmtNum(row.wo_count, 0))} WOs">
          <div class="dgs-capacity-trend-bar-wrap">
            <div class="dgs-capacity-trend-bar" style="height:${pct}%"></div>
          </div>
          <div class="dgs-capacity-trend-label">${esc((row.month || "").slice(5))}</div>
        </div>`;
      })
      .join("");
    return `<div class="dgs-capacity-trend-chart" role="img" aria-label="Downtime days by month">
      <div class="dgs-capacity-trend-yaxis-name">Downtime (days)</div>
      <div class="dgs-capacity-trend-yaxis">${tickHtml}</div>
      <div class="dgs-capacity-trend-plot">
        <div class="dgs-capacity-trend-grid">${gridHtml}</div>
        <div class="dgs-capacity-trend">${cols}</div>
      </div>
      <div class="dgs-capacity-trend-xaxis-name">Month</div>
    </div>`;
  }

  let state = {
    month: monthInputValue(),
    data: null,
    drill: null,
  };

  async function fetchJson(path) {
    const res = await fetch(`${DGSAuth.apiBase()}${path}`, {
      headers: DGSAuth.authHeaders(),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return res.json();
  }

  async function loadDrill(dim, key) {
    const panel = document.getElementById("capacity-drill");
    if (!panel) return;
    panel.innerHTML = `<p class="dgs-v2-loading">Loading work orders…</p>`;
    try {
      const data = await fetchJson(
        `/api/capacity-dashboard/drill?month=${encodeURIComponent(
          state.month
        )}&dim=${encodeURIComponent(dim)}&key=${encodeURIComponent(key)}`
      );
      state.drill = data;
      const orders = data.orders || [];
      panel.innerHTML = `
        <div class="dgs-capacity-drill-head">
          <h2>Work orders · ${esc(dim)} · ${esc(key)} <span>${orders.length}</span></h2>
          <button type="button" class="dgs-v2-btn" id="capacity-drill-close">Close</button>
        </div>
        ${table(
          [
            { label: "WO #", cls: "dgs-field-num" },
            { label: "Downtime (days)", cls: "dgs-field-num" },
            { label: "Down start", cls: "dgs-field-date" },
            { label: "Down end", cls: "dgs-field-date" },
            { label: "Casino" },
            { label: "Serial" },
            { label: "Vendor" },
            { label: "Cabinet" },
            { label: "Theme" },
          ],
          orders.map((row) => [
            row.wo,
            row.hours == null ? "—" : fmtNum(row.hours),
            row.downstart,
            row.downend,
            { html: propertyCell(row) },
            { html: serialCell(row) },
            { html: vendorCell(row) },
            { html: cabinetCell(row) },
            { html: themeCell(row) },
          ]),
          "No work orders in this breakout."
        )}`;
      document.getElementById("capacity-drill-close")?.addEventListener("click", () => {
        state.drill = null;
        panel.innerHTML = `<p class="dgs-field-empty">Select a Region, State, Casino, Vendor, Cabinet, or Theme row to list work orders with downtime days and down start/end.</p>`;
      });
    } catch (err) {
      panel.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
    }
  }

  function wireRanks(root) {
    root.querySelectorAll(".dgs-capacity-rank-row").forEach((row) => {
      row.addEventListener("click", () => {
        loadDrill(row.getAttribute("data-dim"), row.getAttribute("data-key"));
      });
    });
  }

  function render(root) {
    const data = state.data;
    const k = data.kpis || {};
    root.innerHTML = `
      <div class="dgs-capacity">
        <div class="dgs-capacity-toolbar">
          <label class="dgs-capacity-month">Month
            <input type="month" id="capacity-month" value="${esc(state.month)}" />
          </label>
          <p class="dgs-capacity-note">${esc(
            data.bucket_rule ||
              "Downtime is eMaint Downtime (Days). Full days attributed to the month of COALESCE(downstart, date_wo)."
          )}</p>
        </div>
        <div class="dgs-capacity-kpis">
          <div class="dgs-capacity-kpi"><div class="label">Downtime (days)</div><div class="value">${esc(
            fmtNum(k.downtime)
          )}</div></div>
          <div class="dgs-capacity-kpi"><div class="label">Work orders</div><div class="value">${esc(
            fmtNum(k.wo_count, 0)
          )}</div></div>
          <div class="dgs-capacity-kpi"><div class="label">Assets</div><div class="value">${esc(
            fmtNum(k.asset_count, 0)
          )}</div></div>
          <div class="dgs-capacity-kpi"><div class="label">Avg days / WO</div><div class="value">${esc(
            fmtNum(k.avg_downtime)
          )}</div></div>
          <div class="dgs-capacity-kpi"><div class="label">Part cost</div><div class="value">${esc(
            fmtMoney(k.part_cost)
          )}</div></div>
        </div>
        <section class="dgs-field-panel dgs-capacity-panel">
          <h2>Downtime days by month <span>12 mo</span></h2>
          ${trendBars(data.trend || [])}
        </section>
        <div class="dgs-capacity-grid">
          <section class="dgs-field-panel">
            <h2>Region</h2>
            ${rankTable("region", (data.geo && data.geo.region) || [], "downtime", fmtNum)}
          </section>
          <section class="dgs-field-panel">
            <h2>State</h2>
            ${rankTable("state", (data.geo && data.geo.state) || [], "downtime", fmtNum)}
          </section>
          <section class="dgs-field-panel">
            <h2>Casino</h2>
            ${rankTable("casino", (data.geo && data.geo.casino) || [], "downtime", fmtNum)}
          </section>
          <section class="dgs-field-panel">
            <h2>Vendor</h2>
            ${rankTable("vendor", (data.product && data.product.vendor) || [], "downtime", fmtNum)}
          </section>
          <section class="dgs-field-panel">
            <h2>Cabinet</h2>
            ${rankTable("cabinet", (data.product && data.product.cabinet) || [], "downtime", fmtNum)}
          </section>
          <section class="dgs-field-panel">
            <h2>Theme</h2>
            ${rankTable("theme", (data.product && data.product.theme) || [], "downtime", fmtNum)}
          </section>
        </div>
        <section class="dgs-field-panel dgs-capacity-panel">
          <h2>Part cost by casino</h2>
          ${partTable(data.part_costs || [])}
        </section>
        <section class="dgs-field-panel dgs-capacity-panel" id="capacity-drill">
          <p class="dgs-field-empty">Select a Region, State, Casino, Vendor, Cabinet, or Theme row to list work orders with downtime days and down start/end.</p>
        </section>
      </div>`;
    document.getElementById("capacity-month")?.addEventListener("change", (event) => {
      state.month = monthInputValue(event.target.value);
      load(root);
    });
    wireRanks(root);
  }

  async function load(root) {
    if (!root || !window.DGSAuth) return;
    root.innerHTML = '<p class="dgs-v2-loading">Loading capacity…</p>';
    try {
      state.data = await fetchJson(
        `/api/capacity-dashboard?month=${encodeURIComponent(state.month)}`
      );
      state.month = state.data.month || state.month;
      render(root);
    } catch (err) {
      root.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
    }
  }

  window.DGSCapacity = { load };
})();
