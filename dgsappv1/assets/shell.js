(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const RAIL_KEY = "dgs-rail-collapsed";
  const GROUPS_KEY = "dgs-nav-groups";

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
        { id: "assets", label: "Assets", href: "assets-v2.html" },
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

  const DASHBOARD_NAV = [
    { route: "/executive", label: "Executive" },
    { route: "/analyst", label: "Analyst" },
    { route: "/finance", label: "Finance" },
    { route: "/performance", label: "Performance" },
  ];

  let dashboardBundlePromise = null;

  function apiBase() {
    return window.DGSAuth ? DGSAuth.apiBase() : (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
  }

  function withApi(href) {
    const url = new URL(href, window.location.href);
    if (params.get("api")) url.searchParams.set("api", params.get("api"));
    return url.pathname + url.search;
  }

  function isLocalDev() {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1";
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
    document.body.classList.toggle("dgs-rail-collapsed", collapsed);
    const btn = document.getElementById("dgs-rail-toggle");
    if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    closeFlyout();
  }

  function closeFlyout() {
    const fly = document.getElementById("dgs-nav-flyout");
    if (fly) {
      fly.hidden = true;
      fly.innerHTML = "";
    }
  }

  function openFlyout(group, anchorEl, activeId) {
    const fly = document.getElementById("dgs-nav-flyout");
    if (!fly) return;
    fly.hidden = false;
    fly.innerHTML = `
      <div class="dgs-nav-flyout-title">${group.label}</div>
      <nav class="dgs-nav-flyout-nav">
        ${group.items
          .map(
            (item) =>
              `<a href="${withApi(item.href)}" class="dgs-nav-flyout-link${item.id === activeId ? " active" : ""}">${item.label}</a>`
          )
          .join("")}
      </nav>`;
    const sidebar = document.getElementById("dgs-sidebar");
    if (sidebar && anchorEl) {
      const sRect = sidebar.getBoundingClientRect();
      const aRect = anchorEl.getBoundingClientRect();
      fly.style.top = `${aRect.top}px`;
      fly.style.left = `${sRect.right + 8}px`;
    }
  }

  function renderAppSidebar(activeId) {
    const nav = document.getElementById("dgs-app-nav");
    if (!nav) return;
    const groupState = loadGroupState();
    nav.innerHTML = "";

    for (const group of NAV_GROUPS) {
      const open = groupState[group.id] ?? group.defaultOpen ?? false;
      const section = document.createElement("div");
      section.className = "dgs-nav-group";

      const head = document.createElement("button");
      head.type = "button";
      head.className = "dgs-nav-group-head";
      const short = group.label.slice(0, 1);
      head.innerHTML = `<span class="dgs-nav-group-label">${group.label}</span><span class="dgs-nav-group-short" aria-hidden="true">${short}</span><span class="dgs-nav-chevron">${open ? "▾" : "▸"}</span>`;
      head.addEventListener("click", () => {
        if (document.body.classList.contains("dgs-rail-collapsed")) {
          openFlyout(group, head, activeId);
          return;
        }
        groupState[group.id] = !open;
        saveGroupState(groupState);
        renderAppSidebar(activeId);
      });
      section.appendChild(head);

      if (open && !document.body.classList.contains("dgs-rail-collapsed")) {
        const items = document.createElement("div");
        items.className = "dgs-nav-items";
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

  function wireRailToggle(activeId) {
    const btn = document.getElementById("dgs-rail-toggle");
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.dataset.activeId = activeId;
    btn.addEventListener("click", () => {
      setRailCollapsed(!document.body.classList.contains("dgs-rail-collapsed"));
      renderAppSidebar(btn.dataset.activeId || activeId);
    });
    document.addEventListener("click", (e) => {
      const fly = document.getElementById("dgs-nav-flyout");
      if (!fly || fly.hidden) return;
      if (fly.contains(e.target)) return;
      if (e.target.closest(".dgs-nav-group-head")) return;
      closeFlyout();
    });
  }

  function dashboardAssetUrl(file) {
    return new URL(`dashboard/assets/${file}`, window.location.href).href;
  }

  function loadDashboardBundle() {
    if (dashboardBundlePromise) return dashboardBundlePromise;

    if (isLocalDev()) {
      dashboardBundlePromise = import(/* @vite-ignore */ "http://localhost:5174/src/main.dgs.tsx")
        .then(() => {})
        .catch((err) => {
          dashboardBundlePromise = null;
          throw err;
        });
      return dashboardBundlePromise;
    }

    dashboardBundlePromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-dgs-dashboard-css]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = dashboardAssetUrl("dashboard.css");
        link.dataset.dgsDashboardCss = "1";
        link.onload = () => {};
        link.onerror = () => reject(new Error("Failed to load dashboard.css — run npm run build:dgsapp"));
        document.head.appendChild(link);
      }

      if (document.querySelector('script[data-dgs-dashboard-js]')) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.type = "module";
      script.src = dashboardAssetUrl("dashboard.js");
      script.dataset.dgsDashboardJs = "1";
      script.onload = () => resolve();
      script.onerror = () => {
        dashboardBundlePromise = null;
        reject(new Error("Failed to load dashboard.js — run npm run build:dgsapp"));
      };
      document.head.appendChild(script);
    });

    return dashboardBundlePromise;
  }

  function renderDashboardSubnav(activeRoute) {
    const nav = document.getElementById("dgs-dashboard-nav");
    if (!nav) return;
    nav.innerHTML = "";
    for (const item of DASHBOARD_NAV) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = item.label;
      a.dataset.route = item.route;
      if (item.route === activeRoute) a.classList.add("active");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        setDashboardRoute(item.route);
      });
      nav.appendChild(a);
    }
  }

  function setDashboardRoute(route) {
    const normalized = route.startsWith("/") ? route : `/${route}`;
    renderDashboardSubnav(normalized);
    loadDashboardBundle()
      .then(() => {
        window.dispatchEvent(new CustomEvent("dgs-dashboard-route", { detail: normalized }));
      })
      .catch((err) => {
        const root = document.getElementById("dashboard-root");
        if (root) {
          root.innerHTML = `<p class="error-box">${String(err.message || err)}</p>`;
        }
      });

    if (window.history.replaceState) {
      const u = new URL(window.location.href);
      u.searchParams.set("view", normalized.replace(/^\//, ""));
      window.history.replaceState({}, "", u.pathname + u.search);
    }
  }

  function initDashboardPage() {
    const initial =
      "/" +
      (params.get("view") ||
        window.location.hash.replace(/^#\/?/, "") ||
        "executive");
    renderDashboardSubnav(initial);
    setDashboardRoute(initial);
  }

  async function boot(activeId, onReady) {
    if (window.DGSAuth && !(await DGSAuth.ensureAuth())) return;
    document.body.classList.toggle("dgs-rail-collapsed", isRailCollapsed());
    renderAppSidebar(activeId);
    wireRailToggle(activeId);
    if (window.DGSAuth) DGSAuth.renderAccount();
    if (typeof onReady === "function") onReady();
  }

  window.DGS = {
    apiBase,
    withApi,
    renderAppSidebar,
    boot,
    initDashboardPage,
    setDashboardRoute,
    loadDashboardBundle,
    NAV_GROUPS,
  };
})();
