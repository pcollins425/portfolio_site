(function () {
  "use strict";

  var signedIn = false;

  function dashboardUrl() {
    var path = window.location.pathname;
    if (/index\.html$/i.test(path)) path = path.replace(/index\.html$/i, "dashboard.html");
    else if (path.endsWith("/")) path = path + "dashboard.html";
    else path = path + "/dashboard.html";
    return (
      window.location.origin +
      path +
      "?api=" +
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

  if (!DGSAuth.getToken()) return;
  fetch(DGSAuth.apiBase() + "/api/auth/me", { headers: DGSAuth.authHeaders() })
    .then(function (res) {
      if (!res.ok) throw new Error("no session");
      return res.json();
    })
    .then(markSignedIn)
    .catch(function () {});
})();
