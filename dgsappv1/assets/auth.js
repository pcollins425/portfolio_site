(function () {
  "use strict";

  const AUTH_TOKEN_KEY = "emaint_demo_token";
  const PRODUCTION_API = "https://api.collinsmediallc.com";
  const LOCAL_API = "http://127.0.0.1:9002";
  const params = new URLSearchParams(window.location.search);

  const state = {
    authRequired: false,
    user: null,
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

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function apiGet(path) {
    const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
    if (res.status === 401) throw new Error("Sign in required");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || res.statusText);
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
    state.user = null;
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
      renderAccount();
      return true;
    } catch (_err) {
      setToken(null);
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
    getUser: () => state.user,
    isAuthRequired: () => state.authRequired,
  };
})();
