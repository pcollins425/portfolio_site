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

  function table(headers, rows, empty) {
    if (!rows.length) {
      return `<p class="dgs-field-empty">${esc(empty)}</p>`;
    }
    const head = headers
      .map((col) => `<th${col.cls ? ` class="${col.cls}"` : ""}>${esc(col.label)}</th>`)
      .join("");
    const body = rows
      .map((row) => `<tr>${row.map((value, i) => cell(value, headers[i].cls)).join("")}</tr>`)
      .join("");
    return `<div class="dgs-field-scroll"><table class="dgs-field-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
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
            ${table(
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
              "No upcoming projects."
            )}
          </section>
          <section class="dgs-field-panel">
            <h2>Open work orders <span>${orders.length}</span></h2>
            ${table(
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
              orders.map((row) => [
                row.date_wo,
                row.wo,
                propertyCell(row),
                serialCell(row),
                vendorCell(row),
                cabinetCell(row),
                themeCell(row),
                row.description,
              ]),
              "No open work orders."
            )}
          </section>
        </div>`;
    } catch (err) {
      root.innerHTML = `<p class="error-box">${esc(err.message || err)}</p>`;
    }
  }

  window.DGSField = { load };
})();
