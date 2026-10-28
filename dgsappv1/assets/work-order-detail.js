/* Shared work-order detail drawer (Field + Work Orders). */
(function () {
  "use strict";

  let selectedWo = null;
  let onCloseCb = null;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(n, digits) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString(undefined, {
      maximumFractionDigits: digits == null ? 1 : digits,
      minimumFractionDigits: 0,
    });
  }

  function fmtMoney(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function statusLabel(row) {
    const parts = [row.stattype || null, row.workstatus ? `(${row.workstatus})` : null].filter(
      Boolean
    );
    return parts.join(" ") || "—";
  }

  function hubCell(href, text) {
    const label = text == null || text === "" ? "—" : String(text);
    if (!href) return esc(label);
    return `<a class="dgs-field-asset" href="${esc(href)}">${esc(label)}</a>`;
  }

  function serialHtml(row) {
    const href =
      row.asset_id && window.DGSAssetNav ? DGSAssetNav.hubHref(row.asset_id) : "";
    return hubCell(href, row.serial);
  }

  function propertyHtml(row) {
    const href =
      row.casino_id && window.DGSCasinoNav ? DGSCasinoNav.hubHref(row.casino_id) : "";
    return hubCell(href, row.property);
  }

  function vendorHtml(row) {
    const href =
      row.vendor_id && window.DGSVendorNav ? DGSVendorNav.hubHref(row.vendor_id) : "";
    return hubCell(href, row.vendor);
  }

  function cabinetHtml(row) {
    const href =
      row.vendor_id && row.cabinet_id && window.DGSVendorNav
        ? DGSVendorNav.hubHref(row.vendor_id, row.cabinet_id)
        : "";
    return hubCell(href, row.cabinet);
  }

  function themeHtml(row) {
    const href =
      row.theme_id && window.DGSThemeNav ? DGSThemeNav.hubHref(row.theme_id) : "";
    return hubCell(href, row.theme);
  }

  async function fetchJson(path, options) {
    const opts = options || {};
    let res;
    try {
      res = await fetch(`${DGSAuth.apiBase()}${path}`, {
        method: opts.method || "GET",
        headers: {
          ...DGSAuth.authHeaders(),
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
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
    if (res.status === 204) return null;
    return res.json();
  }

  function ensureDrawer() {
    let backdrop = document.getElementById("wo-detail-backdrop");
    let drawer = document.getElementById("wo-detail-drawer");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "wo-detail-backdrop";
      backdrop.className = "dgs-capacity-drawer-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", close);
    }
    if (!drawer) {
      drawer = document.createElement("aside");
      drawer.id = "wo-detail-drawer";
      drawer.className = "dgs-capacity-drawer is-wo-detail";
      drawer.setAttribute("aria-label", "Work order detail");
      document.body.appendChild(drawer);
      drawer.addEventListener("click", (event) => {
        if (event.target.closest("#wo-detail-close")) close();
      });
    }
    return { backdrop, drawer };
  }

  function field(label, valueHtml) {
    if (valueHtml == null || valueHtml === "" || valueHtml === "—") return "";
    return `<div class="dgs-wo-field"><span class="dgs-wo-field-label">${esc(
      label
    )}</span><div class="dgs-wo-field-value">${valueHtml}</div></div>`;
  }

  function textField(label, value) {
    if (value == null || value === "") return "";
    return field(label, esc(value));
  }

  function sourceLabel(source) {
    const raw = String(source || "").trim().toUpperCase();
    if (raw === "EMAINT") return "eMaint";
    if (raw === "APPSHEET") return "AppSheet";
    return source || "—";
  }

  function partRequestStatusLabel(row) {
    const s2 = (row.status_2 || "").trim();
    const s1 = (row.status || "").trim();
    if (s2 && s1 && s2.toLowerCase() !== s1.toLowerCase()) {
      return `${s1} · ${s2}`;
    }
    return s2 || s1 || "—";
  }

  function partRequestsListHtml(listed) {
    const requests = (listed && listed.requests) || listed || [];
    const hidden = (listed && listed.hidden_done) || 0;
    if (!requests.length) {
      const note = hidden
        ? `No active part requests (${hidden} completed/cancelled hidden).`
        : "No part requests on this work order yet.";
      return `<p class="dgs-field-empty">${esc(note)}</p>`;
    }
    const rows = requests
      .map((row) => {
        return `<tr>
          <td>${esc(row.tech_order || "—")}</td>
          <td>${esc(row.dgs_part || "—")}${
          row.part_description
            ? `<div class="dgs-wo-mat-descrip">${esc(row.part_description)}</div>`
            : ""
        }</td>
          <td class="dgs-field-num">${esc(row.quantity || "—")}</td>
          <td>${esc(partRequestStatusLabel(row))}</td>
          <td>${esc(row.date || "—")}</td>
        </tr>`;
      })
      .join("");
    const foot = hidden
      ? `<p class="dgs-wo-section-note">${esc(
          `${hidden} completed/cancelled request${hidden === 1 ? "" : "s"} hidden.`
        )}</p>`
      : "";
    return `${foot}<div class="dgs-field-scroll"><table class="dgs-field-table">
      <thead><tr><th>Order #</th><th>Part</th><th class="dgs-field-num">Qty</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function partRequestContextHtml(data) {
    const pr = data.part_requests || {};
    if (!pr.can_write || !pr.wo_ready) return "";
    const d = pr.defaults || {};
    const contextFields = [
      textField("Tech Name", d.tech_name),
      textField("Job Type", d.job_type),
      textField("Asset ID", d.asset_id),
      textField("Work Order #", d.wo || data.wo),
      textField("Project #", d.project_no),
      textField("WO Type", d.wo_type),
    ]
      .filter(Boolean)
      .join("");
    return `<div class="dgs-wo-fields dgs-wo-pr-context">${
      contextFields || `<p class="dgs-field-empty">No order context available.</p>`
    }</div>`;
  }

  function partRequestAddControlsHtml(data) {
    const pr = data.part_requests || {};
    if (!pr.can_write) return "";
    if (!pr.wo_ready) {
      return `<p class="dgs-field-empty">Part requests need a 5-digit eMaint WO # on this order.</p>`;
    }
    const d = pr.defaults || {};
    const shipTo = d.ship_to_category || "Primary Location";
    const shipOpts = ["Primary Location", "Casino", "Other"]
      .map(
        (opt) =>
          `<option value="${esc(opt)}"${opt === shipTo ? " selected" : ""}>${esc(opt)}</option>`
      )
      .join("");
    const sendTo = esc(d.send_to_address || "");
    const importanceRequired = (d.job_type || "Repair") === "Repair";
    return `
      <div class="dgs-wo-pr-toolbar">
        <button type="button" class="dgs-v2-btn dgs-v2-btn-primary" id="wo-pr-open">
          Add part request
        </button>
      </div>
      <div class="dgs-wo-part-request dgs-wo-pr-card" id="wo-part-request" hidden
        data-tech-name="${esc(d.tech_name || "")}"
        data-job-type="${esc(d.job_type || "Repair")}"
        data-asset-id="${esc(d.asset_id || "")}"
        data-tech-address="${esc(d.tech_address || "")}"
        data-casino-address="${esc(d.casino_address || "")}">
        <h4 class="dgs-wo-pr-card-title">Parts Order</h4>
        <p class="dgs-wo-section-note">Fill the fields inventory still needs. Context above is locked from this work order.</p>
        <div class="dgs-wo-fields">
          <label class="dgs-wo-field">
            <span class="dgs-wo-field-label">Importance${
              importanceRequired
                ? ` <span class="dgs-wo-req" aria-hidden="true">*</span>`
                : ""
            }</span>
            <select id="wo-pr-importance" class="dgs-v2-input"${
              importanceRequired ? " required" : ""
            }>
              <option value="">—</option>
              <option>Cabinet Down - Urgent</option>
              <option>Cosmetic - High Priority</option>
              <option>Cosmetic - Low Priority</option>
            </select>
          </label>
          <label class="dgs-wo-field">
            <span class="dgs-wo-field-label">Part search</span>
            <input type="search" id="wo-pr-search" class="dgs-v2-input" placeholder="Part # or name" autocomplete="off" />
          </label>
          <div id="wo-pr-results" class="dgs-wo-pr-results" hidden></div>
          <label class="dgs-wo-field">
            <span class="dgs-wo-field-label">DGS Part #</span>
            <input type="text" id="wo-pr-part" class="dgs-v2-input" required />
          </label>
          <label class="dgs-wo-field">
            <span class="dgs-wo-field-label">Description <span class="dgs-wo-req" aria-hidden="true">*</span></span>
            <input type="text" id="wo-pr-description" class="dgs-v2-input" required />
          </label>
          <label class="dgs-wo-field">
            <span class="dgs-wo-field-label">Quantity <span class="dgs-wo-req" aria-hidden="true">*</span></span>
            <input type="number" id="wo-pr-qty" class="dgs-v2-input" min="1" step="1" value="1" required />
          </label>
          <label class="dgs-wo-field">
            <span class="dgs-wo-field-label">Ship To Category <span class="dgs-wo-req" aria-hidden="true">*</span></span>
            <select id="wo-pr-ship-to" class="dgs-v2-input" required>
              ${shipOpts}
            </select>
          </label>
          <label class="dgs-wo-field" id="wo-pr-send-to-wrap">
            <span class="dgs-wo-field-label">Send to Address</span>
            <input type="text" id="wo-pr-send-to" class="dgs-v2-input" value="${sendTo}" />
          </label>
          <label class="dgs-wo-field">
            <span class="dgs-wo-field-label">Notes</span>
            <textarea id="wo-pr-notes" class="dgs-v2-input" rows="2"></textarea>
          </label>
          <div class="dgs-wo-field" id="wo-pr-pics-wrap">
            <span class="dgs-wo-field-label">Pic <span class="dgs-wo-req" aria-hidden="true">*</span></span>
            <div
              id="wo-pr-photo-banner"
              class="dgs-wo-pr-photo-banner is-idle"
              role="status"
              aria-live="polite"
            >
              Select a part to see if a picture is required.
            </div>
            <input type="file" id="wo-pr-pics" class="dgs-v2-input" accept="image/*" multiple />
            <p class="dgs-wo-section-note" id="wo-pr-pics-note">First pic required when the part has no catalog photo. Up to 3.</p>
            <div id="wo-pr-pics-preview" class="dgs-wo-pr-pics-preview" hidden></div>
          </div>
        </div>
        <p class="dgs-wo-pr-status" id="wo-pr-status" hidden></p>
        <div class="dgs-wo-pr-actions">
          <button type="button" class="dgs-v2-btn dgs-v2-btn-primary" id="wo-pr-submit">Submit request</button>
          <button type="button" class="dgs-v2-btn" id="wo-pr-cancel">Cancel</button>
        </div>
      </div>`;
  }

  function bindPartRequestUi(drawer, data) {
    const pr = data.part_requests || {};
    if (!pr.can_write || !pr.wo_ready) return;
    const wo = data.wo;
    const defaults = pr.defaults || {};
    const openBtn = drawer.querySelector("#wo-pr-open");
    const form = drawer.querySelector("#wo-part-request");
    const cancelBtn = drawer.querySelector("#wo-pr-cancel");
    const searchInput = drawer.querySelector("#wo-pr-search");
    const results = drawer.querySelector("#wo-pr-results");
    const partInput = drawer.querySelector("#wo-pr-part");
    const descInput = drawer.querySelector("#wo-pr-description");
    const shipToSelect = drawer.querySelector("#wo-pr-ship-to");
    const sendToInput = drawer.querySelector("#wo-pr-send-to");
    const statusEl = drawer.querySelector("#wo-pr-status");
    const submitBtn = drawer.querySelector("#wo-pr-submit");
    const picsInput = drawer.querySelector("#wo-pr-pics");
    const picsWrap = drawer.querySelector("#wo-pr-pics-wrap");
    const photoBanner = drawer.querySelector("#wo-pr-photo-banner");
    const picsPreview = drawer.querySelector("#wo-pr-pics-preview");
    let searchTimer = null;
    let partLookupTimer = null;
    let selectedHasPhoto = null;
    let picDataUrls = [];

    function lockedTechName() {
      return (
        (form && form.getAttribute("data-tech-name")) ||
        defaults.tech_name ||
        ""
      ).trim();
    }

    function lockedJobType() {
      return (
        (form && form.getAttribute("data-job-type")) ||
        defaults.job_type ||
        "Repair"
      ).trim();
    }

    function lockedAssetId() {
      return (
        (form && form.getAttribute("data-asset-id")) ||
        defaults.asset_id ||
        ""
      ).trim();
    }

    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.hidden = !msg;
      statusEl.textContent = msg || "";
      statusEl.classList.toggle("is-error", !!isError);
    }

    function syncSendToAddress() {
      if (!shipToSelect || !sendToInput || !form) return;
      const cat = shipToSelect.value;
      const techAddr = form.getAttribute("data-tech-address") || "";
      const casinoAddr = form.getAttribute("data-casino-address") || "";
      if (cat === "Primary Location") sendToInput.value = techAddr;
      else if (cat === "Casino") sendToInput.value = casinoAddr;
      // Other: leave whatever the tech typed
    }

    function setPhotoBanner(state, title, detail) {
      if (!photoBanner) return;
      photoBanner.classList.remove("is-idle", "is-required", "is-optional", "is-loading");
      photoBanner.classList.add(state || "is-idle");
      photoBanner.innerHTML = `<strong>${esc(title)}</strong>${
        detail ? `<span>${esc(detail)}</span>` : ""
      }`;
      if (picsWrap) {
        picsWrap.classList.toggle("is-photo-required", state === "is-required");
        picsWrap.classList.toggle("is-photo-optional", state === "is-optional");
      }
      if (picsInput) {
        if (state === "is-required") picsInput.setAttribute("required", "required");
        else picsInput.removeAttribute("required");
      }
    }

    function setPhotoRequired(required) {
      if (required === null || required === undefined) {
        selectedHasPhoto = null;
        setPhotoBanner(
          "is-idle",
          "Select a part to see if a picture is required.",
          "Catalog Photo decides whether Pics are required."
        );
        return;
      }
      selectedHasPhoto = !required;
      if (required) {
        setPhotoBanner(
          "is-required",
          "Photo required",
          "This part has no catalog photo. Attach at least 1 picture before submitting."
        );
      } else {
        setPhotoBanner(
          "is-optional",
          "Catalog photo on file",
          "Pictures are optional for this part (up to 3)."
        );
      }
    }

    async function lookupPartPhoto(partId) {
      const id = (partId || "").trim();
      if (!id) {
        setPhotoRequired(null);
        return;
      }
      setPhotoBanner("is-loading", "Checking catalog photo…", `Looking up part ${id}.`);
      try {
        const data = await fetchJson(
          `/api/work-orders/part-catalog/item?id=${encodeURIComponent(id)}`
        );
        if (!data || data.found === false) {
          setPhotoBanner(
            "is-required",
            "Photo required",
            "Part not found in catalog (or has no Photo). Attach at least 1 picture."
          );
          selectedHasPhoto = false;
          return;
        }
        if (descInput && !descInput.value.trim() && data.name) {
          descInput.value = data.name;
        }
        setPhotoRequired(!!data.photo_required);
      } catch (err) {
        setPhotoBanner(
          "is-required",
          "Could not verify catalog photo",
          "Attach a picture to be safe, or retry after the error clears."
        );
        selectedHasPhoto = false;
        setStatus(err.message || String(err), true);
      }
    }

    function clearPics() {
      picDataUrls = [];
      if (picsInput) picsInput.value = "";
      if (picsPreview) {
        picsPreview.hidden = true;
        picsPreview.innerHTML = "";
      }
      setPhotoRequired(null);
    }

    function readFilesAsDataUrls(fileList) {
      const files = Array.from(fileList || []).slice(0, 3);
      return Promise.all(
        files.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
              reader.readAsDataURL(file);
            })
        )
      );
    }

    async function onPicsChange() {
      if (!picsInput || !picsInput.files || !picsInput.files.length) {
        picDataUrls = [];
        if (picsPreview) {
          picsPreview.hidden = true;
          picsPreview.innerHTML = "";
        }
        return;
      }
      try {
        picDataUrls = await readFilesAsDataUrls(picsInput.files);
        if (picsPreview) {
          picsPreview.hidden = false;
          picsPreview.innerHTML = picDataUrls
            .map(
              (src) =>
                `<img class="dgs-wo-pr-pic-thumb" src="${esc(src)}" alt="Part picture preview" />`
            )
            .join("");
        }
      } catch (err) {
        picDataUrls = [];
        setStatus(err.message || String(err), true);
      }
    }

    function showForm() {
      if (!form) return;
      form.hidden = false;
      if (openBtn) openBtn.hidden = true;
      setStatus("", false);
      syncSendToAddress();
      const importance = drawer.querySelector("#wo-pr-importance");
      if (importance) importance.focus();
      else if (searchInput) searchInput.focus();
    }

    function hideForm() {
      if (!form) return;
      form.hidden = true;
      if (openBtn) openBtn.hidden = false;
      setStatus("", false);
      if (results) {
        results.hidden = true;
        results.innerHTML = "";
      }
      if (searchInput) searchInput.value = "";
      if (partInput) partInput.value = "";
      if (descInput) descInput.value = "";
      const qty = drawer.querySelector("#wo-pr-qty");
      if (qty) qty.value = "1";
      const importance = drawer.querySelector("#wo-pr-importance");
      if (importance) importance.value = "";
      if (shipToSelect) shipToSelect.value = defaults.ship_to_category || "Primary Location";
      syncSendToAddress();
      const notesEl = drawer.querySelector("#wo-pr-notes");
      if (notesEl) notesEl.value = "";
      clearPics();
    }

    async function refreshList() {
      const listHost = drawer.querySelector("#wo-pr-list");
      if (!listHost) return;
      const listed = await fetchJson(
        `/api/work-orders/${encodeURIComponent(wo)}/part-requests`
      );
      listHost.innerHTML = partRequestsListHtml(listed);
    }

    async function runSearch() {
      const q = (searchInput && searchInput.value) || "";
      if (q.trim().length < 2) {
        if (results) {
          results.hidden = true;
          results.innerHTML = "";
        }
        return;
      }
      if (!results) return;
      results.hidden = false;
      results.innerHTML = `<p class="dgs-field-empty">Searching parts…</p>`;
      setStatus("", false);
      try {
        const payload = await fetchJson(
          `/api/work-orders/part-catalog/search?q=${encodeURIComponent(q.trim())}&limit=25`
        );
        const parts = (payload && payload.parts) || [];
        if (!parts.length) {
          results.innerHTML = `<p class="dgs-field-empty">No parts matched “${esc(
            q.trim()
          )}”. Try fewer words or a part #.</p>`;
          return;
        }
        results.innerHTML = parts
          .map((p) => {
            const stock =
              p.stock != null && p.stock !== "" ? ` · stock ${p.stock}` : "";
            const badge = p.photo_required
              ? `<span class="dgs-wo-pr-hit-badge is-required">Photo required</span>`
              : `<span class="dgs-wo-pr-hit-badge is-optional">Catalog photo</span>`;
            const label = [p.item, p.name, p.mfr].filter(Boolean).join(" · ");
            return `<button type="button" class="dgs-wo-pr-hit" data-item="${esc(
              p.item
            )}" data-name="${esc(p.name || "")}" data-photo-required="${
              p.photo_required ? "1" : "0"
            }"><span class="dgs-wo-pr-hit-main">${esc(
              label
            )} ${badge}</span><span class="dgs-wo-pr-hit-meta">${esc(
              stock
            )}</span></button>`;
          })
          .join("");
      } catch (err) {
        results.innerHTML = `<p class="error-box">${esc(
          err.message || String(err)
        )}</p>`;
        setStatus(err.message || String(err), true);
      }
    }

    if (openBtn) openBtn.addEventListener("click", showForm);
    if (cancelBtn) cancelBtn.addEventListener("click", hideForm);
    if (picsInput) picsInput.addEventListener("change", onPicsChange);
    if (shipToSelect) shipToSelect.addEventListener("change", syncSendToAddress);
    setPhotoRequired(null);

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, 350);
      });
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          clearTimeout(searchTimer);
          runSearch();
        }
      });
    }
    if (partInput) {
      partInput.addEventListener("change", () => {
        clearTimeout(partLookupTimer);
        lookupPartPhoto(partInput.value);
      });
      partInput.addEventListener("input", () => {
        clearTimeout(partLookupTimer);
        partLookupTimer = setTimeout(() => lookupPartPhoto(partInput.value), 450);
      });
    }
    if (results) {
      results.addEventListener("click", (event) => {
        const btn = event.target.closest(".dgs-wo-pr-hit");
        if (!btn || !partInput) return;
        partInput.value = btn.getAttribute("data-item") || "";
        const name = btn.getAttribute("data-name") || "";
        if (descInput && name) descInput.value = name;
        setPhotoRequired(btn.getAttribute("data-photo-required") === "1");
        results.hidden = true;
        results.innerHTML = "";
      });
    }
    if (submitBtn) {
      submitBtn.addEventListener("click", async () => {
        const techName = lockedTechName();
        const jobType = lockedJobType();
        const assetId = lockedAssetId();
        const dgsPart = (partInput && partInput.value) || "";
        const description = ((descInput && descInput.value) || "").trim();
        const qty = Number((drawer.querySelector("#wo-pr-qty") || {}).value || 0);
        const importance = (drawer.querySelector("#wo-pr-importance") || {}).value || "";
        const shipTo = ((shipToSelect && shipToSelect.value) || "").trim();
        const shipAddress = ((sendToInput && sendToInput.value) || "").trim();
        const notes = (drawer.querySelector("#wo-pr-notes") || {}).value || "";
        if (!techName) {
          setStatus("Tech Name is missing from order context.", true);
          return;
        }
        if (jobType === "Repair" && !assetId) {
          setStatus("Asset ID is required for Repair — this WO has no serial.", true);
          return;
        }
        if (jobType === "Repair" && !importance) {
          setStatus("Importance is required.", true);
          drawer.querySelector("#wo-pr-importance")?.focus();
          return;
        }
        if (!dgsPart.trim()) {
          setStatus("Choose a DGS Part #.", true);
          return;
        }
        if (!description) {
          setStatus("Description is required.", true);
          if (descInput) descInput.focus();
          return;
        }
        if (!qty || qty <= 0) {
          setStatus("Quantity is required.", true);
          return;
        }
        if (!shipTo) {
          setStatus("Ship To Category is required.", true);
          return;
        }
        if (selectedHasPhoto === null) {
          await lookupPartPhoto(dgsPart);
        }
        if (selectedHasPhoto === false && !picDataUrls.length) {
          setStatus("Pic is required — this part has no catalog photo.", true);
          if (picsInput) picsInput.focus();
          return;
        }
        submitBtn.disabled = true;
        setStatus("Submitting…", false);
        try {
          const created = await fetchJson(
            `/api/work-orders/${encodeURIComponent(wo)}/part-requests`,
            {
              method: "POST",
              body: {
                dgs_part: dgsPart.trim(),
                quantity: qty,
                tech_name: techName,
                job_type: jobType,
                part_description: description,
                importance: importance || null,
                ship_to_category: shipTo,
                ship_to_address: shipAddress || null,
                notes: notes || null,
                pics: picDataUrls.length ? picDataUrls : null,
              },
            }
          );
          await refreshList();
          hideForm();
          const toolbar = drawer.querySelector(".dgs-wo-pr-toolbar");
          if (toolbar) {
            drawer.querySelector("#wo-pr-flash")?.remove();
            const flash = document.createElement("p");
            flash.id = "wo-pr-flash";
            flash.className = "dgs-wo-pr-status";
            flash.textContent = `Submitted ${created.tech_order || "request"} for part ${
              created.dgs_part
            }.`;
            toolbar.prepend(flash);
            setTimeout(() => flash.remove(), 5000);
          }
        } catch (err) {
          setStatus(err.message || String(err), true);
        } finally {
          submitBtn.disabled = false;
        }
      });
    }
  }

  function materialsHtml(materials, total) {
    if (!materials || !materials.length) {
      return `<p class="dgs-field-empty">No charge lines.</p>`;
    }
    const head =
      "<tr><th>Item</th><th class='dgs-field-num'>Qty</th><th class='dgs-field-num'>Unit</th><th class='dgs-field-num'>Ext</th><th>Source</th><th>Status</th></tr>";
    const body = materials
      .map((row) => {
        const qty =
          row.qty_issued != null && Number(row.qty_issued) !== 0
            ? row.qty_issued
            : row.qty_requested;
        const meta = [row.mfr, row.mfrpartno].filter(Boolean).join(" · ");
        const descrip = row.descrip
          ? `<div class="dgs-wo-mat-descrip">${esc(row.descrip)}</div>`
          : "";
        const metaHtml = meta ? `<div class="dgs-wo-mat-meta">${esc(meta)}</div>` : "";
        return `<tr>
          <td><div class="dgs-wo-mat-item">${esc(row.item || "—")}</div>${descrip}${metaHtml}</td>
          <td class="dgs-field-num">${esc(fmtNum(qty, 2))}</td>
          <td class="dgs-field-num">${esc(fmtMoney(row.unit_cost))}</td>
          <td class="dgs-field-num">${esc(fmtMoney(row.ext_cost))}</td>
          <td>${esc(sourceLabel(row.source))}</td>
          <td>${esc(row.status || "—")}</td>
        </tr>`;
      })
      .join("");
    const foot =
      total == null
        ? ""
        : `<tfoot><tr><td colspan="3">Total</td><td class="dgs-field-num">${esc(
            fmtMoney(total)
          )}</td><td colspan="2"></td></tr></tfoot>`;
    const cards = materials
      .map((row) => {
        const qty =
          row.qty_issued != null && Number(row.qty_issued) !== 0
            ? row.qty_issued
            : row.qty_requested;
        const meta = [row.mfr, row.mfrpartno].filter(Boolean).join(" · ");
        const source = sourceLabel(row.source);
        const status = row.status || "";
        const lineMeta = [source, status].filter(Boolean).join(" · ");
        return `<article class="dgs-wo-card dgs-wo-mat-card">
          <div class="dgs-wo-card-top">
            <span class="dgs-wo-card-wo">${esc(row.item || "—")}</span>
            <span class="dgs-wo-card-date">${esc(fmtMoney(row.ext_cost))}</span>
          </div>
          ${
            row.descrip
              ? `<div class="dgs-wo-card-property">${esc(row.descrip)}</div>`
              : ""
          }
          ${meta ? `<div class="dgs-wo-card-meta">${esc(meta)}</div>` : ""}
          <div class="dgs-wo-mat-card-costs">
            <span>Qty ${esc(fmtNum(qty, 2))}</span>
            <span>Unit ${esc(fmtMoney(row.unit_cost))}</span>
          </div>
          ${lineMeta ? `<div class="dgs-wo-card-meta">${esc(lineMeta)}</div>` : ""}
        </article>`;
      })
      .join("");
    const totalCard =
      total == null
        ? ""
        : `<div class="dgs-wo-mat-total">Total <strong>${esc(fmtMoney(total))}</strong></div>`;
    return `<div class="dgs-wo-mat-wrap">
      <div class="dgs-wo-desktop-table">
        <div class="dgs-field-scroll">
          <table class="dgs-field-table dgs-wo-mat-table"><thead>${head}</thead><tbody>${body}</tbody>${foot}</table>
        </div>
      </div>
      <div class="dgs-wo-card-list dgs-wo-mat-cards" aria-label="Charge lines">${cards}${totalCard}</div>
    </div>`;
  }

  function close() {
    const wo = selectedWo;
    selectedWo = null;
    document.body.classList.remove("wo-detail-open");
    const drawer = document.getElementById("wo-detail-drawer");
    if (drawer) {
      drawer.innerHTML = "";
      drawer.classList.remove("is-wo-detail");
    }
    document.querySelectorAll(".dgs-wo-row.is-active, .dgs-field-wo-row.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
    const cb = onCloseCb;
    onCloseCb = null;
    if (typeof cb === "function") cb(wo);
  }

  async function open(wo, options) {
    if (!wo || !window.DGSAuth) return;
    const opts = options || {};
    onCloseCb = typeof opts.onClose === "function" ? opts.onClose : null;
    const { drawer } = ensureDrawer();
    selectedWo = wo;
    document.querySelectorAll(".dgs-wo-row.is-active, .dgs-field-wo-row.is-active").forEach((el) => {
      el.classList.toggle("is-active", el.getAttribute("data-wo") === wo);
    });
    document.body.classList.add("wo-detail-open");
    drawer.classList.add("is-wo-detail");
    drawer.innerHTML = `<div class="dgs-capacity-drawer-inner"><p class="dgs-v2-loading">Loading work order…</p></div>`;
    try {
      const data = await fetchJson(`/api/work-orders/${encodeURIComponent(wo)}`);
      const badges = [];
      if (data.moneypenny) badges.push(`<span class="dgs-wo-badge">Moneypenny</span>`);
      if (data.priority) badges.push(`<span class="dgs-wo-badge is-priority">P${esc(data.priority)}</span>`);
      if (data.wo_type) badges.push(`<span class="dgs-wo-badge">${esc(data.wo_type)}</span>`);
      drawer.innerHTML = `
        <div class="dgs-capacity-drawer-head">
          <div>
            <p class="dgs-capacity-drawer-kicker">Work order</p>
            <h2>${esc(data.wo || wo)}</h2>
            <p class="dgs-capacity-drawer-meta">${esc(statusLabel(data))} · ${esc(
        data.date_wo || "—"
      )}</p>
            <div class="dgs-wo-badges">${badges.join("")}</div>
          </div>
          <button type="button" class="dgs-v2-btn" id="wo-detail-close">Close</button>
        </div>
        <div class="dgs-capacity-drawer-body dgs-wo-detail-body">
          <section class="dgs-wo-section">
            <h3>Summary</h3>
            <div class="dgs-wo-fields">
              ${textField("Brief", data.brief_desc)}
              ${field("Property", propertyHtml(data))}
              ${field("Serial", serialHtml(data))}
              ${field("Vendor", vendorHtml(data))}
              ${field("Cabinet", cabinetHtml(data))}
              ${field("Theme", themeHtml(data))}
              ${textField("Assigned to", data.assignto)}
              ${textField("Project #", data.project_no)}
              ${textField("Priority", data.priority)}
              ${textField("Problem type", data.probtype)}
            </div>
          </section>
          <section class="dgs-wo-section">
            <h3>Requestor</h3>
            <div class="dgs-wo-fields">
              ${textField("Name", data.requestor) || `<p class="dgs-field-empty">No requestor on file.</p>`}
              ${textField("Telephone", data.req_tele)}
              ${textField("Game OOS", data.game_oos)}
              ${textField("Asset down", data.asst_dwn)}
              ${textField("In service", data.in_serv)}
            </div>
          </section>
          <section class="dgs-wo-section">
            <h3>Downtime & hours</h3>
            <div class="dgs-wo-fields">
              ${textField("Down start", data.downstart)}
              ${textField("Down end", data.downend)}
              ${textField("Downtime (days)", data.hours == null ? null : fmtNum(data.hours))}
              ${textField("Actual hours", data.act_hours == null ? null : fmtNum(data.act_hours))}
              ${textField("Work man hours", data.workmhours == null ? null : fmtNum(data.workmhours))}
              ${textField("Drive time", data.drivetime == null ? null : fmtNum(data.drivetime))}
            </div>
          </section>
          <section class="dgs-wo-section">
            <h3>Work description</h3>
            ${
              data.work_desc
                ? `<pre class="dgs-wo-pre">${esc(data.work_desc)}</pre>`
                : `<p class="dgs-field-empty">No work description.</p>`
            }
          </section>
          ${
            data.comments
              ? `<section class="dgs-wo-section"><h3>Comments</h3><pre class="dgs-wo-pre">${esc(
                  data.comments
                )}</pre></section>`
              : ""
          }
          <section class="dgs-wo-section">
            <h3>Materials</h3>
            <p class="dgs-wo-section-note">Charge lines from eMaint and AppSheet.</p>
            ${materialsHtml(data.materials, data.materials_total)}
          </section>
          <section class="dgs-wo-section" id="wo-part-requests-section">
            <div class="dgs-wo-section-head">
              <h3>Part requests</h3>
            </div>
            <p class="dgs-wo-section-note">Sent to inventory (AppSheet Part Orders). Pilot: Paul + Kevin.</p>
            ${partRequestContextHtml(data)}
            <div id="wo-pr-list"><p class="dgs-v2-loading">Loading requests…</p></div>
            ${partRequestAddControlsHtml(data)}
          </section>
          <section class="dgs-wo-section">
            <h3>Record</h3>
            <div class="dgs-wo-fields">
              ${textField("Reference", data.reference_key)}
              ${textField("Bank / location", [data.bank, data.location].filter(Boolean).join(" · ") || null)}
              ${textField("Scheduled", data.sch_date)}
              ${textField("Completed", data.date_cmpl)}
              ${textField("Closed by", data.clsdby)}
              ${textField("Added", [data.adduser, data.adddate].filter(Boolean).join(" · ") || null)}
              ${textField("Edited", [data.edituser, data.editdate].filter(Boolean).join(" · ") || null)}
            </div>
          </section>
        </div>`;
      bindPartRequestUi(drawer, data);
      const listHost = drawer.querySelector("#wo-pr-list");
      if (listHost && data.wo) {
        fetchJson(`/api/work-orders/${encodeURIComponent(data.wo)}/part-requests`)
          .then((listed) => {
            listHost.innerHTML = partRequestsListHtml(listed);
          })
          .catch((err) => {
            listHost.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
          });
      }
    } catch (err) {
      drawer.innerHTML = `
        <div class="dgs-capacity-drawer-head">
          <h2>Work order</h2>
          <button type="button" class="dgs-v2-btn" id="wo-detail-close">Close</button>
        </div>
        <div class="dgs-capacity-drawer-body"><p class="error-box">${esc(
          err.message || err
        )}</p></div>`;
    }
  }

  function isOpen() {
    return !!selectedWo && document.body.classList.contains("wo-detail-open");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("wo-detail-open")) {
      close();
    }
  });

  window.DGSWorkOrderDetail = { open, close, isOpen };
})();
