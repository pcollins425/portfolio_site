/* Field dashboard — upcoming projects and open work orders. */
(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cell(value, cls) {
    const attr = cls ? ` class="${cls}"` : "";
    if (value && typeof value === "object") {
      const text = value.text == null || value.text === "" ? "—" : value.text;
      if (!value.href) return `<td${attr}>${esc(text)}</td>`;
      return `<td${attr}><a class="dgs-field-asset" href="${esc(value.href)}">${esc(text)}</a></td>`;
    }
    const text = value == null || value === "" ? "—" : value;
    return `<td${attr}>${esc(text)}</td>`;
  }

  function serialCell(row) {
    const assetId = row.asset_id;
    const href = assetId && window.DGSAssetNav ? DGSAssetNav.hubHref(assetId) : "";
    if (!href) return row.serial;
    return { text: row.serial || assetId, href };
  }

  function propertyCell(row) {
    const casinoId = row.casino_id;
    const href = casinoId && window.DGSCasinoNav ? DGSCasinoNav.hubHref(casinoId) : "";
    if (!href) return row.property;
    return { text: row.property || casinoId, href };
  }

  function vendorCell(row) {
    const href = row.vendor_id && window.DGSVendorNav ? DGSVendorNav.hubHref(row.vendor_id) : "";
    if (!href) return row.vendor;
    return { text: row.vendor || row.vendor_id, href };
  }

  function cabinetCell(row) {
    const href =
      row.vendor_id && row.cabinet_id && window.DGSVendorNav
        ? DGSVendorNav.hubHref(row.vendor_id, row.cabinet_id)
        : "";
    if (!href) return row.cabinet;
    return { text: row.cabinet || row.cabinet_id, href };
  }

  function themeCell(row) {
    const href = row.theme_id && window.DGSThemeNav ? DGSThemeNav.hubHref(row.theme_id) : "";
    if (!href) return row.theme;
    return { text: row.theme || row.theme_id, href };
  }

  function tableMarkup(headers, rows, options) {
    const opts = options || {};
    const rowClass = opts.rowClass || "";
    const head = headers
      .map((col) => `<th${col.cls ? ` class="${col.cls}"` : ""}>${esc(col.label)}</th>`)
      .join("");
    const body = rows
      .map((entry) => {
        const cells = Array.isArray(entry) ? entry : entry.cells;
        const attrs = Array.isArray(entry) ? "" : entry.attrs || "";
        const cls = Array.isArray(entry)
          ? rowClass
          : [rowClass, entry.rowClass].filter(Boolean).join(" ");
        const classAttr = cls ? ` class="${cls}"` : "";
        return `<tr${classAttr}${attrs}>${cells
          .map((value, i) => cell(value, headers[i].cls))
          .join("")}</tr>`;
      })
      .join("");
    return `<table class="dgs-field-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function panelList(headers, rows, empty, cardsHtml, options) {
    if (!rows.length) {
      return `<p class="dgs-field-empty">${esc(empty)}</p>`;
    }
    return `<div class="dgs-field-scroll">
      <div class="dgs-wo-desktop-table">${tableMarkup(headers, rows, options)}</div>
      ${cardsHtml || ""}
    </div>`;
  }

  function openWoDetail(wo) {
    if (!wo || !window.DGSWorkOrderDetail) return;
    DGSWorkOrderDetail.open(wo);
  }

  function linkOrText(value) {
    if (value && typeof value === "object") {
      const text = value.text == null || value.text === "" ? "—" : value.text;
      if (!value.href) return esc(text);
      return `<a class="dgs-field-asset" href="${esc(value.href)}">${esc(text)}</a>`;
    }
    return esc(value == null || value === "" ? "—" : value);
  }

  function woCards(orders) {
    if (!orders.length) return "";
    return `<div class="dgs-wo-card-list" aria-label="Open work orders">
      ${orders
        .map((row) => {
          const serial = linkOrText(serialCell(row));
          const rest = [row.vendor, row.cabinet, row.theme].filter(Boolean).join(" · ");
          const meta = rest ? `${serial} · ${esc(rest)}` : serial;
          return `<article class="dgs-wo-card dgs-field-wo-row" data-wo="${esc(
            row.wo
          )}" tabindex="0" role="button" aria-label="Open work order ${esc(
            row.wo || ""
          )}">
            <div class="dgs-wo-card-top">
              <span class="dgs-wo-card-wo">${esc(row.wo || "—")}</span>
              <span class="dgs-wo-card-date">${esc(row.date_wo || "—")}</span>
            </div>
            <div class="dgs-wo-card-property">${linkOrText(propertyCell(row))}</div>
            <div class="dgs-wo-card-meta">${meta}</div>
            ${
              row.description
                ? `<div class="dgs-wo-card-desc">${esc(row.description)}</div>`
                : ""
            }
          </article>`;
        })
        .join("")}
    </div>`;
  }

  function projectCards(projects) {
    if (!projects.length) return "";
    return `<div class="dgs-wo-card-list dgs-field-project-cards" aria-label="Upcoming projects">
      ${projects
        .map(
          (row) => `<article class="dgs-wo-card dgs-field-project-card">
            <div class="dgs-wo-card-top">
              <span class="dgs-wo-card-wo">${esc(row.project_number || "—")}</span>
              <span class="dgs-wo-card-date">${esc(row.start_date || "—")}</span>
            </div>
            <div class="dgs-wo-card-property">${esc(row.property || "—")}</div>
            ${
              row.description
                ? `<div class="dgs-wo-card-desc">${esc(row.description)}</div>`
                : ""
            }
          </article>`
        )
        .join("")}
    </div>`;
  }

  function bindWoRows(root) {
    root.querySelectorAll(".dgs-field-wo-row[data-wo]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest("a")) return;
        openWoDetail(row.getAttribute("data-wo"));
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("a")) return;
        event.preventDefault();
        openWoDetail(row.getAttribute("data-wo"));
      });
    });
  }

  async function load(root) {
    if (!root || !window.DGSAuth) return;
    root.innerHTML = '<p class="dgs-v2-loading">Loading field work…</p>';
    try {
      const res = await fetch(`${DGSAuth.apiBase()}/api/field-dashboard`, {
        headers: DGSAuth.authHeaders(),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const projects = data.projects || [];
      const orders = data.work_orders || [];
      root.innerHTML = `
        <div class="dgs-field-pair">
          <section class="dgs-field-panel">
            <h2>Upcoming projects <span>${projects.length}</span></h2>
            ${panelList(
              [
                { label: "Start Date", cls: "dgs-field-date" },
                { label: "Project Number", cls: "dgs-field-num" },
                { label: "Property" },
                { label: "Description" },
              ],
              projects.map((row) => [
                row.start_date,
                row.project_number,
                row.property,
                row.description,
              ]),
              "No upcoming projects.",
              projectCards(projects)
            )}
          </section>
          <section class="dgs-field-panel">
            <h2>Open work orders <span>${orders.length}</span></h2>
            ${panelList(
              [
                { label: "Work Order Date", cls: "dgs-field-date" },
                { label: "WO #", cls: "dgs-field-num" },
                { label: "Property" },
                { label: "Serial" },
                { label: "Vendor" },
                { label: "Cabinet" },
                { label: "Theme" },
                { label: "Description" },
              ],
              orders.map((row) => ({
                rowClass: "dgs-field-wo-row",
                attrs: ` data-wo="${esc(row.wo)}" tabindex="0" role="button" aria-label="Open work order ${esc(
                  row.wo || ""
                )}"`,
                cells: [
                  row.date_wo,
                  row.wo,
                  propertyCell(row),
                  serialCell(row),
                  vendorCell(row),
                  cabinetCell(row),
                  themeCell(row),
                  row.description,
                ],
              })),
              "No open work orders.",
              woCards(orders)
            )}
          </section>
        </div>`;
      bindWoRows(root);
    } catch (err) {
      root.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
    }
  }

  window.DGSField = { load };
})();
