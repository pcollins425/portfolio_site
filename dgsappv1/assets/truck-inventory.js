/* Truck (vehicle) stock browse + Add Stock for writers. */
(function () {
  "use strict";

  const API_BASE =
    (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const LAST_TRUCK_KEY = "dgs_truck_inventory_last_bucket";

  const state = {
    browseAll: false,
    canWrite: false,
    vehicle: null,
    vehicles: [],
    parts: [],
    search: "",
    message: "",
    sourceBuckets: [],
  };

  function rememberTruck(code) {
    const c = (code || "").trim().toUpperCase();
    if (!/^V\d+$/i.test(c)) return;
    try {
      localStorage.setItem(LAST_TRUCK_KEY, c);
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  function recalledTruck() {
    try {
      const c = (localStorage.getItem(LAST_TRUCK_KEY) || "").trim().toUpperCase();
      return /^V\d+$/i.test(c) ? c : "";
    } catch (_) {
      return "";
    }
  }

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  const ADD_FOLD_KEY = "dgs_truck_add_stock_open";

  function cacheEls() {
    [
      "error-box",
      "ok-box",
      "vehicle-pick-wrap",
      "vehicle-select",
      "vehicle-meta",
      "search-input",
      "search-btn",
      "clear-search",
      "stat-count",
      "stat-vehicle",
      "truck-tbody",
      "truck-cards",
      "list-status",
      "add-stock-panel",
      "add-stock-toggle",
      "add-stock-body",
      "add-stock-form",
      "add-to-label",
      "add-part-results",
      "add-part-label",
      "add-item",
      "add-qty",
      "add-from",
      "add-submit",
    ].forEach((id) => {
      els[id.replace(/-/g, "_")] = $(id);
    });
  }

  function isPhoneOrTablet() {
    return window.matchMedia("(max-width: 1366px)").matches;
  }

  function setAddFoldOpen(open) {
    if (!els.add_stock_panel) return;
    els.add_stock_panel.classList.toggle("is-collapsed", !open);
    if (els.add_stock_toggle) {
      els.add_stock_toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    try {
      localStorage.setItem(ADD_FOLD_KEY, open ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }

  function recalledAddFoldOpen() {
    try {
      const v = localStorage.getItem(ADD_FOLD_KEY);
      if (v === "0") return false;
      if (v === "1") return true;
    } catch (_) {
      /* ignore */
    }
    // Phone/tablet: start collapsed so stock list is usable immediately.
    return !isPhoneOrTablet();
  }

  let partSearchTimer = null;
  let selectedPartItem = "";

  function clearPartLabel() {
    if (els.add_part_label) {
      els.add_part_label.hidden = true;
      els.add_part_label.textContent = "";
    }
  }

  function selectPart(part) {
    const item = (part && part.item) || "";
    selectedPartItem = item;
    if (els.add_item) els.add_item.value = item;
    if (els.add_part_results) {
      els.add_part_results.hidden = true;
      els.add_part_results.innerHTML = "";
    }
    if (els.add_part_label) {
      const bits = [part.name || part.descrip, part.mfr].filter(Boolean);
      if (bits.length) {
        els.add_part_label.hidden = false;
        els.add_part_label.textContent = bits.join(" · ");
      } else {
        clearPartLabel();
      }
    }
    loadSources(item).catch((err) => showError(err.message || String(err)));
  }

  async function runPartSearch() {
    const q = (els.add_item && els.add_item.value) || "";
    if (!els.add_part_results) return;
    if (q.trim().length < 2 || q.trim() === selectedPartItem) {
      els.add_part_results.hidden = true;
      els.add_part_results.innerHTML = "";
      return;
    }
    els.add_part_results.hidden = false;
    els.add_part_results.innerHTML = `<p class="dgs-field-empty">Searching parts…</p>`;
    try {
      const payload = await fetchJson(
        `/api/truck-inventory/parts-search?q=${encodeURIComponent(q.trim())}&limit=25`
      );
      const parts = (payload && payload.parts) || [];
      if (!parts.length) {
        els.add_part_results.innerHTML = `<p class="dgs-field-empty">No parts matched “${esc(
          q.trim()
        )}”.</p>`;
        return;
      }
      els.add_part_results.innerHTML = parts
        .map((p) => {
          const label = [p.item, p.name, p.mfr].filter(Boolean).join(" · ");
          const stock =
            p.stock != null && p.stock !== "" ? ` · stock ${esc(p.stock)}` : "";
          return `<button type="button" class="dgs-wo-pr-hit" data-item="${esc(
            p.item
          )}" data-name="${esc(p.name || "")}" data-mfr="${esc(
            p.mfr || ""
          )}"><span class="dgs-wo-pr-hit-main">${esc(
            label
          )}</span><span class="dgs-wo-pr-hit-meta">${stock}</span></button>`;
        })
        .join("");
    } catch (err) {
      els.add_part_results.innerHTML = `<p class="error-box">${esc(
        err.message || String(err)
      )}</p>`;
    }
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchJson(path, options) {
    const headers = window.DGSAuth ? DGSAuth.authHeaders(options?.headers) : {};
    if (options && options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
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

  function fmtNum(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (Number.isNaN(n)) return esc(v);
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  function showError(msg) {
    if (els.ok_box) {
      els.ok_box.hidden = true;
      els.ok_box.textContent = "";
    }
    if (!els.error_box) return;
    if (!msg) {
      els.error_box.hidden = true;
      els.error_box.textContent = "";
      return;
    }
    els.error_box.hidden = false;
    els.error_box.textContent = msg;
  }

  function showOk(msg) {
    if (els.error_box) {
      els.error_box.hidden = true;
      els.error_box.textContent = "";
    }
    if (!els.ok_box) return;
    if (!msg) {
      els.ok_box.hidden = true;
      els.ok_box.textContent = "";
      return;
    }
    els.ok_box.hidden = false;
    els.ok_box.textContent = msg;
  }

  function renderVehiclePicker() {
    if (!els.vehicle_pick_wrap || !els.vehicle_select) return;
    if (!state.browseAll || !state.vehicles.length) {
      els.vehicle_pick_wrap.hidden = true;
      return;
    }
    els.vehicle_pick_wrap.hidden = false;
    const current = (state.vehicle && state.vehicle.code) || "";
    els.vehicle_select.innerHTML = state.vehicles
      .map((v) => {
        const label = `${v.code} · ${v.name || "—"}`;
        const sel = v.code === current ? " selected" : "";
        return `<option value="${esc(v.code)}"${sel}>${esc(label)}</option>`;
      })
      .join("");
  }

  function renderMeta() {
    const v = state.vehicle;
    if (els.vehicle_meta) {
      if (!v) {
        els.vehicle_meta.textContent = state.message || "No vehicle linked.";
      } else {
        els.vehicle_meta.textContent = `${v.code} — ${v.name || "—"}${
          v.email ? ` · ${v.email}` : ""
        }`;
      }
    }
    if (els.stat_vehicle) {
      els.stat_vehicle.textContent = v ? v.code : "—";
    }
    if (els.stat_count) {
      els.stat_count.textContent = String(state.parts.length);
    }
    if (els.add_to_label) {
      els.add_to_label.textContent = v ? `To: ${v.code}` : "To: —";
    }
  }

  function renderAddPanel() {
    if (!els.add_stock_panel) return;
    const show = !!(state.canWrite && state.vehicle);
    els.add_stock_panel.hidden = !show;
    if (show && !els.add_stock_panel.dataset.foldInit) {
      setAddFoldOpen(recalledAddFoldOpen());
      els.add_stock_panel.dataset.foldInit = "1";
    }
    if (!els.add_from) return;
    const part = selectedPartItem || ((els.add_item && els.add_item.value) || "").trim();
    const current = els.add_from.value;
    if (!part) {
      els.add_from.innerHTML = `<option value="">Select a part first…</option>`;
      return;
    }
    if (!state.sourceBuckets.length) {
      els.add_from.innerHTML = `<option value="">No AVAILABLE stock for this part</option>`;
      return;
    }
    const opts = state.sourceBuckets
      .map((b) => {
        const sel = b.bucket === current ? " selected" : "";
        return `<option value="${esc(b.bucket)}"${sel}>${esc(
          `${b.bucket} (${fmtNum(b.qty)} available)`
        )}</option>`;
      })
      .join("");
    els.add_from.innerHTML = `<option value="">Select source…</option>${opts}`;
  }

  function renderTable() {
    const emptyMsg =
      state.message ||
      (state.vehicle
        ? state.search
          ? `No parts matched “${state.search}”.`
          : "No stock on this vehicle."
        : "No vehicle to show.");
    if (!state.parts.length) {
      if (els.truck_tbody) els.truck_tbody.innerHTML = "";
      if (els.truck_cards) els.truck_cards.innerHTML = "";
      if (els.list_status) els.list_status.textContent = emptyMsg;
      return;
    }
    if (els.truck_tbody) {
      els.truck_tbody.innerHTML = state.parts
        .map((p) => {
          const mfr = [p.mfr, p.mfrpartno].filter(Boolean).join(" · ");
          const cond = p.condition || "—";
          const desc = p.descrip || "—";
          return `<tr title="${esc(`${desc}${mfr ? ` · ${mfr}` : ""} · ${cond}`)}">
            <td class="dgs-truck-col-item mono">${esc(p.item || "—")}</td>
            <td class="dgs-truck-col-desc">${esc(desc)}</td>
            <td class="dgs-v2-col--desktop dgs-truck-col-mfr">${esc(mfr || "—")}</td>
            <td class="dgs-truck-col-cond">${esc(cond)}</td>
            <td class="dgs-v2-bin-qty dgs-truck-col-qty">${esc(fmtNum(p.qty))}</td>
          </tr>`;
        })
        .join("");
    }
    if (els.truck_cards) {
      els.truck_cards.innerHTML = "";
    }
    if (els.list_status) {
      els.list_status.textContent = `${state.parts.length} line${
        state.parts.length === 1 ? "" : "s"
      }`;
    }
  }

  async function loadSources(item) {
    if (!state.canWrite) {
      state.sourceBuckets = [];
      return;
    }
    const part = (item || "").trim();
    if (!part) {
      state.sourceBuckets = [];
      renderAddPanel();
      return;
    }
    const data = await fetchJson(
      `/api/truck-inventory/source-buckets?item=${encodeURIComponent(part)}`
    );
    state.sourceBuckets = data.buckets || [];
    renderAddPanel();
  }

  async function load() {
    showError("");
    const params = new URLSearchParams();
    if (state.search) params.set("q", state.search);
    if (state.browseAll && state.vehicle && state.vehicle.code) {
      params.set("bucket", state.vehicle.code);
    } else if (els.vehicle_select && !els.vehicle_pick_wrap.hidden && els.vehicle_select.value) {
      params.set("bucket", els.vehicle_select.value);
    } else {
      const last = recalledTruck();
      if (last) params.set("bucket", last);
    }
    const qs = params.toString();
    const data = await fetchJson(`/api/truck-inventory${qs ? `?${qs}` : ""}`);
    state.browseAll = !!data.browse_all;
    state.canWrite = !!data.can_write;
    state.vehicle = data.vehicle || null;
    state.vehicles = data.vehicles || [];
    state.parts = data.parts || [];
    state.message = data.message || "";
    if (state.vehicle && state.vehicle.code) rememberTruck(state.vehicle.code);
    renderVehiclePicker();
    renderMeta();
    renderAddPanel();
    renderTable();
    if (state.canWrite && selectedPartItem) {
      await loadSources(selectedPartItem).catch(() => {
        state.sourceBuckets = [];
        renderAddPanel();
      });
    }
  }

  async function submitAdd(event) {
    event.preventDefault();
    if (!state.vehicle || !state.vehicle.code) {
      showError("Select a vehicle first.");
      return;
    }
    const item = (els.add_item && els.add_item.value.trim()) || "";
    const qty = Number(els.add_qty && els.add_qty.value);
    const fromBucket = (els.add_from && els.add_from.value) || "";
    if (!item || item !== selectedPartItem) {
      showError("Pick a part from the search results.");
      return;
    }
    if (!fromBucket || !(qty > 0)) {
      showError("Qty and From are required.");
      return;
    }
    if (els.add_submit) els.add_submit.disabled = true;
    try {
      const result = await fetchJson("/api/truck-inventory/add-stock", {
        method: "POST",
        body: JSON.stringify({
          item,
          qty,
          from_bucket: fromBucket,
          to_bucket: state.vehicle.code,
        }),
      });
      showOk(
        `Added ${result.qty} × ${result.item} from ${result.from_bucket} → ${result.to_bucket} (truck available now ${result.truck_available}).`
      );
      selectedPartItem = "";
      if (els.add_item) els.add_item.value = "";
      clearPartLabel();
      state.sourceBuckets = [];
      if (els.add_qty) els.add_qty.value = "1";
      if (isPhoneOrTablet()) setAddFoldOpen(false);
      renderAddPanel();
      await load();
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      if (els.add_submit) els.add_submit.disabled = false;
    }
  }

  function wire() {
    if (els.add_stock_toggle) {
      els.add_stock_toggle.addEventListener("click", () => {
        const open = els.add_stock_toggle.getAttribute("aria-expanded") !== "true";
        setAddFoldOpen(open);
      });
    }
    if (els.add_item) {
      els.add_item.addEventListener("input", () => {
        if (els.add_item.value.trim() !== selectedPartItem) {
          selectedPartItem = "";
          clearPartLabel();
          state.sourceBuckets = [];
          renderAddPanel();
        }
        clearTimeout(partSearchTimer);
        partSearchTimer = setTimeout(() => {
          runPartSearch().catch((err) => showError(err.message || String(err)));
        }, 200);
      });
      els.add_item.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          clearTimeout(partSearchTimer);
          runPartSearch().catch((err) => showError(err.message || String(err)));
        }
      });
    }
    if (els.add_part_results) {
      els.add_part_results.addEventListener("click", (event) => {
        const btn = event.target.closest(".dgs-wo-pr-hit");
        if (!btn) return;
        selectPart({
          item: btn.getAttribute("data-item") || "",
          name: btn.getAttribute("data-name") || "",
          mfr: btn.getAttribute("data-mfr") || "",
        });
      });
    }
    if (els.search_btn) {
      els.search_btn.addEventListener("click", () => {
        state.search = (els.search_input && els.search_input.value) || "";
        load().catch((err) => showError(err.message || String(err)));
      });
    }
    if (els.search_input) {
      els.search_input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          state.search = els.search_input.value || "";
          load().catch((err) => showError(err.message || String(err)));
        }
      });
    }
    if (els.clear_search) {
      els.clear_search.addEventListener("click", () => {
        if (els.search_input) els.search_input.value = "";
        state.search = "";
        load().catch((err) => showError(err.message || String(err)));
      });
    }
    if (els.vehicle_select) {
      els.vehicle_select.addEventListener("change", () => {
        const code = els.vehicle_select.value;
        state.vehicle = state.vehicles.find((v) => v.code === code) || {
          code,
          name: "",
        };
        load().catch((err) => showError(err.message || String(err)));
      });
    }
    if (els.add_stock_form) {
      els.add_stock_form.addEventListener("submit", (event) => {
        submitAdd(event).catch((err) => showError(err.message || String(err)));
      });
    }
  }

  async function init() {
    cacheEls();
    wire();
    try {
      await load();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  window.TruckInventoryApp = { init };
})();
