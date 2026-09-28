(function () {
  "use strict";

  const STATE = {
    canWrite: false,
    isAdmin: false,
    canEditCompliance: false,
    canEditOps: false,
    tbdThemeId: null,
    items: [],
    activeRef: null,
    detail: null,
    casinoFilter: null,
  };

  const STAGES = [
    ["draft", "Draft"],
    ["pre_check", "Pre-Check"],
    ["final_approved", "Final"],
    ["worksheet_issued", "Worksheet"],
    ["done", "Done"],
  ];

  function stageLabel(stage) {
    const hit = STAGES.find((row) => row[0] === stage);
    return hit ? hit[1] : String(stage || "");
  }

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
    return `<span class="pwb-badge ${esc(stage)}">${esc(stageLabel(stage))}</span>`;
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

  function canEditUnits(stage) {
    return stage === "draft" && (STATE.isAdmin || STATE.canWrite);
  }

  function canEditCheck(check) {
    if (!STATE.detail || !STATE.detail.proposal) return false;
    if (STATE.detail.proposal.stage !== "pre_check") return false;
    if (STATE.isAdmin) return true;
    if (check.owner_role === "compliance") return STATE.canEditCompliance;
    if (check.owner_role === "ops") return STATE.canEditOps;
    return false;
  }

  function canReturn() {
    return STATE.isAdmin || STATE.canEditCompliance || STATE.canEditOps;
  }

  function softwareBadge(u) {
    if (u.software_state === "unverified" || u.unverified_theme_id) {
      return `<div class="pwb-sw temp">Temp</div>`;
    }
    if (Number(u.is_tbd) || u.software_state === "tbd") return "";
    if (u.software_state === "confirmed") {
      return `<div class="pwb-sw confirmed">Cabinet confirmed</div>`;
    }
    if (u.software_state === "need_software") {
      return `<div class="pwb-sw need_software">Needs software</div>`;
    }
    return "";
  }

  function accessHint(stage) {
    if (STATE.isAdmin) return `admin · ${stageLabel(stage)}`;
    if (stage === "draft" && STATE.canWrite) return "draft edit";
    if (stage === "pre_check" && (STATE.canEditCompliance || STATE.canEditOps)) return "pre-check edit";
    return "read-only";
  }

  function stageRail(current) {
    const idx = STAGES.findIndex((row) => row[0] === current);
    return `<ol class="pwb-stages">${STAGES.map(([key, label], i) => {
      const cls = i < idx ? "done" : i === idx ? "current" : "upcoming";
      return `<li class="${cls}">${esc(label)}</li>`;
    }).join("")}</ol>`;
  }

  function renderDetail() {
    const root = document.getElementById("detail-root");
    const hint = document.getElementById("write-hint");
    const d = STATE.detail;
    if (!d || !d.proposal) {
      hint.textContent = STATE.isAdmin ? "admin" : STATE.canWrite ? "draft edit" : "read-only";
      root.innerHTML = `<p class="pwb-empty">Select a proposal.</p>`;
      return;
    }
    const p = d.proposal;
    hint.textContent = accessHint(p.stage);
    const editUnits = canEditUnits(p.stage);
    const showChecks = p.stage !== "draft";
    const blocked = (p.computed_version_readiness || "") !== "ready";

    let actions = "";
    if (editUnits) {
      actions += `<button type="button" class="dgs-v2-btn dgs-v2-btn--primary" id="btn-send-precheck">Send to Pre-Check</button>`;
    }
    if (p.stage === "pre_check" && canReturn()) {
      actions += `<button type="button" class="dgs-v2-btn" id="btn-return-draft">Return to draft…</button>`;
    }
    if (p.stage === "pre_check" && STATE.isAdmin) {
      actions += `<button type="button" class="dgs-v2-btn dgs-v2-btn--primary" id="btn-approve-final"${
        blocked ? " disabled" : ""
      } title="${
        blocked ? "Every check must be Ready or N/A, and no unit can still be TBD" : "Lock this version as Final"
      }">Approve Final</button>`;
    }

    const laterNote =
      p.stage === "final_approved"
        ? "Final is locked. The worksheet stage is next, and issuing it is not on this screen yet."
        : p.stage === "worksheet_issued"
          ? "The worksheet has been issued. This record stays read-only."
          : p.stage === "done"
            ? "This project is done. The record stays read-only."
            : "";

    const unitsRows = (d.units || [])
      .map((u) => {
        const isTemp = !!(u.unverified_theme_id);
        const themeLabel = isTemp
          ? `<span class="pwb-temp">${esc(u.unverified_theme_name || "Temp")}</span>`
          : Number(u.is_tbd)
            ? `<span class="pwb-tbd">TBD</span>`
            : esc(u.proposed_theme_name || u.proposed_theme_id || "—");
        const themeIdLine = isTemp
          ? esc(u.unverified_reference_key || "")
          : esc(u.proposed_theme_id || "");
        const sw = softwareBadge(u);
        const hasCab = !!(u.cabinet_id && String(u.cabinet_id).trim());
        const themeEditor = u.op === "remove"
          ? `<span class="pwb-removed">removed from floor</span>`
          : editUnits
          ? `<div class="pwb-rel theme-cell">
              <input data-unit="${esc(u.uuid)}" data-field="theme_q" data-cabinet="${esc(
                u.cabinet_id || ""
              )}" placeholder="${
                hasCab ? "Search theme…" : "Add a cabinet first"
              }" value="${
                isTemp
                  ? esc(u.unverified_theme_name || "")
                  : Number(u.is_tbd)
                    ? ""
                    : esc(u.proposed_theme_name || "")
              }" ${hasCab ? "" : "disabled"} />
              <div class="pwb-theme-results" hidden></div>
              <div style="margin-top:4px;font-size:.75rem;color:#9aa3b2">${themeLabel} · ${themeIdLine}</div>
              ${sw}
            </div>`
          : `<span class="${Number(u.is_tbd) ? "pwb-tbd" : ""}">${themeLabel}</span>${sw}`;
        return `<tr>
          <td>${esc(u.sort_order)}</td>
          <td>${
            editUnits
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
            editUnits
              ? `<input data-unit="${esc(u.uuid)}" data-field="serial" value="${esc(u.serial || "")}" />`
              : esc(u.serial || "")
          }</td>
          <td>${esc(u.cabinet_name || u.cabinet_id || "—")}</td>
          <td>${themeEditor}</td>
          <td>${
            editUnits
              ? `<input data-unit="${esc(u.uuid)}" data-field="zone" value="${esc(
                  u.zone || ""
                )}" style="max-width:70px" />`
              : esc(u.zone || "")
          }</td>
          <td>${
            editUnits
              ? `<input data-unit="${esc(u.uuid)}" data-field="bank" value="${esc(
                  u.bank || ""
                )}" style="max-width:70px" />`
              : esc(u.bank || "")
          }</td>
          <td>${
            editUnits
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
        const editCheck = canEditCheck(c);
        const statusSelect = editCheck
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
            editCheck
              ? `<input data-check="${esc(c.uuid)}" data-field="notes" value="${esc(
                  c.notes || ""
                )}" style="max-width:220px" />`
              : esc(c.notes || "")
          }</td>
        </tr>`;
      })
      .join("");

    const checksBlock = showChecks
      ? `<div class="pwb-section">Pre-Check readiness</div>
      <table class="pwb-table">
        <thead><tr>
          <th>Unit</th><th>Check</th><th>Owner</th><th>Status</th><th>Notes</th>
        </tr></thead>
        <tbody>${checkRows || `<tr><td colspan="5" class="pwb-empty">No checks yet. Send from Draft creates them for units that already have a theme.</td></tr>`}</tbody>
      </table>`
      : "";

    root.innerHTML = `
      <h2>${esc(p.reference_key)}</h2>
      <div class="meta" style="color:#9aa3b2;font-size:.9rem">
        ${esc(p.casino_short || p.casino_name)} · ${esc(p.kind)} · v${esc(p.version_num)}
      </div>
      ${stageRail(p.stage)}
      <div style="margin-top:8px">${badgeStage(p.stage)} ${p.stage === "draft" ? "" : badgeReady(p)}</div>
      ${laterNote ? `<p class="pwb-stage-note">${esc(laterNote)}</p>` : ""}
      <div class="pwb-actions">${actions}</div>

      <div class="pwb-section">${p.stage === "draft" ? "Units" : "Units on this proposal"}</div>
      <table class="pwb-table">
        <thead><tr>
          <th>#</th><th>Op</th><th>Serial</th><th>Cabinet</th><th>Proposed theme</th><th>Zone</th><th>Bank</th><th>Loc</th>
        </tr></thead>
        <tbody>${unitsRows || `<tr><td colspan="8" class="pwb-empty">No units</td></tr>`}</tbody>
      </table>
      ${checksBlock}
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
    const approve = document.getElementById("btn-approve-final");
    if (approve) {
      approve.addEventListener("click", async () => {
        if (
          !confirm(
            "Approve Final?\n\nThis locks the version. Draft edits and Pre-Check edits both close."
          )
        )
          return;
        try {
          showError("");
          STATE.detail = await api(
            `/api/projects-workbench/proposals/${encodeURIComponent(p.reference_key)}/stage`,
            { method: "POST", body: JSON.stringify({ stage: "final_approved" }) }
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
      el.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        const box = el.parentElement.querySelector(".pwb-theme-results");
        const add = box && box.querySelector("button[data-add-temp]");
        if (add) add.click();
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
    const cab = (input.dataset.cabinet || "").trim();
    if (!cab) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    if (!q) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    try {
      const data = await api(
        `/api/projects-workbench/themes?q=${encodeURIComponent(q)}&cabinet_id=${encodeURIComponent(
          cab
        )}&limit=20`
      );
      const items = data.items || [];
      const temps = data.temp_items || [];
      if (!items.length && !temps.length && !data.add_temp) {
        box.hidden = false;
        box.innerHTML = `<button type="button" disabled>No matching themes</button>`;
        return;
      }
      const confirmedHtml = items
        .map((t) => {
          const needs = t.software_state === "need_software";
          const note = needs
            ? ` <span style="color:#f0c14b">Needs software</span>`
            : "";
          return `<button type="button" data-tid="${esc(t.reference_key)}">${esc(
            t.theme_name
          )} <span style="color:#9aa3b2">${esc(t.reference_key)}</span>${note}</button>`;
        })
        .join("");
      const tempHtml = temps
        .map(
          (t) =>
            `<button type="button" data-temp="${esc(t.uuid)}">Temp · ${esc(
              t.display_name
            )} <span style="color:#9aa3b2">${esc(t.reference_key)}</span></button>`
        )
        .join("");
      const addHtml = data.add_temp
        ? `<button type="button" data-add-temp="${esc(q)}">Add temp theme “${esc(q)}”</button>`
        : "";
      box.hidden = false;
      box.innerHTML = confirmedHtml + tempHtml + addHtml;
      box.querySelectorAll("button[data-tid]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          box.hidden = true;
          await patchUnit(input.dataset.unit, {
            proposed_theme_id: btn.getAttribute("data-tid"),
          });
        });
      });
      box.querySelectorAll("button[data-temp]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          box.hidden = true;
          await patchUnit(input.dataset.unit, {
            unverified_theme_id: btn.getAttribute("data-temp"),
          });
        });
      });
      box.querySelectorAll("button[data-add-temp]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          box.hidden = true;
          try {
            showError("");
            STATE.detail = await api("/api/projects-workbench/unverified-themes", {
              method: "POST",
              body: JSON.stringify({
                display_name: btn.getAttribute("data-add-temp"),
                unit_id: input.dataset.unit,
              }),
            });
            await loadList();
            renderDetail();
          } catch (err) {
            showError(err.message || String(err));
          }
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
      STATE.isAdmin = !!perms.is_admin;
      STATE.canEditCompliance = !!perms.can_edit_compliance;
      STATE.canEditOps = !!perms.can_edit_ops;
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
