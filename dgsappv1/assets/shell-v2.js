(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const RAIL_KEY = "dgs-v2-rail-collapsed";
  const GROUPS_KEY = "dgs-v2-nav-groups";

  const NAV_GROUPS = [
    {
      id: "revenue",
      label: "Revenue",
      items: [{ id: "dashboard", label: "Dashboard", href: "dashboard.html" }],
    },
    {
      id: "inventory",
      label: "Inventory",
      defaultOpen: true,
      items: [
        { id: "warehouse", label: "Warehouse", href: "warehouse.html" },
        { id: "slot_master", label: "Slot Master", href: "slot_master.html" },
        { id: "contracts", label: "Contracts", href: "contracts-v2.html" },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [{ id: "operations", label: "Operations", href: "operations.html?t=projects" }],
    },
    {
      id: "finance",
      label: "Finance",
      items: [
        { id: "expenses", label: "Expenses", href: "expenses.html" },
        { id: "expenses_mass", label: "Mass Edit", href: "expenses-mass-edit.html" },
      ],
    },
    {
      id: "workspace",
      label: "Workspace",
      items: [{ id: "assistant", label: "Assistant", href: "assistant.html" }],
    },
  ];

  function apiBase() {
    return window.DGSAuth ? DGSAuth.apiBase() : (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
  }

  function withApi(href) {
    const url = new URL(href, window.location.href);
    if (params.get("api")) url.searchParams.set("api", params.get("api"));
    return url.pathname + url.search;
  }

  function loadGroupState() {
    try {
      return JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}");
    } catch (_e) {
      return {};
    }
  }

  function saveGroupState(state) {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(state));
  }

  function isRailCollapsed() {
    return localStorage.getItem(RAIL_KEY) === "1";
  }

  function setRailCollapsed(collapsed) {
    localStorage.setItem(RAIL_KEY, collapsed ? "1" : "0");
    document.body.classList.toggle("dgs-v2-rail-collapsed", collapsed);
    const btn = document.getElementById("dgs-v2-rail-toggle");
    if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    closeFlyout();
  }

  function closeFlyout() {
    const fly = document.getElementById("dgs-v2-flyout");
    if (fly) {
      fly.hidden = true;
      fly.innerHTML = "";
    }
  }

  function openFlyout(group, anchorEl) {
    const fly = document.getElementById("dgs-v2-flyout");
    if (!fly) return;
    fly.hidden = false;
    fly.innerHTML = `
      <div class="dgs-v2-flyout-title">${group.label}</div>
      <nav class="dgs-v2-flyout-nav">
        ${group.items
          .map(
            (item) =>
              `<a href="${withApi(item.href)}" class="dgs-v2-flyout-link${item.id === fly.dataset.active ? " active" : ""}">${item.label}</a>`
          )
          .join("")}
      </nav>`;
    const sidebar = document.getElementById("dgs-v2-sidebar");
    if (sidebar && anchorEl) {
      const sRect = sidebar.getBoundingClientRect();
      const aRect = anchorEl.getBoundingClientRect();
      fly.style.top = `${aRect.top}px`;
      fly.style.left = `${sRect.right + 8}px`;
    }
  }

  function renderNav(activeId) {
    const nav = document.getElementById("dgs-v2-nav");
    if (!nav) return;
    const groupState = loadGroupState();
    nav.innerHTML = "";

    for (const group of NAV_GROUPS) {
      const open = groupState[group.id] ?? group.defaultOpen ?? false;
      const section = document.createElement("div");
      section.className = "dgs-v2-nav-group";

      const head = document.createElement("button");
      head.type = "button";
      head.className = "dgs-v2-nav-group-head";
      const short = group.label.slice(0, 1);
      head.innerHTML = `<span class="dgs-v2-nav-group-label">${group.label}</span><span class="dgs-v2-nav-group-short" aria-hidden="true">${short}</span><span class="dgs-v2-nav-chevron">${open ? "▾" : "▸"}</span>`;
      head.addEventListener("click", () => {
        if (document.body.classList.contains("dgs-v2-rail-collapsed")) {
          const fly = document.getElementById("dgs-v2-flyout");
          if (fly) fly.dataset.active = activeId;
          openFlyout(group, head);
          return;
        }
        groupState[group.id] = !open;
        saveGroupState(groupState);
        renderNav(activeId);
      });
      section.appendChild(head);

      if (open && !document.body.classList.contains("dgs-v2-rail-collapsed")) {
        const items = document.createElement("div");
        items.className = "dgs-v2-nav-items";
        for (const item of group.items) {
          const a = document.createElement("a");
          a.href = withApi(item.href);
          a.textContent = item.label;
          if (item.id === activeId) a.classList.add("active");
          items.appendChild(a);
        }
        section.appendChild(items);
      }
      nav.appendChild(section);
    }
  }

  function wireRailToggle() {
    const btn = document.getElementById("dgs-v2-rail-toggle");
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      setRailCollapsed(!document.body.classList.contains("dgs-v2-rail-collapsed"));
      renderNav(btn.dataset.activeId || "");
    });
    document.addEventListener("click", (e) => {
      const fly = document.getElementById("dgs-v2-flyout");
      if (!fly || fly.hidden) return;
      if (fly.contains(e.target)) return;
      if (e.target.closest(".dgs-v2-nav-group-head")) return;
      closeFlyout();
    });
  }

  async function boot(activeId, onReady) {
    if (window.DGSAuth && !(await DGSAuth.ensureAuth())) return;
    document.body.classList.toggle("dgs-v2-rail-collapsed", isRailCollapsed());
    const btn = document.getElementById("dgs-v2-rail-toggle");
    if (btn) btn.dataset.activeId = activeId;
    renderNav(activeId);
    wireRailToggle();
    if (window.DGSAuth) DGSAuth.renderAccount();
    if (typeof onReady === "function") onReady();
  }

  window.DGSv2 = {
    apiBase,
    withApi,
    boot,
    renderNav,
    NAV_GROUPS,
  };
})();
