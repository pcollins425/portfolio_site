(function () {
  "use strict";

  var signedIn = false;

  function appDir() {
    var path = window.location.pathname;
    var marker = "/dgsappv1/";
    var at = path.indexOf(marker);
    if (at !== -1) return path.slice(0, at + marker.length);
    var guide = path.indexOf("/guide/");
    if (guide !== -1) return path.slice(0, guide + 1);
    return path.replace(/[^/]*$/, "");
  }

  function dashboardUrl() {
    return (
      window.location.origin +
      appDir() +
      "dashboard.html?api=" +
      encodeURIComponent(DGSAuth.apiBase())
    );
  }

  function showError() {
    var params = new URLSearchParams(window.location.search);
    var err = params.get("error");
    var node = document.getElementById("home-error");
    if (!err || !node) return;
    node.textContent = err;
    node.hidden = false;
  }

  function markSignedIn() {
    signedIn = true;
    document.querySelectorAll("[data-sign-in]").forEach(function (btn) {
      btn.textContent = "Open the application";
    });
    var hint = document.getElementById("home-hint");
    if (hint) hint.textContent = "You're signed in.";
  }

  document.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-sign-in]");
    if (!btn) return;
    if (signedIn) {
      window.location.href = dashboardUrl();
      return;
    }
    var start =
      DGSAuth.apiBase() +
      "/api/auth/google/start?return_to=" +
      encodeURIComponent(dashboardUrl());
    window.location.href = start;
  });

  showError();

  if (DGSAuth.getToken()) {
    fetch(DGSAuth.apiBase() + "/api/auth/me", { headers: DGSAuth.authHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error("no session");
        return res.json();
      })
      .then(markSignedIn)
      .catch(function () {});
  }

  initConnectionCycle();
})();

/**
 * Synthetic closed walk for the public home page.
 * Asset → Floor → Casino → Available vendors → Vendor → Theme → Active assets → Asset
 */
