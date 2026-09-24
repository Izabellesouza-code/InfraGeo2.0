/**
 * Painel de atributos das feições (estilo InfraGeo AM).
 * Abre no hover/clique; fica ancorado no canto (não segue o cursor).
 */
window.InfraGeoHoverPopup = (function () {
  "use strict";

  const HIDE_DELAY_MS = 140;

  const SKIP_KEYS = new Set([
    "geometry",
    "geom",
    "fid",
    "gid",
    "ogc_fid",
    "objectid",
    "objectid_1",
    "shape_leng",
    "shape_length",
    "shape_area",
    "globalid",
  ]);

  const LABEL_MAP = {
    nome: "Nome",
    name: "Nome",
    nm_municipio: "Município",
    nm_mun: "Município",
    mun_dash: "Município",
    municipio: "Município",
    km: "Quilômetro (km)",
    lat: "Latitude",
    latitude: "Latitude",
    long: "Longitude",
    lon: "Longitude",
    lng: "Longitude",
    longitude: "Longitude",
    lat_final: "Latitude final",
    lon_final: "Longitude final",
    snv: "Código SNV",
    tipo: "Tipo",
    lote: "Lote",
    pista: "Pista",
    condi_e: "Condição",
    condicao: "Condição",
    largura: "Largura",
    extens_o: "Extensão",
    extensao: "Extensão",
    contrato: "Contrato",
    zona: "Zona",
    br_uf: "Rodovia / UF",
    codigo: "Código",
    vl_codigo: "Código",
    terrai_nom: "Terra indígena",
  };

  const PRIMARY_KEYS = [
    "name",
    "nome",
    "NOME",
    "Name",
    "nm_municipio",
    "NM_MUNICIPIO",
    "NM_MUN",
    "nm_mun",
    "mun_dash",
    "MUN_DASH",
    "municipio",
    "vl_codigo",
    "codigo",
    "CODIGO",
    "terrai_nom",
    "Nome",
    "NOME_PCA",
    "id",
    "ID",
  ];

  let el = null;
  let hideTimer = null;
  let pinned = false;
  let activeLayer = null;
  let activeStyleBackup = null;
  /** Última feição clicada no mapa (para exportação). */
  let lastSelection = null;
  /** Contexto do popup aberto (hover/clique). */
  let popupContext = null;
  /** Pilha de feições sob o cursor (várias camadas no mesmo ponto). */
  let hitStack = [];
  let hitIndex = 0;
  let hitStackKey = "";
  let moveThrottle = null;
  /** True enquanto o mouse está no popup (permite clicar nas opções). */
  let popupFrozen = false;

  function getSelection() {
    return lastSelection
      ? {
          feature: lastSelection.feature,
          meta: lastSelection.meta,
          layerId: lastSelection.layerId,
        }
      : null;
  }

  function clearSelection() {
    lastSelection = null;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonCoords(lng, lat, coords) {
    if (!coords?.length) return false;
    if (!pointInRing(lng, lat, coords[0])) return false;
    for (let h = 1; h < coords.length; h++) {
      if (pointInRing(lng, lat, coords[h])) return false;
    }
    return true;
  }

  function distPointToSegPx(map, latlng, a, b) {
    const p = map.latLngToLayerPoint(latlng);
    const p0 = map.latLngToLayerPoint(L.latLng(a[1], a[0]));
    const p1 = map.latLngToLayerPoint(L.latLng(b[1], b[0]));
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    if (dx === 0 && dy === 0) return p.distanceTo(p0);
    let t = ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    const proj = L.point(p0.x + t * dx, p0.y + t * dy);
    return p.distanceTo(proj);
  }

  function featureHitsLatLng(feature, latlng, map, pxTol) {
    const g = feature?.geometry;
    if (!g) return false;
    const lng = latlng.lng;
    const lat = latlng.lat;
    const type = g.type;

    if (type === "Polygon") return pointInPolygonCoords(lng, lat, g.coordinates);
    if (type === "MultiPolygon") {
      return (g.coordinates || []).some((poly) =>
        pointInPolygonCoords(lng, lat, poly)
      );
    }
    if (type === "Point") {
      const c = g.coordinates;
      if (!c) return false;
      const p1 = map.latLngToLayerPoint(latlng);
      const p2 = map.latLngToLayerPoint(L.latLng(c[1], c[0]));
      return p1.distanceTo(p2) <= pxTol;
    }
    if (type === "MultiPoint") {
      return (g.coordinates || []).some((c) => {
        const p1 = map.latLngToLayerPoint(latlng);
        const p2 = map.latLngToLayerPoint(L.latLng(c[1], c[0]));
        return p1.distanceTo(p2) <= pxTol;
      });
    }
    if (type === "LineString") {
      const coords = g.coordinates || [];
      for (let i = 0; i < coords.length - 1; i++) {
        if (distPointToSegPx(map, latlng, coords[i], coords[i + 1]) <= pxTol) {
          return true;
        }
      }
      return false;
    }
    if (type === "MultiLineString") {
      return (g.coordinates || []).some((line) => {
        for (let i = 0; i < line.length - 1; i++) {
          if (distPointToSegPx(map, latlng, line[i], line[i + 1]) <= pxTol) {
            return true;
          }
        }
        return false;
      });
    }
    return false;
  }

  function approxFeatureArea(feature) {
    try {
      const b = L.geoJSON(feature).getBounds();
      if (!b?.isValid?.()) return Number.POSITIVE_INFINITY;
      return Math.abs(
        (b.getEast() - b.getWest()) * (b.getNorth() - b.getSouth())
      );
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function hitsKey(hits) {
    return hits
      .map((h) => {
        const id =
          h.feature?.id ??
          h.feature?.properties?.ID ??
          h.feature?.properties?.id ??
          "";
        return `${h.meta?.id || ""}:${id}`;
      })
      .join("|");
  }

  /** Todas as feições visíveis sob o ponto (várias camadas). */
  function collectHitsAt(latlng, map) {
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    const hits = [];
    const pxTol = 12;

    Object.values(registry).forEach((entry) => {
      if (!entry?.visible || !entry.leaflet || !entry.meta) return;
      const schema = String(entry.meta.schema || "").toUpperCase();
      // Limites estadual/municipal: só referência visual — sem identify/popup
      if (schema.startsWith("LIMITE_ESTADUAL") || schema.startsWith("LIMITE_MUNICIPAL")) {
        return;
      }

      entry.leaflet.eachLayer((lyr) => {
        const feature = lyr.feature;
        if (!feature) return;
        try {
          const lb = lyr.getBounds?.();
          if (lb?.isValid?.() && !lb.pad(0.001).contains(latlng)) {
            const t = feature.geometry?.type || "";
            if (t === "Polygon" || t === "MultiPolygon") return;
          }
        } catch {
          /* ignore */
        }
        if (!featureHitsLatLng(feature, latlng, map, pxTol)) return;
        hits.push({
          feature,
          layer: lyr,
          meta: entry.meta,
          area: approxFeatureArea(feature),
        });
      });
    });

    hits.sort((a, b) => a.area - b.area);
    return hits;
  }

  function showCurrentHit(e, opts) {
    const hit = hitStack[0];
    if (!hit) return;
    unhighlight();
    highlight(hit.layer);
    show(hit.feature, hit.layer, hit.meta, e, opts);
    lastSelection = {
      feature: hit.feature,
      meta: hit.meta,
      layerId: hit.meta?.id || null,
    };
    if (opts?.zoom) zoomToFeature(hit.feature, hit.layer);
  }

  function openStack(hits, index, e, opts) {
    if (!hits?.length) return;
    if (!opts?.force && (popupFrozen || el?.matches?.(":hover"))) return;

    const key = hitsKey(hits.slice(0, 1));
    const visible = !!el?.classList.contains("is-visible");
    if (!opts?.force && key === hitStackKey && visible) return;

    hitStack = hits.slice(0, 1);
    hitIndex = 0;
    hitStackKey = key;
    pinned = true;
    showCurrentHit(e, opts);
  }

  function normKey(k) {
    return String(k || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function prettyText(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    if (s === s.toUpperCase() && /[A-ZÁÉÍÓÚÃÕÇ]/.test(s) && s.length > 3) {
      return s
        .toLowerCase()
        .replace(/(^|[\s\-_/])([\p{L}])/gu, (_, a, b) => a + b.toUpperCase());
    }
    return s;
  }

  function formatValue(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number" && Number.isFinite(v)) {
      if (Math.abs(v) < 1e-9) return "";
      return String(v).replace(".", ",");
    }
    const s = String(v).trim();
    if (!s || s === "0" || s === "0.0" || s.toLowerCase() === "null" || s === "-") return "";
    return prettyText(s);
  }

  function friendlyLabel(key) {
    const nk = normKey(key);
    if (LABEL_MAP[nk]) return LABEL_MAP[nk];
    const raw = String(key || "").replace(/[_]+/g, " ").trim();
    if (!raw) return "Dado";
    return prettyText(raw) || raw;
  }

  function titleFromMeta(meta) {
    const schema = String(meta?.schema || "").toUpperCase();
    const name = String(meta?.name || "").toUpperCase();

    const br = schema.match(/(?:^|_)(?:BR[_-]?)?(\d{3})(?:_|$)/) || name.match(/BR[-\s]?(\d{3})/);
    const brLabel = br ? `BR-${br[1]}` : "";

    let kind = "";
    if (/BUEIRO/.test(schema) || /BUEIRO/.test(name)) kind = "Bueiro";
    else if (/PONTE/.test(schema) || /PONTE/.test(name)) kind = "Ponte";
    else if (/JAZIDA/.test(schema) || /JAZIDA/.test(name)) kind = "Jazida";
    else if (/PCA_PRAD_CMM|PCA\/PRAD CMM/.test(schema + name)) kind = "PCA / PRAD CMM";
    else if (/PCA_PRAD|PCA\/PRAD/.test(schema + name)) kind = "PCA / PRAD";
    else if (/PRAD/.test(schema) || /PRAD/.test(name)) kind = "PRAD";
    else if (/^IP4/.test(schema) || /\bIP4\b/.test(name)) kind = "IP4";
    else if (/UC_ESTADUAL/.test(schema)) kind = "Unidade de conservação estadual";
    else if (/UC_MUNICIPAL/.test(schema)) kind = "Unidade de conservação municipal";
    else if (/UC_FEDERAL/.test(schema)) kind = "Unidade de conservação federal";
    else if (/^TI_/.test(schema) || /TERRAS IND/.test(name)) kind = "Terra indígena";
    else if (/LIMITE_MUNICIPAL/.test(schema) || /MUNICIPAL/.test(name)) kind = "Município";
    else if (/LIMITE_ESTADUAL/.test(schema)) kind = "Limite estadual";
    else if (/BALSA/.test(schema) || /BALSA/.test(name)) kind = "Balsa";
    else if (/USINA/.test(schema) || /USINA/.test(name)) kind = "Usina";
    else if (/CANTEIRO/.test(schema) || /CANTEIRO/.test(name)) kind = "Canteiro";
    else kind = prettyText(meta?.name || "Camada") || "Camada";

    if (brLabel && !kind.includes(brLabel)) {
      return `${kind} na ${brLabel}`;
    }
    return kind;
  }

  function getLatLng(feature, layer) {
    try {
      if (layer?.getLatLng) return layer.getLatLng();
      const g = feature?.geometry;
      if (g?.type === "Point" && Array.isArray(g.coordinates)) {
        return L.latLng(g.coordinates[1], g.coordinates[0]);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function pickRows(props, feature, layer) {
    const entries = Object.entries(props || {}).filter(([k]) => {
      if (SKIP_KEYS.has(String(k).toLowerCase())) return false;
      return true;
    });

    const byNorm = new Map(entries.map((e) => [normKey(e[0]), e]));
    const picked = [];
    const used = new Set();

    const push = (key, value) => {
      if (used.has(normKey(key))) return;
      const formatted = formatValue(value);
      if (!formatted) return;
      used.add(normKey(key));
      picked.push({ label: friendlyLabel(key), value: formatted });
    };

    const latlng = getLatLng(feature, layer);
    const hasLat = byNorm.has("latitude") || byNorm.has("lat");
    const hasLon =
      byNorm.has("longitude") || byNorm.has("lng") || byNorm.has("lon") || byNorm.has("long");
    if (latlng && !hasLat) push("latitude", latlng.lat.toFixed(5));
    if (latlng && !hasLon) push("longitude", latlng.lng.toFixed(5));

    for (const [k, v] of entries) {
      if (SKIP_KEYS.has(normKey(k))) continue;
      push(k, v);
    }
    return picked;
  }

  function primaryName(props) {
    for (const k of PRIMARY_KEYS) {
      const v = props?.[k];
      const fv = formatValue(v);
      if (fv) return fv;
    }
    for (const [k, v] of Object.entries(props || {})) {
      if (SKIP_KEYS.has(String(k).toLowerCase())) continue;
      const fv = formatValue(v);
      if (fv) return fv;
    }
    return "";
  }

  function ensureEl() {
    if (el) return el;
    el = document.createElement("aside");
    el.id = "feature-hover-popup";
    el.className = "feature-hover-popup";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `
      <button type="button" class="feature-hover-popup__close" aria-label="Fechar">×</button>
      <div class="feature-hover-popup__head">
        <span class="feature-hover-popup__dot" aria-hidden="true"></span>
        <div class="feature-hover-popup__title"></div>
      </div>
      <p class="feature-hover-popup__hint">Dados principais deste ponto</p>
      <div class="feature-hover-popup__body"></div>
      <div class="feature-hover-popup__foot">
        <button type="button" class="feature-hover-popup__table-btn" data-action="attr-table">
          Ver todos os dados
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector(".feature-hover-popup__close").addEventListener("click", (ev) => {
      ev.stopPropagation();
      pinned = false;
      hide(true);
    });
    el.querySelector(".feature-hover-popup__table-btn").addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const layerId = popupContext?.meta?.id || el.dataset.layerId;
      const feature = popupContext?.feature || null;
      if (!layerId || !window.InfraGeoAttrTable?.openForLayer) return;
      pinned = false;
      hide(true);
      try {
        await window.InfraGeoAttrTable.openForLayer(layerId, { feature });
      } catch (err) {
        console.warn("abrir tabela", err);
      }
    });
    el.addEventListener("mouseenter", () => {
      popupFrozen = true;
      cancelHide();
    });
    el.addEventListener("mouseleave", () => {
      // Mantém congelado um instante para o clique nas setas não “perder” o alvo
      setTimeout(() => {
        if (el && !el.matches(":hover")) popupFrozen = false;
      }, 200);
    });
    el.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      popupFrozen = true;
    });
    el.addEventListener("click", (ev) => ev.stopPropagation());
    return el;
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide() {
    // Popup fica fixo — não fecha ao sair do hover
    cancelHide();
  }

  function layerAccent(meta, layer) {
    return (
      layer?.options?.fillColor ||
      layer?.options?.color ||
      meta?.style?.fillColor ||
      meta?.style?.color ||
      "#f59e0b"
    );
  }

  function placeNearEvent(box, e) {
    const src = e?.originalEvent;
    let x = src?.clientX;
    let y = src?.clientY;
    if ((x == null || y == null) && e?.containerPoint) {
      const map = window.InfraGeoMap?.getMap?.();
      const rect = map?.getContainer?.()?.getBoundingClientRect?.();
      if (rect) {
        x = rect.left + e.containerPoint.x;
        y = rect.top + e.containerPoint.y;
      }
    }
    if (x == null || y == null) return;
    const w = box.offsetWidth || 260;
    const h = box.offsetHeight || 150;
    let left = x - w / 2;
    let top = y - h - 18;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top < 8) top = y + 18;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.right = "auto";
    box.style.bottom = "auto";
  }

  function dockPanel() {
    /* posição definida em placeNearEvent */
  }

  function highlight(layer) {
    activeLayer = layer;
    if (!layer) return;
    try {
      if (layer.setStyle && layer.options && !layer.getLayers) {
        activeStyleBackup = {
          weight: layer.options.weight,
          opacity: layer.options.opacity,
          fillOpacity: layer.options.fillOpacity,
          radius: layer.options.radius,
          color: layer.options.color,
          fillColor: layer.options.fillColor,
        };
        const next = {
          color: "#0A2E2C",
          fillColor: "#0A2E2C",
          weight: (layer.options.weight || 2) + 1.5,
          opacity: 1,
          fillOpacity: Math.min(1, (layer.options.fillOpacity ?? 0.5) + 0.25),
        };
        if (typeof layer.setRadius === "function") {
          layer.setRadius((layer.options.radius || 7) + 2);
        }
        layer.setStyle(next);
        layer.bringToFront?.();
      }
    } catch {
      /* ignore */
    }
  }

  function unhighlight() {
    if (!activeLayer) return;
    try {
      if (activeStyleBackup && activeLayer.setStyle) {
        activeLayer.setStyle(activeStyleBackup);
        if (typeof activeLayer.setRadius === "function" && activeStyleBackup.radius != null) {
          activeLayer.setRadius(activeStyleBackup.radius);
        }
      }
    } catch {
      /* ignore */
    }
    activeLayer = null;
    activeStyleBackup = null;
  }

  function show(feature, layer, meta, e, opts) {
    cancelHide();
    const box = ensureEl();
    const props = feature?.properties || {};
    const layerTitle = titleFromMeta(meta);
    const featureName = prettyText(primaryName(props));
    let rows = pickRows(props, feature, layer);

    if (featureName) {
      const sn = normKey(featureName);
      rows = rows.filter((r) => normKey(r.value) !== sn && normKey(r.label) !== "nome");
    }

    box.dataset.layerId = meta?.id || "";
    popupContext = { feature, meta, layer };
    box.querySelector(".feature-hover-popup__title").textContent =
      featureName || layerTitle || "Ponto no mapa";
    const hint = box.querySelector(".feature-hover-popup__hint");
    if (hint) {
      hint.textContent = featureName && layerTitle
        ? layerTitle
        : "Dados principais deste ponto";
    }
    const dot = box.querySelector(".feature-hover-popup__dot");
    if (dot) dot.style.background = layerAccent(meta, layer);

    const merged = rows.slice(0, 5);
    const body = box.querySelector(".feature-hover-popup__body");
    body.innerHTML = merged.length
      ? merged
          .map(
            (r) => `<div class="feature-hover-popup__row">
          <div class="feature-hover-popup__row-label">${esc(r.label)}</div>
          <div class="feature-hover-popup__row-value">${esc(r.value)}</div>
        </div>`
          )
          .join("")
      : `<p class="feature-hover-popup__empty">Não há detalhes extras neste ponto. Abra a tabela para ver a camada completa.</p>`;

    box.classList.add("is-visible");
    box.setAttribute("aria-hidden", "false");
    placeNearEvent(box, e);
  }

  function hide(force) {
    if (pinned && !force) return;
    cancelHide();
    unhighlight();
    popupFrozen = false;
    hitStack = [];
    hitIndex = 0;
    hitStackKey = "";
    if (!el) return;
    el.classList.remove("is-visible");
    el.setAttribute("aria-hidden", "true");
  }

  function zoomToFeature(feature, layer) {
    const map = window.InfraGeoMap?.getMap?.();
    if (!map || !layer) return;

    const targetZoom = Math.max(map.getZoom(), 15);

    try {
      // CircleMarker.getBounds() depende do zoom atual e costuma AFASTAR o mapa.
      // Pontos sempre usam setView no lat/lng.
      const geomType = String(feature?.geometry?.type || "");
      const isPointLayer =
        layer instanceof L.CircleMarker ||
        layer instanceof L.Marker ||
        geomType === "Point" ||
        geomType === "MultiPoint";

      if (isPointLayer) {
        let ll = null;
        if (typeof layer.getLatLng === "function") {
          ll = layer.getLatLng();
        } else if (geomType === "Point" && feature.geometry.coordinates) {
          const c = feature.geometry.coordinates;
          ll = L.latLng(c[1], c[0]);
        } else if (geomType === "MultiPoint" && feature.geometry.coordinates?.[0]) {
          const c = feature.geometry.coordinates[0];
          ll = L.latLng(c[1], c[0]);
        }
        if (ll) {
          map.setView(ll, targetZoom, { animate: true });
          return;
        }
      }

      let b = null;
      if (typeof layer.getBounds === "function") {
        b = layer.getBounds();
      }
      if (!b?.isValid?.()) {
        b = L.geoJSON(feature).getBounds?.();
      }
      if (b?.isValid?.()) {
        map.fitBounds(b, {
          padding: [28, 28],
          maxZoom: 16,
          animate: true,
        });
      }
    } catch (err) {
      console.warn("zoomToFeature", err);
    }
  }

  function bindFeature(feature, layer, meta) {
    if (!layer || layer.__igHoverBound) return;

    const schema = String(meta?.schema || "").toUpperCase();
    // Limites estadual/municipal: só contexto visual — sem popup/zoom/seleção
    if (schema.startsWith("LIMITE_ESTADUAL") || schema.startsWith("LIMITE_MUNICIPAL")) {
      layer.__igHoverBound = true;
      try {
        layer.options.interactive = false;
        if (typeof layer.setStyle === "function") {
          layer.setStyle({ interactive: false });
        }
      } catch {
        /* ignore */
      }
      return;
    }

    layer.__igHoverBound = true;

    // Facilita hover em traçados finos
    if (layer.options && typeof layer.setStyle === "function" && !layer.getLayers) {
      try {
        layer.options.tolerance = layer.options.tolerance ?? 8;
      } catch {
        /* ignore */
      }
    }

    // Cursor de seleção nas feições
    try {
      const el = layer.getElement?.() || layer._path || layer._renderer?._container;
      if (layer.on) {
        layer.on("add", () => {
          const node = layer.getElement?.() || layer._path;
          if (node?.style) node.style.cursor = "pointer";
        });
      }
      if (el?.style) el.style.cursor = "pointer";
    } catch {
      /* ignore */
    }

    layer.on("mouseover", (e) => {
      if (popupFrozen || el?.matches?.(":hover")) return;
      L.DomEvent.stopPropagation(e);
      cancelHide();
      const map = window.InfraGeoMap?.getMap?.();
      const hits = map ? collectHitsAt(e.latlng, map) : [];
      if (hits.length) {
        openStack(hits, 0, e, { zoom: false });
      } else {
        pinned = true;
        unhighlight();
        highlight(layer);
        show(feature, layer, meta, e);
      }
      const node = layer.getElement?.() || layer._path;
      if (node?.style) node.style.cursor = "pointer";
    });

    layer.on("mouseout", () => {
      // Mantém aberto; só fecha com clique fora / × / Esc
    });

    layer.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      const map = window.InfraGeoMap?.getMap?.();
      const hits = map ? collectHitsAt(e.latlng, map) : [];
      if (hits.length) {
        openStack(hits, 0, e, { zoom: true, force: true });
        popupFrozen = true;
      } else {
        pinned = true;
        unhighlight();
        highlight(layer);
        show(feature, layer, meta, e);
        lastSelection = {
          feature,
          meta,
          layerId: meta?.id || null,
        };
        zoomToFeature(feature, layer);
        popupFrozen = true;
      }
    });
  }

  function init() {
    ensureEl();
    window.addEventListener("resize", () => {
      /* popup permanece onde o cursor abriu */
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        pinned = false;
        hide(true);
      }
    });

    document.addEventListener(
      "click",
      (ev) => {
        if (!el?.classList.contains("is-visible")) return;
        if (el.contains(ev.target)) return;
        const mapEl = window.InfraGeoMap?.getMap?.()?.getContainer?.();
        if (mapEl?.contains(ev.target)) return;
        pinned = false;
        hide(true);
      },
      true
    );

    const bindMap = () => {
      const map = window.InfraGeoMap?.getMap?.();
      if (!map || map.__igHoverIdentifyBound) return;
      map.__igHoverIdentifyBound = true;

      map.on("mousemove", (e) => {
        if (popupFrozen || el?.matches?.(":hover")) return;
        if (moveThrottle) return;
        moveThrottle = setTimeout(() => {
          moveThrottle = null;
          if (popupFrozen || el?.matches?.(":hover")) return;
          const hits = collectHitsAt(e.latlng, map);
          if (!hits.length) return;
          const key = hitsKey(hits);
          if (key === hitStackKey && el?.classList.contains("is-visible")) return;
          openStack(hits, 0, e, { zoom: false });
        }, 80);
      });

      map.on("click", (e) => {
        if (el?.contains?.(e.originalEvent?.target)) return;
        const hits = collectHitsAt(e.latlng, map);
        if (!hits.length) {
          pinned = false;
          hide(true);
          return;
        }
        openStack(hits, 0, e, { zoom: true, force: true });
        popupFrozen = true;
      });
    };

    bindMap();
    setTimeout(bindMap, 400);
    setTimeout(bindMap, 1200);
  }

  return { init, bindFeature, hide, show, getSelection, clearSelection };
})();
