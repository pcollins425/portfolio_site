/**
 * Page Ask AI widget — Casinos pilot (desktop FAB / phone bottom bar).
 * Mount: DGSPageChat.mount({ page, getContext })
 */
(function () {
  "use strict";

  const COMPACT_MQ = window.matchMedia("(max-width: 1366px)");

  const state = {
    page: "casinos",
    getContext: null,
    open: false,
    sessionId: null,
    sessionCasinoId: null,
    busy: false,
    root: null,
  };

  function apiBase() {
    if (window.DGS && typeof DGS.apiBase === "function") {
      return String(DGS.apiBase() || "").replace(/\/$/, "");
    }
    if (window.DGSAuth && typeof DGSAuth.apiBase === "function") {
      return String(DGSAuth.apiBase() || "").replace(/\/$/, "");
    }
    return "https://api.collinsmediallc.com";
  }

  function authHeaders(extra) {
    if (window.DGSAuth && typeof DGSAuth.authHeaders === "function") {
      return DGSAuth.authHeaders(extra || {});
    }
    return Object.assign({}, extra || {});
  }

  function ctx() {
    const raw = typeof state.getContext === "function" ? state.getContext() : {};
    return {
      casino_id: (raw && raw.casino_id) || null,
      casino_name: (raw && raw.casino_name) || null,
    };
  }

  function els() {
    return {
      fab: state.root.querySelector("[data-pc-fab]"),
      bar: state.root.querySelector("[data-pc-bar]"),
      panel: state.root.querySelector("[data-pc-panel]"),
      close: state.root.querySelector("[data-pc-close]"),
      sub: state.root.querySelector("[data-pc-sub]"),
      msgs: state.root.querySelector("[data-pc-msgs]"),
      options: state.root.querySelector("[data-pc-options]"),
      form: state.root.querySelector("[data-pc-form]"),
      input: state.root.querySelector("[data-pc-input]"),
      send: state.root.querySelector("[data-pc-send]"),
    };
  }

  function ensureDom() {
    if (state.root) return;
    const root = document.createElement("div");
    root.className = "dgs-page-chat";
    root.innerHTML = `
      <button type="button" class="dgs-page-chat-fab" data-pc-fab aria-label="Ask AI">Ask AI</button>
      <button type="button" class="dgs-page-chat-bar" data-pc-bar aria-label="Ask AI">Ask AI</button>
      <div class="dgs-page-chat-panel" data-pc-panel hidden role="dialog" aria-label="Ask AI">
        <div class="dgs-page-chat-head">
          <div>
            <p class="dgs-page-chat-title">Ask AI</p>
            <p class="dgs-page-chat-sub" data-pc-sub>Casinos</p>
          </div>
          <button type="button" class="dgs-page-chat-close" data-pc-close aria-label="Close">×</button>
        </div>
        <div class="dgs-page-chat-msgs" data-pc-msgs></div>
        <div class="dgs-page-chat-options" data-pc-options></div>
        <form class="dgs-page-chat-form" data-pc-form>
          <input class="dgs-page-chat-input" data-pc-input type="text" autocomplete="off"
            placeholder="Ask about this casino…" maxlength="2000" />
          <button class="dgs-page-chat-send" data-pc-send type="submit">Send</button>
        </form>
      </div>
    `;
    document.body.appendChild(root);
    state.root = root;

    const e = els();
    e.fab.addEventListener("click", openPanel);
    e.bar.addEventListener("click", openPanel);
    e.close.addEventListener("click", closePanel);
    e.form.addEventListener("submit", onSubmit);
    e.options.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-pc-chip]");
      if (!btn) return;
      const text = btn.getAttribute("data-pc-chip") || btn.textContent || "";
      if (text) sendMessage(text);
    });
  }

  function setSubtitle() {
    const e = els();
    const c = ctx();
    e.sub.textContent = c.casino_name
      ? c.casino_name
      : state.page === "casinos"
        ? "Casinos"
        : state.page;
  }

  function appendBubble(role, text, meta) {
    const e = els();
    const div = document.createElement("div");
    div.className =
      "dgs-page-chat-bubble " +
      (role === "user" ? "dgs-page-chat-bubble--user" : "dgs-page-chat-bubble--bot");
    div.textContent = text || "";
    if (meta) {
      const m = document.createElement("div");
      m.className = "dgs-page-chat-meta";
      m.textContent = meta;
      div.appendChild(m);
    }
    e.msgs.appendChild(div);
    e.msgs.scrollTop = e.msgs.scrollHeight;
  }

  function renderOptions(options) {
    const e = els();
    e.options.innerHTML = "";
    if (!options || !options.length) return;
    for (const opt of options) {
      const id = opt.id || "";
      const label = opt.label || id || String(opt);
      let chipText = label;
      if (String(id).startsWith("breakdown:")) {
        chipText = `Breakdown ${String(id).split(":")[1]}`;
      } else if (id === "project_status") {
        chipText = "Project / FSR status";
      } else if (id === "performance_index") {
        chipText = "Did this month's report come in?";
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dgs-page-chat-chip";
      btn.setAttribute("data-pc-chip", chipText);
      btn.textContent = label;
      e.options.appendChild(btn);
    }
  }

  async function api(path, options) {
    const res = await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: authHeaders(
        Object.assign(
          { "Content-Type": "application/json" },
          (options && options.headers) || {}
        )
      ),
    });
    if (res.status === 401) throw new Error("Sign in required");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.detail || body.message || res.statusText || "Request failed");
    }
    return body;
  }

  async function ensureSession({ force } = {}) {
    const c = ctx();
    const casinoId = c.casino_id || null;
    if (!force && state.sessionId && state.sessionCasinoId === casinoId) {
      return state.sessionId;
    }
    const data = await api("/api/page-chat/sessions", {
      method: "POST",
      body: JSON.stringify({
        page: state.page,
        casino_id: casinoId,
        casino_name: c.casino_name || null,
      }),
    });
    state.sessionId = data.session_id;
    state.sessionCasinoId = casinoId;
    const e = els();
    e.msgs.innerHTML = "";
    renderOptions(null);
    if (data.greeting) appendBubble("bot", data.greeting);
    return state.sessionId;
  }

  async function openPanel() {
    ensureDom();
    setSubtitle();
    const e = els();
    e.panel.hidden = false;
    state.open = true;
    document.body.classList.add("dgs-page-chat-open");
    try {
      await ensureSession({ force: !state.sessionId });
    } catch (err) {
      appendBubble("bot", err.message || String(err));
    }
    e.input.focus();
  }

  function closePanel() {
    if (!state.root) return;
    els().panel.hidden = true;
    state.open = false;
    document.body.classList.remove("dgs-page-chat-open");
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const e = els();
    const text = (e.input.value || "").trim();
    if (!text || state.busy) return;
    e.input.value = "";
    await sendMessage(text);
  }

  async function sendMessage(text) {
    const e = els();
    if (state.busy) return;
    state.busy = true;
    e.send.disabled = true;
    renderOptions(null);
    appendBubble("user", text);
    try {
      await ensureSession();
      const data = await api(`/api/page-chat/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      const meta =
        data.router && data.verb
          ? `${data.verb} · ${data.router}`
          : data.router
            ? String(data.router)
            : "";
      appendBubble("bot", data.reply || "(no reply)", meta || null);
      if (data.options && data.options.length) renderOptions(data.options);
      else if (data.kind === "clarify" && data.options) renderOptions(data.options);
      if (data.follow_up_prompt && data.kind === "result") {
        /* follow-up already in reply for project_status */
      }
    } catch (err) {
      appendBubble("bot", err.message || String(err));
    } finally {
      state.busy = false;
      e.send.disabled = false;
      e.input.focus();
    }
  }

  function setContext() {
    if (!state.root) return;
    setSubtitle();
    const c = ctx();
    if (state.open && state.sessionCasinoId !== (c.casino_id || null)) {
      // New casino selection → new page-chat session on next ensure.
      state.sessionId = null;
      state.sessionCasinoId = null;
      ensureSession({ force: true }).catch((err) => {
        appendBubble("bot", err.message || String(err));
      });
    }
  }

  function mount(opts) {
    state.page = (opts && opts.page) || "casinos";
    state.getContext = (opts && opts.getContext) || null;
    ensureDom();
    setSubtitle();
    // Phone: leave room so list isn't fully covered by bar (page CSS may add padding).
    if (COMPACT_MQ.matches) {
      document.body.classList.add("dgs-page-chat-mounted");
    }
    COMPACT_MQ.addEventListener("change", () => {
      document.body.classList.toggle("dgs-page-chat-mounted", COMPACT_MQ.matches);
    });
  }

  window.DGSPageChat = {
    mount,
    setContext,
    open: openPanel,
    close: closePanel,
  };
})();
