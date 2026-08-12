/**
 * Núcleo do mapa Leaflet — criação, basemaps e helpers.
 */
window.InfraGeoMap = (function () {
  "use strict";

  let map = null;
  let layerControl = null;
  let amazonaMaskLayer = null;
  const overlayRegistry = {};

  const MASK_FILL = "#e8eef5";

  function createMap(elementId) {
    const el = document.getElementById(elementId);
    const cfg = window.InfraGeoConfig;
    const lat = parseFloat(el.dataset.lat) || cfg.defaultCenter[0];
    const lon = parseFloat(el.dataset.lon) || cfg.defaultCenter[1];
    const zoom = parseInt(el.dataset.zoom, 10) || cfg.defaultZoom;

    map = L.map(elementId, {
      zoomControl: true,
      attributionControl: true,
      maxBoundsViscosity: 1.0,
    }).setView([lat, lon], zoom);

    // Painel da máscara: acima do basemap, abaixo das camadas
    map.createPane("amazonasMaskPane");
    const maskPane = map.getPane("amazonasMaskPane");
    if (maskPane) {
      maskPane.style.zIndex = 350;
      maskPane.style.pointerEvents = "none";
    }

    // Mapas base (controle de camadas Leaflet)
    const osmAttr =
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    const cartoAttr =
      osmAttr +
      ' contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

    const basemapDefs = [
      {
        name: "Google Earth",
        url: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        attribution: "&copy; Google",
        maxZoom: 21,
        subdomains: ["0", "1", "2", "3"],
      },
      {
        name: "Google Earth híbrido",
        url: "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        attribution: "&copy; Google",
        maxZoom: 21,
        subdomains: ["0", "1", "2", "3"],
      },
      {
        name: "OpenStreetMap",
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: osmAttr,
        maxZoom: 19,
      },
      {
        name: "Carto Positron",
        url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attribution: cartoAttr,
        maxZoom: 20,
        subdomains: "abcd",
        default: true,
      },
      {
        name: "Carto Dark",
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution: cartoAttr,
        maxZoom: 20,
        subdomains: "abcd",
      },
    ];

    const basemapControls = {};
    basemapDefs.forEach((bm) => {
      const opts = {
        attribution: bm.attribution,
        maxZoom: bm.maxZoom || 19,
        crossOrigin: true,
      };
      if (bm.subdomains) opts.subdomains = bm.subdomains;
      const tile = L.tileLayer(bm.url, opts);
      basemapControls[bm.name] = tile;
      if (bm.default) tile.addTo(map);
    });

    layerControl = L.control
      .layers(basemapControls, null, { position: "topright", collapsed: true })
      .addTo(map);

    // Restringe a navegação ao Amazonas desde o início
    applyAmazonasMapLimits({ fit: true, animate: false });

    map.on("resize", () => {
      try {
        const z = map.getZoom();
        const min = map.getMinZoom();
        // Só re-preenche a tela se estiver no enquadramento geral do estado
        if (Number.isFinite(z) && Number.isFinite(min) && z <= min + 0.35) {
          applyAmazonasMapLimits({ fit: true, animate: false });
        } else {
          map.invalidateSize({ animate: false, pan: false });
        }
      } catch {
        /* ignore */
      }
    });

    return map;
  }

  function getMap() {
    return map;
  }

  /** Bounds do estado (limite estadual carregado ou fallback da config). */
  function getAmazonasBounds() {
    let bounds = null;
    Object.keys(overlayRegistry).forEach((id) => {
      const entry = overlayRegistry[id];
      const schema = String(entry?.meta?.schema || id || "").toUpperCase();
      if (!schema.startsWith("LIMITE_ESTADUAL")) return;
      const b = entry?.leaflet?.getBounds?.();
      if (b?.isValid?.()) bounds = b;
    });
    if (!bounds) {
      const ab = window.InfraGeoConfig?.amazonaBounds;
      if (ab) bounds = L.latLngBounds(ab[0], ab[1]);
    }
    return bounds;
  }

  /**
   * Limita pan/zoom ao Amazonas e preenche a tela com o estado.
   */
  function applyAmazonasMapLimits(opts) {
    if (!map) return;
    const bounds = getAmazonasBounds();
    if (!bounds?.isValid?.()) return;

    map.invalidateSize({ animate: false, pan: false });
    const size = map.getSize();
    // Sem tamanho real o fitBounds fica no zoom errado (estado miúdo no centro)
    if (!size || size.x < 40 || size.y < 40) return;

    // Libera limites antigos para calcular o enquadramento corretamente
    try {
      map.setMinZoom(1);
      map.setMaxBounds(null);
    } catch {
      /* ignore */
    }

    if (opts?.fit) {
      map.fitBounds(bounds, {
        padding: [4, 4],
        maxZoom: 14,
        animate: opts.animate === true,
      });
    }

    const padded = bounds.pad(0.005);
    map.setMaxBounds(padded);
    map.options.maxBoundsViscosity = 1.0;

    try {
      // Não permite afastar além do enquadramento que preenche a tela
      const zFill = map.getBoundsZoom(bounds, false, L.point(4, 4));
      const zNow = map.getZoom();
      const minZ = Number.isFinite(zFill)
        ? Math.max(4, Math.min(zFill, Number.isFinite(zNow) ? zNow : zFill) - 0.05)
        : Math.max(4, (zNow || 6) - 0.05);
      map.setMinZoom(minZ);
    } catch {
      if (Number.isFinite(map.getZoom())) {
        map.setMinZoom(Math.max(4, map.getZoom() - 0.05));
      }
    }
  }

  /** Extrai anéis exteriores [lat,lng] do GeoJSON do limite estadual. */
  function extractAmazonasHoles(geojsonOrLayer) {
    const holes = [];
    let gj = geojsonOrLayer;
    try {
      if (geojsonOrLayer && typeof geojsonOrLayer.toGeoJSON === "function") {
        gj = geojsonOrLayer.toGeoJSON();
      }
    } catch {
      return holes;
    }
    if (!gj) return holes;

    const pushRing = (ring) => {
      if (!ring || ring.length < 3) return;
      holes.push(ring.map((c) => [c[1], c[0]]));
    };

    const walk = (geom) => {
      if (!geom) return;
      if (geom.type === "Polygon") {
        pushRing(geom.coordinates[0]);
      } else if (geom.type === "MultiPolygon") {
        geom.coordinates.forEach((poly) => pushRing(poly[0]));
      } else if (geom.type === "GeometryCollection") {
        (geom.geometries || []).forEach(walk);
      }
    };

    if (gj.type === "FeatureCollection") {
      (gj.features || []).forEach((f) => walk(f.geometry));
    } else if (gj.type === "Feature") {
      walk(gj.geometry);
    } else {
      walk(gj);
    }
    return holes;
  }

  function buildAmazonasMaskLayer(holes, paneName) {
    if (!holes.length) return null;
    // Anel exterior (quase o mundo) + furos = Amazonas
    const world = [
      [-85, -180],
      [-85, 180],
      [85, 180],
      [85, -180],
    ];
    return L.polygon([world, ...holes], {
      stroke: false,
      fillColor: MASK_FILL,
      fillOpacity: 1,
      interactive: false,
      pane: paneName || "amazonasMaskPane",
      className: "amazonas-mask",
    });
  }

  /**
   * Máscara colorida desativada — o basemap preenche a tela.
   * Mantido só para limpar máscara antiga se ainda existir.
   */
  function ensureAmazonasMask(_sourceLayer) {
    if (!map || !amazonaMaskLayer) return null;
    try {
      map.removeLayer(amazonaMaskLayer);
    } catch {
      /* ignore */
    }
    amazonaMaskLayer = null;
    return null;
  }

  /** Exportação/prévia: não aplica máscara (usa o mapa base). */
  function addAmazonasMaskToMap(_targetMap) {
    return null;
  }

  function fitAmazonas() {
    if (!map) return;

    const container = map.getContainer();
    if (container) {
      container.removeAttribute("style");
    }

    const run = () => {
      try {
        map.invalidateSize({ animate: false, pan: false });
        applyAmazonasMapLimits({ fit: true, animate: false });
      } catch (err) {
        console.warn("fitAmazonas", err);
      }
    };

    run();
    // Reaplica quando o layout CSS já tiver largura/altura finais
    requestAnimationFrame(() => {
      run();
      setTimeout(run, 120);
      setTimeout(run, 350);
      setTimeout(run, 700);
    });
  }

  function styleFor(meta) {
    const s = meta.style || {};
    if (meta.type === "Point" || meta.type === "MultiPoint") {
      return {
        radius: s.radius || 7,
        fillColor: s.fillColor || "#3b82f6",
        color: s.color || "#1e3a8a",
        weight: s.weight || 2,
        opacity: s.opacity ?? 1,
        fillOpacity: s.fillOpacity ?? 0.8,
      };
    }
    return {
      color: s.color || "#111827",
      fillColor: s.fillColor || "#111827",
      weight: s.weight ?? 2,
      opacity: s.opacity ?? 1,
      fillOpacity: s.fillOpacity ?? 0.2,
    };
  }

  async function loadGeoJSONLayer(meta) {
    if (overlayRegistry[meta.id]) {
      return overlayRegistry[meta.id];
    }

    const res = await fetch(window.InfraGeoApi?.url?.(meta.url) || meta.url);
    if (!res.ok) {
      throw new Error(`Falha ao carregar ${meta.name}: ${res.status}`);
    }
    const geojson = await res.json();
    const style = styleFor(meta);
    const schemaUp = String(meta.schema || "").toUpperCase();
    const isLimiteContext =
      schemaUp.startsWith("LIMITE_ESTADUAL") ||
      schemaUp.startsWith("LIMITE_MUNICIPAL");

    const group = L.geoJSON(geojson, {
      style: () => ({ ...style, tolerance: 8, interactive: !isLimiteContext }),
      pointToLayer: (_f, latlng) =>
        L.circleMarker(latlng, { ...style, interactive: true }),
      onEachFeature: (feature, layer) => {
        if (window.InfraGeoHoverPopup) {
          window.InfraGeoHoverPopup.bindFeature(feature, layer, meta);
        }
      },
      interactive: !isLimiteContext,
    });

    let brShield = null;
    if (window.InfraGeoBrShield && window.InfraGeoBrShield.isBrLayer(meta)) {
      brShield = window.InfraGeoBrShield.buildMarkers(group, meta);
    }

    overlayRegistry[meta.id] = {
      meta,
      leaflet: group,
      brShield,
      visible: false,
    };

    return overlayRegistry[meta.id];
  }

  function showLayer(id) {
    const entry = overlayRegistry[id];
    if (!entry || entry.visible) return;
    entry.leaflet.addTo(map);
    if (entry.brShield) entry.brShield.addTo(map);
    entry.visible = true;

    const schema = String(entry?.meta?.schema || "").toUpperCase();
    if (schema.startsWith("LIMITE_ESTADUAL")) {
      ensureAmazonasMask(entry.leaflet);
      applyAmazonasMapLimits({ fit: true, animate: false });
    }
  }

  function hideLayer(id) {
    const entry = overlayRegistry[id];
    if (!entry || !entry.visible) return;
    map.removeLayer(entry.leaflet);
    if (entry.brShield) map.removeLayer(entry.brShield);
    entry.visible = false;
    window.InfraGeoHoverPopup?.hide?.(true);
  }

  function toggleLayer(id, on) {
    if (on) showLayer(id);
    else hideLayer(id);
  }

  function getVisibleLayers() {
    return Object.values(overlayRegistry)
      .filter((e) => e.visible)
      .map((e) => e.meta);
  }

  function setAllLayersVisible(on) {
    Object.keys(overlayRegistry).forEach((id) => toggleLayer(id, on));
  }

  function clearAllOverlays() {
    setAllLayersVisible(false);
  }

  return {
    createMap,
    getMap,
    fitAmazonas,
    getAmazonasBounds,
    applyAmazonasMapLimits,
    ensureAmazonasMask,
    addAmazonasMaskToMap,
    loadGeoJSONLayer,
    toggleLayer,
    getVisibleLayers,
    setAllLayersVisible,
    clearAllOverlays,
    overlayRegistry,
  };
})();
