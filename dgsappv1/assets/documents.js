(function () {
  "use strict";

  var prompt = document.getElementById("doc-account-prompt");
  if (!window.DGSAuth || !DGSAuth.getToken()) return;

  fetch(DGSAuth.apiBase() + "/api/account-guide", { headers: DGSAuth.authHeaders() })
    .then(function (res) {
      if (!res.ok) throw new Error("no account guide");
      return res.json();
    })
    .then(function (data) {
      var sections = (data && data.sections) || {};
      var any = false;
      document.querySelectorAll("[data-account]").forEach(function (node) {
        var key = node.getAttribute("data-account");
        var paras = sections[key];
        if (!paras || !paras.length) return;
        var body = node.querySelector(".doc-account-body");
        if (!body) return;
        paras.forEach(function (text) {
          var p = document.createElement("p");
          p.textContent = text;
          body.appendChild(p);
        });
        node.hidden = false;
        any = true;
      });
      if (any && prompt) prompt.hidden = true;
    })
    .catch(function () {});
})();
