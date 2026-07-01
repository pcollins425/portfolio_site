(function () {
  "use strict";

  let deps = null;
  const state = {
    layout: null,
    section: "",
    moveBinId: null,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "layout-section-select",
      "layout-new-section-btn",
      "layout-add-rows-btn",
      "layout-create-bins-btn",
      "layout-clear-move-btn",
      "layout-unslot-btn",
      "layout-move-hint",
      "layout-grid",
      "layout-status",
      "layout-unslotted-list",
      "layout-section-dialog",
      "layout-section-name",
      "layout-section-rows",
      "layout-section-cols",
      "layout-section-label",
      "layout-section-cancel",
      "layout-section-save",
      "layout-add-rows-dialog",
      "layout-add-rows-count",
      "layout-add-rows-cancel",
      "layout-add-rows-save",
      "layout-create-bins-dialog",
      "layout-create-bins-count",
      "layout-create-bins-cancel",
      "layout-create-bins-save",
    ].forEach((id) => {
      els[id.replace(/-/g, "_")] = $(id);
    });
  }

  function currentSection() {
    if (!state.layout?.sections?.length) return null;
    return state.layout.sections.find((s) => s.section === state.section) || state.layout.sections[0];
  }

  function setMoveBin(binId) {
    state.moveBinId = binId || null;
    if (els.layout_move_hint) {
      if (state.moveBinId) {
        const bin = findBinById(state.moveBinId);
        els.layout_move_hint.hidden = false;
        els.layout_move_hint.textContent = bin
          ? `Moving ${bin.reference_key || bin.barcode} — click an empty slot`
          : "Select an empty slot";
      } else {
        els.layout_move_hint.hidden = true;
        els.layout_move_hint.textContent = "";
      }
    }
    if (els.layout_clear_move_btn) els.layout_clear_move_btn.hidden = !state.moveBinId;
    if (els.layout_unslot_btn) els.layout_unslot_btn.hidden = !state.moveBinId;
    renderGrid();
    renderUnslotted();
  }

  function findBinById(binId) {
    for (const section of state.layout?.sections || []) {
      for (const cell of section.cells || []) {
        if (cell.bin?.uuid === binId) return cell.bin;
      }
    }
    return (state.layout?.unslotted_bins || []).find((b) => b.uuid === binId) || null;
  }

  function renderSectionSelect() {
    const sel = els.layout_section_select;
    if (!sel) return;
    const sections = state.layout?.sections || [];
    sel.innerHTML = "";
    if (!sections.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No sections yet";
      sel.appendChild(opt);
      state.section = "";
      return;
    }
    if (!state.section || !sections.some((s) => s.section === state.section)) {
      state.section = sections[0].section;
    }
    for (const item of sections) {
      const opt = document.createElement("option");
      opt.value = item.section;
      opt.textContent = item.label || item.section;
      opt.selected = item.section === state.section;
      sel.appendChild(opt);
    }
  }

  function renderGrid() {
    const grid = els.layout_grid;
    if (!grid) return;
    const section = currentSection();
    grid.innerHTML = "";
    if (!section) {
      grid.innerHTML = `<p class="dgs-v2-lines-status">Create a section to start the location grid.</p>`;
      if (els.layout_status) els.layout_status.textContent = "";
      return;
    }

    grid.style.gridTemplateColumns = `repeat(${section.column_count}, minmax(72px, 1fr))`;

    for (const cell of section.cells || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dgs-v2-layout-cell";
      const occupied = Boolean(cell.bin);
      if (occupied) btn.classList.add("dgs-v2-layout-cell--occupied");
      if (state.moveBinId && cell.bin?.uuid === state.moveBinId) {
        btn.classList.add("dgs-v2-layout-cell--selected");
      }
      if (state.moveBinId && !occupied) btn.classList.add("dgs-v2-layout-cell--move-target");

      const title = document.createElement("div");
      title.className = "dgs-v2-layout-cell-shelf";
      title.textContent = cell.shelf_code;
      btn.appendChild(title);

      if (occupied) {
        const meta = document.createElement("div");
        meta.className = "dgs-v2-layout-cell-bin";
        meta.textContent = cell.bin.reference_key || cell.bin.barcode || "Bin";
        btn.appendChild(meta);
        const qty = document.createElement("div");
        qty.className = "dgs-v2-layout-cell-qty";
        qty.textContent = `${cell.bin.software_count || 0} item(s)`;
        btn.appendChild(qty);
      } else {
        const empty = document.createElement("div");
        empty.className = "dgs-v2-layout-cell-empty";
        empty.textContent = state.moveBinId ? "Place here" : "Empty";
        btn.appendChild(empty);
      }

      btn.addEventListener("click", () => onCellClick(section.section, cell));
      grid.appendChild(btn);
    }

    if (els.layout_status) {
      const unslotted = state.layout?.unslotted_bins?.length || 0;
      els.layout_status.textContent = `${section.row_count}×${section.column_count} grid · ${unslotted} unslotted bin(s)`;
    }
  }

  function renderUnslotted() {
    const list = els.layout_unslotted_list;
    if (!list) return;
    const bins = state.layout?.unslotted_bins || [];
    list.innerHTML = "";
    if (!bins.length) {
      list.innerHTML = `<p class="dgs-v2-lines-status">No unslotted bins.</p>`;
      return;
    }
    for (const bin of bins) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dgs-v2-layout-unslotted-chip";
      if (state.moveBinId === bin.uuid) btn.classList.add("dgs-v2-layout-unslotted-chip--active");
      btn.textContent = bin.reference_key || bin.barcode || "Bin";
      btn.title = bin.barcode || "";
      btn.addEventListener("click", () => setMoveBin(bin.uuid));
      list.appendChild(btn);
    }
  }

  async function onCellClick(sectionName, cell) {
    if (state.moveBinId) {
      if (cell.bin) {
        deps.showError("That slot is already occupied.");
        return;
      }
      try {
        await deps.fetchJson(`/api/software-vault/bins/${encodeURIComponent(state.moveBinId)}/slot`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section: sectionName,
            row: parseInt(cell.row, 10),
            column: parseInt(cell.column, 10),
          }),
        });
        deps.showError("");
        setMoveBin(null);
        await loadLayout();
        if (deps.onBinsChanged) await deps.onBinsChanged();
      } catch (e) {
        deps.showError(String(e.message || e));
      }
      return;
    }

    if (cell.bin) {
      setMoveBin(cell.bin.uuid);
      return;
    }

    const create = window.confirm("Create a new physical bin at this slot?\n\nCancel to leave the slot empty.");
    if (!create) return;
    try {
      const created = await deps.fetchJson("/api/software-vault/bins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });
      const bin = created.items?.[0];
      if (!bin) throw new Error("bin was not created");
      await deps.fetchJson(`/api/software-vault/bins/${encodeURIComponent(bin.uuid)}/slot`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: sectionName,
          row: parseInt(cell.row, 10),
          column: parseInt(cell.column, 10),
        }),
      });
      await loadLayout();
      if (deps.onBinsChanged) await deps.onBinsChanged();
    } catch (e) {
      deps.showError(String(e.message || e));
    }
  }

  function openDialog(node) {
    if (node) node.hidden = false;
  }

  function closeDialog(node) {
    if (node) node.hidden = true;
  }

  async function loadLayout() {
    state.layout = await deps.fetchJson("/api/software-vault/layout");
    renderSectionSelect();
    renderGrid();
    renderUnslotted();
  }

  function wireEvents() {
    els.layout_section_select?.addEventListener("change", () => {
      state.section = els.layout_section_select.value;
      setMoveBin(null);
      renderGrid();
    });

    els.layout_new_section_btn?.addEventListener("click", () => {
      if (els.layout_section_name) els.layout_section_name.value = "";
      if (els.layout_section_rows) els.layout_section_rows.value = "4";
      if (els.layout_section_cols) els.layout_section_cols.value = "6";
      if (els.layout_section_label) els.layout_section_label.value = "";
      openDialog(els.layout_section_dialog);
      els.layout_section_name?.focus();
    });

    els.layout_section_cancel?.addEventListener("click", () => closeDialog(els.layout_section_dialog));
    els.layout_section_save?.addEventListener("click", async () => {
      const section = els.layout_section_name?.value.trim();
      const rows = Number(els.layout_section_rows?.value);
      const columns = Number(els.layout_section_cols?.value);
      const label = els.layout_section_label?.value.trim();
      if (!section) return;
      try {
        await deps.fetchJson("/api/software-vault/layout/sections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, rows, columns, label: label || null }),
        });
        closeDialog(els.layout_section_dialog);
        state.section = section;
        await loadLayout();
      } catch (e) {
        deps.showError(String(e.message || e));
      }
    });

    els.layout_add_rows_btn?.addEventListener("click", () => {
      if (!state.section) {
        deps.showError("Select a section first.");
        return;
      }
      if (els.layout_add_rows_count) els.layout_add_rows_count.value = "1";
      openDialog(els.layout_add_rows_dialog);
    });

    els.layout_add_rows_cancel?.addEventListener("click", () => closeDialog(els.layout_add_rows_dialog));
    els.layout_add_rows_save?.addEventListener("click", async () => {
      const rows = Number(els.layout_add_rows_count?.value || 1);
      try {
        await deps.fetchJson(
          `/api/software-vault/layout/sections/${encodeURIComponent(state.section)}/add-rows`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          }
        );
        closeDialog(els.layout_add_rows_dialog);
        await loadLayout();
      } catch (e) {
        deps.showError(String(e.message || e));
      }
    });

    els.layout_create_bins_btn?.addEventListener("click", () => {
      if (els.layout_create_bins_count) els.layout_create_bins_count.value = "1";
      openDialog(els.layout_create_bins_dialog);
    });

    els.layout_create_bins_cancel?.addEventListener("click", () => closeDialog(els.layout_create_bins_dialog));
    els.layout_create_bins_save?.addEventListener("click", async () => {
      const count = Number(els.layout_create_bins_count?.value || 1);
      try {
        await deps.fetchJson("/api/software-vault/bins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count }),
        });
        closeDialog(els.layout_create_bins_dialog);
        await loadLayout();
        if (deps.onBinsChanged) await deps.onBinsChanged();
      } catch (e) {
        deps.showError(String(e.message || e));
      }
    });

    els.layout_clear_move_btn?.addEventListener("click", () => setMoveBin(null));

    els.layout_unslot_btn?.addEventListener("click", async () => {
      if (!state.moveBinId) return;
      try {
        await deps.fetchJson(`/api/software-vault/bins/${encodeURIComponent(state.moveBinId)}/slot`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: null }),
        });
        setMoveBin(null);
        await loadLayout();
        if (deps.onBinsChanged) await deps.onBinsChanged();
      } catch (e) {
        deps.showError(String(e.message || e));
      }
    });
  }

  async function init(options) {
    if (options?.isMobile?.()) return;
    deps = options;
    cacheEls();
    wireEvents();
    await loadLayout();
  }

  async function refresh() {
    if (!deps || deps.isMobile?.()) return;
    await loadLayout();
  }

  window.SoftwareVaultLayout = { init, refresh, setMoveBin };
})();
