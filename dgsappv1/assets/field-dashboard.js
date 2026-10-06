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
    const text = value == null || value === "" ? "—" : value;
    const attr = cls ? ` class="${cls}"` : "";
    return `<td${attr}>${esc(text)}</td>`;
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
                row.property,
                row.serial,
                row.vendor,
                row.cabinet,
                row.theme,
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
