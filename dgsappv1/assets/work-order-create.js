/* Add Work Order — field preview drawer (create API next). */
(function () {
  "use strict";

  let meta = null;
  let selected = null;
  let searchTimer = null;

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
  }

  function applyAsset(match) {
    selected = match || null;
    const drawer = document.getElementById("wo-create-drawer");
    if (!drawer || !match) return;
    const set = (id, value) => {
      const el = drawer.querySelector(`#${id}`);
      if (el) el.value = value || "";
    };
    set("wo-cr-compid", match.compid || match.asset_no);
    set("wo-cr-property", match.property);
    set("wo-cr-asset-id", match.asset_id);
    set("wo-cr-casino-id", match.casino_id);
    const summary = drawer.querySelector("#wo-cr-asset-summary");
    if (summary) {
      summary.hidden = false;
      summary.innerHTML = `<strong>${esc(match.label || match.compid || "—")}</strong>
        <div class="dgs-wo-mat-descrip">${esc(
          [match.cabinet, match.theme, match.bank && match.location ? `${match.bank}/${match.location}` : null]
            .filter(Boolean)
            .join(" · ")
        )}</div>`;
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
      <div class="dgs-capacity-drawer-head">
        <div>
          <p class="dgs-capacity-drawer-kicker">Work orders</p>
          <h2>Add work order</h2>
          <p class="dgs-capacity-drawer-meta">${
            preview
              ? "Field layout preview — eMaint create not wired yet"
              : "Create in eMaint + SQL"
          }</p>
        </div>
        <button type="button" class="dgs-v2-btn" id="wo-create-close">Close</button>
      </div>
      <div class="dgs-capacity-drawer-body dgs-wo-create-body">
        <section class="dgs-wo-section">
          <h3>Find machine</h3>
          <p class="dgs-wo-section-note">Asset # / serial fills property, cabinet, and theme. Limited to your licensed houses.</p>
          <div class="dgs-wo-fields">
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Asset search</span>
              <input type="search" id="wo-cr-asset-q" class="dgs-v2-input" placeholder="e.g. 5000702" autocomplete="off" />
            </label>
            <div id="wo-cr-asset-hits" class="dgs-wo-pr-results" hidden></div>
            <div id="wo-cr-asset-summary" class="dgs-wo-create-summary" hidden></div>
          </div>
          <div class="dgs-wo-create-place">
            <p class="dgs-wo-section-note">Or pick place, then machine</p>
            <div class="dgs-wo-create-place-grid">
              <label class="dgs-wo-field">
                <span class="dgs-wo-field-label">State</span>
                <select id="wo-cr-state" class="dgs-v2-input"><option value="">—</option></select>
              </label>
              <label class="dgs-wo-field">
                <span class="dgs-wo-field-label">Tribe</span>
                <select id="wo-cr-tribe" class="dgs-v2-input" disabled><option value="">—</option></select>
              </label>
              <label class="dgs-wo-field">
                <span class="dgs-wo-field-label">Casino</span>
                <select id="wo-cr-casino" class="dgs-v2-input" disabled><option value="">—</option></select>
              </label>
            </div>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Machine at casino</span>
              <select id="wo-cr-casino-asset" class="dgs-v2-input" disabled><option value="">—</option></select>
            </label>
          </div>
        </section>

        <section class="dgs-wo-section">
          <h3>From asset (eMaint)</h3>
          <div class="dgs-wo-fields">
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Property</span>
              <input type="text" id="wo-cr-property" class="dgs-v2-input" readonly />
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Asset / serial (compid)</span>
              <input type="text" id="wo-cr-compid" class="dgs-v2-input" readonly />
            </label>
            <input type="hidden" id="wo-cr-asset-id" />
            <input type="hidden" id="wo-cr-casino-id" />
          </div>
        </section>

        <section class="dgs-wo-section">
          <h3>Problem</h3>
          <div class="dgs-wo-fields">
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Brief description</span>
              <input type="text" id="wo-cr-brief" class="dgs-v2-input" maxlength="200" />
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Work description</span>
              <textarea id="wo-cr-work" class="dgs-v2-input" rows="4"></textarea>
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">WO type</span>
              <select id="wo-cr-type" class="dgs-v2-input">${typeOpts}</select>
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Problem type</span>
              <select id="wo-cr-prob" class="dgs-v2-input">${probOpts}</select>
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Is asset down? (asst_dwn)</span>
              <select id="wo-cr-asst-dwn" class="dgs-v2-input">
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Game OOS? (game_oos)</span>
              <select id="wo-cr-game-oos" class="dgs-v2-input">
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
          </div>
        </section>

        <section class="dgs-wo-section">
          <h3>People & time</h3>
          <div class="dgs-wo-fields">
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Assigned to</span>
              <input type="text" id="wo-cr-assign" class="dgs-v2-input" />
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Requestor</span>
              <input type="text" id="wo-cr-requestor" class="dgs-v2-input" />
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Requestor phone</span>
              <input type="text" id="wo-cr-req-tele" class="dgs-v2-input" />
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Drive time (hours)</span>
              <input type="number" id="wo-cr-drive" class="dgs-v2-input" min="0" step="0.25" />
            </label>
            <label class="dgs-wo-field">
              <span class="dgs-wo-field-label">Work man hours</span>
              <input type="number" id="wo-cr-man" class="dgs-v2-input" min="0" step="0.25" />
            </label>
          </div>
        </section>

        <p class="dgs-wo-pr-status" id="wo-cr-status" hidden></p>
        <div class="dgs-wo-pr-actions">
          <button type="button" class="dgs-v2-btn dgs-v2-btn-primary" id="wo-cr-submit" disabled>
            Create (coming soon)
          </button>
          <button type="button" class="dgs-v2-btn" id="wo-cr-cancel">Cancel</button>
        </div>
      </div>`;
  }

  function fillSelect(el, items, valueKey, labelKey, placeholder) {
    if (!el) return;
    const opts = [`<option value="">${esc(placeholder || "—")}</option>`].concat(
      (items || []).map(
        (item) =>
          `<option value="${esc(item[valueKey])}">${esc(item[labelKey])}</option>`
      )
    );
    el.innerHTML = opts.join("");
    el.disabled = !(items && items.length);
  }

  async function loadStates(drawer) {
    const stateEl = drawer.querySelector("#wo-cr-state");
    try {
      const data = await fetchJson("/api/slot-master/states");
      fillSelect(stateEl, data.items || [], "state_id", "state_name", "State");
    } catch (err) {
      setStatus(drawer, err.message || String(err), true);
    }
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

    const qInput = drawer.querySelector("#wo-cr-asset-q");
    const hits = drawer.querySelector("#wo-cr-asset-hits");
    qInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = (qInput.value || "").trim();
        if (q.length < 2) {
          if (hits) {
            hits.hidden = true;
            hits.innerHTML = "";
          }
          return;
        }
        hits.hidden = false;
        hits.innerHTML = `<p class="dgs-field-empty">Searching…</p>`;
        try {
          const data = await fetchJson(
            `/api/work-orders/create/resolve-asset?q=${encodeURIComponent(q)}&limit=15`
          );
          const matches = data.matches || [];
          if (!matches.length) {
            hits.innerHTML = `<p class="dgs-field-empty">No machines matched.</p>`;
            return;
          }
          hits.innerHTML = matches
            .map(
              (m) =>
                `<button type="button" class="dgs-wo-pr-hit" data-json="${esc(
                  JSON.stringify(m)
                )}">${esc(m.label || m.compid)}</button>`
            )
            .join("");
        } catch (err) {
          hits.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
        }
      }, 320);
    });
    hits?.addEventListener("click", (event) => {
      const btn = event.target.closest(".dgs-wo-pr-hit");
      if (!btn) return;
      try {
        applyAsset(JSON.parse(btn.getAttribute("data-json") || "{}"));
      } catch (_) {
        /* ignore */
      }
      hits.hidden = true;
      hits.innerHTML = "";
    });

    const stateEl = drawer.querySelector("#wo-cr-state");
    const tribeEl = drawer.querySelector("#wo-cr-tribe");
    const casinoEl = drawer.querySelector("#wo-cr-casino");
    const casinoAssetEl = drawer.querySelector("#wo-cr-casino-asset");

    stateEl?.addEventListener("change", async () => {
      fillSelect(tribeEl, [], "tribe_id", "tribe_name");
      fillSelect(casinoEl, [], "casino_id", "casino_name");
      fillSelect(casinoAssetEl, [], "asset_id", "label");
      const sid = stateEl.value;
      if (!sid) return;
      try {
        const data = await fetchJson(
          `/api/slot-master/tribes?state_id=${encodeURIComponent(sid)}`
        );
        fillSelect(tribeEl, data.items || [], "tribe_id", "tribe_name", "Tribe");
      } catch (err) {
        setStatus(drawer, err.message || String(err), true);
      }
    });
    tribeEl?.addEventListener("change", async () => {
      fillSelect(casinoEl, [], "casino_id", "casino_name");
      fillSelect(casinoAssetEl, [], "asset_id", "label");
      const tid = tribeEl.value;
      if (!tid) return;
      try {
        const data = await fetchJson(
          `/api/slot-master/casinos?tribe_id=${encodeURIComponent(tid)}`
        );
        fillSelect(casinoEl, data.items || [], "casino_id", "casino_name", "Casino");
      } catch (err) {
        setStatus(drawer, err.message || String(err), true);
      }
    });
    casinoEl?.addEventListener("change", async () => {
      fillSelect(casinoAssetEl, [], "asset_id", "label");
      const cid = casinoEl.value;
      if (!cid) return;
      try {
        const data = await fetchJson(
          `/api/work-orders/create/casino-assets?casino_id=${encodeURIComponent(cid)}`
        );
        const assets = data.assets || [];
        casinoAssetEl._assetMap = Object.fromEntries(
          assets.map((a) => [a.asset_id || a.compid, a])
        );
        fillSelect(
          casinoAssetEl,
          assets.map((a) => ({
            asset_id: a.asset_id || a.compid,
            label: a.label || a.compid,
          })),
          "asset_id",
          "label",
          "Machine"
        );
      } catch (err) {
        setStatus(drawer, err.message || String(err), true);
      }
    });
    casinoAssetEl?.addEventListener("change", () => {
      const key = casinoAssetEl.value;
      const map = casinoAssetEl._assetMap || {};
      if (key && map[key]) applyAsset(map[key]);
    });

    loadStates(drawer);
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
    drawer.innerHTML = formHtml();
    document.body.classList.add("wo-create-open");
    bind(drawer);
    drawer.querySelector("#wo-cr-asset-q")?.focus();
  }

  window.DGSWorkOrderCreate = { open, close };
})();
