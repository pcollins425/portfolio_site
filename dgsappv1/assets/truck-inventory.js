/* Read-only truck (vehicle) stock browse. */
(function () {
  "use strict";

  const API_BASE =
    (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const state = {
    browseAll: false,
    vehicle: null,
    vehicles: [],
    parts: [],
    search: "",
    message: "",
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "error-box",
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

  function fmtNum(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (Number.isNaN(n)) return esc(v);
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  function showError(msg) {
    if (!els.error_box) return;
    if (!msg) {
      els.error_box.hidden = true;
      els.error_box.textContent = "";
      return;
    }
    els.error_box.hidden = false;
    els.error_box.textContent = msg;
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
    state.vehicle = data.vehicle || null;
    state.vehicles = data.vehicles || [];
    state.parts = data.parts || [];
    state.message = data.message || "";
    renderVehiclePicker();
    renderMeta();
    renderTable();
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
