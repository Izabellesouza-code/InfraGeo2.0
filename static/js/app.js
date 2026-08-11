/**
 * Bootstrap da página do mapa.
 * Carrega o catálogo PostGIS e orquestra os módulos da UI.
 */
(function () {
  "use strict";

  async function loadPostgisCatalog() {
    const statusEl = document.getElementById("active-layers");
    try {
      const res = await fetch(window.InfraGeoApi?.url?.("/api/postgis/catalog") || "/api/postgis/catalog");
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
        statusEl.innerHTML =
          '<p class="empty-hint">Sem conexão com o banco. Verifique DATABASE_URL / servidor PostGIS.</p>';
      }
      return null;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    window.InfraGeoMap.createMap("map");
    window.InfraGeoHoverPopup.init();
    window.InfraGeoAuth.init();
    window.InfraGeoLegend.init();
    window.InfraGeoFilters.init();
    window.InfraGeoPrintMap.init();

    window.InfraGeoSidebar.init({
      onToggleLayers: async (allOn) => {
        await window.InfraGeoLayers.setAll(allOn);
      },
      onFitAmazonas: () => {
        window.InfraGeoPrintMap?.restoreMainMapLayout?.();
        window.InfraGeoMap.fitAmazonas();
      },
      onUploadSuccess: async (data) => {
        const res = await fetch(window.InfraGeoApi?.url?.("/api/postgis/catalog") || "/api/postgis/catalog");
        if (res.ok) {
          const catalog = await res.json();
          if (catalog.groups) window.InfraGeoConfig.groups = catalog.groups;
        }
        window.InfraGeoLayers.renderGroups();
        if (window.InfraGeoFilters.populateSelects) {
          window.InfraGeoFilters.populateSelects();
        }
        if (data.layer_id) {
          // limpa cache Leaflet se a tabela foi sobrescrita
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
          `SHP gravado: schema ${data.schema} · tabela ${data.table}\n${data.feature_count} feições`
        );
      },
      onToggleLegend: (show) => {
        window.InfraGeoLegend.open(show);
      },
    });

    window.InfraGeoAttrTable.init();

    await loadPostgisCatalog();
    window.InfraGeoLayers.renderGroups();
    if (window.InfraGeoFilters.populateSelects) {
      window.InfraGeoFilters.populateSelects();
    }

    try {
      await window.InfraGeoLayers.applyDefaults();
      window.InfraGeoPrintMap?.restoreMainMapLayout?.();
      window.InfraGeoMap.fitAmazonas();
      // Garante enquadramento depois do layout/sidebar estabilizar
      window.setTimeout(() => window.InfraGeoMap.fitAmazonas(), 500);
    } catch (err) {
      console.error("Erro ao iniciar camadas:", err);
    }
  });
})();
