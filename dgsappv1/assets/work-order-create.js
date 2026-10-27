/* Add Work Order — field preview drawer (create API next). */
(function () {
  "use strict";

  let meta = null;
  let places = { states: [], tribes: [], casinos: [] };
  let assetMap = {};
  let searchTimer = null;
  let syncing = false;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function fetchJson(path) {
    let res;
    try {
      res = await fetch(`${DGSAuth.apiBase()}${path}`, {
        headers: DGSAuth.authHeaders(),
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      throw new Error(
        msg === "Failed to fetch"
          ? "Could not reach the API (network or gateway). Try again."
          : msg
      );
    }
    if (!res.ok) {
      let detail = await res.text();
      try {
        const parsed = JSON.parse(detail);
        if (parsed && parsed.detail) detail = parsed.detail;
      } catch (_) {
        /* keep */
      }
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return res.json();
  }

  function ensureDrawer() {
    let backdrop = document.getElementById("wo-create-backdrop");
    let drawer = document.getElementById("wo-create-drawer");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "wo-create-backdrop";
      backdrop.className = "dgs-capacity-drawer-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", close);
    }
    if (!drawer) {
      drawer = document.createElement("aside");
      drawer.id = "wo-create-drawer";
      drawer.className = "dgs-capacity-drawer is-wo-create";
      drawer.setAttribute("aria-label", "Add work order");
      document.body.appendChild(drawer);
    }
    return { backdrop, drawer };
  }

  function close() {
    document.body.classList.remove("wo-create-open");
    const drawer = document.getElementById("wo-create-drawer");
    if (drawer) drawer.innerHTML = "";
    assetMap = {};
  }

  function setVal(drawer, id, value) {
    const el = drawer.querySelector(`#${id}`);
    if (el) el.value = value == null ? "" : String(value);
  }

  function casinoById(id) {
    return (places.casinos || []).find((c) => c.casino_id === id) || null;
  }

  function filteredTribes(stateId) {
    const all = places.tribes || [];
    if (!stateId) return all;
    return all.filter((t) => t.state_id === stateId);
  }

  function filteredCasinos(stateId, tribeId) {
    let list = places.casinos || [];
    if (stateId) list = list.filter((c) => c.state_id === stateId);
    if (tribeId) list = list.filter((c) => c.tribe_id === tribeId);
    return list;
  }

  function fillSelect(el, items, valueKey, labelKey, selected) {
    if (!el) return;
    const opts = [`<option value="">—</option>`].concat(
      (items || []).map((item) => {
        const value = item[valueKey];
        const sel = selected && value === selected ? " selected" : "";
        return `<option value="${esc(value)}"${sel}>${esc(item[labelKey])}</option>`;
      })
    );
    el.innerHTML = opts.join("");
  }

  function refreshPlaceSelects(drawer, prefer) {
    const pref = prefer || {};
    const stateEl = drawer.querySelector("#wo-cr-state");
    const tribeEl = drawer.querySelector("#wo-cr-tribe");
    const casinoEl = drawer.querySelector("#wo-cr-casino");
    const stateId = pref.state_id != null ? pref.state_id : stateEl?.value || "";
    const tribeId = pref.tribe_id != null ? pref.tribe_id : tribeEl?.value || "";
    const casinoId =
      pref.casino_id != null ? pref.casino_id : casinoEl?.value || "";

    fillSelect(stateEl, places.states, "state_id", "state_name", stateId);
    fillSelect(
      tribeEl,
      filteredTribes(stateId),
      "tribe_id",
      "tribe_name",
      tribeId
    );
    fillSelect(
      casinoEl,
      filteredCasinos(stateId, tribeId),
      "casino_id",
      "casino_name",
      casinoId
    );
  }

  function setContext(drawer, match) {
    setVal(drawer, "wo-cr-cabinet", (match && match.cabinet) || "");
    setVal(drawer, "wo-cr-theme", (match && match.theme) || "");
    setVal(
      drawer,
      "wo-cr-bank-loc",
      match && match.bank && match.location
        ? `${match.bank} / ${match.location}`
        : (match && (match.bank || match.location)) || ""
    );
    setVal(drawer, "wo-cr-asset-id", (match && match.asset_id) || "");
  }

  async function loadCasinoAssets(casinoId) {
    if (!casinoId) {
      assetMap = {};
      return [];
    }
    const data = await fetchJson(
      `/api/work-orders/create/casino-assets?casino_id=${encodeURIComponent(casinoId)}`
    );
    const assets = data.assets || [];
    assetMap = Object.fromEntries(assets.map((a) => [a.asset_id || a.compid, a]));
    return assets;
  }

  function showAssetHits(drawer, matches) {
    const hits = drawer.querySelector("#wo-cr-asset-hits");
    if (!hits) return;
    if (!matches.length) {
      hits.hidden = false;
      hits.innerHTML = `<p class="dgs-wo-create-hit-empty">No machines matched.</p>`;
      return;
    }
    matches.forEach((m) => {
      const key = m.asset_id || m.compid;
      if (key) assetMap[key] = m;
    });
    hits.hidden = false;
    hits.innerHTML = matches
      .slice(0, 25)
      .map(
        (m) =>
          `<button type="button" class="dgs-wo-create-hit" data-key="${esc(
            m.asset_id || m.compid
          )}">${esc(m.label || m.compid)}</button>`
      )
      .join("");
  }

  function hideAssetHits(drawer) {
    const hits = drawer.querySelector("#wo-cr-asset-hits");
    if (!hits) return;
    hits.hidden = true;
    hits.innerHTML = "";
  }

  async function applyAsset(drawer, match) {
    if (!match) {
      setVal(drawer, "wo-cr-asset", "");
      setContext(drawer, null);
      return;
    }
    const serial = match.compid || match.asset_no || "";
    setVal(drawer, "wo-cr-asset", serial);
    setContext(drawer, match);
    hideAssetHits(drawer);

    const casinoId = match.casino_id;
    if (!casinoId) return;
    const casino = casinoById(casinoId);
    if (!casino) return;
    syncing = true;
    try {
      refreshPlaceSelects(drawer, {
        state_id: casino.state_id || "",
        tribe_id: casino.tribe_id || "",
        casino_id: casino.casino_id,
      });
      await loadCasinoAssets(casino.casino_id);
      if (match.asset_id || match.compid) {
        assetMap[match.asset_id || match.compid] = match;
      }
    } finally {
      syncing = false;
    }
  }

  function formHtml() {
    const types = (meta && meta.wo_types) || [];
    const probs = (meta && meta.prob_types) || [];
    const typeOpts = [`<option value="">—</option>`]
      .concat(types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`))
      .join("");
    const probOpts = [`<option value="">—</option>`]
      .concat(probs.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`))
      .join("");
    const preview = meta && meta.create_preview_only;

    return `
      <div class="dgs-v2-drawer-header dgs-wo-create-head">
        <div>
          <p class="dgs-v2-eyebrow">Work orders</p>
          <h2 class="dgs-v2-drawer-title">Add work order</h2>
          <p class="dgs-v2-subtitle">${
            preview ? "Preview — create not wired yet" : "Create in eMaint + SQL"
          }</p>
        </div>
        <button type="button" class="dgs-v2-drawer-close" id="wo-create-close" aria-label="Close">×</button>
      </div>
      <div class="dgs-capacity-drawer-body dgs-wo-create-body">
        <div class="dgs-wo-create-stack">
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">State</span>
            <select id="wo-cr-state" class="dgs-wo-create-control"></select>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Tribe</span>
            <select id="wo-cr-tribe" class="dgs-wo-create-control"></select>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Casino</span>
            <select id="wo-cr-casino" class="dgs-wo-create-control"></select>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Asset</span>
            <input type="search" id="wo-cr-asset" class="dgs-wo-create-control" placeholder="Type or pick house # / serial" autocomplete="off" />
          </label>
          <div id="wo-cr-asset-hits" class="dgs-wo-create-hits" hidden></div>

          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Cabinet</span>
            <input type="text" id="wo-cr-cabinet" class="dgs-wo-create-control is-readonly" readonly />
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Theme</span>
            <input type="text" id="wo-cr-theme" class="dgs-wo-create-control is-readonly" readonly />
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Bank / location</span>
            <input type="text" id="wo-cr-bank-loc" class="dgs-wo-create-control is-readonly" readonly />
          </label>
          <input type="hidden" id="wo-cr-asset-id" />

          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Brief description</span>
            <input type="text" id="wo-cr-brief" class="dgs-wo-create-control" maxlength="200" />
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Work description</span>
            <textarea id="wo-cr-work" class="dgs-wo-create-control" rows="4"></textarea>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">WO type</span>
            <select id="wo-cr-type" class="dgs-wo-create-control">${typeOpts}</select>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Problem type</span>
            <select id="wo-cr-prob" class="dgs-wo-create-control">${probOpts}</select>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Is asset down?</span>
            <select id="wo-cr-asst-dwn" class="dgs-wo-create-control">
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </label>

          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Assigned to</span>
            <input type="text" id="wo-cr-assign" class="dgs-wo-create-control" />
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Requestor</span>
            <input type="text" id="wo-cr-requestor" class="dgs-wo-create-control" />
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Requestor phone</span>
            <input type="text" id="wo-cr-req-tele" class="dgs-wo-create-control" />
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Drive time (hours)</span>
            <input type="number" id="wo-cr-drive" class="dgs-wo-create-control" min="0" step="0.25" />
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Work man hours</span>
            <input type="number" id="wo-cr-man" class="dgs-wo-create-control" min="0" step="0.25" />
          </label>
        </div>

        <p class="dgs-wo-create-status" id="wo-cr-status" hidden></p>
        <div class="dgs-wo-create-actions">
          <button type="button" class="dgs-v2-btn dgs-v2-btn-primary" id="wo-cr-submit" disabled>
            Create (coming soon)
          </button>
          <button type="button" class="dgs-v2-btn" id="wo-cr-cancel">Cancel</button>
        </div>
      </div>`;
  }

  function setStatus(drawer, msg, isError) {
    const el = drawer.querySelector("#wo-cr-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("is-error", !!isError);
  }

  function bind(drawer) {
    drawer.querySelector("#wo-create-close")?.addEventListener("click", close);
    drawer.querySelector("#wo-cr-cancel")?.addEventListener("click", close);

    const me =
      window.DGSAuth && typeof DGSAuth.getUser === "function" ? DGSAuth.getUser() : null;
    const assign = drawer.querySelector("#wo-cr-assign");
    if (assign && me && (me.name || me.email)) {
      assign.value = me.name || me.email || "";
    }

    const stateEl = drawer.querySelector("#wo-cr-state");
    const tribeEl = drawer.querySelector("#wo-cr-tribe");
    const casinoEl = drawer.querySelector("#wo-cr-casino");
    const assetInput = drawer.querySelector("#wo-cr-asset");
    const hits = drawer.querySelector("#wo-cr-asset-hits");

    refreshPlaceSelects(drawer);

    stateEl?.addEventListener("change", () => {
      if (syncing) return;
      const stateId = stateEl.value;
      refreshPlaceSelects(drawer, {
        state_id: stateId,
        tribe_id: "",
        casino_id: "",
      });
      assetMap = {};
      setVal(drawer, "wo-cr-asset", "");
      setContext(drawer, null);
      hideAssetHits(drawer);
    });

    tribeEl?.addEventListener("change", () => {
      if (syncing) return;
      const stateId = stateEl.value;
      const tribeId = tribeEl.value;
      // Picking tribe alone can imply state
      let nextState = stateId;
      if (tribeId && !nextState) {
        const tribe = (places.tribes || []).find((t) => t.tribe_id === tribeId);
        if (tribe) nextState = tribe.state_id || "";
      }
      refreshPlaceSelects(drawer, {
        state_id: nextState,
        tribe_id: tribeId,
        casino_id: "",
      });
      assetMap = {};
      setVal(drawer, "wo-cr-asset", "");
      setContext(drawer, null);
      hideAssetHits(drawer);
    });

    casinoEl?.addEventListener("change", async () => {
      if (syncing) return;
      const casinoId = casinoEl.value;
      const casino = casinoById(casinoId);
      if (casino) {
        syncing = true;
        try {
          refreshPlaceSelects(drawer, {
            state_id: casino.state_id || "",
            tribe_id: casino.tribe_id || "",
            casino_id: casino.casino_id,
          });
        } finally {
          syncing = false;
        }
      }
      setVal(drawer, "wo-cr-asset", "");
      setContext(drawer, null);
      hideAssetHits(drawer);
      if (!casinoId) {
        assetMap = {};
        return;
      }
      try {
        const assets = await loadCasinoAssets(casinoId);
        // Open dropdown so tech sees options immediately
        if (assets.length) showAssetHits(drawer, assets);
      } catch (err) {
        setStatus(drawer, err.message || String(err), true);
      }
    });

    async function runAssetSearch(showAllAtCasino) {
      const q = (assetInput.value || "").trim();
      const casinoId = casinoEl?.value || "";

      if (casinoId && Object.keys(assetMap).length) {
        const needle = q.toLowerCase();
        let local = Object.values(assetMap);
        if (needle) {
          local = local.filter((a) => {
            const blob = [a.compid, a.asset_no, a.label, a.theme, a.cabinet]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return blob.includes(needle);
          });
        } else if (!showAllAtCasino) {
          hideAssetHits(drawer);
          return;
        }
        showAssetHits(drawer, local);
        return;
      }

      if (q.length < 2) {
        hideAssetHits(drawer);
        return;
      }
      hits.hidden = false;
      hits.innerHTML = `<p class="dgs-wo-create-hit-empty">Searching…</p>`;
      try {
        const data = await fetchJson(
          `/api/work-orders/create/resolve-asset?q=${encodeURIComponent(q)}&limit=20`
        );
        showAssetHits(drawer, data.matches || []);
      } catch (err) {
        hits.innerHTML = `<p class="dgs-wo-create-hit-empty is-error">${esc(
          err.message || err
        )}</p>`;
      }
    }

    assetInput?.addEventListener("focus", () => {
      const casinoId = casinoEl?.value || "";
      if (casinoId && Object.keys(assetMap).length) {
        showAssetHits(drawer, Object.values(assetMap));
      }
    });
    assetInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runAssetSearch(false), 220);
    });

    hits?.addEventListener("click", (event) => {
      const btn = event.target.closest(".dgs-wo-create-hit");
      if (!btn) return;
      const match = assetMap[btn.getAttribute("data-key")];
      if (match) applyAsset(drawer, match);
    });
  }

  function collectPayload(drawer) {
    const down = (drawer.querySelector("#wo-cr-asst-dwn") || {}).value || "No";
    const casinoId = (drawer.querySelector("#wo-cr-casino") || {}).value || "";
    const casino = casinoById(casinoId);
    const serial = (drawer.querySelector("#wo-cr-asset") || {}).value || "";
    return {
      property: (casino && casino.property) || (casino && casino.casino_name) || "",
      casino_id: casinoId,
      compid: serial,
      asset_id: (drawer.querySelector("#wo-cr-asset-id") || {}).value || "",
      brief_desc: (drawer.querySelector("#wo-cr-brief") || {}).value || "",
      work_desc: (drawer.querySelector("#wo-cr-work") || {}).value || "",
      wo_type: (drawer.querySelector("#wo-cr-type") || {}).value || "",
      probtype: (drawer.querySelector("#wo-cr-prob") || {}).value || "",
      asst_dwn: down,
      game_oos: down,
      assignto: (drawer.querySelector("#wo-cr-assign") || {}).value || "",
      requestor: (drawer.querySelector("#wo-cr-requestor") || {}).value || "",
      req_tele: (drawer.querySelector("#wo-cr-req-tele") || {}).value || "",
      drivetime: (drawer.querySelector("#wo-cr-drive") || {}).value || "",
      workmhours: (drawer.querySelector("#wo-cr-man") || {}).value || "",
    };
  }

  async function open(options) {
    meta = (options && options.meta) || meta;
    if (!meta) {
      try {
        meta = await fetchJson("/api/work-orders/meta");
      } catch (_) {
        meta = { create_preview_only: true, wo_types: [], prob_types: [] };
      }
    }
    try {
      places = await fetchJson("/api/work-orders/create/places");
    } catch (err) {
      places = { states: [], tribes: [], casinos: [] };
    }
    const { drawer } = ensureDrawer();
    assetMap = {};
    drawer.innerHTML = formHtml();
    document.body.classList.add("wo-create-open");
    bind(drawer);
    if (!places.casinos || !places.casinos.length) {
      setStatus(drawer, "No casinos available for your route.", true);
    }
    drawer.querySelector("#wo-cr-casino")?.focus();
  }

  window.DGSWorkOrderCreate = { open, close, collectPayload };
})();
