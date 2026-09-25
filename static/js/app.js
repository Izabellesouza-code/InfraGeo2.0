/**
 * Bootstrap da página do mapa.
 * Carrega o catálogo PostGIS e orquestra os módulos da UI.
 */
(function () {
  "use strict";

  function hideBootSplash() {
    const el = document.getElementById("boot-splash");
    if (!el || el.classList.contains("is-done")) return;
    el.classList.add("is-done");
    el.setAttribute("aria-busy", "false");
    window.setTimeout(() => {
      try {
        el.remove();
      } catch {
        /* ignore */
      }
    }, 500);
  }

  function setBootMessage(text) {
    const msg = document.querySelector("#boot-splash .boot-splash__msg");
    if (msg && text) msg.textContent = text;
  }

  async function loadPostgisCatalog() {
    const statusEl = document.getElementById("active-layers");
    try {
      const res = await fetch(
        window.InfraGeoApi?.url?.("/api/postgis/catalog") || "/api/postgis/catalog"
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const catalog = await res.json();
      if (catalog.groups && catalog.groups.length) {
        window.InfraGeoConfig.groups = catalog.groups;
      }
      return catalog;
    } catch (err) {
      console.error("PostGIS catalog:", err);
      if (statusEl) {
        const api = window.InfraGeoApi?.base?.() || "";
        statusEl.innerHTML =
          `<p class="empty-hint">Sem conexão com a API${api ? ` (${api})` : ""}. ` +
          "No Render free a 1ª carga pode demorar ~1 min — atualize a página.</p>";
      }
      return null;
    }
  }

  async function applyFeedbackLink() {
    const p = new URLSearchParams(window.location.search);
    const layer = p.get("layer") || "";
    const q = (p.get("q") || p.get("keyword") || "").trim();
    if (!layer && !q) return false;
    if (layer) {
      try {
        await window.InfraGeoLayers.setLayerVisible(layer, true);
      } catch {
        /* ignore */
      }
    }
    const header = document.getElementById("busca-header");
    if (header && q) header.value = q;
    if (layer) {
      try {
        await window.InfraGeoAttrTable?.openForLayer?.(layer, q ? { filter: q } : {});
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      setBootMessage("Aguarde, estamos carregando as informações…");

      window.InfraGeoMap.createMap("map");
      window.InfraGeoHoverPopup.init();
      window.InfraGeoAuth.init();
      if (window.InfraGeoApi?.base?.() && !window.InfraGeoAuth.isLoggedIn()) {
        window.location.replace("/login");
        return;
      }
      if (window.InfraGeoAuth.getUser?.()?.must_change_password) {
        window.location.replace("/definir-senha");
        return;
      }
      window.InfraGeoAbout?.init?.();
      window.InfraGeoLegend?.init?.();
      window.InfraGeoFilters.init();
      window.InfraGeoPrintMap.init();
      window.InfraGeoLayoutMode?.init?.();

      window.InfraGeoSidebar.init({
      onToggleLayers: async (allOn) => {
        await window.InfraGeoLayers.setAll(allOn);
      },
      onFitAmazonas: () => {
        window.InfraGeoPrintMap?.restoreMainMapLayout?.();
        window.InfraGeoMap.fitAmazonas();
      },
      onUploadSuccess: async (data) => {
        const res = await fetch(
          window.InfraGeoApi?.url?.("/api/postgis/catalog") || "/api/postgis/catalog"
        );
        if (res.ok) {
          const catalog = await res.json();
          if (catalog.groups) window.InfraGeoConfig.groups = catalog.groups;
        }
        window.InfraGeoLayers.renderGroups();
        if (window.InfraGeoFilters.populateSelects) {
          window.InfraGeoFilters.populateSelects();
        }
        if (data.layer_id) {
          if (window.InfraGeoMap.overlayRegistry?.[data.layer_id]) {
            window.InfraGeoMap.hideLayer?.(data.layer_id);
            delete window.InfraGeoMap.overlayRegistry[data.layer_id];
          }
          await window.InfraGeoLayers.setLayerVisible(data.layer_id, true);
          const entry = window.InfraGeoMap.overlayRegistry?.[data.layer_id];
          if (entry?.leaflet?.getBounds) {
            const b = entry.leaflet.getBounds();
            if (b?.isValid?.()) {
              window.InfraGeoMap.getMap().fitBounds(b, { padding: [40, 40], maxZoom: 14 });
            }
          }
        }
        window.alert(
          data.renamed
            ? `Camada atualizada: ${data.name || data.layer_id}`
            : `SHP gravado: schema ${data.schema} · tabela ${data.table}\n${data.feature_count} feições`
        );
      },
      onToggleLegend: (show) => {
        window.InfraGeoLegend.open(show);
      },
    });

    window.InfraGeoAttrTable.init();
    window.InfraGeoChrome?.init?.();

    try {
      setBootMessage("Aguarde, estamos carregando as informações…");
      const catalog = await loadPostgisCatalog();
      window.InfraGeoLayers.renderGroups();
      if (window.InfraGeoFilters.populateSelects) {
        window.InfraGeoFilters.populateSelects();
      }

      if (!catalog) {
        setBootMessage("Não foi possível carregar as informações. Tentando abrir o mapa…");
      }

      await window.InfraGeoLayers.applyDefaults();
      window.InfraGeoPrintMap?.restoreMainMapLayout?.();
      const linked = await applyFeedbackLink();
      if (!linked) {
        window.InfraGeoMap.fitAmazonas();
        window.setTimeout(() => window.InfraGeoMap.fitAmazonas(), 500);
      }
    } catch (err) {
      console.error("Erro ao iniciar camadas:", err);
      setBootMessage("Falha ao carregar. Abrindo o mapa…");
    }
    } catch (err) {
      console.error("Erro ao iniciar o mapa:", err);
    } finally {
      hideBootSplash();
    }
  });
})();
