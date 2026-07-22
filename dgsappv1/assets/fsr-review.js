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
    const list = days
      .map(
        (d) =>
          `<li>${esc(d.name)} — ${esc(d.status)} (missing: ${esc((d.required_missing || []).join(", ") || "—")})</li>`
      )
      .join("");
    const options = opts
      .map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`)
      .join("");
    return `<ul>${list || "<li>No day sheet details</li>"}</ul>
      <label style="display:flex;flex-direction:column;gap:4px;color:#9aa3b2;font-size:.8rem;margin-top:8px">
        Disposition
        <select name="day_disposition">${options}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#9aa3b2;font-size:.8rem;margin-top:8px">
        Note <textarea name="day_note" rows="2" placeholder="Optional"></textarea>
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
      · From: ${esc(data.gmail_from || "—")}
      · ${esc(data.subject || "")}
      · Workbook: ${esc(data.workbook_name || "—")}
    `;
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