function initConnectionCycle() {
  "use strict";

  var root = document.querySelector("[data-home-cycle]");
  if (!root) return;

  var panel = root.querySelector("[data-cycle-panel]");
  var caption = root.querySelector("[data-cycle-caption]");
  var linkto = root.querySelector("[data-cycle-linkto]");
  var progress = root.querySelector("[data-cycle-progress]");
  var railButtons = root.querySelectorAll("[data-cycle-step]");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var intervalMs = reduceMotion ? 0 : 6500;
  var timer = null;
  var index = 0;
  var paused = false;

  var world = {
    casino: {
      name: "River Bend Casino",
      id: "CT-DEMO01",
      tribe: "River Bend Nation",
      state: "Minnesota",
      floorUnits: 48,
    },
    vendors: [
      { id: "VT-DEMO03", name: "Northstar Gaming", focus: true },
      { id: "VT-DEMO11", name: "Lakeview Systems", focus: false },
    ],
    vendor: {
      id: "VT-DEMO03",
      name: "Northstar Gaming",
      cabinet: "Horizon 27",
    },
    theme: {
      id: "TH-DEMO88",
      name: "Midnight Rapids",
      vendor: "Northstar Gaming",
      activeAssets: 2,
    },
    assets: [
      {
        id: "A-DEMO1042",
        serial: "NS-882401",
        cabinet: "Horizon 27",
        theme: "Midnight Rapids",
        bank: "12",
        seat: "3",
        focus: true,
      },
      {
        id: "A-DEMO1043",
        serial: "NS-882402",
        cabinet: "Horizon 27",
        theme: "Midnight Rapids",
        bank: "12",
        seat: "4",
        focus: false,
      },
    ],
    floor: {
      label: "Slot Master install",
      key: "SMM-DEMO0194",
      action: "INSTALL",
      status: "Active",
      bank: "12",
      seat: "3",
    },
  };

  var focusAsset = world.assets[0];

  var steps = [
    {
      kind: "asset",
      rail: 0,
      caption:
        "Start on a physical asset — the cabinet on the floor, with its own identity.",
      linkto: "Links to the Slot Master install on this floor →",
      html: function () {
        return entityCard("asset", "Asset", focusAsset.id, focusAsset.serial, [
          ["Serial", focusAsset.serial],
          ["Cabinet", focusAsset.cabinet],
          ["Theme", focusAsset.theme],
          ["Location", world.casino.name],
        ]);
      },
    },
    {
      kind: "floor",
      rail: 1,
      caption:
        "The floor record is the install: where that asset sits, and that it is live.",
      linkto: "That install belongs to a casino →",
      html: function () {
        return entityCard(
          "floor",
          "Slot Master",
          world.floor.key,
          world.floor.label,
          [
            ["Asset", focusAsset.id],
            ["Action", world.floor.action],
            ["Status", world.floor.status],
            ["Bank / seat", world.floor.bank + " / " + world.floor.seat],
          ]
        );
      },
    },
    {
      kind: "casino",
      rail: 2,
      caption:
        "The property is not a folder of spreadsheets — it is the customer the floor hangs on.",
      linkto: "Open which vendors this casino can run →",
      html: function () {
        return entityCard(
          "casino",
          "Casino",
          world.casino.id,
          world.casino.name,
          [
            ["Tribe", world.casino.tribe],
            ["State", world.casino.state],
            ["Active units", String(world.casino.floorUnits)],
            ["Focus asset", focusAsset.serial],
          ]
        );
      },
    },
    {
      kind: "vendors",
      rail: 3,
      caption:
        "Available vendors are a commercial fact on the casino — who is allowed on this floor.",
      linkto: "Step into one of those vendors →",
      html: function () {
        var chips = world.vendors
          .map(function (v) {
            return (
              "<li" +
              (v.focus ? ' class="is-focus"' : "") +
              ">" +
              escapeHtml(v.name) +
              "</li>"
            );
          })
          .join("");
        return (
          '<article class="home-cycle-card" data-kind="vendors">' +
          '<p class="home-cycle-kicker">Available vendors</p>' +
          "<h3>" +
          escapeHtml(world.casino.name) +
          "</h3>" +
          '<p class="home-cycle-sub">Rights on this property · sample list</p>' +
          '<ul class="home-cycle-chips">' +
          chips +
          "</ul>" +
          "</article>"
        );
      },
    },
    {
      kind: "vendor",
      rail: 4,
      caption:
        "A vendor is more than a logo — cabinets and themes hang under that name.",
      linkto: "Open a theme from this vendor →",
      html: function () {
        return entityCard(
          "vendor",
          "Vendor",
          world.vendor.id,
          world.vendor.name,
          [
            ["Cabinet line", world.vendor.cabinet],
            ["Theme ahead", world.theme.name],
            ["At casino", world.casino.name],
            ["On rights list", "Yes"],
          ]
        );
      },
    },
    {
      kind: "theme",
      rail: 5,
      caption:
        "The theme is what the customer recognizes — and it already knows its active assets.",
      linkto: "See which assets are live on this theme →",
      html: function () {
        return entityCard(
          "theme",
          "Theme",
          world.theme.id,
          world.theme.name,
          [
            ["Vendor", world.theme.vendor],
            ["Active assets", String(world.theme.activeAssets)],
            ["Cabinet", world.vendor.cabinet],
            ["Property", world.casino.name],
          ]
        );
      },
    },
    {
      kind: "theme_assets",
      rail: 6,
      caption:
        "Active assets on the theme close the loop — including the machine you started on.",
      linkto: "Back to the asset you started with →",
      html: function () {
        var rows = world.assets
          .map(function (a) {
            return (
              "<li" +
              (a.focus ? ' class="is-focus"' : "") +
              "><strong>" +
              escapeHtml(a.id) +
              "</strong><span>" +
              escapeHtml(a.serial) +
              " · bank " +
              escapeHtml(a.bank) +
              " seat " +
              escapeHtml(a.seat) +
              "</span></li>"
            );
          })
          .join("");
        return (
          '<article class="home-cycle-card" data-kind="theme_assets">' +
          '<p class="home-cycle-kicker">Active assets</p>' +
          "<h3>" +
          escapeHtml(world.theme.name) +
          "</h3>" +
          '<p class="home-cycle-sub">Live on ' +
          escapeHtml(world.casino.name) +
          "</p>" +
          '<ul class="home-cycle-list">' +
          rows +
          "</ul>" +
          "</article>"
        );
      },
    },
  ];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function entityCard(kind, kicker, id, title, fields) {
    var pairs = fields
      .map(function (pair) {
        return (
          "<div><dt>" +
          escapeHtml(pair[0]) +
          "</dt><dd>" +
          escapeHtml(pair[1]) +
          "</dd></div>"
        );
      })
      .join("");
    return (
      '<article class="home-cycle-card" data-kind="' +
      escapeHtml(kind) +
      '">' +
      '<p class="home-cycle-kicker">' +
      escapeHtml(kicker) +
      "</p>" +
      "<h3>" +
      escapeHtml(title) +
      "</h3>" +
      '<p class="home-cycle-sub">' +
      escapeHtml(id) +
      "</p>" +
      '<dl class="home-cycle-grid">' +
      pairs +
      "</dl>" +
      "</article>"
    );
  }

  function render() {
    var step = steps[index];
    panel.innerHTML = step.html();
    caption.textContent = step.caption;
    linkto.textContent = step.linkto;
    progress.textContent = index + 1 + " / " + steps.length;
    railButtons.forEach(function (btn) {
      var stepIndex = Number(btn.getAttribute("data-cycle-step"));
      if (stepIndex === step.rail) {
        btn.setAttribute("aria-current", "step");
      } else {
        btn.removeAttribute("aria-current");
      }
    });
  }

  function go(next) {
    index = (next + steps.length) % steps.length;
    render();
  }

  function stopAuto() {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function startAuto() {
    stopAuto();
    if (!intervalMs || paused) return;
    timer = window.setInterval(function () {
      go(index + 1);
    }, intervalMs);
  }

  function pauseForUser() {
    paused = true;
    root.classList.add("is-paused");
    stopAuto();
  }

  function resumeLater() {
    window.clearTimeout(root._homeCycleResume);
    root._homeCycleResume = window.setTimeout(function () {
      paused = false;
      root.classList.remove("is-paused");
      startAuto();
    }, 12000);
  }

  root.querySelector("[data-cycle-prev]").addEventListener("click", function () {
    pauseForUser();
    go(index - 1);
    resumeLater();
  });

  root.querySelector("[data-cycle-next]").addEventListener("click", function () {
    pauseForUser();
    go(index + 1);
    resumeLater();
  });

  railButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      pauseForUser();
      go(Number(btn.getAttribute("data-cycle-step")));
      resumeLater();
    });
  });

  root.addEventListener("mouseenter", function () {
    stopAuto();
  });

  root.addEventListener("mouseleave", function () {
    if (!paused) startAuto();
  });

  root.addEventListener("focusin", function () {
    stopAuto();
  });

  root.addEventListener("focusout", function (event) {
    if (!root.contains(event.relatedTarget) && !paused) startAuto();
  });

  render();
  startAuto();
}
