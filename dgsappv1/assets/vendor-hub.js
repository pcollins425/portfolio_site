(function () {
  "use strict";

  const API_BASE = (window.DGS ? DGS.apiBase() : "").replace(/\/$/, "") ||
    new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") ||
    "https://api.collinsmediallc.com";

  const params = new URLSearchParams(window.location.search);
  const vendorId = (params.get("id") || "").trim();

  const state = {
    mediaUrls: {},
    data: null,
    agreements: [],
    view: params.get("view") === "agreements" ? "agreements" : "catalog",
    agreementId: (params.get("agreement") || "").trim(),
    documentId: "",
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    hubBody: document.getElementById("hub-body"),
    hubLoading: document.getElementById("hub-loading"),
    hubGrid: document.getElementById("hub-grid"),
    hubLogo: document.getElementById("hub-logo"),
    captionTitle: document.getElementById("caption-title"),
    captionId: document.getElementById("caption-id"),
    captionMeta: document.getElementById("caption-meta"),
    btnBack: document.getElementById("btn-back"),
    btnAgreements: document.getElementById("btn-agreements"),
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function pageUrl(path, extra) {
    const base = window.DGS ? DGS.withApi(path) : path;
    const url = new URL(base, window.location.href);
    for (const [key, value] of Object.entries(extra || {})) {
      if (value != null && String(value).trim() !== "") url.searchParams.set(key, String(value));
    }
    return url.pathname + url.search;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showError(msg) {
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  function themeList(themes) {
    if (!themes.length) return `<p class="dgs-v2-lines-status">No themes on file.</p>`;
    return `<div class="vh-themes">${themes
      .map((theme) => {
        const id = theme.reference_key;
        const label = theme.theme_name || id || "Theme";
        if (!id) return `<div class="vh-theme-row">${esc(label)}</div>`;
        return `<a class="vh-theme-row" href="${esc(pageUrl("theme-hub.html", { id }))}">${esc(label)}</a>`;
      })
      .join("")}</div>`;
  }

  function cabinetRows(cabinets) {
    if (!cabinets.length) return `<p class="dgs-v2-lines-status">No cabinets on file.</p>`;
    return cabinets
      .map((cabinet) => {
        const name = cabinet.cabinet_name || cabinet.reference_key || "Cabinet";
        const count = (cabinet.themes || []).length;
        return `<div class="vh-cab-btn">
          <span>${esc(name)}</span>
          <span class="vh-cab-count">${count.toLocaleString()}</span>
        </div>`;
      })
      .join("");
  }

  function allThemes(data) {
    const seen = new Set();
    const themes = [];
    function add(theme) {
      const id = theme && theme.reference_key;
      if (!id || seen.has(id)) return;
      seen.add(id);
      themes.push(theme);
    }
    (data.cabinets || []).forEach((cabinet) => (cabinet.themes || []).forEach(add));
    (data.themes_without_cabinet || []).forEach(add);
    themes.sort((a, b) =>
      String(a.theme_name || a.reference_key || "").localeCompare(
        String(b.theme_name || b.reference_key || ""),
        undefined,
        { sensitivity: "base" }
      )
    );
    return themes;
  }

  function kindLabel(doc) {
    if (doc.doc_kind === "amendment") {
      return doc.amendment_number ? `Amendment ${doc.amendment_number}` : "Amendment";
    }
    if (doc.doc_kind === "notice") return "Notice";
    return "Original";
  }

  function selectedAgreement() {
    const rows = state.agreements || [];
    return rows.find((row) => row.reference_key === state.agreementId) || rows.find((row) => row.governing) || rows[0] || null;
  }

  function selectedDocument(agreement) {
    const docs = (agreement && agreement.documents) || [];
    return docs.find((doc) => doc.reference_key === state.documentId)
      || docs.find((doc) => doc.is_current_territory)
      || docs[docs.length - 1]
      || null;
  }

  function syncAgreementChoice() {
    const agreement = selectedAgreement();
    state.agreementId = agreement ? agreement.reference_key : "";
    const doc = selectedDocument(agreement);
    state.documentId = doc ? doc.reference_key : "";
  }

  function casinoGroups(casinos) {
    const groups = new Map();
    (casinos || []).forEach((casino) => {
      const key = casino.product_class || "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(casino);
    });
    return [...groups.entries()];
  }

  async function openPdf(doc) {
    const headers = window.DGSAuth ? DGSAuth.authHeaders() : {};
    const res = await fetch(
      apiUrl(`/api/commerce/vendors/${encodeURIComponent(vendorId)}/distribution-documents/${encodeURIComponent(doc.reference_key)}/file`),
      { headers }
    );
    if (!res.ok) {
      showError("That PDF is not on file yet.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
  }

  function paintAgreements() {
    const rows = state.agreements || [];
    if (!rows.length) {
      els.hubGrid.innerHTML = `
        <article class="dgs-v2-hub-tile vh-agree-tile">
          <div class="dgs-v2-hub-tile-head"><div class="dgs-v2-section-label">Distribution agreements</div></div>
          <div class="dgs-v2-hub-tile-body vh-scroll"><p class="dgs-v2-lines-status">No distribution agreements on file.</p></div>
        </article>`;
      return;
    }
    syncAgreementChoice();
    const agreement = selectedAgreement();
    const doc = selectedDocument(agreement);
    const agreementButtons = rows.map((row) => {
      const active = row.reference_key === agreement.reference_key ? " is-active" : "";
      const flag = row.governing ? "Governing" : `Replaced by a later agreement`;
      return `<button type="button" class="vh-agree-pick${active}" data-agreement="${esc(row.reference_key)}">
        <span>${esc(row.agreement_number)}</span>
        <span class="vh-cab-count">${esc(flag)}</span>
      </button>`;
    }).join("");
    const docs = (agreement.documents || []).map((item) => {
      const active = doc && item.reference_key === doc.reference_key ? " is-active" : "";
      const badge = item.is_current_territory ? " · current territory" : "";
      return `<button type="button" class="vh-doc-row${active}" data-document="${esc(item.reference_key)}">
        <span>${esc(item.effective_on || "—")} · ${esc(kindLabel(item))}${esc(badge)}</span>
        <span class="vh-doc-title">${esc(item.title)}</span>
      </button>`;
    }).join("");
    const clauses = ((doc && doc.clauses) || []).map((clause) =>
      `<p class="vh-clause">${esc(clause.summary)}</p>`
    ).join("");
    const fileBtn = doc && doc.has_file
      ? `<button type="button" class="dgs-v2-btn vh-pdf" id="btn-dist-pdf">Open PDF</button>`
      : `<p class="dgs-v2-lines-status">PDF not filed yet.</p>`;
    const casinoHtml = !doc
      ? `<p class="dgs-v2-lines-status">No document selected.</p>`
      : !doc.has_territory
        ? `<p class="dgs-v2-lines-status">This document does not publish a casino list. The current list stays in place.</p>`
        : !(doc.casinos || []).length
          ? `<p class="dgs-v2-lines-status">No casinos recorded on this document yet.</p>`
          : casinoGroups(doc.casinos).map(([productClass, casinos]) => `
              <div class="dgs-v2-section-label">Class ${esc(productClass)}</div>
              <div class="vh-themes">${casinos.map((casino) => {
                const label = casino.casino_name || casino.casino_id;
                const extra = [casino.source_label, casino.cabinet_limit].filter(Boolean).join(" · ");
                return `<a class="vh-theme-row" href="${esc(pageUrl("casino-hub.html", { id: casino.casino_id }))}">
                  ${esc(label)}${extra ? `<span class="vh-doc-title">${esc(extra)}</span>` : ""}
                </a>`;
              }).join("")}</div>`).join("");
    els.hubGrid.innerHTML = `
      <article class="dgs-v2-hub-tile vh-agree-tile">
        <div class="dgs-v2-hub-tile-head">
          <div class="dgs-v2-section-label">Distribution agreements</div>
          ${fileBtn}
        </div>
        <div class="dgs-v2-hub-tile-body vh-scroll vh-agree-body">
          <div class="vh-agree-picks">${agreementButtons}</div>
          <div class="vh-agree-cols">
            <div class="vh-agree-docs">${docs || `<p class="dgs-v2-lines-status">No documents.</p>`}${clauses}</div>
            <div class="vh-agree-casinos">${casinoHtml}</div>
          </div>
        </div>
      </article>`;
    els.hubGrid.querySelectorAll("[data-agreement]").forEach((button) => {
      button.addEventListener("click", () => {
        state.agreementId = button.getAttribute("data-agreement");
        state.documentId = "";
        paint();
      });
    });
    els.hubGrid.querySelectorAll("[data-document]").forEach((button) => {
      button.addEventListener("click", () => {
        state.documentId = button.getAttribute("data-document");
        paint();
      });
    });
    const pdf = document.getElementById("btn-dist-pdf");
    if (pdf && doc) pdf.addEventListener("click", () => openPdf(doc));
  }

  function paint() {
    const data = state.data;
    if (!data) return;
    if (state.view === "agreements") {
      paintAgreements();
      if (els.btnAgreements) els.btnAgreements.textContent = "Cabinets";
      return;
    }
    if (els.btnAgreements) els.btnAgreements.textContent = "Agreements";
    const cabinets = data.cabinets || [];
    els.hubGrid.innerHTML = `
      <article class="dgs-v2-hub-tile">
        <div class="dgs-v2-hub-tile-head">
          <div class="dgs-v2-section-label">Cabinets</div>
        </div>
        <div class="dgs-v2-hub-tile-body vh-scroll">${cabinetRows(cabinets)}</div>
      </article>
      <article class="dgs-v2-hub-tile">
        <div class="dgs-v2-hub-tile-head">
          <div class="dgs-v2-section-label">Themes</div>
        </div>
        <div class="dgs-v2-hub-tile-body vh-scroll">${themeList(allThemes(data))}</div>
      </article>`;
  }

  async function loadMediaUrl(relPath) {
    if (!relPath) return null;
    if (state.mediaUrls[relPath]) return state.mediaUrls[relPath];
    const headers = window.DGSAuth ? DGSAuth.authHeaders() : {};
    const res = await fetch(apiUrl(`/api/media/${encodeURIComponent(relPath)}`), { headers });
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    state.mediaUrls[relPath] = url;
    return url;
  }

  function render(data) {
    state.data = data;
    const title = data.vendor_name || data.reference_key || "Vendor";
    els.captionTitle.textContent = title;
    els.captionId.textContent = data.reference_key || "—";
    const cabinets = data.cabinets || [];
    const themeCount = allThemes(data).length;
    const agreementCount = (state.agreements || []).length;
    const agreementBit = agreementCount
      ? ` · ${agreementCount.toLocaleString()} distribution agreement${agreementCount === 1 ? "" : "s"}`
      : "";
    els.captionMeta.textContent = `${cabinets.length.toLocaleString()} cabinets · ${themeCount.toLocaleString()} themes${agreementBit}`;
    els.btnBack.href = pageUrl("vendors-v2.html", { id: data.reference_key });
    paint();

    if (data.logo_media_path) {
      loadMediaUrl(data.logo_media_path).then((url) => {
        els.hubLogo.innerHTML = url
          ? `<img src="${url}" alt="${esc(title)} logo" />`
          : `<span class="placeholder">${esc(title)}</span>`;
      });
    } else {
      els.hubLogo.innerHTML = `<span class="placeholder">${esc(title)}</span>`;
    }
  }

  async function init() {
    if (!vendorId) {
      els.hubLoading.textContent = "Open Vendor hub from a vendor.";
      return;
    }
    try {
      const headers = window.DGSAuth ? DGSAuth.authHeaders() : {};
      const [res, agreementRes] = await Promise.all([
        fetch(apiUrl(`/api/commerce/vendors/${encodeURIComponent(vendorId)}/hub`), { headers }),
        fetch(apiUrl(`/api/commerce/vendors/${encodeURIComponent(vendorId)}/distribution-agreements`), { headers }),
      ]);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.detail || body.message || res.statusText;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      if (agreementRes.ok) {
        const agreementBody = await agreementRes.json().catch(() => ({}));
        state.agreements = agreementBody.agreements || [];
      }
      if (els.btnAgreements) {
        els.btnAgreements.addEventListener("click", () => {
          state.view = state.view === "agreements" ? "catalog" : "agreements";
          paint();
        });
      }
      render(body);
      els.hubLoading.hidden = true;
      els.hubBody.hidden = false;
    } catch (err) {
      showError(err.message || String(err));
      els.hubLoading.textContent = "Could not load this vendor.";
    }
  }

  window.VendorHub = { init };
})();
