(function () {
  "use strict";

  const TOKEN_KEY = "infrageo_token";
  const panel = document.getElementById("ig-agent-panel");
  const log = document.getElementById("ig-agent-log");
  const form = document.getElementById("form-ig-agent");
  const input = document.getElementById("ig-agent-input");
  const fab = document.getElementById("btn-ig-agent");
  if (!panel || !log || !form || !input || !fab) return;

  function apiUrl(path) {
    return window.InfraGeoApi?.url?.(path) || path;
  }

  function authHeaders(json) {
    const h = json ? { "Content-Type": "application/json" } : {};
    const t = localStorage.getItem(TOKEN_KEY) || "";
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  function addMsg(text, who) {
    const el = document.createElement("div");
    el.className = "ig-agent__msg ig-agent__msg--" + who;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  let typingEl = null;

  function hideTyping() {
    typingEl?.remove();
    typingEl = null;
  }

  function showTyping() {
    hideTyping();
    typingEl = document.createElement("div");
    typingEl.className = "ig-agent__msg ig-agent__msg--bot ig-agent__typing";
    typingEl.setAttribute("aria-label", "Digitando");
    typingEl.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typingEl);
    log.scrollTop = log.scrollHeight;
  }

  async function botSay(text, extraMs) {
    const body = String(text || "").trim();
    if (!body) return null;
    showTyping();
    await sleep(Math.min(1800, 420 + body.length * 11) + (extraMs || 0));
    hideTyping();
    return addMsg(body, "bot");
  }

  function freezeChoices(fromEl) {
    const box = fromEl?.closest?.(".ig-agent__review");
    if (!box) return;
    box.classList.add("is-done");
    box.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    });
  }

  function addLayerPicker(layers) {
    const list = (layers || []).filter((m) => layerLabel(m));
    if (!list.length) return null;
    const wrap = document.createElement("div");
    wrap.className = "ig-agent__pick-layer";
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "Escolher camada");
    sel.innerHTML =
      '<option value="">Selecione a camada…</option>' +
      list
        .map((m) => {
          const id = String(m.id || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/"/g, "&quot;");
          const name = String(layerLabel(m) || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `<option value="${id}">${name}</option>`;
        })
        .join("");
    sel.addEventListener("change", () => {
      const id = sel.value;
      if (!id) return;
      const meta = catalogLayers().find((l) => String(l.id) === id) || list.find((l) => String(l.id) === id);
      if (meta) void pickLayerMeta(meta);
    });
    wrap.appendChild(sel);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    window.setTimeout(() => {
      wrap.scrollIntoView({ block: "nearest" });
      sel.focus();
    }, 50);
    return wrap;
  }

  function addChoices(items, variant) {
    const box = document.createElement("div");
    box.className = "ig-agent__review" + (variant ? " ig-agent__review--" + variant : "");
    items.forEach((item) => {
      const b = document.createElement("button");
      b.type = "button";
      Object.keys(item.attrs || {}).forEach((k) => b.setAttribute(k, item.attrs[k]));
      if (item.primary) b.classList.add("ig-agent__review-send");
      b.textContent = item.label;
      box.appendChild(b);
    });
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
    return box;
  }

  function pulse(sel) {
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.add("ig-guide-pulse");
    window.setTimeout(() => el.classList.remove("ig-guide-pulse"), 2800);
  }

  function snapshot() {
    const layers = catalogLayers();
    const visible = visibleMetas();
    const groups = window.InfraGeoConfig?.groups || [];
    const names = visible.map(layerLabel).filter(Boolean).slice(0, 3);
    return {
      total: layers.length,
      on: visible.length,
      groups: groups.length,
      names,
      groupNames: groups.map((g) => g.name || g.id).filter(Boolean).slice(0, 3),
    };
  }

  function clickUi(sel) {
    document.querySelector(sel)?.click();
  }

  const tourEl = document.getElementById("ig-agent-tour");
  const tourTabs = document.getElementById("ig-agent-tour-tabs");
  const TOUR_STEPS = [
    {
      id: "camadas",
      title: "Camadas",
      go: "camadas",
      target: "#btn-nav-camadas",
      text: (s) =>
        s.total
          ? "Aqui você liga e desliga o que aparece no mapa. Toque em Camadas, marque um grupo e depois a subcamada. Agora " +
            s.on +
            " de " +
            s.total +
            " estão ligadas" +
            (s.names.length ? ": " + s.names.join(", ") + "." : ".")
          : "Toque neste botão para abrir a lista. Marque um grupo e, em seguida, a subcamada.",
    },
    {
      id: "mapa",
      title: "Mapa",
      go: "basemap",
      target: "#btn-basemap-tab",
      text: () =>
        "Arraste o mapa para mover. Use + e − para aproximar. Enquadrar AM volta ao estado. Este ícone troca o fundo (ruas, satélite…).",
    },
    {
      id: "filtros",
      title: "Filtros",
      go: "filtros",
      target: "#btn-filtros",
      text: (s) =>
        "No topo você busca município ou rodovia. Filtrar dados restringe grupo e camada" +
        (s.groupNames.length ? " (" + s.groupNames.join(", ") + ")" : "") +
        ".",
    },
    {
      id: "exportar",
      title: "Exportar",
      go: "",
      target: "#btn-exportar-mapa",
      text: () =>
        "Exportar monta uma página com o mapa (PNG ou PDF). Favoritos, ao lado, guarda a vista para você voltar depois. Não vamos abrir agora — só para você achar o botão.",
    },
    {
      id: "conta",
      title: "Conta",
      go: "perfil",
      target: "#btn-user-menu",
      text: () =>
        "Seu perfil fica aqui em cima. Administradores entram no painel. Se achar um erro no mapa, volte ao Agente e descreva o que viu.",
    },
  ];
  let tourIndex = 0;
  let tourTimer = null;
  let coachOn = false;
  let coachTargetEl = null;

  function liveLine(s) {
    if (!s.total) return { label: "Catálogo carregando…", pct: 0 };
    const pct = Math.round((s.on / Math.max(s.total, 1)) * 100);
    return { label: `${s.on}/${s.total} ligadas`, pct };
  }

  function runGuideGo(action) {
    if (action === "camadas") {
      clickUi("#btn-nav-camadas");
    } else if (action === "filtros") {
      clickUi("#btn-filtros");
    } else if (action === "legenda") {
      clickUi("#btn-legendas");
    } else if (action === "basemap") {
      clickUi("#btn-basemap-tab");
    } else if (action === "fit") {
      clickUi("#btn-fit-am");
    } else if (action === "perfil") {
      clickUi("#btn-user-menu");
    }
  }

  function coachRoot() {
    let root = document.getElementById("ig-coach");
    if (root) return root;
    root = document.createElement("div");
    root.id = "ig-coach";
    root.className = "ig-coach";
    root.hidden = true;
    root.innerHTML =
      '<div class="ig-coach__spot" id="ig-coach-spot"></div>' +
      '<div class="ig-coach__card" id="ig-coach-card" role="dialog" aria-modal="true" aria-labelledby="ig-coach-title">' +
      '<p class="ig-coach__k" id="ig-coach-k"></p>' +
      '<strong id="ig-coach-title"></strong>' +
      '<p id="ig-coach-copy"></p>' +
      '<div class="ig-coach__dots" id="ig-coach-dots"></div>' +
      '<div class="ig-coach__nav">' +
      '<button type="button" class="ig-coach__skip" data-coach="skip">Pular</button>' +
      '<button type="button" data-coach="prev">Voltar</button>' +
      '<button type="button" class="ig-coach__next" data-coach="next">Próximo</button>' +
      "</div></div>";
    document.body.appendChild(root);
    root.addEventListener("click", (ev) => {
      const dot = ev.target.closest("[data-coach-dot]");
      if (dot) {
        tourIndex = Number(dot.getAttribute("data-coach-dot")) || 0;
        paintCoach();
        return;
      }
      const act = ev.target.closest("[data-coach]")?.getAttribute("data-coach");
      if (act === "skip") {
        closeTour();
        openPanel();
        void startMenu(false);
      }
      else if (act === "next") coachNext();
      else if (act === "prev") coachPrev();
    });
    return root;
  }

  function clearCoachTarget() {
    document.querySelectorAll(".ig-coach-target").forEach((el) => {
      el.classList.remove("ig-coach-target");
    });
    coachTargetEl = null;
  }

  function placeCoach() {
    const step = TOUR_STEPS[tourIndex];
    if (!step) return;
    const target = document.querySelector(step.target);
    const spot = document.getElementById("ig-coach-spot");
    const card = document.getElementById("ig-coach-card");
    if (!spot || !card) return;
    clearCoachTarget();
    if (!target) {
      spot.style.opacity = "0";
      card.style.top = "50%";
      card.style.left = "50%";
      card.style.transform = "translate(-50%, -50%)";
      return;
    }
    target.classList.add("ig-coach-target");
    coachTargetEl = target;
    try {
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    } catch {
      /* ignore */
    }
    const pad = 8;
    const r = target.getBoundingClientRect();
    const x = Math.max(6, r.left - pad);
    const y = Math.max(6, r.top - pad);
    const w = Math.min(window.innerWidth - x - 6, r.width + pad * 2);
    const h = Math.min(window.innerHeight - y - 6, r.height + pad * 2);
    spot.style.opacity = "1";
    spot.style.left = x + "px";
    spot.style.top = y + "px";
    spot.style.width = w + "px";
    spot.style.height = h + "px";
    card.style.transform = "none";
    const cw = card.offsetWidth || 320;
    const ch = card.offsetHeight || 200;
    const gap = 16;
    let top = y;
    let left = x + w + gap;
    if (left + cw > window.innerWidth - 10) {
      left = x - gap - cw;
    }
    if (left < 10) {
      left = Math.max(10, Math.min(x, window.innerWidth - cw - 10));
      top = y + h + gap;
      if (top + ch > window.innerHeight - 10) {
        top = Math.max(10, y - gap - ch);
      }
    }
    top = Math.max(10, Math.min(top, window.innerHeight - ch - 10));
    left = Math.max(10, Math.min(left, window.innerWidth - cw - 10));
    card.style.top = top + "px";
    card.style.left = left + "px";
  }

  function paintCoach() {
    const root = coachRoot();
    const step = TOUR_STEPS[tourIndex] || TOUR_STEPS[0];
    const s = snapshot();
    const k = document.getElementById("ig-coach-k");
    const title = document.getElementById("ig-coach-title");
    const copy = document.getElementById("ig-coach-copy");
    const dots = document.getElementById("ig-coach-dots");
    const nextBtn = root.querySelector("[data-coach='next']");
    const prevBtn = root.querySelector("[data-coach='prev']");
    if (k) k.textContent = "Passo " + (tourIndex + 1) + " de " + TOUR_STEPS.length;
    if (title) title.textContent = step.title;
    if (copy) copy.textContent = step.text(s);
    if (dots) {
      dots.innerHTML = TOUR_STEPS.map(
        (_, i) =>
          '<button type="button" data-coach-dot="' +
          i +
          '" class="' +
          (i === tourIndex ? "is-on" : "") +
          '" aria-label="Passo ' +
          (i + 1) +
          '"></button>'
      ).join("");
    }
    if (nextBtn) nextBtn.textContent = tourIndex === TOUR_STEPS.length - 1 ? "Concluir" : "Próximo";
    if (prevBtn) prevBtn.disabled = tourIndex === 0;
    root.hidden = false;
    document.body.classList.add("ig-coach-open");
    if (step.go) runGuideGo(step.go);
    window.requestAnimationFrame(() => {
      placeCoach();
      window.setTimeout(placeCoach, 280);
    });
  }

  function coachNext() {
    if (tourIndex >= TOUR_STEPS.length - 1) {
      closeTour();
      addMsg("Pronto. Você já viu o mapa. Pode escolher outra opção.", "bot");
      openPanel();
      void startMenu(false);
      return;
    }
    tourIndex += 1;
    paintCoach();
    paintTour();
  }

  function coachPrev() {
    if (tourIndex <= 0) return;
    tourIndex -= 1;
    paintCoach();
    paintTour();
  }

  function paintTour() {
    if (!tourEl || !tourTabs) return;
    const card = document.getElementById("ig-agent-tour-card");
    if (!card) return;
    const step = TOUR_STEPS[tourIndex] || TOUR_STEPS[0];
    const s = snapshot();
    tourTabs.innerHTML = TOUR_STEPS.map(
      (st, i) =>
        `<button type="button" data-tour-step="${i}" class="${i === tourIndex ? "is-on" : ""}">${st.title}</button>`
    ).join("");
    card.innerHTML =
      `<p class="ig-agent__tour-k">${tourIndex + 1} / ${TOUR_STEPS.length}</p>` +
      "<strong></strong><p data-tour-copy=\"1\"></p>";
    card.querySelector("strong").textContent = step.title;
    card.querySelector("[data-tour-copy]").textContent = step.text(s);
  }

  function onCoachLayout() {
    if (coachOn) placeCoach();
  }

  function openTour(id) {
    const idx = TOUR_STEPS.findIndex((st) => st.id === id);
    tourIndex = idx >= 0 ? idx : 0;
    coachOn = true;
    closePanel();
    if (tourEl) tourEl.hidden = true;
    panel.classList.add("is-touring");
    paintCoach();
    window.addEventListener("resize", onCoachLayout);
    window.addEventListener("scroll", onCoachLayout, true);
    if (tourTimer) window.clearInterval(tourTimer);
    tourTimer = window.setInterval(() => {
      if (!coachOn) return;
      const copy = document.getElementById("ig-coach-copy");
      const step = TOUR_STEPS[tourIndex];
      if (copy && step) copy.textContent = step.text(snapshot());
      placeCoach();
    }, 1600);
  }

  function closeTour() {
    coachOn = false;
    if (tourEl) tourEl.hidden = true;
    panel.classList.remove("is-touring");
    const root = document.getElementById("ig-coach");
    if (root) root.hidden = true;
    document.body.classList.remove("ig-coach-open");
    clearCoachTarget();
    window.removeEventListener("resize", onCoachLayout);
    window.removeEventListener("scroll", onCoachLayout, true);
    if (tourTimer) {
      window.clearInterval(tourTimer);
      tourTimer = null;
    }
  }

  function showGuide(topic) {
    if (!topic || topic === "home") openTour("camadas");
    else openTour(topic);
  }

  function detectGuide(text) {
    const t = normalize(text);
    if (!t) return null;
    if (/\b(tutorial|como (uso|navego|funciona)|ajuda|onde (fica|esta|estão|estao)|o que (e|é)|como faco|como faço)\b/.test(t) &&
        !/\b(erro|reclam|sugest)\b/.test(t)) {
      if (/camada/.test(t)) return "camadas";
      if (/filtro|buscar|busca/.test(t)) return "filtros";
      if (/export|pdf|png|imprim/.test(t)) return "exportar";
      if (/login|senha|conta|perfil|admin|painel/.test(t)) return "conta";
      if (/mapa|zoom|fundo|basemap|enquadrar|localiz/.test(t)) return "mapa";
      return "home";
    }
    if (/^camadas?$/.test(t) || /ligar|desligar camada|sidebar|catalogo|catálogo/.test(t)) return "camadas";
    if (/^filtros?$/.test(t) || /filtrar dados/.test(t)) return "filtros";
    if (/^exportar$/.test(t) || /\bpdf\b|\bpng\b/.test(t)) return "exportar";
    if (/mapa base|basemap|enquadrar|tela cheia|minha localiz/.test(t)) return "mapa";
    if (/^ajuda$/.test(t) || /^tutorial$/.test(t) || /como navegar/.test(t)) return "home";
    if (/^conta$/.test(t) || /painel de (admin|controle)/.test(t)) return "conta";
    return null;
  }

  function showReview() {
    if (!draft) return;
    tryAdvance();
  }

  function isContextLayer(meta) {
    const n = layerSearchText(meta);
    return /limite_(estadual|municipal)|limite estadual|limite municipal/.test(n);
  }

  async function uploadDataUrlPhoto(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], "camada-mapa.jpg", { type: "image/jpeg" });
    const body = new FormData();
    body.append("file", file);
    const headers = authHeaders();
    delete headers["Content-Type"];
    const res = await fetch(apiUrl("/api/feedback/photo"), {
      method: "POST",
      credentials: "same-origin",
      headers,
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return "";
    return data.url || "";
  }

  async function applyLayer(meta, note) {
    if (!draft || !meta) return;
    draft.layerId = String(meta.id || "");
    draft.layerName = layerLabel(meta);
    try {
      await window.InfraGeoLayers?.setLayerVisible?.(draft.layerId, true);
    } catch {
      /* ignore */
    }
    await botSay("Camada escolhida: " + draft.layerName + ".");
    if (draft.kind !== "sugestao" && !draft.photoUrl) {
      await botSay("Se quiser, envie uma foto do que você viu.");
    }
  }

  function workLayers() {
    const vis = visibleMetas().filter((m) => !isContextLayer(m));
    if (vis.length) return vis.slice(0, 16);
    return catalogLayers()
      .filter((m) => !isContextLayer(m))
      .slice(0, 16);
  }

  async function askRelatedLayer() {
    if (!draft) return;
    draft.stage = "related";
    await botSay("Essa ideia é de alguma camada que já está no mapa?");
    addChoices([
      { label: "Sim", primary: true, attrs: { "data-related": "sim" } },
      { label: "Não", attrs: { "data-related": "nao" } },
    ], "yesno");
  }

  async function applyRelatedChoice(yes) {
    if (!draft) return;
    draft.wantsLayer = !!yes;
    if (yes) {
      await askLayerInWords();
      return;
    }
    draft.layerName = "";
    draft.layerId = "";
    draft.featurePicked = true;
    draft.stage = "done";
    if (!hasUserDescription()) {
      await askUserDescription();
      return;
    }
    await botSay("Certo. Vou registrar a sugestão que você já descreveu.");
    await registrarSugestaoErro();
  }

  function isPhotoTalk(text) {
    const t = normalize(text);
    if (!t) return false;
    return (
      /^(imagem|foto|print|screenshot|printscreen)$/.test(t) ||
      /aqui (est[aá]|vai|esta) (a )?(imagem|foto)/.test(t) ||
      /segue (a )?(imagem|foto)/.test(t) ||
      /(anexei|enviei|mande[ei]|ta a[ií]|est[aá] a[ií]).*(imagem|foto)/.test(t)
    );
  }

  function applyVisionToDraft(data) {
    if (!draft || !data) return;
    const desc = String(data.descricao || "").trim();
    if (desc) draft.photoNote = desc;
    if (data.tipo === "sugestao") {
      draft.kind = "sugestao";
      if (draft.wantsLayer == null) draft.wantsLayer = null;
    } else if (data.tipo === "correcao") {
      draft.kind = "reclamacao";
      draft.wantsLayer = true;
    }
    if (data.camada && !draft.layerName) {
      const meta = catalogLayers().find((m) => layerLabel(m) === data.camada);
      if (meta) {
        draft.layerId = String(meta.id || "");
        draft.layerName = layerLabel(meta);
      }
    }
  }

  async function applyPhotoVision(photoUrl) {
    showTyping();
    try {
      const cat = catalogLayers()
        .map(layerLabel)
        .filter(Boolean)
        .slice(0, 40);
      const res = await fetch(apiUrl("/api/agent/ler-foto"), {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(true),
        body: JSON.stringify({ photo_url: photoUrl, catalogo: cat }),
      });
      const data = await res.json().catch(() => ({}));
      hideTyping();
      if (!res.ok || !data.descricao) {
        await botSay("Recebi a foto.");
        return null;
      }
      await botSay("Na foto reconheci: " + data.descricao);
      return data;
    } catch {
      hideTyping();
      await botSay("Recebi a foto.");
      return null;
    }
  }

  async function askMoreAfterPhoto() {
    if (draft) draft.stage = "after-photo";
    await botSay("Quer falar mais alguma coisa sobre a foto?");
    addChoices(
      [
        { label: "Sim, quero escrever", primary: true, attrs: { "data-photo-more": "1" } },
        { label: "Não, finalizar", attrs: { "data-photo-end": "1" } },
      ],
      "yesno"
    );
    setComposerOpen(true);
  }

  async function finishChat() {
    chatEnded = true;
    draft = null;
    pendingMap = null;
    stopPick();
    setComposerOpen(false);
    await botSay("Tudo bem. Pode abrir o agente de novo quando quiser.");
    window.setTimeout(() => {
      closePanel();
      log.innerHTML = "";
      hideTyping();
    }, 900);
  }

  async function askRegisterAfterPhoto() {
    if (!draft) return;
    draft.stage = "confirm";
    await botSay("Posso registrar nesta camada?");
    addChoices(
      [
        { label: "Sim, registrar", primary: true, attrs: { "data-register-now": "1" } },
        { label: "Escolher um ponto", attrs: { "data-show-feats": "1" } },
      ],
      "yesno"
    );
  }

  function isYes(t) {
    return (
      /^(sim|s|yes|isso|essa|desejo|quero|pode|ok)(\b|$)/.test(t) ||
      /\b(sim|vincular|por favor|pode ligar|liga|enquadra)\b/.test(t)
    );
  }

  function isNo(t) {
    return /^(nao|não|n|no)(\b|$)/.test(t) || /\b(nao|não)\b/.test(t);
  }

  async function askLayerInWords() {
    if (!draft) return;
    draft.stage = "layer";
    let pool = catalogLayers().filter((m) => m && !isContextLayer(m));
    if (!pool.length) pool = catalogLayers().filter(Boolean);
    if (!pool.length) {
      await botSay("Não achei camadas no catálogo. Abra Camadas no menu esquerdo e tente de novo.");
      return;
    }
    await botSay("Selecione a camada abaixo:");
    addLayerPicker(pool);
  }

  function visibleMetas() {
    const checked = window.InfraGeoLayers?.getState?.()?.checked || {};
    return catalogLayers().filter((m) => checked[m.id]);
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  const ALIASES = [
    { re: /\bpontes?\b|viaduto/, keys: ["ponte"] },
    { re: /\brodov|br-\d|federais?/, keys: ["rodov", "br_"] },
    { re: /\bbueiros?\b|galeria|drenagem/, keys: ["bueiro"] },
    { re: /\bbalsas?\b/, keys: ["balsa"] },
    { re: /\bjazidas?\b/, keys: ["jazida"] },
    { re: /\businas?\b/, keys: ["usina"] },
    { re: /canteiro/, keys: ["canteiro"] },
    { re: /\bprad\b|\bpca\b/, keys: ["prad", "pca"] },
    { re: /poste|luz|ilumin|lampada|farol/, keys: ["ilumin", "poste", "energia"] },
    { re: /lote|terreno|imovel|imóvel|parcela/, keys: ["lote", "imovel", "parcela", "cadastro"] },
    { re: /rio|igarape|igarapé|hidro|aguas|águas/, keys: ["hidro", "rio", "agua"] },
    { re: /via|rua|estrada|rodovia/, keys: ["via", "rodov", "estrada", "eixo"] },
    { re: /edific|predio|prédio|construcao|construção/, keys: ["edific", "predio", "constr"] },
    { re: /vegeta|floresta|mata/, keys: ["veget", "florest", "uso"] },
    { re: /limite|municip|estado|divisa/, keys: ["limite", "municip", "divisa", "malha"] },
  ];

  let draft = null;
  let pickHandler = null;
  let pendingMap = null;
  let chatEnded = false;

  function catalogLayers() {
    return window.InfraGeoLayers?.allLayerMetas?.() || [];
  }

  function layerLabel(meta) {
    return String(meta?.name || meta?.title || meta?.table || meta?.id || "").trim();
  }

  function layerSearchText(meta) {
    return normalize(
      [meta.id, meta.name, meta.title, meta.table, meta.schema, meta.group, meta.groupId].filter(Boolean).join(" ")
    );
  }

  function scoreLayer(meta, t) {
    const hay = layerSearchText(meta);
    const label = normalize(layerLabel(meta));
    let n = 0;
    if (label && t.includes(label)) n += 14;
    label.split(/\s+/).filter((w) => w.length > 2).forEach((w) => {
      if (t.includes(w)) n += w.length > 4 ? 3 : 2;
    });
    const brs = [...t.matchAll(/br[\s\-_]*(\d{2,4})/g)].map((m) => m[1]);
    brs.forEach((num) => {
      if (!num) return;
      if (hay.includes(`br_${num}`) || hay.includes(`br-${num}`) || hay.includes(num)) n += 10;
    });
    ALIASES.forEach((alias) => {
      if (alias.re.test(t) && alias.keys.some((k) => hay.includes(k))) n += 8;
    });
    return n;
  }

  function filterLayersByText(pool, text) {
    const t = normalize(text);
    if (!t || !pool.length) return pool;
    const hits = pool.filter((m) => scoreLayer(m, t) >= 6);
    return hits.length ? hits : pool;
  }

  function uniqueLayerFromText(text, pool) {
    const t = normalize(String(text || "").trim());
    const layers = pool || catalogLayers();
    if (!t || t.length < 5) return null;
    const exact = layers.filter((m) => normalize(layerLabel(m)) === t);
    if (exact.length === 1) return exact[0];
    return null;
  }

  function classifyTicket(text) {
    const t = normalize(text);
    if (
      hasKindKeyword(text, "reclamacao") ||
      t.startsWith("reclamacao:") ||
      t.startsWith("correcao:")
    ) {
      return "reclamacao";
    }
    if (hasKindKeyword(text, "sugestao") || t.startsWith("sugestao:")) return "sugestao";
    if (/\berro\b|\bbug\b|nao funciona|travou|falha|quebr/.test(t)) return "reclamacao";
    return null;
  }

  function hasKindKeyword(text, kind) {
    const t = normalize(text);
    if (kind === "reclamacao") {
      return /reclam|reclamacao|reclamo|reclama|reclamar|correcao|correcoes|corrigir/.test(t);
    }
    return /sugest|sugerir|sugiro|sugere/.test(t);
  }

  function inferKind(text, fallback) {
    const t = normalize(text);
    const rec =
      hasKindKeyword(text, "reclamacao") ||
      /\b(buraco|cratera|erro|bug|quebr|falha|nao funciona|travou|errado|corrigir)\b/.test(t);
    const sug = hasKindKeyword(text, "sugestao") || /\b(adicionar|incluir|poderia|seria bom|melhorar|nova camada)\b/.test(t);
    if (rec && !sug) return "reclamacao";
    if (sug && !rec) return "sugestao";
    if (rec) return "reclamacao";
    return fallback || null;
  }

  function visibleLayerNames() {
    return visibleMetas()
      .map((m) => layerLabel(m))
      .filter(Boolean)
      .slice(0, 6);
  }

  function contextLine() {
    const names = visibleLayerNames();
    if (!names.length) return "";
    return " Camadas visíveis agora: " + names.join(", ") + ".";
  }

  function mapGeo() {
    const map = window.InfraGeoMap?.getMap?.();
    const b = map?.getBounds?.();
    const c = map?.getCenter?.();
    return {
      map,
      bbox: b?.isValid?.()
        ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(6)).join(",")
        : "",
      center: c ? { lat: c.lat, lng: c.lng } : null,
    };
  }

  function setPickHint(on) {
    const hint = document.getElementById("ig-agent-pick");
    if (hint) hint.hidden = !on;
    const map = window.InfraGeoMap?.getMap?.();
    const el = map?.getContainer?.();
    if (el) el.classList.toggle("ig-agent-pick-map", !!on);
  }

  function stopPick() {
    const geo = mapGeo();
    if (geo.map && pickHandler) geo.map.off("click", pickHandler);
    pickHandler = null;
    setPickHint(false);
  }

  function propBy(p, names) {
    const keys = Object.keys(p || {});
    for (const want of names) {
      const k = keys.find((x) => {
        const n = String(x).toLowerCase();
        return n === want || n.includes(want);
      });
      if (k != null && String(p[k] ?? "").trim()) return String(p[k]).trim();
    }
    return "";
  }

  function kindFromLayer(name) {
    const n = String(name || "").toLowerCase();
    if (n.includes("bueiro")) return "Bueiro";
    if (n.includes("ponte")) return "Ponte";
    if (n.includes("balsa")) return "Balsa";
    if (n.includes("jazida")) return "Jazida";
    if (n.includes("usina")) return "Usina";
    if (n.includes("canteiro")) return "Canteiro";
    return "";
  }

  function featureLabel(props, layerName) {
    const p = props || {};
    const kind = kindFromLayer(layerName);
    const nome = propBy(p, ["nome", "name_ponte", "name", "local", "identificacao"]);
    const km = propBy(p, ["km", "quilom"]);
    const tipo = propBy(p, ["tipo"]);
    const lote = propBy(p, ["lote"]);
    const snv = propBy(p, ["snv"]);
    const mun = propBy(p, ["municipio", "município"]);
    const bits = [];
    if (kind) bits.push(kind);
    if (nome && normalize(nome) !== normalize(kind)) bits.push(nome);
    if (km) bits.push("km " + km);
    if (tipo) bits.push(tipo);
    if (lote) bits.push("lote " + lote);
    if (mun) bits.push(mun);
    if (snv && !nome) bits.push("SNV " + snv);
    if (bits.length) return bits.join(" · ");
    const skip = /^(id|gid|fid|objectid|oid|lat|long|lng|lon|geom|epsg|srid|shape)/i;
    for (const k of Object.keys(p)) {
      if (skip.test(k)) continue;
      const v = String(p[k] ?? "").trim();
      if (v.length > 1) return v;
    }
    return "Registro da camada";
  }

  function featureCenter(lyr) {
    try {
      if (lyr?.getLatLng) return lyr.getLatLng();
      if (lyr?.getBounds) {
        const b = lyr.getBounds();
        if (b?.isValid?.()) return b.getCenter();
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  async function collectLayerFeatures(layerId) {
    const meta = catalogLayers().find((l) => String(l.id) === String(layerId));
    if (!meta) return [];
    try {
      if (!window.InfraGeoMap?.overlayRegistry?.[layerId]) {
        await window.InfraGeoMap.loadGeoJSONLayer(meta);
      }
      await window.InfraGeoLayers?.setLayerVisible?.(layerId, true);
    } catch {
      /* ignore */
    }
    const entry = window.InfraGeoMap?.overlayRegistry?.[layerId];
    const out = [];
    entry?.leaflet?.eachLayer?.((lyr) => {
      if (!lyr.feature) return;
      const props = lyr.feature.properties || {};
      const c = featureCenter(lyr);
      out.push({
        label: featureLabel(props, meta.name || draft?.layerName || ""),
        props,
        lat: c ? Number(c.lat.toFixed(6)) : null,
        lng: c ? Number(c.lng.toFixed(6)) : null,
      });
    });
    out.sort((a, b) => String(a.label).localeCompare(String(b.label), "pt-BR"));
    return out;
  }

  async function showFeatureChoices(query) {
    if (!draft?.layerId) return;
    if (!draft.features) {
      await botSay("Buscando os pontos cadastrados em " + draft.layerName + "…");
      draft.features = await collectLayerFeatures(draft.layerId);
    }
    const all = draft.features || [];
    if (!all.length) {
      draft.featurePicked = true;
      await botSay("Vou registrar só na camada.");
      await tryAdvance();
      return;
    }
    const rawQ = query || draft.featureQuery || "";
    if (isPhotoTalk(rawQ)) {
      draft.featureQuery = "";
      await askRegisterAfterPhoto();
      return;
    }
    const q = normalize(rawQ);
    let list = all;
    if (q) {
      list = all.filter((f) => {
        const blob = normalize(f.label + " " + Object.values(f.props || {}).join(" "));
        return q.split(/\s+/).filter((t) => t.length > 1).every((t) => blob.includes(t)) || blob.includes(q);
      });
    }
    if (!list.length) {
      await botSay("Não achei um ponto com esse nome. Toque na lista ou em Só a camada.");
      list = all.slice(0, 12);
    } else {
      list = list.slice(0, 12);
    }
    await botSay("Se quiser, toque no ponto. Ou em Só a camada.");
    const box = document.createElement("div");
    box.className = "ig-agent__review ig-agent__review--list";
    list.forEach((feat) => {
      const idx = all.indexOf(feat);
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-pick-feat", String(idx));
      b.textContent = feat.label;
      box.appendChild(b);
    });
    const skip = document.createElement("button");
    skip.type = "button";
    skip.setAttribute("data-skip-feat", "1");
    skip.textContent = "Só a camada";
    box.appendChild(skip);
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
  }

  async function applyPickedFeature(idx) {
    const feat = draft?.features?.[Number(idx)];
    if (!feat) return;
    draft.keyword = feat.label;
    draft.place = feat.label;
    draft.lat = feat.lat;
    draft.lng = feat.lng;
    draft.featurePicked = true;
    addMsg(feat.label, "user");
    await botSay("Ponto anotado: " + feat.label + ".");
    await tryAdvance();
  }

  function extractKeyword(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const stop = new Set([
      "de", "da", "do", "das", "dos", "em", "no", "na", "nas", "nos", "um", "uma",
      "o", "a", "os", "as", "e", "ou", "para", "pra", "com", "por", "ao", "que",
      "qual", "onde", "lugar", "ponto", "mapa", "camada", "erro", "fica", "perto",
      "lado", "esta", "está", "desse", "dessa", "neste", "nesta", "aqui", "ali",
      "detalhe", "detalhadamente", "descricao", "descrição", "reclamacao", "sugestao",
    ]);
    const tokens = raw.split(/[^A-Za-zÀ-ÿ0-9-]+/).filter(Boolean);
    const scored = [];
    tokens.forEach((tok) => {
      const n = normalize(tok);
      if (n.length < 3 || stop.has(n)) return;
      let s = n.length;
      if (/^(br|am)-?\d/i.test(tok)) s += 8;
      if (/^\d/.test(tok)) s += 2;
      if (tok[0] === tok[0].toUpperCase()) s += 3;
      scored.push({ tok, s });
    });
    scored.sort((a, b) => b.s - a.s);
    return scored
      .slice(0, 2)
      .map((x) => x.tok)
      .join(" ")
      .slice(0, 80);
  }

  function hasUserDescription() {
    return !!String(draft?.userText || "").trim();
  }

  function composeMessage() {
    const u = String(draft?.userText || "").trim();
    const p = String(draft?.photoNote || "").trim();
    if (u && p && !u.includes(p)) return `${u} [Foto: ${p}]`;
    return u || p;
  }

  async function askUserDescription() {
    if (!draft) return;
    draft.stage = "ask";
    await botSay(
      draft.kind === "reclamacao"
        ? "Escreva o que está errado no mapa. A foto sozinha não registra."
        : "Escreva a sua sugestão. A foto sozinha não registra."
    );
  }

  function rememberUserText(text) {
    if (!draft) return;
    const clean = String(text || "").trim();
    if (!clean || isPhotoTalk(clean)) return;
    const t = normalize(clean);
    if (isYes(t) || isNo(t)) return;
    draft.userText = [draft.userText, clean].filter(Boolean).join(" ").trim();
    draft.message = composeMessage();
  }

  async function tryAdvance() {
    if (!draft) return;
    draft.message = composeMessage();
    if (!hasUserDescription()) {
      await askUserDescription();
      return;
    }
    const guessedKind = inferKind(draft.userText, draft.kind);
    if (guessedKind && guessedKind !== draft.kind) {
      draft.kind = guessedKind;
      draft.wantsLayer = guessedKind === "sugestao" ? null : true;
    }
    if (draft.kind === "sugestao" && draft.wantsLayer == null) {
      await askRelatedLayer();
      return;
    }
    if (draft.kind === "sugestao" && draft.wantsLayer === false) {
      draft.featurePicked = true;
      await registrarSugestaoErro();
      return;
    }
    if (!draft.layerName) {
      await askLayerInWords();
      return;
    }
    if (draft.kind === "sugestao") {
      draft.featurePicked = true;
      await registrarSugestaoErro();
      return;
    }
    if (!draft.featurePicked) {
      if (draft.photoUrl) {
        await askRegisterAfterPhoto();
        return;
      }
      draft.stage = "feature";
      await showFeatureChoices("");
      return;
    }
    await registrarSugestaoErro();
  }

  async function registrarSugestaoErro() {
    if (!draft) return;
    draft.message = composeMessage();
    if (!hasUserDescription()) {
      await askUserDescription();
      return;
    }
    if (draft.kind !== "sugestao" && !draft.layerName) {
      await tryAdvance();
      return;
    }
    const geo = mapGeo();
    const payload = {
      kind: draft.kind || "sugestao",
      message: draft.message,
      layer: draft.layerName,
      layer_id: draft.layerId || "",
      keyword: draft.keyword || "",
      place: draft.place || "",
      lat: draft.lat,
      lng: draft.lng,
      bbox: geo.bbox || "",
      photo_url: draft.photoUrl || "",
    };
    showTyping();
    try {
      const res = await fetch(apiUrl("/api/feedback"), {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      hideTyping();
      if (!res.ok) {
        const d = data.detail;
        throw new Error(typeof d === "string" ? d : "Não foi possível registrar.");
      }
      await botSay("Pronto. Enviei para a equipe.");
      draft = null;
      stopPick();
      await startMenu(false);
      return;
    } catch (err) {
      hideTyping();
      await botSay(err.message || "Não consegui registrar agora.");
    }
    draft = null;
    stopPick();
    await startMenu(false);
  }

  async function beginDraft(kind, text, opts) {
    const clean = String(text || "").trim();
    draft = {
      kind: kind || "sugestao",
      message: "",
      userText: "",
      photoNote: "",
      layerName: "",
      layerId: "",
      place: "",
      keyword: "",
      lat: null,
      lng: null,
      photoUrl: "",
      features: null,
      featurePicked: false,
      featureQuery: "",
      picking: false,
      stage: "ask",
      wantsLayer: kind === "sugestao" ? null : true,
    };
    closeTour();
    setComposerOpen(true);
    if (clean && !isPhotoTalk(clean) && !/^(registro com foto)$/i.test(clean)) {
      rememberUserText(clean);
    }
    if (!opts?.skipAdvance) await tryAdvance();
  }

  async function pickLayerMeta(meta) {
    if (!meta || !draft) return;
    await applyLayer(meta);
    await tryAdvance();
  }

  async function askLlm(mensagem) {
    showTyping();
    try {
      const vis = visibleMetas()
        .map(layerLabel)
        .filter(Boolean);
      const cat = catalogLayers()
        .map(layerLabel)
        .filter(Boolean)
        .slice(0, 40);
      const res = await fetch(apiUrl("/api/agent/reply"), {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(true),
        body: JSON.stringify({
          mensagem,
          camadas_ativas: vis,
          catalogo: cat,
          etapa: draft?.stage || "",
          tipo: draft?.kind || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      hideTyping();
      if (!res.ok) return null;
      if (!data || !data.acao) return null;
      return data;
    } catch {
      hideTyping();
      return null;
    }
  }

  function extractPlace(text) {
    const t = normalize(text);
    const known = [
      "presidente figueiredo",
      "rio preto da eva",
      "novo airão",
      "novo airao",
      "manaus",
      "parintins",
      "itacoatiara",
      "manacapuru",
      "tefe",
      "coari",
      "tabatinga",
      "humaita",
      "humaitá",
      "labrea",
      "lábrea",
      "maues",
      "maués",
      "borba",
      "autazes",
      "iranduba",
      "careiro",
    ];
    for (const p of known) {
      if (t.includes(normalize(p))) {
        return p
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }
    }
    const m = String(text || "").match(
      /(?:em|por|no|na|de)\s+([A-Za-zÁ-ú]{3,}(?:\s+[A-Za-zÁ-ú]{3,})?)/i
    );
    return m ? m[1] : "";
  }

  function metaBrNumber(meta) {
    const src = `${meta?.schema || ""} ${meta?.table || ""} ${meta?.name || ""} ${meta?.id || ""}`;
    return (
      window.InfraGeoBrShield?.extractBrNumber?.(src) ||
      (src.match(/BR[_\-\s]*(\d{2,4})/i) || [])[1] ||
      ""
    );
  }

  function isPonteMeta(meta) {
    return /ponte/.test(layerSearchText(meta));
  }

  const LAYER_TOPICS = [
    { re: /\bbueiros?\b|galeria|\boac\b/, hay: /bueiro|oac|galeria/, group: "oac", label: "bueiro", plural: "bueiros" },
    { re: /\bpontes?\b|\boae\b/, hay: /ponte|oae/, group: "oae", label: "ponte", plural: "pontes" },
    { re: /\businas?\b/, hay: /usina/, group: "usina", label: "usina", plural: "usinas" },
    { re: /\bcanteiro/, hay: /canteiro/, group: "canteiro", label: "canteiro", plural: "canteiros" },
    { re: /\bjazidas?\b/, hay: /jazida/, group: "jazidas", label: "jazida", plural: "jazidas" },
    { re: /\bfaixa/, hay: /faixa/, group: "faixa_dominio", label: "faixa de domínio", plural: "faixas de domínio" },
    { re: /\bprads?\b/, hay: /prad/, group: "prads", label: "PRAD", plural: "PRADs" },
  ];

  function topicFromText(t) {
    return LAYER_TOPICS.find((x) => x.re.test(t)) || null;
  }

  function metaMatchesTopic(meta, topic) {
    if (!topic || !meta) return false;
    const hay = layerSearchText(meta);
    if (topic.hay.test(hay)) return true;
    if (topic.group && String(meta.groupId || "") === topic.group) return true;
    return false;
  }

  function isRoadQuestion(t) {
    if (topicFromText(t)) return false;
    return (
      /\brodov/.test(t) ||
      /\bfederais?\b/.test(t) ||
      /\bpassa(m)? por\b/.test(t)
    );
  }

  function roadAxisMeta(brNum) {
    const num = String(brNum || "").replace(/\D/g, "");
    if (!num) return null;
    const hits = catalogLayers().filter((m) => metaBrNumber(m) === num);
    if (!hits.length) return null;
    const axis = hits.find((m) => !isPonteMeta(m) && !/bueiro|oae|oac|faixa/.test(layerSearchText(m)));
    return axis || hits.find((m) => !isPonteMeta(m)) || hits[0];
  }

  function catalogBrNumbers() {
    const nums = new Set();
    catalogLayers().forEach((m) => {
      const n = metaBrNumber(m);
      if (n) nums.add(n);
    });
    return [...nums].sort((a, b) => Number(a) - Number(b));
  }

  /** Rodovias federais que o InfraGeo trata por cidade (eixo, não ponte). */
  const PLACE_BRS = {
    manaus: {
      brs: ["174", "319"],
      detalhe: "A BR-174 segue ao norte e a BR-319 ao sul.",
    },
    iranduba: { brs: ["174", "319"], detalhe: "" },
  };

  function pickLayerFromText(text) {
    const t = normalize(text);
    const pool = catalogLayers().filter(Boolean);
    if (!pool.length || !t) return null;
    const topic = topicFromText(t);
    const brNum = (t.match(/br[\s\-_]*(\d{2,4})/) || [])[1];
    let candidates = pool;
    if (brNum) {
      const byBr = pool.filter((m) => metaBrNumber(m) === brNum);
      if (byBr.length) candidates = byBr;
    }
    if (topic) {
      const byTopic = candidates.filter((m) => metaMatchesTopic(m, topic));
      if (byTopic.length) {
        const scored = byTopic
          .map((m) => ({ m, n: scoreLayer(m, t) }))
          .sort((a, b) => b.n - a.n);
        return scored[0].m;
      }
    }
    if (brNum && !topic) {
      const axis = roadAxisMeta(brNum);
      if (axis) return axis;
    }
    let scored = candidates
      .map((m) => ({ m, n: scoreLayer(m, t) }))
      .sort((a, b) => b.n - a.n);
    if (isRoadQuestion(t) && !topic) {
      scored = scored.filter((x) => !isPonteMeta(x.m) && !/bueiro|usina/.test(layerSearchText(x.m)));
    }
    if (scored[0] && scored[0].n >= 5) return scored[0].m;
    return null;
  }

  function countGeojsonFeatures(entry) {
    const gj = entry?.geojson;
    if (gj?.type === "FeatureCollection") return (gj.features || []).length;
    if (gj?.type === "Feature") return 1;
    try {
      const g = entry?.leaflet?.toGeoJSON?.();
      if (g?.features) return g.features.length;
      if (g?.type === "Feature") return 1;
    } catch {
      /* ignore */
    }
    const n = entry?.leaflet?.getLayers?.()?.length;
    return Number.isFinite(n) ? n : null;
  }

  async function countLayerFeatures(meta) {
    if (!meta) return null;
    try {
      await window.InfraGeoLayers?.setLayerVisible?.(meta.id, true, { fit: false });
    } catch {
      /* ignore */
    }
    await sleep(250);
    const entry = window.InfraGeoMap?.overlayRegistry?.[meta.id];
    return countGeojsonFeatures(entry);
  }

  function answerFederalRoads(lugar) {
    const key = normalize(lugar || "");
    const fact = PLACE_BRS[key];
    const catalog = catalogBrNumbers();
    let brs = fact?.brs || [];
    if (brs.length && catalog.length) {
      brs = brs.filter((n) => catalog.includes(n));
    }
    if (!brs.length) brs = catalog.slice(0, 8);
    if (!brs.length) brs = fact?.brs || ["174", "319"];
    const labels = brs.map((n) => `BR-${n}`);
    const lista =
      labels.length === 1
        ? labels[0]
        : labels.length === 2
          ? `${labels[0]} e a ${labels[1]}`
          : `${labels.slice(0, -1).join(", ")} e a ${labels[labels.length - 1]}`;
    const detalhe = fact?.detalhe ? ` ${fact.detalhe}` : "";
    const layers = brs.map(roadAxisMeta).filter(Boolean);
    const cidade = lugar || "essa região";
    return {
      acao: "confirmar_mapa",
      resposta: `Sim. Em ${cidade} as rodovias federais no InfraGeo são a ${lista}.${detalhe} Quer que eu ligue as camadas e enquadre o mapa?`,
      camada: layers[0] ? layerLabel(layers[0]) : labels[0],
      lugar: lugar || "",
      layerIds: layers.map((m) => m.id),
    };
  }

  async function localMapReply(text) {
    const t = normalize(text);
    if (!t) return null;
    const lugar = extractPlace(text);
    const topic = topicFromText(t);
    const wantsNow =
      /\b(liga|ligar|mostra|mostrar|enquadra|enquadrar|abre|abra|abrir|exibe|exibir)\b/.test(
        t
      ) || isYes(t);
    const perguntaRodovia =
      isRoadQuestion(t) &&
      !topic &&
      !/\bbr[\s\-_]*\d{2,4}\b/.test(t) &&
      (/\b(tem|quais|qual|passa|passam|existe|existem)\b/.test(t) || !!lugar);

    if (perguntaRodovia && !wantsNow) {
      return answerFederalRoads(lugar);
    }

    const meta = pickLayerFromText(text);
    const nome = meta ? layerLabel(meta) : "";
    const brNum = (t.match(/br[\s\-_]*(\d{2,4})/) || [])[1];
    const where = brNum ? ` na BR-${brNum}` : lugar ? ` em ${lugar}` : "";

    if (meta && /\bquantos?\b|\bquantidade\b|\bquantas?\b/.test(t)) {
      const n = await countLayerFeatures(meta);
      const word =
        n === 1 ? topic?.label || "item" : topic?.plural || "itens";
      const resposta =
        n == null
          ? `Encontrei a camada ${nome}${where}, mas não consegui contar as feições. Quer que eu enquadre no mapa?`
          : `Na camada ${nome} há ${n} ${word}${where}. Quer que eu enquadre no mapa?`;
      return {
        acao: "confirmar_mapa",
        resposta,
        camada: nome,
        lugar: lugar || "",
        layerIds: [meta.id],
      };
    }
    if (wantsNow && (meta || lugar)) {
      return {
        acao: meta && lugar ? "ligar_e_enquadrar" : lugar ? "enquadrar" : "ligar_camada",
        resposta: "",
        camada: nome,
        lugar,
        layerIds: meta ? [meta.id] : [],
      };
    }
    if (meta && lugar) {
      return {
        acao: "confirmar_mapa",
        resposta: `Na camada ${nome} você encontra esse tema em ${lugar}. Quer que eu ligue a camada e enquadre?`,
        camada: nome,
        lugar,
        layerIds: [meta.id],
      };
    }
    if (meta) {
      return {
        acao: "confirmar_mapa",
        resposta: `Isso aparece na camada ${nome}. Quer que eu ligue essa camada no mapa?`,
        camada: nome,
        lugar: "",
        layerIds: [meta.id],
      };
    }
    if (lugar) {
      return {
        acao: "confirmar_mapa",
        resposta: `Posso enquadrar o mapa em ${lugar}. Quer que eu faça isso?`,
        camada: "",
        lugar,
      };
    }
    return null;
  }

  function resolveLayerName(nome) {
    const want = normalize(nome);
    if (!want) return null;
    const layers = catalogLayers().filter((m) => m && !isContextLayer(m));
    const exact = layers.filter((m) => normalize(layerLabel(m)) === want);
    if (exact.length === 1) return exact[0];
    const scored = layers
      .map((m) => ({ m, n: scoreLayer(m, want) }))
      .filter((x) => x.n >= 6)
      .sort((a, b) => b.n - a.n);
    if (!scored.length) return exact[0] || null;
    if (scored.length === 1 || scored[0].n >= (scored[1]?.n || 0) + 2) return scored[0].m;
    return scored[0].m;
  }

  async function geocodePlace(lugar) {
    const q = String(lugar || "").trim();
    if (!q) return null;
    const url = apiUrl(
      `/api/geocoding/search?q=${encodeURIComponent(`${q} Amazonas Brasil`)}&limit=5`
    );
    const res = await fetch(url, { credentials: "same-origin", headers: authHeaders() });
    const items = await res.json().catch(() => []);
    if (!res.ok || !Array.isArray(items) || !items.length) return null;
    const am = items.filter((i) => /amazonas/i.test(String(i.display_name || "")));
    return am[0] || items[0];
  }

  async function flyToPlace(lugar) {
    const hit = await geocodePlace(lugar);
    const map = window.InfraGeoMap?.getMap?.();
    if (!hit || !map || !window.L) return false;
    const bbox = hit.bbox;
    if (Array.isArray(bbox) && bbox.length >= 4) {
      const south = Number(bbox[0]);
      const north = Number(bbox[1]);
      const west = Number(bbox[2]);
      const east = Number(bbox[3]);
      if ([south, north, west, east].every(Number.isFinite)) {
        map.fitBounds(L.latLngBounds([south, west], [north, east]), {
          padding: [48, 48],
          maxZoom: 13,
          animate: true,
        });
        return true;
      }
    }
    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    map.setView([lat, lon], 12, { animate: true });
    return true;
  }

  async function runMapAction(action) {
    const lugar = String(action?.lugar || "").trim();
    const wantLayer = action?.acao !== "enquadrar";
    const wantPlace = action?.acao !== "ligar_camada";
    let metas = [];
    (action?.layerIds || []).forEach((id) => {
      const found = catalogLayers().find((l) => String(l.id) === String(id));
      if (found) metas.push(found);
    });
    const meta = metas[0] || resolveLayerName(action?.camada);
    if (meta && !metas.length) metas = [meta];
    let ligou = false;
    let enquadrou = false;
    if (wantLayer && metas.length) {
      for (const m of metas) {
        try {
          await window.InfraGeoLayers?.setLayerVisible?.(m.id, true, { fit: false });
          ligou = true;
        } catch {
          /* ignore */
        }
      }
      if (ligou) await sleep(350);
    }
    if (wantPlace && lugar) {
      enquadrou = await flyToPlace(lugar);
    } else if (ligou && meta) {
      window.InfraGeoLayers?.fitToLayer?.(meta.id);
      enquadrou = true;
    }
    const nome = metas.length
      ? metas.map(layerLabel).filter(Boolean).join(", ")
      : meta
        ? layerLabel(meta)
        : "";
    if (ligou && enquadrou && lugar) {
      await botSay(`Pronto: camada ${nome} ligada e mapa enquadrado em ${lugar}.`);
    } else if (ligou && nome) {
      await botSay(`Pronto: camada ${nome} ligada.`);
    } else if (enquadrou && lugar) {
      await botSay(`Pronto: mapa enquadrado em ${lugar}.`);
    } else if (wantLayer && !meta) {
      await botSay("Não achei essa camada no catálogo. Diga o nome como aparece em Camadas.");
    } else {
      await botSay("Não consegui alterar o mapa agora.");
    }
    pendingMap = null;
  }

  async function applyLlmTurn(data, userText) {
    if (!data) return false;
    if (data.resposta) await botSay(data.resposta);
    const acao = String(data.acao || "responder");
    if (
      acao === "confirmar_mapa" ||
      acao === "ligar_camada" ||
      acao === "enquadrar" ||
      acao === "ligar_e_enquadrar"
    ) {
      const action = {
        acao,
        camada: data.camada || pendingMap?.camada || "",
        lugar: data.lugar || pendingMap?.lugar || "",
        layerIds: data.layerIds || pendingMap?.layerIds || [],
      };
      if (acao === "confirmar_mapa") {
        pendingMap = action;
        return true;
      }
      await runMapAction(action);
      return true;
    }
    if (acao === "pular_camada" && draft) {
      draft.wantsLayer = false;
      draft.featurePicked = true;
      if (userText && !isPhotoTalk(userText)) {
        draft.message = [draft.message, userText].filter(Boolean).join(" ");
      }
      await registrarSugestaoErro();
      return true;
    }
    if (acao === "listar_camadas") {
      if (draft) {
        draft.wantsLayer = true;
        draft.stage = "layer";
      }
      await askLayerInWords();
      return true;
    }
    if (acao === "vincular_camada" && data.camada) {
      const nome = String(data.camada);
      const meta = catalogLayers().find((m) => layerLabel(m) === nome);
      if (meta) {
        await pickLayerMeta(meta);
        return true;
      }
      await askLayerInWords();
      return true;
    }
    if (acao === "registrar" && draft) {
      draft.featurePicked = true;
      if (userText && !isPhotoTalk(userText)) {
        draft.message = [draft.message, userText].filter(Boolean).join(" ");
      }
      await registrarSugestaoErro();
      return true;
    }
    return true;
  }

  async function handleUserText(text) {
    const clean = String(text || "").trim();
    if (pendingMap && clean) {
      const t = normalize(clean);
      if (isYes(t)) {
        pendingMap.acao = pendingMap.camada && pendingMap.lugar
          ? "ligar_e_enquadrar"
          : pendingMap.lugar
            ? "enquadrar"
            : "ligar_camada";
        await runMapAction(pendingMap);
        return;
      }
      if (isNo(t)) {
        pendingMap = null;
        await botSay("Certo, deixo o mapa como está.");
        return;
      }
    }
    if (!draft) {
      if (hasKindKeyword(clean, "reclamacao") || hasKindKeyword(clean, "sugestao")) {
        const kind = inferKind(clean, classifyTicket(clean)) || "sugestao";
        await beginDraft(kind, clean);
        return;
      }
      await refuseChat();
      return;
    }
    if (draft.stage === "after-photo" && clean) {
      const t = normalize(clean);
      if (isNo(t) || /finalizar|encerrar|fechar/.test(t)) {
        await finishChat();
        return;
      }
      rememberUserText(clean);
      await tryAdvance();
      return;
    }
    if (draft.stage === "related" && clean) {
      const t = normalize(clean);
      if (isYes(t)) {
        await applyRelatedChoice(true);
        return;
      }
      if (isNo(t)) {
        await applyRelatedChoice(false);
        return;
      }
      rememberUserText(clean);
      await botSay("É de alguma camada do mapa? Toque em Sim ou Não.");
      return;
    }
    if (draft.stage === "free") {
      rememberUserText(clean);
      await registrarSugestaoErro();
      return;
    }
    if (draft.stage === "layer" && clean) {
      const vis = visibleMetas().filter((m) => !isContextLayer(m));
      const exact = uniqueLayerFromText(clean, vis) || uniqueLayerFromText(clean, catalogLayers());
      if (exact) {
        await pickLayerMeta(exact);
        return;
      }
      await botSay("Selecione a camada abaixo, ou diga se não quiser vincular a nenhuma.");
      addLayerPicker(catalogLayers().filter((m) => m && !isContextLayer(m)));
      return;
    }
    if (draft.stage === "confirm" && clean) {
      const t = normalize(clean);
      if (isYes(t) || /registrar/.test(t)) {
        draft.featurePicked = true;
        await registrarSugestaoErro();
        return;
      }
      if (isNo(t) || /ponto|lista/.test(t)) {
        await showFeatureChoices("");
        return;
      }
    }
    if (draft.stage === "feature" && clean) {
      if (isPhotoTalk(clean)) {
        await askRegisterAfterPhoto();
        return;
      }
      draft.featureQuery = clean;
      await showFeatureChoices(clean);
      return;
    }
    if (draft.stage === "place" && clean) {
      draft.featureQuery = clean;
      draft.place = clean;
      await showFeatureChoices(clean);
      return;
    }
    rememberUserText(clean);
    await tryAdvance();
  }

  function setComposerOpen(on) {
    form.classList.toggle("is-locked", !on);
    input.disabled = !on;
    const send = form.querySelector(".ig-agent__send");
    if (send) send.disabled = !on;
    const photo = document.getElementById("ig-agent-photo");
    if (photo) photo.disabled = !on;
    document.querySelector(".ig-agent__photo")?.classList.toggle("is-off", !on);
    if (on) {
      input.placeholder = draft
        ? draft.kind === "reclamacao"
          ? "Descreva a correção…"
          : "Descreva a sugestão…"
        : "Descreva a sugestão ou correção…";
      input.focus();
    } else {
      input.value = "";
      input.placeholder = "Descreva a sugestão ou correção…";
      input.blur();
    }
  }

  const NOT_CHAT =
    "Este agente não é um chat de conversa nem de inteligência artificial. Ele só registra correções e sugestões no mapa.";

  async function refuseChat() {
    await botSay(NOT_CHAT + " Escolha uma opção abaixo.");
    addChoices(menuChoices(), "menu");
  }

  function menuChoices() {
    return [
      { label: "Enviar uma sugestão", attrs: { "data-intent": "sugestao" } },
      { label: "Registrar uma correção", attrs: { "data-intent": "reclamacao" } },
    ];
  }

  async function startMenu(greet) {
    draft = null;
    pendingMap = null;
    stopPick();
    setComposerOpen(true);
    if (greet !== false && !log.querySelector(".ig-agent__msg")) {
      addMsg(NOT_CHAT, "bot");
    } else if (greet === false) {
      await botSay("Escolha uma opção para registrar no mapa:");
    }
    addChoices(menuChoices(), "menu");
  }

  async function newChat() {
    hideTyping();
    chatEnded = false;
    draft = null;
    pendingMap = null;
    stopPick();
    log.innerHTML = "";
    setComposerOpen(false);
    openPanel();
    await startMenu(true);
  }

  async function openPanel() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    pokeAgent();
    if (chatEnded || (!draft && !log.querySelector(".ig-agent__msg"))) {
      chatEnded = false;
      log.innerHTML = "";
      void startMenu(true);
      return;
    }
    if (!draft) setComposerOpen(true);
    if (!input.disabled) input.focus();
  }

  async function showHowto() {
    setComposerOpen(false);
    await botSay(
      "Pergunte como no mapa: por exemplo, quais rodovias passam por Manaus. Eu respondo e, se você quiser, ligo a camada e enquadro o lugar.\n\n" +
        "Sugestão: ideia nova ou melhorar o mapa.\n" +
        "Reclamação: buraco, erro, dado que não bate com o campo. Foto é opcional."
    );
  }

  async function takeIntent(kind) {
    if (kind === "reclamacao" || kind === "correcao") {
      await beginDraft("reclamacao", "");
      return;
    }
    if (kind === "sugestao") {
      await beginDraft("sugestao", "");
      return;
    }
    await refuseChat();
  }

  function closePanel() {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    fab?.classList.remove("is-poke");
    if (chatEnded) {
      log.innerHTML = "";
      draft = null;
      setComposerOpen(false);
    }
  }

  function pokeAgent() {
    fab?.classList.add("is-poke");
  }

  fab.addEventListener("click", () => {
    pokeAgent();
    if (panel.hidden) openPanel();
    else closePanel();
  });
  document.getElementById("btn-nav-agente")?.addEventListener("click", () => {
    pokeAgent();
    openPanel();
  });
  document.getElementById("btn-ig-agent-close")?.addEventListener("click", closePanel);
  document.getElementById("btn-ig-agent-new")?.addEventListener("click", () => {
    void newChat();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !coachOn) return;
    ev.preventDefault();
    closeTour();
  });

  tourEl?.addEventListener("click", (ev) => {
    const stepBtn = ev.target.closest("[data-tour-step]");
    if (stepBtn) {
      tourIndex = Number(stepBtn.getAttribute("data-tour-step")) || 0;
      paintTour();
      runGuideGo(TOUR_STEPS[tourIndex].go);
      return;
    }
    if (ev.target.closest("[data-tour-next]")) {
      tourIndex = (tourIndex + 1) % TOUR_STEPS.length;
      paintTour();
      runGuideGo(TOUR_STEPS[tourIndex].go);
      return;
    }
    const go = ev.target.closest("[data-guide-go]");
    if (go) runGuideGo(go.getAttribute("data-guide-go"));
  });

  document.getElementById("ig-agent-chips")?.addEventListener("click", (ev) => {
    const guideBtn = ev.target.closest("[data-guide]");
    if (guideBtn) {
      openPanel();
      showGuide(guideBtn.getAttribute("data-guide") || "home");
      return;
    }
    const btn = ev.target.closest("[data-ticket]");
    if (!btn) return;
    const ticket = btn.getAttribute("data-ticket");
    openPanel();
    addMsg(btn.textContent || "", "user");
    void takeIntent(ticket);
    input.focus();
  });

  log.addEventListener("click", (ev) => {
    const go = ev.target.closest("[data-guide-go]");
    if (go) {
      runGuideGo(go.getAttribute("data-guide-go"));
      return;
    }
    const guideBtn = ev.target.closest("[data-guide]");
    if (guideBtn) {
      showGuide(guideBtn.getAttribute("data-guide") || "home");
      return;
    }
    const photoMore = ev.target.closest("[data-photo-more]");
    if (photoMore) {
      freezeChoices(photoMore);
      addMsg(photoMore.textContent || "Sim, quero escrever", "user");
      if (draft) draft.stage = "ask";
      setComposerOpen(true);
      void askUserDescription();
      return;
    }
    const photoEnd = ev.target.closest("[data-photo-end]");
    if (photoEnd) {
      freezeChoices(photoEnd);
      addMsg(photoEnd.textContent || "Não, finalizar", "user");
      void finishChat();
      return;
    }
    const agentClose = ev.target.closest("[data-agent-close]");
    if (agentClose) {
      freezeChoices(agentClose);
      closePanel();
      return;
    }
    const agentNew = ev.target.closest("[data-agent-new]");
    if (agentNew) {
      freezeChoices(agentNew);
      void newChat();
      return;
    }
    const intentBtn = ev.target.closest("[data-intent]");
    if (intentBtn) {
      addMsg(intentBtn.textContent || "Opção", "user");
      void takeIntent(intentBtn.getAttribute("data-intent") || "sugestao");
      return;
    }
    const relatedBtn = ev.target.closest("[data-related]");
    if (relatedBtn && draft) {
      freezeChoices(relatedBtn);
      const yes = relatedBtn.getAttribute("data-related") === "sim";
      addMsg(relatedBtn.textContent || (yes ? "Sim" : "Não"), "user");
      void applyRelatedChoice(yes);
      return;
    }
    const registerBtn = ev.target.closest("[data-register-now]");
    if (registerBtn && draft) {
      freezeChoices(registerBtn);
      addMsg("Sim, registrar", "user");
      draft.featurePicked = true;
      void registrarSugestaoErro();
      return;
    }
    const showFeats = ev.target.closest("[data-show-feats]");
    if (showFeats && draft) {
      freezeChoices(showFeats);
      addMsg("Escolher um ponto", "user");
      void showFeatureChoices("");
      return;
    }
    const featBtn = ev.target.closest("[data-pick-feat]");
    if (featBtn && draft) {
      freezeChoices(featBtn);
      void applyPickedFeature(featBtn.getAttribute("data-pick-feat"));
      return;
    }
    const skipFeat = ev.target.closest("[data-skip-feat]");
    if (skipFeat && draft) {
      freezeChoices(skipFeat);
      draft.featurePicked = true;
      addMsg("Só a camada", "user");
      void tryAdvance();
      return;
    }
    const layerBtn = ev.target.closest("[data-pick-layer]");
    if (layerBtn && draft) {
      freezeChoices(layerBtn);
      const id = layerBtn.getAttribute("data-pick-layer");
      const meta = catalogLayers().find((l) => String(l.id) === String(id));
      addMsg(layerBtn.textContent || "Camada", "user");
      void pickLayerMeta(meta);
      return;
    }
    const btn = ev.target.closest("[data-review]");
    if (!btn || !draft) return;
    if (btn.getAttribute("data-review") === "edit") {
      draft.stage = "ask";
      draft.message = "";
      addMsg("Envie o texto corrigido.", "bot");
      input.focus();
    }
  });

  const pendingBox = document.getElementById("ig-agent-pending");
  const pendingImg = document.getElementById("ig-agent-pending-img");
  let pendingPhoto = null;
  let pendingPreviewUrl = "";

  function clearPendingPhoto() {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    pendingPhoto = null;
    pendingPreviewUrl = "";
    if (pendingImg) pendingImg.removeAttribute("src");
    if (pendingBox) pendingBox.hidden = true;
  }

  function setPendingPhoto(file) {
    if (!file || !String(file.type || "").startsWith("image/")) return;
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    pendingPhoto = file;
    pendingPreviewUrl = URL.createObjectURL(file);
    if (pendingImg) pendingImg.src = pendingPreviewUrl;
    if (pendingBox) pendingBox.hidden = false;
    input.focus();
  }

  async function uploadPendingPhoto() {
    if (!pendingPhoto) return "";
    const file = pendingPhoto;
    const body = new FormData();
    body.append("file", file);
    const headers = authHeaders();
    delete headers["Content-Type"];
    const res = await fetch(apiUrl("/api/feedback/photo"), {
      method: "POST",
      credentials: "same-origin",
      headers,
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : "Falha no envio da foto.");
    }
    clearPendingPhoto();
    return data.url || "";
  }

  function addUserMsg(text, imgUrl) {
    const el = addMsg(text || (imgUrl ? "Imagem" : ""), "user");
    if (imgUrl && el) {
      const img = document.createElement("img");
      img.src = imgUrl;
      img.alt = "Imagem enviada";
      el.appendChild(img);
    }
  }

  function takePastedImage(ev) {
    const clip = ev.clipboardData;
    if (!clip) return false;
    const items = clip.items || [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && String(item.type || "").startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          ev.preventDefault();
          setPendingPhoto(file);
          return true;
        }
      }
    }
    if (clip.files && clip.files.length) {
      for (let i = 0; i < clip.files.length; i += 1) {
        const file = clip.files[i];
        if (file && String(file.type || "").startsWith("image/")) {
          ev.preventDefault();
          setPendingPhoto(file);
          return true;
        }
      }
    }
    return false;
  }

  document.getElementById("ig-agent-photo")?.addEventListener("change", (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (file) setPendingPhoto(file);
  });

  document.getElementById("ig-agent-pending-clear")?.addEventListener("click", () => {
    clearPendingPhoto();
    input.focus();
  });

  document.addEventListener("paste", (ev) => {
    if (panel.hidden || input.disabled) return;
    const t = ev.target;
    if (t && t !== input && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    takePastedImage(ev);
  });

  function resizeComposer() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 136) + "px";
  }

  input.addEventListener("input", resizeComposer);

  input.addEventListener("keydown", (ev) => {
    if (input.disabled) return;
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (input.disabled) return;
    const text = (input.value || "").trim();
    const hasPhoto = !!pendingPhoto;
    if (!text && !hasPhoto) return;
    input.value = "";
    resizeComposer();
    let photoUrl = "";
    if (hasPhoto) {
      try {
        photoUrl = await uploadPendingPhoto();
      } catch (err) {
        addMsg(err.message || "Não consegui enviar a foto.", "bot");
        return;
      }
    }
    addUserMsg(text, photoUrl);
    let vision = null;
    if (photoUrl) {
      if (draft) draft.photoUrl = photoUrl;
      vision = await applyPhotoVision(photoUrl);
    }
    if (photoUrl && (!text || isPhotoTalk(text))) {
      if (!draft) {
        const kind = vision?.tipo === "sugestao" ? "sugestao" : "reclamacao";
        await beginDraft(kind, text && !isPhotoTalk(text) ? text : "", { skipAdvance: true });
        applyVisionToDraft(vision);
        if (draft) draft.photoUrl = photoUrl;
      } else {
        applyVisionToDraft(vision);
      }
      await askMoreAfterPhoto();
      return;
    }
    if (text) {
      if (vision) applyVisionToDraft(vision);
      await handleUserText(text);
      return;
    }
    if (photoUrl && !draft) {
      await beginDraft(
        vision?.tipo === "sugestao" ? "sugestao" : "reclamacao",
        "",
        { skipAdvance: true }
      );
      applyVisionToDraft(vision);
      if (draft) draft.photoUrl = photoUrl;
      await tryAdvance();
    }
  });

})();
