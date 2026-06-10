(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");

  const state = {
    pivot: null,
    highlightProperty: null,
    selection: null,
    drawer: {
      open: false,
      filter: null,
      search: "",
      page: 1,
      totalPages: 1,
      totalItems: 0,
    },
  };

  const els = {
    grandTotal: document.getElementById("grand-total"),
    warehouseCount: document.getElementById("warehouse-count"),
    summaryGrid: document.getElementById("summary-grid"),
    pivotThead: document.getElementById("pivot-thead"),
    pivotTbody: document.getElementById("pivot-tbody"),
    errorBox: document.getElementById("error-box"),
    backdrop: document.getElementById("detail-backdrop"),
    drawer: document.getElementById("detail-drawer"),
    detailLabel: document.getElementById("detail-label"),
    detailTitle: document.getElementById("detail-title"),
    detailSubtitle: document.getElementById("detail-subtitle"),
    drawerSearchInput: document.getElementById("drawer-search-input"),
    drawerSearchBtn: document.getElementById("drawer-search-btn"),
    drawerTbody: document.getElementById("drawer-tbody"),
    drawerStatus: document.getElementById("drawer-status"),
    drawerPager: document.getElementById("drawer-pager"),
    drawerPrevPage: document.getElementById("drawer-prev-page"),
    drawerNextPage: document.getElementById("drawer-next-page"),
    btnCloseDetail: document.getElementById("btn-close-detail"),
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
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function shortWarehouseName(property) {
    return String(property || "").replace(/\s+Warehouse$/i, "").trim() || property;
  }

  function renderSummaryCards() {
    const p = state.pivot;
    if (!p) return;

    els.summaryGrid.innerHTML = p.columns
      .map((col) => {
        const active = col.property === state.highlightProperty;
        return `
        <button type="button" class="summary-card${active ? " active" : ""}" data-property="${esc(col.property)}">
          <span class="summary-card__count">${fmtNum(col.total)}</span>
          <span class="summary-card__label">${esc(col.property)}</span>
        </button>`;
      })
      .join("");

    els.summaryGrid.querySelectorAll("[data-property]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const property = btn.dataset.property;
        state.highlightProperty = state.highlightProperty === property ? null : property;
        renderSummaryCards();
        renderPivot();
        if (state.highlightProperty) {
          openColumnDrill(state.highlightProperty);
        }
      });
    });
  }

  function cabinetLabel(row) {
    return (row.cabinet || "").trim() || row.label || "—";
  }

  function manufacturerKey(row) {
    return (row.manufacturer || "").trim() || "—";
  }

  function cellClass(property, row) {
    const selected = state.selection;
    const highlightCol = state.highlightProperty && state.highlightProperty === property;
    const classes = ["pivot-cell"];
    if (highlightCol) classes.push("pivot-col-highlight");
    if (
      selected &&
      selected.kind === "cell" &&
      selected.property === property &&
      selected.manufacturer === row.manufacturer &&
      selected.cabinet === row.cabinet
    ) {
      classes.push("pivot-cell--selected");
    }
    return classes.join(" ");
  }

  function renderPivot() {
    const p = state.pivot;
    if (!p) return;

    const headerCells = p.columns
      .map((col) => {
        const highlight = state.highlightProperty === col.property ? " pivot-col-highlight" : "";
        return `
        <th class="pivot-col-header${highlight}" data-property="${esc(col.property)}" scope="col">
          <span class="pivot-col-name">${esc(shortWarehouseName(col.property))}</span>
          <span class="pivot-col-total">${fmtNum(col.total)}</span>
        </th>`;
      })
      .join("");

    els.pivotThead.innerHTML = `
      <tr>
        <th scope="col" class="pivot-row-header">Manufacturer &amp; cabinet</th>
        ${headerCells}
        <th scope="col" class="pivot-total-header">Total</th>
      </tr>`;

    const colSpan = p.columns.length + 2;
    let lastManufacturer = null;
    const bodyHtml = [];

    p.rows.forEach((row) => {
      const mfg = manufacturerKey(row);
      if (mfg !== lastManufacturer) {
        bodyHtml.push(`
        <tr class="pivot-group-row">
          <th scope="row" colspan="${colSpan}">${esc(mfg)}</th>
        </tr>`);
        lastManufacturer = mfg;
      }

      const rowSelected =
        state.selection &&
        state.selection.kind === "row" &&
        state.selection.manufacturer === row.manufacturer &&
        state.selection.cabinet === row.cabinet;
      const cells = p.columns
        .map((col) => {
          const count = row.counts[col.property] || 0;
          const clickable = count > 0 ? ' class="pivot-cell-btn"' : ' disabled class="pivot-cell-btn pivot-cell-btn--empty"';
          return `
            <td class="${cellClass(col.property, row)}" data-property="${esc(col.property)}">
              <button type="button"${clickable} data-kind="cell" data-property="${esc(col.property)}" data-manufacturer="${esc(row.manufacturer || "")}" data-cabinet="${esc(row.cabinet || "")}">
                ${count ? fmtNum(count) : "—"}
              </button>
            </td>`;
        })
        .join("");

      bodyHtml.push(`
        <tr class="${rowSelected ? "pivot-row--selected" : ""}">
          <th scope="row" class="pivot-row-label pivot-row-label--cabinet">
            <button type="button" class="pivot-row-btn" data-kind="row" data-manufacturer="${esc(row.manufacturer || "")}" data-cabinet="${esc(row.cabinet || "")}">
              ${esc(cabinetLabel(row))}
            </button>
          </th>
          ${cells}
          <td class="pivot-total-cell">${fmtNum(row.total)}</td>
        </tr>`);
    });

    els.pivotTbody.innerHTML = bodyHtml.join("");

    els.pivotThead.querySelectorAll(".pivot-col-header[data-property]").forEach((th) => {
      th.addEventListener("click", () => openColumnDrill(th.dataset.property));
    });

    els.pivotTbody.querySelectorAll(".pivot-cell-btn[data-kind='cell']:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openCellDrill(btn.dataset);
      });
    });

    els.pivotTbody.querySelectorAll(".pivot-row-btn").forEach((btn) => {
      btn.addEventListener("click", () => openRowDrill(btn.dataset));
    });
  }

  function setDrawerOpen(open) {
    state.drawer.open = open;
    document.body.classList.toggle("detail-open", open);
    els.backdrop.hidden = !open;
    els.drawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      state.selection = null;
      renderPivot();
    }
  }

  function buildSerialsPath(filter) {
    const q = new URLSearchParams();
    if (filter.property) q.set("property", filter.property);
    if (filter.manufacturer !== undefined) q.set("manufacturer", filter.manufacturer);
    if (filter.cabinet !== undefined) q.set("cabinet", filter.cabinet);
    if (state.drawer.search) q.set("q", state.drawer.search);
    q.set("page", String(state.drawer.page));
    q.set("page_size", "100");
    return `/api/warehouse-inventory/serials?${q.toString()}`;
  }

  async function loadDrawerSerials() {
    const filter = state.drawer.filter;
    if (!filter) return;

    els.drawerTbody.innerHTML = `<tr><td colspan="3" class="subtitle">Loading…</td></tr>`;
    try {
      const data = await fetchJson(buildSerialsPath(filter));
      state.drawer.totalPages = data.total_pages || 1;
      state.drawer.totalItems = data.total_items || 0;

      els.drawerTbody.innerHTML = data.items.length
        ? data.items
            .map(
              (row) => `
            <tr>
              <td class="mono">${esc(row.serial)}</td>
              <td>${esc(fmtDate(row.date_received))}</td>
              <td>${esc(row.previous_location || "—")}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="3" class="subtitle">No serials found.</td></tr>`;

      const start = data.total_items === 0 ? 0 : (data.page - 1) * data.page_size + 1;
      const end = Math.min(data.page * data.page_size, data.total_items);
      const searchNote = data.search ? ` matching “${data.search}”` : "";
      els.drawerStatus.textContent =
        data.total_items === 0
          ? `No serials${searchNote}.`
          : `Showing ${fmtNum(start)}–${fmtNum(end)} of ${fmtNum(data.total_items)}${searchNote} · export available`;

      els.drawerPager.hidden = data.total_pages <= 1;
      els.drawerPrevPage.disabled = data.page <= 1;
      els.drawerNextPage.disabled = data.page >= data.total_pages;
      els.drawerPager.querySelector(".pager__label").textContent = `Page ${data.page} of ${data.total_pages}`;
    } catch (err) {
      els.drawerTbody.innerHTML = "";
      els.drawerStatus.textContent = err.message || String(err);
      els.drawerPager.hidden = true;
    }
  }

  function openDrill(kind, meta) {
    state.selection = { kind, ...meta };
    state.drawer.filter = meta.filter;
    state.drawer.search = "";
    state.drawer.page = 1;
    els.drawerSearchInput.value = "";

    els.detailLabel.textContent =
      kind === "cell" ? "Cell drill-down" : kind === "row" ? "Row drill-down" : "Column drill-down";
    els.detailTitle.textContent = meta.title;
    els.detailSubtitle.textContent = meta.subtitle;

    renderPivot();
    setDrawerOpen(true);
    loadDrawerSerials();
  }

  function openCellDrill(dataset) {
    const label = _cabinetLabel(dataset.manufacturer, dataset.cabinet);
    const prop = dataset.property;
    openDrill("cell", {
      filter: {
        property: prop,
        manufacturer: dataset.manufacturer,
        cabinet: dataset.cabinet,
      },
      manufacturer: dataset.manufacturer,
      cabinet: dataset.cabinet,
      property: prop,
      title: `${label} × ${shortWarehouseName(prop)}`,
      subtitle: "Row = cabinet · column = warehouse",
    });
  }

  function openRowDrill(dataset) {
    const label = _cabinetLabel(dataset.manufacturer, dataset.cabinet);
    openDrill("row", {
      filter: {
        manufacturer: dataset.manufacturer,
        cabinet: dataset.cabinet,
      },
      manufacturer: dataset.manufacturer,
      cabinet: dataset.cabinet,
      title: label,
      subtitle: "All serials for this cabinet type across warehouses",
    });
  }

  function openColumnDrill(property) {
    state.highlightProperty = property;
    renderSummaryCards();
    renderPivot();
    openDrill("column", {
      filter: { property },
      property,
      title: property,
      subtitle: "All serials in this warehouse",
    });
  }

  function _cabinetLabel(manufacturer, cabinet) {
    const m = (manufacturer || "").trim();
    const c = (cabinet || "").trim();
    if (m && c) return `${m} ${c}`;
    return m || c || "—";
  }

  async function init() {
    showError(null);
    els.pivotTbody.innerHTML = `<tr><td colspan="6" class="subtitle">Loading pivot…</td></tr>`;
    try {
      state.pivot = await fetchJson("/api/warehouse-inventory/pivot");
      els.grandTotal.textContent = fmtNum(state.pivot.grand_total);
      els.warehouseCount.textContent = String(state.pivot.columns.length);
      renderSummaryCards();
      renderPivot();
    } catch (err) {
      showError(err.message || String(err));
      els.pivotTbody.innerHTML = "";
    }
  }

  els.btnCloseDetail.addEventListener("click", () => setDrawerOpen(false));
  els.backdrop.addEventListener("click", () => setDrawerOpen(false));

  els.drawerSearchBtn.addEventListener("click", () => {
    state.drawer.search = els.drawerSearchInput.value.trim();
    state.drawer.page = 1;
    loadDrawerSerials();
  });

  els.drawerSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.drawer.search = els.drawerSearchInput.value.trim();
      state.drawer.page = 1;
      loadDrawerSerials();
    }
  });

  els.drawerPrevPage.addEventListener("click", () => {
    if (state.drawer.page > 1) {
      state.drawer.page -= 1;
      loadDrawerSerials();
    }
  });

  els.drawerNextPage.addEventListener("click", () => {
    if (state.drawer.page < state.drawer.totalPages) {
      state.drawer.page += 1;
      loadDrawerSerials();
    }
  });

  window.WarehouseApp = { init };
})();
