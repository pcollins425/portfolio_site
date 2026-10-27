/* Add Work Order — field preview drawer (create API next). */
(function () {
  "use strict";

  let meta = null;
  let selected = null;
  let searchTimer = null;
  let assetMap = {};
  let syncingPlace = false;

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
    selected = null;
    assetMap = {};
  }

  function setVal(drawer, id, value) {
    const el = drawer.querySelector(`#${id}`);
    if (el) el.value = value == null ? "" : String(value);
  }

  function applyAsset(drawer, match, opts) {
    const options = opts || {};
    selected = match || null;
    if (!match) {
      if (!options.keepPlace) {
        setVal(drawer, "wo-cr-property", "");
        setVal(drawer, "wo-cr-compid", "");
        setVal(drawer, "wo-cr-cabinet", "");
        setVal(drawer, "wo-cr-theme", "");
        setVal(drawer, "wo-cr-bank-loc", "");
        setVal(drawer, "wo-cr-asset-id", "");
      }
      return;
    }
    setVal(drawer, "wo-cr-compid", match.compid || match.asset_no || "");
    setVal(drawer, "wo-cr-property", match.property || "");
    setVal(drawer, "wo-cr-cabinet", match.cabinet || "");
    setVal(drawer, "wo-cr-theme", match.theme || "");
    setVal(
      drawer,
      "wo-cr-bank-loc",
      match.bank && match.location ? `${match.bank} / ${match.location}` : match.bank || match.location || ""
    );
    setVal(drawer, "wo-cr-asset-id", match.asset_id || "");
    setVal(drawer, "wo-cr-casino-id", match.casino_id || "");

    const assetInput = drawer.querySelector("#wo-cr-asset");
    if (assetInput && options.fromSearch !== false) {
      assetInput.value = match.compid || match.asset_no || match.label || "";
    }

    const hits = drawer.querySelector("#wo-cr-asset-hits");
    if (hits) {
      hits.hidden = true;
      hits.innerHTML = "";
    }

    // Align place selects when we know casino
    if (match.casino_id && !options.skipPlaceSync) {
      syncPlaceFromCasino(drawer, match.casino_id, match);
    }
  }

  async function syncPlaceFromCasino(drawer, casinoId, match) {
    if (syncingPlace) return;
    const casinoEl = drawer.querySelector("#wo-cr-casino");
    if (!casinoEl) return;
    // If casino already selected and matches, just set asset option
    if (casinoEl.value === casinoId) {
      ensureAssetOption(drawer, match);
      return;
    }
    // We don't have state/tribe on the match — leave place filters as user set,
    // but load assets for that casino into the Asset datalist source map.
    try {
      syncingPlace = true;
      await loadCasinoAssets(drawer, casinoId, match);
    } finally {
      syncingPlace = false;
    }
  }

  function ensureAssetOption(drawer, match) {
    if (!match) return;
    const key = match.asset_id || match.compid;
    if (!key) return;
    assetMap[key] = match;
  }

  function fillSelect(el, items, valueKey, labelKey, placeholder) {
    if (!el) return;
    const current = el.value;
    const opts = [`<option value="">${esc(placeholder || "—")}</option>`].concat(
      (items || []).map(
        (item) =>
          `<option value="${esc(item[valueKey])}">${esc(item[labelKey])}</option>`
      )
    );
    el.innerHTML = opts.join("");
    el.disabled = false;
    if (current && [...el.options].some((o) => o.value === current)) {
      el.value = current;
    }
  }

  function clearDownstream(drawer, from) {
    const tribeEl = drawer.querySelector("#wo-cr-tribe");
    const casinoEl = drawer.querySelector("#wo-cr-casino");
    if (from === "state") {
      fillSelect(tribeEl, [], "tribe_id", "tribe_name", "—");
      fillSelect(casinoEl, [], "casino_id", "casino_name", "—");
      assetMap = {};
    } else if (from === "tribe") {
      fillSelect(casinoEl, [], "casino_id", "casino_name", "—");
      assetMap = {};
    } else if (from === "casino") {
      assetMap = {};
    }
  }

  async function loadCasinoAssets(drawer, casinoId, prefer) {
    if (!casinoId) {
      assetMap = {};
      return;
    }
    const data = await fetchJson(
      `/api/work-orders/create/casino-assets?casino_id=${encodeURIComponent(casinoId)}`
    );
    const assets = data.assets || [];
    assetMap = Object.fromEntries(assets.map((a) => [a.asset_id || a.compid, a]));
    if (prefer) ensureAssetOption(drawer, prefer);
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
            <select id="wo-cr-state" class="dgs-wo-create-control"><option value="">—</option></select>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Tribe</span>
            <select id="wo-cr-tribe" class="dgs-wo-create-control"><option value="">—</option></select>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Casino</span>
            <select id="wo-cr-casino" class="dgs-wo-create-control"><option value="">—</option></select>
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Asset</span>
            <input type="search" id="wo-cr-asset" class="dgs-wo-create-control" placeholder="House # or serial" autocomplete="off" />
          </label>
          <div id="wo-cr-asset-hits" class="dgs-wo-create-hits" hidden></div>

          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Property</span>
            <input type="text" id="wo-cr-property" class="dgs-wo-create-control is-readonly" readonly />
          </label>
          <label class="dgs-wo-create-field">
            <span class="dgs-wo-create-label">Serial / compid</span>
            <input type="text" id="wo-cr-compid" class="dgs-wo-create-control is-readonly" readonly />
          </label>
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
          <input type="hidden" id="wo-cr-casino-id" />

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

    // game_oos mirrors asst_dwn on create (same meaning for techs)
    drawer.querySelector("#wo-cr-asst-dwn")?.addEventListener("change", () => {
      /* value read at submit time as both asst_dwn and game_oos */
    });

    const stateEl = drawer.querySelector("#wo-cr-state");
    const tribeEl = drawer.querySelector("#wo-cr-tribe");
    const casinoEl = drawer.querySelector("#wo-cr-casino");
    const assetInput = drawer.querySelector("#wo-cr-asset");
    const hits = drawer.querySelector("#wo-cr-asset-hits");

    stateEl?.addEventListener("change", async () => {
      clearDownstream(drawer, "state");
      applyAsset(drawer, null, { keepPlace: true });
      setVal(drawer, "wo-cr-asset", "");
      const sid = stateEl.value;
      if (!sid) return;
      try {
        const data = await fetchJson(
          `/api/slot-master/tribes?state_id=${encodeURIComponent(sid)}`
        );
        fillSelect(tribeEl, data.items || [], "tribe_id", "tribe_name", "—");
      } catch (err) {
        setStatus(drawer, err.message || String(err), true);
      }
    });

    tribeEl?.addEventListener("change", async () => {
      clearDownstream(drawer, "tribe");
      applyAsset(drawer, null, { keepPlace: true });
      setVal(drawer, "wo-cr-asset", "");
      const tid = tribeEl.value;
      if (!tid) return;
      try {
        const data = await fetchJson(
          `/api/slot-master/casinos?tribe_id=${encodeURIComponent(tid)}`
        );
        fillSelect(casinoEl, data.items || [], "casino_id", "casino_name", "—");
      } catch (err) {
        setStatus(drawer, err.message || String(err), true);
      }
    });

    casinoEl?.addEventListener("change", async () => {
      clearDownstream(drawer, "casino");
      applyAsset(drawer, null, { keepPlace: true });
      setVal(drawer, "wo-cr-asset", "");
      const cid = casinoEl.value;
      setVal(drawer, "wo-cr-casino-id", cid);
      if (!cid) return;
      try {
        await loadCasinoAssets(drawer, cid);
      } catch (err) {
        setStatus(drawer, err.message || String(err), true);
      }
    });

    assetInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = (assetInput.value || "").trim();
      searchTimer = setTimeout(async () => {
        if (q.length < 2) {
          if (hits) {
            hits.hidden = true;
            hits.innerHTML = "";
          }
          return;
        }
        // Prefer in-casino map filter when casino is set
        const cid = casinoEl?.value;
        if (cid && Object.keys(assetMap).length) {
          const needle = q.toLowerCase();
          const local = Object.values(assetMap).filter((a) => {
            const blob = [a.compid, a.asset_no, a.label, a.theme, a.cabinet]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return blob.includes(needle);
          });
          hits.hidden = false;
          if (!local.length) {
            hits.innerHTML = `<p class="dgs-wo-create-hit-empty">No machines at this casino.</p>`;
            return;
          }
          hits.innerHTML = local
            .slice(0, 20)
            .map(
              (m) =>
                `<button type="button" class="dgs-wo-create-hit" data-key="${esc(
                  m.asset_id || m.compid
                )}">${esc(m.label || m.compid)}</button>`
            )
            .join("");
          return;
        }
        hits.hidden = false;
        hits.innerHTML = `<p class="dgs-wo-create-hit-empty">Searching…</p>`;
        try {
          const data = await fetchJson(
            `/api/work-orders/create/resolve-asset?q=${encodeURIComponent(q)}&limit=15`
          );
          const matches = data.matches || [];
          matches.forEach((m) => ensureAssetOption(drawer, m));
          if (!matches.length) {
            hits.innerHTML = `<p class="dgs-wo-create-hit-empty">No machines matched.</p>`;
            return;
          }
          hits.innerHTML = matches
            .map(
              (m) =>
                `<button type="button" class="dgs-wo-create-hit" data-key="${esc(
                  m.asset_id || m.compid
                )}">${esc(m.label || m.compid)}</button>`
            )
            .join("");
        } catch (err) {
          hits.innerHTML = `<p class="dgs-wo-create-hit-empty is-error">${esc(
            err.message || err
          )}</p>`;
        }
      }, 280);
    });

    hits?.addEventListener("click", (event) => {
      const btn = event.target.closest(".dgs-wo-create-hit");
      if (!btn) return;
      const key = btn.getAttribute("data-key");
      const match = assetMap[key];
      if (match) applyAsset(drawer, match, { skipPlaceSync: false });
    });

    fetchJson("/api/slot-master/states")
      .then((data) => {
        fillSelect(stateEl, data.items || [], "state_id", "state_name", "—");
      })
      .catch((err) => setStatus(drawer, err.message || String(err), true));
  }

  /** Values for future create POST — game_oos mirrors asst_dwn. */
  function collectPayload(drawer) {
    const down = (drawer.querySelector("#wo-cr-asst-dwn") || {}).value || "No";
    return {
      property: (drawer.querySelector("#wo-cr-property") || {}).value || "",
      compid: (drawer.querySelector("#wo-cr-compid") || {}).value || "",
      asset_id: (drawer.querySelector("#wo-cr-asset-id") || {}).value || "",
      casino_id: (drawer.querySelector("#wo-cr-casino-id") || {}).value || "",
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
    const { drawer } = ensureDrawer();
    selected = null;
    assetMap = {};
    drawer.innerHTML = formHtml();
    document.body.classList.add("wo-create-open");
    bind(drawer);
    drawer.querySelector("#wo-cr-asset")?.focus();
  }

  window.DGSWorkOrderCreate = { open, close, collectPayload };
})();
