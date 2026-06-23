(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const state = {
    summary: null,
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    search: "",
    selectedKey: null,
    detail: null,
    expandedLine: null,
    serialCache: {},
    mediaUrls: {},
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    statAgreements: document.getElementById("stat-agreements"),
    statLines: document.getElementById("stat-lines"),
    statSerials: document.getElementById("stat-serials"),
    statMissing: document.getElementById("stat-missing"),
    searchInput: document.getElementById("search-input"),
    searchBtn: document.getElementById("search-btn"),
    clearSearch: document.getElementById("clear-search"),
    tbody: document.getElementById("contracts-tbody"),
    listStatus: document.getElementById("list-status"),
    vendorLogo: document.getElementById("vendor-logo"),
    cabinetRow: document.getElementById("cabinet-row"),
    cardTitle: document.getElementById("card-title"),
    cardMeta: document.getElementById("card-meta"),
    detailBody: document.getElementById("detail-body"),
    detailEmptyMsg: document.getElementById("detail-empty-msg"),
    detailContent: document.getElementById("detail-content"),
    detailFields: document.getElementById("detail-fields"),
    linesTbody: document.getElementById("lines-tbody"),
    linesStatus: document.getElementById("lines-status"),
    serialExpansion: document.getElementById("serial-expansion"),
    serialExpansionMeta: document.getElementById("serial-expansion-meta"),
    serialExpansionBody: document.getElementById("serial-expansion-body"),
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
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString();
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

  async function renderImageCard(d) {
    if (!d) {
      els.vendorLogo.innerHTML = placeholderBox("Select an agreement");
      els.cabinetRow.innerHTML = "";
      els.cabinetRow.classList.remove("dgs-v2-cabinet-row--single");
      els.cardTitle.textContent = "—";
      els.cardMeta.textContent = "Choose a row from the list";
      return;
    }

    els.cardTitle.textContent = d.agreement_id || "Contract";
    const so = d.sales_order ? `SO# ${d.sales_order}` : "no SO#";
    els.cardMeta.textContent = `${d.vendor_name || "—"} · ${so} · ${fmtMoney(d.total_price)}`;

    const logoPath = d.vendor_logo_media_path;
    if (logoPath) {
      const url = await loadMediaUrl(logoPath);
      els.vendorLogo.innerHTML = url
        ? `<img src="${url}" alt="${esc(d.vendor_name || "Vendor")} logo" />`
        : placeholderBox(logoPath.split("/").pop());
    } else {
      els.vendorLogo.innerHTML = placeholderBox(d.vendor_name || "No logo");
    }

    const cabinets = (d.cabinet_images || []).slice(0, 2);
    els.cabinetRow.classList.toggle("dgs-v2-cabinet-row--single", cabinets.length === 1);
    if (!cabinets.length) {
      els.cabinetRow.innerHTML = "";
      return;
    }

    const thumbs = await Promise.all(
      cabinets.map(async (cab) => {
        const path = cab.image_media_path;
        const url = path ? await loadMediaUrl(path) : null;
        const label = cab.cabinet_name || cab.cabinet_id || "Cabinet";
        if (url) {
          return `<div class="dgs-v2-cabinet-thumb"><img src="${url}" alt="${esc(label)}" title="${esc(label)}" /></div>`;
        }
        return `<div class="dgs-v2-cabinet-thumb">${placeholderBox(label)}</div>`;
      })
    );
    els.cabinetRow.innerHTML = thumbs.join("");
  }

  function renderSummary() {
    const s = state.summary;
    if (!s) return;
    els.statAgreements.textContent = fmtNum(s.agreements);
    els.statLines.textContent = fmtNum(s.lines);
    els.statSerials.textContent = fmtNum(s.serials);
    els.statMissing.textContent = fmtNum(s.missing_assets);
  }

  function renderList() {
    els.tbody.innerHTML = state.items
      .map(
        (row) => `
        <tr data-key="${esc(row.reference_key)}" class="${row.reference_key === state.selectedKey ? "selected" : ""}">
          <td class="mono">${esc(row.agreement_id)}</td>
          <td>${esc(row.vendor_name)}</td>
          <td>${esc(row.sales_order || "—")}</td>
          <td>${esc(fmtDate(row.agreement_date))}</td>
          <td><strong>${esc(fmtMoney(row.total_price))}</strong></td>
        </tr>`
      )
      .join("");

    els.tbody.querySelectorAll("tr[data-key]").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.key));
    });

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.total);
    const searchNote = state.search ? ` · matching “${state.search}”` : "";
    els.listStatus.textContent =
      state.total === 0
        ? `No contracts found${searchNote}.`
        : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()}${searchNote}`;
  }

  function field(label, value) {
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
  }

  function renderDetailFields(d) {
    els.detailFields.innerHTML = [
      field("Vendor", d.vendor_name || "—"),
      field("Sales order", d.sales_order || "—"),
      field("Agreement date", fmtDate(d.agreement_date)),
      field("Total price", fmtMoney(d.total_price)),
      field("Date received", fmtDate(d.date_received)),
      field("Delivery location", d.delivery_location || "—"),
      field("Payment terms", d.payment_terms || "—"),
      field("Payment date", fmtDate(d.payment_date)),
      field("Lines", fmtNum(d.line_count)),
      field("Notes", d.notes || "—"),
    ].join("");
  }

  function renderLines() {
    const d = state.detail;
    if (!d) {
      els.linesTbody.innerHTML = "";
      els.linesStatus.textContent = "";
      hideSerialExpansion();
      return;
    }

    const rows = [];
    for (const line of d.lines || []) {
      const missing = line.serial_count - line.linked_serial_count;
      const serialLabel =
        line.serial_count === 0
          ? "—"
          : `${line.linked_serial_count}/${line.serial_count}${missing > 0 ? ` (${missing} missing)` : ""}`;

      const expanded = state.expandedLine === line.reference_key;
      rows.push(`
        <tr class="dgs-v2-line-row${expanded ? " expanded" : ""}" data-line="${esc(line.reference_key)}">
          <td>${esc(line.asset_description)}</td>
          <td>${esc(line.cabinet_name || line.cabinet_id || "—")}</td>
          <td>${esc(fmtNum(line.quantity))}</td>
          <td>${esc(fmtMoney(line.machine_cost))}</td>
          <td>${esc(serialLabel)}</td>
        </tr>`);
    }
    els.linesTbody.innerHTML = rows.join("");

    els.linesTbody.querySelectorAll(".dgs-v2-line-row").forEach((tr) => {
      tr.addEventListener("click", () => toggleLineSerials(tr.dataset.line));
    });

    const totalSerials = d.serial_count || 0;
    const linked = d.linked_serial_count || 0;
    els.linesStatus.textContent = `${(d.lines || []).length} line(s) · ${linked.toLocaleString()} / ${totalSerials.toLocaleString()} serials linked`;
  }

  async function toggleLineSerials(lineKey) {
    if (state.expandedLine === lineKey) {
      state.expandedLine = null;
      hideSerialExpansion();
      renderLines();
      return;
    }
    state.expandedLine = lineKey;
    renderLines();
    await loadSerials(lineKey);
  }

  function hideSerialExpansion() {
    if (!els.serialExpansion) return;
    els.serialExpansion.hidden = true;
    if (els.serialExpansionMeta) els.serialExpansionMeta.textContent = "";
    if (els.serialExpansionBody) els.serialExpansionBody.innerHTML = "";
  }

  function lineByKey(lineKey) {
    return (state.detail?.lines || []).find((line) => line.reference_key === lineKey);
  }

  async function loadSerials(lineKey) {
    const line = lineByKey(lineKey);
    if (!els.serialExpansion || !els.serialExpansionBody) return;

    els.serialExpansion.hidden = false;
    els.serialExpansionMeta.textContent = line
      ? `${line.asset_description || "Line"} · loading serials…`
      : "Loading serials…";
    els.serialExpansionBody.innerHTML = `<span class="dgs-v2-lines-status">Loading serials…</span>`;

    try {
      let data = state.serialCache[lineKey];
      if (!data) {
        data = await fetchJson(`/api/contracts/lines/${encodeURIComponent(lineKey)}/serials`);
        state.serialCache[lineKey] = data;
      }
      if (!data.serials.length) {
        els.serialExpansionMeta.textContent = line
          ? `${line.asset_description || "Line"} · no serials`
          : "No serials on this line.";
        els.serialExpansionBody.innerHTML = `<span class="dgs-v2-lines-status">No serials on this line.</span>`;
        return;
      }
      els.serialExpansionMeta.textContent = `${line?.asset_description || "Line"} · ${data.linked.toLocaleString()} linked · ${data.missing.toLocaleString()} missing asset`;
      els.serialExpansionBody.innerHTML = `
        <div class="dgs-v2-serial-table-shell">
          <div class="dgs-v2-serial-sticky-mask" aria-hidden="true"></div>
          <table class="dgs-v2-serial-table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Asset</th>
                <th>Status</th>
              </tr>
            </thead>
          <tbody>
            ${data.serials
              .map(
                (s) => `
              <tr class="${s.linked ? "is-linked" : "is-missing"}">
                <td class="mono">${esc(s.serial_number)}</td>
                <td class="mono">${esc(s.asset_id || "—")}</td>
                <td>${s.linked ? "Linked" : "Missing"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
        </div>`;
    } catch (err) {
      els.serialExpansionMeta.textContent = line?.asset_description || "Line";
      els.serialExpansionBody.innerHTML = `<span class="dgs-v2-lines-status" style="color:#fca5a5;">${esc(err.message || String(err))}</span>`;
    }
  }

  function setDetailEmpty(empty) {
    els.detailBody.classList.toggle("empty", empty);
    els.detailEmptyMsg.hidden = !empty;
    els.detailContent.hidden = empty;
  }

  async function openDetail(referenceKey) {
    state.selectedKey = referenceKey;
    state.expandedLine = null;
    state.serialCache = {};
    hideSerialExpansion();
    revokeMediaUrls();
    renderList();

    setDetailEmpty(true);
    els.detailEmptyMsg.textContent = "Loading agreement…";
    els.vendorLogo.innerHTML = placeholderBox("Loading…");
    els.cabinetRow.innerHTML = "";

    try {
      state.detail = await fetchJson(`/api/contracts/${encodeURIComponent(referenceKey)}`);
      setDetailEmpty(false);
      renderDetailFields(state.detail);
      renderLines();
      await renderImageCard(state.detail);
    } catch (err) {
      state.detail = null;
      setDetailEmpty(true);
      els.detailEmptyMsg.textContent = err.message || String(err);
      await renderImageCard(null);
      els.linesTbody.innerHTML = "";
      els.linesStatus.textContent = "";
      hideSerialExpansion();
    }
  }

  async function loadSummary() {
    state.summary = await fetchJson("/api/contracts/summary");
    renderSummary();
  }

  async function loadList() {
    const q = encodeURIComponent(state.search);
    const path = `/api/contracts?q=${q}&page=${state.page}&page_size=${state.pageSize}`;
    const data = await fetchJson(path);
    state.items = data.items || [];
    state.total = data.total || 0;
    renderList();

    if (!state.selectedKey && state.items.length) {
      await openDetail(state.items[0].reference_key);
    }
  }

  async function init() {
    showError(null);
    els.tbody.innerHTML = `<tr><td colspan="5" class="dgs-v2-lines-status">Loading…</td></tr>`;
    try {
      await Promise.all([loadSummary(), loadList()]);
    } catch (err) {
      showError(err.message || String(err));
      els.tbody.innerHTML = "";
    }
  }

  els.searchBtn.addEventListener("click", () => {
    state.search = els.searchInput.value.trim();
    state.page = 1;
    state.selectedKey = null;
    revokeMediaUrls();
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    state.selectedKey = null;
    revokeMediaUrls();
    loadList().catch((err) => showError(err.message || String(err)));
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.search = els.searchInput.value.trim();
      state.page = 1;
      state.selectedKey = null;
      revokeMediaUrls();
      loadList().catch((err) => showError(err.message || String(err)));
    }
  });

  window.ContractsV2 = { init };
})();
