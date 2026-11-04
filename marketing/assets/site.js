(function () {
  const catalog = window.CM_CATALOG;
  if (!catalog) return;

  const storageKey = "cm-mix-ids";
  // Same-origin Worker route (Resend). Override with window.CM_API_BASE if needed.
  const apiBase = (window.CM_API_BASE || "").replace(/\/$/, "");

  function readMix() {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeMix(ids) {
    sessionStorage.setItem(storageKey, JSON.stringify([...new Set(ids)]));
    syncMixUi();
  }

  function toggleMix(id, on) {
    const ids = readMix();
    const next = on ? [...ids, id] : ids.filter((x) => x !== id);
    writeMix(next);
  }

  function labelForId(id) {
    const fn = catalog.functions.find((f) => f.id === id);
    if (fn) return fn.name;
    const app = catalog.apps.find((a) => a.id === id);
    if (app) return app.name;
    const svc = catalog.services.find((s) => s.id === id);
    if (svc) return svc.name;
    return id;
  }

  function mixLabels(extraIds) {
    const ids = [...new Set([...(extraIds || []), ...readMix()])];
    return ids.map((id) => `${labelForId(id)} (${id})`);
  }

  function tagsHtml(tags) {
    return (tags || [])
      .map((t) => {
        const live = t === "production" || t === "auth-gated";
        return `<span class="cm-tag${live ? " cm-tag-live" : ""}">${t}</span>`;
      })
      .join("");
  }

  function appCard(app) {
    return `
      <article class="cm-item" data-catalog-id="${app.id}">
        <div class="cm-item-top">
          <h3><a href="${app.href}">${app.name}</a></h3>
          <div class="cm-tags">${tagsHtml(app.tags)}</div>
        </div>
        <p>${app.blurb}</p>
        <div class="cm-item-actions">
          <label class="cm-mix"><input type="checkbox" data-mix-id="${app.id}" /> Mix</label>
          <a class="cm-link" href="${app.href}">Breakdown</a>
          <a class="cm-link" href="${app.liveHref}" rel="noopener">Live door</a>
        </div>
      </article>`;
  }

  function functionCard(fn) {
    return `
      <article class="cm-item" data-catalog-id="${fn.id}">
        <div class="cm-item-top">
          <h3><a href="${fn.href}">${fn.name}</a></h3>
          <div class="cm-tags">${tagsHtml(fn.tags)}</div>
        </div>
        <p>${fn.blurb}</p>
        <div class="cm-item-actions">
          <label class="cm-mix"><input type="checkbox" data-mix-id="${fn.id}" /> Mix</label>
          <a class="cm-link" href="${fn.href}">Details</a>
          <button type="button" class="cm-link cm-link-btn" data-inquire data-inquire-id="${fn.id}">Inquire</button>
        </div>
      </article>`;
  }

  function serviceCard(svc) {
    return `
      <article class="cm-item" data-catalog-id="${svc.id}">
        <div class="cm-item-top">
          <h3>${svc.name}</h3>
          <div class="cm-tags">${tagsHtml(svc.tags)}</div>
        </div>
        <p>${svc.blurb}</p>
        <div class="cm-item-actions">
          <label class="cm-mix"><input type="checkbox" data-mix-id="${svc.id}" /> Mix</label>
          <button type="button" class="cm-link cm-link-btn" data-inquire data-inquire-id="${svc.id}">Inquire</button>
        </div>
      </article>`;
  }

  function renderShelf(selector, items, renderer) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.innerHTML = items.map(renderer).join("");
  }

  function renderResume(selector) {
    const el = document.querySelector(selector);
    if (!el || !catalog.resume) return;
    const r = catalog.resume;
    el.innerHTML = `
      <div>
        <p class="cm-eyebrow">Resume</p>
        <h2>${r.name}</h2>
        <p class="cm-resume-lead"><strong>${r.role}</strong> — ${r.lead}</p>
      </div>
      <div class="cm-claims">
        ${r.claims
          .map(
            (c) => `
          <div class="cm-claim">
            <strong>${c.label}</strong>
            <p>${c.detail} <a href="${c.href}">See proof</a></p>
          </div>`
          )
          .join("")}
      </div>`;
  }

  function ensureDock() {
    if (document.querySelector("[data-mix-dock]")) return;
    const dock = document.createElement("div");
    dock.className = "cm-dock";
    dock.setAttribute("data-mix-dock", "");
    dock.innerHTML = `
      <p><span data-mix-count>0</span> in your mix</p>
      <button type="button" class="cm-btn cm-btn-accent" data-inquire>Inquire</button>
      <button type="button" class="cm-btn cm-btn-quiet" data-mix-clear>Clear</button>`;
    document.body.appendChild(dock);
    dock.querySelector("[data-mix-clear]").addEventListener("click", () => writeMix([]));
  }

  function ensureForm() {
    if (document.querySelector("[data-inquire-dialog]")) return;
    const wrap = document.createElement("div");
    wrap.className = "cm-inquire";
    wrap.setAttribute("data-inquire-dialog", "");
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="cm-inquire-backdrop" data-inquire-close tabindex="-1"></div>
      <div class="cm-inquire-panel" role="dialog" aria-modal="true" aria-labelledby="cm-inquire-title">
        <div class="cm-inquire-head">
          <div>
            <p class="cm-eyebrow">Inquire</p>
            <h2 id="cm-inquire-title">Tell me what you need</h2>
          </div>
          <button type="button" class="cm-inquire-x" data-inquire-close aria-label="Close">×</button>
        </div>
        <form class="cm-inquire-form" data-inquire-form novalidate>
          <input class="cm-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />
          <label>
            <span>Name</span>
            <input name="name" type="text" required maxlength="120" autocomplete="name" />
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" required maxlength="200" autocomplete="email" />
          </label>
          <label>
            <span>Company <em>(optional)</em></span>
            <input name="company" type="text" maxlength="160" autocomplete="organization" />
          </label>
          <div class="cm-inquire-mix">
            <span>Your mix</span>
            <ul data-inquire-mix></ul>
          </div>
          <label>
            <span>Message</span>
            <textarea name="message" required maxlength="4000" rows="5" placeholder="What are you trying to build or fix?"></textarea>
          </label>
          <p class="cm-inquire-status" data-inquire-status hidden></p>
          <div class="cm-inquire-actions">
            <button type="submit" class="cm-btn cm-btn-accent" data-inquire-submit>Send inquiry</button>
            <button type="button" class="cm-btn cm-btn-quiet" data-inquire-close>Cancel</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(wrap);

    wrap.querySelectorAll("[data-inquire-close]").forEach((el) => {
      el.addEventListener("click", closeInquire);
    });
    wrap.querySelector("[data-inquire-form]").addEventListener("submit", onSubmit);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !wrap.hidden) closeInquire();
    });
  }

  let pendingExtra = [];

  function openInquire(extraIds) {
    ensureForm();
    pendingExtra = extraIds || [];
    const wrap = document.querySelector("[data-inquire-dialog]");
    const list = wrap.querySelector("[data-inquire-mix]");
    const labels = mixLabels(pendingExtra);
    list.innerHTML = labels.length
      ? labels.map((l) => `<li>${l}</li>`).join("")
      : "<li>(none selected — general inquiry)</li>";
    const status = wrap.querySelector("[data-inquire-status]");
    status.hidden = true;
    status.textContent = "";
    status.classList.remove("is-error", "is-ok");
    wrap.hidden = false;
    document.body.classList.add("cm-inquire-open");
    const name = wrap.querySelector('input[name="name"]');
    if (name) name.focus();
  }

  function closeInquire() {
    const wrap = document.querySelector("[data-inquire-dialog]");
    if (!wrap) return;
    wrap.hidden = true;
    document.body.classList.remove("cm-inquire-open");
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const status = document.querySelector("[data-inquire-status]");
    const submit = document.querySelector("[data-inquire-submit]");
    const fd = new FormData(form);
    const payload = {
      name: String(fd.get("name") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      company: String(fd.get("company") || "").trim(),
      message: String(fd.get("message") || "").trim(),
      website: String(fd.get("website") || "").trim(),
      mix: mixLabels(pendingExtra),
    };
    if (!payload.name || !payload.email || !payload.message) {
      status.hidden = false;
      status.classList.add("is-error");
      status.classList.remove("is-ok");
      status.textContent = "Name, email, and message are required.";
      return;
    }
    submit.disabled = true;
    status.hidden = false;
    status.classList.remove("is-error", "is-ok");
    status.textContent = "Sending…";
    try {
      const res = await fetch(`${apiBase}/api/public/inquire`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `Send failed (${res.status})`);
      }
      status.classList.add("is-ok");
      status.classList.remove("is-error");
      status.textContent = "Sent. I’ll get back to you by email.";
      form.reset();
      writeMix([]);
      setTimeout(closeInquire, 1400);
    } catch (err) {
      status.classList.add("is-error");
      status.classList.remove("is-ok");
      status.textContent = err && err.message ? err.message : "Could not send. Try again.";
    } finally {
      submit.disabled = false;
    }
  }

  function syncMixUi() {
    const ids = readMix();
    document.querySelectorAll("[data-mix-id]").forEach((input) => {
      input.checked = ids.includes(input.getAttribute("data-mix-id"));
    });
    const dock = document.querySelector("[data-mix-dock]");
    const count = document.querySelector("[data-mix-count]");
    if (count) count.textContent = String(ids.length);
    if (dock) dock.classList.toggle("is-open", ids.length > 0);
  }

  document.addEventListener("change", (e) => {
    const input = e.target.closest("[data-mix-id]");
    if (!input) return;
    toggleMix(input.getAttribute("data-mix-id"), input.checked);
  });

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-inquire]");
    if (!trigger) return;
    e.preventDefault();
    const preset = trigger.getAttribute("data-inquire-id");
    openInquire(preset ? [preset] : []);
  });

  // Convert leftover mailto inquire anchors into form triggers.
  document.querySelectorAll('a[data-inquire][href^="mailto:"]').forEach((a) => {
    a.setAttribute("href", "#inquire");
  });

  renderShelf("[data-shelf-apps]", catalog.apps, appCard);
  renderShelf("[data-shelf-functions]", catalog.functions, functionCard);
  renderShelf("[data-shelf-services]", catalog.services, serviceCard);
  renderResume("[data-resume]");
  ensureDock();
  ensureForm();
  syncMixUi();
})();
