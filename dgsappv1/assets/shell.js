(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  function apiBase() {
    return (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
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

  function dashboardOrigin() {
    if (isLocalDev()) return "http://localhost:5173";
    return new URL("dashboard/", window.location.href).href.replace(/\/$/, "");
  }

  function dashboardFramePath(route) {
    const path = route.startsWith("/") ? route : `/${route}`;
    return `${dashboardOrigin()}${path}`;
  }

  const APP_NAV = [
    { id: "dashboard", label: "Dashboard", href: "dashboard.html" },
    { id: "warehouse", label: "Warehouse", href: "warehouse.html" },
    { id: "operations", label: "Operations", href: "operations.html?t=projects" },
  ];

  const DASHBOARD_NAV = [
    { route: "/executive", label: "Executive" },
    { route: "/analyst", label: "Analyst" },
    { route: "/finance", label: "Finance" },
    { route: "/performance", label: "Performance" },
  ];

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
    const frame = document.getElementById("dashboard-frame");
    if (frame) frame.src = dashboardFramePath(route);
    renderDashboardSubnav(route);
    if (window.history.replaceState) {
      const u = new URL(window.location.href);
      u.searchParams.set("view", route.replace(/^\//, ""));
      window.history.replaceState({}, "", u.pathname + u.search);
    }
  }

  function initDashboardPage() {
    renderAppSidebar("dashboard");
    const initial =
      "/" +
      (params.get("view") ||
        window.location.hash.replace(/^#\/?/, "") ||
        "executive");
    renderDashboardSubnav(initial);
    setDashboardRoute(initial);
  }

  function wireAccountSlot() {
    const slot = document.getElementById("sidebar-account");
    const opsSlot = document.getElementById("dgs-ops-account");
    if (!slot || !opsSlot) return;
    const mo = new MutationObserver(() => {
      slot.hidden = opsSlot.hidden;
      slot.innerHTML = opsSlot.innerHTML;
    });
    mo.observe(opsSlot, { childList: true, subtree: true, attributes: true });
    slot.hidden = opsSlot.hidden;
    slot.innerHTML = opsSlot.innerHTML;
  }

  window.DGS = {
    apiBase,
    withApi,
    renderAppSidebar,
    initDashboardPage,
    wireAccountSlot,
    dashboardFramePath,
  };
})();
