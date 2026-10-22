/* Capacity dashboard — downtime and part cost for Ops / Finance. */
(function () {
  "use strict";

  const MAX_SPAN_DAYS = 365;

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

  function isoDay(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseIsoDay(value) {
    const text = String(value || "").slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function currentMonthBounds() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: isoDay(start), end: isoDay(end) };
  }

  function monthBoundsFor(dayIso) {
    const d = parseIsoDay(dayIso) || new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: isoDay(start), end: isoDay(end) };
  }

  function isFullMonth(startIso, endIso) {
    const start = parseIsoDay(startIso);
    const end = parseIsoDay(endIso);
    if (!start || !end) return false;
    if (
      start.getFullYear() !== end.getFullYear() ||
      start.getMonth() !== end.getMonth()
    ) {
      return false;
    }
    const last = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    return start.getDate() === 1 && end.getDate() === last;
  }

  function spanDays(startIso, endIso) {
    const start = parseIsoDay(startIso);
    const end = parseIsoDay(endIso);
    if (!start || !end) return 0;
    return Math.floor((end - start) / 86400000) + 1;
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

  function rankTable(dim, rows) {
    if (!rows.length) {
      return `<p class="dgs-field-empty">No rows.</p>`;
    }
    const head = `<tr><th>Name</th><th class="dgs-field-num">Downtime (days)</th><th class="dgs-field-num">Part cost</th><th class="dgs-field-num">WOs</th><th class="dgs-field-num">Assets</th></tr>`;
    const body = rows
      .map((row) => {
        return `<tr class="dgs-capacity-rank-row" data-dim="${esc(dim)}" data-key="${esc(
          row.key
        )}">
          <td>${esc(row.label)}</td>
          <td class="dgs-field-num">${esc(fmtNum(row.downtime))}</td>
          <td class="dgs-field-num">${esc(fmtMoney(row.part_cost))}</td>
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
      return `<p class="dgs-field-empty">No part cost for this range.</p>`;
    }
    const head = `<tr><th>Casino</th><th class="dgs-field-num">Part cost</th><th class="dgs-field-num">Lines</th></tr>`;
    const body = rows
      .map((row) => {
        const href =
          row.key && row.key !== "Unassigned" && window.DGSCasinoNav
            ? DGSCasinoNav.hubHref(row.key)
            : "";
        const name = href ? hubCell(href, row.label) : esc(row.label);
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

  function axisName(grain) {
    if (grain === "day") return "Day";
    if (grain === "week") return "Week";
    return "Month";
  }

  function fmtAxisMoney(n) {
    const value = Number(n) || 0;
    if (value >= 1000) {
      return `$${Math.round(value / 100) / 10}k`;
    }
    return `$${Math.round(value)}`;
  }

  function trendBars(trend, grain) {
    if (!trend.length) {
      return `<p class="dgs-field-empty">No downtime trend yet.</p>`;
    }
    const costMax = niceCeiling(
      Math.max(...trend.map((row) => Number(row.part_cost) || 0), 0) || 1
    );
    const downMax = niceCeiling(
      Math.max(...trend.map((row) => Number(row.downtime) || 0), 0) || 1
    );
    const costTicks = [costMax, costMax * 0.75, costMax * 0.5, costMax * 0.25, 0];
    const downTicks = [downMax, downMax * 0.75, downMax * 0.5, downMax * 0.25, 0];
    const costTickHtml = costTicks
      .map(
        (tick) =>
          `<div class="dgs-capacity-trend-tick is-cost"><span>${esc(
            fmtAxisMoney(tick)
          )}</span></div>`
      )
      .join("");
    const downTickHtml = downTicks
      .map(
        (tick) =>
          `<div class="dgs-capacity-trend-tick is-down"><span>${esc(
            fmtNum(tick)
          )}</span></div>`
      )
      .join("");
    const gridHtml = costTicks
      .map(
        (tick) =>
          `<div class="dgs-capacity-trend-gridline" style="bottom:${
            (tick / costMax) * 100
          }%"></div>`
      )
      .join("");

    const n = trend.length;
    const downSeries = trend.map((row) => Number(row.downtime) || 0);
    const barCols = trend
      .map((row) => {
        const cost = Number(row.part_cost) || 0;
        const downtime = Number(row.downtime) || 0;
        const pct = costMax ? (cost / costMax) * 100 : 0;
        const incomplete = !!row.incomplete;
        const rangeNote =
          row.start && row.end ? `${row.start} → ${row.end}` : row.key || "";
        const incompleteNote = incomplete ? " · incomplete" : "";
        const barCls = incomplete
          ? "dgs-capacity-trend-bar is-incomplete"
          : "dgs-capacity-trend-bar";
        return `<div class="dgs-capacity-trend-col${
          incomplete ? " is-incomplete" : ""
        }" title="${esc(rangeNote)}: ${esc(fmtMoney(cost))} part cost · ${esc(
          fmtNum(downtime)
        )} downtime days · ${esc(fmtNum(row.wo_count, 0))} WOs${incompleteNote}">
          <div class="dgs-capacity-trend-bar-wrap">
            <div class="${barCls}" style="height:${pct}%"></div>
          </div>
        </div>`;
      })
      .join("");
    const labelCols = trend
      .map((row) => {
        const incomplete = !!row.incomplete;
        const label = row.label || (row.month || "").slice(5) || row.key || "";
        return `<div class="dgs-capacity-trend-label${
          incomplete ? " is-incomplete" : ""
        }">${esc(label)}</div>`;
      })
      .join("");

    return `<div class="dgs-capacity-trend-chart is-combo" role="img" aria-label="Part cost and downtime ${esc(
      axisName(grain).toLowerCase()
    )}">
      <div class="dgs-capacity-trend-yaxis-name is-cost">Part cost</div>
      <div class="dgs-capacity-trend-yaxis is-cost">${costTickHtml}</div>
      <div class="dgs-capacity-trend-plot">
        <div class="dgs-capacity-trend-body" data-down-max="${esc(String(downMax))}" data-down-series="${esc(
      JSON.stringify(downSeries)
    )}">
          <div class="dgs-capacity-trend-grid">${gridHtml}</div>
          <div class="dgs-capacity-trend" style="--capacity-trend-n:${n}">${barCols}</div>
          <svg class="dgs-capacity-trend-line" aria-hidden="true"></svg>
        </div>
        <div class="dgs-capacity-trend-labels" style="--capacity-trend-n:${n}">${labelCols}</div>
      </div>
      <div class="dgs-capacity-trend-yaxis is-down">${downTickHtml}</div>
      <div class="dgs-capacity-trend-yaxis-name is-down">Downtime (days)</div>
      <div class="dgs-capacity-trend-legend">
        <span class="is-cost">Part cost</span>
        <span class="is-down">Downtime</span>
      </div>
      <div class="dgs-capacity-trend-xaxis-name">${esc(axisName(grain))}</div>
    </div>`;
  }

  function layoutTrendLine(root) {
    const body = root.querySelector(".dgs-capacity-trend-body");
    const svg = root.querySelector("svg.dgs-capacity-trend-line");
    if (!body || !svg) return;
    let series = [];
    try {
      series = JSON.parse(body.getAttribute("data-down-series") || "[]");
    } catch (_) {
      series = [];
    }
    if (!Array.isArray(series) || !series.length) {
      svg.replaceChildren();
      return;
    }
    const downMax = Number(body.getAttribute("data-down-max")) || 1;
    const width = Math.max(body.clientWidth || 0, 1);
    const height = Math.max(body.clientHeight || 0, 1);
    const n = series.length;
    const points = series.map((value, i) => {
      const x = ((i + 0.5) / n) * width;
      const y = height - ((Number(value) || 0) / downMax) * height;
      return [x, y];
    });
    const ns = "http://www.w3.org/2000/svg";
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.removeAttribute("preserveAspectRatio");
    svg.replaceChildren();

    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("points", points.map(([x, y]) => `${x},${y}`).join(" "));
    svg.appendChild(line);

    points.forEach(([x, y]) => {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("class", "dgs-capacity-trend-dot");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", "3.5");
      svg.appendChild(dot);
    });
  }

  let trendResizeObserver = null;

  const defaults = currentMonthBounds();
  let state = {
    start: defaults.start,
    end: defaults.end,
    chartMode: "trailing12",
    data: null,
    drill: null,
    error: "",
  };

  function queryParams(extra) {
    const q = new URLSearchParams();
    q.set("start", state.start);
    q.set("end", state.end);
    if (isFullMonth(state.start, state.end)) {
      q.set("chart", state.chartMode === "range" ? "range" : "trailing12");
    }
    if (extra) {
      Object.keys(extra).forEach((key) => q.set(key, extra[key]));
    }
    return q.toString();
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
        /* keep text */
      }
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
        `/api/capacity-dashboard/drill?${queryParams({
          dim,
          key,
        })}`
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

  function applyRangeInputs(root, options) {
    const startEl = document.getElementById("capacity-start");
    const endEl = document.getElementById("capacity-end");
    if (!startEl || !endEl) return;
    let start = startEl.value;
    let end = endEl.value;
    if (!start || !end) {
      state.error = "Start and end dates are required.";
      render(root);
      return;
    }
    if (end < start) {
      state.error = "End must be on or after start.";
      render(root);
      return;
    }
    if (spanDays(start, end) > MAX_SPAN_DAYS) {
      state.error = `Range cannot exceed ${MAX_SPAN_DAYS} days.`;
      render(root);
      return;
    }
    state.error = "";
    state.start = start;
    state.end = end;
    if (!isFullMonth(start, end)) {
      state.chartMode = "range";
    } else if (options && options.forceTrailing12) {
      state.chartMode = "trailing12";
    } else if (state.chartMode !== "range") {
      state.chartMode = "trailing12";
    }
    load(root);
  }

  function render(root) {
    const data = state.data;
    const k = (data && data.kpis) || {};
    const fullMonth = isFullMonth(state.start, state.end);
    const chartMode = fullMonth ? state.chartMode : "range";
    const chartTitle =
      (data && data.chart_title) ||
      (chartMode === "trailing12"
        ? "Part cost & downtime by month"
        : "Part cost & downtime");
    const chartSubtitle =
      (data && data.chart_subtitle) ||
      (chartMode === "trailing12" ? "trailing 12 mo" : "");
    const grain = (data && data.chart_grain) || "month";
    const toggleLabel =
      chartMode === "trailing12" ? "Show range breakdown" : "Show trailing 12 months";

    root.innerHTML = `
      <div class="dgs-capacity">
        <div class="dgs-capacity-toolbar">
          <label class="dgs-capacity-date">From
            <input type="date" id="capacity-start" value="${esc(state.start)}" />
          </label>
          <label class="dgs-capacity-date">To
            <input type="date" id="capacity-end" value="${esc(state.end)}" />
          </label>
          <button type="button" class="dgs-v2-btn" id="capacity-apply">Apply</button>
          <button type="button" class="dgs-v2-btn" id="capacity-whole-month">Whole month</button>
          ${
            fullMonth
              ? `<button type="button" class="dgs-v2-btn" id="capacity-chart-toggle">${esc(
                  toggleLabel
                )}</button>`
              : ""
          }
          <p class="dgs-capacity-note">${esc(
            (data && data.bucket_rule) ||
              "Downtime is eMaint Downtime (Days). Full days attributed to COALESCE(downstart, date_wo) within the selected range."
          )}</p>
        </div>
        ${
          state.error
            ? `<p class="error-box">${esc(state.error)}</p>`
            : ""
        }
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
          <h2>${esc(chartTitle)} <span>${esc(chartSubtitle)}</span></h2>
          ${trendBars((data && data.trend) || [], grain)}
        </section>
        <div class="dgs-capacity-grid">
          <section class="dgs-field-panel">
            <h2>Region</h2>
            ${rankTable("region", (data && data.geo && data.geo.region) || [])}
          </section>
          <section class="dgs-field-panel">
            <h2>State</h2>
            ${rankTable("state", (data && data.geo && data.geo.state) || [])}
          </section>
          <section class="dgs-field-panel">
            <h2>Casino</h2>
            ${rankTable("casino", (data && data.geo && data.geo.casino) || [])}
          </section>
          <section class="dgs-field-panel">
            <h2>Vendor</h2>
            ${rankTable("vendor", (data && data.product && data.product.vendor) || [])}
          </section>
          <section class="dgs-field-panel">
            <h2>Cabinet</h2>
            ${rankTable("cabinet", (data && data.product && data.product.cabinet) || [])}
          </section>
          <section class="dgs-field-panel">
            <h2>Theme</h2>
            ${rankTable("theme", (data && data.product && data.product.theme) || [])}
          </section>
        </div>
        <section class="dgs-field-panel dgs-capacity-panel">
          <h2>Part cost by casino</h2>
          ${partTable((data && data.part_costs) || [])}
        </section>
        <section class="dgs-field-panel dgs-capacity-panel" id="capacity-drill">
          <p class="dgs-field-empty">Select a Region, State, Casino, Vendor, Cabinet, or Theme row to list work orders with downtime days and down start/end.</p>
        </section>
      </div>`;

    document.getElementById("capacity-apply")?.addEventListener("click", () => {
      applyRangeInputs(root);
    });
    document.getElementById("capacity-whole-month")?.addEventListener("click", () => {
      const startEl = document.getElementById("capacity-start");
      const endEl = document.getElementById("capacity-end");
      const anchor = (endEl && endEl.value) || (startEl && startEl.value) || state.end;
      const bounds = monthBoundsFor(anchor);
      if (startEl) startEl.value = bounds.start;
      if (endEl) endEl.value = bounds.end;
      state.chartMode = "trailing12";
      applyRangeInputs(root, { forceTrailing12: true });
    });
    document.getElementById("capacity-chart-toggle")?.addEventListener("click", () => {
      state.chartMode = state.chartMode === "trailing12" ? "range" : "trailing12";
      load(root);
    });
    const onEnter = (event) => {
      if (event.key === "Enter") applyRangeInputs(root);
    };
    document.getElementById("capacity-start")?.addEventListener("keydown", onEnter);
    document.getElementById("capacity-end")?.addEventListener("keydown", onEnter);
    wireRanks(root);
    layoutTrendLine(root);
    if (trendResizeObserver) {
      trendResizeObserver.disconnect();
      trendResizeObserver = null;
    }
    const trendBody = root.querySelector(".dgs-capacity-trend-body");
    if (trendBody && typeof ResizeObserver !== "undefined") {
      trendResizeObserver = new ResizeObserver(() => layoutTrendLine(root));
      trendResizeObserver.observe(trendBody);
    }
  }

  async function load(root) {
    if (!root || !window.DGSAuth) return;
    root.innerHTML = '<p class="dgs-v2-loading">Loading capacity…</p>';
    try {
      state.data = await fetchJson(`/api/capacity-dashboard?${queryParams()}`);
      state.start = state.data.start || state.start;
      state.end = state.data.end || state.end;
      if (state.data.chart_mode) state.chartMode = state.data.chart_mode;
      state.error = "";
      state.drill = null;
      render(root);
    } catch (err) {
      root.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
    }
  }

  window.DGSCapacity = { load };
})();
