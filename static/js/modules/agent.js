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

  function addChoices(items) {
    const box = document.createElement("div");
    box.className = "ig-agent__review";
    items.forEach((item) => {
      const b = document.createElement("button");
      b.type = "button";
      Object.keys(item.attrs || {}).forEach((k) => b.setAttribute(k, item.attrs[k]));
      b.textContent = item.label;
      box.appendChild(b);
    });
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
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
      if (act === "skip") closeTour();
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
      addMsg("Pronto. Você já viu Camadas, mapa, filtros, exportar e a conta. Pode explorar à vontade.", "bot");
      openPanel();
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

  function applyLayer(meta, note) {
    if (!draft || !meta) return;
    draft.layerId = String(meta.id || "");
    draft.layerName = layerLabel(meta);
    try {
      window.InfraGeoLayers?.setLayerVisible?.(draft.layerId, true);
    } catch {
      /* ignore */
    }
    addMsg(
      note ||
        ("Vou usar a camada “" +
          draft.layerName +
          "”. Se não for essa, escreva o nome certo — por exemplo pontes BR-319."),
      "bot"
    );
  }

  function askLayerInWords() {
    draft.stage = "layer";
    pulse("#btn-nav-camadas");
    const vis = visibleMetas().filter((m) => !isContextLayer(m));
    if (vis.length === 1) {
      applyLayer(
        vis[0],
        "Estou usando a camada que já está ligada no mapa: “" + layerLabel(vis[0]) + "”. Se for outra, escreva o nome."
      );
      tryAdvance();
      return;
    }
    let hint = "Não precisa clicar em camada aqui. Escreva o tipo do problema, por exemplo: pontes BR-319, bueiros, balsas.";
    if (vis.length > 1) {
      hint +=
        " Ou ligue só a camada certa no painel Camadas e escreva: usar a do mapa. Ligadas agora: " +
        vis
          .slice(0, 5)
          .map(layerLabel)
          .join(", ") +
        ".";
    } else {
      hint += " Também pode ligar a camada no painel Camadas e escrever: usar a do mapa.";
    }
    addMsg(hint, "bot");
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
    const brs = t.match(/br[\s-]*\d{3}/g) || [];
    brs.forEach((b) => {
      const num = b.replace(/\D/g, "");
      if (num && hay.includes(num)) n += 6;
    });
    ALIASES.forEach((alias) => {
      if (alias.re.test(t) && alias.keys.some((k) => hay.includes(k))) n += 8;
    });
    return n;
  }

  function matchLayerFromText(text, pool) {
    const t = normalize(text);
    const layers = pool || catalogLayers();
    if (!t || !layers.length) return null;
    let best = null;
    let score = 0;
    let second = 0;
    layers.forEach((meta) => {
      const n = scoreLayer(meta, t);
      if (n > score) {
        second = score;
        score = n;
        best = meta;
      } else if (n > second) {
        second = n;
      }
    });
    if (score >= 6) return best;
    if (score >= 4 && score > second) return best;
    return null;
  }

  function classifyTicket(text) {
    const t = normalize(text);
    if (t.startsWith("reclamacao:") || /\breclama|\berro\b|\bbug\b|nao funciona|travou|falha|quebr|errado|incorret|desatual/.test(t)) {
      return "reclamacao";
    }
    if (t.startsWith("sugestao:") || /\bsugest|poderia|seria bom|incluir|adicionar|melhorar|corrig/.test(t)) {
      return "sugestao";
    }
    return null;
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
      addMsg("Carregando os registros oficiais da camada “" + draft.layerName + "”…", "bot");
      draft.features = await collectLayerFeatures(draft.layerId);
    }
    const all = draft.features || [];
    if (!all.length) {
      addMsg("Esta camada não trouxe registros para escolher. A ocorrência será ligada só à camada.", "bot");
      draft.featurePicked = true;
      tryAdvance();
      return;
    }
    const q = normalize(query || draft.featureQuery || "");
    let list = all;
    if (q) {
      list = all.filter((f) => {
        const blob = normalize(f.label + " " + Object.values(f.props || {}).join(" "));
        return q.split(/\s+/).filter((t) => t.length > 1).every((t) => blob.includes(t)) || blob.includes(q);
      });
    }
    if (!list.length) {
      addMsg("Nenhum registro com esse texto. Veja as opções abaixo ou envie outro nome (ex.: o nome da ponte).", "bot");
      list = all.slice(0, 12);
    } else {
      list = list.slice(0, 12);
    }
    const kind = kindFromLayer(draft.layerName) || "item";
    addMsg(
      "Cada botão é um " +
        kind.toLowerCase() +
        " cadastrado em “" +
        draft.layerName +
        "” (nome, km, tipo). Escolha o que tem o problema. Se não estiver na lista, digite o km ou o nome para filtrar.",
      "bot"
    );
    const box = document.createElement("div");
    box.className = "ig-agent__review";
    list.forEach((feat, i) => {
      const idx = all.indexOf(feat);
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-pick-feat", String(idx));
      b.textContent = feat.label;
      if (i === 0 && q) b.classList.add("ig-agent__review-send");
      box.appendChild(b);
    });
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
  }

  function applyPickedFeature(idx) {
    const feat = draft?.features?.[Number(idx)];
    if (!feat) return;
    draft.keyword = feat.label;
    draft.place = feat.label;
    draft.lat = feat.lat;
    draft.lng = feat.lng;
    draft.featurePicked = true;
    addMsg("Registro escolhido: " + feat.label, "user");
    tryAdvance();
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

  function tryAdvance() {
    if (!draft) return;
    if (!String(draft.message || "").trim()) {
      addMsg(
        draft.kind === "reclamacao"
          ? "Descreva a sua reclamação para o mapa."
          : "Descreva a sua sugestão para o mapa.",
        "bot"
      );
      draft.stage = "ask";
      return;
    }
    if (!draft.layerName) {
      const guessed =
        matchLayerFromText(draft.message) ||
        matchLayerFromText([draft.message, draft.place, draft.keyword].filter(Boolean).join(" "));
      if (guessed) {
        applyLayer(guessed);
        tryAdvance();
        return;
      }
      askLayerInWords();
      return;
    }
    if (!draft.featurePicked) {
      draft.stage = "feature";
      showFeatureChoices(draft.featureQuery || "");
      return;
    }
    registrarSugestaoErro();
  }

  async function registrarSugestaoErro() {
    if (!draft) return;
    if (!draft.layerName || !String(draft.message || "").trim()) {
      tryAdvance();
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
    try {
      const res = await fetch(apiUrl("/api/feedback"), {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data.detail;
        throw new Error(typeof d === "string" ? d : "Não foi possível registrar.");
      }
      addMsg("Ocorrência registrada e encaminhada para a equipe de cartografia.", "bot");
    } catch (err) {
      addMsg(err.message || "Não consegui registrar agora.", "bot");
    }
    draft = null;
    stopPick();
  }

  function beginDraft(kind, text) {
    const clean = String(text || "")
      .replace(/^(sugestão|sugestao|reclamação|reclamacao)\s*:\s*/i, "")
      .trim();
    draft = {
      kind: kind || "sugestao",
      message: clean,
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
    };
    addMsg("Se puder, anexe uma foto para comprovar o que viu no terreno.", "bot");
    closeTour();
    tryAdvance();
  }

  async function handleUserText(text) {
    const clean = text.replace(/^(sugestão|sugestao|reclamação|reclamacao)\s*:\s*/i, "").trim();
    if (!draft) {
      const guide = detectGuide(text);
      if (guide && !classifyTicket(text)) {
        showGuide(guide);
        return;
      }
      beginDraft(classifyTicket(text) || "sugestao", clean);
      return;
    }
    if (draft.stage === "layer" && clean) {
      const t = normalize(clean);
      const vis = visibleMetas().filter((m) => !isContextLayer(m));
      if (/usar a do mapa|camada (ligada|do mapa)|essa do mapa|a ligada|a do mapa/.test(t)) {
        if (vis.length === 1) applyLayer(vis[0]);
        else if (vis.length > 1) {
          const guessed = matchLayerFromText(draft.message, vis) || matchLayerFromText(clean, vis);
          if (guessed) applyLayer(guessed);
          else {
            addMsg(
              "Há mais de uma camada ligada. Escreva qual, por exemplo: " +
                vis
                  .slice(0, 4)
                  .map(layerLabel)
                  .join(", ") +
                ".",
              "bot"
            );
            return;
          }
        } else {
          addMsg("Nenhuma camada de obra está ligada. Ligue no painel Camadas e escreva de novo: usar a do mapa.", "bot");
          pulse("#btn-nav-camadas");
          return;
        }
        tryAdvance();
        return;
      }
      const guessed = matchLayerFromText(clean) || matchLayerFromText((draft.message || "") + " " + clean);
      if (guessed) {
        applyLayer(guessed);
        tryAdvance();
        return;
      }
      addMsg("Não reconheci essa camada. Escreva algo como pontes BR-319, bueiros BR-319 ou usar a do mapa.", "bot");
      return;
    }
    if (draft.stage === "feature" && clean) {
      draft.featureQuery = clean;
      showFeatureChoices(clean);
      return;
    }
    if (draft.stage === "place" && clean) {
      draft.featureQuery = clean;
      draft.place = clean;
      showFeatureChoices(clean);
      return;
    }
    if (clean) {
      draft.message = (draft.message ? draft.message + " " : "") + clean;
    }
    tryAdvance();
  }

  function openPanel() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    if (!log.childElementCount) {
      const s = snapshot();
      addMsg(
        "Olá. Posso te guiar no mapa ou registrar um erro para a cartografia." +
          (s.total ? ` Há ${s.total} camadas no catálogo agora.` : " Use Como navegar abaixo."),
        "bot"
      );
    }
    input.focus();
  }

  function closePanel() {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
  }

  fab.addEventListener("click", () => {
    if (panel.hidden) openPanel();
    else closePanel();
  });
  document.getElementById("btn-nav-agente")?.addEventListener("click", () => {
    openPanel();
  });
  document.getElementById("btn-ig-agent-close")?.addEventListener("click", closePanel);

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
    beginDraft(ticket, "");
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
    const ticketBtn = ev.target.closest("[data-ticket]");
    if (ticketBtn) {
      beginDraft(ticketBtn.getAttribute("data-ticket") || "sugestao", "");
      input.focus();
      return;
    }
    const featBtn = ev.target.closest("[data-pick-feat]");
    if (featBtn && draft) {
      applyPickedFeature(featBtn.getAttribute("data-pick-feat"));
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
    if (panel.hidden) return;
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
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
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
    if (text) await handleUserText(text);
    else if (photoUrl && !draft) beginDraft("sugestao", "");
    if (photoUrl && draft) draft.photoUrl = photoUrl;
  });

})();
