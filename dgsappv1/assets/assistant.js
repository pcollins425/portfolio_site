(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || "https://api.collinsmediallc.com").replace(/\/$/, "");

  const state = {
    health: null,
    sessions: [],
    activeSessionId: null,
    messages: [],
    fileTree: null,
    secrets: [],
    secretsDraft: [],
    sending: false,
    sessionFilter: "",
    fileFilter: "",
    expandedDirs: new Set(),
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
      btn.type = "button";
      btn.className = "assistant-session-item" + (s.id === state.activeSessionId ? " is-active" : "");
      const title = document.createElement("span");
      title.className = "assistant-session-item__title";
      title.textContent = s.title || "New conversation";
      const meta = document.createElement("span");
      meta.className = "assistant-session-item__meta";
      const n = (s.messages || []).length;
      meta.textContent = `${n} message${n === 1 ? "" : "s"}`;
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener("click", () => selectSession(s.id));
      els.sessionList.appendChild(btn);
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
      body.textContent = m.content || "";
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
    if (s.agent_id) parts.push("Agent linked");
    if (state.health && !state.health.cursor_api_key_configured) parts.push("API key missing");
    els.chatMeta.textContent = parts.length ? parts.join(" · ") : "Ready";
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
    const data = await fetchJson(`/api/assistant/sessions/${encodeURIComponent(sessionId)}`);
    state.activeSessionId = sessionId;
    state.messages = data.messages || [];
    const idx = state.sessions.findIndex((s) => s.id === sessionId);
    if (idx >= 0) state.sessions[idx] = data;
    renderSessions();
    renderMessages();
    renderChatHeader();
  }

  async function createSession() {
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
    if (state.sending) return;
    const text = (els.chatInput.value || "").trim();
    if (!text) return;
    if (!state.activeSessionId) await createSession();

    state.messages.push({ role: "user", content: text });
    els.chatInput.value = "";
    renderMessages();
    state.sending = true;
    els.btnSend.disabled = true;
    showError("");

    let assistantText = "";
    let assistantNode = null;

    try {
      const res = await fetch(
        `${API_BASE}/api/assistant/sessions/${encodeURIComponent(state.activeSessionId)}/messages`,
        {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ content: text }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
          if (event.type === "text") {
            assistantText += event.text || "";
            if (!assistantNode) {
              assistantNode = document.createElement("div");
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
            }
            assistantNode.querySelector(".assistant-message__body").textContent = assistantText;
            els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
          } else if (event.type === "error") {
            showError(event.message || "Agent error");
          }
        }
      }

      if (assistantText) {
        state.messages.push({ role: "assistant", content: assistantText });
      }
      await loadSessions();
      if (state.activeSessionId) await selectSession(state.activeSessionId);
    } catch (err) {
      showError(String(err.message || err));
    } finally {
      state.sending = false;
      els.btnSend.disabled = false;
    }
  }

  function wireEvents() {
    els.btnNewSession.addEventListener("click", () => createSession().catch((e) => showError(e.message)));
    els.btnSend.addEventListener("click", () => sendMessage());
    els.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
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
      if (state.sessions.length) await selectSession(state.sessions[0].id);
    } catch (err) {
      showError(String(err.message || err));
    }
    loadFileTree().catch((err) => {
      showError(`Workspace files: ${err.message || err}`);
    });
  }

  window.AssistantApp = { init };
})();
