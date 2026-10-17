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
 * 3D circular carousel of synthetic detail pages.
 * Asset → Floor → Casino → Available vendors → Vendor → Theme → Active assets → Asset
 */
function initConnectionCycle() {
  "use strict";

  var root = document.querySelector("[data-home-cycle]");
  if (!root) return;

  var scene = root.querySelector("[data-cycle-orbit]");
  var track = root.querySelector("[data-cycle-track]");
  var caption = root.querySelector("[data-cycle-caption]");
  var linkto = root.querySelector("[data-cycle-linkto]");
  var progress = root.querySelector("[data-cycle-progress]");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var intervalMs = reduceMotion ? 0 : 7000;
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
      label: "Asset",
      title: focusAsset.serial,
      id: focusAsset.id,
      caption:
        "Start on a physical asset — the cabinet on the floor, with its own identity.",
      linkto: "Links to the Slot Master install on this floor →",
      body: function () {
        return (
          fieldsHtml([
            ["Serial", focusAsset.serial],
            ["Cabinet", focusAsset.cabinet],
            ["Theme", focusAsset.theme],
            ["Location", world.casino.name],
          ]) +
          '<p class="home-cycle-page-note">Identity for the machine on the floor.</p>'
        );
      },
    },
    {
      kind: "floor",
      label: "Slot Master",
      title: world.floor.label,
      id: world.floor.key,
      caption:
        "The floor record is the install: where that asset sits, and that it is live.",
      linkto: "That install belongs to a casino →",
      body: function () {
        return fieldsHtml([
          ["Asset", focusAsset.id],
          ["Action", world.floor.action],
          ["Status", world.floor.status],
          ["Bank / seat", world.floor.bank + " / " + world.floor.seat],
          ["Casino", world.casino.name],
        ]);
      },
    },
    {
      kind: "casino",
      label: "Casino",
      title: world.casino.name,
      id: world.casino.id,
      caption:
        "The property is not a folder of spreadsheets — it is the customer the floor hangs on.",
      linkto: "Open which vendors this casino can run →",
      body: function () {
        return fieldsHtml([
          ["Tribe", world.casino.tribe],
          ["State", world.casino.state],
          ["Active units", String(world.casino.floorUnits)],
          ["Focus asset", focusAsset.serial],
        ]);
      },
    },
    {
      kind: "vendors",
      label: "Available vendors",
      title: world.casino.name,
      id: "Rights on this property",
      caption:
        "Available vendors are a commercial fact on the casino — who is allowed on this floor.",
      linkto: "Step into one of those vendors →",
      body: function () {
        var chips = world.vendors
          .map(function (v) {
            return (
              "<li" +
              (v.focus ? ' class="is-focus"' : "") +
              ">" +
              escapeHtml(v.name) +
              "<span>" +
              escapeHtml(v.id) +
              "</span></li>"
            );
          })
          .join("");
        return (
          '<ul class="home-cycle-chips home-cycle-chips-stack">' +
          chips +
          "</ul>"
        );
      },
    },
    {
      kind: "vendor",
      label: "Vendor",
      title: world.vendor.name,
      id: world.vendor.id,
      caption:
        "A vendor is more than a logo — cabinets and themes hang under that name.",
      linkto: "Open a theme from this vendor →",
      body: function () {
        return fieldsHtml([
          ["Cabinet line", world.vendor.cabinet],
          ["Theme ahead", world.theme.name],
          ["At casino", world.casino.name],
          ["On rights list", "Yes"],
        ]);
      },
    },
    {
      kind: "theme",
      label: "Theme",
      title: world.theme.name,
      id: world.theme.id,
      caption:
        "The theme is what the customer recognizes — and it already knows its active assets.",
      linkto: "See which assets are live on this theme →",
      body: function () {
        return fieldsHtml([
          ["Vendor", world.theme.vendor],
          ["Active assets", String(world.theme.activeAssets)],
          ["Cabinet", world.vendor.cabinet],
          ["Property", world.casino.name],
        ]);
      },
    },
    {
      kind: "theme_assets",
      label: "Active assets",
      title: world.theme.name,
      id: "Live on this theme",
      caption:
        "Active assets on the theme close the loop — including the machine you started on.",
      linkto: "Back to the asset you started with →",
      body: function () {
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
        return '<ul class="home-cycle-list">' + rows + "</ul>";
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

  function fieldsHtml(fields) {
    return (
      '<dl class="home-cycle-grid">' +
      fields
        .map(function (pair) {
          return (
            "<div><dt>" +
            escapeHtml(pair[0]) +
            "</dt><dd>" +
            escapeHtml(pair[1]) +
            "</dd></div>"
          );
        })
        .join("") +
      "</dl>"
    );
  }

  function pageRadius() {
    var page = track.querySelector(".home-cycle-page");
    var width = page ? page.offsetWidth : 300;
    var count = steps.length;
    var halfAngle = Math.PI / count;
    return Math.round(width / 2 / Math.tan(halfAngle)) + 24;
  }

  function applyRadius() {
    scene.style.setProperty("--cycle-tz", pageRadius() + "px");
  }

  function buildPages() {
    var count = steps.length;
    scene.style.setProperty("--cycle-count", String(count));
    track.innerHTML = steps
      .map(function (step, i) {
        return (
          '<article class="home-cycle-page" data-cycle-step="' +
          i +
          '" data-kind="' +
          escapeHtml(step.kind) +
          '" style="--i:' +
          i +
          '" role="button" tabindex="0" aria-label="' +
          escapeHtml(step.label + ": " + step.title) +
          '">' +
          '<div class="home-cycle-page-chrome">' +
          '<p class="home-cycle-kicker">' +
          escapeHtml(step.label) +
          "</p>" +
          '<p class="home-cycle-page-id">' +
          escapeHtml(step.id) +
          "</p>" +
          "</div>" +
          "<h3>" +
          escapeHtml(step.title) +
          "</h3>" +
          '<div class="home-cycle-page-body">' +
          step.body() +
          "</div>" +
          "</article>"
        );
      })
      .join("");
    applyRadius();
  }

  function render() {
    var step = steps[index];
    var count = steps.length;
    scene.style.setProperty("--cycle-index", String(index));
    caption.textContent = step.caption;
    linkto.textContent = step.linkto;
    progress.textContent = index + 1 + " / " + count;

    root.querySelectorAll("[data-cycle-step]").forEach(function (node) {
      var stepIndex = Number(node.getAttribute("data-cycle-step"));
      var active = stepIndex === index;
      node.classList.toggle("is-active", active);
      if (active) {
        node.setAttribute("aria-current", "step");
      } else {
        node.removeAttribute("aria-current");
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

  function selectStep(stepIndex) {
    pauseForUser();
    go(stepIndex);
    resumeLater();
  }

  buildPages();

  root.querySelector("[data-cycle-prev]").addEventListener("click", function () {
    selectStep(index - 1);
  });

  root.querySelector("[data-cycle-next]").addEventListener("click", function () {
    selectStep(index + 1);
  });

  track.addEventListener("click", function (event) {
    var page = event.target.closest("[data-cycle-step]");
    if (!page || !track.contains(page)) return;
    selectStep(Number(page.getAttribute("data-cycle-step")));
  });

  track.addEventListener("keydown", function (event) {
    var page = event.target.closest("[data-cycle-step]");
    if (!page) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectStep(Number(page.getAttribute("data-cycle-step")));
    }
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

  window.addEventListener("resize", function () {
    applyRadius();
  });

  render();
  startAuto();
}
