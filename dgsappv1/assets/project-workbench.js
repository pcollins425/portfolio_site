(function () {
  "use strict";

  const STATE = {
    canWrite: false,
    tbdThemeId: null,
    items: [],
    activeRef: null,
    detail: null,
    casinoFilter: null,
  };

  function apiBase() {
    return window.DGSAuth ? DGSAuth.apiBase() : "";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(path, opts) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      window.DGSAuth ? DGSAuth.authHeaders() : {}
    );
    const res = await fetch(`${apiBase()}${path}`, Object.assign({ headers }, opts || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.detail || body.message || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return body;
  }

  function showError(msg) {
    const box = document.getElementById("error-box");
    if (!box) return;
    if (!msg) {
      box.hidden = true;
      box.textContent = "";
      return;
    }
    box.hidden = false;
    box.textContent = msg;
  }

  function qs() {
    return new URLSearchParams(window.location.search);
  }

  function setUrlRef(ref) {
    const u = new URL(window.location.href);
    if (ref) u.searchParams.set("ref", ref);
    else u.searchParams.delete("ref");
    if (STATE.casinoFilter) u.searchParams.set("casino", STATE.casinoFilter);
    history.replaceState({}, "", u);
  }

  function badgeStage(stage) {
    return `<span class="pwb-badge ${esc(stage)}">${esc(stage)}</span>`;
  }

  function badgeReady(row) {
    const r = row.computed_version_readiness || row.version_readiness || "pending";
    const blocked = Number(row.has_tbd_theme) || Number(row.open_check_count) > 0 || r === "blocked";
    const cls = blocked ? "blocked" : r === "ready" ? "ready" : "";
    const label = blocked
      ? `blocked${row.open_check_count ? ` (${row.open_check_count})` : ""}${
          Number(row.has_tbd_theme) ? " · TBD" : ""
        }`
      : r;
    return `<span class="pwb-badge ${cls}">${esc(label)}</span>`;
  }

  function renderList() {
    const root = document.getElementById("list-root");
    const count = document.getElementById("list-count");
    count.textContent = `${STATE.items.length} shown`;
    if (!STATE.items.length) {
      root.innerHTML = `<p class="pwb-empty">No proposals.</p>`;
      return;
    }
    root.innerHTML = STATE.items
      .map((it) => {
        const active = it.reference_key === STATE.activeRef ? " active" : "";
        return `<button type="button" class="pwb-item${active}" data-ref="${esc(
          it.reference_key
        )}">
          <div class="rk">${esc(it.reference_key)}</div>
          <div class="meta">${esc(it.casino_short || it.casino_name || it.casino_id)} · ${esc(
          it.kind
        )} · ${esc(it.unit_count)} units</div>
          <div class="meta">${badgeStage(it.stage)} ${badgeReady(it)}</div>
        </button>`;
      })
      .join("");
    root.querySelectorAll(".pwb-item").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.getAttribute("data-ref")));
    });
  }

  function canEditStage(stage) {
    return STATE.canWrite && (stage === "draft" || stage === "pre_check");
  }

  function renderDetail() {
    const root = document.getElementById("detail-root");
    const hint = document.getElementById("write-hint");
    hint.textContent = STATE.canWrite ? "write on" : "read-only";
    const d = STATE.detail;
    if (!d || !d.proposal) {
      root.innerHTML = `<p class="pwb-empty">Select a proposal.</p>`;
      return;
    }
    const p = d.proposal;
    const editable = canEditStage(p.stage);

    let actions = "";
    if (STATE.canWrite && p.stage === "draft") {
      actions += `<button type="button" class="dgs-v2-btn dgs-v2-btn--primary" id="btn-send-precheck">Send to Pre-Check</button>`;
    }
    if (STATE.canWrite && p.stage === "pre_check") {
      actions += `<button type="button" class="dgs-v2-btn" id="btn-return-draft">Return to draft…</button>`;
    }

    const unitsRows = (d.units || [])
      .map((u) => {
        const themeLabel = Number(u.is_tbd)
          ? `<span class="pwb-tbd">TBD</span>`
          : esc(u.proposed_theme_name || u.proposed_theme_id || "—");
        const themeEditor = editable
          ? `<div class="pwb-rel theme-cell">
              <input data-unit="${esc(u.uuid)}" data-field="theme_q" placeholder="Search theme…" value="${
                Number(u.is_tbd) ? "" : esc(u.proposed_theme_name || "")
              }" />
              <div class="pwb-theme-results" hidden></div>
              <div style="margin-top:4px;font-size:.75rem;color:#9aa3b2">${themeLabel} · ${esc(
                u.proposed_theme_id || ""
              )}</div>
            </div>`
          : `<span class="${Number(u.is_tbd) ? "pwb-tbd" : ""}">${themeLabel}</span>`;
        return `<tr>
          <td>${esc(u.sort_order)}</td>
          <td>${
            editable
              ? `<select data-unit="${esc(u.uuid)}" data-field="op">
                  ${["convert", "install", "remove", "move"]
                    .map(
                      (o) =>
                        `<option value="${o}"${u.op === o ? " selected" : ""}>${o}</option>`
                    )
                    .join("")}
                </select>`
              : esc(u.op)
          }</td>
          <td>${
            editable
              ? `<input data-unit="${esc(u.uuid)}" data-field="serial" value="${esc(u.serial || "")}" />`
              : esc(u.serial || "")
          }</td>
          <td>${themeEditor}</td>
          <td>${
            editable
              ? `<input data-unit="${esc(u.uuid)}" data-field="zone" value="${esc(
                  u.zone || ""
                )}" style="max-width:70px" />`
              : esc(u.zone || "")
          }</td>
          <td>${
            editable
              ? `<input data-unit="${esc(u.uuid)}" data-field="bank" value="${esc(
                  u.bank || ""
                )}" style="max-width:70px" />`
              : esc(u.bank || "")
          }</td>
          <td>${
            editable
              ? `<input data-unit="${esc(u.uuid)}" data-field="location" value="${esc(
                  u.location || ""
                )}" style="max-width:70px" />`
              : esc(u.location || "")
          }</td>
        </tr>`;
      })
      .join("");

    const checkRows = (d.checks || [])
      .map((c) => {
        const statusSelect = editable
          ? `<select data-check="${esc(c.uuid)}" data-field="status">
              ${["pending", "in_progress", "blocker", "ready", "na"]
                .map(
                  (s) =>
                    `<option value="${s}"${c.status === s ? " selected" : ""}>${s}</option>`
                )
                .join("")}
            </select>`
          : esc(c.status);
        return `<tr>
          <td>${esc(c.sort_order)} · ${esc(c.serial || "—")}</td>
          <td>${esc(c.check_type)}</td>
          <td>${esc(c.owner_role)}</td>
          <td>${statusSelect}</td>
          <td>${
            editable
              ? `<input data-check="${esc(c.uuid)}" data-field="notes" value="${esc(
                  c.notes || ""
                )}" style="max-width:220px" />`
              : esc(c.notes || "")
          }</td>
        </tr>`;
      })
      .join("");

    root.innerHTML = `
      <h2>${esc(p.reference_key)}</h2>
      <div class="meta" style="color:#9aa3b2;font-size:.9rem">
        ${esc(p.casino_short || p.casino_name)} · ${esc(p.kind)} · v${esc(p.version_num)}
      </div>
      <div style="margin-top:8px">${badgeStage(p.stage)} ${badgeReady(p)}</div>
      <div class="pwb-actions">${actions}</div>

      <div class="pwb-section">Units</div>
      <table class="pwb-table">
        <thead><tr>
          <th>#</th><th>Op</th><th>Serial</th><th>Proposed theme</th><th>Zone</th><th>Bank</th><th>Loc</th>
        </tr></thead>
        <tbody>${unitsRows || `<tr><td colspan="7" class="pwb-empty">No units</td></tr>`}</tbody>
      </table>

      <div class="pwb-section">Pre-Check readiness</div>
      <table class="pwb-table">
        <thead><tr>
          <th>Unit</th><th>Check</th><th>Owner</th><th>Status</th><th>Notes</th>
        </tr></thead>
        <tbody>${checkRows || `<tr><td colspan="5" class="pwb-empty">No checks</td></tr>`}</tbody>
      </table>
    `;

    const send = document.getElementById("btn-send-precheck");
    if (send) {
      send.addEventListener("click", async () => {
        try {
          showError("");
          STATE.detail = await api(
            `/api/projects-workbench/proposals/${encodeURIComponent(p.reference_key)}/stage`,
            { method: "POST", body: JSON.stringify({ stage: "pre_check" }) }
          );
          await loadList();
          renderDetail();
        } catch (e) {
          showError(e.message || String(e));
        }
      });
    }
    const ret = document.getElementById("btn-return-draft");
    if (ret) {
      ret.addEventListener("click", async () => {
        const reason = window.prompt("Reason for return to draft?");
        if (reason == null) return;
        if (!String(reason).trim()) {
          showError("Return requires a reason.");
          return;
        }
        try {
          showError("");
          STATE.detail = await api(
            `/api/projects-workbench/proposals/${encodeURIComponent(p.reference_key)}/stage`,
            {
              method: "POST",
              body: JSON.stringify({ stage: "draft", reason: String(reason).trim() }),
            }
          );
          await loadList();
          renderDetail();
        } catch (e) {
          showError(e.message || String(e));
        }
      });
    }

    root.querySelectorAll("select[data-unit][data-field=op]").forEach((el) => {
      el.addEventListener("change", () => patchUnit(el.dataset.unit, { op: el.value }));
    });
    root.querySelectorAll("input[data-unit][data-field=serial]").forEach((el) => {
      el.addEventListener("change", () => patchUnit(el.dataset.unit, { serial: el.value }));
    });
    ["zone", "bank", "location"].forEach((field) => {
      root.querySelectorAll(`input[data-unit][data-field=${field}]`).forEach((el) => {
        el.addEventListener("change", () => {
          const body = {};
          body[field] = el.value;
          patchUnit(el.dataset.unit, body);
        });
      });
    });
    root.querySelectorAll("input[data-unit][data-field=theme_q]").forEach((el) => {
      let timer = null;
      el.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => themeSearch(el), 250);
      });
      el.addEventListener("focus", () => {
        if (el.value.trim()) themeSearch(el);
      });
    });
    root.querySelectorAll("select[data-check][data-field=status]").forEach((el) => {
      el.addEventListener("change", () => patchCheck(el.dataset.check, { status: el.value }));
    });
    root.querySelectorAll("input[data-check][data-field=notes]").forEach((el) => {
      el.addEventListener("change", () => patchCheck(el.dataset.check, { notes: el.value }));
    });
  }

  async function themeSearch(input) {
    const box = input.parentElement.querySelector(".pwb-theme-results");
    const q = input.value.trim();
    if (!q) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    try {
      const data = await api(
        `/api/projects-workbench/themes?q=${encodeURIComponent(q)}&limit=20`
      );
      const items = data.items || [];
      if (!items.length) {
        box.hidden = false;
        box.innerHTML = `<button type="button" disabled>No matches</button>`;
        return;
      }
      box.hidden = false;
      box.innerHTML = items
        .map(
          (t) =>
            `<button type="button" data-tid="${esc(t.reference_key)}">${esc(
              t.theme_name
            )} <span style="color:#9aa3b2">${esc(t.reference_key)}</span></button>`
        )
        .join("");
      box.querySelectorAll("button[data-tid]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          box.hidden = true;
          await patchUnit(input.dataset.unit, {
            proposed_theme_id: btn.getAttribute("data-tid"),
          });
        });
      });
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  async function patchUnit(unitId, body) {
    try {
      showError("");
      STATE.detail = await api(`/api/projects-workbench/units/${encodeURIComponent(unitId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await loadList();
      renderDetail();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  async function patchCheck(checkId, body) {
    try {
      showError("");
      STATE.detail = await api(`/api/projects-workbench/checks/${encodeURIComponent(checkId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await loadList();
      renderDetail();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  async function loadList() {
    const q = document.getElementById("q").value.trim();
    const stage = document.getElementById("stage-filter").value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (STATE.casinoFilter) params.set("casino_id", STATE.casinoFilter);
    params.set("page_size", "100");
    const data = await api(`/api/projects-workbench/proposals?${params}`);
    STATE.items = data.items || [];
    renderList();
  }

  async function openDetail(ref) {
    STATE.activeRef = ref;
    setUrlRef(ref);
    renderList();
    try {
      showError("");
      STATE.detail = await api(
        `/api/projects-workbench/proposals/${encodeURIComponent(ref)}`
      );
      renderDetail();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  async function init() {
    const params = qs();
    STATE.casinoFilter = (params.get("casino") || params.get("casino_id") || "").trim() || null;
    try {
      const perms = await api("/api/projects-workbench/permissions");
      if (!perms.can_read) {
        showError("No access to Project Workbench (need dgs_projects_workbench).");
        return;
      }
      STATE.canWrite = !!perms.can_write;
      STATE.tbdThemeId = perms.tbd_theme_id;
      document.getElementById("btn-refresh").addEventListener("click", () => loadList());
      document.getElementById("stage-filter").addEventListener("change", () => loadList());
      let t = null;
      document.getElementById("q").addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => loadList(), 250);
      });
      await loadList();
      const ref = (params.get("ref") || "").trim();
      if (ref) await openDetail(ref);
      else if (STATE.items.length === 1) await openDetail(STATE.items[0].reference_key);
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  window.ProjectWorkbench = { init };
})();
