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

  function cell(value) {
    const text = value == null || value === "" ? "—" : value;
    return `<td>${esc(text)}</td>`;
  }

  function table(headers, rows, empty) {
    if (!rows.length) {
      return `<p class="dgs-field-empty">${esc(empty)}</p>`;
    }
    const head = headers.map((label) => `<th>${esc(label)}</th>`).join("");
    const body = rows
      .map((row) => `<tr>${row.map(cell).join("")}</tr>`)
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
      const mine = data.scope === "mine";
      const projects = data.projects || [];
      const orders = data.work_orders || [];
      root.innerHTML = `
        <div class="dgs-field-dash">
          <p class="dgs-field-note">${mine ? "Your projects and assigned work orders." : "Every upcoming project and open work order."}</p>
          <section>
            <h2>Upcoming projects <span>${projects.length}</span></h2>
            ${table(
              ["Start", "End", "Casino", "Project", "Type", "Lead", "Assisting", "Description"],
              projects.map((row) => [
                row.start_date,
                row.end_date,
                row.casino_name,
                row.project_number,
                row.project_type,
                row.lead_tech,
                row.assistant_techs,
                row.description,
              ]),
              "No upcoming projects."
            )}
          </section>
          <section>
            <h2>Open work orders <span>${orders.length}</span></h2>
            ${table(
              ["Scheduled", "WO", "Property", "Status", "Assigned", "Type", "Description"],
              orders.map((row) => [
                row.sch_date,
                row.wo,
                row.property,
                row.stattype,
                row.assignto,
                row.wo_type,
                row.brief_desc,
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
