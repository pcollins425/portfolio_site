(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const RAIL_KEY = "dgs-rail-collapsed";
  const GROUPS_KEY = "dgs-nav-groups";

  const NAV_GROUPS = [
    {
      id: "revenue",
      label: "Dashboards",
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
        { id: "contracts", label: "Contracts", href: "contracts-v2.html", requireAnyOf: ["dgs_contracts"] },
        { id: "assets", label: "Assets", href: "assets-v2.html" },
      ],
    },
    {
      id: "commerce",
      label: "Commerce",
      items: [
        { id: "vendors", label: "Vendors", href: "vendors-v2.html" },
        { id: "casinos", label: "Casinos", href: "casinos-v2.html" },
        { id: "deals", label: "Deals", href: "deals-v2.html", requireAnyOf: ["dgs_deals"] },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [
        { id: "projects", label: "Projects", href: "projects.html" },
        {
          id: "project_workbench",
          label: "Project Workbench",
          href: "project-workbench.html",
          requireAnyOf: ["dgs_projects_workbench"],
        },
        {
          id: "software_vault",
          label: "Software Vault",
          href: "software-vault.html",
          requireAnyOf: ["dgs_software_vault"],
        },
      ],
    },
    {
      id: "finance",
      label: "Finance",
      items: [
        {
          id: "expenses",
          label: "Expenses",
          href: "expenses.html",
          requireAnyOf: ["expenses"],
        },
        {
          id: "expenses_mass",
          label: "Mass Edit",
          href: "expenses-mass-edit.html",
          requireAnyOf: ["dgs_expenses_mass_edit"],
        },
      ],
    },
    {
      id: "admin",
      label: "Admin",
      items: [
        {
          id: "employees_admin",
          label: "Employees",
          href: "employees-admin.html",
          requireAnyOf: ["employees", "roles"],
        },
      ],
    },
    {
      id: "workspace",
      label: "Workspace",
      items: [
        {
          id: "assistant",
          label: "Assistant",
          href: "assistant.html",
          requireAnyOf: ["dgs_assistant"],
        },
        {
          id: "mail_intake",
          label: "Mail Intake",
          href: "mail-intake.html",
          requireAnyOf: ["dgs_mail_intake"],
        },
      ],
    },
  ];

  const DASHBOARD_GROUPS = [
    {
      id: "executive",
      label: "Executive",
      items: [
        { route: "/executive", label: "Executive", requireArea: "dgs_performance" },
        { route: "/market", label: "Market", requireArea: "dgs_performance" },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [{ route: "/field", label: "Field", requireArea: "dgs_tech_dashboard" }],
    },
    {
      id: "performance",
      label: "Performance",
      items: [
        { route: "/performance", label: "Performance", requireArea: "dgs_performance" },
        { route: "/finance", label: "Commission", requireArea: "dgs_finance_dashboard" },
      ],
    },
    {
      id: "validation",
      label: "Validation",
      items: [
        { route: "/analyst", label: "Analyst", requireArea: "dgs_analyst" },
        { route: "/commission", label: "Identification", requireArea: "dgs_commission" },
      ],
    },
  ];

  const READ_LEVELS = {
    READ_ONLY: 1,
    UPDATES_ONLY: 1,
    ADDS_ONLY: 1,
    ADDS_AND_UPDATES: 1,
    ALL_CHANGES: 1,
  };

  let analystOpenMonths = 0;
  let commissionOpenMonths = 0;

  let dashboardBundlePromise = null;
  const MOBILE_TOP_NAV_MQ = window.matchMedia("(max-width: 900px)");

  function permissionMap() {
    const user = window.DGSAuth && DGSAuth.getUser && DGSAuth.getUser();
    return (user && user.permissions) || {};
  }

  function gatesActive() {
    return Boolean(window.DGSAuth && DGSAuth.isAuthRequired && DGSAuth.isAuthRequired());
  }

  function hasAreaRead(area) {
    if (!area) return true;
    if (!gatesActive()) return true;
    const level = permissionMap()[area];
    return Boolean(level && READ_LEVELS[level]);
  }

  function hasAnyAreaRead(areas) {
    if (!areas || !areas.length) return true;
    if (!gatesActive()) return true;
    return areas.some((a) => hasAreaRead(a));
  }

  function visibleNavGroups() {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => hasAnyAreaRead(item.requireAnyOf)),
    })).filter((group) => group.items.length > 0);
  }

  function visibleDashboardGroups() {
    return DASHBOARD_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.requireArea || hasAreaRead(item.requireArea)),
    })).filter((group) => group.items.length > 0);
  }

  function visibleDashboardNav() {
    return visibleDashboardGroups().flatMap((group) => group.items);
  }

  function dashboardItemLabel(item, withCount) {
    let label = item.label;
    if (!withCount) return label;
    if (item.route === "/analyst" && analystOpenMonths > 0) {
      label += ` (${analystOpenMonths})`;
    }
    if (item.route === "/commission" && commissionOpenMonths > 0) {
      label += ` (${commissionOpenMonths})`;
    }
    return label;
  }

  function activeDashboardRoute(fallback) {
    const nav = document.getElementById("dgs-dashboard-nav");
    return (
      nav?.querySelector(".active")?.getAttribute("data-route") ||
      nav?.querySelector("select")?.value ||
      fallback ||
      "/executive"
    );
  }

  function findNavItem(activeId) {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.id === activeId) return item;
      }
    }
    return null;
  }

  function showAccessDenied(message) {
    const main =
      document.querySelector(".dgs-main") ||
      document.querySelector("main") ||
      document.body;
    if (!main) return;
    const box = document.createElement("div");
    box.className = "error-box";
    box.style.margin = "1.5rem";
    box.setAttribute("role", "alert");
    box.textContent =
      message || "You do not have access to this area. Ask an admin if you need it.";
    main.prepend(box);
  }

  function pageAccessAllowed(activeId) {
    const item = findNavItem(activeId);
    if (!item) return true;
    if (!item.requireAnyOf) return true;
    return hasAnyAreaRead(item.requireAnyOf);
  }

  function usesMobileTopNav() {
    // Default on for all shell pages; opt out with body.dgs-no-mobile-top-nav.
    return !document.body.classList.contains("dgs-no-mobile-top-nav");
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
    if (!menu) return;

    menu.innerHTML = visibleNavGroups()
      .map(
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
    )
      .join("");

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

    for (const group of visibleNavGroups()) {
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
    const v2 = document.body.classList.contains("dgs-dashboard-v2");
    const phone = window.matchMedia("(max-width: 640px)").matches;
    nav.innerHTML = "";

    if (v2 && phone) {
      const sel = document.createElement("select");
      sel.className = "dgs-dashboard-view-select";
      sel.setAttribute("aria-label", "Dashboard views");
      for (const group of visibleDashboardGroups()) {
        const og = document.createElement("optgroup");
        og.label = group.label;
        for (const item of group.items) {
          const opt = document.createElement("option");
          opt.value = item.route;
          opt.textContent = dashboardItemLabel(item, true);
          if (item.route === activeRoute) opt.selected = true;
          og.appendChild(opt);
        }
        sel.appendChild(og);
      }
      sel.addEventListener("change", () => setDashboardRoute(sel.value));
      nav.appendChild(sel);
      return;
    }

    for (const group of visibleDashboardGroups()) {
      const wrap = document.createElement("div");
      wrap.className = "dgs-dashboard-group";
      const heading = document.createElement("span");
      heading.className = "dgs-dashboard-group-label";
      heading.textContent = group.label;
      wrap.appendChild(heading);
      const tabs = document.createElement("div");
      tabs.className = "dgs-dashboard-group-tabs";
      for (const item of group.items) {
        const el = document.createElement(v2 ? "button" : "a");
        if (!v2) el.href = "#";
        el.type = v2 ? "button" : undefined;
        el.textContent = item.label;
        el.dataset.route = item.route;
        if (item.route === activeRoute) el.classList.add("active");
        el.addEventListener("click", (e) => {
          e.preventDefault();
          setDashboardRoute(item.route);
        });
        if (item.route === "/analyst" && analystOpenMonths > 0) {
          const badge = document.createElement("span");
          badge.className = "dgs-analyst-badge";
          badge.textContent = String(analystOpenMonths);
          badge.title = `${analystOpenMonths} month${analystOpenMonths === 1 ? "" : "s"} with open intake flags`;
          el.appendChild(badge);
        }
        if (item.route === "/commission" && commissionOpenMonths > 0) {
          const badge = document.createElement("span");
          badge.className = "dgs-analyst-badge";
          badge.textContent = String(commissionOpenMonths);
          badge.title = `${commissionOpenMonths} month${commissionOpenMonths === 1 ? "" : "s"} with open identification flags`;
          el.appendChild(badge);
        }
        tabs.appendChild(el);
      }
      wrap.appendChild(tabs);
      nav.appendChild(wrap);
    }
  }

  function setAnalystOpenMonths(n) {
    const next = Math.max(0, Number(n) || 0);
    if (next === analystOpenMonths) return;
    analystOpenMonths = next;
    renderDashboardSubnav(activeDashboardRoute());
  }

  function setCommissionOpenMonths(n) {
    const next = Math.max(0, Number(n) || 0);
    if (next === commissionOpenMonths) return;
    commissionOpenMonths = next;
    renderDashboardSubnav(activeDashboardRoute());
  }

  function setDashboardRoute(route) {
    let normalized = route.startsWith("/") ? route : `/${route}`;
    const allowed = visibleDashboardNav().map((i) => i.route);
    if (!allowed.includes(normalized)) {
      normalized = allowed[0] || "/executive";
    }
    renderDashboardSubnav(normalized);
    if (normalized === "/field") {
      const root = document.getElementById("dashboard-root");
      if (window.DGSField) DGSField.load(root);
      if (window.history.replaceState) {
        const u = new URL(window.location.href);
        u.searchParams.set("view", "field");
        window.history.replaceState({}, "", u.pathname + u.search);
      }
      return;
    }
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
    const allowed = visibleDashboardNav();
    if (!allowed.length) {
      const nav = document.getElementById("dgs-dashboard-nav");
      const root = document.getElementById("dashboard-root");
      if (nav) nav.hidden = true;
      if (root) {
        root.innerHTML = '<p class="dgs-v2-pilot-note">No dashboard views for this account.</p>';
      }
      return;
    }
    const initial =
      "/" +
      (params.get("view") ||
        window.location.hash.replace(/^#\/?/, "") ||
        "executive");
    window.addEventListener("dgs-analyst-open-months", (e) => {
      setAnalystOpenMonths(e.detail);
    });
    window.addEventListener("dgs-commission-open-months", (e) => {
      setCommissionOpenMonths(e.detail);
    });
    const phoneMq = window.matchMedia("(max-width: 640px)");
    const onPhoneNavMode = () => {
      const nav = document.getElementById("dgs-dashboard-nav");
      const active = nav?.querySelector(".active")?.getAttribute("data-route")
        || nav?.querySelector("select")?.value
        || initial;
      renderDashboardSubnav(active);
    };
    if (phoneMq.addEventListener) phoneMq.addEventListener("change", onPhoneNavMode);
    else if (phoneMq.addListener) phoneMq.addListener(onPhoneNavMode);
    renderDashboardSubnav(initial);
    setDashboardRoute(initial);
  }

  function optionLabel(person) {
    const name = person.name || person.email || person.employee_id;
    return person.role ? `${name} · ${person.role}` : name;
  }

  async function renderDevView() {
    const existing = document.getElementById("dgs-dev-view");
    if (!window.DGSAuth || !DGSAuth.getCanViewAs || !DGSAuth.getCanViewAs()) {
      if (existing) existing.remove();
      document.body.classList.remove("dgs-dev-view-on");
      return;
    }
    let bar = existing;
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "dgs-dev-view";
      bar.className = "dgs-dev-view";
      bar.innerHTML = `
        <span class="dgs-dev-view-kicker">Dev view</span>
        <label class="dgs-dev-view-field">
          <span class="dgs-dev-view-caption">View as</span>
          <select id="dgs-dev-view-select"></select>
        </label>
        <span class="dgs-dev-view-note" id="dgs-dev-view-note"></span>
      `;
      document.body.prepend(bar);
      bar.querySelector("#dgs-dev-view-select").addEventListener("change", (event) => {
        DGSAuth.setViewAs(event.target.value);
      });
    }
    document.body.classList.add("dgs-dev-view-on");
    const syncOffset = () => {
      document.documentElement.style.setProperty("--dgs-dev-view-h", `${bar.offsetHeight}px`);
    };
    syncOffset();
    if (!bar.dataset.dgsOffsetWired) {
      bar.dataset.dgsOffsetWired = "1";
      window.addEventListener("resize", syncOffset);
    }
    const select = bar.querySelector("#dgs-dev-view-select");
    const note = bar.querySelector("#dgs-dev-view-note");
    const current = DGSAuth.getViewAs && DGSAuth.getViewAs();
    const actor = DGSAuth.getUser && DGSAuth.getUser();
    const myself = (actor && actor.name) || "Myself";
    select.innerHTML = "";
    const mine = document.createElement("option");
    mine.value = "";
    mine.textContent = myself;
    select.appendChild(mine);
    if (current && current.employee_id) {
      const held = document.createElement("option");
      held.value = current.employee_id;
      held.textContent = optionLabel(current);
      held.selected = true;
      select.appendChild(held);
      note.textContent = "Read-only. Switch back to yourself to make changes.";
      bar.classList.add("is-previewing");
    } else {
      note.textContent = "";
      bar.classList.remove("is-previewing");
    }
    try {
      const res = await fetch(`${DGSAuth.apiBase()}/api/dev/view-as/directory`, {
        headers: DGSAuth.authHeaders(),
      });
      if (!res.ok) throw new Error("directory unavailable");
      const data = await res.json();
      const people = (data && data.employees) || [];
      const selected = select.value;
      select.innerHTML = "";
      select.appendChild(mine);
      people.forEach((person) => {
        const opt = document.createElement("option");
        opt.value = person.employee_id;
        opt.textContent = optionLabel(person);
        if (person.email) opt.title = person.email;
        select.appendChild(opt);
      });
      select.value = selected;
      if (select.value !== selected && current && current.employee_id) {
        const held = document.createElement("option");
        held.value = current.employee_id;
        held.textContent = optionLabel(current);
        select.appendChild(held);
        select.value = current.employee_id;
      }
    } catch (_err) {
      /* picker still has the current person; exit stays available */
    }
    syncOffset();
  }

  async function boot(activeId, onReady) {
    if (window.DGSAuth && !(await DGSAuth.ensureAuth())) return;
    await renderDevView();
    // Rail collapse is desktop-only; mobile top nav hides the sidebar ≤900px.
    document.body.classList.toggle("dgs-rail-collapsed", isRailCollapsed());
    if (usesMobileTopNav()) {
      wireMobileTopNav(activeId);
      syncMobileTopNav(activeId);
    }
    document.body.classList.toggle("dgs-hide-performance", !hasAreaRead("dgs_performance"));
    document.body.classList.toggle("dgs-hide-deals", !hasAreaRead("dgs_deals"));
    document.body.classList.toggle("dgs-hide-workbench", !hasAreaRead("dgs_projects_workbench"));
    renderAppSidebar(activeId);
    wireRailToggle(activeId);
    if (window.DGSAuth) DGSAuth.renderAccount();
    if (usesMobileTopNav()) syncMobileTopNav(activeId);
    if (!pageAccessAllowed(activeId)) {
      const preview = window.DGSAuth && DGSAuth.getViewAs && DGSAuth.getViewAs();
      showAccessDenied(
        preview && preview.name
          ? `${preview.name} does not have access to this area.`
          : undefined
      );
      return;
    }
    if (typeof onReady === "function") onReady();
  }

  /** Shared infinite scroll — Casinos first; reuse on other v2 lists. */
  function bindInfiniteScroll(root, opts) {
    const sentinel = opts && opts.sentinel;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") {
      return { disconnect() {} };
    }
    let busy = false;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (busy || (opts.isBusy && opts.isBusy())) return;
        if (opts.hasMore && !opts.hasMore()) return;
        busy = true;
        try {
          if (typeof opts.loadMore === "function") await opts.loadMore();
        } finally {
          busy = false;
        }
      },
      { root, rootMargin: (opts && opts.rootMargin) || "240px", threshold: 0 }
    );
    io.observe(sentinel);
    return {
      disconnect() {
        io.disconnect();
      },
    };
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
    bindInfiniteScroll,
    hasAreaRead,
    hasAnyAreaRead,
    NAV_GROUPS,
  };
})();
