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
        { id: "parts_inventory", label: "Parts", href: "parts-inventory.html" },
        { id: "slot_master", label: "Slot Master", href: "slot_master.html" },
        { id: "contracts", label: "Contracts", href: "contracts-v2.html" },
        { id: "assets", label: "Assets", href: "assets-v2.html" },
      ],
    },
    {
      id: "commerce",
      label: "Commerce",
      items: [
        { id: "vendors", label: "Vendors", href: "vendors-v2.html" },
        { id: "casinos", label: "Casinos", href: "casinos-v2.html" },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [
        { id: "projects", label: "Projects", href: "projects.html" },
        { id: "software_vault", label: "Software Vault", href: "software-vault.html" },
        { id: "operations", label: "Operations (eMaint)", href: "operations.html?t=work_orders" },
      ],
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
  const MOBILE_TOP_NAV_MQ = window.matchMedia("(max-width: 900px)");

  function usesMobileTopNav() {
    return document.body.classList.contains("dgs-mobile-top-nav");
  }

  function activePageTitle(activeId) {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.id === activeId) return item.label;
      }
    }
    return "DGS Application";
  }

  function closeMobileMenu() {
    const menu = document.getElementById("dgs-mobile-menu");
    const btn = document.getElementById("dgs-mobile-menu-btn");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("dgs-mobile-menu-open");
  }

  function toggleMobileMenu() {
    const menu = document.getElementById("dgs-mobile-menu");
    const btn = document.getElementById("dgs-mobile-menu-btn");
    if (!menu || !btn) return;
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("dgs-mobile-menu-open", open);
  }

  function ensureMobileTopNav() {
    if (document.getElementById("dgs-mobile-topbar")) return;
    const bar = document.createElement("header");
    bar.id = "dgs-mobile-topbar";
    bar.className = "dgs-mobile-topbar";
    bar.hidden = true;
    bar.innerHTML = `
      <div class="dgs-mobile-topbar-row">
        <button type="button" id="dgs-mobile-menu-btn" class="dgs-mobile-menu-btn" aria-expanded="false" aria-controls="dgs-mobile-menu">
          <span class="dgs-mobile-menu-icon" aria-hidden="true">☰</span>
          <span class="dgs-mobile-menu-label">Menu</span>
        </button>
        <div class="dgs-mobile-topbar-brand">
          <span class="dgs-mobile-topbar-eyebrow">DGS Application</span>
          <span class="dgs-mobile-topbar-title" id="dgs-mobile-page-title"></span>
        </div>
      </div>
      <div id="dgs-mobile-menu" class="dgs-mobile-menu" hidden></div>`;
    const sidebar = document.getElementById("dgs-sidebar");
    if (sidebar?.parentNode) {
      sidebar.parentNode.insertBefore(bar, sidebar.nextSibling);
    } else {
      document.body.insertBefore(bar, document.body.firstChild);
    }
  }

  function renderMobileTopNav(activeId) {
    const menu = document.getElementById("dgs-mobile-menu");
    const title = document.getElementById("dgs-mobile-page-title");
    if (!menu) return;
    if (title) title.textContent = activePageTitle(activeId);

    menu.innerHTML = NAV_GROUPS.map(
      (group) => `
        <section class="dgs-mobile-menu-group">
          <div class="dgs-mobile-menu-group-label">${group.label}</div>
          <nav class="dgs-mobile-menu-links" aria-label="${group.label}">
            ${group.items
              .map(
                (item) =>
                  `<a href="${withApi(item.href)}" class="dgs-mobile-menu-link${item.id === activeId ? " active" : ""}">${item.label}</a>`
              )
              .join("")}
          </nav>
        </section>`
    ).join("");

    const account = document.getElementById("sidebar-account");
    if (account && !account.hidden) {
      menu.insertAdjacentHTML(
        "beforeend",
        `<section class="dgs-mobile-menu-group dgs-mobile-menu-account">
          <div class="dgs-mobile-menu-group-label">Account</div>
          <div class="dgs-mobile-menu-account-row">
            <span class="dgs-mobile-menu-user" id="dgs-mobile-user-label"></span>
            <button type="button" id="dgs-mobile-sign-out" class="dgs-mobile-signout">Sign out</button>
          </div>
        </section>`
      );
      const userLabel = document.getElementById("user-label");
      const mobileUser = document.getElementById("dgs-mobile-user-label");
      if (userLabel && mobileUser) mobileUser.textContent = userLabel.textContent;
      const mobileSignOut = document.getElementById("dgs-mobile-sign-out");
      const signOut = document.getElementById("btn-sign-out");
      if (mobileSignOut && signOut) {
        mobileSignOut.onclick = () => signOut.click();
      }
    }
  }

  function syncMobileTopNav(activeId) {
    if (!usesMobileTopNav()) return;
    ensureMobileTopNav();
    const bar = document.getElementById("dgs-mobile-topbar");
    if (!bar) return;
    if (!MOBILE_TOP_NAV_MQ.matches) {
      bar.hidden = true;
      document.body.classList.remove("dgs-mobile-top-nav-active", "dgs-mobile-menu-open");
      closeMobileMenu();
      return;
    }
    bar.hidden = false;
    document.body.classList.add("dgs-mobile-top-nav-active");
    renderMobileTopNav(activeId);
  }

  function wireMobileTopNav(activeId) {
    if (!usesMobileTopNav() || document.body.dataset.mobileTopNavWired) return;
    document.body.dataset.mobileTopNavWired = "1";

    document.addEventListener("click", (e) => {
      if (e.target.closest("#dgs-mobile-menu-btn")) {
        e.preventDefault();
        toggleMobileMenu();
        return;
      }
      const menu = document.getElementById("dgs-mobile-menu");
      if (!menu || menu.hidden) return;
      if (menu.contains(e.target)) {
        closeMobileMenu();
        return;
      }
      if (!e.target.closest(".dgs-mobile-topbar")) closeMobileMenu();
    });

    MOBILE_TOP_NAV_MQ.addEventListener("change", () => syncMobileTopNav(activeId));
  }

  function apiBase() {
    return window.DGSAuth ? DGSAuth.apiBase() : (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
  }

  function withApi(href) {
    const url = new URL(href, window.location.href);
    const api = params.get("api");
    if (!api) return url.pathname + url.search;
    if (!isLocalDev() && (api.includes("127.0.0.1") || api.includes("localhost"))) {
      return url.pathname + url.search;
    }
    url.searchParams.set("api", api);
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
    if (usesMobileTopNav()) {
      wireMobileTopNav(activeId);
      syncMobileTopNav(activeId);
    } else {
      document.body.classList.toggle("dgs-rail-collapsed", isRailCollapsed());
    }
    renderAppSidebar(activeId);
    wireRailToggle(activeId);
    if (window.DGSAuth) DGSAuth.renderAccount();
    if (usesMobileTopNav()) syncMobileTopNav(activeId);
    if (typeof onReady === "function") onReady();
  }

  window.DGS = {
    apiBase,
    withApi,
    renderAppSidebar,
    syncMobileTopNav,
    boot,
    initDashboardPage,
    setDashboardRoute,
    loadDashboardBundle,
    NAV_GROUPS,
  };
})();
