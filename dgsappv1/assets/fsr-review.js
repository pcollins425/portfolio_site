(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

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

  function collectForm(issueEl, issue) {
    const type = issue.issue_type;
    if (type === "asset_numbers") {
      const rows = [];
      issueEl.querySelectorAll("[data-serial]").forEach((row) => {
        const serial = row.getAttribute("data-serial");
        const input = row.querySelector('input[name="asset"]');
        rows.push({ serial, asset: (input && input.value || "").trim() });
      });
      return { rows };
    }
    if (type === "footer_settings") {
      const rows = [];
      issueEl.querySelectorAll("[data-serial]").forEach((row) => {
        const serial = row.getAttribute("data-serial");
        const extras = [];
        row.querySelectorAll('input[data-extra]').forEach((inp) => {
          extras.push({
            header: inp.getAttribute("data-extra"),
            value: (inp.value || "").trim(),
            cell: inp.getAttribute("data-cell") || null,
          });
        });
        rows.push({ serial, extras });
      });
      return { rows };
    }
    if (type === "email_extras") {
      const cues = [];
      issueEl.querySelectorAll('input[type="checkbox"][data-cue]').forEach((cb) => {
        cues.push({
          id: cb.getAttribute("data-cue"),
          accepted: !!cb.checked,
          detail: cb.getAttribute("data-detail") || "",
        });
      });
      const note = issueEl.querySelector('textarea[name="email_note"]');
      return { cues, note: note ? note.value.trim() : "" };
    }
    if (type === "day_pages") {
      const sel = issueEl.querySelector('select[name="day_disposition"]');
      const note = issueEl.querySelector('textarea[name="day_note"]');
      return {
        disposition: sel ? sel.value : "",
        note: note ? note.value.trim() : "",
      };
    }
    if (type === "install_peripherals") {
      const ba = issueEl.querySelector('input[name="ba_bv"]');
      const printer = issueEl.querySelector('input[name="printer"]');
      const cashbox = issueEl.querySelector('input[name="cashbox"]');
      const note = issueEl.querySelector('textarea[name="periph_note"]');
      return {
        ba_bv: ba ? ba.value.trim() : "",
        printer: printer ? printer.value.trim() : "",
        cashbox: cashbox ? cashbox.value.trim() : "",
        note: note ? note.value.trim() : "",
      };
    }
    const note = issueEl.querySelector("textarea");
    return { note: note ? note.value.trim() : "" };
  }

  function renderAssetIssue(issue) {
    const rows = (issue.payload && issue.payload.rows) || [];
    const body = rows
      .map((r) => {
        const proposed = r.proposed_asset || "";
        const main = r.main_asset || "TBD";
        return `<div class="fsr-row" data-serial="${esc(r.serial)}">
          <label>Serial<span>${esc(r.serial)}</span></label>
          <label>Action<span>${esc(r.action || "—")}</span></label>
          <label>Main sheet<span>${esc(main)}</span></label>
          <label>Asset #
            <input name="asset" value="${esc(proposed || (main !== "TBD" ? main : ""))}" placeholder="Asset number" />
          </label>
        </div>`;
      })
      .join("");
    return body || `<p class="fsr-empty">No asset rows in payload.</p>`;
  }

  function renderFooterSettings(issue) {
    const rows = (issue.payload && issue.payload.rows) || [];
    return (
      rows
        .map((r) => {
          const extras = (r.extras || [])
            .map(
              (ex, i) => `<label>${esc(ex.header || "value")}
              <input data-extra="${esc(ex.header || "value")}" data-cell="${esc(ex.cell || "")}"
                value="${esc(ex.value || "")}" /></label>`
            )
            .join("");
          return `<div class="fsr-row" data-serial="${esc(r.serial)}">
            <label>Serial<span>${esc(r.serial)}</span></label>
            ${extras}
          </div>`;
        })
        .join("") || `<p class="fsr-empty">No footer settings.</p>`
    );
  }

  function renderEmailExtras(issue) {
    const cues = (issue.payload && issue.payload.cues) || [];
    const boxes = cues
      .map((c, i) => {
        const id = `cue_${i}`;
        return `<label style="flex-direction:row;align-items:center;gap:8px;color:#e8ecf2">
          <input type="checkbox" data-cue="${esc(id)}" data-detail="${esc(c.detail || "")}" checked />
          <span>${esc(c.reason || "Email cue")}${c.detail ? ` — ${esc(c.detail)}` : ""}</span>
        </label>`;
      })
      .join("") || `<p class="fsr-empty">No email cues.</p>`;
    return `${boxes}<label style="margin-top:10px;display:flex;flex-direction:column;gap:4px;color:#9aa3b2;font-size:.8rem">
      Note <textarea name="email_note" rows="2" placeholder="Optional note"></textarea></label>`;
  }

  function renderDayPages(issue) {
    const days = (issue.payload && issue.payload.days) || [];
    const opts = (issue.payload && issue.payload.options) || [];
    const expected = issue.payload && issue.payload.expected_day_count;
    const span =
      issue.payload && (issue.payload.start_date || issue.payload.end_date)
        ? `<p class="meta">Expected days: ${esc(expected ?? "—")} (${esc(
            issue.payload.start_date || "?"
          )} → ${esc(issue.payload.end_date || "?")}; ${esc(
            issue.payload.expected_day_source || ""
          )})</p>`
        : expected
          ? `<p class="meta">Expected days: ${esc(expected)} (${esc(
              issue.payload.expected_day_source || ""
            )})</p>`
          : "";
    const list = days
      .map(
        (d) =>
          `<li>${esc(d.name)} — ${esc(d.status)} (missing: ${esc((d.required_missing || []).join(", ") || "—")})</li>`
      )
      .join("");
    const options = opts
      .map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`)
      .join("");
    return `${span}<ul>${list || "<li>No day sheet details</li>"}</ul>
      <label style="display:flex;flex-direction:column;gap:4px;color:#9aa3b2;font-size:.8rem;margin-top:8px">
        Disposition
        <select name="day_disposition">${options}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#9aa3b2;font-size:.8rem;margin-top:8px">
        Note <textarea name="day_note" rows="2" placeholder="Optional"></textarea>
      </label>`;
  }

  function renderInstallPeripherals(issue) {
    const installs = (issue.payload && issue.payload.installs) || [];
    const missing = (issue.payload && issue.payload.missing) || [];
    const list = installs
      .map(
        (r) =>
          `<li>${esc(r.serial || "—")}${r.theme ? ` — ${esc(r.theme)}` : ""}${
            r.asset_no ? ` (asset ${esc(r.asset_no)})` : ""
          }</li>`
      )
      .join("");
    const needBv = missing.includes("ba_bv");
    const needPrinter = missing.includes("printer");
    return `<p class="meta">Missing: ${esc(missing.join(", ") || "BA/BV, Printer")}</p>
      <ul>${list || "<li>No install rows</li>"}</ul>
      <div class="fsr-row">
        <label>BA/BV
          <input name="ba_bv" placeholder="${needBv ? "Required" : "Optional"}" />
        </label>
        <label>Printer
          <input name="printer" placeholder="${needPrinter ? "Required" : "Optional"}" />
        </label>
        <label>Cashbox
          <input name="cashbox" placeholder="Optional" />
        </label>
      </div>
      <label style="display:flex;flex-direction:column;gap:4px;color:#9aa3b2;font-size:.8rem;margin-top:8px">
        Note <textarea name="periph_note" rows="2" placeholder="Optional"></textarea>
      </label>`;
  }

  function renderIssueBody(issue) {
    switch (issue.issue_type) {
      case "asset_numbers":
        return renderAssetIssue(issue);
      case "footer_settings":
        return renderFooterSettings(issue);
      case "email_extras":
        return renderEmailExtras(issue);
      case "day_pages":
        return renderDayPages(issue);
      case "install_peripherals":
        return renderInstallPeripherals(issue);
      default:
        return `<pre style="white-space:pre-wrap;font-size:.85rem">${esc(
          JSON.stringify(issue.payload || {}, null, 2)
        )}</pre>`;
    }
  }

  function renderIssue(issue) {
    const open = issue.status === "open";
    const el = document.createElement("section");
    el.className = "fsr-issue";
    el.dataset.issueId = issue.issue_id;
    el.innerHTML = `
      <h2>${esc(issue.title)} <span class="fsr-status ${esc(issue.status)}">${esc(issue.status)}</span></h2>
      <div class="meta">${esc(issue.issue_type)}</div>
      <div class="fsr-body">${renderIssueBody(issue)}</div>
      ${
        open
          ? `<div class="fsr-actions">
              <button type="button" class="dgs-v2-btn dgs-v2-btn-primary" data-act="confirm">Confirm</button>
              <button type="button" class="dgs-v2-btn" data-act="revoke">Revoke</button>
              <button type="button" class="dgs-v2-btn" data-act="clarify">Clarify…</button>
            </div>
            <div class="fsr-clarify" hidden style="margin-top:10px">
              <textarea rows="3" placeholder="What should the tech clarify?" style="width:100%"></textarea>
              <div class="fsr-actions">
                <button type="button" class="dgs-v2-btn dgs-v2-btn-primary" data-act="clarify-submit">Submit clarify</button>
                <button type="button" class="dgs-v2-btn" data-act="clarify-cancel">Cancel</button>
              </div>
            </div>`
          : `<p class="meta">Decided by ${esc(issue.decided_by || "—")} ${
              issue.decided_at ? `at ${esc(issue.decided_at)}` : ""
            }${issue.clarify_note ? ` — ${esc(issue.clarify_note)}` : ""}</p>`
      }`;

    if (open) {
      el.querySelector('[data-act="confirm"]').addEventListener("click", async () => {
        try {
          showError("");
          const form_values = collectForm(el, issue);
          await api(`/api/fsr-review/issues/${issue.issue_id}/confirm`, {
            method: "POST",
            body: JSON.stringify({ form_values }),
          });
          await loadCase();
        } catch (err) {
          showError(err.message || String(err));
        }
      });
      el.querySelector('[data-act="revoke"]').addEventListener("click", async () => {
        try {
          showError("");
          await api(`/api/fsr-review/issues/${issue.issue_id}/revoke`, { method: "POST", body: "{}" });
          await loadCase();
        } catch (err) {
          showError(err.message || String(err));
        }
      });
      const clarifyBox = el.querySelector(".fsr-clarify");
      el.querySelector('[data-act="clarify"]').addEventListener("click", () => {
        clarifyBox.hidden = false;
      });
      el.querySelector('[data-act="clarify-cancel"]').addEventListener("click", () => {
        clarifyBox.hidden = true;
      });
      el.querySelector('[data-act="clarify-submit"]').addEventListener("click", async () => {
        try {
          showError("");
          const note = (clarifyBox.querySelector("textarea").value || "").trim();
          if (!note) throw new Error("Clarify note is required");
          await api(`/api/fsr-review/issues/${issue.issue_id}/clarify`, {
            method: "POST",
            body: JSON.stringify({ note }),
          });
          await loadCase();
        } catch (err) {
          showError(err.message || String(err));
        }
      });
    }
    return el;
  }

  let applyPollGeneration = 0;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollApplyStatus(caseId, { onTick, generation } = {}) {
    const terminal = new Set(["applied", "failed", "none"]);
    for (let i = 0; i < 180; i += 1) {
      if (generation != null && generation !== applyPollGeneration) {
        return null;
      }
      await sleep(2000);
      const data = await api(`/api/fsr-review/cases/${caseId}`);
      const st = String(data.apply_status || "none").toLowerCase();
      if (typeof onTick === "function") onTick(data);
      if (terminal.has(st)) {
        return data;
      }
    }
    throw new Error("Live apply still running after several minutes — refresh this page later");
  }

  function renderApplyBar(data) {
    const bar = document.getElementById("apply-bar");
    if (!bar) return;
    const eligible = !!data.apply_eligible;
    const liveEnabled = !!data.live_apply_enabled;
    const applyStatus = data.apply_status || "none";
    const log = data.apply_log || null;
    let logHtml = "";
    if (log) {
      const sample = log.asset_sample ? JSON.stringify(log.asset_sample) : "";
      const unmapped = (log.unmapped_settings || []).length;
      const err = log.error ? `\nerror: ${esc(typeof log.error === "string" ? log.error : JSON.stringify(log.error))}` : "";
      logHtml = `<div class="fsr-apply-log">Last apply: ${esc(log.phase || applyStatus)}
csv: ${esc(log.csv_path || "—")}
assets: ${esc(sample || "—")}
unmapped settings: ${esc(String(unmapped))}${err}</div>`;
    }
    if (!eligible && applyStatus === "none" && !log) {
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    bar.hidden = false;
    const reason = data.apply_eligible_reason || "";
    const liveBlocked = eligible && !liveEnabled
      ? `<p class="meta" style="margin:6px 0 0;color:#f0c14b">Apply live is gated — set <code>FSR_APPLY_LIVE=1</code> in backend_live/.env and recreate the API container.</p>`
      : "";
    const runningNote = applyStatus === "running"
      ? `<p class="meta" style="margin:6px 0 0">Live apply in progress… this page will refresh when it finishes.</p>`
      : "";
    bar.innerHTML = `
      <div><strong>Floor apply</strong>
        <span class="meta"> — status ${esc(applyStatus)}${eligible ? "" : ` (${esc(reason)})`}</span>
      </div>
      <p class="meta" style="margin:6px 0 0">Writes confirmed assets/settings via eMaint CSV overlay (does not edit the worksheet file).</p>
      ${liveBlocked}
      ${runningNote}
      <div class="fsr-actions">
        <button type="button" class="dgs-v2-btn dgs-v2-btn-primary" data-act="dry-run" ${eligible ? "" : "disabled"}>Dry run</button>
        <button type="button" class="dgs-v2-btn" data-act="live-apply" ${eligible && liveEnabled ? "" : "disabled"}>Apply live…</button>
      </div>
      ${logHtml}
    `;
    const dryBtn = bar.querySelector('[data-act="dry-run"]');
    const liveBtn = bar.querySelector('[data-act="live-apply"]');
    if (dryBtn && eligible) {
      dryBtn.addEventListener("click", async () => {
        try {
          showError("");
          dryBtn.disabled = true;
          await api(`/api/fsr-review/cases/${data.case_id}/apply`, {
            method: "POST",
            body: JSON.stringify({ dry_run: true }),
          });
          await loadCase();
        } catch (err) {
          showError(err.message || String(err));
          dryBtn.disabled = false;
        }
      });
    }
    if (liveBtn && eligible && liveEnabled) {
      liveBtn.addEventListener("click", async () => {
        if (!window.confirm("Apply live to eMaint / SMM / projects? This writes production data.")) {
          return;
        }
        try {
          showError("");
          liveBtn.disabled = true;
          if (dryBtn) dryBtn.disabled = true;
          const res = await api(`/api/fsr-review/cases/${data.case_id}/apply`, {
            method: "POST",
            body: JSON.stringify({ dry_run: false }),
          });
          if (res.accepted || String(res.apply_status || "").toLowerCase() === "running") {
            const gen = ++applyPollGeneration;
            await pollApplyStatus(data.case_id, {
              generation: gen,
              onTick: (c) => {
                const phase = (c.apply_log && c.apply_log.phase) || c.apply_status || "running";
                bar.querySelector(".fsr-apply-progress")?.remove();
                const note = document.createElement("p");
                note.className = "meta fsr-apply-progress";
                note.style.margin = "6px 0 0";
                note.textContent = `Live apply: ${phase}…`;
                bar.appendChild(note);
              },
            });
          }
          await loadCase();
        } catch (err) {
          showError(err.message || String(err));
          await loadCase();
        }
      });
    }

    if (applyStatus === "running") {
      const gen = ++applyPollGeneration;
      pollApplyStatus(data.case_id, { generation: gen })
        .then((c) => {
          if (c && gen === applyPollGeneration) loadCase();
        })
        .catch((err) => showError(err.message || String(err)));
    }
  }

  async function loadCase() {
    const caseId = params.get("case");
    const root = document.getElementById("issues-root");
    const meta = document.getElementById("case-meta");
    const title = document.getElementById("page-title");
    if (!caseId) {
      root.innerHTML = `<p class="fsr-empty">Open a review link with <code>?case=…</code> from the FSR audit email.</p>`;
      return;
    }
    const data = await api(`/api/fsr-review/cases/${caseId}`);
    title.textContent = `FSR Review — Project ${data.project_number || "—"}`;
    meta.innerHTML = `
      Status: <strong>${esc(data.status)}</strong>
      · Apply: <strong>${esc(data.apply_status || "none")}</strong>
      · From: ${esc(data.gmail_from || "—")}
      · ${esc(data.subject || "")}
      · Workbook: ${esc(data.workbook_name || "—")}
    `;
    renderApplyBar(data);
    root.innerHTML = "";
    (data.issues || []).forEach((issue) => root.appendChild(renderIssue(issue)));
    if (!(data.issues || []).length) {
      root.innerHTML = `<p class="fsr-empty">No issues on this case.</p>`;
    }
  }

  async function init() {
    try {
      showError("");
      await loadCase();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  window.DGSFsrReview = { init };
})();
