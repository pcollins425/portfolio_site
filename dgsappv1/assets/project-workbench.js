(function () {
  "use strict";

  const STATE = {
    canWrite: false,
    isAdmin: false,
    canEditCompliance: false,
    canEditOps: false,
    tbdThemeId: null,
    actionTypes: [],
    items: [],
    activeRef: null,
    detail: null,
    casinoFilter: null,
    mode: "browse", // browse | edit
    contentRevision: null,
    pollTimer: null,
    pushPending: 0,
    wordcraftReady: false,
    wordcraftDirty: false,
    wordcraftFailed: null,
    wordcraftListenerBound: false,
    wordcraftOpenSeq: 0,
    wordcraftLoadTimer: null,
    wordcraftRefreshTimer: null,
    artifacts: [],
  };

  const POLL_MS = 5000;

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

  async function downloadAuthenticated(path, fallbackName) {
    const headers = Object.assign({}, window.DGSAuth ? DGSAuth.authHeaders() : {});
    const res = await fetch(`${apiBase()}${path}`, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body.detail || body.message || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    const blob = await res.blob();
    let name = fallbackName || "download.docx";
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename="([^"]+)"/i.exec(cd);
    if (m) name = m[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function artifactVersionLabel(item) {
    const m = /version=(\d+)/.exec(String(item.notes || ""));
    return m ? `V${m[1]}` : "archive";
  }

  async function loadArtifacts() {
    if (!STATE.activeRef) {
      STATE.artifacts = [];
      return;
    }
    try {
      const data = await api(
        `/api/projects-workbench/proposals/${encodeURIComponent(STATE.activeRef)}/artifacts`
      );
      STATE.artifacts = data.items || [];
    } catch (_) {
      STATE.artifacts = [];
    }
  }

  function artifactsHtml(idPrefix) {
    const items = STATE.artifacts || [];
    if (!items.length) {
      return `<p class="pwb-empty" style="margin:6px 0">No archives yet.</p>`;
    }
    return `<ul class="pwb-artifacts" id="${esc(idPrefix)}-list">${items
      .map((it) => {
        const when = (it.insert_date || "").replace("T", " ").slice(0, 19);
        return `<li>
          <span>${esc(artifactVersionLabel(it))} · ${esc(when)}${
            it.created_by ? ` · ${esc(it.created_by)}` : ""
          }</span>
          <button type="button" class="dgs-v2-btn" data-artifact-dl="${esc(
            it.uuid
          )}">Download</button>
        </li>`;
      })
      .join("")}</ul>`;
  }

  function bindArtifactDownloads(root) {
    if (!root) return;
    root.querySelectorAll("[data-artifact-dl]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-artifact-dl");
        try {
          showError("");
          await downloadAuthenticated(
            `/api/projects-workbench/artifacts/${encodeURIComponent(id)}/file`,
            "archive.docx"
          );
        } catch (e) {
          showError(e.message || String(e));
        }
      });
    });
  }

  async function downloadCurrentDocx() {
    if (!STATE.activeRef) return;
    const name = `${STATE.activeRef}.docx`;
    await downloadAuthenticated(
      `/api/projects-workbench/proposals/${encodeURIComponent(
        STATE.activeRef
      )}/docx?download=1`,
      name
    );
  }

  async function archiveCurrentProposal() {
    if (!STATE.activeRef) return;
    const p = STATE.detail && STATE.detail.proposal;
    const ver = p && p.version_num ? p.version_num : "?";
    if (
      !confirm(
        `Archive V${ver} as read-only and bump to the next version?\n\nThis stores the current conversion DOCX from SQL.`
      )
    ) {
      return;
    }
    try {
      showError("");
      setSync("archiving…", "pending");
      const body = await api(
        `/api/projects-workbench/proposals/${encodeURIComponent(STATE.activeRef)}/archive`,
        { method: "POST", body: "{}" }
      );
      // { proposal: proposal_detail(...), artifact: {...} }
      STATE.detail = body.proposal;
      const newRef =
        (STATE.detail && STATE.detail.proposal && STATE.detail.proposal.reference_key) ||
        (body.artifact && body.artifact.to_reference_key) ||
        STATE.activeRef;
      STATE.activeRef = newRef;
      STATE.contentRevision =
        (STATE.detail.proposal && STATE.detail.proposal.content_revision) || STATE.contentRevision;
      setUrlRef(newRef);
      await loadList();
      await loadArtifacts();
      if (STATE.mode === "edit") {
        document.getElementById("edit-ref-label").textContent = newRef;
        renderEdit({ refreshDoc: "now" });
        refreshEditArchivePanel();
      } else {
        renderDetail();
      }
      setSync(`archived → ${newRef}`, "ok");
    } catch (e) {
      showError(e.message || String(e));
      setSync(e.message || "archive failed", "err");
    }
  }

  function refreshEditArchivePanel() {
    const slot = document.getElementById("pwb-edit-archives");
    if (!slot) return;
    slot.innerHTML = `
      <div class="pwb-section" style="margin:0">Archived versions (read-only)</div>
      ${artifactsHtml("edit-arch")}
    `;
    bindArtifactDownloads(slot);
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

  const CHECKS = [
    ["par", "Par"],
    ["lab", "Lab"],
    ["software", "Software"],
    ["cabinet", "Cabinet"],
    ["parts", "Parts"],
    ["serials", "Serial"],
  ];

  function checkStatusOptions(current) {
    return ["pending", "in_progress", "blocker", "ready", "na"]
      .map(
        (s) =>
          `<option value="${s}"${current === s ? " selected" : ""}>${
            s === "na" ? "n/a" : s === "in_progress" ? "started" : s
          }</option>`
      )
      .join("");
  }

  function hubHref(query) {
    const q = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value) q.set(key, value);
    });
    const href = `theme-hub.html?${q}`;
    return window.DGS && DGS.withApi ? DGS.withApi(href) : href;
  }

  function themeHubLink(unit) {
    if (unit.unverified_theme_id || Number(unit.is_tbd) || !unit.proposed_theme_id) return "";
    return `<a class="pwb-hub-link" href="${hubHref({ id: unit.proposed_theme_id })}">Theme hub</a>`;
  }

  function addDocLink(unit, type, byUnit) {
    const checks = byUnit[unit.uuid] || {};
    const check = checks[type];
    if (!check || !canEditCheck(check)) return "";
    if (check.status === "ready" || check.status === "na") return "";
    if (unit.op === "REMOVE") return "";
    if (unit.unverified_theme_id || Number(unit.is_tbd) || !unit.proposed_theme_id) {
      return `<span class="pwb-add-doc">Catalog theme required</span>`;
    }
    const pending = ["par", "lab"].filter((kind) => {
      const row = checks[kind];
      return row && row.status !== "ready" && row.status !== "na";
    });
    if (!pending.includes(type)) return "";
    const label = pending.length > 1 ? "Add par and lab" : `Add ${type}`;
    const href = hubHref({
      id: unit.proposed_theme_id,
      add: pending.join(","),
      proposal: STATE.detail.proposal.reference_key,
      unit: unit.uuid,
      cabinet: unit.cabinet_id || "",
      return: `project-workbench.html?ref=${STATE.detail.proposal.reference_key}`,
    });
    return `<a class="pwb-add-doc" href="${href}">${esc(label)}</a>`;
  }

  function checkCell(check, extra) {
    const more = extra || "";
    if (!check) return `<td class="pwb-check">—${more}</td>`;
    const title = esc(check.notes || "");
    if (!canEditCheck(check)) {
      const label = check.status === "na" ? "n/a" : check.status === "in_progress" ? "started" : check.status;
      return `<td class="pwb-check" title="${title}">${esc(label)}${more}</td>`;
    }
    return `<td class="pwb-check"><select class="pwb-check-select" data-check="${esc(
      check.uuid
    )}" data-field="status" title="${title}">${checkStatusOptions(check.status)}</select>${more}</td>`;
  }

  function stageRail(current) {
    const idx = STAGES.findIndex((row) => row[0] === current);
    return `<ol class="pwb-stages">${STAGES.map(([key, label], i) => {
      const cls = i < idx ? "done" : i === idx ? "current" : "upcoming";
      return `<li class="${cls}">${esc(label)}</li>`;
    }).join("")}</ol>`;
  }

  function themeToLabel(u) {
    if (u.unverified_theme_id) return u.unverified_theme_name || "Temp";
    if (Number(u.is_tbd)) return "TBD";
    return u.proposed_theme_name || u.proposed_theme_id || "—";
  }

  function zbl(u) {
    const parts = [u.zone, u.bank, u.location].map((x) => (x || "").trim()).filter(Boolean);
    return parts.length ? parts.join("-") : "—";
  }

  function proposedSummary(units) {
    const rows = units || [];
    if (!rows.length) return `<p class="pwb-empty">No units on this proposal.</p>`;
    const byTo = {};
    rows.forEach((u) => {
      if (u.op === "REMOVE") {
        const key = `remove:${u.serial || u.uuid}`;
        byTo[key] = byTo[key] || { label: `Remove ${u.serial || "unit"}`, n: 0 };
        byTo[key].n += 1;
        return;
      }
      const to = themeToLabel(u);
      const from = u.current_theme_name || "—";
      const key = `${from}→${to}`;
      byTo[key] = byTo[key] || { label: `${from} → ${to}`, n: 0 };
      byTo[key].n += 1;
    });
    return `<ul class="pwb-summary-list">${Object.values(byTo)
      .map((g) => `<li>${esc(g.label)} <span style="color:#9aa3b2">×${g.n}</span></li>`)
      .join("")}</ul>`;
  }

  function deptNotesHtml(d) {
    const p = d.proposal || {};
    const notes = (p.discussion || "").trim() || (p.notes || "").trim();
    const hist = (d.history || []).slice(0, 8);
    const histHtml = hist.length
      ? `<ul class="pwb-history">${hist
          .map((h) => {
            const move =
              h.from_stage || h.to_stage
                ? `${h.from_stage || "—"} → ${h.to_stage || "—"}`
                : h.event_type || "event";
            return `<li><strong>${esc(h.actor || "")}</strong> · ${esc(move)} · ${esc(
              h.event_at || ""
            )}</li>`;
          })
          .join("")}</ul>`
      : `<p class="pwb-empty">No stage history yet.</p>`;
    return `
      <div class="pwb-section">Department / stage notes</div>
      <div class="pwb-notes">${notes ? esc(notes) : "No notes yet."}</div>
      <div class="pwb-section">Recent stage activity</div>
      ${histHtml}
    `;
  }

  function setSync(msg, cls) {
    const el = document.getElementById("edit-sync");
    if (!el) return;
    el.textContent = msg;
    el.className = `pwb-sync${cls ? " " + cls : ""}`;
  }

  function stopPoll() {
    if (STATE.pollTimer) {
      clearInterval(STATE.pollTimer);
      STATE.pollTimer = null;
    }
  }

  function startPoll() {
    stopPoll();
    STATE.pollTimer = setInterval(() => {
      if (STATE.mode === "edit" && STATE.activeRef) pollRevision();
    }, POLL_MS);
  }

  async function pollRevision() {
    if (!STATE.activeRef || STATE.pushPending > 0) return;
    try {
      const rev = await api(
        `/api/projects-workbench/proposals/${encodeURIComponent(STATE.activeRef)}/revision`
      );
      const server = rev.content_revision || "";
      if (!STATE.contentRevision) {
        STATE.contentRevision = server;
        return;
      }
      if (server && server > STATE.contentRevision) {
        setSync("pulling…", "pending");
        STATE.detail = await api(
          `/api/projects-workbench/proposals/${encodeURIComponent(STATE.activeRef)}`
        );
        STATE.contentRevision = STATE.detail.proposal.content_revision || server;
        if (STATE.mode === "edit") renderEdit({ refreshDoc: "later" });
        else renderDetail();
        setSync(`synced ${server}`, "ok");
      }
    } catch (e) {
      setSync(e.message || "poll failed", "err");
    }
  }

  function wordcraftSrc() {
    const author = ((document.getElementById("user-label") || {}).textContent || "").trim();
    const q = new URLSearchParams({ host: "parent" });
    if (author) q.set("author", author);
    // Same-origin static folder under /dgsappv1/wordcraft/ (vendored at publish).
    return `wordcraft/?${q}`;
  }

  function ensureWordCraftHost() {
    const root = document.getElementById("edit-doc-root");
    if (!root) return;
    if (!root.querySelector("#pwb-wordcraft-frame")) {
      root.innerHTML = `
        <p class="pwb-doc-hint" id="pwb-wordcraft-hint">WordCraft · SQL → .docx · host bridge</p>
        <div class="pwb-wordcraft-shell">
          <iframe
            id="pwb-wordcraft-frame"
            title="WordCraft"
            src="${esc(wordcraftSrc())}"
            allow="fullscreen; clipboard-read; clipboard-write"
            allowfullscreen></iframe>
        </div>
        <div class="pwb-doc-fallback" id="pwb-doc-fallback" hidden></div>
      `;
      STATE.wordcraftReady = false;
      STATE.wordcraftFailed = null;
      STATE.wordcraftDirty = false;
      if (STATE.wordcraftLoadTimer) clearTimeout(STATE.wordcraftLoadTimer);
      // First load downloads ~21MB gzip then inflates — show patience, then fall back.
      STATE.wordcraftLoadTimer = setTimeout(() => {
        if (STATE.wordcraftReady || STATE.mode !== "edit") return;
        setWordCraftHint(
          "WordCraft still loading (large first download). HTML preview shown; Craft will replace it when ready."
        );
        showDocFallback();
      }, 45000);
    }
    if (!STATE.wordcraftListenerBound) {
      window.addEventListener("message", onWordCraftMessage);
      STATE.wordcraftListenerBound = true;
    }
  }

  function teardownWordCraftHost() {
    STATE.wordcraftReady = false;
    STATE.wordcraftDirty = false;
    STATE.wordcraftFailed = null;
    if (STATE.wordcraftLoadTimer) {
      clearTimeout(STATE.wordcraftLoadTimer);
      STATE.wordcraftLoadTimer = null;
    }
    const root = document.getElementById("edit-doc-root");
    if (root) root.innerHTML = "";
  }

  function onWordCraftMessage(ev) {
    if (ev.origin !== window.location.origin) return;
    const data = ev.data || {};
    const type = data.type;
    if (type === "wordcraft:ready") {
      STATE.wordcraftReady = true;
      STATE.wordcraftFailed = null;
      if (STATE.wordcraftLoadTimer) {
        clearTimeout(STATE.wordcraftLoadTimer);
        STATE.wordcraftLoadTimer = null;
      }
      setWordCraftHint("WordCraft ready · opening from SQL…");
      refreshWordCraftDoc();
      return;
    }
    if (type === "wordcraft:dirty") {
      STATE.wordcraftDirty = !!data.dirty;
      return;
    }
    if (type === "wordcraft:failed") {
      STATE.wordcraftFailed = data.error || "WordCraft failed to start";
      setWordCraftHint(STATE.wordcraftFailed);
      showDocFallback();
      return;
    }
    if (type === "wordcraft:save") {
      // Product path is Download / Archive on the App bar (SQL snapshot), not Word Save.
      setWordCraftHint(
        `Word Save received (${data.name || "doc"}) — use Download or Archive on the bar`
      );
    }
  }

  function setWordCraftHint(msg) {
    const el = document.getElementById("pwb-wordcraft-hint");
    if (el) el.textContent = msg;
  }

  function showDocFallback() {
    const fb = document.getElementById("pwb-doc-fallback");
    if (!fb || !STATE.detail) return;
    fb.hidden = false;
    fb.innerHTML = renderDocPreview(STATE.detail);
  }

  function cancelWordCraftRefresh() {
    if (STATE.wordcraftRefreshTimer) {
      clearTimeout(STATE.wordcraftRefreshTimer);
      STATE.wordcraftRefreshTimer = null;
    }
  }

  /** Coalesce rapid field pushes; still refreshes the doc. */
  function scheduleWordCraftRefresh(delayMs) {
    cancelWordCraftRefresh();
    STATE.wordcraftRefreshTimer = setTimeout(() => {
      STATE.wordcraftRefreshTimer = null;
      refreshWordCraftDoc();
    }, delayMs == null ? 400 : delayMs);
  }

  function wordcraftApi() {
    const frame = document.getElementById("pwb-wordcraft-frame");
    return (frame && frame.contentWindow && frame.contentWindow.wordcraft) || null;
  }

  async function wordcraftUiInspect() {
    const wc = wordcraftApi();
    if (!wc) return null;
    try {
      if (typeof wc.uiInspect === "function") return await wc.uiInspect();
      if (typeof wc.request === "function") return await wc.request("ui.inspect", {});
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  async function wordcraftUiWheel(params) {
    const wc = wordcraftApi();
    if (!wc || typeof wc.request !== "function") return false;
    try {
      // ui.wheel is a control method (queued input), not engine.execute.
      await wc.request("ui.wheel", params);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * WordCraft ui.inspect pages are [left, top, width, height] screen rects.
   * As you scroll down, page[0] top decreases (goes negative).
   */
  function viewSnapshotFromInspect(inspect) {
    if (!inspect || typeof inspect !== "object") return null;
    const pages = inspect.pages;
    if (!Array.isArray(pages) || !pages.length) return null;
    const tops = pages.map((p) => (Array.isArray(p) ? Number(p[1]) : NaN));
    if (!Number.isFinite(tops[0])) return null;
    let pageAtTop = 0;
    for (let i = 0; i < tops.length; i++) {
      if (Number.isFinite(tops[i]) && tops[i] <= 48) pageAtTop = i;
    }
    const cr = Array.isArray(inspect.canvasRect) ? inspect.canvasRect : null;
    const wheelX = cr && Number.isFinite(cr[0]) && Number.isFinite(cr[2]) ? cr[0] + cr[2] / 2 : 280;
    const wheelY = cr && Number.isFinite(cr[1]) && Number.isFinite(cr[3]) ? cr[1] + cr[3] / 2 : 280;
    return { firstTop: tops[0], pageAtTop, wheelX, wheelY };
  }

  async function captureWordCraftView() {
    return viewSnapshotFromInspect(await wordcraftUiInspect());
  }

  async function restoreWordCraftView(before, seq) {
    if (!before || !Number.isFinite(before.firstTop) || seq !== STATE.wordcraftOpenSeq) return;
    const wc = wordcraftApi();
    if (!wc) return;

    // Wait for open+layout; pages is empty until the doc is on screen.
    let ready = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50 + i * 25));
      if (seq !== STATE.wordcraftOpenSeq) return;
      ready = viewSnapshotFromInspect(await wordcraftUiInspect());
      if (ready) break;
    }
    if (!ready) return;

    // Fast path for multi-page: Go To page (1-based), then fine-tune with wheel.
    if (
      before.pageAtTop > 0 &&
      typeof wc.execute === "function" &&
      ready.pageAtTop !== before.pageAtTop
    ) {
      try {
        await wc.execute("edit.goto", { page: before.pageAtTop + 1 });
        await new Promise((r) => setTimeout(r, 80));
      } catch (_) {
        /* fall through to wheel */
      }
    }

    // ui.wheel is queued per frame — nudge until page[0] top matches.
    for (let i = 0; i < 12; i++) {
      if (seq !== STATE.wordcraftOpenSeq) return;
      const now = viewSnapshotFromInspect(await wordcraftUiInspect());
      if (!now) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      // dy > 0 scrolls up; dy < 0 scrolls down. Match previous first-page top.
      const dy = before.firstTop - now.firstTop;
      if (Math.abs(dy) < 3) return;
      const ok = await wordcraftUiWheel({
        x: before.wheelX || now.wheelX,
        y: before.wheelY || now.wheelY,
        dy,
        unit: "point",
      });
      if (!ok) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function refreshWordCraftDoc() {
    cancelWordCraftRefresh();
    if (STATE.mode !== "edit" || !STATE.activeRef) return;
    const frame = document.getElementById("pwb-wordcraft-frame");
    if (!frame || !frame.contentWindow) {
      showDocFallback();
      return;
    }
    if (!STATE.wordcraftReady) return;
    const seq = ++STATE.wordcraftOpenSeq;
    const viewBefore = await captureWordCraftView();
    try {
      const headers = Object.assign({}, window.DGSAuth ? DGSAuth.authHeaders() : {});
      const res = await fetch(
        `${apiBase()}/api/projects-workbench/proposals/${encodeURIComponent(
          STATE.activeRef
        )}/docx`,
        { headers }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.message || res.statusText);
      }
      const bytes = await res.arrayBuffer();
      if (seq !== STATE.wordcraftOpenSeq) return;
      const name = `${STATE.activeRef}.docx`;
      frame.contentWindow.postMessage(
        { type: "wordcraft:open", name, bytes },
        window.location.origin,
        [bytes]
      );
      setWordCraftHint(`Opened ${name} from SQL`);
      const fb = document.getElementById("pwb-doc-fallback");
      if (fb) fb.hidden = true;
      // wordcraft:open always starts at top — put the view back when we can.
      restoreWordCraftView(viewBefore, seq);
    } catch (e) {
      setWordCraftHint(e.message || String(e));
      showDocFallback();
    }
  }

  async function enterEdit() {
    const p = STATE.detail && STATE.detail.proposal;
    if (!p || !canEditUnits(p.stage)) return;
    STATE.mode = "edit";
    STATE.contentRevision = p.content_revision || null;
    document.body.classList.add("pwb-edit-mode");
    document.getElementById("pwb-browse").hidden = true;
    const edit = document.getElementById("pwb-edit");
    edit.hidden = false;
    document.getElementById("edit-ref-label").textContent = p.reference_key;
    ensureWordCraftHost();
    renderEdit();
    startPoll();
    setSync(`rev ${STATE.contentRevision || "—"}`, "ok");
    await loadArtifacts();
    const arch = document.getElementById("pwb-edit-archives");
    if (arch) {
      arch.hidden = false;
      refreshEditArchivePanel();
    }
  }

  function exitEdit() {
    STATE.mode = "browse";
    stopPoll();
    cancelWordCraftRefresh();
    teardownWordCraftHost();
    document.body.classList.remove("pwb-edit-mode");
    document.getElementById("pwb-edit").hidden = true;
    const arch = document.getElementById("pwb-edit-archives");
    if (arch) arch.hidden = true;
    document.getElementById("pwb-browse").hidden = false;
    renderDetail();
  }

  function letterContact(p) {
    return {
      name: p.letter_contact_name || p.slot_director_name || p.general_manager_name || "",
      email: p.letter_contact_email || p.slot_director_email || p.general_manager_email || "",
      line1: p.letter_address_line1 || p.casino_address || "",
      line2: p.letter_address_line2 || "",
    };
  }

  function renderDocPreview(d) {
    const p = d.proposal || {};
    const casino = p.casino_name || p.casino_short || "Casino Name";
    const letter = letterContact(p);
    const units = d.units || [];
    const rows = units
      .map((u) => {
        const to =
          u.op === "REMOVE"
            ? "(remove)"
            : u.unverified_theme_name || u.proposed_theme_name || (Number(u.is_tbd) ? "TBD" : "");
        return `<tr>
          <td>${esc(u.manufacturer_name || "")}</td>
          <td>${esc(u.cabinet_name || u.cabinet_id || "")}</td>
          <td>${esc(u.serial || "")}</td>
          <td>${esc(u.current_theme_name || "")}</td>
          <td>${esc(to)}</td>
          <td>${esc(zbl(u))}</td>
        </tr>`;
      })
      .join("");
    return `
      <p class="pwb-doc-hint">Fallback preview · David template shape (6-col). WordCraft opens the real .docx.</p>
      <div class="pwb-doc-frame" id="pwb-doc-frame">
        <h3>Leased Equipment Software Conversion Request</h3>
        <p class="pwb-doc-meta"><strong>${esc(casino)}</strong></p>
        <p class="pwb-doc-meta">${esc(letter.name || "Direct Contact")}</p>
        <p class="pwb-doc-meta">${esc(letter.email || "Direct Contact Email")}</p>
        <p class="pwb-doc-meta">${esc(letter.line1 || "Address Line #1")}</p>
        <p class="pwb-doc-meta">${esc(letter.line2 || "Address Line #2")}</p>
        <p class="pwb-doc-meta"><strong>Request # ${esc(p.reference_key)}</strong></p>
        <div class="pwb-doc-letter">
          <p>Hello,</p>
          <p>Pending your approval, Dynamic Gaming Solutions, LLC would like to perform the following software conversions to our leased equipment at the ${esc(
            casino
          )}. As always, we thank you for your continued partnership.</p>
          <p>Respectfully,</p>
        </div>
        <p><strong>Convert</strong></p>
        <table class="pwb-doc-table">
          <thead><tr>
            <th>Manufacturer</th><th>Cabinet</th><th>Serial #</th>
            <th>Theme (From)</th><th>Theme (To)</th><th>Z-B-L</th>
          </tr></thead>
          <tbody>${
            rows ||
            `<tr><td colspan="6" style="text-align:center;color:#666">No units</td></tr>`
          }</tbody>
        </table>
      </div>
    `;
  }

  function themeIsSet(u) {
    return !!(u.unverified_theme_id || (!Number(u.is_tbd) && u.proposed_theme_id));
  }

  function renderEdit(opts) {
    opts = opts || {};
    const fields = document.getElementById("edit-fields-root");
    const d = STATE.detail;
    if (!d || !d.proposal) {
      fields.innerHTML = `<p class="pwb-empty">No proposal loaded.</p>`;
      return;
    }
    const scrollTop = fields.scrollTop;
    const active = document.activeElement;
    let restore = null;
    if (active && fields.contains(active) && active.dataset) {
      restore = {
        unit: active.dataset.unit || "",
        field: active.dataset.field || "",
        start: typeof active.selectionStart === "number" ? active.selectionStart : null,
        end: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
      };
    }
    ensureWordCraftHost();
    const units = d.units || [];
    const actionOpts = STATE.actionTypes.length
      ? STATE.actionTypes
      : [{ action_code: "CONVERT", action_name: "Convert" }];
    const rows = units
      .map((u) => {
        const opCode = String(u.op || "").toUpperCase();
        const toLabel = themeToLabel(u);
        const opSelect = `<select data-unit="${esc(u.uuid)}" data-field="op">${actionOpts
          .map(
            (a) =>
              `<option value="${esc(a.action_code)}"${
                opCode === String(a.action_code || "").toUpperCase() ? " selected" : ""
              }>${esc(a.action_name)}</option>`
          )
          .join("")}</select>`;
        const themeValue = u.unverified_theme_id
          ? u.unverified_theme_name || ""
          : Number(u.is_tbd)
            ? ""
            : u.proposed_theme_name || "";
        const themeCell =
          opCode === "REMOVE"
            ? `<span class="pwb-removed">removed from floor</span>`
            : `<div class="pwb-rel pwb-theme-wrap">
                <input data-unit="${esc(u.uuid)}" data-field="theme_q" data-cabinet="${esc(
                  u.cabinet_id || ""
                )}" placeholder="${
                  u.cabinet_id ? "Search theme…" : "Add a cabinet first"
                }" value="${esc(themeValue)}" ${u.cabinet_id ? "" : "disabled"} />
                <div class="pwb-theme-results" hidden></div>
                <div class="theme-meta">${esc(toLabel)}${
                  u.current_theme_name ? ` · from ${esc(u.current_theme_name)}` : ""
                } ${softwareBadge(u)}</div>
              </div>`;
        return `<tr>
          <td>${opSelect}</td>
          <td><input data-unit="${esc(u.uuid)}" data-field="serial" value="${esc(
            u.serial || ""
          )}" /></td>
          <td title="${esc(u.manufacturer_name || "")}">${esc(
            u.cabinet_name || u.cabinet_id || "—"
          )}</td>
          <td>${themeCell}</td>
          <td><input data-unit="${esc(u.uuid)}" data-field="zone" value="${esc(
            u.zone || ""
          )}" /></td>
          <td><input data-unit="${esc(u.uuid)}" data-field="bank" value="${esc(
            u.bank || ""
          )}" /></td>
          <td><input data-unit="${esc(u.uuid)}" data-field="location" value="${esc(
            u.location || ""
          )}" /></td>
          <td><button type="button" class="pwb-del-line" data-del-unit="${esc(
            u.uuid
          )}" title="Delete line" aria-label="Delete line">×</button></td>
        </tr>
        <tr class="pwb-edit-setup-row"><td colspan="8">
          <div class="pwb-edit-setup">
            <label>RTP<input data-unit="${esc(u.uuid)}" data-field="rtp_target" value="${esc(
              u.rtp_target || ""
            )}" placeholder="optional" /></label>
            <label>Denom<input data-unit="${esc(u.uuid)}" data-field="denom" value="${esc(
              u.denom || ""
            )}" placeholder="optional" /></label>
            <label>Bet<input data-unit="${esc(u.uuid)}" data-field="bet_config" value="${esc(
              u.bet_config || ""
            )}" placeholder="optional" /></label>
            <label>Restrict<input data-unit="${esc(u.uuid)}" data-field="restrictions" value="${esc(
              u.restrictions || ""
            )}" placeholder="optional" /></label>
          </div>
        </td></tr>`;
      })
      .join("");

    fields.innerHTML = `
      <table class="pwb-edit-table">
        <colgroup>
          <col class="c-op" /><col class="c-serial" /><col class="c-cab" />
          <col class="c-theme" /><col class="c-zbl" /><col class="c-zbl" /><col class="c-zbl" />
          <col class="c-del" />
        </colgroup>
        <thead><tr>
          <th>Op</th><th>Serial</th><th>Cabinet</th><th>Theme (To)</th>
          <th>Zone</th><th>Bank</th><th>Loc</th><th></th>
        </tr></thead>
        <tbody>${
          rows || `<tr><td colspan="8" class="pwb-empty">No units on this proposal.</td></tr>`
        }</tbody>
      </table>
      <div class="pwb-actions" style="margin-top:12px">
        <button type="button" class="dgs-v2-btn" id="btn-add-line">Add line</button>
        <button type="button" class="dgs-v2-btn dgs-v2-btn--primary" id="btn-send-precheck-edit">Send to Pre-Check</button>
      </div>
    `;
    bindEditHandlers();
    fields.scrollTop = scrollTop;
    if (restore && restore.unit && restore.field) {
      const el = fields.querySelector(
        `[data-unit="${CSS.escape(restore.unit)}"][data-field="${CSS.escape(restore.field)}"]`
      );
      if (el) {
        el.focus();
        if (restore.start != null && typeof el.setSelectionRange === "function") {
          try {
            el.setSelectionRange(restore.start, restore.end == null ? restore.start : restore.end);
          } catch (_) {
            /* non-text inputs */
          }
        }
      }
    }
    // wordcraft:open always resets scroll — only reopen when asked.
    if (opts.refreshDoc === "now") refreshWordCraftDoc();
    else if (opts.refreshDoc === "later") scheduleWordCraftRefresh();
  }

  async function addUnitLine() {
    if (!STATE.activeRef) return;
    try {
      showError("");
      STATE.pushPending += 1;
      setSync("adding…", "pending");
      STATE.detail = await api(
        `/api/projects-workbench/proposals/${encodeURIComponent(STATE.activeRef)}/units`,
        { method: "POST", body: JSON.stringify({}) }
      );
      STATE.contentRevision =
        (STATE.detail.proposal && STATE.detail.proposal.content_revision) || STATE.contentRevision;
      await loadList();
      renderEdit({ refreshDoc: "now" });
      setSync(`added ${STATE.contentRevision || ""}`, "ok");
    } catch (e) {
      showError(e.message || String(e));
      setSync(e.message || "add failed", "err");
    } finally {
      STATE.pushPending = Math.max(0, STATE.pushPending - 1);
    }
  }

  async function deleteUnitLine(unitId) {
    if (!confirm("Delete this line?")) return;
    try {
      showError("");
      STATE.pushPending += 1;
      setSync("deleting…", "pending");
      STATE.detail = await api(
        `/api/projects-workbench/units/${encodeURIComponent(unitId)}`,
        { method: "DELETE" }
      );
      STATE.contentRevision =
        (STATE.detail.proposal && STATE.detail.proposal.content_revision) || STATE.contentRevision;
      await loadList();
      renderEdit({ refreshDoc: "now" });
      setSync(`deleted ${STATE.contentRevision || ""}`, "ok");
    } catch (e) {
      showError(e.message || String(e));
      setSync(e.message || "delete failed", "err");
    } finally {
      STATE.pushPending = Math.max(0, STATE.pushPending - 1);
    }
  }

  function unitById(unitId) {
    return (STATE.detail && STATE.detail.units || []).find((u) => u.uuid === unitId) || {};
  }

  function commitFieldInput(el) {
    const field = el.dataset.field;
    const unitId = el.dataset.unit;
    if (!field || !unitId) return;
    if (field === "theme_q") {
      // Blank + Enter clears Theme (To) → TBD. Non-blank Enter leaves search/pick flow alone.
      if (!el.value.trim() && themeIsSet(unitById(unitId))) {
        patchUnit(unitId, { proposed_theme_id: "" });
      }
      return;
    }
    const body = {};
    body[field] = el.value;
    patchUnit(unitId, body);
  }

  function bindEditHandlers() {
    const fields = document.getElementById("edit-fields-root");
    fields.querySelectorAll("select[data-unit][data-field=op]").forEach((el) => {
      el.addEventListener("change", () => patchUnit(el.dataset.unit, { op: el.value }));
    });
    ["serial", "zone", "bank", "location", "rtp_target", "denom", "bet_config", "restrictions"].forEach(
      (field) => {
        fields.querySelectorAll(`input[data-unit][data-field=${field}]`).forEach((el) => {
          el.addEventListener("keydown", (ev) => {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            commitFieldInput(el);
          });
          el.addEventListener("change", () => commitFieldInput(el));
        });
      }
    );
    fields.querySelectorAll("input[data-unit][data-field=theme_q]").forEach((el) => {
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
        commitFieldInput(el);
      });
    });
    fields.querySelectorAll("button[data-del-unit]").forEach((el) => {
      el.addEventListener("click", () => deleteUnitLine(el.getAttribute("data-del-unit")));
    });
    const addBtn = document.getElementById("btn-add-line");
    if (addBtn) addBtn.addEventListener("click", () => addUnitLine());
    const send = document.getElementById("btn-send-precheck-edit");
    if (send) {
      send.addEventListener("click", async () => {
        try {
          showError("");
          STATE.detail = await api(
            `/api/projects-workbench/proposals/${encodeURIComponent(
              STATE.detail.proposal.reference_key
            )}/stage`,            { method: "POST", body: JSON.stringify({ stage: "pre_check" }) }
          );
          await loadList();
          exitEdit();
        } catch (e) {
          showError(e.message || String(e));
        }
      });
    }
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
    actions += `<button type="button" class="dgs-v2-btn" id="btn-download-docx-detail">Download</button>`;
    if (editUnits || (p.stage === "pre_check" && (STATE.isAdmin || STATE.canWrite))) {
      actions += `<button type="button" class="dgs-v2-btn" id="btn-archive-proposal-detail">Archive</button>`;
    }
    if (editUnits) {
      actions += `<button type="button" class="dgs-v2-btn dgs-v2-btn--primary" id="btn-edit-proposal">Edit Proposal</button>`;
      actions += `<button type="button" class="dgs-v2-btn" id="btn-send-precheck">Send to Pre-Check</button>`;
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

    const byUnit = {};
    (d.checks || []).forEach((c) => {
      if (!byUnit[c.proposal_unit_id]) byUnit[c.proposal_unit_id] = {};
      byUnit[c.proposal_unit_id][c.check_type] = c;
    });

    const unitsRows = (d.units || [])
      .map((u) => {
        const themeLabel =
          u.op === "REMOVE"
            ? `<span class="pwb-removed">removed</span>`
            : Number(u.is_tbd)
              ? `<span class="pwb-tbd">TBD</span>`
              : u.unverified_theme_id
                ? `<span class="pwb-temp">${esc(u.unverified_theme_name || "Temp")}</span>`
                : esc(u.proposed_theme_name || "—");
        return `<tr>
          <td>${esc(u.action_name || u.op)}</td>
          <td>${esc(u.serial || "")}</td>
          <td>${esc(u.cabinet_name || u.cabinet_id || "—")}</td>
          <td>${esc(u.current_theme_name || "—")}</td>
          <td>${themeLabel}${softwareBadge(u)}${themeHubLink(u)}</td>
          <td>${esc(zbl(u))}</td>
          ${
            showChecks
              ? CHECKS.map(([type]) =>
                  checkCell(
                    (byUnit[u.uuid] || {})[type],
                    type === "par" || type === "lab" ? addDocLink(u, type, byUnit) : ""
                  )
                ).join("")
              : ""
          }
        </tr>`;
      })
      .join("");

    const checkHeads = showChecks
      ? CHECKS.map(([, label]) => `<th>${label}</th>`).join("")
      : "";
    const colCount = showChecks ? 6 + CHECKS.length : 6;

    root.innerHTML = `
      <h2>${esc(p.reference_key)}</h2>
      <div class="meta" style="color:#9aa3b2;font-size:.9rem">
        ${esc(p.casino_short || p.casino_name)} · ${esc(p.kind)} · v${esc(p.version_num)}
      </div>
      ${stageRail(p.stage)}
      <div style="margin-top:8px">${badgeStage(p.stage)} ${p.stage === "draft" ? "" : badgeReady(p)}</div>
      ${laterNote ? `<p class="pwb-stage-note">${esc(laterNote)}</p>` : ""}
      <div class="pwb-actions">${actions}</div>

      <div class="pwb-section">Archived versions (read-only)</div>
      <div id="detail-artifacts">${artifactsHtml("detail-arch")}</div>

      <div class="pwb-section">What is being proposed</div>
      ${proposedSummary(d.units)}

      <div class="pwb-section">Lines</div>
      <table class="pwb-table">
        <thead><tr>
          <th>Op</th><th>Serial</th><th>Cabinet</th><th>From</th><th>To</th><th>Z-B-L</th>
          ${checkHeads}
        </tr></thead>
        <tbody>${unitsRows || `<tr><td colspan="${colCount}" class="pwb-empty">No units</td></tr>`}</tbody>
      </table>

      ${deptNotesHtml(d)}
    `;

    bindArtifactDownloads(document.getElementById("detail-artifacts"));
    const dlDetail = document.getElementById("btn-download-docx-detail");
    if (dlDetail) {
      dlDetail.addEventListener("click", async () => {
        try {
          showError("");
          await downloadCurrentDocx();
        } catch (e) {
          showError(e.message || String(e));
        }
      });
    }
    const archDetail = document.getElementById("btn-archive-proposal-detail");
    if (archDetail) archDetail.addEventListener("click", () => archiveCurrentProposal());

    const editBtn = document.getElementById("btn-edit-proposal");
    if (editBtn) editBtn.addEventListener("click", () => enterEdit());

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

    root.querySelectorAll("select[data-check][data-field=status]").forEach((el) => {
      el.addEventListener("change", () => patchCheck(el.dataset.check, { status: el.value }));
    });
  }

  async function themeSearch(input) {
    const wrap = input.closest(".pwb-theme-wrap") || input.parentElement;
    const box = wrap.querySelector(".pwb-theme-results");
    if (!box) return;
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
      STATE.pushPending += 1;
      setSync("pushing…", "pending");
      STATE.detail = await api(`/api/projects-workbench/units/${encodeURIComponent(unitId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      STATE.contentRevision =
        (STATE.detail.proposal && STATE.detail.proposal.content_revision) || STATE.contentRevision;
      await loadList();
      if (STATE.mode === "edit") renderEdit({ refreshDoc: "later" });
      else renderDetail();
      setSync(`pushed ${STATE.contentRevision || ""}`, "ok");
    } catch (e) {
      showError(e.message || String(e));
      setSync(e.message || "push failed", "err");
    } finally {
      STATE.pushPending = Math.max(0, STATE.pushPending - 1);
    }
  }

  async function patchProposal(body) {
    if (!STATE.activeRef) return;
    try {
      showError("");
      STATE.pushPending += 1;
      setSync("pushing…", "pending");
      STATE.detail = await api(
        `/api/projects-workbench/proposals/${encodeURIComponent(STATE.activeRef)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      STATE.contentRevision =
        (STATE.detail.proposal && STATE.detail.proposal.content_revision) || STATE.contentRevision;
      await loadList();
      if (STATE.mode === "edit") renderEdit({ refreshDoc: "later" });
      else renderDetail();
      setSync(`pushed ${STATE.contentRevision || ""}`, "ok");
    } catch (e) {
      showError(e.message || String(e));
      setSync(e.message || "push failed", "err");
    } finally {
      STATE.pushPending = Math.max(0, STATE.pushPending - 1);
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
    if (stage && stage !== "active") params.set("stage", stage);
    if (STATE.casinoFilter) params.set("casino_id", STATE.casinoFilter);
    params.set("page_size", "100");
    const data = await api(`/api/projects-workbench/proposals?${params}`);
    let items = data.items || [];
    if (stage === "active") {
      items = items.filter((it) => it.stage !== "done");
    }
    STATE.items = items;
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
      await loadArtifacts();
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
      STATE.actionTypes = perms.action_types || [];
      document.getElementById("btn-refresh").addEventListener("click", () => loadList());
      document.getElementById("stage-filter").addEventListener("change", () => loadList());
      document.getElementById("btn-exit-edit").addEventListener("click", () => exitEdit());
      document.getElementById("btn-download-docx").addEventListener("click", async () => {
        try {
          showError("");
          await downloadCurrentDocx();
        } catch (e) {
          showError(e.message || String(e));
        }
      });
      document
        .getElementById("btn-archive-proposal")
        .addEventListener("click", () => archiveCurrentProposal());
      let t = null;
      document.getElementById("q").addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => loadList(), 250);
      });
      await loadList();
      const ref = (params.get("ref") || "").trim();
      if (ref) await openDetail(ref);
      else if (STATE.items.length === 1) await openDetail(STATE.items[0].reference_key);
      if ((params.get("edit") || "") === "1" && STATE.detail && canEditUnits(STATE.detail.proposal.stage)) {
        enterEdit();
      }
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  window.ProjectWorkbench = { init };
})();
