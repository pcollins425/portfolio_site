/* Truck (vehicle) stock browse + Add Stock for writers. */
(function () {
  "use strict";

  const API_BASE =
    (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

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

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

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
      "list-status",
      "add-stock-panel",
      "add-stock-form",
      "add-to-label",
      "add-item",
      "add-qty",
      "add-from",
      "add-submit",
    ].forEach((id) => {
      els[id.replace(/-/g, "_")] = $(id);
    });
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
    els.add_stock_panel.hidden = !(state.canWrite && state.vehicle);
    if (!els.add_from) return;
    const current = els.add_from.value;
    const opts = state.sourceBuckets.length
      ? state.sourceBuckets
          .map((b) => {
            const sel = b.bucket === current ? " selected" : "";
            return `<option value="${esc(b.bucket)}"${sel}>${esc(
              `${b.bucket} (${fmtNum(b.qty)} on hand)`
            )}</option>`;
          })
          .join("")
      : `<option value="">No source buckets</option>`;
    els.add_from.innerHTML = state.sourceBuckets.length
      ? `<option value="">Select source…</option>${opts}`
      : opts;
  }

  function renderTable() {
    if (!els.truck_tbody) return;
    if (!state.parts.length) {
      els.truck_tbody.innerHTML = "";
      if (els.list_status) {
        els.list_status.textContent =
          state.message ||
          (state.vehicle
            ? state.search
              ? `No parts matched “${state.search}”.`
              : "No stock on this vehicle."
            : "No vehicle to show.");
      }
      return;
    }
    els.truck_tbody.innerHTML = state.parts
      .map((p) => {
        const mfr = [p.mfr, p.mfrpartno].filter(Boolean).join(" · ");
        return `<tr>
          <td>${esc(p.item || "—")}</td>
          <td>${esc(p.descrip || "—")}</td>
          <td class="dgs-v2-col--desktop">${esc(mfr || "—")}</td>
          <td>${esc(p.condition || "—")}</td>
          <td class="dgs-v2-bin-qty">${esc(fmtNum(p.qty))}</td>
        </tr>`;
      })
      .join("");
    if (els.list_status) {
      els.list_status.textContent = `${state.parts.length} line${
        state.parts.length === 1 ? "" : "s"
      }`;
    }
  }

  async function loadSources() {
    if (!state.canWrite) {
      state.sourceBuckets = [];
      return;
    }
    const data = await fetchJson("/api/truck-inventory/source-buckets");
    state.sourceBuckets = data.buckets || [];
  }

  async function load() {
    showError("");
    const params = new URLSearchParams();
    if (state.search) params.set("q", state.search);
    if (state.browseAll && state.vehicle && state.vehicle.code) {
      params.set("bucket", state.vehicle.code);
    } else if (els.vehicle_select && !els.vehicle_pick_wrap.hidden && els.vehicle_select.value) {
      params.set("bucket", els.vehicle_select.value);
    }
    const qs = params.toString();
    const data = await fetchJson(`/api/truck-inventory${qs ? `?${qs}` : ""}`);
    state.browseAll = !!data.browse_all;
    state.canWrite = !!data.can_write;
    state.vehicle = data.vehicle || null;
    state.vehicles = data.vehicles || [];
    state.parts = data.parts || [];
    state.message = data.message || "";
    if (state.canWrite && !state.sourceBuckets.length) {
      await loadSources().catch(() => {
        state.sourceBuckets = [];
      });
    }
    renderVehiclePicker();
    renderMeta();
    renderAddPanel();
    renderTable();
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
    if (!item || !fromBucket || !(qty > 0)) {
      showError("Part #, qty, and From are required.");
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
      if (els.add_item) els.add_item.value = "";
      if (els.add_qty) els.add_qty.value = "1";
      await loadSources();
      await load();
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      if (els.add_submit) els.add_submit.disabled = false;
    }
  }

  function wire() {
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
