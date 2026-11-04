/**
 * Collins Media capability catalog — source for shop shelves + inquire mix.
 * Production apps link only to public doors; gated features stay behind auth.
 * Keep general copy industry-neutral; industry detail belongs on app case pages.
 */
window.CM_CATALOG = {
  inquireEmail: "hello@collinsmediallc.com",
  apps: [
    {
      id: "dgs-operations",
      name: "DGS Operations",
      status: "production",
      blurb:
        "Customer, inventory, projects, and field work in one ops shell — live on this domain. Public door open; staff sign-in for authorized people only.",
      href: "/apps/dgs-operations.html",
      liveHref: "/dgsappv1/",
      tags: ["ops", "production", "auth-gated"],
      functions: [
        "auth-roles",
        "warehouse-pivot",
        "performance-views",
        "projects-workflow",
        "work-orders",
        "document-hubs",
        "on-prem-data",
      ],
    },
  ],
  functions: [
    {
      id: "auth-roles",
      name: "Staff sign-in & role gates",
      blurb:
        "Google OAuth for company email, JWT sessions, and per-area permissions so the public can browse the door while only approved staff open the tools.",
      href: "/functions/auth-roles.html",
      tags: ["ops", "security"],
      proof: "DGS Operations staff sign-in",
    },
    {
      id: "warehouse-pivot",
      name: "Inventory location pivot",
      blurb:
        "Item × location matrix with drill-down to unit lists and directory-gated email export — built for people who live in the counts, not spreadsheets.",
      href: "/functions/warehouse-pivot.html",
      tags: ["ops", "data", "field"],
      proof: "DGS Operations inventory module",
    },
    {
      id: "performance-views",
      name: "Performance dashboards",
      blurb:
        "Month matrices, leaders, and site drill paths that stay tied to the same assets, products, and installs your ops records already know.",
      href: "/functions/performance-views.html",
      tags: ["ops", "data"],
      proof: "DGS Operations performance views",
    },
    {
      id: "projects-workflow",
      name: "Projects calendar & catalog",
      blurb:
        "Schedule, work lists, and catalog notation on the same records as the assets and sites — so the job that changed operations sits next to the result.",
      href: "/functions/projects-workflow.html",
      tags: ["ops", "field"],
      proof: "DGS Operations projects module",
    },
    {
      id: "work-orders",
      name: "Work orders",
      blurb:
        "Open work, materials, and staff-scoped lists that respect routes and permissions — field work without a second source of truth.",
      href: "/functions/work-orders.html",
      tags: ["ops", "field"],
      proof: "DGS Operations work orders",
    },
    {
      id: "document-hubs",
      name: "Record-linked document hubs",
      blurb:
        "Auth-aware document open paths for contracts, compliance packs, and product media — find the file from the record, not a shared-drive scavenger hunt.",
      href: "/functions/document-hubs.html",
      tags: ["ops", "data"],
      proof: "DGS Operations document hubs",
    },
    {
      id: "on-prem-data",
      name: "On-prem data door",
      blurb:
        "Static pages on the edge; system of record on your servers. Same hostname can door multiple tenants without mixing their databases.",
      href: "/functions/on-prem-data.html",
      tags: ["ops", "security", "data"],
      proof: "collinsmediallc.com → local API tunnel",
    },
  ],
  services: [
    {
      id: "custom-ops-app",
      name: "Custom ops web app",
      blurb:
        "Design and ship a browser app for your warehouse, office, or field team — modules you pick, auth you control, data where you want it.",
      tags: ["build"],
    },
    {
      id: "data-automation",
      name: "Data & process automation",
      blurb:
        "Ingest, normalize, and load the reports and feeds your month depends on — Python, SQL, and guardrails that survive real vendor files.",
      tags: ["data", "build"],
    },
    {
      id: "stack-migration",
      name: "Low-code → SQL / app migration",
      blurb:
        "Move past low-code constraints into relational models and a real UI without losing the workflows people already trust.",
      tags: ["build", "data"],
    },
    {
      id: "dashboards",
      name: "Dashboards & reporting surfaces",
      blurb:
        "Executive and field views over the same records — fast enough to open in a meeting, honest enough to defend.",
      tags: ["ops", "data"],
    },
  ],
  resume: {
    name: "Paul Collins",
    role: "Web & app developer · Collins Media, LLC",
    lead:
      "I build operations software for people who move inventory, customers, and maintenance — not demo decks. Production work lives on this domain; the shop is how you assemble what you need next.",
    claims: [
      {
        label: "Ops UI in production",
        detail: "Unified operations application: inventory, performance, projects, contracts, field tools.",
        href: "/apps/dgs-operations.html",
      },
      {
        label: "Pipelines that survive vendor files",
        detail: "Report intake, normalization, and SQL-backed loads with dry-run discipline.",
        href: "/shop.html#services",
      },
      {
        label: "Edge + on-prem split",
        detail: "Cloudflare static front door, API and databases on your side of the tunnel.",
        href: "/functions/on-prem-data.html",
      },
      {
        label: "Stack",
        detail: "Python, SQL Server, FastAPI, vanilla JS & React, Docker, Cloudflare Workers, low-code when it still fits.",
        href: "/about.html",
      },
    ],
  },
};
