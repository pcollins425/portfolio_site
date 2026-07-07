(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");
  const SESSION_STORAGE_KEY = "dgs_assistant_session_id";

  const state = {
    health: null,
    sessions: [],
    activeSessionId: null,
    messages: [],
    fileTree: null,
    secrets: [],
    secretsDraft: [],
    streaming: false,
    sessionFilter: "",
    fileFilter: "",
    expandedDirs: new Set(),
    streamAbort: null,
    pollTimer: null,
  };

  const els = {
    errorBox: document.getElementById("error-box"),
    workspaceBadge: document.getElementById("workspace-badge"),
    sessionList: document.getElementById("session-list"),
    sessionSearch: document.getElementById("session-search"),
    chatTitle: document.getElementById("chat-title"),
    chatMeta: document.getElementById("chat-meta"),
    chatMessages: document.getElementById("chat-messages"),
    chatInput: document.getElementById("chat-input"),
    fileTree: document.getElementById("file-tree"),
    fileFilter: document.getElementById("file-filter"),
    filePreview: document.getElementById("file-preview"),
    secretsBackdrop: document.getElementById("secrets-backdrop"),
    secretsDrawer: document.getElementById("secrets-drawer"),
    secretsList: document.getElementById("secrets-list"),
    secretNewKey: document.getElementById("secret-new-key"),
    secretNewValue: document.getElementById("secret-new-value"),
    btnNewSession: document.getElementById("btn-new-session"),
    btnSend: document.getElementById("btn-send"),
    btnSecrets: document.getElementById("btn-secrets"),
    btnCloseSecrets: document.getElementById("btn-close-secrets"),
    btnSecretsCancel: document.getElementById("btn-secrets-cancel"),
    btnSecretsSave: document.getElementById("btn-secrets-save"),
  };

  function authHeaders(extra) {
    return window.DGSAuth ? DGSAuth.authHeaders(extra) : Object.assign({}, extra || {});
  }

  function showError(msg) {
    if (!els.errorBox) return;
    els.errorBox.hidden = !msg;
    els.errorBox.textContent = msg || "";
  }

  async function fetchJson(path, options) {
    const res = await fetch(`${API_BASE}${path}`, Object.assign({ headers: authHeaders() }, options || {}));
    if (res.status === 401) throw new Error("Sign in required");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || res.statusText);
    }
    return res.json();
  }

  function activeSession() {
    return state.sessions.find((s) => s.id === state.activeSessionId) || null;
  }

  function sessionIsRunning(session) {
    return Boolean(session && session.active_run && session.active_run.status === "running");
  }

  function persistActiveSessionId(sessionId) {
    if (sessionId) localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function setStreaming(active) {
    state.streaming = active;
    if (els.btnSend) els.btnSend.disabled = active;
    if (els.chatInput) els.chatInput.disabled = active;
    renderChatHeader();
    renderSessions();
  }

  function abortStream() {
    if (state.streamAbort) {
      state.streamAbort.abort();
      state.streamAbort = null;
    }
  }

  function renderSessions() {
    if (!els.sessionList) return;
    const q = state.sessionFilter.trim().toLowerCase();
    const rows = state.sessions.filter((s) => !q || (s.title || "").toLowerCase().includes(q));
    els.sessionList.innerHTML = "";
    if (!rows.length) {
      els.sessionList.innerHTML = '<p class="assistant-empty">No sessions yet</p>';
      return;
    }
    for (const s of rows) {
      const btn = document.createElement("button");
      const running = sessionIsRunning(s) || (state.streaming && s.id === state.activeSessionId);
      btn.type = "button";
      btn.className =
        "assistant-session-item" +
        (s.id === state.activeSessionId ? " is-active" : "") +
        (running ? " is-running" : "");
      const title = document.createElement("span");
      title.className = "assistant-session-item__title";
      title.textContent = s.title || "New conversation";
      const meta = document.createElement("span");
      meta.className = "assistant-session-item__meta";
      const n = (s.messages || []).length;
      meta.textContent = running ? "Working…" : `${n} message${n === 1 ? "" : "s"}`;
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener("click", () => {
        if (state.streaming && s.id !== state.activeSessionId) return;
        selectSession(s.id).catch((e) => showError(e.message));
      });
      els.sessionList.appendChild(btn);
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderAssistantHtml(text) {
    const raw = String(text || "");
    if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
      const html = marked.parse(raw, { breaks: true, gfm: true });
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
    return formatPlainFallback(raw);
  }

  function formatPlainFallback(text) {
    const lines = String(text || "").split("\n");
    let html = "";
    let inList = false;
    for (const line of lines) {
      const trimmed = line.trim();
      const bullet = /^([-*•]|\d+\.)\s+/.exec(trimmed);
      if (bullet) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += "<li>" + escapeHtml(trimmed.replace(/^([-*•]|\d+\.)\s+/, "")) + "</li>";
      } else {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        if (trimmed) html += "<p>" + escapeHtml(line) + "</p>";
      }
    }
    if (inList) html += "</ul>";
    return html || "<p></p>";
  }

  function setMessageBody(el, role, content) {
    if (role === "assistant") {
      el.classList.add("assistant-message__body--markdown");
      el.innerHTML = renderAssistantHtml(content);
    } else {
      el.classList.remove("assistant-message__body--markdown");
      el.textContent = content || "";
    }
  }

  function renderMessages() {
    if (!els.chatMessages) return;
    els.chatMessages.innerHTML = "";
    for (const m of state.messages) {
      const div = document.createElement("div");
      div.className = "assistant-message assistant-message--" + (m.role === "user" ? "user" : "assistant");
      if (m.role === "assistant") {
        const label = document.createElement("div");
        label.className = "assistant-message__label";
        label.textContent = "Assistant";
        div.appendChild(label);
      }
      const body = document.createElement("div");
      body.className = "assistant-message__body";
      setMessageBody(body, m.role, m.content);
      div.appendChild(body);
      els.chatMessages.appendChild(div);
    }
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  function renderChatHeader() {
    const s = activeSession();
    if (!s) {
      els.chatTitle.textContent = "New conversation";
      els.chatMeta.textContent = "Select or start a session";
      return;
    }
    els.chatTitle.textContent = s.title || "Conversation";
    const parts = [];
    if (state.streaming || sessionIsRunning(s)) parts.push("Processing");
    else if (s.agent_id) parts.push("Agent linked");
    if (state.health && !state.health.cursor_api_key_configured) parts.push("API key missing");
    els.chatMeta.textContent = parts.length ? parts.join(" · ") : "Ready";
  }

  function createActivityNode(label, thinkingText) {
    const div = document.createElement("div");
    div.className = "assistant-message assistant-message--activity";
    div.dataset.activity = "1";

    const labelRow = document.createElement("div");
    labelRow.className = "assistant-message__label assistant-activity__label";
    const pulse = document.createElement("span");
    pulse.className = "assistant-activity__pulse";
    pulse.setAttribute("aria-hidden", "true");
    const labelEl = document.createElement("span");
    labelEl.className = "assistant-activity__text";
    labelEl.textContent = label || "Working…";
    labelRow.appendChild(pulse);
    labelRow.appendChild(labelEl);
    div.appendChild(labelRow);

    if (thinkingText) {
      const detail = document.createElement("div");
      detail.className = "assistant-activity__detail";
      detail.textContent = thinkingText;
      div.appendChild(detail);
    }
    return div;
  }

  function updateActivityNode(node, label, thinkingText) {
    if (!node) return;
    const labelEl = node.querySelector(".assistant-activity__text");
    if (labelEl && label) labelEl.textContent = label;
    let detail = node.querySelector(".assistant-activity__detail");
    if (thinkingText) {
      if (!detail) {
        detail = document.createElement("div");
        detail.className = "assistant-activity__detail";
        node.appendChild(detail);
      }
      detail.textContent = thinkingText;
    } else if (detail) {
      detail.remove();
    }
  }

  function removeActivityNode(ctx) {
    if (ctx.activityNode && ctx.activityNode.parentNode) {
      ctx.activityNode.parentNode.removeChild(ctx.activityNode);
    }
    ctx.activityNode = null;
  }

  function ensureAssistantNode(ctx) {
    removeActivityNode(ctx);
    if (ctx.assistantNode) return ctx.assistantNode;
    const assistantNode = document.createElement("div");
    assistantNode.className = "assistant-message assistant-message--assistant";
    const label = document.createElement("div");
    label.className = "assistant-message__label";
    label.textContent = "Assistant";
    assistantNode.appendChild(label);
    const body = document.createElement("div");
    body.className = "assistant-message__body";
    body.dataset.stream = "1";
    assistantNode.appendChild(body);
    els.chatMessages.appendChild(assistantNode);
    ctx.assistantNode = assistantNode;
    return assistantNode;
  }

  function handleStreamEvent(event, ctx) {
    if (event.type === "thinking") {
      const label = "Thinking…";
      const detail = event.text && event.text !== "Thinking…" ? event.text : "";
      if (!ctx.activityNode) {
        ctx.activityNode = createActivityNode(label, detail);
        els.chatMessages.appendChild(ctx.activityNode);
      } else {
        updateActivityNode(ctx.activityNode, label, detail);
      }
      els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
      return;
    }

    if (event.type === "activity") {
      const label = event.label || "Working…";
      if (!ctx.activityNode) {
        ctx.activityNode = createActivityNode(label, "");
        els.chatMessages.appendChild(ctx.activityNode);
      } else {
        updateActivityNode(ctx.activityNode, label, "");
      }
      els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
      return;
    }

    if (event.type === "text") {
      ctx.assistantText += event.text || "";
      const assistantNode = ensureAssistantNode(ctx);
      const streamBody = assistantNode.querySelector(".assistant-message__body");
      setMessageBody(streamBody, "assistant", ctx.assistantText);
      els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
      return;
    }

    if (event.type === "error") {
      showError(event.message || "Agent error");
      return;
    }

    if (event.type === "run") {
      const s = activeSession();
      if (s) {
        s.active_run = { run_id: event.run_id, status: event.status || "running" };
        renderSessions();
        renderChatHeader();
      }
    }
  }

  async function consumeEventStream(url, options, ctx) {
    const res = await fetch(url, Object.assign({ headers: authHeaders() }, options || {}));
    if (!res.ok) throw new Error(await res.text());
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        handleStreamEvent(event, ctx);
        if (event.type === "status" && (event.status === "finished" || event.status === "error")) {
          finished = event.status === "finished";
        }
      }
    }
    return finished;
  }

  async function refreshActiveSession() {
    if (!state.activeSessionId) return;
    const data = await fetchJson(`/api/assistant/sessions/${encodeURIComponent(state.activeSessionId)}`);
    state.messages = data.messages || [];
    const idx = state.sessions.findIndex((s) => s.id === state.activeSessionId);
    if (idx >= 0) state.sessions[idx] = data;
    renderSessions();
    renderMessages();
    renderChatHeader();
  }

  function startSessionPoll() {
    stopPolling();
    let attempts = 0;
    state.pollTimer = setInterval(async () => {
      attempts += 1;
      try {
        const before = state.messages.length;
        await refreshActiveSession();
        const s = activeSession();
        const running = sessionIsRunning(s);
        const gained = state.messages.length > before;
        const last = state.messages[state.messages.length - 1];
        if (!running && (gained || (last && last.role === "assistant"))) {
          stopPolling();
          return;
        }
        if (attempts >= 30) stopPolling();
      } catch (_err) {
        if (attempts >= 30) stopPolling();
      }
    }, 2000);
  }

  async function attachRunStream(url, options) {
    abortStream();
    const controller = new AbortController();
    state.streamAbort = controller;
    setStreaming(true);
    showError("");

    const ctx = {
      assistantText: "",
      assistantNode: null,
      activityNode: null,
    };

    try {
      const finished = await consumeEventStream(
        url,
        Object.assign({}, options || {}, { signal: controller.signal }),
        ctx
      );
      removeActivityNode(ctx);
      await loadSessions();
      await refreshActiveSession();
      if (!finished && !ctx.assistantText) startSessionPoll();
    } catch (err) {
      if (err.name === "AbortError") return;
      removeActivityNode(ctx);
      // Run may still be going in the background — poll for the saved reply.
      startSessionPoll();
      if (!String(err.message || err).includes("404")) {
        showError(String(err.message || err));
      }
    } finally {
      if (state.streamAbort === controller) state.streamAbort = null;
      setStreaming(false);
    }
  }

  async function reconnectActiveRun() {
    if (!state.activeSessionId || state.streaming) return;
    const s = activeSession();
    if (!sessionIsRunning(s)) {
      // Last message user-only with no active flag — run may have finished while away.
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === "user") startSessionPoll();
      return;
    }
    await attachRunStream(
      `${API_BASE}/api/assistant/sessions/${encodeURIComponent(state.activeSessionId)}/run/stream`
    );
  }

  function fileEntryIconClass(name, type, expanded) {
    if (type === "dir") {
      return expanded ? "assistant-file-icon--folder-open" : "assistant-file-icon--folder";
    }
    const base = (name || "").toLowerCase();
    if (base === ".env" || base.endsWith(".env.example")) return "assistant-file-icon--env";
    const ext = base.includes(".") ? base.split(".").pop() : "";
    const map = {
      md: "md",
      mdc: "md",
      py: "code",
      js: "code",
      ts: "code",
      sh: "code",
      sql: "sql",
      json: "json",
      html: "html",
      htm: "html",
      css: "css",
      yaml: "config",
      yml: "config",
      toml: "config",
      ini: "config",
      png: "image",
      jpg: "image",
      jpeg: "image",
      gif: "image",
      webp: "image",
      svg: "image",
      csv: "data",
      xlsx: "data",
      xls: "data",
      pdf: "doc",
      txt: "text",
    };
    return "assistant-file-icon--" + (map[ext] || "file");
  }

  function createFileIcon(className) {
    const icon = document.createElement("span");
    icon.className = "assistant-file-icon " + className;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  function renderFileTreeNodes(entries, depth) {
    const frag = document.createDocumentFragment();
    const filter = state.fileFilter.trim().toLowerCase();
    const filtering = Boolean(filter);
    const chevronPad = 16;
    let hasContent = false;

    for (const entry of entries || []) {
      const label = entry.name || "";
      const path = entry.path || label;
      const matches =
        !filter || label.toLowerCase().includes(filter) || path.toLowerCase().includes(filter);

      if (entry.type === "dir") {
        const childResult = renderFileTreeNodes(entry.children || [], depth + 1);
        if (!matches && !childResult.hasContent) continue;

        const expanded = filtering || state.expandedDirs.has(path);
        hasContent = true;

        const row = document.createElement("button");
        row.type = "button";
        row.className = "assistant-file-row assistant-file-row--dir";
        row.style.paddingLeft = `${8 + depth * 14}px`;
        row.setAttribute("aria-expanded", expanded ? "true" : "false");

        const chevron = document.createElement("span");
        chevron.className = "assistant-file-chevron" + (expanded ? " is-open" : "");
        chevron.setAttribute("aria-hidden", "true");

        const nameSpan = document.createElement("span");
        nameSpan.className = "assistant-file-name";
        nameSpan.textContent = label;

        row.appendChild(chevron);
        row.appendChild(createFileIcon(fileEntryIconClass(label, "dir", expanded)));
        row.appendChild(nameSpan);
        row.addEventListener("click", () => {
          if (state.expandedDirs.has(path)) state.expandedDirs.delete(path);
          else state.expandedDirs.add(path);
          renderFileTree();
        });

        frag.appendChild(row);

        const childrenWrap = document.createElement("div");
        childrenWrap.className = "assistant-file-children";
        childrenWrap.hidden = !expanded;
        childrenWrap.appendChild(childResult.frag);
        frag.appendChild(childrenWrap);
      } else if (matches) {
        hasContent = true;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "assistant-file-row assistant-file-row--file";
        row.style.paddingLeft = `${8 + depth * 14 + chevronPad}px`;

        const nameSpan = document.createElement("span");
        nameSpan.className = "assistant-file-name";
        nameSpan.textContent = label;

        row.appendChild(createFileIcon(fileEntryIconClass(label, "file", false)));
        row.appendChild(nameSpan);
        row.addEventListener("click", () => loadFilePreview(path));
        frag.appendChild(row);
      }
    }
    return { frag, hasContent };
  }

  function renderFileTree() {
    if (!els.fileTree || !state.fileTree) return;
    els.fileTree.innerHTML = "";
    const root = document.createElement("div");
    root.className = "assistant-file-row assistant-file-row--root";
    const rootIcon = createFileIcon("assistant-file-icon--folder-open");
    const rootName = document.createElement("span");
    rootName.className = "assistant-file-name";
    rootName.textContent = state.fileTree.name || "workspace";
    root.appendChild(rootIcon);
    root.appendChild(rootName);
    els.fileTree.appendChild(root);
    const result = renderFileTreeNodes(state.fileTree.entries || [], 0);
    els.fileTree.appendChild(result.frag);
  }

  function renderSecrets() {
    if (!els.secretsList) return;
    els.secretsList.innerHTML = "";
    for (const row of state.secretsDraft) {
      const card = document.createElement("div");
      card.className = "assistant-secret-card";
      const key = document.createElement("label");
      key.textContent = row.key;
      const input = document.createElement("input");
      input.type = row.masked ? "password" : "text";
      input.value = row.value || "";
      input.dataset.key = row.key;
      input.addEventListener("input", () => {
        row.value = input.value;
      });
      card.appendChild(key);
      card.appendChild(input);
      els.secretsList.appendChild(card);
    }
  }

  async function loadHealth() {
    state.health = await fetchJson("/api/assistant/health");
    if (els.workspaceBadge && state.health) {
      const name = state.health.workspace ? state.health.workspace.split(/[/\\]/).pop() : "workspace";
      els.workspaceBadge.textContent = name;
    }
  }

  async function loadSessions() {
    const data = await fetchJson("/api/assistant/sessions");
    state.sessions = data.sessions || [];
    renderSessions();
  }

  async function selectSession(sessionId) {
    if (state.streaming && sessionId !== state.activeSessionId) return;
    stopPolling();
    abortStream();
    const data = await fetchJson(`/api/assistant/sessions/${encodeURIComponent(sessionId)}`);
    state.activeSessionId = sessionId;
    state.messages = data.messages || [];
    persistActiveSessionId(sessionId);
    const idx = state.sessions.findIndex((s) => s.id === sessionId);
    if (idx >= 0) state.sessions[idx] = data;
    renderSessions();
    renderMessages();
    renderChatHeader();
    await reconnectActiveRun();
  }

  async function createSession() {
    if (state.streaming) return;
    const data = await fetchJson("/api/assistant/sessions", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    });
    state.sessions.unshift(data);
    await selectSession(data.id);
  }

  async function loadFileTree() {
    state.fileTree = await fetchJson("/api/assistant/workspace/tree");
    if (state.fileTree && state.fileTree.error) {
      showError(state.fileTree.error);
    }
    renderFileTree();
  }

  async function loadFilePreview(path) {
    const data = await fetchJson(`/api/assistant/workspace/file?path=${encodeURIComponent(path)}`);
    els.filePreview.textContent = data.preview || "";
  }

  async function openSecrets() {
    const data = await fetchJson("/api/assistant/secrets");
    state.secrets = data.variables || [];
    state.secretsDraft = state.secrets.map((v) => Object.assign({}, v));
    renderSecrets();
    els.secretsBackdrop.hidden = false;
    els.secretsDrawer.setAttribute("aria-hidden", "false");
    els.secretsDrawer.classList.add("is-open");
    els.btnSecrets.classList.add("is-active");
  }

  function closeSecrets() {
    els.secretsBackdrop.hidden = true;
    els.secretsDrawer.setAttribute("aria-hidden", "true");
    els.secretsDrawer.classList.remove("is-open");
    els.btnSecrets.classList.remove("is-active");
  }

  async function saveSecrets() {
    const variables = state.secretsDraft.map((v) => ({ key: v.key, value: v.value || "" }));
    const newKey = (els.secretNewKey.value || "").trim();
    const newVal = els.secretNewValue.value || "";
    if (newKey) variables.push({ key: newKey, value: newVal });
    await fetchJson("/api/assistant/secrets", {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ variables }),
    });
    els.secretNewKey.value = "";
    els.secretNewValue.value = "";
    closeSecrets();
  }

  async function sendMessage() {
    if (state.streaming) return;
    const text = (els.chatInput.value || "").trim();
    if (!text) return;
    if (!state.activeSessionId) await createSession();

    if (sessionIsRunning(activeSession())) {
      els.chatInput.value = text;
      await reconnectActiveRun();
      return;
    }

    state.messages.push({ role: "user", content: text });
    els.chatInput.value = "";
    renderMessages();
    showError("");

    const sessionId = state.activeSessionId;
    await attachRunStream(
      `${API_BASE}/api/assistant/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ content: text }),
      }
    );
  }

  function wireEvents() {
    els.btnNewSession.addEventListener("click", () => createSession().catch((e) => showError(e.message)));
    els.btnSend.addEventListener("click", () => sendMessage().catch((e) => showError(e.message)));
    els.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage().catch((err) => showError(err.message));
      }
    });
    els.sessionSearch.addEventListener("input", () => {
      state.sessionFilter = els.sessionSearch.value;
      renderSessions();
    });
    els.fileFilter.addEventListener("input", () => {
      state.fileFilter = els.fileFilter.value;
      renderFileTree();
    });
    els.btnSecrets.addEventListener("click", () => openSecrets().catch((e) => showError(e.message)));
    els.btnCloseSecrets.addEventListener("click", closeSecrets);
    els.btnSecretsCancel.addEventListener("click", closeSecrets);
    els.secretsBackdrop.addEventListener("click", closeSecrets);
    els.btnSecretsSave.addEventListener("click", () => saveSecrets().catch((e) => showError(e.message)));
  }

  async function init() {
    wireEvents();
    try {
      await loadHealth();
      await loadSessions();
      renderChatHeader();
      const savedId = localStorage.getItem(SESSION_STORAGE_KEY);
      const initial =
        (savedId && state.sessions.some((s) => s.id === savedId) && savedId) ||
        (state.sessions[0] && state.sessions[0].id);
      if (initial) await selectSession(initial);
    } catch (err) {
      showError(String(err.message || err));
    }
    loadFileTree().catch((err) => {
      showError(`Workspace files: ${err.message || err}`);
    });
  }

  window.AssistantApp = { init };
})();
