/**
 * Painel de filtros (header → Filtros).
 * Lista todos os grupos/camadas do catálogo e pode ligá-los no mapa.
 */
window.InfraGeoFilters = (function () {
  "use strict";

  function open(show) {
    const panel = document.getElementById("painel-filtros");
    const btn = document.getElementById("btn-filtros");
    if (!panel) return;
    if (show) window.InfraGeoSidebar?.setOpen?.(false);
    panel.hidden = !show;
    panel.setAttribute("aria-hidden", String(!show));
    if (btn) btn.setAttribute("aria-expanded", String(show));
    if (show) populateSelects();
  }

  function toggle() {
    const panel = document.getElementById("painel-filtros");
    open(panel.hidden);
  }

  function groups() {
    return window.InfraGeoConfig?.groups || [];
  }

  function allLayers(groupId) {
    const list = [];
    groups().forEach((g) => {
      if (groupId && g.id !== groupId) return;
      (g.layers || []).forEach((l) => {
        list.push({ ...l, groupId: g.id, groupName: g.name });
      });
    });
    return list;
  }

  function populateSelects() {
    const grupoSel = document.getElementById("filtro-grupo");
    const camadaSel = document.getElementById("filtro-camada");
    if (!grupoSel || !camadaSel) return;

    const currentGrupo = grupoSel.value;
    const currentCamada = camadaSel.value;

    grupoSel.innerHTML = '<option value="">Todos</option>';
    groups().forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      grupoSel.appendChild(opt);
    });
    if ([...grupoSel.options].some((o) => o.value === currentGrupo)) {
      grupoSel.value = currentGrupo;
    }

    fillCamadas(grupoSel.value, currentCamada);
  }

  function fillCamadas(groupId, keepValue) {
    const camadaSel = document.getElementById("filtro-camada");
    if (!camadaSel) return;
    const layers = allLayers(groupId || "");
    camadaSel.innerHTML = '<option value="">Todas do grupo</option>';
    layers.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = groupId ? l.name : `${l.groupName} — ${l.name}`;
      camadaSel.appendChild(opt);
    });
    if (keepValue && [...camadaSel.options].some((o) => o.value === keepValue)) {
      camadaSel.value = keepValue;
    }
  }

  function matchLayers(grupo, camada, busca) {
    return allLayers(grupo || "").filter((l) => {
      if (camada && l.id !== camada) return false;
      if (busca && !String(l.name || "").toLowerCase().includes(busca)) return false;
      return true;
    });
  }

  async function applyFilters() {
    const grupo = document.getElementById("filtro-grupo").value;
    const camada = document.getElementById("filtro-camada").value;
    const busca = document.getElementById("filtro-busca").value.trim().toLowerCase();
    const ligar = document.getElementById("filtro-ligar")?.checked;

    const matched = matchLayers(grupo, camada, busca);

    // Abre grupos relevantes na sidebar
    const st = window.InfraGeoLayers.getState();
    if (grupo) {
      st.groupsOpen[grupo] = true;
    } else {
      matched.forEach((l) => {
        st.groupsOpen[l.groupId] = true;
      });
    }
    window.InfraGeoLayers.renderGroups();
    window.InfraGeoLayers.filterGroups(grupo);

    document.querySelectorAll(".layer-item").forEach((row) => {
      const label = row.querySelector("label");
      const input = row.querySelector("input[type='checkbox']");
      if (!label || !input) return;
      const id = input.id.replace(/^lyr-/, "");
      const inMatch = matched.some((l) => l.id === id);
      const textOk = !busca || label.textContent.toLowerCase().includes(busca);
      row.style.display = inMatch && textOk ? "" : "none";
    });

    if (ligar && matched.length) {
      for (const layer of matched) {
        // Limite municipal só liga pelo checkbox da própria opção na sidebar
        if (window.InfraGeoLayers?.isLimiteMunicipal?.(layer)) continue;
        await window.InfraGeoLayers.setLayerVisible(layer.id, true);
      }
      window.InfraGeoLayers.renderGroups();
      // reaplica visibilidade das linhas após re-render
      document.querySelectorAll(".layer-item").forEach((row) => {
        const input = row.querySelector("input[type='checkbox']");
        if (!input) return;
        const id = input.id.replace(/^lyr-/, "");
        row.style.display = matched.some((l) => l.id === id) ? "" : grupo || busca || camada ? "none" : "";
      });
      if (grupo) window.InfraGeoLayers.filterGroups(grupo);
    }

    open(false);
  }

  function init() {
    const openBtn = document.getElementById("btn-filtros");
    const closeBtn = document.getElementById("btn-fechar-filtros");
    const form = document.getElementById("form-filtros");
    const grupoSel = document.getElementById("filtro-grupo");

    if (openBtn) openBtn.addEventListener("click", toggle);
    if (closeBtn) closeBtn.addEventListener("click", () => open(false));

    if (grupoSel) {
      grupoSel.addEventListener("change", () => {
        fillCamadas(grupoSel.value, "");
      });
    }

    if (form) {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        await applyFilters();
      });

      form.addEventListener("reset", () => {
        setTimeout(() => {
          populateSelects();
          window.InfraGeoLayers.filterGroups("");
          document.querySelectorAll(".layer-item").forEach((row) => {
            row.style.display = "";
          });
        }, 0);
      });
    }

    populateSelects();
  }

  return { init, open, toggle, populateSelects };
})();
