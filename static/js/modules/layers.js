/**
 * Renderização e controle dos grupos de camadas + "No mapa agora".
 */
window.InfraGeoLayers = (function () {
  "use strict";

  const FAV_KEY = "infrageo_favorites";

  const state = {
    /** @type {Record<string, boolean>} */
    checked: {},
    groupsOpen: {},
    favoritesOnly: false,
  };

  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      return new Set(Array.isArray(raw) ? raw.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites(set) {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  }

  let favorites = loadFavorites();

  const SUB_PREFIX = "sub:";

  function subFavKey(layerId) {
    return SUB_PREFIX + String(layerId);
  }

  function isGroupFav(groupId) {
    return favorites.has(String(groupId));
  }

  function isSubFav(layerId) {
    return favorites.has(subFavKey(layerId));
  }

  function groupHasFav(group) {
    if (isGroupFav(group.id)) return true;
    return (group.layers || []).some((l) => isSubFav(l.id));
  }

  function starSvg(on) {
    return on
      ? `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3.4l2.47 5.01 5.53.8-4 3.9.94 5.49L12 16.5l-4.94 2.6.94-5.49-4-3.9 5.53-.8L12 3.4z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.2l2.1 4.25 4.7.68-3.4 3.32.8 4.65L12 15.9l-4.2 2.2.8-4.65-3.4-3.32 4.7-.68L12 4.2z"/></svg>`;
  }

  function makeFavButton(on, title, extraClass) {
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = `${extraClass || "layer-group__fav"}${on ? " is-on" : ""}`;
    favBtn.title = title;
    favBtn.setAttribute("aria-label", title);
    favBtn.setAttribute("aria-pressed", String(on));
    favBtn.innerHTML = starSvg(on);
    return favBtn;
  }

  function allLayerMetas() {
    const list = [];
    (window.InfraGeoConfig.groups || []).forEach((g) => {
      (g.layers || []).forEach((l) => list.push({ ...l, groupId: g.id, groupName: g.name }));
    });
    return list;
  }

  function findMeta(layerId) {
    return allLayerMetas().find((l) => l.id === layerId);
  }

  function isLimiteEstadual(meta) {
    if (!meta) return false;
    const schema = String(meta.schema || "").toUpperCase();
    const table = String(meta.table || meta.id || "").toUpperCase();
    return schema.startsWith("LIMITE_ESTADUAL") || table.includes("LIMITE_ESTADUAL");
  }

  function isLimiteMunicipal(meta) {
    if (!meta) return false;
    const schema = String(meta.schema || "").toUpperCase();
    const table = String(meta.table || meta.id || "").toUpperCase();
    return (
      schema.startsWith("LIMITE_MUNICIPAL") || table.includes("LIMITE_MUNICIPAL")
    );
  }

  function limiteEstadualMetas() {
    return allLayerMetas().filter(isLimiteEstadual);
  }

  function renderGroups() {
    const container = document.getElementById("layer-groups");
    if (!container) return;
    container.innerHTML = "";

    window.InfraGeoConfig.groups.forEach((group) => {
      if (state.favoritesOnly && !groupHasFav(group)) return;

      const layersAll = group.layers || [];
      const layers = state.favoritesOnly && !isGroupFav(group.id)
        ? layersAll.filter((l) => isSubFav(l.id))
        : layersAll;
      const onCount = layers.filter((l) => state.checked[l.id]).length;
      const isOpen = state.favoritesOnly ? true : !!state.groupsOpen[group.id];
      const wrap = document.createElement("div");
      wrap.className = `layer-group${isOpen ? " is-open" : ""}${onCount ? " has-on" : ""}`;
      wrap.dataset.groupId = group.id;

      const header = document.createElement("div");
      header.className = "layer-group__header";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "layer-group__toggle";
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.innerHTML = `
        <span class="layer-group__dot" style="background:${groupAccent(group)}" aria-hidden="true"></span>
        <span class="layer-group__copy">
          <span class="layer-group__name" title="${group.name}">${group.name}</span>
          <small class="layer-group__meta">${onCount ? `${onCount} no mapa · ` : ""}${layers.length} ${layers.length === 1 ? "opção" : "opções"}</small>
        </span>
        <span class="layer-group__chevron" aria-hidden="true"></span>
      `;
      toggle.addEventListener("click", () => {
        state.groupsOpen[group.id] = !state.groupsOpen[group.id];
        renderGroups();
      });

      const fav = isGroupFav(group.id);
      const favBtn = makeFavButton(
        fav,
        fav ? "Remover camada dos favoritos" : "Favoritar camada"
      );
      favBtn.className = `layer-group__fav${fav ? " is-on" : ""}`;
      favBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (isGroupFav(group.id)) favorites.delete(String(group.id));
        else favorites.add(String(group.id));
        saveFavorites(favorites);
        renderGroups();
      });

      const ligarGroupBtn = document.createElement("button");
      ligarGroupBtn.type = "button";
      ligarGroupBtn.className = "layer-group__ligar";
      ligarGroupBtn.title = `Ligar todas as opções de ${group.name}`;
      ligarGroupBtn.textContent = "Ligar";
      ligarGroupBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await setGroupVisible(group.id, true);
      });

      header.append(toggle, ligarGroupBtn, favBtn);

      const body = document.createElement("div");
      body.className = "layer-group__body";
      body.setAttribute("role", "group");

      layers.forEach((layer) => {
        const row = document.createElement("div");
        const isBr =
          window.InfraGeoBrShield && window.InfraGeoBrShield.isBrLayer({ ...layer, groupId: group.id });
        row.className = `layer-item${isBr ? " layer-item--br" : ""}`;
        const checked = !!state.checked[layer.id];

        let shield = "";
        if (isBr) {
          const num = window.InfraGeoBrShield.extractBrNumber(
            layer.schema || layer.name || ""
          );
          shield = window.InfraGeoBrShield.sidebarHtml(num);
        }

        row.innerHTML = `
          <span class="layer-item__mark">
            ${shield}
            <span class="layer-item__dot" style="background:${layerSwatch(layer)}" aria-hidden="true"></span>
          </span>
          <input type="checkbox" id="lyr-${layer.id}" ${checked ? "checked" : ""} />
          <label for="lyr-${layer.id}">
            <span>${layer.name}</span>
            ${checked ? '<em class="layer-item__on">No mapa</em>' : ""}
          </label>
          <button type="button" class="layer-item__ligar" data-ligar="${layer.id}" title="Ligar esta e as relacionadas">Ligar</button>
        `;
        row.querySelector("input").addEventListener("change", async (ev) => {
          const turnOn = !!ev.target.checked;
          await setLayerVisible(layer.id, turnOn, { fit: turnOn });
        });
        row.querySelector("[data-ligar]")?.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          await setRelatedVisible({ ...layer, groupId: group.id }, true);
        });
        const subOn = isSubFav(layer.id);
        const subFavBtn = makeFavButton(
          subOn,
          subOn ? "Remover subcamada dos favoritos" : "Favoritar subcamada",
          "layer-item__fav"
        );
        subFavBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const key = subFavKey(layer.id);
          if (favorites.has(key)) favorites.delete(key);
          else favorites.add(key);
          saveFavorites(favorites);
          renderGroups();
        });
        row.appendChild(subFavBtn);
        if (window.InfraGeoAttrTable) {
          window.InfraGeoAttrTable.attachKebab(row, { ...layer, groupId: group.id });
        }
        body.appendChild(row);
      });

      wrap.append(header, body);
      container.appendChild(wrap);
    });

    if (state.favoritesOnly && !container.children.length) {
      container.innerHTML = '<p class="empty-hint">Nada nos favoritos. Toque na estrela da camada ou da subcamada.</p>';
    }
  }

  function prettyLabel(meta) {
    if (!meta) return "Camada";
    return String(meta.name || meta.id || "Camada");
  }

  function layerSwatch(layer) {
    const s = layer?.style || {};
    const fill = String(s.fillColor || "").trim();
    const stroke = String(s.color || "").trim();
    if (fill && fill !== "transparent") return fill;
    if (stroke && stroke !== "transparent") return stroke;
    return "#94a3b8";
  }

  function groupAccent(group) {
    const groupId = typeof group === "string" ? group : group?.id;
    const layers = typeof group === "object" ? group.layers || [] : [];
    const on = layers.find((l) => state.checked[l.id]) || layers[0];
    if (on) return layerSwatch(on);
    const map = {
      oae: "#14b8a6",
      oae_oac: "#14b8a6",
      oac: "#0d9488",
      obras: "#f59e0b",
      usina: "#b45309",
      canteiro: "#d97706",
      prads: "#ea580c",
      pca_prads: "#c2410c",
      faixa_dominio: "#64748b",
      jazidas: "#a16207",
      br_am: "#0A2E2C",
      aquaviario: "#3b82f6",
      ucs: "#34d399",
      limites_am: "#38bdf8",
      outros: "#94a3b8",
    };
    return map[groupId] || "#38bdf8";
  }

  function renderActive() {
    const box = document.getElementById("active-layers");
    const badge = document.getElementById("active-count");
    if (!box || !badge) {
      window.InfraGeoChrome?.refresh?.();
      return;
    }

    const activeIds = Object.keys(state.checked).filter((id) => state.checked[id]);
    badge.textContent = String(activeIds.length);

    if (!activeIds.length) {
      box.innerHTML = '<p class="empty-hint">Nenhuma camada ativa</p>';
      window.InfraGeoChrome?.refresh?.();
      return;
    }

    // Agrupa por categoria
    const byGroup = {};
    activeIds.forEach((id) => {
      const meta = findMeta(id);
      if (!meta) return;
      const g = meta.groupName || "Outros";
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(meta);
    });

    box.innerHTML = "";
    Object.entries(byGroup).forEach(([groupName, layers]) => {
      const section = document.createElement("div");
      section.className = "active-group";

      const title = document.createElement("div");
      title.className = "active-group__title";
      title.textContent = groupName;
      section.appendChild(title);

      const list = document.createElement("div");
      list.className = "active-group__list";

      layers.forEach((meta) => {
        const chip = document.createElement("div");
        chip.className = "active-chip";
        const mapColor =
          (meta.style && (meta.style.fillColor || meta.style.color)) ||
          groupAccent(meta.groupId || "outros");
        chip.style.setProperty("--chip-accent", mapColor);

        const isBr =
          window.InfraGeoBrShield && window.InfraGeoBrShield.isBrLayer(meta);

        const iconWrap = document.createElement("span");
        iconWrap.className = "active-chip__icon";
        if (isBr) {
          const num = window.InfraGeoBrShield.extractBrNumber(
            meta.schema || meta.name || ""
          );
          iconWrap.innerHTML = window.InfraGeoBrShield.sidebarHtml(num);
        } else {
          iconWrap.innerHTML = '<span class="active-chip__dot" aria-hidden="true"></span>';
        }

        const label = document.createElement("span");
        label.className = "active-chip__label";
        label.textContent = prettyLabel(meta);
        label.title = prettyLabel(meta);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "active-chip__remove";
        remove.setAttribute("aria-label", `Remover ${prettyLabel(meta)}`);
        remove.textContent = "×";
        remove.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          await setLayerVisible(meta.id, false);
          renderGroups();
        });

        chip.append(iconWrap, label, remove);
        list.appendChild(chip);
      });

      section.appendChild(list);
      box.appendChild(section);
    });
    window.InfraGeoChrome?.refresh?.();
  }

  function fitToLayer(layerId) {
    const map = window.InfraGeoMap?.getMap?.();
    const entry = window.InfraGeoMap?.overlayRegistry?.[layerId];
    if (!map || !entry?.leaflet) return;

    let bounds = entry.leaflet.getBounds?.();
    if (!bounds?.isValid?.()) return;

    // Limite estadual → enquadra só o AM
    if (isLimiteEstadual(entry.meta)) {
      window.InfraGeoMap.fitAmazonas?.();
      return;
    }

    // Mantém o zoom da camada dentro do Amazonas (não abre o mapa do Brasil/mundo)
    const am = window.InfraGeoMap.getAmazonasBounds?.();
    if (am?.isValid?.() && bounds.intersects(am)) {
      try {
        bounds = bounds.pad(0.02);
        // Se a camada for quase do tamanho do estado, usa o AM
        const layerArea =
          (bounds.getNorth() - bounds.getSouth()) *
          (bounds.getEast() - bounds.getWest());
        const amArea =
          (am.getNorth() - am.getSouth()) * (am.getEast() - am.getWest());
        if (layerArea > amArea * 0.85) {
          bounds = am;
        }
      } catch {
        /* ignore */
      }
    }

    const maxZoom = 16;
    try {
      window.InfraGeoPrintMap?.restoreMainMapLayout?.();
    } catch {
      /* ignore */
    }
    map.fitBounds(bounds, {
      padding: [48, 48],
      maxZoom,
      animate: true,
    });
  }

  function brNumber(layer) {
    const src = `${layer?.schema || ""} ${layer?.table || ""} ${layer?.name || ""} ${layer?.id || ""}`;
    if (window.InfraGeoBrShield?.extractBrNumber) {
      const n = window.InfraGeoBrShield.extractBrNumber(src);
      if (n) return String(n);
    }
    const m = src.match(/BR[_\-\s]*(\d{2,4})/i);
    return m ? m[1] : "";
  }

  function relatedMetas(layer) {
    const br = brNumber(layer);
    if (br) return allLayerMetas().filter((l) => brNumber(l) === br);
    return allLayerMetas().filter((l) => l.id === layer.id || l.groupId === layer.groupId);
  }

  async function setRelatedVisible(layer, on) {
    const list = relatedMetas(layer);
    for (let i = 0; i < list.length; i++) {
      const meta = list[i];
      if (on && isLimiteMunicipal(meta)) continue;
      if (!on && isLimiteEstadual(meta)) continue;
      await setLayerVisible(meta.id, on, { fit: on && i === 0 });
    }
    renderGroups();
  }

  async function setGroupVisible(groupId, on) {
    const group = (window.InfraGeoConfig.groups || []).find((g) => g.id === groupId);
    const layers = group?.layers || [];
    state.groupsOpen[groupId] = true;
    for (let i = 0; i < layers.length; i++) {
      const meta = findMeta(layers[i].id) || { ...layers[i], groupId };
      if (on && isLimiteMunicipal(meta)) continue;
      if (!on && isLimiteEstadual(meta)) continue;
      await setLayerVisible(layers[i].id, on, { fit: on && i === 0 });
    }
    renderGroups();
  }

  async function setLayerVisible(layerId, on, opts) {
    const meta = findMeta(layerId);
    if (!meta) return;

    state.checked[layerId] = on;

    if (on) {
      await window.InfraGeoMap.loadGeoJSONLayer(meta);
    }
    window.InfraGeoMap.toggleLayer(layerId, on);

    // sincroniza checkbox se existir
    const input = document.getElementById(`lyr-${layerId}`);
    if (input) input.checked = on;

    renderActive();
    if (window.InfraGeoLegend) window.InfraGeoLegend.refresh();

    // Zoom só quando o usuário liga a camada (checkbox), não no carregamento padrão
    if (on && opts?.fit) {
      // espera o Leaflet calcular bounds após addTo(map)
      requestAnimationFrame(() => {
        fitToLayer(layerId);
      });
    }
  }

  async function applyDefaults() {
    for (const meta of allLayerMetas()) {
      // Limite municipal: só pelo checkbox da própria camada
      if (isLimiteMunicipal(meta)) {
        state.checked[meta.id] = false;
        continue;
      }
      // Limite estadual fica ligado por padrão (referência do mapa do AM)
      if (meta.defaultOn || isLimiteEstadual(meta)) {
        await setLayerVisible(meta.id, true);
      } else {
        state.checked[meta.id] = false;
      }
    }
    renderGroups();
    renderActive();
  }

  async function ensureLimiteEstadualOn() {
    for (const meta of limiteEstadualMetas()) {
      if (!state.checked[meta.id]) {
        await setLayerVisible(meta.id, true);
      }
    }
  }

  async function setAll(on) {
    for (const meta of allLayerMetas()) {
      // “Desligar todas” não remove o limite estadual — só o checkbox da própria camada
      if (!on && isLimiteEstadual(meta)) continue;
      // Limite municipal só liga pelo checkbox/opção própria
      if (on && isLimiteMunicipal(meta)) continue;
      await setLayerVisible(meta.id, on);
    }
    if (on) await ensureLimiteEstadualOn();
    renderGroups();
  }

  async function clearAll() {
    await setAll(false);
    await ensureLimiteEstadualOn();
    renderGroups();
    renderActive();
  }

  function filterGroups(groupId) {
    document.querySelectorAll(".layer-group").forEach((el) => {
      if (!groupId || el.dataset.groupId === groupId) {
        el.style.display = "";
      } else {
        el.style.display = "none";
      }
    });
  }

  function showFavorites(on) {
    state.favoritesOnly = !!on;
    renderGroups();
  }

  function getState() {
    return state;
  }

  return {
    renderGroups,
    renderActive,
    setLayerVisible,
    fitToLayer,
    applyDefaults,
    ensureLimiteEstadualOn,
    setAll,
    clearAll,
    filterGroups,
    showFavorites,
    getState,
    allLayerMetas,
    isLimiteEstadual,
    isLimiteMunicipal,
  };
})();
