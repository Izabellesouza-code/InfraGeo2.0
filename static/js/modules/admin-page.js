(function () {
  "use strict";

  const TOKEN_KEY = "infrageo_token";
  const USER_KEY = "infrageo_user";

  function apiUrl(path) {
    return window.InfraGeoApi?.url?.(path) || path;
  }

  function authHeaders(json) {
    const h = json ? { "Content-Type": "application/json" } : {};
    const t = localStorage.getItem(TOKEN_KEY) || "";
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  function formatApiError(data, status) {
    const d = data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length) {
      return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
    }
    if (d && typeof d === "object" && d.message) return d.message;
    return data?.message || `HTTP ${status}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const titles = {
    overview: ["Visão geral", "Gerencie os dados e a publicação do WebGIS InfraGeo AM."],
    layers: ["Camadas", "Gerencie os dados e a publicação do WebGIS InfraGeo AM."],
    imports: ["Importações", "Envie shapefiles e renomeie subcamadas do catálogo."],
    users: ["Usuários", "Cadastre contas e veja o perfil de quem acessa o WebGIS."],
    feedback: ["Sugestões e reclamações", "Filtre a fila, abra o ponto no mapa e mude o status. A planilha atualiza junto."],
    settings: ["Configurações", "Atalhos do console administrativo."],
  };

  function moveNavSlider() {
    const menu = document.querySelector(".admin-nav__menu");
    const slider = menu?.querySelector(".admin-nav__slider");
    const active = menu?.querySelector("button.is-active");
    if (!menu || !slider || !active) return;
    slider.style.top = `${active.offsetTop}px`;
    slider.style.height = `${active.offsetHeight}px`;
  }

  function setView(name) {
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-view") === name && btn.closest(".admin-nav__menu"));
    });
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.getAttribute("data-view-panel") === name);
    });
    const t = titles[name] || titles.overview;
    const title = document.getElementById("admin-title");
    const sub = document.getElementById("admin-sub");
    if (title) title.textContent = t[0];
    if (sub) sub.textContent = t[1];
    document.body.classList.toggle("is-admin-feedback", name === "feedback");
    document.body.classList.toggle("is-admin-users", name === "users");
    showError("");
    moveNavSlider();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      setView(btn.getAttribute("data-view"));
    });
    btn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        setView(btn.getAttribute("data-view"));
      }
    });
  });

  const errEl = document.getElementById("admin-erro");
  function showError(msg) {
    if (!errEl) return;
    errEl.textContent = msg || "";
    errEl.hidden = !msg;
  }

  function geomLabel(type) {
    const t = String(type || "").toLowerCase();
    if (t.includes("polygon")) return "Polígono";
    if (t.includes("line")) return "Linha";
    if (t.includes("point")) return "Ponto";
    return type || "Geometria";
  }

  const SWATCHES = ["#f59e0b", "#0A2E2C", "#ef4444", "#14b8a6", "#3b82f6", "#8b5cf6"];

  function layerRow(layer, index, when) {
    const name = layer.name || layer.title || layer.table || "Camada";
    const type = geomLabel(layer.type || layer.geom_type || layer.geometry_type);
    const color = SWATCHES[index % SWATCHES.length];
    const published = true;
    const status = published
      ? '<span class="admin-pill">Publicado</span>'
      : '<span class="admin-pill admin-pill--draft">Rascunho</span>';
    const href = layer.id ? `/?layer=${encodeURIComponent(layer.id)}` : "/";
    const schema = layer.schema || "";
    const table = layer.table || "";
    const groupId = layer.groupId || layer.group_id || "";
    return `<tr>
      <td><span class="admin-layer"><span class="admin-swatch" style="background:${color}"></span>${escapeHtml(name)}</span></td>
      <td>${escapeHtml(type)}</td>
      <td>${escapeHtml(when || "Hoje")}</td>
      <td>${status}</td>
      <td>
        <span class="admin-actions">
          <button type="button" class="admin-eye" data-rename-layer="1" data-schema="${escapeHtml(schema)}" data-table="${escapeHtml(table)}" data-name="${escapeHtml(name)}" data-group="${escapeHtml(groupId)}" title="Renomear subcamada" aria-label="Renomear subcamada">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 17.5V20h2.5L17 9.5 14.5 7 4 17.5z"/><path d="M13.2 8.3l2.5 2.5"/></svg>
          </button>
          <a class="admin-eye" href="${href}" title="Ver no mapa" aria-label="Ver no mapa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
          </a>
        </span>
      </td>
    </tr>`;
  }

  let catalogLayers = [];
  let catalogGroups = [];
  let adminUsers = [];

  function fillSelect(sel, items, placeholder) {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    sel.appendChild(ph);
    items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      sel.appendChild(opt);
    });
    if (current && [...sel.options].some((o) => o.value === current)) {
      sel.value = current;
    }
    window.InfraGeoSelectCombo?.enhance?.(sel);
  }

  function layerKey(layer) {
    return `${layer.schema || ""}::${layer.table || ""}`;
  }

  function fillImportSelects() {
    const layerItems = catalogLayers
      .filter((l) => l.schema && l.table)
      .map((l) => ({
        value: layerKey(l),
        label: `${l.name || l.table} (${l.schema}.${l.table})`,
      }));
    const groupItems = catalogGroups.map((g) => ({
      value: g.id,
      label: g.name || g.id,
    }));
    fillSelect(document.getElementById("admin-upload-layer"), layerItems, "Selecione a subcamada…");
    fillSelect(document.getElementById("admin-rename-layer"), layerItems, "Selecione a subcamada…");
    fillSelect(document.getElementById("admin-upload-group"), groupItems, "Selecione a camada…");
    fillSelect(document.getElementById("admin-rename-group"), groupItems, "Selecione a camada…");
  }

  function syncUploadDest() {
    const dest = document.querySelector('input[name="admin_upload_dest"]:checked')?.value || "existing";
    const existing = document.getElementById("admin-upload-existing-wrap");
    const neu = document.getElementById("admin-upload-new-wrap");
    if (existing) existing.hidden = dest !== "existing";
    if (neu) neu.hidden = dest !== "new";
  }

  function goRename(layer) {
    setView("imports");
    fillImportSelects();
    const sel = document.getElementById("admin-rename-layer");
    const name = document.getElementById("admin-rename-name");
    const group = document.getElementById("admin-rename-group");
    if (sel && layer?.schema && layer?.table) sel.value = layerKey(layer);
    if (name) name.value = layer?.name || "";
    if (group) group.value = layer?.groupId || layer?.group_id || "";
    document.getElementById("form-admin-rename")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  let feedbackItems = [];

  function formatWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function renderFeedback(payload) {
    feedbackItems = Array.isArray(payload?.items) ? payload.items : [];
    const novas = Number(payload?.novas || feedbackItems.filter((i) => i.status === "nova").length);
    const badge = document.getElementById("badge-feedback");
    if (badge) {
      badge.hidden = novas <= 0;
      badge.textContent = String(novas);
    }
    paintFeedback();
  }

  function paintFeedback() {
    const box = document.getElementById("admin-feedback-list");
    if (!box) return;
    const nTodas = feedbackItems.length;
    const nNova = feedbackItems.filter((i) => (i.status || "nova") === "nova").length;
    const nAna = feedbackItems.filter((i) => i.status === "em_analise").length;
    const nOk = feedbackItems.filter((i) => i.status === "resolvida").length;
    const counts = { todas: nTodas, nova: nNova, em_analise: nAna, resolvida: nOk };
    document.querySelectorAll("[data-fb-count]").forEach((el) => {
      el.textContent = String(counts[el.getAttribute("data-fb-count")] || 0);
    });
    const filter = document.querySelector('input[name="feedback_filter"]:checked')?.value || "todas";
    const q = String(document.getElementById("admin-search")?.value || "").toLowerCase().trim();
    const rows = feedbackItems.filter((item) => {
      if (filter !== "todas" && item.status !== filter) return false;
      if (!q) return true;
      const blob = `${item.author || ""} ${item.message || ""} ${item.kind || ""} ${item.layer || ""}`.toLowerCase();
      return blob.includes(q);
    });
    if (!rows.length) {
      box.innerHTML =
        '<p class="admin-empty">Nada neste filtro. Troque para Todas ou limpe a busca.</p>';
      return;
    }
    box.innerHTML = rows
      .map((item) => {
        const kindLabel = item.kind === "reclamacao" ? "Reclamação" : "Sugestão";
        const st = item.status || "nova";
        const stLabel = st === "resolvida" ? "Resolvida" : st === "em_analise" ? "Em análise" : "Nova";
        const done = st === "resolvida";
        const mapQs = [];
        if (item.layer_id) mapQs.push(`layer=${encodeURIComponent(item.layer_id)}`);
        const key = item.keyword || item.place || "";
        if (key) mapQs.push(`q=${encodeURIComponent(key)}`);
        const mapHref = mapQs.length ? `/?${mapQs.join("&")}` : "";
        const geoBits = [];
        if (item.layer) geoBits.push(escapeHtml(item.layer));
        if (item.lat != null) geoBits.push(`${item.lat}, ${item.lng}`);
        return `<article class="admin-ticket${done ? " admin-ticket--done" : ""}" data-id="${escapeHtml(item.id)}">
          <div class="admin-ticket__meta">
            <span class="admin-pill">${kindLabel}</span>
            <span class="admin-st admin-st--${escapeHtml(st)}">${stLabel}</span>
            <strong>${escapeHtml(item.author || "Usuário")}</strong>
            <small>${escapeHtml(formatWhen(item.created_at))}</small>
          </div>
          <p class="admin-ticket__msg">${escapeHtml(item.message)}</p>
          <div class="admin-ticket__row">
            <p class="admin-ticket__geo">${
              geoBits.length ? geoBits.join(" · ") : "Sem ponto no mapa"
            }${
              item.keyword ? ` · “${escapeHtml(item.keyword)}”` : ""
            }${
              mapHref
                ? ` <a class="admin-ticket__map" href="${mapHref}" target="_blank" rel="noopener">Abrir no mapa</a>`
                : ""
            }${
              item.photo_url
                ? ` <a class="admin-ticket__map" href="${escapeHtml(item.photo_url)}" target="_blank" rel="noopener">Foto</a>`
                : ""
            }</p>
            <select data-feedback-status="${escapeHtml(item.id)}" data-native-select="1" aria-label="Status do envio">
              <option value="nova"${st === "nova" ? " selected" : ""}>Nova</option>
              <option value="em_analise"${st === "em_analise" ? " selected" : ""}>Em análise</option>
              <option value="resolvida"${st === "resolvida" ? " selected" : ""}>Resolvida</option>
            </select>
            ${done ? "" : `<button type="button" class="admin-btn" data-resolve="${escapeHtml(item.id)}">Resolver</button>`}
          </div>
        </article>`;
      })
      .join("");
    box.querySelectorAll("select").forEach((sel) => {
      sel.dataset.nativeSelect = "1";
    });
  }

  function userInitials(user) {
    const name = String(user?.full_name || user?.nome || user?.username || "").trim();
    if (!name) return "AM";
    const parts = name.split(/\s+/).filter(Boolean);
    const a = (parts[0] || "").charAt(0);
    const b = (parts.length > 1 ? parts[parts.length - 1] : parts[0].charAt(1) || "").charAt(0);
    return `${a}${b}`.toLocaleUpperCase("pt-BR");
  }

  function fillNavUser(user) {
    if (!user) return;
    const name = String(user.full_name || user.nome || user.username || "").trim() || "Administrador";
    const nameEl = document.getElementById("nav-user-name");
    const roleEl = document.getElementById("nav-user-role");
    const avEl = document.getElementById("nav-user-avatar");
    if (nameEl) nameEl.textContent = name;
    if (roleEl) {
      roleEl.textContent = user.is_admin
        ? "Administrador · acesso total ao painel"
        : "Sessão autenticada neste painel";
    }
    if (avEl) avEl.textContent = userInitials(user);
  }

  try {
    fillNavUser(JSON.parse(localStorage.getItem(USER_KEY) || "null"));
  } catch {
    /* ignore */
  }

  async function loadAll() {
    showError("");
    const [catalogRes, layersRes, usersRes, healthRes, pgHealthRes, infoRes, feedbackRes, meRes] = await Promise.all([
      fetch(apiUrl("/api/postgis/catalog"), { credentials: "same-origin", headers: authHeaders() }),
      fetch(apiUrl("/api/postgis/layers"), { credentials: "same-origin", headers: authHeaders() }),
      fetch(apiUrl("/api/auth/users"), { credentials: "same-origin", headers: authHeaders() }),
      fetch(apiUrl("/api/health"), { credentials: "same-origin", headers: authHeaders() }),
      fetch(apiUrl("/api/postgis/health"), { credentials: "same-origin", headers: authHeaders() }),
      fetch(apiUrl("/api/info"), { credentials: "same-origin", headers: authHeaders() }),
      fetch(apiUrl("/api/feedback"), { credentials: "same-origin", headers: authHeaders() }),
      fetch(apiUrl("/api/auth/me"), { credentials: "same-origin", headers: authHeaders() }),
    ]);

    if (usersRes.status === 401 || usersRes.status === 403) {
      window.location.href = "/login?next=/admin";
      return;
    }

    const catalog = await catalogRes.json().catch(() => ({}));
    const layersPayload = await layersRes.json().catch(() => ({}));
    const users = await usersRes.json().catch(() => []);
    const health = await healthRes.json().catch(() => ({}));
    const pgHealth = await pgHealthRes.json().catch(() => ({}));
    const info = await infoRes.json().catch(() => ({}));
    const feedbackPayload = await feedbackRes.json().catch(() => ({ items: [] }));
    const me = meRes.ok ? await meRes.json().catch(() => null) : null;
    if (me) {
      localStorage.setItem(USER_KEY, JSON.stringify(me));
      fillNavUser(me);
    }
    renderFeedback(feedbackPayload);

    const groups = catalog.groups || [];
    catalogGroups = groups;
    catalogLayers = [];
    groups.forEach((g) => {
      (g.layers || []).forEach((layer) => {
        catalogLayers.push({ ...layer, groupId: layer.groupId || layer.group_id || g.id });
      });
    });
    fillImportSelects();
    const rawCount = Number(layersPayload.count || catalogLayers.length || 0);
    const userList = Array.isArray(users) ? users : [];
    adminUsers = userList;

    document.getElementById("kpi-layers").textContent = String(rawCount);
    document.getElementById("kpi-layers-sub").textContent = `${groups.length} grupos no mapa`;
    document.getElementById("kpi-users").textContent = String(userList.length);
    document.getElementById("kpi-users-sub").textContent = `${userList.filter((u) => u.is_admin).length} administrador(es)`;
    document.getElementById("kpi-records").textContent = rawCount ? `${rawCount}` : "—";
    document.getElementById("kpi-records-sub").textContent =
      info.last_data_update_label || info.last_update || "Última atualização no banco";

    const apiOk = health.status === "ok" || health.status === "healthy";
    const pgOk = !!(pgHealth.ok || pgHealth.status === "ok" || pgHealth.connected);
    const healthPct = apiOk && pgOk ? "99,8%" : apiOk || pgOk ? "70%" : "0%";
    document.getElementById("kpi-health").textContent = healthPct;
    document.getElementById("kpi-health-sub").textContent =
      apiOk && pgOk ? "Todos os serviços ativos" : "Verifique a conexão";

    const statusEl = document.getElementById("admin-status");
    if (statusEl) {
      statusEl.innerHTML = `
        <li><span class="admin-dot ${apiOk ? "admin-dot--ok" : "admin-dot--warn"}"></span>
          <span>API de mapas<small>${apiOk ? "Operacional" : "Indisponível"}</small></span>
          <b class="${apiOk ? "" : "is-warn"}">${apiOk ? "99,99%" : "Falhou"}</b></li>
        <li><span class="admin-dot ${pgOk ? "admin-dot--ok" : "admin-dot--warn"}"></span>
          <span>Processamento GIS<small>${pgOk ? "Operacional" : "Indisponível"}</small></span>
          <b class="${pgOk ? "" : "is-warn"}">${pgOk ? "99,80%" : "Falhou"}</b></li>
        <li><span class="admin-dot admin-dot--ok"></span>
          <span>Fila de importações<small>Sem pendências</small></span>
          <b>Em dia</b></li>`;
    }

    const recent = catalogLayers.slice(0, 6);
    const ov = document.getElementById("overview-layers");
    if (ov) {
      ov.innerHTML = recent.length
        ? recent.map((layer, i) => layerRow(layer, i, "Hoje")).join("")
        : '<tr><td colspan="5">Nenhuma camada no catálogo.</td></tr>';
    }
    const all = document.getElementById("all-layers");
    if (all) {
      all.innerHTML = catalogLayers.length
        ? catalogLayers.map((layer, i) => layerRow(layer, i, "Hoje")).join("")
        : '<tr><td colspan="5">Nenhuma camada no catálogo.</td></tr>';
    }

    const tbody = document.getElementById("admin-users-body");
    if (tbody) {
      tbody.innerHTML = userList.length
        ? userList
            .map((u) => {
              const nome = u.full_name || u.username || "Usuário";
              const inicial = String(nome).trim().charAt(0).toUpperCase() || "U";
              const perfil = u.is_admin
                ? "Administrador"
                : u.can_upload
                  ? "Editor GIS"
                  : "Visualizador";
              const ativo = u.is_active !== false;
              return `<tr>
                <td>
                  <span class="admin-person">
                    <span class="admin-avatar">${escapeHtml(inicial)}</span>
                    <span>
                      <strong>${escapeHtml(nome)}</strong>
                      <small>${escapeHtml(u.email || "")}</small>
                    </span>
                  </span>
                </td>
                <td>${escapeHtml(perfil)}</td>
                <td>${ativo ? '<span class="admin-pill">Ativo</span>' : '<span class="admin-pill admin-pill--draft">Pendente</span>'}</td>
                <td>${u.is_admin ? "Total" : u.can_upload ? "Edição GIS" : "Somente leitura"}</td>
                <td>
                  <button type="button" class="admin-dots-btn" data-user-menu="${u.id}" aria-label="Ações de ${escapeHtml(nome)}" aria-haspopup="menu">⋯</button>
                </td>
              </tr>`;
            })
            .join("")
        : '<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>';
    }
  }

  document.getElementById("form-admin-user")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const okEl = document.getElementById("admin-ok");
    const formErr = document.getElementById("admin-form-erro");
    const btn = document.getElementById("btn-admin-cadastrar");
    if (okEl) okEl.hidden = true;
    if (formErr) {
      formErr.hidden = true;
      formErr.textContent = "";
    }
    showError("");
    const payload = {
      nome: document.getElementById("admin-nome")?.value?.trim(),
      email: document.getElementById("admin-email")?.value?.trim(),
      password: document.getElementById("admin-senha")?.value || "",
      is_admin: !!document.getElementById("admin-is-admin")?.checked,
      can_upload: !!document.getElementById("admin-can-upload")?.checked,
    };
    if (!payload.nome || !payload.email || payload.password.length < 6) {
      const msg = "Informe nome, e-mail e senha com pelo menos 6 caracteres.";
      if (formErr) {
        formErr.textContent = msg;
        formErr.hidden = false;
      }
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(apiUrl("/api/auth/users"), {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(data, res.status));
      ev.target.reset();
      const upload = document.getElementById("admin-can-upload");
      if (upload) upload.checked = true;
      if (okEl) {
        okEl.textContent = "Usuário gravado na tabela usuarios do Neon.";
        okEl.hidden = false;
      }
      try {
        await loadAll();
      } catch {
        /* cadastro já foi salvo */
      }
    } catch (err) {
      const msg = err.message || "Não foi possível cadastrar";
      if (formErr) {
        formErr.textContent = msg;
        formErr.hidden = false;
      } else {
        showError(msg);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("btn-convidar")?.addEventListener("click", () => {
    const modal = document.getElementById("modal-convidar");
    if (modal) modal.hidden = false;
  });
  document.getElementById("btn-fechar-convidar")?.addEventListener("click", () => {
    const modal = document.getElementById("modal-convidar");
    if (modal) modal.hidden = true;
  });
  document.getElementById("modal-convidar")?.addEventListener("click", (ev) => {
    if (ev.target.id === "modal-convidar") ev.currentTarget.hidden = true;
  });

  const userMenu = document.getElementById("user-row-menu");
  const editModal = document.getElementById("modal-editar-usuario");
  let userMenuId = null;

  function closeUserMenu() {
    if (userMenu) userMenu.hidden = true;
    userMenuId = null;
    document.querySelectorAll(".admin-dots-btn.is-open").forEach((el) => el.classList.remove("is-open"));
  }

  function userAcessoValue(user) {
    if (user?.is_admin) return "admin";
    if (user?.can_upload) return "editor";
    return "view";
  }

  function openEditUser(user, mode) {
    if (!editModal || !user) return;
    closeUserMenu();
    document.getElementById("edit-user-id").value = String(user.id);
    document.getElementById("edit-nome").value = user.full_name || user.username || "";
    document.getElementById("edit-email").value = user.email || "";
    document.getElementById("edit-acesso").value = userAcessoValue(user);
    document.getElementById("edit-ativo").checked = user.is_active !== false;
    document.getElementById("edit-senha").value = "";
    const title = document.getElementById("edit-user-title");
    const dados = document.getElementById("edit-block-dados");
    const acesso = document.getElementById("edit-block-acesso");
    const senha = document.getElementById("edit-block-senha");
    const nomeInput = document.getElementById("edit-nome");
    const emailInput = document.getElementById("edit-email");
    const senhaInput = document.getElementById("edit-senha");
    const senhaHint = document.getElementById("edit-senha-hint");
    if (mode === "edit") {
      if (title) title.textContent = "Editar nome e e-mail";
      if (dados) dados.hidden = false;
      if (acesso) acesso.hidden = true;
      if (senha) senha.hidden = true;
    } else if (mode === "access") {
      if (title) title.textContent = "Acesso e permissões";
      if (dados) dados.hidden = true;
      if (acesso) acesso.hidden = false;
      if (senha) senha.hidden = true;
    } else if (mode === "password") {
      if (title) title.textContent = "Redefinir senha";
      if (dados) dados.hidden = true;
      if (acesso) acesso.hidden = true;
      if (senha) senha.hidden = false;
      if (senhaHint) senhaHint.textContent = "Informe a nova senha (mínimo 6 caracteres).";
    } else {
      if (title) title.textContent = "Editar usuário";
      if (dados) dados.hidden = false;
      if (acesso) acesso.hidden = false;
      if (senha) senha.hidden = false;
      if (senhaHint) senhaHint.textContent = "Deixe em branco para manter a senha atual.";
    }
    if (nomeInput) nomeInput.required = !dados?.hidden;
    if (emailInput) emailInput.required = !dados?.hidden;
    if (senhaInput) senhaInput.required = mode === "password";
    if (mode !== "password" && senhaHint) {
      senhaHint.textContent = "Deixe em branco para manter a senha atual.";
    }
    const err = document.getElementById("edit-form-erro");
    const ok = document.getElementById("edit-form-ok");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (ok) ok.hidden = true;
    editModal.hidden = false;
    window.InfraGeoSelectCombo?.enhance?.(document.getElementById("edit-acesso"));
  }

  document.getElementById("admin-users-body")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-user-menu]");
    if (!btn || !userMenu) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = Number(btn.getAttribute("data-user-menu"));
    if (userMenuId === id && !userMenu.hidden) {
      closeUserMenu();
      return;
    }
    closeUserMenu();
    userMenuId = id;
    btn.classList.add("is-open");
    userMenu.hidden = false;
    const rect = btn.getBoundingClientRect();
    const top = Math.min(rect.bottom + 6, window.innerHeight - 160);
    let left = rect.right - 230;
    if (left < 12) left = 12;
    userMenu.style.top = `${top}px`;
    userMenu.style.left = `${left}px`;
  });

  userMenu?.addEventListener("click", (ev) => {
    const action = ev.target.closest("[data-user-action]")?.getAttribute("data-user-action");
    if (!action || userMenuId == null) return;
    const user = adminUsers.find((u) => Number(u.id) === Number(userMenuId));
    openEditUser(user, action);
  });

  document.addEventListener("click", (ev) => {
    if (!userMenu || userMenu.hidden) return;
    if (ev.target.closest("#user-row-menu") || ev.target.closest("[data-user-menu]")) return;
    closeUserMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeUserMenu();
  });

  function closeEditModal() {
    if (editModal) editModal.hidden = true;
  }
  document.getElementById("btn-fechar-editar")?.addEventListener("click", closeEditModal);
  editModal?.addEventListener("click", (ev) => {
    if (ev.target.id === "modal-editar-usuario") closeEditModal();
  });

  document.getElementById("form-admin-edit")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = document.getElementById("edit-user-id")?.value;
    const err = document.getElementById("edit-form-erro");
    const ok = document.getElementById("edit-form-ok");
    const btn = document.getElementById("btn-admin-salvar");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (ok) ok.hidden = true;
    const dadosHidden = !!document.getElementById("edit-block-dados")?.hidden;
    const acessoHidden = !!document.getElementById("edit-block-acesso")?.hidden;
    const senhaHidden = !!document.getElementById("edit-block-senha")?.hidden;
    const payload = {};
    if (!dadosHidden) {
      payload.nome = document.getElementById("edit-nome")?.value?.trim();
      payload.email = document.getElementById("edit-email")?.value?.trim();
      if (!payload.nome || !payload.email) {
        if (err) {
          err.textContent = "Informe nome e e-mail.";
          err.hidden = false;
        }
        return;
      }
    }
    if (!acessoHidden) {
      const acesso = document.getElementById("edit-acesso")?.value || "view";
      payload.is_admin = acesso === "admin";
      payload.can_upload = acesso === "admin" || acesso === "editor";
      payload.is_active = !!document.getElementById("edit-ativo")?.checked;
    }
    if (!senhaHidden) {
      const senha = document.getElementById("edit-senha")?.value || "";
      const required = !!document.getElementById("edit-senha")?.required;
      if (required && senha.length < 6) {
        if (err) {
          err.textContent = "Informe a nova senha com pelo menos 6 caracteres.";
          err.hidden = false;
        }
        return;
      }
      if (senha) payload.password = senha;
    }
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(apiUrl(`/api/auth/users/${id}`), {
        method: "PATCH",
        credentials: "same-origin",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(data, res.status));
      if (ok) {
        ok.textContent = "Alterações gravadas na tabela usuarios.";
        ok.hidden = false;
      }
      try {
        await loadAll();
      } catch {
        /* já salvo */
      }
      setTimeout(closeEditModal, 700);
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Não foi possível salvar";
        err.hidden = false;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("btn-admin-sair")?.addEventListener("click", async () => {
    try {
      await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "same-origin" });
    } catch {
      /* ignore */
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = "/login";
  });

  document.getElementById("admin-search")?.addEventListener("input", (ev) => {
    const q = String(ev.target.value || "").toLowerCase();
    document.querySelectorAll(".admin-table tbody tr").forEach((tr) => {
      tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
    });
    if (document.body.classList.contains("is-admin-feedback")) paintFeedback();
  });

  document.querySelectorAll('input[name="admin_upload_dest"]').forEach((el) => {
    el.addEventListener("change", syncUploadDest);
  });
  syncUploadDest();

  document.getElementById("admin-rename-layer")?.addEventListener("change", () => {
    const key = document.getElementById("admin-rename-layer")?.value || "";
    const layer = catalogLayers.find((l) => layerKey(l) === key);
    if (!layer) return;
    const name = document.getElementById("admin-rename-name");
    const group = document.getElementById("admin-rename-group");
    if (name) name.value = layer.name || "";
    if (group) group.value = layer.groupId || "";
  });

  document.body.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-rename-layer]");
    if (!btn) return;
    ev.preventDefault();
    goRename({
      schema: btn.getAttribute("data-schema"),
      table: btn.getAttribute("data-table"),
      name: btn.getAttribute("data-name"),
      groupId: btn.getAttribute("data-group"),
    });
  });

  document.getElementById("form-admin-rename")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = document.getElementById("admin-rename-erro");
    const ok = document.getElementById("admin-rename-ok");
    const btn = document.getElementById("btn-admin-rename");
    if (err) { err.hidden = true; err.textContent = ""; }
    if (ok) ok.hidden = true;
    const key = document.getElementById("admin-rename-layer")?.value || "";
    const [schema, table] = key.split("::");
    const displayName = (document.getElementById("admin-rename-name")?.value || "").trim();
    const groupId = document.getElementById("admin-rename-group")?.value || "";
    if (!schema || !table || !displayName) {
      if (err) { err.textContent = "Selecione a subcamada e informe o nome."; err.hidden = false; }
      return;
    }
    const body = new FormData();
    body.append("layer_schema", schema);
    body.append("layer_table", table);
    body.append("display_name", displayName);
    if (groupId) body.append("group_id", groupId);
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(apiUrl("/api/postgis/layers/meta"), {
        method: "PATCH",
        credentials: "same-origin",
        headers: authHeaders(),
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(data, res.status));
      if (ok) {
        ok.textContent = `Subcamada atualizada: ${data.name || displayName}`;
        ok.hidden = false;
      }
      await loadAll();
    } catch (e) {
      if (err) { err.textContent = e.message || "Não foi possível renomear"; err.hidden = false; }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("admin-upload-files")?.addEventListener("change", () => {
    const input = document.getElementById("admin-upload-files");
    const label = document.getElementById("admin-upload-files-label");
    if (!input || !label) return;
    const names = [...(input.files || [])].map((f) => f.name);
    label.textContent = names.length ? names.join(", ") : "Nenhum arquivo escolhido";
  });

  document.getElementById("form-admin-upload")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = document.getElementById("admin-upload-erro");
    const ok = document.getElementById("admin-upload-ok");
    const btn = document.getElementById("btn-admin-upload");
    if (err) { err.hidden = true; err.textContent = ""; }
    if (ok) ok.hidden = true;
    const files = document.getElementById("admin-upload-files")?.files;
    if (!files?.length) {
      if (err) { err.textContent = "Selecione um arquivo."; err.hidden = false; }
      return;
    }
    const dest = document.querySelector('input[name="admin_upload_dest"]:checked')?.value || "existing";
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f, f.name));
    form.append("destination", dest);
    if (dest === "existing") {
      const key = document.getElementById("admin-upload-layer")?.value || "";
      const [schema, table] = key.split("::");
      if (!schema || !table) {
        if (err) { err.textContent = "Selecione a subcamada a atualizar."; err.hidden = false; }
        return;
      }
      form.append("target_schema", schema);
      form.append("target_table", table);
    } else {
      const groupId = document.getElementById("admin-upload-group")?.value || "";
      const displayName = (document.getElementById("admin-upload-display")?.value || "").trim();
      const tech = (document.getElementById("admin-upload-tech")?.value || "").trim();
      if (!groupId) {
        if (err) { err.textContent = "Selecione a camada (grupo)."; err.hidden = false; }
        return;
      }
      if (!displayName) {
        if (err) { err.textContent = "Informe o nome da subcamada."; err.hidden = false; }
        return;
      }
      form.append("group_id", groupId);
      form.append("display_name", displayName);
      if (tech) form.append("name", tech);
    }
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(apiUrl("/api/postgis/upload"), {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(data, res.status));
      if (ok) {
        ok.textContent = `Camada gravada: ${data.schema}.${data.table} (${data.feature_count || 0} feições)`;
        ok.hidden = false;
      }
      ev.target.reset();
      const fileLabel = document.getElementById("admin-upload-files-label");
      if (fileLabel) fileLabel.textContent = "Nenhum arquivo escolhido";
      syncUploadDest();
      await loadAll();
    } catch (e) {
      if (err) { err.textContent = e.message || "Falha no upload"; err.hidden = false; }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.querySelectorAll('input[name="feedback_filter"]').forEach((el) => {
    el.addEventListener("change", paintFeedback);
  });

  async function setFeedbackStatus(id, status) {
    const res = await fetch(apiUrl(`/api/feedback/${id}`), {
      method: "PATCH",
      credentials: "same-origin",
      headers: authHeaders(true),
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(formatApiError(data, res.status));
    const found = feedbackItems.find((i) => i.id === id);
    if (found) found.status = status;
    renderFeedback({ items: feedbackItems, novas: feedbackItems.filter((i) => i.status === "nova").length });
  }

  document.getElementById("admin-feedback-list")?.addEventListener("change", async (ev) => {
    const sel = ev.target.closest("[data-feedback-status]");
    if (!sel) return;
    try {
      await setFeedbackStatus(sel.getAttribute("data-feedback-status"), sel.value);
    } catch (err) {
      showError(err.message || "Não foi possível atualizar o status");
    }
  });

  document.getElementById("admin-feedback-list")?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-resolve]");
    if (!btn) return;
    try {
      await setFeedbackStatus(btn.getAttribute("data-resolve"), "resolvida");
    } catch (err) {
      showError(err.message || "Não foi possível resolver o registro");
    }
  });

  loadAll().catch((err) => showError(err.message || "Falha ao carregar o painel"));
  window.requestAnimationFrame(moveNavSlider);
  window.addEventListener("resize", moveNavSlider);
})();
