(function () {
  const catalog = window.CM_CATALOG;
  if (!catalog) return;

  const storageKey = "cm-mix-ids";

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

  function buildMailto(extraIds) {
    const ids = [...new Set([...(extraIds || []), ...readMix()])];
    const lines = ids.length
      ? ids.map((id) => `- ${labelForId(id)} (${id})`)
      : ["- (no specific items selected — general inquiry)"];
    const subject = ids.length
      ? `Collins Media inquiry — ${ids.length} item${ids.length === 1 ? "" : "s"}`
      : "Collins Media inquiry";
    const body = [
      "Hi Paul,",
      "",
      "I'm interested in the following from the Collins Media shop:",
      "",
      ...lines,
      "",
      "Context / timeline:",
      "",
      "",
    ].join("\n");
    return `mailto:${catalog.inquireEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
    document.querySelectorAll("[data-inquire]").forEach((el) => {
      const preset = el.getAttribute("data-inquire-id");
      el.setAttribute("href", buildMailto(preset ? [preset] : []));
    });
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
          <a class="cm-link" data-inquire data-inquire-id="${fn.id}" href="#">Inquire</a>
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
          <a class="cm-link" data-inquire data-inquire-id="${svc.id}" href="#">Inquire</a>
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
      <a class="cm-btn cm-btn-accent" data-inquire href="#">Inquire</a>
      <button type="button" class="cm-btn cm-btn-quiet" data-mix-clear>Clear</button>`;
    document.body.appendChild(dock);
    dock.querySelector("[data-mix-clear]").addEventListener("click", () => writeMix([]));
  }

  document.addEventListener("change", (e) => {
    const input = e.target.closest("[data-mix-id]");
    if (!input) return;
    toggleMix(input.getAttribute("data-mix-id"), input.checked);
  });

  renderShelf("[data-shelf-apps]", catalog.apps, appCard);
  renderShelf("[data-shelf-functions]", catalog.functions, functionCard);
  renderShelf("[data-shelf-services]", catalog.services, serviceCard);
  renderResume("[data-resume]");
  ensureDock();
  syncMixUi();
})();
