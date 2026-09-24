/**
 * Casco visual institucional: trilho, leitura do mapa, basemap e barra inferior.
 * Encaminha ações para os módulos já existentes (camadas, filtros, legendas).
 */
window.InfraGeoChrome = (function () {
  "use strict";

  function setRail(name) {
    document.querySelectorAll(".nav-rail__btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.chrome === name);
    });
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const EYE_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0013.4 13.4"/><path d="M9.9 5.1A11 11 0 0112 5c6 0 10 7 10 7a18 18 0 01-4.2 4.8"/><path d="M6.1 6.1C3.9 7.7 2 12 2 12s4 7 10 7c1.8 0 3.5-.4 5.1-1.3"/></svg>`;

  let hudMenuIds = [];

  function layerDotColor(l) {
    const s = l?.style || {};
    const raw = String(s.fillColor || s.color || "").trim();
    if (!raw || raw === "transparent" || /^#fff(f{3})?$/i.test(raw)) return "#1d6fe8";
    return raw;
  }

  function refresh() {
    const visible = window.InfraGeoMap?.getVisibleLayers?.() || [];
    const visIds = new Set(visible.map((l) => String(l.id)));

    const countEl = document.getElementById("camadas-visiveis-count");
    if (countEl) {
      const n = visible.length;
      countEl.textContent = `${n} camada${n === 1 ? "" : "s"} visíve${n === 1 ? "l" : "is"}`;
    }

    const menu = document.getElementById("menu-camadas-visiveis");
    if (menu && !menu.hidden) {
      const catalog = window.InfraGeoLayers?.allLayerMetas?.() || [];
      const byId = new Map(catalog.map((m) => [String(m.id), m]));
      visible.forEach((m) => byId.set(String(m.id), m));
      const ids = new Set([...hudMenuIds.map(String), ...visIds]);
      const rows = [...ids]
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));

      if (!rows.length) {
        menu.innerHTML = `<p class="map-chip-menu__empty">Nenhuma camada visível</p>`;
      } else {
        const items = rows
          .map((l) => {
            const on = visIds.has(String(l.id));
            const color = layerDotColor(l);
            return `<div class="map-chip-menu__item${on ? "" : " is-off"}" data-layer-id="${esc(l.id)}">
              <span class="map-chip-menu__dot" style="background:${esc(color)}"></span>
              <button type="button" class="map-chip-menu__name" data-open-table="${esc(l.id)}" ${on ? "" : "disabled"}>
                <span class="map-chip-menu__label">${esc(l.name)}</span>
              </button>
              <button type="button" class="map-chip-menu__eye${on ? " is-on" : ""}" data-toggle-layer="${esc(l.id)}" title="${on ? "Ocultar camada" : "Mostrar camada"}" aria-label="${on ? "Ocultar camada" : "Mostrar camada"}" aria-pressed="${on}">
                ${on ? EYE_ON : EYE_OFF}
              </button>
            </div>`;
          })
          .join("");
        const rowCount = Math.max(1, Math.ceil(rows.length / 2));
        menu.innerHTML = `<div class="map-chip-menu__grid" style="--chip-rows:${rowCount}">${items}</div>`;
        menu.querySelectorAll("[data-open-table]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-open-table");
            if (id) window.InfraGeoAttrTable?.openForLayer?.(id);
          });
        });
        menu.querySelectorAll("[data-toggle-layer]").forEach((btn) => {
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const id = btn.getAttribute("data-toggle-layer");
            if (!id) return;
            const on = visIds.has(String(id));
            await window.InfraGeoLayers?.setLayerVisible?.(id, !on);
            refresh();
          });
        });
      }
    }

    const clock = document.getElementById("status-atualizado");
    if (clock) {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      clock.textContent = `Atualizado às ${hh}:${mm}`;
    }
  }

  function init() {
    document.querySelectorAll(".nav-rail__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.chrome;
        if (!action) return;
        setRail(action);
        if (action === "mapa") {
          window.InfraGeoLayers?.showFavorites?.(false);
          window.InfraGeoSidebar?.setOpen?.(false);
          window.InfraGeoLegend?.open?.(false);
          window.InfraGeoFilters?.open?.(false);
        } else if (action === "camadas") {
          const wasFav = window.InfraGeoLayers?.getState?.()?.favoritesOnly;
          window.InfraGeoLayers?.showFavorites?.(false);
          if (wasFav) window.InfraGeoSidebar?.setOpen?.(true);
          else window.InfraGeoSidebar?.toggle?.();
        } else if (action === "legenda") {
          window.InfraGeoLegend?.toggle?.();
        } else if (action === "favoritos") {
          window.InfraGeoLayers?.showFavorites?.(true);
          window.InfraGeoSidebar?.setOpen?.(true);
        } else if (action === "exportar" || action === "compartilhar") {
          window.InfraGeoLayoutMode?.open?.(true);
        } else if (action === "ajuda") {
          document.getElementById("btn-sobre")?.click();
        }
      });
    });

    document.getElementById("btn-collapse-rail")?.addEventListener("click", () => {
      document.body.classList.toggle("rail-collapsed");
      window.InfraGeoMap?.getMap?.()?.invalidateSize?.({ animate: false });
      syncRestores();
    });

    document.getElementById("btn-toggle-leitura")?.addEventListener("click", () => {
      document.body.classList.toggle("reading-collapsed");
      window.InfraGeoMap?.getMap?.()?.invalidateSize?.({ animate: false });
      syncRestores();
    });

    document.getElementById("form-busca-header")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const q = document.getElementById("busca-header")?.value || "";
      if (q.trim()) window.InfraGeoFilters?.applyQuery?.(q);
      else {
        window.InfraGeoSidebar?.setOpen?.(true);
        window.InfraGeoFilters?.open?.(true);
      }
    });

    document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
      window.InfraGeoMap?.zoomBy?.(1);
    });
    document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
      window.InfraGeoMap?.zoomBy?.(-1);
    });
    document.getElementById("btn-locate")?.addEventListener("click", () => {
      window.InfraGeoMap?.locateUser?.();
    });
    document.getElementById("btn-fullscreen")?.addEventListener("click", () => {
      const el = document.querySelector(".map-area");
      if (!el) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else el.requestFullscreen?.();
    });

    const BASEMAP_LABELS = {
      "Esri Light Gray": "Mapa claro",
      "Esri Light Gray + rótulos": "Mapa com nomes",
      "Esri Streets": "Ruas",
      OpenStreetMap: "Mapa (ruas)",
      "Satélite (Esri)": "Satélite",
      "Google Earth": "Satélite (Google)",
      "Google Earth híbrido": "Híbrido (satélite + ruas)",
      "Esri Topográfico": "Terreno",
      OpenTopoMap: "Relevo",
    };

    function renderBasemapTab() {
      const list = document.getElementById("lista-basemap");
      if (!list) return;
      const names = window.InfraGeoMap?.getBasemapNames?.() || [];
      const active = window.InfraGeoMap?.getActiveBasemapName?.();
      if (!names.length) {
        list.innerHTML = `<p class="basemap-tab__empty">Nenhuma camada de mapa disponível</p>`;
        return;
      }
      list.innerHTML = names
        .map((name) => {
          const label = BASEMAP_LABELS[name] || name;
          const on = name === active;
          return `<button type="button" class="basemap-tab__item${on ? " is-active" : ""}" data-basemap-name="${esc(name)}">
            <span class="basemap-tab__radio" aria-hidden="true"></span>
            <span class="basemap-tab__copy">
              <strong>${esc(label)}</strong>
              <small>${esc(name)}</small>
            </span>
          </button>`;
        })
        .join("");
      list.querySelectorAll("[data-basemap-name]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.getAttribute("data-basemap-name");
          window.InfraGeoMap?.setBasemapByName?.(name);
          renderBasemapTab();
        });
      });
    }

    function setBasemapTabOpen(open) {
      const panel = document.getElementById("painel-basemap");
      const btn = document.getElementById("btn-basemap-tab");
      if (!panel) return;
      panel.hidden = !open;
      btn?.setAttribute("aria-expanded", String(!!open));
      btn?.classList.toggle("is-active", !!open);
      if (open) renderBasemapTab();
    }

    document.getElementById("btn-basemap-tab")?.addEventListener("click", () => {
      const panel = document.getElementById("painel-basemap");
      setBasemapTabOpen(!!panel?.hidden);
    });
    document.getElementById("btn-fechar-basemap")?.addEventListener("click", () => {
      setBasemapTabOpen(false);
    });
    document.addEventListener("click", (ev) => {
      const wrap = document.querySelector(".basemap-tab");
      if (!wrap || wrap.contains(ev.target)) return;
      setBasemapTabOpen(false);
    });

    document.getElementById("btn-camadas-visiveis")?.addEventListener("click", () => {
      const menu = document.getElementById("menu-camadas-visiveis");
      const btn = document.getElementById("btn-camadas-visiveis");
      if (!menu) return;
      const opening = menu.hidden;
      menu.hidden = !opening;
      btn?.setAttribute("aria-expanded", String(opening));
      if (opening) {
        hudMenuIds = (window.InfraGeoMap?.getVisibleLayers?.() || []).map((l) => String(l.id));
      } else {
        hudMenuIds = [];
      }
      refresh();
    });

    document.getElementById("btn-ver-detalhes")?.addEventListener("click", () => {
      window.InfraGeoLegend?.open?.(true);
    });

    refresh();
    bindRestores();
  }

  const sawOpen = {
    sidebar: false,
    filtros: false,
    legendas: false,
    attr: false,
  };

  function setRestore(name, show) {
    const btn = document.querySelector(`.panel-restore[data-restore="${name}"]`);
    if (btn) btn.hidden = !show;
  }

  function syncRestores() {
    const sidebarOpen = document.body.classList.contains("sidebar-open");
    const filtrosOpen = !document.getElementById("painel-filtros")?.hidden;
    const legendasOpen = !document.getElementById("painel-legendas")?.hidden;
    const attrOpen = !document.getElementById("attr-table-panel")?.hidden;
    if (sidebarOpen) sawOpen.sidebar = true;
    if (filtrosOpen) sawOpen.filtros = true;
    if (legendasOpen) sawOpen.legendas = true;
    if (attrOpen) sawOpen.attr = true;
    setRestore("rail", document.body.classList.contains("rail-collapsed"));
    setRestore("reading", document.body.classList.contains("reading-collapsed"));
    setRestore("sidebar", sawOpen.sidebar && !sidebarOpen);
    setRestore("filtros", sawOpen.filtros && !filtrosOpen);
    setRestore("legendas", sawOpen.legendas && !legendasOpen);
    setRestore("attr", sawOpen.attr && !attrOpen);
  }

  function bindRestores() {
    document.querySelectorAll(".panel-restore").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.restore;
        if (name === "rail") document.body.classList.remove("rail-collapsed");
        if (name === "reading") document.body.classList.remove("reading-collapsed");
        if (name === "sidebar") window.InfraGeoSidebar?.setOpen?.(true);
        if (name === "filtros") window.InfraGeoFilters?.open?.(true);
        if (name === "legendas") window.InfraGeoLegend?.open?.(true);
        if (name === "attr") window.InfraGeoAttrTable?.reopen?.();
        window.InfraGeoMap?.getMap?.()?.invalidateSize?.({ animate: false });
        syncRestores();
      });
    });

    const observer = new MutationObserver(syncRestores);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    ["painel-filtros", "painel-legendas", "attr-table-panel", "sidebar-principal"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ["hidden", "class"] });
    });
    syncRestores();
  }

  return { init, refresh, syncRestores };
})();
