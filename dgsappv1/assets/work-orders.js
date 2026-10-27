/* Work Orders — Operations browse + detail drawer (read-only). */
(function () {
  "use strict";

  const PAGE_SIZE = 100;

  let state = {
    q: "",
    status: "open",
    woType: "",
    offset: 0,
    total: 0,
    orders: [],
    meta: null,
    scope: "all",
    hasPriority: false,
    loading: false,
    error: "",
    selectedWo: null,
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  async function fetchJson(path) {
    const res = await fetch(`${DGSAuth.apiBase()}${path}`, {
      headers: DGSAuth.authHeaders(),
    });
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

  function queryString(extra) {
    const q = new URLSearchParams();
    q.set("status", state.status || "open");
    q.set("limit", String(PAGE_SIZE));
    q.set("offset", String(state.offset));
    if (state.q) q.set("q", state.q);
    if (state.woType) q.set("wo_type", state.woType);
    if (extra) {
      Object.keys(extra).forEach((key) => {
        if (extra[key] != null && extra[key] !== "") q.set(key, extra[key]);
      });
    }
    return q.toString();
  }

  function openDetail(wo) {
    if (!window.DGSWorkOrderDetail) return;
    state.selectedWo = wo;
    DGSWorkOrderDetail.open(wo, {
      onClose: () => {
        state.selectedWo = null;
        document.querySelectorAll(".dgs-wo-row.is-active").forEach((el) => {
          el.classList.remove("is-active");
        });
      },
    });
  }

  function renderList(root) {
    const types = (state.meta && state.meta.wo_types) || [];
    const typeOptions = [`<option value="">All types</option>`]
      .concat(
        types.map(
          (value) =>
            `<option value="${esc(value)}"${
              state.woType === value ? " selected" : ""
            }>${esc(value)}</option>`
        )
      )
      .join("");
    const scopeNote =
      state.scope === "route" ? "Your route" : "All properties";
    const rows = state.orders
      .map((row) => {
        const active = state.selectedWo === row.wo ? " is-active" : "";
        const mp = row.moneypenny
          ? `<span class="dgs-wo-badge is-compact">MP</span>`
          : "";
        const pri =
          state.hasPriority && row.priority
            ? `<span class="dgs-wo-badge is-compact is-priority">P${esc(
                row.priority
              )}</span>`
            : "";
        return `<tr class="dgs-wo-row${active}" data-wo="${esc(row.wo)}">
          <td class="dgs-field-date">${esc(row.date_wo || "—")}</td>
          <td class="dgs-field-num">${esc(row.wo || "—")} ${mp}${pri}</td>
          <td>${propertyHtml(row)}</td>
          <td>${serialHtml(row)}</td>
          <td>${esc(statusLabel(row))}</td>
          <td>${esc(row.wo_type || "—")}</td>
          <td>${esc(row.assignto || "—")}</td>
          <td>${esc(row.brief_desc || "—")}</td>
        </tr>`;
      })
      .join("");

    const cards = state.orders
      .map((row) => {
        const active = state.selectedWo === row.wo ? " is-active" : "";
        const badges = [];
        if (row.moneypenny) badges.push(`<span class="dgs-wo-badge">MP</span>`);
        if (state.hasPriority && row.priority) {
          badges.push(
            `<span class="dgs-wo-badge is-priority">P${esc(row.priority)}</span>`
          );
        }
        if (row.wo_type) badges.push(`<span class="dgs-wo-badge">${esc(row.wo_type)}</span>`);
        const meta = [statusLabel(row), row.assignto].filter(Boolean).join(" · ");
        return `<article class="dgs-wo-card dgs-wo-row${active}" data-wo="${esc(
          row.wo
        )}" tabindex="0" role="button" aria-label="Open work order ${esc(row.wo || "")}">
          <div class="dgs-wo-card-top">
            <span class="dgs-wo-card-wo">${esc(row.wo || "—")}</span>
            <span class="dgs-wo-card-date">${esc(row.date_wo || "—")}</span>
          </div>
          <div class="dgs-wo-card-property">${propertyHtml(row)}</div>
          ${badges.length ? `<div class="dgs-wo-badges">${badges.join("")}</div>` : ""}
          ${meta ? `<div class="dgs-wo-card-meta">${esc(meta)}</div>` : ""}
          ${
            row.brief_desc
              ? `<div class="dgs-wo-card-desc">${esc(row.brief_desc)}</div>`
              : ""
          }
        </article>`;
      })
      .join("");

    root.innerHTML = `
      <div class="dgs-wo">
        <div class="dgs-wo-toolbar">
          <input type="search" id="wo-search" placeholder="Search WO #, serial, property, requestor…" value="${esc(
            state.q
          )}" autocomplete="off" />
          <select id="wo-status" aria-label="Status">
            <option value="open"${state.status === "open" ? " selected" : ""}>Open</option>
            <option value="closed"${state.status === "closed" ? " selected" : ""}>Closed</option>
            <option value="all"${state.status === "all" ? " selected" : ""}>All</option>
          </select>
          <select id="wo-type" aria-label="Type">${typeOptions}</select>
          <button type="button" class="dgs-v2-btn" id="wo-apply">Apply</button>
          <button type="button" class="dgs-v2-btn dgs-v2-btn-primary" id="wo-add">
            Add work order
          </button>
          <span class="dgs-wo-meta">${esc(scopeNote)} · ${esc(
      String(state.total)
    )} match${state.total === 1 ? "" : "es"}</span>
        </div>
        ${state.error ? `<p class="error-box">${esc(state.error)}</p>` : ""}
        <section class="dgs-field-panel dgs-wo-panel">
          ${
            state.orders.length
              ? `<div class="dgs-field-scroll">
                  <div class="dgs-wo-desktop-table">
                    <table class="dgs-field-table dgs-wo-table">
                      <thead><tr>
                        <th class="dgs-field-date">Date</th>
                        <th class="dgs-field-num">WO #</th>
                        <th>Property</th>
                        <th>Serial</th>
                        <th>Status</th>
                        <th>Type</th>
                        <th>Assigned</th>
                        <th>Brief</th>
                      </tr></thead>
                      <tbody>${rows}</tbody>
                    </table>
                  </div>
                  <div class="dgs-wo-card-list" aria-label="Work orders">${cards}</div>
                </div>`
              : `<p class="dgs-field-empty">${
                  state.loading ? "Loading…" : "No work orders for this filter."
                }</p>`
          }
          <div class="dgs-wo-pager">
            <button type="button" class="dgs-v2-btn" id="wo-prev"${
              state.offset <= 0 ? " disabled" : ""
            }>Prev</button>
            <span>${esc(String(state.offset + 1))}–${esc(
      String(Math.min(state.offset + state.orders.length, state.total))
    )} of ${esc(String(state.total))}</span>
            <button type="button" class="dgs-v2-btn" id="wo-next"${
              state.offset + state.orders.length >= state.total ? " disabled" : ""
            }>Next</button>
          </div>
        </section>
      </div>`;

    document.getElementById("wo-apply")?.addEventListener("click", () => {
      state.q = document.getElementById("wo-search")?.value.trim() || "";
      state.status = document.getElementById("wo-status")?.value || "open";
      state.woType = document.getElementById("wo-type")?.value || "";
      state.offset = 0;
      loadList(root);
    });
    document.getElementById("wo-add")?.addEventListener("click", () => {
      if (!window.DGSWorkOrderCreate) return;
      DGSWorkOrderCreate.open({ meta: state.meta });
    });
    document.getElementById("wo-search")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") document.getElementById("wo-apply")?.click();
    });
    document.getElementById("wo-prev")?.addEventListener("click", () => {
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      loadList(root);
    });
    document.getElementById("wo-next")?.addEventListener("click", () => {
      state.offset += PAGE_SIZE;
      loadList(root);
    });
    root.querySelectorAll(".dgs-wo-row[data-wo]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest("a")) return;
        openDetail(row.getAttribute("data-wo"));
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("a")) return;
        event.preventDefault();
        openDetail(row.getAttribute("data-wo"));
      });
    });
  }

  async function loadList(root) {
    state.loading = true;
    state.error = "";
    renderList(root);
    try {
      const data = await fetchJson(`/api/work-orders?${queryString()}`);
      state.orders = data.orders || [];
      state.total = Number(data.total) || 0;
      state.scope = data.scope || "all";
      state.hasPriority = !!data.has_priority;
      state.loading = false;
      renderList(root);
    } catch (err) {
      state.loading = false;
      state.error = err.message || String(err);
      renderList(root);
    }
  }

  async function load(root) {
    if (!root || !window.DGSAuth) return;
    root.innerHTML = '<p class="dgs-v2-loading">Loading work orders…</p>';
    try {
      state.meta = await fetchJson("/api/work-orders/meta");
      state.hasPriority = !!(state.meta && state.meta.has_priority);
      const params = new URLSearchParams(window.location.search);
      const deepWo = (params.get("wo") || "").trim();
      await loadList(root);
      if (deepWo) openDetail(deepWo);
    } catch (err) {
      root.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
    }
  }

  window.DGSWorkOrders = { load };
})();
