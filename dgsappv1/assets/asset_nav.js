(function () {
  "use strict";

  function pageUrl(path, params) {
    let base;
    if (window.DGS && typeof DGS.withApi === "function") {
      base = DGS.withApi(path);
    } else {
      base = path;
    }
    if (!params || !Object.keys(params).length) {
      return base;
    }
    const url = new URL(base, window.location.href);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && String(value).trim() !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return url.pathname + url.search;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.DGSAssetNav = {
    hubHref(assetId) {
      const id = String(assetId || "").trim();
      if (!id) return "";
      return pageUrl("asset-hub.html", { id });
    },

    assetsHref(opts) {
      opts = opts || {};
      if (opts.compid) {
        return pageUrl("assets-v2.html", { compid: opts.compid });
      }
      if (opts.assetId) {
        return pageUrl("assets-v2.html", { asset: opts.assetId });
      }
      return pageUrl("assets-v2.html");
    },

    linkHtml(href, label, className) {
      if (!href) return esc(label || "—");
      return `<a class="${className || "dgs-v2-hub-serial-link"}" href="${esc(href)}">${esc(label)}</a>`;
    },

    hubLinkHtml(assetId, label, className) {
      const id = String(assetId || "").trim();
      if (!id) return esc(label || "—");
      return this.linkHtml(this.hubHref(id), label || id, className);
    },

    hubActionHtml(assetId, label) {
      const href = this.hubHref(assetId);
      if (!href) return "";
      return `<a class="dgs-v2-hub-tile-link dgs-v2-asset-nav-action" href="${esc(href)}">${esc(
        label || "Go to Asset hub →"
      )}</a>`;
    },

    assetsActionHtml(opts, label) {
      const href = this.assetsHref(opts);
      if (!href) return "";
      return `<a class="dgs-v2-hub-tile-link dgs-v2-asset-nav-action" href="${esc(href)}">${esc(
        label || "Go to Assets →"
      )}</a>`;
    },
  };
})();
