/**
 * Núcleo do mapa Leaflet — criação, basemaps e helpers.
 */
window.InfraGeoMap = (function () {
  "use strict";

  let map = null;
  let layerControl = null;
  let amazonaMaskLayer = null;
  const overlayRegistry = {};
  let basemapControls = {};

  const MASK_FILL = "#e8eef5";
  const EMPTY_TILE =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const SAT_ZOOM_CAP = 16;

  function zoomLimitBox() {
    return document.getElementById("map-zoom-limit");
  }

  function notifyZoomLimit(show) {
    const box = zoomLimitBox();
    if (!box) return;
    const on = show !== false;
    box.hidden = !on;
    box.setAttribute("aria-busy", on ? "true" : "false");
    if (on) {
      window.clearTimeout(notifyZoomLimit._t);
      notifyZoomLimit._t = window.setTimeout(() => {
        if (map && map.getZoom() < map.getMaxZoom() - 0.05) box.hidden = true;
      }, 4000);
    }
  }

  function layerMaxZoom(layer) {
    const found = [];
    const walk = (lyr) => {
      if (!lyr) return;
      if (typeof lyr.eachLayer === "function") {
        lyr.eachLayer(walk);
        return;
      }
      const z = Number(lyr.options?.maxZoom);
      if (Number.isFinite(z)) found.push(z);
    };
    walk(layer);
    if (!found.length && Number.isFinite(layer?.options?.maxZoom)) {
      found.push(layer.options.maxZoom);
    }
    return found.length ? Math.max(...found) : SAT_ZOOM_CAP;
  }

  function applyBasemapZoomCap() {
    if (!map) return;
    const name = getActiveBasemapName() || "";
    const layer = basemapControls[name];
    let cap = layerMaxZoom(layer);
    if (/google|earth|sentinel|satél|satelit/i.test(name)) {
      cap = Math.min(cap, SAT_ZOOM_CAP);
    }
    map.setMaxZoom(cap);
    if (map.getZoom() > cap) {
      map.setZoom(cap, { animate: false });
      notifyZoomLimit(true);
    }
  }

  function bindZoomLimit(target) {
    if (!target?.on) return;
    const atCap = () =>
      Number.isFinite(target.getMaxZoom?.()) &&
      target.getZoom() >= target.getMaxZoom() - 0.05;
    target.on("zoomend", () => notifyZoomLimit(atCap()));
    target.getContainer?.()?.addEventListener(
      "wheel",
      (ev) => {
        if (ev.deltaY < 0 && atCap()) notifyZoomLimit(true);
      },
      { passive: true }
    );
    target.on("zoomstart", () => {
      if (atCap()) notifyZoomLimit(true);
    });
  }

  function bindMapSatWait(target) {
    const box = document.getElementById("map-sat-wait");
    if (!box || !target?.on) return;
    const show = () => {
      box.hidden = false;
      box.setAttribute("aria-busy", "true");
    };
    const hide = () => {
      box.hidden = true;
      box.setAttribute("aria-busy", "false");
    };
    let hideTimer = 0;
    const showSoon = () => {
      show();
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, 10000);
    };
    const hideSoon = () => {
      window.clearTimeout(hideTimer);
      hide();
    };
    const watchLayer = (layer) => {
      if (!layer) return;
      if (typeof layer.eachLayer === "function") {
        layer.eachLayer(watchLayer);
        return;
      }
      if (typeof layer.on !== "function") return;
      layer.on("loading", showSoon);
      layer.on("load", hideSoon);
    };
    target.on("loading", showSoon);
    target.on("load", hideSoon);
    target.on("layeradd", (ev) => watchLayer(ev.layer));
    target.eachLayer?.(watchLayer);
  }

  function silenceBrokenTile(img) {
    hideBadTile(img);
  }

  function watchLeafletTile(img) {
    if (!(img instanceof HTMLImageElement) || img.__igTileWatch) return;
    if (!img.classList.contains("leaflet-tile")) return;
    img.__igTileWatch = true;
    img.alt = "";
    const check = () => {
      if (img.complete && img.naturalWidth === 0) silenceBrokenTile(img);
    };
    img.addEventListener("error", () => silenceBrokenTile(img));
    img.addEventListener("load", check);
    if (img.complete) check();
  }

  document.addEventListener(
    "error",
    (ev) => {
      const el = ev.target;
      if (el && el.tagName === "IMG" && el.classList.contains("leaflet-tile")) {
        silenceBrokenTile(el);
      }
    },
    true
  );

  const tileWatcher = new MutationObserver((recs) => {
    recs.forEach((rec) => {
      rec.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches?.("img.leaflet-tile")) watchLeafletTile(node);
        node.querySelectorAll?.("img.leaflet-tile").forEach(watchLeafletTile);
      });
    });
  });
  tileWatcher.observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll("img.leaflet-tile").forEach(watchLeafletTile);
  window.setInterval(() => {
    document.querySelectorAll("img.leaflet-tile").forEach((img) => {
      const src = String(img.currentSrc || img.src || "");
      const zMatch = src.match(/[?&]z=(\d+)/i);
      const googleTooClose =
        /google\.com\/vt/i.test(src) && zMatch && Number(zMatch[1]) > SAT_ZOOM_CAP;
      if (googleTooClose || (img.complete && img.naturalWidth === 0)) {
        silenceBrokenTile(img);
        if (googleTooClose) notifyZoomLimit(true);
      }
    });
  }, 200);

  function hideBadTile(tile) {
    if (!tile || !tile.style) return;
    tile.classList.add("leaflet-tile-error");
    tile.dataset.igEmpty = "1";
    tile.alt = "";
    tile.removeAttribute("title");
    tile.style.setProperty("display", "none", "important");
    tile.style.setProperty("visibility", "hidden", "important");
    tile.style.setProperty("opacity", "0", "important");
    tile.style.setProperty("width", "0", "important");
    tile.style.setProperty("height", "0", "important");
  }

  if (window.L?.GridLayer?.prototype?._tileReady) {
    const origReady = L.GridLayer.prototype._tileReady;
    L.GridLayer.prototype._tileReady = function (coords, err, tile) {
      if (tile && (err || (tile.complete && tile.naturalWidth < 2))) {
        hideBadTile(tile);
      }
      return origReady.call(this, coords, err, tile);
    };
  }

  if (window.L?.TileLayer) {
    const origInit = L.TileLayer.prototype.initialize;
    L.TileLayer.prototype.initialize = function (url, options) {
      const opts = { ...(options || {}) };
      opts.errorTileUrl = EMPTY_TILE;
      return origInit.call(this, url, opts);
    };
    const origOnError = L.TileLayer.prototype._tileOnError;
    L.TileLayer.prototype._tileOnError = function (done, tile, e) {
      hideBadTile(tile);
      if (typeof done === "function") done(e, tile);
      else if (typeof origOnError === "function") origOnError.call(this, done, tile, e);
    };
    const origCreateTile = L.TileLayer.prototype.createTile;
    L.TileLayer.prototype.createTile = function (coords, done) {
      const tile = origCreateTile.call(this, coords, (err, t) => {
        const el = t || tile;
        if (err || (el && el.complete && el.naturalWidth < 2)) hideBadTile(el);
        if (typeof done === "function") done(err, t);
      });
      tile.addEventListener("error", () => hideBadTile(tile), true);
      tile.addEventListener(
        "load",
        () => {
          if (tile.naturalWidth < 2) hideBadTile(tile);
        },
        true
      );
      return tile;
    };
    L.TileLayer.addInitHook(function () {
      this.options.errorTileUrl = EMPTY_TILE;
      this.on("tileerror", (ev) => hideBadTile(ev && ev.tile));
      const origGetTileUrl = this.getTileUrl.bind(this);
      this.getTileUrl = function (coords) {
        const template = String(this._url || "");
        if (/google\.com/i.test(template) && Number(coords?.z) >= SAT_ZOOM_CAP + 1) {
          notifyZoomLimit(true);
          return EMPTY_TILE;
        }
        return origGetTileUrl(coords);
      };
    });
  }
  if (window.L?.Map) {
    L.Map.addInitHook(function () {
      this.on("tileerror", (ev) => hideBadTile(ev && ev.tile));
    });
  }

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
    const esriAttr =
      "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA, TomTom, Garmin, FAO, NPS";
    const esriSatAttr =
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics";
    const esriSatUrl =
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    const sentinelUrl =
      "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";

    const defaultBasemaps = [
      {
        name: "Esri Light Gray",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        attribution: esriAttr,
        maxZoom: 16,
        default: true,
      },
      {
        name: "Esri Light Gray + rótulos",
        attribution: esriAttr,
        maxZoom: 16,
        stack: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        ],
      },
      {
        name: "Esri Topográfico",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        attribution: esriAttr,
        maxZoom: 19,
      },
      {
        name: "Esri Streets",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        attribution: esriAttr,
        maxZoom: 19,
      },
      {
        name: "OpenTopoMap",
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        attribution:
          osmAttr +
          ' &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
        maxZoom: 17,
        subdomains: "abc",
      },
      {
        name: "OpenStreetMap",
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: osmAttr,
        maxZoom: 19,
      },
      {
        name: "Satélite (Esri)",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attribution: esriSatAttr,
        maxZoom: 19,
      },
      {
        name: "Sentinel-2",
        url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
        attribution:
          "Sentinel-2 cloudless &copy; <a href=\"https://s2maps.eu\">EOX</a> / ESA",
        maxZoom: 14,
      },
      {
        name: "Google Earth",
        url: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        attribution: "&copy; Google",
        maxZoom: 16,
        subdomains: ["0", "1", "2", "3"],
      },
    ];

    // Mescla config (se houver) por cima, mas garante a lista completa acima
    const fromCfg = Array.isArray(cfg?.basemaps) ? cfg.basemaps : [];
    const byName = new Map();
    defaultBasemaps.forEach((bm) => byName.set(bm.name, bm));
    fromCfg.forEach((bm) => {
      if (!bm?.name) return;
      // Ignora basemaps CARTO (descontinuados / exigem API key)
      const id = String(bm.id || "").toLowerCase();
      const name = String(bm.name || "").toLowerCase();
      const url = String(bm.url || "").toLowerCase();
      if (
        id.includes("carto") ||
        name.includes("carto") ||
        url.includes("cartocdn.com")
      ) {
        return;
      }
      byName.set(bm.name, {
        name: bm.name,
        url: bm.url,
        stack: bm.stack,
        attribution: bm.attribution,
        maxZoom: bm.maxZoom,
        subdomains: bm.subdomains,
        default: !!bm.default,
      });
    });
    // Só um default ativo
    let basemapDefs = Array.from(byName.values());
    if (!basemapDefs.some((b) => b.default)) {
      const light = basemapDefs.find((b) => b.name === "Esri Light Gray");
      if (light) light.default = true;
      else if (basemapDefs[0]) basemapDefs[0].default = true;
    } else {
      let seen = false;
      basemapDefs = basemapDefs.map((b) => {
        if (!b.default) return b;
        if (seen) return { ...b, default: false };
        seen = true;
        return b;
      });
    }

    const SAT_ZOOM_CAP = 16;
    const isSatName = (name, url) =>
      /google|earth|sentinel|satél|satelit|s2cloudless|world_imagery/i.test(
        `${name || ""} ${url || ""}`
      );
    const basemapControlsLocal = {};
    basemapDefs.forEach((bm) => {
      let native = bm.maxZoom || 19;
      if (isSatName(bm.name, bm.url)) native = Math.min(native, SAT_ZOOM_CAP);
      const opts = {
        attribution: bm.attribution,
        maxZoom: native,
        maxNativeZoom: native,
        detectRetina: false,
        errorTileUrl: EMPTY_TILE,
      };
      if (bm.subdomains) opts.subdomains = bm.subdomains;
      let tile;
      const sentinelLike =
        /sentinel/i.test(String(bm.name || "")) ||
        /s2cloudless|eox\.at/i.test(String(bm.url || ""));
      if (sentinelLike) {
        tile = L.layerGroup([
          L.tileLayer(sentinelUrl, {
            ...opts,
            maxZoom: 14,
            maxNativeZoom: 14,
          }),
          L.tileLayer(esriSatUrl, {
            attribution: esriSatAttr,
            minZoom: 14,
            maxZoom: SAT_ZOOM_CAP,
            maxNativeZoom: SAT_ZOOM_CAP,
            detectRetina: false,
            errorTileUrl: EMPTY_TILE,
          }),
        ]);
      } else if (Array.isArray(bm.stack) && bm.stack.length) {
        tile = L.layerGroup(
          bm.stack.map((u) => L.tileLayer(u, { ...opts }))
        );
      } else if (bm.url) {
        tile = L.tileLayer(bm.url, opts);
      } else {
        return;
      }
      basemapControlsLocal[bm.name] = tile;
      if (bm.default) tile.addTo(map);
    });
    basemapControls = basemapControlsLocal;

    // Controle nativo do Leaflet fica escondido: o seletor do InfraGeo já troca o fundo.
    layerControl = L.control.layers(basemapControls, null, {
      position: "topright",
      collapsed: true,
    });

    map.on("tileerror", (ev) => silenceBrokenTile(ev && ev.tile));
    bindMapSatWait(map);
    bindZoomLimit(map);
    applyBasemapZoomCap();

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

  const BR_DASHED_STYLES = {
    "210": { color: "#2563eb", dashArray: "12 8" },
    "413": { color: "#e11d48", dashArray: "12 8" },
    "411": { color: "#7c3aed", dashArray: "12 8" },
  };

  function brDashStyle(meta) {
    const schema = String(meta?.schema || "").toUpperCase();
    const name = String(meta?.name || "").toUpperCase();
    const m =
      schema.match(/^BR_(\d{2,4})$/) ||
      schema.match(/BR[_\-\s]*(\d{2,4})/) ||
      name.match(/BR[_\-\s]*(\d{2,4})/);
    if (!m) return null;
    return BR_DASHED_STYLES[m[1]] || null;
  }

  function styleFor(meta) {
    const s = { ...(meta.style || {}) };
    const dashed = brDashStyle(meta);
    if (dashed && !s.userColor) {
      s.color = dashed.color;
      s.dashArray = dashed.dashArray;
      s.fillOpacity = 0;
      s.weight = s.weight ?? 3.5;
      s.opacity = s.opacity ?? 0.95;
    } else if (dashed && s.userColor) {
      s.dashArray = s.dashArray || dashed.dashArray;
      s.fillOpacity = s.fillOpacity ?? 0;
    }
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
    const out = {
      color: s.color || "#111827",
      fillColor: s.fillColor || s.color || "#111827",
      weight: s.weight ?? 2,
      opacity: s.opacity ?? 1,
      fillOpacity: s.fillOpacity ?? 0.2,
    };
    if (s.dashArray) out.dashArray = s.dashArray;
    if (s.dashOffset) out.dashOffset = s.dashOffset;
    return out;
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
    // Garante dashArray/cor após o parse (alguns ambientes ignoram no style inicial)
    try {
      group.setStyle({ ...style });
    } catch {
      /* ignore */
    }

    let brShield = null;
    if (window.InfraGeoBrShield && window.InfraGeoBrShield.isBrLayer(meta)) {
      brShield = window.InfraGeoBrShield.buildMarkers(group, meta);
    }

    overlayRegistry[meta.id] = {
      meta,
      leaflet: group,
      brShield,
      // GeoJSON original — exportação não depende de toGeoJSON() no mapa vivo
      geojson,
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

  /** Recolore uma camada visível (estilo + Leaflet). */
  function recolorLayer(id, color) {
    const entry = overlayRegistry[id];
    if (!entry?.meta) return false;
    const hex = String(color || "").trim();
    if (!/^#[0-9a-fA-F]{3,8}$/.test(hex)) return false;
    entry.meta.style = {
      ...(entry.meta.style || {}),
      color: hex,
      fillColor: hex,
      userColor: true,
    };
    const style = styleFor(entry.meta);
    style.color = hex;
    style.fillColor = hex;
    try {
      entry.leaflet?.setStyle?.(style);
      entry.leaflet?.eachLayer?.((lyr) => {
        try {
          if (lyr.setStyle) lyr.setStyle(style);
          if (typeof lyr.setRadius === "function" && style.radius) {
            lyr.setRadius(style.radius);
            lyr.setStyle?.(style);
          }
        } catch {
          /* ignore */
        }
      });
    } catch (err) {
      console.warn("recolorLayer", id, err);
    }
    return true;
  }

  function getBasemapNames() {
    return Object.keys(basemapControls || {});
  }

  function getActiveBasemapName() {
    if (!map || !basemapControls) return null;
    return (
      Object.keys(basemapControls).find((n) => {
        try {
          return map.hasLayer(basemapControls[n]);
        } catch {
          return false;
        }
      }) || null
    );
  }

  function stripBasemapTiles(keep) {
    if (!map) return;
    const keepSet = new Set();
    const collect = (lyr) => {
      if (!lyr) return;
      keepSet.add(lyr);
      if (typeof lyr.eachLayer === "function") lyr.eachLayer(collect);
    };
    collect(keep);
    const dump = [];
    map.eachLayer((lyr) => {
      if (
        (lyr instanceof L.TileLayer || lyr instanceof L.GridLayer) &&
        !keepSet.has(lyr)
      ) {
        dump.push(lyr);
      }
    });
    dump.forEach((lyr) => {
      try {
        map.removeLayer(lyr);
      } catch {
        /* ignore */
      }
    });
  }

  function setBasemapByName(name) {
    if (!map || !basemapControls) return;
    const layer = basemapControls[name];
    if (!layer) return;
    Object.values(basemapControls).forEach((t) => {
      try {
        if (t !== layer && map.hasLayer(t)) map.removeLayer(t);
      } catch {
        /* ignore */
      }
    });
    stripBasemapTiles(layer);
    if (!map.hasLayer(layer)) layer.addTo(map);
    applyBasemapZoomCap();
  }

  function setBasemapPreset(preset) {
    if (!map || !basemapControls) return;
    const names = {
      map: ["Esri Light Gray", "OpenStreetMap"],
      satellite: ["Google Earth", "Satélite (Esri)"],
      terrain: ["Esri Topográfico", "OpenTopoMap"],
    };
    const wanted = names[preset] || names.map;
    let layer = null;
    wanted.forEach((n) => {
      if (!layer && basemapControls[n]) layer = basemapControls[n];
    });
    if (!layer) layer = Object.values(basemapControls)[0];
    Object.values(basemapControls).forEach((t) => {
      try {
        if (t !== layer && map.hasLayer(t)) map.removeLayer(t);
      } catch {
        /* ignore */
      }
    });
    stripBasemapTiles(layer);
    if (layer && !map.hasLayer(layer)) layer.addTo(map);
    applyBasemapZoomCap();
  }

  function zoomBy(delta) {
    if (!map) return;
    const max = map.getMaxZoom();
    const z = map.getZoom();
    if (delta > 0 && z >= max - 0.05) {
      notifyZoomLimit(true);
      return;
    }
    const next = z + delta;
    if (next > max) {
      map.setZoom(max);
      notifyZoomLimit(true);
      return;
    }
    map.setZoom(next);
  }

  function locateUser() {
    if (!map) return;
    map.locate({ setView: true, maxZoom: 12 });
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
    recolorLayer,
    setAllLayersVisible,
    clearAllOverlays,
    styleFor,
    overlayRegistry,
    setBasemapPreset,
    setBasemapByName,
    getBasemapNames,
    getActiveBasemapName,
    zoomBy,
    notifyZoomLimit,
    locateUser,
    getLayerControl: () => layerControl,
  };
})();
