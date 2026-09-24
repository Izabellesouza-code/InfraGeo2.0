/**
 * Modo Layout — editor de página (substitui o fluxo principal de Exportar).
 */
window.InfraGeoLayoutMode = (function () {
  "use strict";

  const PAGE_PRESETS = {
    "a4-landscape": { wMm: 297, hMm: 210, label: "A4 Paisagem" },
    "a4-portrait": { wMm: 210, hMm: 297, label: "A4 Retrato" },
    "a3-landscape": { wMm: 420, hMm: 297, label: "A3 Paisagem" },
    "letter-landscape": { wMm: 279.4, hMm: 215.9, label: "Carta Paisagem" },
    "wide-16x9": { wMm: 338.7, hMm: 190.5, label: "16∶9" },
    "square-1x1": { wMm: 210, hMm: 210, label: "1∶1" },
  };

  const TYPE_LABELS = {
    map: "Mapa",
    title: "Título",
    subtitle: "Subtítulo",
    text: "Texto",
    legend: "Legenda",
    north: "Norte",
    scale: "Escala",
    image: "Imagem",
    line: "Linha",
    rect: "Retângulo",
    ellipse: "Elipse",
    triangle: "Triângulo",
    arrow: "Seta",
  };

  const ROLE_LABELS = {
    "accent-rail": "Acento",
    "header-band": "Cabeçalho",
    "header-rule": "Filete",
    "brand": "Marca",
    "brand-meta": "Meta",
    "hero-title": "Título",
    "hero-sub": "Subtítulo",
    "hero-map": "Mapa",
    "side-panel": "Painel",
    "side-legend": "Legenda",
    "side-north": "Norte",
    "side-scale": "Escala",
    "map-scale": "Escala no mapa",
    "footer-band": "Rodapé",
    "footer-rule": "Filete rodapé",
    "footer-credit": "Créditos",
    "footer-meta": "Rodapé meta",
  };

  function itemListLabel(it) {
    if (it.role && ROLE_LABELS[it.role]) return ROLE_LABELS[it.role];
    return `${TYPE_LABELS[it.type] || it.type} #${it.id}`;
  }

  let items = [];
  let selectedId = null;
  let nextId = 1;
  let dragState = null;
  let pendingImageItemId = null;
  let adjustMapId = null;
  let adjustLeaflet = null;
  let pageTheme = "basic";
  let featureColor = "#0f766e";
  /** @type {null | 'adjust' | 'pick'} */
  let mapInteractMode = null;
  let selectedLayerId = null;

  const COLORABLE = new Set([
    "title",
    "subtitle",
    "text",
    "line",
    "rect",
    "ellipse",
    "triangle",
    "arrow",
    "north",
    "scale",
  ]);

  function root() {
    return document.getElementById("layout-mode");
  }

  function pageEl() {
    return document.getElementById("layout-page");
  }

  function snapEnabled() {
    return !!document.getElementById("layout-snap")?.checked;
  }

  function snap(v) {
    return snapEnabled() ? Math.round(v / 10) * 10 : Math.round(v);
  }

  function normalizeHex(color) {
    const s = String(color || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
    }
    return "#0f766e";
  }

  function hexToRgba(hex, alpha) {
    const h = normalizeHex(hex).slice(1);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function syncColorUi(color) {
    const hex = normalizeHex(color || featureColor);
    featureColor = hex;
    const input = document.getElementById("layout-feature-color");
    const label = document.getElementById("layout-feature-color-hex");
    if (input) input.value = hex;
    if (label) label.textContent = hex;
    document.querySelectorAll(".layout-color-swatch").forEach((btn) => {
      btn.classList.toggle(
        "is-active",
        normalizeHex(btn.dataset.color) === hex
      );
    });
  }

  function layerIsOn(entry) {
    if (!entry?.meta) return false;
    if (entry.visible) return true;
    const id = entry.meta.id;
    const checked = window.InfraGeoLayers?.getState?.()?.checked || {};
    if (id && checked[id]) return true;
    try {
      const map = window.InfraGeoMap?.getMap?.();
      if (entry.leaflet && map?.hasLayer?.(entry.leaflet)) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function visibleLayerEntries() {
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    return Object.values(registry).filter((e) => layerIsOn(e));
  }

  function syncMapItemsFromMain() {
    const main = window.InfraGeoMap?.getMap?.();
    if (!main) return;
    const c = main.getCenter?.();
    const z = main.getZoom?.();
    if (!c) return;
    items.forEach((it) => {
      if (it.type !== "map") return;
      it.center = [c.lat, c.lng];
      it.zoom = z;
    });
  }

  async function captureLiveMainMap() {
    const main = window.InfraGeoMap?.getMap?.();
    const mapDiv = main?.getContainer?.();
    if (!main || !mapDiv || !window.L) return "";
    try {
      main.invalidateSize?.({ animate: false });
    } catch {
      /* ignore */
    }
    await wait(40);
    const size = main.getSize?.();
    const w = Math.round(size?.x || mapDiv.clientWidth || 0);
    const h = Math.round(size?.y || mapDiv.clientHeight || 0);
    if (w < 80 || h < 80) return "";
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const painted = paintBasemapTilesToCanvas(ctx, mapDiv, w, h);
    const drawn = paintVisibleLayersToCanvas(ctx, main);
    if (painted || drawn) {
      return canvas.toDataURL("image/jpeg", 0.92);
    }
    return "";
  }

  function syncLayerSelectUi() {
    const sel = document.getElementById("layout-layer-select");
    const status = document.getElementById("layout-selected-layer");
    if (!sel) return;
    const entries = visibleLayerEntries();
    const prev = selectedLayerId || sel.value || "";
    sel.innerHTML =
      `<option value="">— selecione ou clique no mapa —</option>` +
      entries
        .map((e) => {
          const id = e.meta.id;
          const name = e.meta.name || e.meta.schema || id;
          return `<option value="${id}">${name}</option>`;
        })
        .join("");
    if (prev && entries.some((e) => e.meta.id === prev)) {
      sel.value = prev;
      selectedLayerId = prev;
    } else if (!entries.some((e) => e.meta.id === selectedLayerId)) {
      selectedLayerId = null;
      sel.value = "";
    }
    if (status) {
      if (selectedLayerId) {
        const entry = entries.find((e) => e.meta.id === selectedLayerId);
        const name = entry?.meta?.name || selectedLayerId;
        const st = layerStyle(entry?.meta || {});
        const c = st.color || st.fillColor || featureColor;
        status.innerHTML = `Selecionada: <strong>${name}</strong> <span class="layout-layer-dot" style="background:${c}"></span>`;
      } else {
        status.textContent = "Nenhuma camada selecionada";
      }
    }
    document.getElementById("btn-layout-pick-layer")?.classList.toggle(
      "is-active",
      mapInteractMode === "pick"
    );
    document.getElementById("btn-layout-adjust-map")?.classList.toggle(
      "is-active",
      mapInteractMode === "adjust"
    );
  }

  function setSelectedLayer(layerId) {
    selectedLayerId = layerId || null;
    const entry = visibleLayerEntries().find((e) => e.meta.id === selectedLayerId);
    if (entry) {
      const st = layerStyle(entry.meta);
      const c = st.color || st.fillColor;
      if (c) syncColorUi(c);
    }
    syncLayerSelectUi();
    const hint = document.querySelector(".layout-pick-hint");
    if (hint) {
      hint.textContent = selectedLayerId
        ? "Camada selecionada — escolha a cor"
        : "Clique na feição no mapa";
    }
  }

  function recolorSelectedMapLayer(hex) {
    if (!selectedLayerId) return false;
    const ok = window.InfraGeoMap?.recolorLayer?.(selectedLayerId, hex);
    if (!ok) return false;
    syncLayerSelectUi();

    if (mapInteractMode === "pick" && adjustMapId != null) {
      const item = items.find((it) => it.id === adjustMapId);
      if (item) {
        try {
          adjustLeaflet?.remove?.();
        } catch {
          /* ignore */
        }
        adjustLeaflet = null;
        window.setTimeout(() => mountAdjustLeaflet(item), 20);
      }
      document.querySelectorAll(".layout-el--legend").forEach((node) => {
        const id = Number(node.dataset.id);
        const legendItem = items.find((x) => x.id === id);
        node.innerHTML = legendHtml();
        fitLegendBox(node, legendItem);
      });
      return true;
    }

    renderAll();
    refreshMapSnapshots().catch(() => {});
    return true;
  }

  function applyColorToSelected(color) {
    const hex = normalizeHex(color);
    featureColor = hex;
    syncColorUi(hex);

    const it = items.find((x) => x.id === selectedId);

    // Prioridade: camada do mapa selecionada
    if (selectedLayerId && recolorSelectedMapLayer(hex)) {
      return;
    }

    if (!it || !COLORABLE.has(it.type)) {
      if (!selectedLayerId) {
        window.alert(
          "Selecione uma camada (botão Selecionar camada ou lista) ou um elemento do layout."
        );
      }
      return;
    }
    it.color = hex;
    renderAll();
  }

  function applyItemColorStyles(el, it) {
    if (!it?.color || !COLORABLE.has(it.type)) return;
    // Roles do tema recomendado: se o usuário definiu cor, ela prevalece
    const c = normalizeHex(it.color);
    if (it.type === "title" || it.type === "subtitle" || it.type === "text") {
      el.style.color = c;
    } else if (it.type === "line") {
      el.style.borderTopColor = c;
      el.style.background = c;
    } else if (it.type === "rect" || it.type === "ellipse") {
      el.style.borderColor = c;
      el.style.background = hexToRgba(c, 0.16);
    } else if (it.type === "triangle") {
      el.style.borderLeftColor = "transparent";
      el.style.borderRightColor = "transparent";
      el.style.borderBottomColor = c;
    } else if (it.type === "arrow" || it.type === "north") {
      el.style.color = c;
    } else if (it.type === "scale") {
      el.style.color = c;
      el.style.setProperty("--scale-color", c);
    }
  }

  function dpi() {
    return Number(document.getElementById("layout-dpi")?.value || 180);
  }

  function syncExportStats() {
    const size = document.getElementById("layout-stat-size");
    const dpiEl = document.getElementById("layout-stat-dpi");
    const itemsEl = document.getElementById("layout-stat-items");
    const layersEl = document.getElementById("layout-stat-layers");
    const opt = document.getElementById("layout-page-size")?.selectedOptions?.[0];
    if (size) size.textContent = String(opt?.text || "A4").split("(")[0].trim();
    if (dpiEl) dpiEl.textContent = String(dpi());
    if (itemsEl) itemsEl.textContent = String(items.length);
    const n = document.getElementById("layout-layer-select")?.options?.length || 1;
    if (layersEl) layersEl.textContent = String(Math.max(0, n - 1));
  }

  function currentPreset() {
    const key = document.getElementById("layout-page-size")?.value || "a4-landscape";
    return { key, ...(PAGE_PRESETS[key] || PAGE_PRESETS["a4-landscape"]) };
  }

  function applyPageSize() {
    const page = pageEl();
    if (!page) return;
    const preset = currentPreset();
    const workspace = document.getElementById("layout-workspace");
    const cw = workspace?.clientWidth || 900;
    const ch = workspace?.clientHeight || 700;
    const pad = cw < 720 ? 12 : 40;
    const maxW = Math.max(220, cw - pad);
    const maxH = Math.max(160, ch - pad);
    const ratio = preset.wMm / preset.hMm;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    page.style.width = `${Math.round(w)}px`;
    page.style.height = `${Math.round(h)}px`;
    page.dataset.wMm = String(preset.wMm);
    page.dataset.hMm = String(preset.hMm);
    syncExportStats();
  }

  async function open(show) {
    const el = root();
    if (!el) return;
    if (!show) {
      stopAdjustMap(false).catch(() => {});
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
      document.body.classList.toggle("layout-mode-open", false);
      return;
    }
    let liveSrc = "";
    try {
      liveSrc = await captureLiveMainMap();
    } catch {
      liveSrc = "";
    }
    el.hidden = false;
    el.setAttribute("aria-hidden", "false");
    document.body.classList.toggle("layout-mode-open", true);
    items = items.filter((it) => it.type !== "layer-chip");
    if (!items.length) seedDefaultLayout();
    syncMapItemsFromMain();
    if (liveSrc) {
      items.forEach((it) => {
        if (it.type === "map") it.src = liveSrc;
      });
    }
    applyPageSize();
    syncPageTheme();
    syncGridClasses();
    syncLayerSelectUi();
    renderAll();
    window.setTimeout(() => {
      applyPageSize();
      syncMapItemsFromMain();
      if (!items.some((it) => it.type === "map" && it.src)) {
        refreshMapSnapshots().catch(() => {});
      }
      syncLayerSelectUi();
    }, 120);
  }

  function syncPageTheme() {
    const page = pageEl();
    if (!page) return;
    page.classList.toggle("is-recommended", pageTheme === "recommended");
  }

  function seedDefaultLayout() {
    applyRecommendedLayout({ silentOpen: true });
  }

  function applyRecommendedLayout(opts = {}) {
    stopAdjustMap(false).catch(() => {});

    pageTheme = "recommended";
    const sizeSel = document.getElementById("layout-page-size");
    if (sizeSel) sizeSel.value = "a4-landscape";
    const screenGrid = document.getElementById("layout-screen-grid");
    if (screenGrid) screenGrid.checked = false;
    const snap = document.getElementById("layout-snap");
    if (snap) snap.checked = true;
    const scaleUnit = document.getElementById("layout-scale-unit");
    if (scaleUnit) scaleUnit.value = "metric";

    applyPageSize();
    syncGridClasses();

    const page = pageEl();
    const W = Math.max(640, page?.clientWidth || 980);
    const H = Math.max(420, page?.clientHeight || 680);
    const pad = Math.round(Math.min(36, W * 0.04));
    const year = new Date().getFullYear();
    const gap = 18;
    const headerH = 108;
    const footerH = 36;
    const contentY = headerH;
    const contentH = Math.max(240, H - contentY - footerH);
    const legendW = Math.max(168, Math.min(240, Math.round((W - pad * 2 - gap) * 0.24)));
    const mapW = W - pad * 2 - gap - legendW;
    const mapH = contentH;
    const mapX = pad;
    const mapY = contentY;
    const legendX = mapX + mapW + gap;
    const legendY = contentY;

    items = [];
    nextId = 1;
    selectedId = null;
    try {
      adjustLeaflet?.remove?.();
    } catch {
      /* ignore */
    }
    adjustLeaflet = null;
    adjustMapId = null;
    mapInteractMode = null;

    const main = window.InfraGeoMap?.getMap?.();
    const mapCenter = main?.getCenter?.();
    const mapZoom = main?.getZoom?.();

    const push = (type, box, extra = {}) =>
      addItem(type, box, { ...extra, skipSelect: true, silent: true });

    push("text", {
      x: pad,
      y: 22,
      w: 240,
      h: 26,
    }, { text: "INFRA GEO AM", role: "brand" });

    push("text", {
      x: W - pad - 280,
      y: 24,
      w: 280,
      h: 22,
    }, {
      text: "Cartografia · Infraestrutura territorial",
      role: "brand-meta",
    });

    push("title", {
      x: pad,
      y: 56,
      w: W - pad * 2,
      h: 30,
    }, {
      text: "Mapa de Infraestrutura — Amazonas",
      role: "hero-title",
    });

    push("subtitle", {
      x: pad,
      y: 86,
      w: Math.min(420, W - pad * 2),
      h: 18,
    }, {
      text: "Composição cartográfica institucional",
      role: "hero-sub",
    });

    push("map", {
      x: mapX,
      y: mapY,
      w: mapW,
      h: mapH,
      center: mapCenter ? [mapCenter.lat, mapCenter.lng] : undefined,
      zoom: mapZoom,
    }, { role: "hero-map" });

    push("rect", {
      x: legendX,
      y: legendY,
      w: legendW,
      h: mapH,
    }, { role: "side-panel" });

    push("legend", {
      x: legendX + 16,
      y: legendY + 16,
      w: legendW - 32,
      h: mapH - 96,
      _layoutH: mapH - 96,
    }, { role: "side-legend" });

    push("north", {
      x: legendX + legendW - 46,
      y: legendY + 16,
      w: 28,
      h: 36,
    }, { role: "side-north" });

    push("scale", {
      x: legendX + 16,
      y: legendY + mapH - 72,
      w: legendW - 32,
      h: 56,
    }, { role: "side-scale" });

    push("scale", {
      x: mapX + 14,
      y: mapY + mapH - 50,
      w: 108,
      h: 36,
    }, { role: "map-scale" });

    push("text", {
      x: pad,
      y: H - 28,
      w: Math.min(420, W * 0.55),
      h: 16,
    }, {
      text: `© ${year} InfraGeo AM · CONSÓRCIO SPU — DNIT`,
      role: "footer-credit",
    });

    push("text", {
      x: W - pad - 240,
      y: H - 28,
      w: 240,
      h: 16,
    }, {
      text: "Sistema de visualização geográfica",
      role: "footer-meta",
    });

    syncPageTheme();
    renderAll();
    selectedId = items.find((it) => it.type === "map")?.id ?? null;
    captureLiveMainMap()
      .then((src) => {
        if (src) {
          items.forEach((it) => {
            if (it.type === "map") it.src = src;
          });
        }
        renderAll();
        startAdjustMap(selectedId);
      })
      .catch(() => {
        startAdjustMap(selectedId);
      });
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function cloneBasemapTo(targetMap) {
    const main = window.InfraGeoMap?.getMap?.();
    if (!main || !window.L) return;
    let added = false;
    main.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) return;
      try {
        const opts = {
          ...(layer.options || {}),
          opacity: 1,
          crossOrigin: true,
        };
        delete opts.pane;
        delete opts.map;
        delete opts.renderer;
        L.tileLayer(layer._url, opts).addTo(targetMap);
        added = true;
      } catch {
        /* ignore */
      }
    });
    if (!added) {
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          crossOrigin: true,
          attribution: "© Esri",
        }
      ).addTo(targetMap);
    }
  }

  function layerStyle(meta) {
    if (typeof window.InfraGeoMap?.styleFor === "function") {
      return window.InfraGeoMap.styleFor(meta);
    }
    const dashed = {
      "210": { color: "#2563eb", dashArray: "12 8", weight: 3.5 },
      "413": { color: "#e11d48", dashArray: "12 8", weight: 3.5 },
      "411": { color: "#7c3aed", dashArray: "12 8", weight: 3.5 },
    };
    const st = { ...(meta?.style || {}) };
    const schema = String(meta?.schema || "").toUpperCase();
    const name = String(meta?.name || "").toUpperCase();
    const m =
      schema.match(/^BR_(\d{2,4})$/) ||
      schema.match(/BR[_\-\s]*(\d{2,4})/) ||
      name.match(/BR[_\-\s]*(\d{2,4})/);
    if (m && dashed[m[1]] && !st.userColor) {
      Object.assign(st, dashed[m[1]], { fillOpacity: 0, opacity: st.opacity ?? 0.95 });
    } else if (m && dashed[m[1]] && st.userColor) {
      st.dashArray = st.dashArray || dashed[m[1]].dashArray;
      st.fillOpacity = st.fillOpacity ?? 0;
    }
    return {
      color: st.color || "#111827",
      fillColor: st.fillColor || st.color || "#111827",
      weight: st.weight ?? 2,
      opacity: st.opacity ?? 1,
      fillOpacity: st.fillOpacity ?? 0.2,
      radius: st.radius || 7,
      ...(st.dashArray ? { dashArray: st.dashArray } : {}),
    };
  }

  function cloneVisibleLayersTo(targetMap, opts = {}) {
    const pickable = !!opts.pickable;
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    Object.values(registry).forEach((entry) => {
      if (!layerIsOn(entry)) return;
      let geojson = entry.geojson;
      if (!geojson && entry.leaflet?.toGeoJSON) {
        try {
          geojson = entry.leaflet.toGeoJSON();
        } catch {
          geojson = null;
        }
      }
      if (!geojson) return;
      const style = layerStyle(entry.meta);
      const layerId = entry.meta.id;
      try {
        const group = L.geoJSON(geojson, {
          style: () => ({ ...style, interactive: pickable }),
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, {
              ...style,
              radius: Math.max(4, style.radius || 6),
              interactive: pickable,
            }),
          interactive: pickable,
          onEachFeature: pickable
            ? (_feature, layer) => {
                layer.on("click", (ev) => {
                  L.DomEvent.stopPropagation(ev);
                  setSelectedLayer(layerId);
                });
              }
            : undefined,
        }).addTo(targetMap);
        try {
          group.setStyle({ ...style });
        } catch {
          /* ignore */
        }
        if (pickable) {
          group.on("click", (ev) => {
            L.DomEvent.stopPropagation(ev);
            setSelectedLayer(layerId);
          });
        }
        if (
          window.InfraGeoBrShield?.isBrLayer?.(entry.meta) &&
          window.InfraGeoBrShield?.buildMarkers
        ) {
          try {
            window.InfraGeoBrShield.buildMarkers(group, entry.meta).addTo(targetMap);
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.warn("layout-mode: falha ao clonar camada", entry.meta?.id, err);
      }
    });
  }

  function waitForTiles(map, timeoutMs = 3200) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      const tiles = [];
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) tiles.push(layer);
      });
      if (!tiles.length) {
        clearTimeout(timer);
        done();
        return;
      }
      let pending = tiles.length;
      tiles.forEach((layer) => {
        const onLoad = () => {
          pending -= 1;
          if (pending <= 0) {
            clearTimeout(timer);
            done();
          }
        };
        if (
          layer._loading === false &&
          layer._tiles &&
          Object.keys(layer._tiles).length
        ) {
          setTimeout(onLoad, 0);
        } else {
          layer.once("load", onLoad);
        }
      });
    });
  }

  function paintBasemapTilesToCanvas(ctx, mapDiv, mapW, mapH) {
    ctx.fillStyle = "#dbe4ea";
    ctx.fillRect(0, 0, mapW, mapH);
    const hostRect = mapDiv.getBoundingClientRect();
    if (!(hostRect.width > 0) || !(hostRect.height > 0)) return 0;
    const scaleX = mapW / hostRect.width;
    const scaleY = mapH / hostRect.height;
    let painted = 0;
    mapDiv.querySelectorAll(".leaflet-tile-pane img.leaflet-tile").forEach((img) => {
      if (!img.complete || !(img.naturalWidth > 0)) return;
      try {
        const r = img.getBoundingClientRect();
        ctx.drawImage(
          img,
          (r.left - hostRect.left) * scaleX,
          (r.top - hostRect.top) * scaleY,
          r.width * scaleX,
          r.height * scaleY
        );
        painted += 1;
      } catch {
        /* tainted */
      }
    });
    return painted;
  }

  function paintRing(ctx, map, ring) {
    if (!ring || ring.length < 2) return;
    for (let i = 0; i < ring.length; i += 1) {
      const coord = ring[i];
      if (!coord || coord.length < 2) continue;
      const p = map.latLngToContainerPoint([coord[1], coord[0]]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  }

  function paintGeometry(ctx, map, geometry, style) {
    if (!geometry?.type) return;
    const type = geometry.type;
    if (type === "GeometryCollection") {
      (geometry.geometries || []).forEach((g) => paintGeometry(ctx, map, g, style));
      return;
    }
    if (type === "Point") {
      const [lng, lat] = geometry.coordinates || [];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const p = map.latLngToContainerPoint([lat, lng]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, style.radius || 6, 0, Math.PI * 2);
      ctx.fillStyle = style.fillColor;
      ctx.globalAlpha = style.fillOpacity ?? 0.85;
      ctx.fill();
      ctx.globalAlpha = style.opacity ?? 1;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.weight || 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    if (type === "MultiPoint") {
      (geometry.coordinates || []).forEach((c) =>
        paintGeometry(ctx, map, { type: "Point", coordinates: c }, style)
      );
      return;
    }

    const strokePath = () => {
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.weight || 2;
      ctx.globalAlpha = style.opacity ?? 1;
      if (style.dashArray) {
        const parts = String(style.dashArray)
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => n > 0);
        ctx.setLineDash(parts);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };

    if (type === "LineString") {
      ctx.beginPath();
      paintRing(ctx, map, geometry.coordinates);
      strokePath();
      return;
    }
    if (type === "MultiLineString") {
      (geometry.coordinates || []).forEach((line) => {
        ctx.beginPath();
        paintRing(ctx, map, line);
        strokePath();
      });
      return;
    }
    if (type === "Polygon") {
      const rings = geometry.coordinates || [];
      ctx.beginPath();
      rings.forEach((ring) => {
        paintRing(ctx, map, ring);
        ctx.closePath();
      });
      if ((style.fillOpacity ?? 0) > 0) {
        ctx.fillStyle = style.fillColor;
        ctx.globalAlpha = style.fillOpacity;
        ctx.fill("evenodd");
        ctx.globalAlpha = 1;
      }
      strokePath();
      return;
    }
    if (type === "MultiPolygon") {
      (geometry.coordinates || []).forEach((poly) => {
        paintGeometry(ctx, map, { type: "Polygon", coordinates: poly }, style);
      });
    }
  }

  function paintVisibleLayersToCanvas(ctx, map) {
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    let count = 0;
    Object.values(registry).forEach((entry) => {
      if (!layerIsOn(entry)) return;
      let geojson = entry.geojson;
      if (!geojson && entry.leaflet?.toGeoJSON) {
        try {
          geojson = entry.leaflet.toGeoJSON();
        } catch {
          geojson = null;
        }
      }
      if (!geojson) return;
      const style = layerStyle(entry.meta);
      const features =
        geojson.type === "FeatureCollection"
          ? geojson.features || []
          : geojson.type === "Feature"
            ? [geojson]
            : [{ type: "Feature", geometry: geojson, properties: {} }];
      features.forEach((f) => {
        if (!f?.geometry) return;
        paintGeometry(ctx, map, f.geometry, style);
        count += 1;
      });
    });
    return count;
  }

  async function captureMapDataUrl(opts = {}) {
    const main = window.InfraGeoMap?.getMap?.();
    if (!main || !window.L) return "";
    const w = Math.max(320, Math.round(opts.w || 900));
    const h = Math.max(240, Math.round(opts.h || 560));
    const center = opts.center
      ? L.latLng(opts.center[0], opts.center[1])
      : main.getCenter();
    const zoom = opts.zoom ?? main.getZoom();

    // Precisa estar no viewport (mesmo quase invisível) para o Leaflet carregar tiles
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      `width:${w}px`,
      `height:${h}px`,
      "z-index:10050",
      "opacity:0.02",
      "pointer-events:none",
      "overflow:hidden",
      "background:#dbe4ea",
    ].join(";");
    const mapDiv = document.createElement("div");
    mapDiv.style.cssText = "width:100%;height:100%;";
    host.appendChild(mapDiv);
    document.body.appendChild(host);

    let exportMap = null;
    try {
      exportMap = L.map(mapDiv, {
        zoomControl: false,
        attributionControl: false,
        fadeAnimation: false,
        zoomAnimation: false,
        inertia: false,
      });
      cloneBasemapTo(exportMap);
      cloneVisibleLayersTo(exportMap);
      exportMap.setView(center, zoom, { animate: false });
      exportMap.invalidateSize({ animate: false });
      await wait(80);
      exportMap.invalidateSize({ animate: false });
      await waitForTiles(exportMap, 3500);
      await wait(200);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      const painted = paintBasemapTilesToCanvas(ctx, mapDiv, w, h);
      const drawn = paintVisibleLayersToCanvas(ctx, exportMap);

      if (!painted && !drawn) {
        if (window.html2canvas) {
          const shot = await window.html2canvas(mapDiv, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: "#dbe4ea",
            scale: 1,
            logging: false,
          });
          return shot.toDataURL("image/jpeg", 0.92);
        }
        return "";
      }
      return canvas.toDataURL("image/jpeg", 0.92);
    } catch (err) {
      console.warn("layout-mode: captura do mapa falhou", err);
      return "";
    } finally {
      try {
        exportMap?.off?.();
        exportMap?.remove?.();
      } catch {
        /* ignore */
      }
      try {
        host.remove();
      } catch {
        /* ignore */
      }
    }
  }

  async function refreshMapSnapshots() {
    const maps = items.filter((it) => it.type === "map" && it.visible !== false);
    if (!maps.length) return;
    for (const it of maps) {
      const url = await captureMapDataUrl({
        w: Math.max(640, Math.round(it.w * 2)),
        h: Math.max(400, Math.round(it.h * 2)),
        center: it.center,
        zoom: it.zoom,
      });
      if (url) it.src = url;
    }
    renderAll();
  }

  async function snapshotVisibleMap(it) {
    const node = document.querySelector(`.layout-el[data-id="${it.id}"]`);
    if (!node) return it.src || "";
    const img = node.querySelector("img[alt='Mapa'], .layout-el--map img");
    if (img?.currentSrc || img?.src) {
      const src = img.currentSrc || img.src;
      if (src && !src.endsWith("/")) return src;
    }
    const live = node.querySelector(".layout-map-live, .leaflet-container");
    if (live && window.html2canvas) {
      try {
        const shot = await window.html2canvas(live, {
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#dfe6ea",
          scale: 2,
          logging: false,
        });
        return shot.toDataURL("image/png");
      } catch (err) {
        console.warn("layout-mode: snapshot do mapa visível", err);
      }
    }
    return it.src || "";
  }

  async function preparePageForExport() {
    persistAdjustView();
    const maps = items.filter((it) => it.type === "map" && it.visible !== false);
    maps.forEach((it) => {
      it._exportBox = { x: it.x, y: it.y, w: it.w, h: it.h };
    });
    for (const it of maps) {
      const url = await snapshotVisibleMap(it);
      if (url) it.src = url;
    }
    maps.forEach((it) => {
      if (!it._exportBox) return;
      it.x = it._exportBox.x;
      it.y = it._exportBox.y;
      it.w = it._exportBox.w;
      it.h = it._exportBox.h;
    });
    selectedId = null;
    const page = pageEl();
    page?.classList.add("is-exporting");
    const resumeId = adjustMapId;
    const resumeMode = mapInteractMode;
    adjustMapId = null;
    mapInteractMode = null;
    renderAll();
    page?.classList.add("is-exporting");
    await wait(80);
    return { resumeId, resumeMode };
  }

  function finishPageExport() {
    pageEl()?.classList.remove("is-exporting");
    items.forEach((it) => {
      if (it._exportBox) delete it._exportBox;
    });
  }

  async function stopAdjustMap(commit) {
    if (adjustMapId == null) return;
    const item = items.find((it) => it.id === adjustMapId);
    const wasPick = mapInteractMode === "pick";
    if (adjustLeaflet && item && commit && !wasPick) {
      try {
        const c = adjustLeaflet.getCenter();
        item.center = [c.lat, c.lng];
        item.zoom = adjustLeaflet.getZoom();
        const url = await captureMapDataUrl({
          w: Math.max(400, item.w * 1.5),
          h: Math.max(280, item.h * 1.5),
          center: item.center,
          zoom: item.zoom,
        });
        if (url) item.src = url;
      } catch (err) {
        console.warn("layout-mode: concluir ajuste", err);
      }
    }
    if (wasPick && commit) {
      // Mantém a camada selecionada; só fecha o cursor
      await refreshMapSnapshots().catch(() => {});
    }
    try {
      adjustLeaflet?.off?.();
      adjustLeaflet?.remove?.();
    } catch {
      /* ignore */
    }
    adjustLeaflet = null;
    adjustMapId = null;
    mapInteractMode = null;
    root()?.classList.remove("is-map-focus");
    document.getElementById("btn-layout-pick-layer")?.classList.remove("is-active");
    document.getElementById("btn-layout-adjust-map")?.classList.remove("is-active");
    renderAll();
    syncLayerSelectUi();
  }

  function startAdjustMap(targetId) {
    if (mapInteractMode === "adjust" && adjustMapId != null) {
      adjustLeaflet?.invalidateSize?.({ animate: false });
      return;
    }
    startMapInteract("adjust", targetId);
  }

  function startPickLayer(targetId) {
    if (mapInteractMode === "pick" && adjustMapId != null) {
      stopAdjustMap(true).catch((e) => window.alert(e.message || e));
      return;
    }
    const entries = visibleLayerEntries();
    if (!entries.length) {
      window.alert("Nenhuma camada visível no mapa. Ligue camadas antes.");
      return;
    }
    startMapInteract("pick", targetId);
  }

  function startMapInteract(mode, targetId) {
    const maps = items.filter((it) => it.type === "map" && it.visible);
    const item =
      items.find((it) => it.id === targetId && it.type === "map") ||
      items.find((it) => it.id === selectedId && it.type === "map") ||
      maps[0];
    if (!item) {
      window.alert("Adicione um elemento Mapa antes.");
      return;
    }
    if (adjustMapId != null && (adjustMapId !== item.id || mapInteractMode !== mode)) {
      stopAdjustMap(mode === "pick").then(() => startMapInteract(mode, item.id));
      return;
    }
    // Já no mesmo modo no mesmo mapa: não remonta
    if (adjustMapId === item.id && mapInteractMode === mode && adjustLeaflet) {
      syncLayerSelectUi();
      return;
    }
    selectedId = item.id;
    adjustMapId = item.id;
    mapInteractMode = mode;
    root()?.classList.add("is-map-focus");
    syncLayerSelectUi();
    renderAll();
    window.setTimeout(() => {
      mountAdjustLeaflet(item);
      adjustLeaflet?.invalidateSize?.({ animate: false });
    }, 40);
  }

  /** Clique fora do quadro do mapa encerra ajuste/seleção. */
  function onOutsideMapInteract(ev) {
    if (!mapInteractMode || adjustMapId == null) return;
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest(".layout-el--map.is-adjusting")) return;
    if (t.closest("#btn-layout-adjust-map, [data-add='adjust-map']")) return;
    if (t.closest("#btn-layout-pick-layer, [data-add='pick-layer']")) return;
    stopAdjustMap(true).catch(() => {});
  }

  function mountAdjustLeaflet(item) {
    const host = document.querySelector(
      `.layout-el--map[data-id="${item.id}"] .layout-map-live`
    );
    if (!host || !window.L) return;
    try {
      adjustLeaflet?.remove?.();
    } catch {
      /* ignore */
    }
    const main = window.InfraGeoMap?.getMap?.();
    const center = item.center
      ? L.latLng(item.center[0], item.center[1])
      : main?.getCenter?.() || L.latLng(-3.4653, -62.2159);
    const zoom = item.zoom ?? main?.getZoom?.() ?? 6;
    const picking = mapInteractMode === "pick";

    adjustLeaflet = L.map(host, {
      zoomControl: !picking,
      attributionControl: false,
      maxZoom: 18,
      dragging: !picking ? true : true,
    }).setView(center, zoom);

    if (picking) {
      host.style.cursor = "crosshair";
      adjustLeaflet.getContainer().style.cursor = "crosshair";
    }

    cloneBasemapTo(adjustLeaflet);
    cloneVisibleLayersTo(adjustLeaflet, { pickable: picking });
    adjustLeaflet.invalidateSize({ animate: false });
    window.setTimeout(() => adjustLeaflet?.invalidateSize({ animate: false }), 80);

    host.addEventListener(
      "pointerdown",
      (ev) => {
        ev.stopPropagation();
      },
      true
    );
  }

  function addItem(type, box, opts = {}) {
    if (type === "refresh-map") {
      refreshMapSnapshots().catch((e) =>
        window.alert(e.message || "Falha ao atualizar mapa")
      );
      return null;
    }
    if (type === "adjust-map") {
      startAdjustMap(selectedId);
      return null;
    }
    if (type === "pick-layer") {
      startPickLayer(selectedId);
      const sel = document.getElementById("layout-layer-select");
      const card = sel?.closest(".layout-card") || sel;
      window.setTimeout(() => {
        card?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        sel?.focus?.();
      }, 80);
      return null;
    }
    if (type === "image" && !opts.src) {
      pendingImageItemId = null;
      const input = document.getElementById("layout-image-input");
      const temp = {
        id: nextId++,
        type,
        x: box?.x ?? 80,
        y: box?.y ?? 80,
        w: box?.w ?? 180,
        h: box?.h ?? 120,
        visible: true,
        text: "",
        src: "",
      };
      items.push(temp);
      pendingImageItemId = temp.id;
      selectedId = temp.id;
      input?.click();
      renderAll();
      return temp;
    }

    const defaults = {
      map: { x: 40, y: 60, w: 480, h: 300 },
      title: { x: 40, y: 20, w: 280, h: 36 },
      subtitle: { x: 40, y: 56, w: 260, h: 28 },
      text: { x: 40, y: 100, w: 220, h: 60 },
      legend: { x: 520, y: 80, w: 160, h: 140 },
      north: { x: 560, y: 20, w: 56, h: 56 },
      scale: { x: 40, y: 380, w: 160, h: 36 },
      line: { x: 40, y: 200, w: 200, h: 4 },
      rect: { x: 80, y: 120, w: 140, h: 90 },
      ellipse: { x: 100, y: 140, w: 120, h: 80 },
      triangle: { x: 120, y: 140, w: 80, h: 70 },
      arrow: { x: 140, y: 160, w: 80, h: 40 },
      image: { x: 80, y: 80, w: 180, h: 120 },
    };
    const d = defaults[type] || { x: 60, y: 60, w: 120, h: 80 };
    const item = {
      id: nextId++,
      type,
      x: box?.x ?? d.x,
      y: box?.y ?? d.y,
      w: box?.w ?? d.w,
      h: box?.h ?? d.h,
      visible: true,
      role: opts.role || "",
      color:
        opts.color ||
        (!opts.role && COLORABLE.has(type) ? featureColor : ""),
      text:
        opts.text ||
        (type === "title"
          ? "Título do Mapa"
          : type === "subtitle"
            ? "Subtítulo"
            : type === "text"
              ? "Texto livre"
              : ""),
      src: opts.src || "",
    };
    if (type === "map") {
      const main = window.InfraGeoMap?.getMap?.();
      if (main) {
        const c = main.getCenter();
        item.center = [c.lat, c.lng];
        item.zoom = main.getZoom();
      }
    }
    items.push(item);
    if (!opts.skipSelect) selectedId = item.id;
    if (opts.silent) return item;
    if (type === "map") refreshMapSnapshots().catch(() => {});
    renderAll();
    return item;
  }

  function legendHtml() {
    const layers = [];
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    Object.values(registry).forEach((entry) => {
      if (!layerIsOn(entry)) return;
      const st = layerStyle(entry.meta);
      const color = st.fillColor || st.color || "#64748b";
      const swatch = st.dashArray
        ? `<span class="layout-legend__swatch layout-legend__swatch--line" style="--sw:${color}"></span>`
        : `<span class="layout-legend__swatch" style="background:${color}"></span>`;
      layers.push(
        pageTheme === "recommended"
          ? `<div class="layout-legend__row is-check">` +
            `<span class="layout-legend__check" aria-hidden="true"></span>` +
            `<span class="layout-legend__name">${entry.meta.name || entry.meta.id}</span></div>`
          : `<div class="layout-legend__row">${swatch}` +
            `<span class="layout-legend__name">${entry.meta.name || entry.meta.id}</span></div>`
      );
    });
    const n = layers.length;
    const dense = pageTheme === "recommended" && n > 7;
    const xdense = pageTheme === "recommended" && n > 14;
    const cls = ["layout-legend"];
    if (dense) cls.push("is-dense");
    if (xdense) cls.push("is-xdense");
    const body = n
      ? layers.join("")
      : `<div class="layout-legend__empty">Nenhuma camada visível</div>`;
    return (
      `<div class="${cls.join(" ")}">` +
      `<div class="layout-legend__title">${
        pageTheme === "recommended" ? "LEGENDA" : "Legenda"
      }</div>` +
      `<div class="layout-legend__body">${body}</div>` +
      `</div>`
    );
  }

  /** Altura máxima da legenda lateral: dentro do painel, acima da escala. */
  function sideLegendMaxHeight(it) {
    const minH = 56;
    const scale = items.find((x) => x.role === "side-scale" && x.visible !== false);
    if (scale) return Math.max(minH, scale.y - it.y - 8);
    const panel = items.find((x) => x.role === "side-panel" && x.visible !== false);
    if (panel) return Math.max(minH, panel.y + panel.h - it.y - 12);
    const page = pageEl();
    if (page) return Math.max(minH, page.clientHeight - it.y - 24);
    return it.h || minH;
  }

  /** Ajusta a altura da legenda sem ultrapassar o painel / vazar no rodapé. */
  function fitLegendBox(el, it) {
    if (!el || !it || it.type !== "legend") return;
    const minH = 56;
    el.style.overflow = "hidden";

    if (it.role === "side-legend") {
      const maxH = sideLegendMaxHeight(it);
      const designed = it._layoutH || it.h || maxH;
      // Não cresce além do espaço do layout — evita vazar sobre o rodapé
      const nextH = Math.min(Math.max(designed, minH), maxH);
      it.h = nextH;
      el.style.height = `${nextH}px`;
      const inner = el.querySelector(".layout-legend");
      const body = el.querySelector(".layout-legend__body");
      const overflows = !!(inner && inner.scrollHeight > nextH + 2);
      el.classList.toggle("is-legend-clip", overflows);
      if (body && overflows) {
        // Garante corte visual estável na exportação
        body.style.maxHeight = `${Math.max(24, nextH - 28)}px`;
      }
      return;
    }

    if (it.userSized) return;
    const inner = el.querySelector(".layout-legend");
    if (!inner) return;
    const needed = Math.ceil(inner.scrollHeight + 8);
    const page = pageEl();
    const maxH = page ? Math.max(minH, page.clientHeight - it.y - 12) : needed;
    const nextH = Math.min(Math.max(needed, minH), maxH);
    it.h = nextH;
    el.style.height = `${nextH}px`;
  }

  function northArrowHtml() {
    return `
      <div class="layout-north" aria-hidden="true">
        <svg viewBox="0 0 40 58" width="100%" height="100%" focusable="false">
          <path d="M20 2 L32 34 L20 28 L8 34 Z" fill="currentColor"/>
          <path d="M20 28 L32 34 L20 52 L8 34 Z" fill="currentColor" opacity="0.22"/>
          <text x="20" y="57" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" font-family="Manrope,sans-serif">N</text>
        </svg>
      </div>`;
  }

  function scaleLabel() {
    const unit = document.getElementById("layout-scale-unit")?.value || "metric";
    return unit === "imperial" ? "1000 mi" : "1000 km";
  }

  function removeItem(id) {
    if (adjustMapId === id) {
      stopAdjustMap(false).catch(() => {});
    }
    items = items.filter((it) => it.id !== id);
    if (selectedId === id) selectedId = null;
    renderAll();
  }

  function clearItems() {
    stopAdjustMap(false).catch(() => {});
    items = [];
    selectedId = null;
    pageTheme = "basic";
    syncPageTheme();
    renderAll();
  }

  function selectItem(id, opts = {}) {
    selectedId = id;
    const it = items.find((x) => x.id === id);
    if (it?.color) syncColorUi(it.color);
    else if (it && COLORABLE.has(it.type)) syncColorUi(featureColor);
    if (opts.skipRender) {
      renderList();
      return;
    }
    renderAll();
    if (adjustMapId === id) {
      window.setTimeout(() => {
        const item = items.find((x) => x.id === id);
        if (item) mountAdjustLeaflet(item);
      }, 30);
    }
  }

  function renderList() {
    const list = document.getElementById("layout-items-list");
    if (!list) return;
    list.innerHTML = "";
    [...items].reverse().forEach((it) => {
      const li = document.createElement("li");
      li.className = `layout-mode__item${selectedId === it.id ? " is-selected" : ""}`;
      li.innerHTML = `
        <button type="button" data-vis="${it.id}" title="Visibilidade">${it.visible ? "👁" : "🚫"}</button>
        <span class="layout-mode__item-name">${itemListLabel(it)}</span>
        <button type="button" data-del="${it.id}" title="Excluir">×</button>
      `;
      li.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-vis]") || ev.target.closest("[data-del]")) return;
        selectItem(it.id);
      });
      list.appendChild(li);
    });
  }

  function renderItemDom(it) {
    const el = document.createElement("div");
    el.className = `layout-el layout-el--${it.type}${selectedId === it.id ? " is-selected" : ""}${
      it.visible ? "" : " is-hidden"
    }`;
    if (it.role) el.classList.add(`layout-el-role--${it.role}`);
    el.dataset.id = String(it.id);
    el.style.left = `${it.x}px`;
    el.style.top = `${it.y}px`;
    if (it.type !== "triangle" && it.type !== "line") {
      el.style.width = `${it.w}px`;
      el.style.height = `${it.h}px`;
    } else if (it.type === "line") {
      el.style.width = `${it.w}px`;
    } else if (it.type === "triangle") {
      el.style.left = `${it.x}px`;
      el.style.top = `${it.y}px`;
      el.style.borderLeftWidth = `${Math.round(it.w / 2)}px`;
      el.style.borderRightWidth = `${Math.round(it.w / 2)}px`;
      el.style.borderBottomWidth = `${it.h}px`;
    }

    if (it.type === "title" || it.type === "subtitle" || it.type === "text") {
      if (it.role === "brand") {
        el.contentEditable = "false";
        el.innerHTML =
          `<span class="layout-brand" aria-hidden="false">` +
          `<svg class="layout-brand__pin" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">` +
          `<path fill="currentColor" d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5S13.4 11.5 12 11.5z"/>` +
          `</svg>` +
          `<span class="layout-brand__text">INFRA <strong>GEO AM</strong></span>` +
          `</span>`;
      } else {
        el.contentEditable = "true";
        el.spellcheck = false;
        el.textContent = it.text || "";
        el.addEventListener("input", () => {
          it.text = el.textContent || "";
        });
      }
    } else if (it.type === "map") {
      const adjusting = adjustMapId === it.id;
      if (adjusting) {
        const picking = mapInteractMode === "pick";
        el.classList.add("is-adjusting");
        if (picking) el.classList.add("is-picking");
        el.innerHTML = `
          <div class="layout-map-adjust-bar">
            <button type="button" class="is-primary" data-map-done="1">${
              picking ? "Concluir seleção" : "Concluir ajuste"
            }</button>
            <button type="button" data-map-cancel="1">Cancelar</button>
            ${
              picking
                ? `<span class="layout-pick-hint">${
                    selectedLayerId
                      ? "Camada selecionada — escolha a cor"
                      : "Clique na feição no mapa"
                  }</span>`
                : ""
            }
          </div>
          <div class="layout-map-live"></div>
        `;
        el.querySelector("[data-map-done]")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          stopAdjustMap(true).catch((e) => window.alert(e.message || e));
        });
        el.querySelector("[data-map-cancel]")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          stopAdjustMap(false).catch(() => {});
        });
      } else {
        el.innerHTML = it.src
          ? `<img alt="Mapa" src="${it.src}" />`
          : `<div class="layout-map-placeholder">Atualizar Mapa ou Ajustar Mapa</div>`;
        el.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          startAdjustMap(it.id);
        });
      }
    } else if (it.type === "legend") {
      el.innerHTML = legendHtml();
      window.requestAnimationFrame(() => fitLegendBox(el, it));
    } else if (it.type === "north") {
      el.innerHTML = northArrowHtml();
    } else if (it.type === "scale") {
      if (it.role === "side-scale") {
        el.innerHTML =
          `<div class="layout-scale-block">` +
          `<div class="layout-scale-block__label">Escala</div>` +
          `<div class="layout-scale-block__row">` +
          `<span>${scaleLabel()}</span>` +
          `<div class="layout-el--scale-bar"></div>` +
          `</div></div>`;
      } else if (it.role === "map-scale") {
        el.innerHTML =
          `<div class="layout-map-scale">` +
          `<span>${scaleLabel()}</span>` +
          `<div class="layout-el--scale-bar"></div>` +
          `</div>`;
      } else {
        el.innerHTML = `<div class="layout-el--scale-bar"></div><span>${scaleLabel()}</span>`;
      }
    } else if (it.type === "image") {
      el.innerHTML = it.src
        ? `<img alt="Imagem" src="${it.src}" />`
        : `<div style="padding:8px;font-size:12px;color:#64748b">Sem imagem</div>`;
    } else if (it.type === "arrow") {
      el.textContent = "➤";
    }

    applyItemColorStyles(el, it);

    if (selectedId === it.id && it.type !== "triangle" && adjustMapId !== it.id) {
      const handle = document.createElement("span");
      handle.className = "layout-el__handle";
      handle.dataset.resize = "1";
      el.appendChild(handle);
    }

    // Elementos decorativos do tema também podem ser movidos
    const lockedChrome = false;
    if (adjustMapId !== it.id && !lockedChrome) {
      el.classList.add("is-draggable");
      el.addEventListener("pointerdown", onPointerDown);
    }
    return el;
  }

  function persistAdjustView() {
    if (!adjustLeaflet || adjustMapId == null) return;
    const item = items.find((it) => it.id === adjustMapId);
    if (!item) return;
    try {
      const c = adjustLeaflet.getCenter();
      item.center = [c.lat, c.lng];
      item.zoom = adjustLeaflet.getZoom();
    } catch {
      /* ignore */
    }
  }

  function renderAll() {
    const page = pageEl();
    if (!page) return;
    const keepAdjustId = adjustMapId;
    persistAdjustView();
    if (keepAdjustId != null) {
      try {
        adjustLeaflet?.off?.();
        adjustLeaflet?.remove?.();
      } catch {
        /* ignore */
      }
      adjustLeaflet = null;
    }
    page.innerHTML = "";
    items.forEach((it) => page.appendChild(renderItemDom(it)));
    syncPageTheme();
    renderList();
    syncExportStats();
    if (keepAdjustId != null) {
      const item = items.find((it) => it.id === keepAdjustId);
      if (item) window.setTimeout(() => mountAdjustLeaflet(item), 20);
    }
  }

  function onPointerDown(ev) {
    if (adjustMapId != null) return;
    const el = ev.currentTarget;
    const id = Number(el.dataset.id);
    const item = items.find((it) => it.id === id);
    if (!item) return;
    // Não inicia arraste ao editar texto (só move pelo handle ou fora do caret)
    if (
      (item.type === "title" || item.type === "subtitle" || item.type === "text") &&
      !ev.target.closest?.("[data-resize]") &&
      ev.detail > 1
    ) {
      selectItem(id);
      return;
    }
    selectItem(id, { skipRender: true });
    document.querySelectorAll(".layout-el.is-selected").forEach((n) => {
      n.classList.remove("is-selected");
    });
    el.classList.add("is-selected");
    if (!el.querySelector("[data-resize]") && item.type !== "triangle") {
      const handle = document.createElement("span");
      handle.className = "layout-el__handle";
      handle.dataset.resize = "1";
      el.appendChild(handle);
    }
    const isResize = !!ev.target.closest?.("[data-resize]");
    dragState = {
      id,
      resize: isResize,
      startX: ev.clientX,
      startY: ev.clientY,
      origX: item.x,
      origY: item.y,
      origW: item.w,
      origH: item.h,
      el,
    };
    el.classList.add("is-dragging");
    el.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  }

  function onPointerMove(ev) {
    if (!dragState) return;
    const item = items.find((it) => it.id === dragState.id);
    if (!item) return;
    const page = pageEl();
    const maxX = Math.max(0, (page?.clientWidth || 800) - 8);
    const maxY = Math.max(0, (page?.clientHeight || 600) - 8);
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    if (dragState.resize) {
      item.w = Math.max(24, snap(dragState.origW + dx));
      item.h = Math.max(16, snap(dragState.origH + dy));
      item.userSized = true;
      if (dragState.el) {
        if (item.type !== "triangle" && item.type !== "line") {
          dragState.el.style.width = `${item.w}px`;
          dragState.el.style.height = `${item.h}px`;
        } else if (item.type === "line") {
          dragState.el.style.width = `${item.w}px`;
        }
      }
    } else {
      item.x = Math.max(0, Math.min(maxX, snap(dragState.origX + dx)));
      item.y = Math.max(0, Math.min(maxY, snap(dragState.origY + dy)));
      item.userMoved = true;
      if (dragState.el) {
        dragState.el.style.left = `${item.x}px`;
        dragState.el.style.top = `${item.y}px`;
      }
    }
  }

  function onPointerUp() {
    if (dragState?.el) dragState.el.classList.remove("is-dragging");
    const moved = dragState;
    dragState = null;
    if (moved) {
      // Atualiza handle/seleção sem resetar posição
      renderList();
    }
  }

  async function exportPng() {
    const page = pageEl();
    if (!page || !window.html2canvas) {
      window.alert("html2canvas indisponível");
      return;
    }
    const wasSelected = selectedId;
    let resume = { resumeId: null, resumeMode: null };
    try {
      resume = await preparePageForExport();
      const canvas = await window.html2canvas(page, {
        backgroundColor: pageTheme === "recommended" ? "#F4F7F6" : "#0f172a",
        scale: Math.max(1, dpi() / 96),
        useCORS: true,
        logging: false,
        windowWidth: page.scrollWidth,
        windowHeight: page.scrollHeight,
      });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `infrageo-layout-${Date.now()}.png`;
      a.click();
    } finally {
      finishPageExport();
      selectedId = wasSelected;
      if (resume.resumeId != null) {
        startMapInteract(resume.resumeMode || "adjust", resume.resumeId);
      } else {
        renderAll();
      }
    }
  }

  async function exportPdf() {
    const page = pageEl();
    if (!page || !window.html2canvas) {
      window.alert("html2canvas indisponível");
      return;
    }
    const jspdfNS = window.jspdf || window.jsPDF;
    const JsPDF = jspdfNS?.jsPDF || window.jsPDF;
    if (!JsPDF) {
      window.alert("jsPDF indisponível");
      return;
    }
    const wasSelected = selectedId;
    let resume = { resumeId: null, resumeMode: null };
    try {
      resume = await preparePageForExport();
      const canvas = await window.html2canvas(page, {
        backgroundColor: pageTheme === "recommended" ? "#F4F7F6" : "#0f172a",
        scale: Math.max(1, dpi() / 96),
        useCORS: true,
        logging: false,
        windowWidth: page.scrollWidth,
        windowHeight: page.scrollHeight,
      });
      const preset = currentPreset();
      const landscape = preset.wMm >= preset.hMm;
      const pdf = new JsPDF({
        orientation: landscape ? "landscape" : "portrait",
        unit: "mm",
        format: [preset.wMm, preset.hMm],
      });
      const img = canvas.toDataURL("image/jpeg", 0.92);
      pdf.addImage(img, "JPEG", 0, 0, preset.wMm, preset.hMm);
      pdf.save(`infrageo-layout-${Date.now()}.pdf`);
    } finally {
      finishPageExport();
      selectedId = wasSelected;
      if (resume.resumeId != null) {
        startMapInteract(resume.resumeMode || "adjust", resume.resumeId);
      } else {
        renderAll();
      }
    }
  }

  function syncGridClasses() {
    const page = pageEl();
    if (!page) return;
    page.classList.toggle(
      "has-screen-grid",
      !!document.getElementById("layout-screen-grid")?.checked
    );
    page.classList.toggle(
      "has-wgs84-grid",
      !!document.getElementById("layout-wgs84-grid")?.checked
    );
  }

  function init() {
    const openBtn = document.getElementById("btn-exportar-mapa");
    const backBtn = document.getElementById("btn-layout-back-map");
    const pageSize = document.getElementById("layout-page-size");
    const dpiRange = document.getElementById("layout-dpi");
    const dpiValue = document.getElementById("layout-dpi-value");
    const imageInput = document.getElementById("layout-image-input");

    if (openBtn) {
      openBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        open(true);
      }, true);
    }
    backBtn?.addEventListener("click", () => open(false));
    pageSize?.addEventListener("change", () => {
      applyPageSize();
      renderAll();
    });
    dpiRange?.addEventListener("input", () => {
      if (dpiValue) dpiValue.textContent = String(dpi());
      syncExportStats();
    });
    document.getElementById("layout-screen-grid")?.addEventListener("change", syncGridClasses);
    document.getElementById("layout-wgs84-grid")?.addEventListener("change", syncGridClasses);
    document.getElementById("layout-scale-unit")?.addEventListener("change", renderAll);
    document.getElementById("btn-layout-export-png")?.addEventListener("click", () => {
      exportPng().catch((e) => window.alert(e.message || e));
    });
    document.getElementById("btn-layout-export-pdf")?.addEventListener("click", () => {
      exportPdf().catch((e) => window.alert(e.message || e));
    });
    document.getElementById("btn-layout-clear")?.addEventListener("click", clearItems);
    document.getElementById("btn-layout-delete-sel")?.addEventListener("click", () => {
      if (selectedId != null) removeItem(selectedId);
    });
    document.getElementById("btn-layout-recommended")?.addEventListener("click", () => {
      applyRecommendedLayout();
    });

    const colorInput = document.getElementById("layout-feature-color");
    colorInput?.addEventListener("input", () => {
      applyColorToSelected(colorInput.value);
    });
    document.querySelectorAll(".layout-color-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyColorToSelected(btn.dataset.color);
      });
    });
    document.getElementById("layout-layer-select")?.addEventListener("change", (ev) => {
      setSelectedLayer(ev.target.value || null);
    });
    syncColorUi(featureColor);
    syncLayerSelectUi();

    root()?.addEventListener("pointerdown", onOutsideMapInteract, true);

    document.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => addItem(btn.dataset.add));
    });

    document.getElementById("layout-items-list")?.addEventListener("click", (ev) => {
      const vis = ev.target.closest?.("[data-vis]");
      const del = ev.target.closest?.("[data-del]");
      if (vis) {
        const id = Number(vis.getAttribute("data-vis"));
        const it = items.find((x) => x.id === id);
        if (it) {
          it.visible = !it.visible;
          renderAll();
        }
      }
      if (del) removeItem(Number(del.getAttribute("data-del")));
    });

    imageInput?.addEventListener("change", () => {
      const file = imageInput.files?.[0];
      if (!file || pendingImageItemId == null) return;
      const reader = new FileReader();
      reader.onload = () => {
        const it = items.find((x) => x.id === pendingImageItemId);
        if (it) it.src = String(reader.result || "");
        pendingImageItemId = null;
        imageInput.value = "";
        renderAll();
      };
      reader.readAsDataURL(file);
    });

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", () => {
      if (!root()?.hidden) applyPageSize();
    });
    const workspace = document.getElementById("layout-workspace");
    if (workspace && typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (!root()?.hidden) applyPageSize();
      }).observe(workspace);
    }
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && root() && !root().hidden) open(false);
      if ((ev.key === "Delete" || ev.key === "Backspace") && selectedId != null) {
        const tag = (ev.target?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || ev.target?.isContentEditable) return;
        if (!root()?.hidden) removeItem(selectedId);
      }
    });
  }

  return { init, open, refreshMapSnapshots };
})();
