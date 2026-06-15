(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

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

  const APP_NAV = [
    { id: "dashboard", label: "Dashboard", href: "dashboard.html" },
    { id: "slot_master", label: "Slot Master", href: "slot_master.html" },
    { id: "contracts", label: "Contracts", href: "contracts.html" },
    { id: "warehouse", label: "Warehouse", href: "warehouse.html" },
    { id: "expenses", label: "Expenses", href: "expenses.html" },
    { id: "operations", label: "Operations", href: "operations.html?t=projects" },
  ];

  const DASHBOARD_NAV = [
    { route: "/executive", label: "Executive" },
    { route: "/analyst", label: "Analyst" },
    { route: "/finance", label: "Finance" },
    { route: "/performance", label: "Performance" },
  ];

  let dashboardBundlePromise = null;

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

  function renderAppSidebar(activeId) {
    const nav = document.getElementById("dgs-app-nav");
    if (!nav) return;
    nav.innerHTML = "";
    for (const item of APP_NAV) {
      const a = document.createElement("a");
      a.href = withApi(item.href);
      a.textContent = item.label;
      if (item.id === activeId) a.classList.add("active");
      nav.appendChild(a);
    }
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

  /** Gate the whole app behind Google auth, then run page setup. */
  async function boot(activeId, onReady) {
    if (window.DGSAuth && !(await DGSAuth.ensureAuth())) return;
    renderAppSidebar(activeId);
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
  };
})();
