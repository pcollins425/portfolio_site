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

  const RANK_SORT_COLS = [
    { key: "downtime", label: "Downtime", title: "Downtime (days)", money: false },
    { key: "part_cost", label: "Part cost", title: "Part cost", money: true },
    { key: "wo_count", label: "WOs", title: "Work orders", money: false },
    { key: "asset_count", label: "Assets", title: "Assets", money: false },
  ];

  function sortedRankRows(rows) {
    const key = state.rankSort.key;
    const dir = state.rankSort.dir === "asc" ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      const av = Number(a[key]) || 0;
      const bv = Number(b[key]) || 0;
      if (av !== bv) return (av - bv) * dir;
      return String(a.label || "").localeCompare(String(b.label || ""), undefined, {
        sensitivity: "base",
      });
    });
  }

  function rankSortHeader(col) {
    const active = state.rankSort.key === col.key;
    const arrow = !active ? "" : state.rankSort.dir === "asc" ? " ↑" : " ↓";
    return `<th class="dgs-field-num dgs-capacity-rank-metric">
      <button type="button" class="dgs-capacity-rank-sort${
        active ? " is-active" : ""
      }" data-sort-key="${esc(col.key)}" title="${esc(col.title || col.label)}" aria-pressed="${
      active ? "true" : "false"
    }">
        ${esc(col.label)}${arrow}
      </button>
    </th>`;
  }

  function rankTable(dim, rows) {
    const sorted = sortedRankRows(rows);
    if (!sorted.length) {
      return `<p class="dgs-field-empty">No rows.</p>`;
    }
    const head = `<tr><th>Name</th>${RANK_SORT_COLS.map(rankSortHeader).join("")}</tr>`;
    const body = sorted
      .map((row) => {
        return `<tr class="dgs-capacity-rank-row" data-dim="${esc(dim)}" data-key="${esc(
          row.key
        )}">
          <td>${esc(row.label)}</td>
          <td class="dgs-field-num dgs-capacity-rank-metric">${esc(fmtNum(row.downtime))}</td>
          <td class="dgs-field-num dgs-capacity-rank-metric">${esc(fmtMoney(row.part_cost))}</td>
          <td class="dgs-field-num dgs-capacity-rank-metric">${esc(
            fmtNum(row.wo_count ?? row.line_count, 0)
          )}</td>
          <td class="dgs-field-num dgs-capacity-rank-metric">${esc(
            row.asset_count == null ? "—" : fmtNum(row.asset_count, 0)
          )}</td>
        </tr>`;
      })
      .join("");
    return `<div class="dgs-field-scroll"><table class="dgs-field-table dgs-capacity-rank"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function rankGridHtml(data) {
    return `<div class="dgs-capacity-grid">
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
    </div>`;
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
        const label = row.label || (row.month || "").slice(5) || row.key || "";
        return `<button type="button" class="dgs-capacity-trend-col${
          incomplete ? " is-incomplete" : ""
        }" data-start="${esc(row.start || "")}" data-end="${esc(
          row.end || ""
        )}" data-label="${esc(label)}" title="${esc(rangeNote)}: ${esc(
          fmtMoney(cost)
        )} part cost · ${esc(fmtNum(downtime))} downtime days · ${esc(
          fmtNum(row.wo_count, 0)
        )} WOs${incompleteNote}">
          <div class="dgs-capacity-trend-bar-wrap">
            <div class="${barCls}" style="height:${pct}%"></div>
          </div>
        </button>`;
      })
      .join("");
    const labelCols = trend
      .map((row) => {
        const incomplete = !!row.incomplete;
        const label = row.label || (row.month || "").slice(5) || row.key || "";
        return `<div class="dgs-capacity-trend-label${
          incomplete ? " is-incomplete" : ""
        }" data-start="${esc(row.start || "")}" data-end="${esc(
          row.end || ""
        )}">${esc(label)}</div>`;
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

  const FILTER_DIMS = [
    { key: "region", label: "Region" },
    { key: "tribe", label: "Tribe" },
    { key: "state", label: "State" },
    { key: "casino", label: "Casino" },
    { key: "vendor", label: "Vendor" },
    { key: "cabinet", label: "Cabinet" },
    { key: "theme", label: "Theme" },
  ];

  function emptyFilters() {
    return {
      region: [],
      tribe: [],
      state: [],
      casino: [],
      vendor: [],
      cabinet: [],
      theme: [],
    };
  }

  const defaults = currentMonthBounds();
  let state = {
    start: defaults.start,
    end: defaults.end,
    chartMode: "trailing12",
    data: null,
    drill: null,
    error: "",
    rankSort: { key: "downtime", dir: "desc" },
    filters: emptyFilters(),
    filterOptions: null,
    filterOptionsRange: "",
    filterOpen: false,
    filterCategory: null,
  };

  function activeFilterCount() {
    return FILTER_DIMS.reduce(
      (sum, dim) => sum + ((state.filters[dim.key] || []).length),
      0
    );
  }

  function filterLabel(dim, value) {
    const options =
      (state.filterOptions && state.filterOptions[dim]) || [];
    const hit = options.find((row) => row.value === value);
    return (hit && hit.label) || value;
  }

  function queryParams(extra) {
    const q = new URLSearchParams();
    q.set("start", state.start);
    q.set("end", state.end);
    if (isFullMonth(state.start, state.end)) {
      q.set("chart", state.chartMode === "range" ? "range" : "trailing12");
    }
    FILTER_DIMS.forEach((dim) => {
      const values = state.filters[dim.key] || [];
      if (values.length) q.set(dim.key, values.join(","));
    });
    if (extra) {
      Object.keys(extra).forEach((key) => {
        if (extra[key] != null && extra[key] !== "") q.set(key, extra[key]);
      });
    }
    return q.toString();
  }

  function filterIconSvg() {
    return `<svg class="dgs-capacity-filter-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3 5h14M5.5 10h9M8 15h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
  }

  function activeFilterChipsHtml() {
    const chips = [];
    FILTER_DIMS.forEach((dim) => {
      (state.filters[dim.key] || []).forEach((value) => {
        chips.push(
          `<button type="button" class="dgs-capacity-filter-chip" data-filter-dim="${esc(
            dim.key
          )}" data-filter-value="${esc(value)}" title="Remove filter">
            <span>${esc(dim.label)}: ${esc(filterLabel(dim.key, value))}</span>
            <span class="dgs-capacity-filter-chip-x" aria-hidden="true">×</span>
          </button>`
        );
      });
    });
    if (!chips.length) return "";
    return `<div class="dgs-capacity-filter-chips" id="capacity-filter-chips">
      ${chips.join("")}
      <button type="button" class="dgs-v2-btn dgs-capacity-filter-clear-all" id="capacity-clear-all-filters">Clear all filters</button>
    </div>`;
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

  function ensureDrawer(root) {
    let backdrop = document.getElementById("capacity-drill-backdrop");
    let drawer = document.getElementById("capacity-drill-drawer");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "capacity-drill-backdrop";
      backdrop.className = "dgs-capacity-drawer-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", () => {
        if (state.filterOpen) closeFilterPanel();
        else closeDrill();
      });
    }
    if (!drawer) {
      drawer = document.createElement("aside");
      drawer.id = "capacity-drill-drawer";
      drawer.className = "dgs-capacity-drawer";
      drawer.setAttribute("aria-label", "Work order detail");
      document.body.appendChild(drawer);
      drawer.addEventListener("click", (event) => {
        if (event.target.closest("#capacity-drill-close")) closeDrill();
        if (event.target.closest("#capacity-filter-close")) closeFilterPanel();
      });
    }
    return { backdrop, drawer };
  }

  function closeDrill() {
    state.drill = null;
    if (!state.filterOpen) {
      document.body.classList.remove("capacity-drill-open");
      const drawer = document.getElementById("capacity-drill-drawer");
      if (drawer) drawer.innerHTML = "";
    }
    document.querySelectorAll(".dgs-capacity-trend-col.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
    document.querySelectorAll(".dgs-capacity-rank-row.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
    document.getElementById("capacity-range-drill")?.classList.remove("is-active");
  }

  function closeFilterPanel() {
    state.filterOpen = false;
    state.filterCategory = null;
    document.body.classList.remove("capacity-drill-open");
    const drawer = document.getElementById("capacity-drill-drawer");
    if (drawer) {
      drawer.classList.remove("is-filter");
      drawer.innerHTML = "";
    }
    document.getElementById("capacity-filter-toggle")?.classList.remove("is-active");
  }

  function toggleFilterValue(dim, value, checked) {
    const current = new Set(state.filters[dim] || []);
    if (checked) current.add(value);
    else current.delete(value);
    state.filters[dim] = Array.from(current);
  }

  function clearFilterDim(dim) {
    state.filters[dim] = [];
  }

  function clearAllFilters() {
    state.filters = emptyFilters();
  }

  function removeFilterValue(dim, value) {
    state.filters[dim] = (state.filters[dim] || []).filter((item) => item !== value);
  }

  async function ensureFilterOptions() {
    const rangeKey = `${state.start}|${state.end}`;
    if (state.filterOptions && state.filterOptionsRange === rangeKey) {
      return state.filterOptions;
    }
    const data = await fetchJson(
      `/api/capacity-dashboard/filter-options?${queryParams()}`
    );
    state.filterOptions = (data && data.options) || {};
    state.filterOptionsRange = rangeKey;
    return state.filterOptions;
  }

  function filterPanelHtml() {
    const options = state.filterOptions || {};
    const categories = FILTER_DIMS.map((dim) => {
      const selected = new Set(state.filters[dim.key] || []);
      const open = state.filterCategory === dim.key;
      const items = options[dim.key] || [];
      const count = selected.size;
      const list = open
        ? `<div class="dgs-capacity-filter-options">
            <div class="dgs-capacity-filter-options-actions">
              <button type="button" class="dgs-capacity-filter-clear-dim" data-clear-dim="${esc(
                dim.key
              )}">Clear selection</button>
            </div>
            <div class="dgs-capacity-filter-option-list">
              ${
                items.length
                  ? items
                      .map((item) => {
                        const checked = selected.has(item.value);
                        return `<label class="dgs-capacity-filter-option">
                          <input type="checkbox" data-filter-dim="${esc(
                            dim.key
                          )}" data-filter-value="${esc(item.value)}"${
                          checked ? " checked" : ""
                        } />
                          <span>${esc(item.label)}</span>
                        </label>`;
                      })
                      .join("")
                  : `<p class="dgs-field-empty">No values in this range.</p>`
              }
            </div>
          </div>`
        : "";
      return `<div class="dgs-capacity-filter-cat${open ? " is-open" : ""}">
        <button type="button" class="dgs-capacity-filter-cat-btn" data-filter-cat="${esc(
          dim.key
        )}" aria-expanded="${open ? "true" : "false"}">
          <span>${esc(dim.label)}</span>
          <span class="dgs-capacity-filter-cat-meta">${
            count ? esc(String(count)) : ""
          } <span class="dgs-capacity-filter-caret" aria-hidden="true">${
            open ? "▾" : "▸"
          }</span></span>
        </button>
        ${list}
      </div>`;
    }).join("");

    const chips = [];
    FILTER_DIMS.forEach((dim) => {
      (state.filters[dim.key] || []).forEach((value) => {
        chips.push(
          `<button type="button" class="dgs-capacity-filter-chip" data-filter-dim="${esc(
            dim.key
          )}" data-filter-value="${esc(value)}">
            <span>${esc(dim.label)}: ${esc(filterLabel(dim.key, value))}</span>
            <span class="dgs-capacity-filter-chip-x" aria-hidden="true">×</span>
          </button>`
        );
      });
    });

    return `
      <div class="dgs-capacity-drawer-head">
        <div>
          <p class="dgs-capacity-drawer-kicker">Capacity filters</p>
          <h2>Filter work orders</h2>
          <p class="dgs-capacity-drawer-meta">${esc(state.start)} → ${esc(
      state.end
    )}</p>
        </div>
        <button type="button" class="dgs-v2-btn" id="capacity-filter-close">Close</button>
      </div>
      <div class="dgs-capacity-drawer-body dgs-capacity-filter-body">
        <div class="dgs-capacity-filter-active">
          <div class="dgs-capacity-filter-active-head">
            <span>Active filters</span>
            <button type="button" class="dgs-capacity-filter-clear-all" id="capacity-panel-clear-all"${
              chips.length ? "" : " disabled"
            }>Clear all filters</button>
          </div>
          <div class="dgs-capacity-filter-chip-row">
            ${
              chips.length
                ? chips.join("")
                : `<p class="dgs-capacity-filter-empty">No filters applied.</p>`
            }
          </div>
        </div>
        <div class="dgs-capacity-filter-cats">${categories}</div>
      </div>`;
  }

  function wireFilterPanel(root, drawer) {
    drawer.querySelectorAll("[data-filter-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dim = btn.getAttribute("data-filter-cat");
        state.filterCategory = state.filterCategory === dim ? null : dim;
        drawer.innerHTML = filterPanelHtml();
        wireFilterPanel(root, drawer);
      });
    });
    drawer.querySelectorAll('input[type="checkbox"][data-filter-dim]').forEach((input) => {
      input.addEventListener("change", () => {
        toggleFilterValue(
          input.getAttribute("data-filter-dim"),
          input.getAttribute("data-filter-value"),
          input.checked
        );
        drawer.innerHTML = filterPanelHtml();
        wireFilterPanel(root, drawer);
        refreshFilterChrome(root);
        load(root, { keepFilterOpen: true });
      });
    });
    drawer.querySelectorAll("[data-clear-dim]").forEach((btn) => {
      btn.addEventListener("click", () => {
        clearFilterDim(btn.getAttribute("data-clear-dim"));
        drawer.innerHTML = filterPanelHtml();
        wireFilterPanel(root, drawer);
        refreshFilterChrome(root);
        load(root, { keepFilterOpen: true });
      });
    });
    drawer.querySelectorAll(".dgs-capacity-filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFilterValue(
          btn.getAttribute("data-filter-dim"),
          btn.getAttribute("data-filter-value")
        );
        drawer.innerHTML = filterPanelHtml();
        wireFilterPanel(root, drawer);
        refreshFilterChrome(root);
        load(root, { keepFilterOpen: true });
      });
    });
    drawer
      .querySelector("#capacity-panel-clear-all")
      ?.addEventListener("click", () => {
        clearAllFilters();
        drawer.innerHTML = filterPanelHtml();
        wireFilterPanel(root, drawer);
        refreshFilterChrome(root);
        load(root, { keepFilterOpen: true });
      });
  }

  function refreshFilterChrome(root) {
    const toggle = document.getElementById("capacity-filter-toggle");
    if (toggle) {
      const count = activeFilterCount();
      toggle.classList.toggle("is-active", state.filterOpen || count > 0);
      toggle.classList.toggle("has-filters", count > 0);
      const badge = toggle.querySelector(".dgs-capacity-filter-badge");
      if (badge) badge.textContent = count ? String(count) : "";
    }
    const host = root.querySelector(".dgs-capacity-filter-chips-host");
    if (host) host.innerHTML = activeFilterChipsHtml();
    wireFilterChips(root);
  }

  function wireFilterChips(root) {
    root.querySelectorAll("#capacity-filter-chips .dgs-capacity-filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFilterValue(
          btn.getAttribute("data-filter-dim"),
          btn.getAttribute("data-filter-value")
        );
        if (state.filterOpen) {
          const drawer = document.getElementById("capacity-drill-drawer");
          if (drawer) {
            drawer.innerHTML = filterPanelHtml();
            wireFilterPanel(root, drawer);
          }
        }
        refreshFilterChrome(root);
        load(root, { keepFilterOpen: state.filterOpen });
      });
    });
    document.getElementById("capacity-clear-all-filters")?.addEventListener("click", () => {
      clearAllFilters();
      if (state.filterOpen) {
        const drawer = document.getElementById("capacity-drill-drawer");
        if (drawer) {
          drawer.innerHTML = filterPanelHtml();
          wireFilterPanel(root, drawer);
        }
      }
      refreshFilterChrome(root);
      load(root, { keepFilterOpen: state.filterOpen });
    });
  }

  async function openFilterPanel(root) {
    closeDrill();
    const { drawer } = ensureDrawer(root);
    state.filterOpen = true;
    document.body.classList.add("capacity-drill-open");
    drawer.classList.add("is-filter");
    drawer.setAttribute("aria-label", "Capacity filters");
    drawer.innerHTML = `<div class="dgs-capacity-drawer-inner"><p class="dgs-v2-loading">Loading filters…</p></div>`;
    document.getElementById("capacity-filter-toggle")?.classList.add("is-active");
    try {
      await ensureFilterOptions();
      drawer.innerHTML = filterPanelHtml();
      wireFilterPanel(root, drawer);
    } catch (err) {
      drawer.innerHTML = `
        <div class="dgs-capacity-drawer-head">
          <h2>Filters</h2>
          <button type="button" class="dgs-v2-btn" id="capacity-filter-close">Close</button>
        </div>
        <div class="dgs-capacity-drawer-body"><p class="error-box">${esc(
          err.message || err
        )}</p></div>`;
    }
  }

  function drillTitle(options) {
    if (options.dim && options.dim !== "range") {
      return `Work orders · ${options.dim} · ${options.key || ""}`;
    }
    if (options.label) return `Work orders · ${options.label}`;
    return `Work orders · ${options.start || state.start} → ${options.end || state.end}`;
  }

  async function openDrill(root, options) {
    if (state.filterOpen) closeFilterPanel();
    const { drawer } = ensureDrawer(root);
    drawer.classList.remove("is-filter");
    drawer.setAttribute("aria-label", "Work order detail");
    const start = options.start || state.start;
    const end = options.end || state.end;
    const dim = options.dim || "range";
    const key = options.key || "";
    document.querySelectorAll(".dgs-capacity-trend-col.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
    document.querySelectorAll(".dgs-capacity-rank-row.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
    document.getElementById("capacity-range-drill")?.classList.remove("is-active");
    if (options.sourceEl) options.sourceEl.classList.add("is-active");

    document.body.classList.add("capacity-drill-open");
    drawer.innerHTML = `<div class="dgs-capacity-drawer-inner"><p class="dgs-v2-loading">Loading work orders…</p></div>`;

    try {
      const params = { start, end, dim };
      if (dim !== "range") params.key = key;
      const data = await fetchJson(`/api/capacity-dashboard/drill?${queryParams(params)}`);
      state.drill = data;
      const orders = data.orders || [];
      drawer.innerHTML = `
        <div class="dgs-capacity-drawer-head">
          <div>
            <p class="dgs-capacity-drawer-kicker">Capacity detail</p>
            <h2>${esc(drillTitle({ ...options, start, end, dim, key }))}</h2>
            <p class="dgs-capacity-drawer-meta">${esc(start)} → ${esc(end)} · ${orders.length} shown</p>
          </div>
          <button type="button" class="dgs-v2-btn" id="capacity-drill-close">Close</button>
        </div>
        <div class="dgs-capacity-drawer-body">
          ${table(
            [
              { label: "WO #", cls: "dgs-field-num" },
              { label: "Downtime (days)", cls: "dgs-field-num" },
              { label: "Part cost", cls: "dgs-field-num" },
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
              fmtMoney(row.part_cost),
              row.downstart,
              row.downend,
              { html: propertyCell(row) },
              { html: serialCell(row) },
              { html: vendorCell(row) },
              { html: cabinetCell(row) },
              { html: themeCell(row) },
            ]),
            "No work orders in this selection."
          )}
        </div>`;
    } catch (err) {
      drawer.innerHTML = `
        <div class="dgs-capacity-drawer-head">
          <h2>Work orders</h2>
          <button type="button" class="dgs-v2-btn" id="capacity-drill-close">Close</button>
        </div>
        <div class="dgs-capacity-drawer-body"><p class="error-box">${esc(
          err.message || err
        )}</p></div>`;
    }
  }

  function wireRanks(root) {
    root.querySelectorAll(".dgs-capacity-rank-row").forEach((row) => {
      row.addEventListener("click", () => {
        openDrill(root, {
          dim: row.getAttribute("data-dim"),
          key: row.getAttribute("data-key"),
          start: state.start,
          end: state.end,
          sourceEl: row,
        });
      });
    });
  }

  function refreshRankGrid(root) {
    const grid = root.querySelector(".dgs-capacity-grid");
    if (!grid || !state.data) return;
    grid.outerHTML = rankGridHtml(state.data);
    wireRanks(root);
    wireRankSort(root);
  }

  function wireRankSort(root) {
    root.querySelectorAll(".dgs-capacity-rank-sort").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = btn.getAttribute("data-sort-key");
        if (!key) return;
        if (state.rankSort.key === key) {
          state.rankSort.dir = state.rankSort.dir === "desc" ? "asc" : "desc";
        } else {
          state.rankSort = { key, dir: "desc" };
        }
        refreshRankGrid(root);
      });
    });
  }

  function wireChart(root) {
    root.querySelectorAll(".dgs-capacity-trend-col").forEach((col) => {
      col.addEventListener("mouseenter", () => {
        const start = col.getAttribute("data-start");
        root.querySelectorAll(".dgs-capacity-trend-label").forEach((label) => {
          label.classList.toggle(
            "is-hover",
            label.getAttribute("data-start") === start
          );
        });
      });
      col.addEventListener("mouseleave", () => {
        root.querySelectorAll(".dgs-capacity-trend-label.is-hover").forEach((label) => {
          label.classList.remove("is-hover");
        });
      });
      col.addEventListener("click", () => {
        openDrill(root, {
          dim: "range",
          start: col.getAttribute("data-start"),
          end: col.getAttribute("data-end"),
          label: col.getAttribute("data-label"),
          sourceEl: col,
        });
      });
    });
    document.getElementById("capacity-range-drill")?.addEventListener("click", () => {
      openDrill(root, {
        dim: "range",
        start: state.start,
        end: state.end,
        label: `${state.start} → ${state.end}`,
        sourceEl: document.getElementById("capacity-range-drill"),
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

    const filterCount = activeFilterCount();
    root.innerHTML = `
      <div class="dgs-capacity">
        <div class="dgs-capacity-toolbar">
          <label class="dgs-capacity-date">From
            <input type="date" id="capacity-start" value="${esc(state.start)}" />
          </label>
          <label class="dgs-capacity-date">To
            <input type="date" id="capacity-end" value="${esc(state.end)}" />
          </label>
          <button type="button" class="dgs-capacity-filter-btn${
            state.filterOpen || filterCount ? " is-active" : ""
          }${filterCount ? " has-filters" : ""}" id="capacity-filter-toggle" title="Filters" aria-label="Filters" aria-expanded="${
      state.filterOpen ? "true" : "false"
    }">
            ${filterIconSvg()}
            <span class="dgs-capacity-filter-badge">${
              filterCount ? esc(String(filterCount)) : ""
            }</span>
          </button>
          <button type="button" class="dgs-v2-btn" id="capacity-apply">Apply</button>
          <button type="button" class="dgs-v2-btn" id="capacity-whole-month">Whole month</button>
          ${
            fullMonth
              ? `<button type="button" class="dgs-v2-btn" id="capacity-chart-toggle">${esc(
                  toggleLabel
                )}</button>`
              : ""
          }
        </div>
        <div class="dgs-capacity-filter-chips-host">${activeFilterChipsHtml()}</div>
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
          <h2 class="dgs-capacity-chart-heading">
            <button type="button" class="dgs-capacity-chart-select" id="capacity-range-drill" title="List all work orders in the selected date range">
              ${esc(chartTitle)}
            </button>
            <span>${esc(chartSubtitle)}</span>
          </h2>
          <p class="dgs-capacity-chart-hint">Hover a period to highlight · click a bar or the title for work orders</p>
          ${trendBars((data && data.trend) || [], grain)}
        </section>
        ${rankGridHtml(data)}
      </div>`;

    document.getElementById("capacity-apply")?.addEventListener("click", () => {
      applyRangeInputs(root);
    });
    document.getElementById("capacity-filter-toggle")?.addEventListener("click", () => {
      if (state.filterOpen) closeFilterPanel();
      else openFilterPanel(root);
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
    wireFilterChips(root);
    wireRanks(root);
    wireRankSort(root);
    wireChart(root);
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
    if (state.filterOpen) {
      const drawer = document.getElementById("capacity-drill-drawer");
      if (drawer && drawer.classList.contains("is-filter")) {
        drawer.innerHTML = filterPanelHtml();
        wireFilterPanel(root, drawer);
      }
    }
  }

  async function load(root, options) {
    if (!root || !window.DGSAuth) return;
    const keepFilterOpen = !!(options && options.keepFilterOpen);
    if (!keepFilterOpen) {
      closeDrill();
      if (state.filterOpen) closeFilterPanel();
      root.innerHTML = '<p class="dgs-v2-loading">Loading capacity…</p>';
    } else {
      state.drill = null;
    }
    try {
      state.data = await fetchJson(`/api/capacity-dashboard?${queryParams()}`);
      state.start = state.data.start || state.start;
      state.end = state.data.end || state.end;
      if (state.data.chart_mode) state.chartMode = state.data.chart_mode;
      state.error = "";
      state.drill = null;
      state.rankSort = { key: "downtime", dir: "desc" };
      // Date-range change invalidates option cache.
      if (!keepFilterOpen) state.filterOptionsRange = "";
      if (keepFilterOpen) state.filterOpen = true;
      render(root);
      if (keepFilterOpen) {
        const drawer = document.getElementById("capacity-drill-drawer");
        if (drawer) {
          document.body.classList.add("capacity-drill-open");
          drawer.classList.add("is-filter");
          drawer.setAttribute("aria-label", "Capacity filters");
          drawer.innerHTML = filterPanelHtml();
          wireFilterPanel(root, drawer);
        }
      }
    } catch (err) {
      if (keepFilterOpen) {
        state.error = err.message || String(err);
        state.filterOpen = true;
        render(root);
        const drawer = document.getElementById("capacity-drill-drawer");
        if (drawer) {
          document.body.classList.add("capacity-drill-open");
          drawer.classList.add("is-filter");
          drawer.innerHTML = filterPanelHtml();
          wireFilterPanel(root, drawer);
        }
      } else {
        root.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
      }
    }
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.body.classList.contains("capacity-drill-open")) return;
    if (state.filterOpen) closeFilterPanel();
    else closeDrill();
  });

  window.DGSCapacity = { load };
})();
