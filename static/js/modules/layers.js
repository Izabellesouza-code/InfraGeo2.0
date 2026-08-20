/**
 * Renderização e controle dos grupos de camadas + "No mapa agora".
 */
window.InfraGeoLayers = (function () {
  "use strict";

  const state = {
    /** @type {Record<string, boolean>} */
    checked: {},
    groupsOpen: {},
  };

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
      const isOpen = !!state.groupsOpen[group.id];
      const wrap = document.createElement("div");
      wrap.className = `layer-group${isOpen ? " is-open" : ""}`;
      wrap.dataset.groupId = group.id;

      const header = document.createElement("button");
      header.type = "button";
      header.className = "layer-group__header";
      header.setAttribute("aria-expanded", String(isOpen));
      header.innerHTML = `
        <span class="layer-group__icon ${group.iconClass}" aria-hidden="true">${group.icon}</span>
        <span class="layer-group__name" title="${group.name}">${group.name}</span>
        <span class="layer-group__chevron" aria-hidden="true">▶</span>
      `;
      header.addEventListener("click", () => {
        state.groupsOpen[group.id] = !state.groupsOpen[group.id];
        renderGroups();
      });

      const body = document.createElement("div");
      body.className = "layer-group__body";
      body.setAttribute("role", "group");

      group.layers.forEach((layer) => {
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
          ${shield}
          <input type="checkbox" id="lyr-${layer.id}" ${checked ? "checked" : ""} />
          <label for="lyr-${layer.id}">${layer.name}</label>
        `;
        row.querySelector("input").addEventListener("change", async (ev) => {
          const turnOn = !!ev.target.checked;
          await setLayerVisible(layer.id, turnOn, { fit: turnOn });
        });
        if (window.InfraGeoAttrTable) {
          window.InfraGeoAttrTable.attachKebab(row, { ...layer, groupId: group.id });
        }
        body.appendChild(row);
      });

      wrap.append(header, body);
      container.appendChild(wrap);
    });
  }

  function prettyLabel(meta) {
    if (!meta) return "Camada";
    return String(meta.name || meta.id || "Camada");
  }

  function groupAccent(groupId) {
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
      br_am: "#22c55e",
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
    if (!box || !badge) return;

    const activeIds = Object.keys(state.checked).filter((id) => state.checked[id]);
    badge.textContent = String(activeIds.length);

    if (!activeIds.length) {
      box.innerHTML = '<p class="empty-hint">Nenhuma camada ativa</p>';
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
        chip.style.setProperty("--chip-accent", groupAccent(meta.groupId));

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
    getState,
    allLayerMetas,
    isLimiteEstadual,
    isLimiteMunicipal,
  };
})();
