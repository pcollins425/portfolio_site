/* Truck stock browse + Add Stock (transfer) + Inv Qty (count set). */
(function () {
  "use strict";

  const API_BASE =
    (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const LAST_TRUCK_KEY = "dgs_truck_inventory_last_bucket";
  const COMPACT_MQ = window.matchMedia("(max-width: 1366px)");

  const state = {
    browseAll: false,
    canWrite: false,
    vehicle: null,
    vehicles: [],
    parts: [],
    search: "",
    message: "",
    sourceBuckets: [],
    sheet: null, // "add-stock" | "inv-qty" | null
    phoneDetailOpen: false,
  };

  const els = {};
  let partSearchTimer = null;
  let invSearchTimer = null;
  let selectedPartItem = "";
  let invSelectedItem = "";
  let chipTimer = null;

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
      "truck-actions",
      "btn-open-add-stock",
      "btn-open-inv-qty",
      "truck-detail-backdrop",
      "detail-panel",
      "detail-bar",
      "detail-bar-title",
      "detail-close",
      "detail-desktop-close",
      "detail-body",
      "detail-empty-msg",
      "detail-content",
      "detail-eyebrow",
      "detail-subtitle",
      "truck-chip",
      "panel-add-stock",
      "panel-inv-qty",
      "add-stock-form",
      "add-part-results",
      "add-part-label",
      "add-item",
      "add-qty",
      "add-from",
      "add-submit",
      "inv-add-form",
      "inv-item",
      "inv-qty",
      "inv-part-results",
      "inv-part-label",
      "inv-add-submit",
      "inv-current-list",
    ].forEach((id) => {
      els[id.replace(/-/g, "_")] = $(id);
    });
  }

  function rememberTruck(code) {
    const c = (code || "").trim().toUpperCase();
    if (!/^V\d+$/i.test(c)) return;
    try {
      localStorage.setItem(LAST_TRUCK_KEY, c);
    } catch (_) {
      /* ignore */
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

  function showChip(msg) {
    if (!els.truck_chip) return;
    els.truck_chip.textContent = msg || "Current inventory updated";
    els.truck_chip.hidden = false;
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => {
      if (els.truck_chip) els.truck_chip.hidden = true;
    }, 5000);
  }

  function availableParts() {
    return (state.parts || []).filter(
      (p) => String(p.condition || "").toUpperCase() === "AVAILABLE"
    );
  }

  function isCompact() {
    return COMPACT_MQ.matches;
  }

  function setDetailEmpty(empty) {
    if (!els.detail_body) return;
    els.detail_body.classList.toggle("empty", empty);
    if (els.detail_content) els.detail_content.hidden = empty;
    if (els.detail_empty_msg) els.detail_empty_msg.hidden = !empty;
  }

  function openPhoneDetail() {
    if (!isCompact() || !els.detail_panel) return;
    state.phoneDetailOpen = true;
    document.body.classList.add("truck-detail-open");
    els.detail_panel.classList.add("dgs-v2-detail--sheet");
    els.detail_panel.setAttribute("aria-hidden", "false");
    if (els.truck_detail_backdrop) els.truck_detail_backdrop.hidden = false;
    if (els.detail_bar) els.detail_bar.hidden = false;
  }

  function closePhoneDetail() {
    state.phoneDetailOpen = false;
    document.body.classList.remove("truck-detail-open");
    if (els.detail_panel) {
      els.detail_panel.classList.remove("dgs-v2-detail--sheet");
      if (isCompact()) els.detail_panel.setAttribute("aria-hidden", "true");
      else els.detail_panel.setAttribute("aria-hidden", "false");
    }
    if (els.truck_detail_backdrop) els.truck_detail_backdrop.hidden = true;
    if (els.detail_bar) els.detail_bar.hidden = true;
  }

  function openSheet(kind) {
    state.sheet = kind;
    if (els.panel_add_stock) els.panel_add_stock.hidden = kind !== "add-stock";
    if (els.panel_inv_qty) els.panel_inv_qty.hidden = kind !== "inv-qty";
    const code = (state.vehicle && state.vehicle.code) || "—";
    const title = kind === "inv-qty" ? "Inv Qty" : "Add Stock";
    const sub =
      kind === "inv-qty"
        ? `Clarify AVAILABLE counts on ${code}`
        : `Transfer stock onto ${code}`;
    if (els.detail_eyebrow) els.detail_eyebrow.textContent = title;
    if (els.detail_bar_title) els.detail_bar_title.textContent = title;
    if (els.detail_subtitle) els.detail_subtitle.textContent = sub;
    setDetailEmpty(false);
    if (isCompact()) openPhoneDetail();
    else if (els.detail_panel) els.detail_panel.setAttribute("aria-hidden", "false");
    if (kind === "add-stock") renderAddFrom();
    if (kind === "inv-qty") renderInvCurrent();
  }

  function closeSheet() {
    state.sheet = null;
    if (els.panel_add_stock) els.panel_add_stock.hidden = true;
    if (els.panel_inv_qty) els.panel_inv_qty.hidden = true;
    if (els.truck_chip) els.truck_chip.hidden = true;
    if (els.detail_subtitle) els.detail_subtitle.textContent = "";
    clearTimeout(chipTimer);
    closePhoneDetail();
    setDetailEmpty(true);
  }

  function clearAddPartLabel() {
    if (els.add_part_label) {
      els.add_part_label.hidden = true;
      els.add_part_label.textContent = "";
    }
  }

  function clearInvPartLabel() {
    if (els.inv_part_label) {
      els.inv_part_label.hidden = true;
      els.inv_part_label.textContent = "";
    }
  }

  function selectAddPart(part) {
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
        clearAddPartLabel();
      }
    }
    loadSources(item).catch((err) => showError(err.message || String(err)));
  }

  function selectInvPart(part) {
    const item = (part && part.item) || "";
    invSelectedItem = item;
    if (els.inv_item) els.inv_item.value = item;
    if (els.inv_part_results) {
      els.inv_part_results.hidden = true;
      els.inv_part_results.innerHTML = "";
    }
    if (els.inv_part_label) {
      const bits = [part.name || part.descrip, part.mfr].filter(Boolean);
      if (bits.length) {
        els.inv_part_label.hidden = false;
        els.inv_part_label.textContent = bits.join(" · ");
      } else {
        clearInvPartLabel();
      }
    }
    const existing = availableParts().find((p) => String(p.item) === item);
    if (els.inv_qty) {
      els.inv_qty.value = existing ? String(Number(existing.qty) || 0) : "1";
    }
  }

  async function runPartSearch(inputEl, resultsEl, selected) {
    const q = (inputEl && inputEl.value) || "";
    if (!resultsEl) return;
    if (q.trim().length < 2 || q.trim() === selected) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      return;
    }
    resultsEl.hidden = false;
    resultsEl.innerHTML = `<p class="dgs-field-empty">Searching parts…</p>`;
    try {
      const payload = await fetchJson(
        `/api/truck-inventory/parts-search?q=${encodeURIComponent(q.trim())}&limit=25`
      );
      const parts = (payload && payload.parts) || [];
      if (!parts.length) {
        resultsEl.innerHTML = `<p class="dgs-field-empty">No parts matched “${esc(
          q.trim()
        )}”.</p>`;
        return;
      }
      resultsEl.innerHTML = parts
        .map((p) => {
          const label = [p.item, p.name, p.mfr].filter(Boolean).join(" · ");
          return `<button type="button" class="dgs-wo-pr-hit" data-item="${esc(
            p.item
          )}" data-name="${esc(p.name || "")}" data-mfr="${esc(
            p.mfr || ""
          )}"><span class="dgs-wo-pr-hit-main">${esc(
            label
          )}</span></button>`;
        })
        .join("");
    } catch (err) {
      resultsEl.innerHTML = `<p class="error-box">${esc(
        err.message || String(err)
      )}</p>`;
    }
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
    if (els.stat_vehicle) els.stat_vehicle.textContent = v ? v.code : "—";
    if (els.stat_count) els.stat_count.textContent = String(state.parts.length);
    if (els.truck_actions) {
      els.truck_actions.hidden = !(state.canWrite && state.vehicle);
    }
  }

  function renderAddFrom() {
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

  function renderInvCurrent() {
    if (!els.inv_current_list) return;
    const rows = availableParts();
    if (!rows.length) {
      els.inv_current_list.innerHTML = `<p class="dgs-field-empty">No AVAILABLE parts on this truck yet.</p>`;
      return;
    }
    els.inv_current_list.innerHTML = rows
      .map((p) => {
        const desc = p.descrip || "";
        return `<div class="dgs-truck-inv-row" data-item="${esc(p.item)}">
          <div class="dgs-truck-inv-row-main">
            <span class="dgs-truck-inv-item mono">${esc(p.item)}</span>
            <span class="dgs-truck-inv-desc">${esc(desc)}</span>
          </div>
          <label class="dgs-truck-inv-qty-wrap">
            <span class="dgs-wo-field-label">Qty</span>
            <input type="number" class="dgs-v2-input dgs-truck-inv-qty" min="0" step="1"
              value="${esc(fmtNum(p.qty))}" data-item="${esc(p.item)}" data-prev="${esc(
          String(Number(p.qty) || 0)
        )}" />
          </label>
        </div>`;
      })
      .join("");
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
      renderAddFrom();
      return;
    }
    const data = await fetchJson(
      `/api/truck-inventory/source-buckets?item=${encodeURIComponent(part)}`
    );
    state.sourceBuckets = data.buckets || [];
    renderAddFrom();
  }

  async function load() {
    showError("");
    const params = new URLSearchParams();
    if (state.search) params.set("q", state.search);
    // Only send a bucket when office browse-all can pick trucks. Tech / Dev
    // view-as must omit it so the API resolves the assigned vehicle — a
    // localStorage truck from office browse was 403'ing the whole page.
    if (state.browseAll && state.vehicle && state.vehicle.code) {
      params.set("bucket", state.vehicle.code);
    } else if (
      state.browseAll &&
      els.vehicle_select &&
      !els.vehicle_pick_wrap.hidden &&
      els.vehicle_select.value
    ) {
      params.set("bucket", els.vehicle_select.value);
    } else if (state.browseAll) {
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
    if (state.browseAll && state.vehicle && state.vehicle.code) {
      rememberTruck(state.vehicle.code);
    }
    renderVehiclePicker();
    renderMeta();
    renderTable();
    if (state.sheet === "inv-qty") renderInvCurrent();
    if (state.sheet === "add-stock" && selectedPartItem) {
      await loadSources(selectedPartItem).catch(() => {
        state.sourceBuckets = [];
        renderAddFrom();
      });
    }
  }

  async function submitAddStock(event) {
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
        `Added ${result.qty} × ${result.item} from ${result.from_bucket} → ${result.to_bucket}.`
      );
      selectedPartItem = "";
      if (els.add_item) els.add_item.value = "";
      clearAddPartLabel();
      state.sourceBuckets = [];
      if (els.add_qty) els.add_qty.value = "1";
      renderAddFrom();
      await load();
      closeSheet();
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      if (els.add_submit) els.add_submit.disabled = false;
    }
  }

  function patchLocalQty(item, qty) {
    const key = String(item || "");
    let row = (state.parts || []).find((p) => String(p.item) === key);
    if (!row) {
      row = {
        item: key,
        bucket: (state.vehicle && state.vehicle.code) || "",
        condition: "AVAILABLE",
        qty,
        descrip: "",
        mfr: "",
        mfrpartno: "",
      };
      state.parts = [row].concat(state.parts || []);
    } else {
      row.qty = qty;
      row.condition = row.condition || "AVAILABLE";
    }
    if (Number(qty) <= 0) {
      state.parts = (state.parts || []).filter(
        (p) => !(String(p.item) === key && String(p.condition || "").toUpperCase() === "AVAILABLE" && Number(p.qty) <= 0)
      );
    }
    renderTable();
    renderMeta();
    if (state.sheet === "inv-qty") renderInvCurrent();
  }

  async function setInvQty(item, qty, { fromAddPart } = {}) {
    if (!state.vehicle || !state.vehicle.code) {
      throw new Error("Select a vehicle first.");
    }
    const result = await fetchJson("/api/truck-inventory/set-qty", {
      method: "POST",
      body: JSON.stringify({
        item,
        qty,
        truck_bucket: state.vehicle.code,
      }),
    });
    if (result.updated) {
      patchLocalQty(result.item || item, result.qty);
      // Background reconcile — don't block the chip / next edit on a full reload.
      load().catch((err) => showError(err.message || String(err)));
    }
    if (fromAddPart && result.existed && result.updated) {
      showChip("Current inventory updated");
    } else if (fromAddPart && !result.existed && result.updated) {
      showOk(`Set ${result.item} on ${result.truck_bucket} to ${result.qty}.`);
    } else if (result.updated) {
      showChip("Current inventory updated");
    }
    return result;
  }

  async function submitInvAdd(event) {
    event.preventDefault();
    const item = (els.inv_item && els.inv_item.value.trim()) || "";
    const qty = Number(els.inv_qty && els.inv_qty.value);
    if (!item || item !== invSelectedItem) {
      showError("Pick a part from the search results.");
      return;
    }
    if (!(qty >= 0) || Number.isNaN(qty)) {
      showError("Qty is required.");
      return;
    }
    if (els.inv_add_submit) els.inv_add_submit.disabled = true;
    try {
      showError("");
      await setInvQty(item, qty, { fromAddPart: true });
      invSelectedItem = "";
      if (els.inv_item) els.inv_item.value = "";
      clearInvPartLabel();
      if (els.inv_qty) els.inv_qty.value = "1";
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      if (els.inv_add_submit) els.inv_add_submit.disabled = false;
    }
  }

  async function saveInvRowInput(input) {
    const item = (input.getAttribute("data-item") || "").trim();
    const prev = Number(input.getAttribute("data-prev"));
    const qty = Number(input.value);
    if (!item || Number.isNaN(qty) || qty < 0) {
      input.value = String(prev);
      return;
    }
    if (qty === prev) return;
    input.disabled = true;
    try {
      showError("");
      const result = await setInvQty(item, qty, { fromAddPart: false });
      input.setAttribute("data-prev", String(result.qty));
      if (!result.updated) input.value = String(result.qty);
    } catch (err) {
      input.value = String(prev);
      showError(err.message || String(err));
    } finally {
      input.disabled = false;
    }
  }

  function wire() {
    if (els.btn_open_add_stock) {
      els.btn_open_add_stock.addEventListener("click", () => openSheet("add-stock"));
    }
    if (els.btn_open_inv_qty) {
      els.btn_open_inv_qty.addEventListener("click", () => openSheet("inv-qty"));
    }
    if (els.detail_close) {
      els.detail_close.addEventListener("click", () => closeSheet());
    }
    if (els.detail_desktop_close) {
      els.detail_desktop_close.addEventListener("click", () => closeSheet());
    }
    if (els.truck_detail_backdrop) {
      els.truck_detail_backdrop.addEventListener("click", () => closeSheet());
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.sheet) closeSheet();
    });
    const onCompactChange = () => {
      if (!state.sheet) {
        closePhoneDetail();
        return;
      }
      if (isCompact()) openPhoneDetail();
      else closePhoneDetail();
    };
    if (typeof COMPACT_MQ.addEventListener === "function") {
      COMPACT_MQ.addEventListener("change", onCompactChange);
    } else if (typeof COMPACT_MQ.addListener === "function") {
      COMPACT_MQ.addListener(onCompactChange);
    }

    if (els.add_item) {
      els.add_item.addEventListener("input", () => {
        if (els.add_item.value.trim() !== selectedPartItem) {
          selectedPartItem = "";
          clearAddPartLabel();
          state.sourceBuckets = [];
          renderAddFrom();
        }
        clearTimeout(partSearchTimer);
        partSearchTimer = setTimeout(() => {
          runPartSearch(els.add_item, els.add_part_results, selectedPartItem).catch(
            (err) => showError(err.message || String(err))
          );
        }, 200);
      });
    }
    if (els.add_part_results) {
      els.add_part_results.addEventListener("click", (event) => {
        const btn = event.target.closest(".dgs-wo-pr-hit");
        if (!btn) return;
        selectAddPart({
          item: btn.getAttribute("data-item") || "",
          name: btn.getAttribute("data-name") || "",
          mfr: btn.getAttribute("data-mfr") || "",
        });
      });
    }
    if (els.add_stock_form) {
      els.add_stock_form.addEventListener("submit", (event) => {
        submitAddStock(event).catch((err) => showError(err.message || String(err)));
      });
    }

    if (els.inv_item) {
      els.inv_item.addEventListener("input", () => {
        if (els.inv_item.value.trim() !== invSelectedItem) {
          invSelectedItem = "";
          clearInvPartLabel();
        }
        clearTimeout(invSearchTimer);
        invSearchTimer = setTimeout(() => {
          runPartSearch(els.inv_item, els.inv_part_results, invSelectedItem).catch(
            (err) => showError(err.message || String(err))
          );
        }, 200);
      });
    }
    if (els.inv_part_results) {
      els.inv_part_results.addEventListener("click", (event) => {
        const btn = event.target.closest(".dgs-wo-pr-hit");
        if (!btn) return;
        selectInvPart({
          item: btn.getAttribute("data-item") || "",
          name: btn.getAttribute("data-name") || "",
          mfr: btn.getAttribute("data-mfr") || "",
        });
      });
    }
    if (els.inv_add_form) {
      els.inv_add_form.addEventListener("submit", (event) => {
        submitInvAdd(event).catch((err) => showError(err.message || String(err)));
      });
    }
    if (els.inv_current_list) {
      els.inv_current_list.addEventListener("change", (event) => {
        const input = event.target.closest(".dgs-truck-inv-qty");
        if (!input) return;
        saveInvRowInput(input).catch((err) => showError(err.message || String(err)));
      });
      els.inv_current_list.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const input = event.target.closest(".dgs-truck-inv-qty");
        if (!input) return;
        event.preventDefault();
        input.blur();
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
  }

  async function init() {
    cacheEls();
    wire();
    setDetailEmpty(true);
    if (isCompact() && els.detail_panel) {
      els.detail_panel.setAttribute("aria-hidden", "true");
    }
    try {
      await load();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  window.TruckInventoryApp = { init };
})();
