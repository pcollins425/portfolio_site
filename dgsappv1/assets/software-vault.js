(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const state = {
    tab: "bins",
    summary: null,
    bins: [],
    binsTotal: 0,
    selectedBinId: null,
    software: [],
    softwareTotal: 0,
    softwarePage: 1,
    selectedItem: null,
    kits: [],
    kitPull: null,
    mobileDetailOpen: false,
  };

  const MOBILE_MQ = window.matchMedia("(max-width: 900px)");

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "error-box",
      "stat-bins",
      "stat-software",
      "stat-unplaced",
      "stat-kits",
      "scan-input",
      "scan-btn",
      "scan-result",
      "bins-section",
      "bins-search",
      "bins-search-btn",
      "bins-tbody",
      "bins-status",
      "bin-detail-body",
      "bin-detail-content",
      "bin-fields",
      "bin-software-tbody",
      "software-search",
      "software-unplaced",
      "software-search-btn",
      "software-tbody",
      "software-status",
      "software-detail-body",
      "software-detail-content",
      "software-fields",
      "kit-select",
      "kit-load-btn",
      "kit-descrip",
      "kit-lines-tbody",
      "kits-status",
      "vault_detail_backdrop",
    ].forEach((id) => {
      els[id.replace(/-/g, "_")] = $(id);
    });
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchJson(path, options) {
    const headers = window.DGSAuth ? DGSAuth.authHeaders(options?.headers) : {};
    const res = await fetch(apiUrl(path), { ...options, headers });
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

  function showError(msg) {
    const box = els.error_box;
    if (!box) return;
    if (!msg) {
      box.hidden = true;
      box.textContent = "";
      return;
    }
    box.hidden = false;
    box.textContent = msg;
  }

  function isMobile() {
    return MOBILE_MQ.matches;
  }

  function activeDetailEl() {
    return state.tab === "software"
      ? document.getElementById("software-detail")
      : document.getElementById("bin-detail");
  }

  function openMobileDetail() {
    if (!isMobile()) return;
    const detail = activeDetailEl();
    if (!detail || detail.querySelector(".dgs-v2-detail-body")?.classList.contains("empty")) return;
    state.mobileDetailOpen = true;
    document.body.classList.add("vault-detail-open");
    if (els.vault_detail_backdrop) els.vault_detail_backdrop.hidden = false;
    detail.classList.add("dgs-v2-detail--sheet");
    detail.setAttribute("aria-hidden", "false");
  }

  function closeMobileDetail() {
    state.mobileDetailOpen = false;
    document.body.classList.remove("vault-detail-open");
    if (els.vault_detail_backdrop) els.vault_detail_backdrop.hidden = true;
    document.querySelectorAll(".dgs-v2-detail--sheet").forEach((node) => {
      node.classList.remove("dgs-v2-detail--sheet");
      node.setAttribute("aria-hidden", "true");
    });
  }

  function prepareMobileShell() {
    if (!isMobile()) return;
    localStorage.setItem("dgs-rail-collapsed", "1");
    document.body.classList.add("dgs-rail-collapsed");
    const btn = document.getElementById("dgs-rail-toggle");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function setTab(tab) {
    closeMobileDetail();
    state.tab = tab;
    document.querySelectorAll(".dgs-v2-vault-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".dgs-v2-vault-panel").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab;
    });
  }

  function renderSummary() {
    const s = state.summary;
    if (!s) return;
    els.stat_bins.textContent = s.bins;
    els.stat_software.textContent = s.software;
    els.stat_unplaced.textContent = s.unplaced;
    els.stat_kits.textContent = s.kits;
  }

  function formatQty(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
    return n.toFixed(2);
  }

  function formatBinDescrips(bin) {
    const text = (bin.software_descrips || "").trim();
    if (text) return text;
    if (Number(bin.software_count) > 0) return "—";
    return "Empty";
  }

  function renderBinsList() {
    const tbody = els.bins_tbody;
    tbody.innerHTML = "";
    for (const b of state.bins) {
      const tr = document.createElement("tr");
      if (b.uuid === state.selectedBinId) tr.classList.add("dgs-v2-row--selected");
      tr.innerHTML = `
        <td class="mono">${esc(b.shelf_code || "—")}</td>
        <td class="dgs-v2-col--desktop dgs-v2-bin-desc">${esc(formatBinDescrips(b))}</td>
        <td class="dgs-v2-bin-qty num">${esc(formatQty(b.total_qty ?? b.software_count))}</td>`;
      tr.addEventListener("click", () => selectBin(b.uuid));
      tbody.appendChild(tr);
    }
    els.bins_status.textContent = state.bins.length
      ? `${state.bins.length} of ${state.binsTotal} bins`
      : "No bins match.";
  }

  function renderFieldList(dl, pairs) {
    dl.innerHTML = "";
    for (const [label, value] of pairs) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value ?? "—";
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
  }

  async function selectBin(uuid) {
    state.selectedBinId = uuid;
    renderBinsList();
    try {
      const data = await fetchJson(`/api/software-vault/bins/${encodeURIComponent(uuid)}`);
      const b = data.bin;
      els.bin_detail_body.classList.remove("empty");
      els.bin_detail_content.hidden = false;
      renderFieldList(els.bin_fields, [
        ["Shelf", b.shelf_code],
        ["Barcode", b.barcode],
        ["Reference", b.reference_key],
        ["Section", b.section],
        ["Row", b.row],
        ["Column", b.column],
        ["Label", b.label],
      ]);
      const stbody = els.bin_software_tbody;
      stbody.innerHTML = "";
      for (const row of data.software || []) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${esc(row.item)}</td>
          <td>${esc(row.descrip)}</td>
          <td>${esc(row.qty_on_hand)}</td>`;
        tr.addEventListener("click", () => {
          setTab("software");
          loadSoftwareList(row.item);
        });
        stbody.appendChild(tr);
      }
      if (!data.software?.length) {
        stbody.innerHTML = `<tr><td colspan="3">Empty bin</td></tr>`;
      }
      openMobileDetail();
    } catch (e) {
      showError(String(e.message || e));
    }
  }

  async function loadBins() {
    const q = els.bins_search.value.trim();
    const section = els.bins_section.value;
    const params = new URLSearchParams({ page_size: "500" });
    if (q) params.set("q", q);
    if (section) params.set("section", section);
    const data = await fetchJson(`/api/software-vault/bins?${params}`);
    state.bins = data.items || [];
    state.binsTotal = data.total || 0;
    const sel = els.bins_section;
    const current = sel.value;
    sel.innerHTML = '<option value="">All sections</option>';
    for (const sec of data.sections || []) {
      const opt = document.createElement("option");
      opt.value = sec;
      opt.textContent = sec;
      if (sec === current) opt.selected = true;
      sel.appendChild(opt);
    }
    renderBinsList();
  }

  function renderSoftwareList() {
    const tbody = els.software_tbody;
    tbody.innerHTML = "";
    for (const row of state.software) {
      const tr = document.createElement("tr");
      if (row.item === state.selectedItem) tr.classList.add("dgs-v2-row--selected");
      tr.innerHTML = `
        <td>${esc(row.item)}</td>
        <td>${esc(row.descrip)}</td>
        <td>${esc(row.shelf_code || "—")}</td>
        <td>${esc(row.qty_on_hand)}</td>`;
      tr.addEventListener("click", () => selectSoftware(row.item));
      tbody.appendChild(tr);
    }
    els.software_status.textContent = state.software.length
      ? `Showing ${state.software.length} of ${state.softwareTotal}`
      : "No software matches.";
  }

  async function selectSoftware(item) {
    state.selectedItem = item;
    renderSoftwareList();
    try {
      const row = await fetchJson(`/api/software-vault/software/${encodeURIComponent(item)}`);
      els.software_detail_body.classList.remove("empty");
      els.software_detail_content.hidden = false;
      const cabinets = Array.isArray(row.cabinets) ? row.cabinets.join(", ") : "—";
      const meta = row.metadata && typeof row.metadata === "object"
        ? Object.entries(row.metadata).map(([k, v]) => `${k}: ${v}`).join(" · ")
        : "—";
      renderFieldList(els.software_fields, [
        ["Item", row.item],
        ["Reference", row.reference_key],
        ["Description", row.descrip],
        ["Category", row.category],
        ["Supplier part #", row.supplier_part_no],
        ["Qty on hand", row.qty_on_hand],
        ["Shelf", row.shelf_code],
        ["Bin barcode", row.bin_barcode],
        ["Cabinets", cabinets],
        ["Metadata", meta],
      ]);
      openMobileDetail();
    } catch (e) {
      showError(String(e.message || e));
    }
  }

  async function loadSoftwareList(focusItem) {
    const q = els.software_search.value.trim();
    const unplaced = els.software_unplaced.checked;
    const params = new URLSearchParams({ page: String(state.softwarePage), page_size: "100" });
    if (q) params.set("q", q);
    if (unplaced) params.set("unplaced_only", "true");
    const data = await fetchJson(`/api/software-vault/software?${params}`);
    state.software = data.items || [];
    state.softwareTotal = data.total || 0;
    renderSoftwareList();
    if (focusItem) await selectSoftware(focusItem);
  }

  function renderKitsSelect() {
    const sel = els.kit_select;
    const current = sel.value;
    sel.innerHTML = '<option value="">Select kit…</option>';
    for (const k of state.kits) {
      const opt = document.createElement("option");
      opt.value = k.kit_item;
      opt.textContent = `${k.kit_item} — ${k.descrip || k.line_count + " lines"}`;
      if (k.kit_item === current) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function renderKitPull() {
    const pull = state.kitPull;
    const tbody = els.kit_lines_tbody;
    tbody.innerHTML = "";
    if (!pull) {
      els.kits_status.textContent = "Select a kit and load pull list.";
      els.kit_descrip.textContent = "";
      return;
    }
    els.kit_descrip.textContent = pull.descrip || "";
    for (const line of pull.lines || []) {
      const tr = document.createElement("tr");
      if (!line.shelf_code) tr.classList.add("dgs-v2-kit-pull-missing");
      tr.innerHTML = `
        <td>${esc(line.component_item)}</td>
        <td>${esc(line.descrip)}</td>
        <td>${esc(line.kit_qty)}</td>
        <td>${esc(line.qty_on_hand)}</td>
        <td>${esc(line.shelf_code || "—")}</td>`;
      tbody.appendChild(tr);
    }
    els.kits_status.textContent = `${pull.lines.length} component(s)`;
  }

  async function loadKits() {
    const data = await fetchJson("/api/software-vault/kits");
    state.kits = data.items || [];
    renderKitsSelect();
  }

  async function loadKitPull() {
    const kit = els.kit_select.value;
    if (!kit) return;
    state.kitPull = await fetchJson(`/api/software-vault/kits/${encodeURIComponent(kit)}/pull`);
    renderKitPull();
  }

  async function resolveScan() {
    const q = els.scan_input.value.trim();
    if (!q) return;
    els.scan_result.textContent = "…";
    try {
      const data = await fetchJson(`/api/software-vault/scan?${new URLSearchParams({ q })}`);
      const b = data.bin;
      els.scan_result.textContent = `→ ${b.shelf_code} (${b.barcode})`;
      setTab("bins");
      await loadBins();
      await selectBin(b.uuid);
    } catch (e) {
      els.scan_result.textContent = String(e.message || e);
    }
  }

  async function refreshAll() {
    showError("");
    state.summary = await fetchJson("/api/software-vault/summary");
    renderSummary();
    await Promise.all([loadBins(), loadSoftwareList(), loadKits()]);
  }

  function wireEvents() {
    document.querySelectorAll(".dgs-v2-vault-tab").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab));
    });
    els.bins_search_btn.addEventListener("click", () => loadBins().catch((e) => showError(String(e))));
    els.bins_section.addEventListener("change", () => loadBins().catch((e) => showError(String(e))));
    els.software_search_btn.addEventListener("click", () => {
      state.softwarePage = 1;
      loadSoftwareList().catch((e) => showError(String(e)));
    });
    els.kit_load_btn.addEventListener("click", () => loadKitPull().catch((e) => showError(String(e))));
    els.scan_btn.addEventListener("click", () => resolveScan().catch((e) => showError(String(e))));
    els.scan_input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") resolveScan().catch((er) => showError(String(er)));
    });
    document.querySelectorAll(".vault-detail-close").forEach((btn) => {
      btn.addEventListener("click", closeMobileDetail);
    });
    if (els.vault_detail_backdrop) {
      els.vault_detail_backdrop.addEventListener("click", closeMobileDetail);
    }
    MOBILE_MQ.addEventListener("change", () => {
      if (!isMobile()) closeMobileDetail();
      else prepareMobileShell();
    });
  }

  async function init() {
    cacheEls();
    prepareMobileShell();
    wireEvents();
    setTab("bins");
    try {
      await refreshAll();
    } catch (e) {
      showError(String(e.message || e));
    }
  }

  window.SoftwareVaultApp = { init };
})();
