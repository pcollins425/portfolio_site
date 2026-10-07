(function () {
  "use strict";

  const AUTH_TOKEN_KEY = "emaint_demo_token";
  const VIEW_AS_KEY = "dgs_view_as";
  const PRODUCTION_API = "https://api.collinsmediallc.com";
  const LOCAL_API = "http://127.0.0.1:9002";
  const params = new URLSearchParams(window.location.search);

  const state = {
    authRequired: false,
    user: null,
    canViewAs: false,
    viewAs: null,
  };

  function isLocalFrontend() {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1";
  }

  function isLocalApi(url) {
    return /\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
  }

  function resolveApiBase(raw) {
    const base = (raw || "").replace(/\/$/, "");
    if (!base) return isLocalFrontend() ? LOCAL_API : PRODUCTION_API;
    if (!isLocalFrontend() && isLocalApi(base)) return PRODUCTION_API;
    return base;
  }

  function apiBase() {
    return resolveApiBase(params.get("api"));
  }

  function stripStaleLocalApiParam() {
    const raw = params.get("api");
    if (!raw || isLocalFrontend() || !isLocalApi(raw)) return;
    params.delete("api");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }

  function getToken() {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  }

  function setToken(token) {
    if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    else sessionStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function captureAuthTokenFromUrl() {
    const token = params.get("auth_token");
    if (!token) return;
    setToken(token);
    params.delete("auth_token");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState({}, "", next);
  }

  function loginPageUrl(returnTo) {
    const dest =
      returnTo || `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    return `login.html?api=${encodeURIComponent(apiBase())}&return_to=${encodeURIComponent(dest)}`;
  }

  function appDir() {
    const path = window.location.pathname;
    const marker = "/dgsappv1/";
    const at = path.indexOf(marker);
    if (at !== -1) return path.slice(0, at + marker.length);
    const guide = path.indexOf("/guide/");
    if (guide !== -1) return path.slice(0, guide + 1);
    return path.replace(/[^/]*$/, "");
  }

  function homePageUrl() {
    const api = params.get("api");
    const qs = api ? `?api=${encodeURIComponent(apiBase())}` : "";
    return `${window.location.origin}${appDir()}index.html${qs}`;
  }

  function viewAsId() {
    return (sessionStorage.getItem(VIEW_AS_KEY) || "").trim();
  }

  function setViewAs(id) {
    const next = (id || "").trim();
    if (next) sessionStorage.setItem(VIEW_AS_KEY, next);
    else sessionStorage.removeItem(VIEW_AS_KEY);
    window.location.reload();
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const preview = viewAsId();
    if (preview) headers["X-DGS-View-As"] = preview;
    return headers;
  }

  async function apiGet(path) {
    const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(res.status === 401 ? "Sign in required" : body || res.statusText);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function renderAccount() {
    const box = document.getElementById("sidebar-account");
    const label = document.getElementById("user-label");
    const signOutBtn = document.getElementById("btn-sign-out");
    if (!box || !label) return;
    if (!state.authRequired || !state.user) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    label.textContent = state.user.name || state.user.email || "Signed in";
    if (signOutBtn && !signOutBtn.dataset.dgsAuthWired) {
      signOutBtn.dataset.dgsAuthWired = "1";
      signOutBtn.addEventListener("click", signOut);
    }
  }

  function signOut() {
    setToken(null);
    sessionStorage.removeItem(VIEW_AS_KEY);
    state.user = null;
    state.canViewAs = false;
    state.viewAs = null;
    window.location.replace(loginPageUrl());
  }

  async function ensureAuth() {
    stripStaleLocalApiParam();
    captureAuthTokenFromUrl();
    let cfg = { required: false };
    try {
      const res = await fetch(`${apiBase()}/api/auth/config`);
      if (res.ok) cfg = await res.json();
    } catch (_err) {
      /* offline / old API — allow browse until server is updated */
    }
    state.authRequired = cfg.required === true;
    if (!state.authRequired) return true;

    const token = getToken();
    if (!token) {
      window.location.replace(loginPageUrl());
      return false;
    }
    try {
      const me = await apiGet("/api/auth/me");
      state.user = me.user;
      state.canViewAs = me.can_view_as === true;
      state.viewAs = me.view_as || null;
      if (viewAsId() && !state.viewAs) sessionStorage.removeItem(VIEW_AS_KEY);
      renderAccount();
      return true;
    } catch (err) {
      if (viewAsId() && (err.status === 403 || err.status === 404)) {
        sessionStorage.removeItem(VIEW_AS_KEY);
        window.location.reload();
        return false;
      }
      setToken(null);
      sessionStorage.removeItem(VIEW_AS_KEY);
      if (err.status === 401) {
        window.location.replace(homePageUrl());
        return false;
      }
      window.location.replace(loginPageUrl());
      return false;
    }
  }

  function initLoginPage() {
    stripStaleLocalApiParam();
    const err = params.get("error");
    const errNode = document.getElementById("login-error");
    if (err && errNode) {
      errNode.textContent = err;
      errNode.hidden = false;
    }
    const btn = document.getElementById("btn-google-signin");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const returnTo =
        params.get("return_to") ||
        `${window.location.origin}${window.location.pathname.replace(/login\.html$/, "dashboard.html")}?api=${encodeURIComponent(apiBase())}`;
      window.location.href = `${apiBase()}/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`;
    });
  }

  window.DGSAuth = {
    apiBase,
    getToken,
    setToken,
    authHeaders,
    ensureAuth,
    renderAccount,
    signOut,
    initLoginPage,
    loginPageUrl,
    homePageUrl,
    getUser: () => state.user,
    isAuthRequired: () => state.authRequired,
    viewAsId,
    setViewAs,
    getCanViewAs: () => state.canViewAs,
    getViewAs: () => state.viewAs,
  };
})();
