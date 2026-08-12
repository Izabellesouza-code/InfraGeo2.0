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
  ]);

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

  function updateStackNav() {
    const box = ensureEl();
    const nav = box.querySelector(".feature-hover-popup__stack");
    const label = box.querySelector(".feature-hover-popup__stack-label");
    if (!nav || !label) return;
    const n = hitStack.length;
    if (n <= 1) {
      nav.hidden = true;
      return;
    }
    nav.hidden = false;
    label.textContent = `${hitIndex + 1} / ${n}`;
  }

  function showCurrentHit(e, opts) {
    const hit = hitStack[hitIndex];
    if (!hit) return;
    unhighlight();
    highlight(hit.layer);
    show(hit.feature, hit.layer, hit.meta, e, opts);
    updateStackNav();
    lastSelection = {
      feature: hit.feature,
      meta: hit.meta,
      layerId: hit.meta?.id || null,
    };
    if (opts?.zoom) zoomToFeature(hit.feature, hit.layer);
  }

  function openStack(hits, index, e, opts) {
    if (!hits?.length) return;
    // Não sobrescreve enquanto o usuário usa o popup (exceto clique forçado)
    if (!opts?.force && (popupFrozen || el?.matches?.(":hover"))) return;

    const key = hitsKey(hits);
    const visible = !!el?.classList.contains("is-visible");
    if (!opts?.force && key === hitStackKey && visible) return;

    hitStack = hits;
    hitIndex = Math.max(0, Math.min(index || 0, hits.length - 1));
    hitStackKey = key;
    pinned = true;
    showCurrentHit(e, opts);
  }

  function cycleStack(delta, e) {
    if (hitStack.length <= 1) return;
    hitIndex = (hitIndex + delta + hitStack.length) % hitStack.length;
    showCurrentHit(e || null, { zoom: false });
  }

  function normKey(k) {
    return String(k || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function formatValue(v) {
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function titleFromMeta(meta) {
    const schema = String(meta?.schema || "").toUpperCase();
    const name = String(meta?.name || "").toUpperCase();

    const br = schema.match(/(?:^|_)(?:BR[_-]?)?(\d{3})(?:_|$)/) || name.match(/BR[-\s]?(\d{3})/);
    const brLabel = br ? `BR-${br[1]}` : "";

    let kind = "";
    if (/BUEIRO/.test(schema) || /BUEIRO/.test(name)) kind = "BUEIROS";
    else if (/PONTE/.test(schema) || /PONTE/.test(name)) kind = "PONTES";
    else if (/JAZIDA/.test(schema) || /JAZIDA/.test(name)) kind = "JAZIDAS";
    else if (/PCA_PRAD_CMM|PCA\/PRAD CMM/.test(schema + name)) kind = "PCA — PRADS CMM";
    else if (/PCA_PRAD|PCA\/PRAD/.test(schema + name)) kind = "PCA — PRADS";
    else if (/PRAD/.test(schema) || /PRAD/.test(name)) kind = "PRADS";
    else if (/^IP4/.test(schema) || /\bIP4\b/.test(name)) kind = "IP4";
    else if (/UC_ESTADUAL/.test(schema)) kind = "UC ESTADUAL";
    else if (/UC_MUNICIPAL/.test(schema)) kind = "UC MUNICIPAL";
    else if (/UC_FEDERAL/.test(schema)) kind = "UC FEDERAL";
    else if (/^TI_/.test(schema) || /TERRAS IND/.test(name)) kind = "TI AM";
    else if (/LIMITE_MUNICIPAL/.test(schema) || /MUNICIPAL/.test(name)) kind = "MUNICÍPIOS";
    else if (/LIMITE_ESTADUAL/.test(schema)) kind = "LIMITE ESTADUAL";
    else if (/^BR_/.test(schema)) kind = brLabel || "BR-AM";
    else if (/BALSA/.test(schema) || /BALSA/.test(name)) kind = "BALSA";
    else kind = (meta?.name || "CAMADA").toUpperCase();

    if (brLabel && kind !== brLabel && !kind.includes(brLabel)) {
      return `${kind} — ${brLabel}`;
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
      used.add(normKey(key));
      picked.push({ label: String(key), value: formatValue(value) });
    };

    // Lat/lng só se não existirem nas propriedades
    const latlng = getLatLng(feature, layer);
    const hasLat = byNorm.has("latitude") || byNorm.has("lat");
    const hasLon =
      byNorm.has("longitude") || byNorm.has("lng") || byNorm.has("lon") || byNorm.has("long");
    if (latlng && !hasLat) push("LATITUDE", String(latlng.lat));
    if (latlng && !hasLon) push("LONGITUDE", String(latlng.lng));

    for (const [k, v] of entries) {
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
        <div class="feature-hover-popup__title"></div>
        <div class="feature-hover-popup__subtitle"></div>
        <div class="feature-hover-popup__stack" hidden>
          <button type="button" class="feature-hover-popup__stack-btn" data-stack="-1" aria-label="Feição anterior">‹</button>
          <span class="feature-hover-popup__stack-label">1 / 1</span>
          <button type="button" class="feature-hover-popup__stack-btn" data-stack="1" aria-label="Próxima feição">›</button>
        </div>
      </div>
      <div class="feature-hover-popup__body"></div>
      <div class="feature-hover-popup__foot">
        <span class="feature-hover-popup__brand">InfraGeo AM</span>
        <button type="button" class="feature-hover-popup__table-btn" data-action="attr-table">
          Tabela
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
    el.querySelectorAll(".feature-hover-popup__stack-btn").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        popupFrozen = true;
        const delta = Number(btn.dataset.stack) || 0;
        cycleStack(delta, null);
      });
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

  function dockPanel() {
    const box = ensureEl();
    // Posição vem do CSS (canto inferior direito / full-width no mobile)
    box.style.left = "";
    box.style.top = "";
    box.style.right = "";
    box.style.bottom = "";
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
        };
        const next = {
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
    const title = titleFromMeta(meta);
    const subtitle = primaryName(props);
    let rows = pickRows(props, feature, layer);

    if (subtitle) {
      const sn = normKey(subtitle);
      rows = rows.filter((r) => normKey(r.value) !== sn);
    }

    box.dataset.layerId = meta?.id || "";
    popupContext = { feature, meta, layer };
    box.querySelector(".feature-hover-popup__title").textContent = title;
    const subEl = box.querySelector(".feature-hover-popup__subtitle");
    subEl.textContent = subtitle;
    subEl.hidden = !subtitle;

    box.querySelector(".feature-hover-popup__body").innerHTML = rows
      .map(
        (r) => `<div class="feature-hover-popup__row">
          <div class="feature-hover-popup__row-label">${esc(r.label)}</div>
          <div class="feature-hover-popup__row-value">${esc(r.value)}</div>
        </div>`
      )
      .join("");

    box.classList.add("is-visible");
    box.setAttribute("aria-hidden", "false");
    dockPanel();
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
        updateStackNav();
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
        updateStackNav();
        popupFrozen = true;
      }
    });
  }

  function init() {
    ensureEl();
    dockPanel();
    window.addEventListener("resize", () => {
      if (el?.classList.contains("is-visible")) dockPanel();
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        pinned = false;
        hide(true);
        return;
      }
      if (!el?.classList.contains("is-visible")) return;
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        popupFrozen = true;
        cycleStack(-1, null);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        popupFrozen = true;
        cycleStack(1, null);
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
