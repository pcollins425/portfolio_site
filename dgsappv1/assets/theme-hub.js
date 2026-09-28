(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const themeId = (params.get("id") || "").trim();
  const addKinds = (params.get("add") || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part === "par" || part === "lab");
  const addMode = addKinds.length > 0;

  const els = {
    error: document.getElementById("error-box"),
    body: document.getElementById("hub-body"),
    loading: document.getElementById("hub-loading"),
    title: document.getElementById("caption-title"),
    id: document.getElementById("caption-id"),
    meta: document.getElementById("caption-meta"),
    grid: document.getElementById("hub-grid"),
    add: document.getElementById("add-root"),
  };

  let payload = null;

  function apiBase() {
    return (window.DGSAuth ? DGSAuth.apiBase() : "").replace(/\/$/, "");
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showError(msg) {
    els.error.hidden = !msg;
    els.error.textContent = msg || "";
  }

  async function fetchJson(path, opts) {
    const headers = window.DGSAuth ? DGSAuth.authHeaders() : {};
    if (opts && opts.body && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${apiBase()}${path}`, Object.assign({ headers }, opts || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.detail || body.message || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return body;
  }

  function docHref(path) {
    return `${apiBase()}/api/documents/${String(path || "").split("/").map(encodeURIComponent).join("/")}`;
  }

  function money(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  function jurisdictionOptions(selected, includeAll) {
    const rows = payload.jurisdictions || [];
    const all = includeAll
      ? `<option value=""${selected ? "" : " selected"}>All jurisdictions</option>`
      : `<option value="">Select a jurisdiction</option>`;
    return (
      all +
      rows
        .map(
          (row) =>
            `<option value="${esc(row.code)}"${row.code === selected ? " selected" : ""}>${esc(row.label)}</option>`
        )
        .join("")
    );
  }

  function softwareOptions(selected) {
    return (payload.software || [])
      .filter((row) => !row.revoked)
      .map((row) => {
        const cabs = (row.cabinets || []).map((cab) => cab.cabinet_name || cab.cabinet_id).join(", ");
        return `<option value="${esc(row.reference_key)}"${
          row.reference_key === selected ? " selected" : ""
        }>${esc(row.software_id)} · ${esc(row.reference_key)}${cabs ? ` · ${esc(cabs)}` : ""}</option>`;
      })
      .join("");
  }

  function finishHref() {
    const ret = params.get("return") || "";
    const proposal = params.get("proposal") || "";
    const safe = /^project-workbench\.html(\?[^#]*)?$/.test(ret)
      ? ret
      : `project-workbench.html?ref=${encodeURIComponent(proposal)}`;
    return window.DGS && DGS.withApi ? DGS.withApi(safe) : safe;
  }

  function tile(title, body) {
    return `<article class="dgs-v2-hub-tile dgs-v2-hub-tile--wide"><div class="dgs-v2-hub-tile-head"><div class="dgs-v2-section-label">${esc(
      title
    )}</div></div><div class="dgs-v2-hub-tile-body">${body}</div></article>`;
  }

  function renderAdd() {
    const ctx = payload.add_context || {};
    const jur = ctx.jurisdiction || {};
    const unit = ctx.unit || {};
    const cabinetId = unit.cabinet_id || params.get("cabinet") || "";
    const cabinetName = unit.cabinet_name || cabinetId || "this cabinet";
    const needsPar = addKinds.includes("par");
    const needsLab = addKinds.includes("lab");
    const title = needsPar && needsLab ? "Add par and lab" : needsPar ? "Add par" : "Add lab";
    const note = jur.label
      ? `This casino needs ${jur.label}.${jur.note ? ` ${jur.note}` : ""}`
      : jur.note || "";
    const matching = (payload.software || []).find(
      (row) =>
        !row.revoked && (row.cabinets || []).some((cab) => cab.cabinet_id === cabinetId)
    );
    document.querySelector("h1").textContent = title;
    els.add.innerHTML = `
      <form class="th-form" id="add-form">
        <p class="th-note">${esc(note)} Finish Upload files these onto the theme and returns to the proposal.</p>
        ${
          needsPar
            ? `<fieldset>
                <legend>Par</legend>
                <label>File <input type="file" name="par_file" accept="application/pdf,.pdf" required /></label>
                <label>Jurisdiction
                  <select name="par_jurisdiction">${jurisdictionOptions("", true)}</select>
                </label>
                <p class="th-note">All jurisdictions is the default. A sheet for one jurisdiction wins for casinos there.</p>
              </fieldset>`
            : ""
        }
        ${
          needsLab
            ? `<fieldset>
                <legend>Lab</legend>
                <p class="th-note">Cabinet: ${esc(cabinetName || "missing on this unit")}</p>
                ${
                  cabinetId
                    ? ""
                    : `<p class="th-note">This unit has no cabinet, so the lab cannot be filed from here.</p>`
                }
                <label>File <input type="file" name="lab_file" accept="application/pdf,.pdf" required /></label>
                <label>Jurisdiction
                  <select name="lab_jurisdiction" required>${jurisdictionOptions(jur.code || "", false)}</select>
                </label>
                <label>Software
                  <select name="lab_software">
                    <option value="">New software for this cabinet</option>
                    ${softwareOptions(matching ? matching.reference_key : "")}
                  </select>
                </label>
                <label class="th-new-software">Program id
                  <input name="new_software_id" maxlength="50" placeholder="Program storage media #" />
                </label>
                <p class="th-note">Adding this cabinet onto software that already exists, and creating new software, are different. Pick the one you mean.</p>
              </fieldset>`
            : ""
        }
        ${
          !payload.can_write
            ? `<p class="th-note">Compliance has to be signed in to add these.</p>`
            : needsLab && !cabinetId
              ? `<p class="th-note">Add a cabinet on the unit before filing the lab.</p>`
              : `<button type="submit" class="dgs-v2-btn dgs-v2-btn--primary" id="btn-finish">Finish Upload</button>`
        }
      </form>`;
    const form = document.getElementById("add-form");
    const softwareSelect = form.querySelector("[name=lab_software]");
    const program = form.querySelector(".th-new-software");
    function syncProgram() {
      if (!program || !softwareSelect) return;
      program.hidden = softwareSelect.value !== "";
    }
    if (softwareSelect) {
      softwareSelect.addEventListener("change", syncProgram);
      syncProgram();
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.getElementById("btn-finish");
      button.disabled = true;
      try {
        showError("");
        if (needsPar) {
          const fd = new FormData();
          fd.set("doc_kind", "par");
          fd.set("jurisdiction_code", form.par_jurisdiction.value || "");
          fd.set("file", form.par_file.files[0]);
          await fetchJson(`/api/theme-hub/${encodeURIComponent(themeId)}/documents`, {
            method: "POST",
            body: fd,
          });
        }
        if (needsLab) {
          const fd = new FormData();
          fd.set("doc_kind", "lab");
          fd.set("jurisdiction_code", form.lab_jurisdiction.value || "");
          fd.set("file", form.lab_file.files[0]);
          fd.set("cabinet_id", cabinetId);
          if (softwareSelect && softwareSelect.value) {
            fd.set("software_ref", softwareSelect.value);
            const chosen = (payload.software || []).find((row) => row.reference_key === softwareSelect.value);
            const already = chosen && (chosen.cabinets || []).some((cab) => cab.cabinet_id === cabinetId);
            if (!already) fd.set("associate_cabinet", "1");
          } else {
            fd.set("new_software_id", form.new_software_id.value.trim());
          }
          await fetchJson(`/api/theme-hub/${encodeURIComponent(themeId)}/documents`, {
            method: "POST",
            body: fd,
          });
        }
        window.location.href = finishHref();
      } catch (err) {
        showError(err.message || String(err));
        button.disabled = false;
      }
    });
  }

  function renderHub() {
    const softwareBody = (payload.software || [])
      .map((row) => {
        const cabs = (row.cabinets || [])
          .map((cab) => esc(cab.cabinet_name || cab.cabinet_id))
          .join(", ");
        return `<tr>
          <td class="mono">${esc(row.reference_key)}</td>
          <td>${esc(row.software_id)}</td>
          <td>${cabs || "—"}</td>
          <td>${row.revoked ? "revoked" : row.has_settings ? "settings" : "no settings"}</td>
        </tr>`;
      })
      .join("");
    const docRows = (payload.documents || [])
      .map(
        (doc) => `<tr>
          <td>${esc(doc.doc_kind)}</td>
          <td>${esc(doc.jurisdiction_label || "—")}</td>
          <td>${esc(doc.software_id || doc.cabinet_name || "—")}</td>
          <td><a href="${docHref(doc.nas_rel_path)}" target="_blank" rel="noopener">${esc(
            doc.original_filename || doc.document_key
          )}</a></td>
        </tr>`
      )
      .join("");
    const legacy = [];
    if (payload.theme.slick_media_path) legacy.push(`Slick folder: ${payload.theme.slick_media_path}`);
    (payload.software || [])
      .filter((row) => row.lab_letter_media_path)
      .forEach((row) => legacy.push(`${row.software_id} lab folder: ${row.lab_letter_media_path}`));
    const installs = (payload.installs || [])
      .map((row) => {
        const perf = row.performance;
        return `<tr>
          <td>${esc(row.casino_short || row.property || "—")}</td>
          <td class="mono">${esc(row.serial_no || "—")}</td>
          <td>${esc(row.cabinet_name || "—")}</td>
          <td>${esc(row.status || "—")}</td>
          <td>${perf ? esc(money(perf.adw)) : "—"}</td>
          <td>${perf ? esc(perf.days_on_floor) : "—"}</td>
        </tr>`;
      })
      .join("");
    const jurisdictions = {};
    (payload.documents || [])
      .filter((doc) => doc.doc_kind === "lab")
      .forEach((doc) => {
        const label = doc.jurisdiction_label || doc.jurisdiction_code;
        jurisdictions[label] = jurisdictions[label] || new Set();
        if (doc.software_id) jurisdictions[label].add(doc.software_id);
      });
    const jurBody = Object.keys(jurisdictions)
      .sort()
      .map(
        (label) =>
          `<li>${esc(label)} · ${esc(Array.from(jurisdictions[label]).join(", ") || "software on file")}</li>`
      )
      .join("");
    const kits = (payload.kits || [])
      .map(
        (kit) =>
          `<p><strong>${esc(kit.kit_item)}</strong> ${esc(kit.descrip || "")}</p><ul>${(kit.lines || [])
            .map((line) => `<li>${esc(line.component_item)} × ${esc(line.qty)}</li>`)
            .join("")}</ul>`
      )
      .join("");
    const write = payload.can_write
      ? `<form class="th-form" id="hub-par">
          <label>Par PDF <input type="file" name="file" accept="application/pdf,.pdf" required /></label>
          <label>Jurisdiction <select name="jurisdiction_code">${jurisdictionOptions("", true)}</select></label>
          <button type="submit" class="dgs-v2-btn">Add par</button>
        </form>
        <form class="th-form" id="hub-lab">
          <label>Lab PDF <input type="file" name="file" accept="application/pdf,.pdf" required /></label>
          <label>Jurisdiction <select name="jurisdiction_code" required>${jurisdictionOptions("", false)}</select></label>
          <label>Software <select name="software_ref"><option value="">New software</option>${softwareOptions("")}</select></label>
          <label>Program id <input name="new_software_id" maxlength="50" /></label>
          <label>Cabinet <input name="cabinet_q" placeholder="Search cabinet" /><div class="th-picks" data-picks="lab"></div></label>
          <input type="hidden" name="cabinet_id" />
          <button type="submit" class="dgs-v2-btn">Add lab</button>
        </form>
        <form class="th-form" id="hub-slick">
          <label>Slick PDF <input type="file" name="file" accept="application/pdf,.pdf" required /></label>
          <label>Cabinet, if this slick is cabinet-specific
            <input name="cabinet_q" placeholder="Leave blank for the whole theme" />
            <div class="th-picks" data-picks="slick"></div>
          </label>
          <input type="hidden" name="cabinet_id" />
          <button type="submit" class="dgs-v2-btn">Add slick</button>
        </form>`
      : `<p class="th-note">Signed-in Compliance can add documents here.</p>`;
    const associate = payload.can_write
      ? `<form class="th-form" id="hub-cabinet">
          <label>Software <select name="software_ref">${softwareOptions("")}</select></label>
          <label>Add a cabinet to that software
            <input name="cabinet_q" placeholder="Search cabinet" />
            <div class="th-picks" data-picks="assoc"></div>
          </label>
          <input type="hidden" name="cabinet_id" />
          <button type="submit" class="dgs-v2-btn">Add cabinet</button>
        </form>
        <form class="th-form" id="hub-new-software">
          <label>Program id <input name="software_id" maxlength="50" required /></label>
          <label>Cabinet <input name="cabinet_q" placeholder="Search cabinet" required /><div class="th-picks" data-picks="newsw"></div></label>
          <input type="hidden" name="cabinet_id" />
          <button type="submit" class="dgs-v2-btn">New software</button>
        </form>`
      : "";

    els.grid.innerHTML = [
      tile(
        "Associated software",
        `<table class="th-table"><thead><tr><th>Ref</th><th>Program</th><th>Cabinets</th><th></th></tr></thead><tbody>${
          softwareBody || `<tr><td colspan="4">No software yet</td></tr>`
        }</tbody></table>${associate}`
      ),
      tile(
        "Documents",
        `<table class="th-table"><thead><tr><th>Kind</th><th>Jurisdiction</th><th>Where</th><th>File</th></tr></thead><tbody>${
          docRows || `<tr><td colspan="4">None added in the hub yet</td></tr>`
        }</tbody></table>${
          legacy.length ? `<p class="th-note">${esc(legacy.join(" · "))}</p>` : ""
        }${write}`
      ),
      tile(
        "Where it is installed",
        `<p class="th-note">Current floor only. ADW and days are the latest month for this theme on that serial.</p>
         <table class="th-table"><thead><tr><th>Casino</th><th>Serial</th><th>Cabinet</th><th>Status</th><th>ADW</th><th>Days</th></tr></thead><tbody>${
           installs || `<tr><td colspan="6">Not on the floor</td></tr>`
         }</tbody></table>`
      ),
      tile("Software kit", kits || `<p class="th-note">No eMaint kit is named for this theme.</p>`),
      tile(
        "Jurisdictions",
        jurBody
          ? `<ul>${jurBody}</ul>`
          : `<p class="th-note">No lab letter has a jurisdiction on this theme yet.</p>`
      ),
    ].join("");
    wireHubForms();
  }

  function wireSearch(input, picks, hidden) {
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        picks.innerHTML = "";
        hidden.value = "";
        if (q.length < 2) return;
        try {
          const data = await fetchJson(`/api/theme-hub/cabinets?q=${encodeURIComponent(q)}`);
          picks.innerHTML = (data.items || [])
            .map(
              (item) =>
                `<li><button type="button" data-id="${esc(item.reference_key)}">${esc(
                  item.cabinet_name
                )} · ${esc(item.reference_key)}</button></li>`
            )
            .join("");
          picks.querySelectorAll("button").forEach((btn) => {
            btn.addEventListener("click", () => {
              hidden.value = btn.getAttribute("data-id");
              input.value = btn.textContent;
              picks.innerHTML = "";
            });
          });
        } catch (err) {
          showError(err.message || String(err));
        }
      }, 250);
    });
  }

  function wireHubForms() {
    document.querySelectorAll(".th-picks").forEach((picks) => {
      const form = picks.closest("form");
      const input = form.querySelector("[name=cabinet_q]");
      const hidden = form.querySelector("[name=cabinet_id]");
      if (input && hidden) wireSearch(input, picks, hidden);
    });
    const par = document.getElementById("hub-par");
    if (par) {
      par.addEventListener("submit", async (event) => {
        event.preventDefault();
        await postDoc(par, "par");
      });
    }
    const lab = document.getElementById("hub-lab");
    if (lab) {
      lab.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fd = new FormData();
        fd.set("doc_kind", "lab");
        fd.set("file", lab.file.files[0]);
        fd.set("jurisdiction_code", lab.jurisdiction_code.value);
        fd.set("cabinet_id", lab.cabinet_id.value);
        if (lab.software_ref.value) {
          fd.set("software_ref", lab.software_ref.value);
          if (lab.cabinet_id.value) fd.set("associate_cabinet", "1");
        } else {
          fd.set("new_software_id", lab.new_software_id.value.trim());
        }
        await send(fd);
      });
    }
    const slick = document.getElementById("hub-slick");
    if (slick) {
      slick.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fd = new FormData();
        fd.set("doc_kind", "slick");
        fd.set("file", slick.file.files[0]);
        if (slick.cabinet_id.value) fd.set("cabinet_id", slick.cabinet_id.value);
        await send(fd);
      });
    }
    const assoc = document.getElementById("hub-cabinet");
    if (assoc) {
      assoc.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fd = new FormData();
        fd.set("cabinet_id", assoc.cabinet_id.value);
        try {
          showError("");
          payload.software = (
            await fetchJson(
              `/api/theme-hub/${encodeURIComponent(themeId)}/software/${encodeURIComponent(
                assoc.software_ref.value
              )}/cabinets`,
              { method: "POST", body: fd }
            )
          ).software;
          renderHub();
        } catch (err) {
          showError(err.message || String(err));
        }
      });
    }
    const created = document.getElementById("hub-new-software");
    if (created) {
      created.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fd = new FormData();
        fd.set("software_id", created.software_id.value.trim());
        fd.set("cabinet_id", created.cabinet_id.value);
        try {
          showError("");
          payload.software = (
            await fetchJson(`/api/theme-hub/${encodeURIComponent(themeId)}/software`, {
              method: "POST",
              body: fd,
            })
          ).software;
          renderHub();
        } catch (err) {
          showError(err.message || String(err));
        }
      });
    }
  }

  async function postDoc(form, kind) {
    const fd = new FormData();
    fd.set("doc_kind", kind);
    fd.set("file", form.file.files[0]);
    fd.set("jurisdiction_code", form.jurisdiction_code.value || "");
    await send(fd);
  }

  async function send(fd) {
    try {
      showError("");
      const data = await fetchJson(`/api/theme-hub/${encodeURIComponent(themeId)}/documents`, {
        method: "POST",
        body: fd,
      });
      payload.documents = data.documents;
      if (data.software) payload.software = data.software;
      renderHub();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  async function init() {
    if (!themeId) {
      els.loading.textContent = "Open Theme hub with a theme id.";
      return;
    }
    if (addMode) document.body.classList.add("th-add-only");
    try {
      const q = new URLSearchParams();
      if (params.get("proposal")) q.set("proposal", params.get("proposal"));
      if (params.get("unit")) q.set("unit", params.get("unit"));
      payload = await fetchJson(`/api/theme-hub/${encodeURIComponent(themeId)}?${q}`);
      els.title.textContent = payload.theme.theme_name || themeId;
      els.id.textContent = payload.theme.reference_key;
      els.meta.textContent = payload.theme.vendor_name || "";
      els.loading.hidden = true;
      els.body.hidden = false;
      if (addMode) renderAdd();
      else renderHub();
    } catch (err) {
      els.loading.hidden = true;
      showError(err.message || String(err));
    }
  }

  window.ThemeHub = { init };
})();
