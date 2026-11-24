/**
 * Modo Layout — editor de página (substitui o fluxo principal de Exportar).
 */
window.InfraGeoLayoutMode = (function () {
  "use strict";

  const PAGE_PRESETS = {
    "a4-landscape": { wMm: 297, hMm: 210, label: "A4 Paisagem" },
    "a4-portrait": { wMm: 210, hMm: 297, label: "A4 Retrato" },
    "a3-landscape": { wMm: 420, hMm: 297, label: "A3 Paisagem" },
    "a3-portrait": { wMm: 297, hMm: 420, label: "A3 Retrato" },
    "letter-landscape": { wMm: 279.4, hMm: 215.9, label: "Carta Paisagem" },
    "letter-portrait": { wMm: 215.9, hMm: 279.4, label: "Carta Retrato" },
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

  /** Satélite (Esri/Google) deixa de ter imagem e mostra "Map data not yet available". */
  const EXPORT_MAX_ZOOM = 16;
  /** Mini mapa de localização: contexto em volta da seleção, sem zoom de rua. */
  const LOCATOR_MAX_ZOOM = 11;

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

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeColor(c) {
    const s = String(c || "").trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)
      ? s
      : "#0A2E2C";
  }

  function safeImgSrc(src) {
    const s = String(src || "").trim();
    if (!s) return "";
    const head = s.slice(0, 24).toLowerCase();
    if (head.startsWith("javascript:") || head.startsWith("vbscript:")) return "";
    if (
      head.startsWith("data:image/") ||
      head.startsWith("blob:") ||
      /^https?:/i.test(s)
    ) {
      return s.replace(/"/g, "");
    }
    return "";
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
  /** @type {null | 'adjust' | 'pick' | 'select'} */
  let mapInteractMode = null;
  let selectedLayerId = null;
  let selectionBounds = null;
  let selectionHighlight = null;
  let selectionRectLayer = null;
  let boxDrawCleanup = null;
  let boxDrawArmed = false;
  let selectionGeojson = null;
  /** Só os registros da tabela de atributos — esconde as demais camadas na folha. */
  let sheetSoloSelection = false;
  let previewZoom = 1;
  let sheetAuto = true;
  let sheetCompose = "full";
  let locatorEngine = null;
  let locatorRect = null;
  let locatorOutline = null;
  let locatorSeq = 0;
  let locatorLive = null;
  let locatorCenter = null;
  let locatorZoom = null;
  let overlayPos = {};
  let overlaySize = {};
  let overlayUnlocked = {};
  let overlayDrag = null;
  let overlaySelected = null;

  const OVERLAY_MIN = {
    title: [72, 28],
    north: [18, 24],
    scale: [40, 16],
    locator: [56, 48],
    legend: [72, 36],
    credits: [40, 16],
  };

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

  function layerAllowedOnSheet(layerId) {
    if (sheetSoloSelection) {
      return !!selectedLayerId && String(layerId) === String(selectedLayerId);
    }
    return true;
  }

  function refreshSoloMap() {
    renderAll();
    const keepId = adjustMapId;
    if (keepId != null) {
      const item = items.find((x) => x.id === keepId);
      if (item) mountAdjustLeaflet(item);
    }
    scheduleLocatorMount();
    refreshMapSnapshots().catch(() => {});
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
    if (sheetSoloSelection && selectedLayerId) {
      const hit =
        registry[selectedLayerId] ||
        Object.values(registry).find(
          (e) => String(e.meta?.id) === String(selectedLayerId)
        );
      return hit ? [hit] : [];
    }
    return Object.values(registry).filter((e) => layerIsOn(e));
  }

  function boundsFromMap(map) {
    try {
      const b = map?.getBounds?.();
      if (!b) return null;
      return [
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ];
    } catch {
      return null;
    }
  }

  function applyViewToMap(map, item, fallbackMap) {
    if (!map || !window.L) return;
    const bounds = item?.bounds;
    if (bounds) {
      try {
        map.fitBounds(L.latLngBounds(bounds[0], bounds[1]), {
          animate: false,
          padding: sheetSoloSelection ? [48, 48] : [28, 28],
          maxZoom: EXPORT_MAX_ZOOM,
        });
        return;
      } catch {
        /* ignore */
      }
    }
    const center = item?.center
      ? L.latLng(item.center[0], item.center[1])
      : fallbackMap?.getCenter?.();
    const zoom = Math.min(
      item?.zoom ?? fallbackMap?.getZoom?.() ?? 6,
      EXPORT_MAX_ZOOM
    );
    if (center) map.setView(center, zoom, { animate: false });
  }

  function syncMapItemsFromMain() {
    const main = window.InfraGeoMap?.getMap?.();
    if (!main) return;
    const c = main.getCenter?.();
    const z = main.getZoom?.();
    const bounds = boundsFromMap(main);
    if (!c) return;
    items.forEach((it) => {
      if (it.type !== "map") return;
      it.center = [c.lat, c.lng];
      it.zoom = Math.min(z ?? 6, EXPORT_MAX_ZOOM);
      if (bounds) it.bounds = bounds;
    });
  }

  async function captureLiveMainMap() {
    const main = window.InfraGeoMap?.getMap?.();
    const mapDiv = main?.getContainer?.();
    if (!main || !mapDiv || !window.L) return "";
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
    paintOverlayCanvasesToCanvas(ctx, mapDiv, w, h);
    const drawn = paintVisibleLayersToCanvas(ctx, main);
    if (!drawn) paintMapLayerGeojson(ctx, main);
    paintExportPopupsOnMap(ctx, main);
    if (painted || drawn) {
      return safeCanvasDataUrl(canvas, "image/jpeg", 0.92);
    }
    return "";
  }

  function catalogMetas() {
    return window.InfraGeoLayers?.allLayerMetas?.() || [];
  }

  function isLayerOnById(id) {
    const checked = window.InfraGeoLayers?.getState?.()?.checked || {};
    if (id && checked[id]) return true;
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    return layerIsOn(registry[id]);
  }

  async function enableLayerForExport(layerId, on = true) {
    if (!layerId || !window.InfraGeoLayers?.setLayerVisible) return;
    await window.InfraGeoLayers.setLayerVisible(layerId, on, { fit: false });
    renderLayerChips();
    document.querySelectorAll(".layout-el--legend").forEach((node) => {
      const legendItem = items.find((x) => x.id === Number(node.dataset.id));
      node.innerHTML = legendHtml();
      fitLegendBox(node, legendItem);
    });
    const keepId = adjustMapId;
    if (keepId != null) {
      const item = items.find((x) => x.id === keepId);
      if (item) mountAdjustLeaflet(item);
    }
    scheduleLocatorMount();
    refreshMapSnapshots().catch(() => {});
  }

  function syncLayerSelectUi() {
    const sel = document.getElementById("layout-layer-select");
    const status = document.getElementById("layout-selected-layer");
    if (!sel) return;
    const metas = catalogMetas();
    const prev = selectedLayerId || sel.value || "";
    const groups = {};
    metas.forEach((m) => {
      const g = m.groupName || "Outras";
      if (!groups[g]) groups[g] = [];
      groups[g].push(m);
    });
    sel.innerHTML =
      `<option value="">Nenhuma</option>` +
      Object.keys(groups)
        .map((g) => {
          const opts = groups[g]
            .map((m) => {
              const name = esc(m.name || m.schema || m.id);
              return `<option value="${esc(m.id)}">${name}</option>`;
            })
            .join("");
          return `<optgroup label="${esc(g)}">${opts}</optgroup>`;
        })
        .join("");
    if (prev && metas.some((m) => String(m.id) === String(prev))) {
      sel.value = prev;
      selectedLayerId = prev;
    } else if (prev) {
      sel.value = prev;
    }
    if (status) {
      status.textContent = "";
      status.hidden = true;
    }
    renderLayerChips();
    document.getElementById("btn-layout-pick-layer")?.classList.toggle(
      "is-active",
      mapInteractMode === "pick"
    );
    const boxBtn = document.getElementById("btn-layout-box-select");
    boxBtn?.classList.toggle("is-active", mapInteractMode === "select");
    boxBtn?.setAttribute("aria-pressed", mapInteractMode === "select" ? "true" : "false");
    document.getElementById("btn-layout-adjust-map")?.classList.toggle(
      "is-active",
      mapInteractMode === "adjust"
    );
    renderPopupPinList();
  }

  function setSelectedLayer(layerId) {
    selectedLayerId = layerId || null;
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    const entry =
      visibleLayerEntries().find((e) => String(e.meta.id) === String(selectedLayerId)) ||
      Object.values(registry).find((e) => String(e.meta?.id) === String(selectedLayerId));
    if (entry) {
      const st = layerStyle(entry.meta);
      const c = st.color || st.fillColor;
      if (c) syncColorUi(c);
    }
    syncLayerSelectUi();
    const hint = document.querySelector(".layout-pick-hint");
    if (hint) {
      hint.textContent = selectedLayerId
        ? "Somente esta camada no mapa"
        : "Clique na feição no mapa";
    }
    refreshSoloMap();
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
    const c = safeColor(normalizeHex(it.color));
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
    return Number(document.getElementById("layout-dpi")?.value || 150);
  }

  function mapExportScale() {
    return Math.min(4, Math.max(3, Math.round(dpi() / 100) || 3));
  }

  function syncExportStats() {
    const size = document.getElementById("layout-stat-size");
    const dpiEl = document.getElementById("layout-stat-dpi");
    const itemsEl = document.getElementById("layout-stat-items");
    const layersEl = document.getElementById("layout-stat-layers");
    const preset = currentPreset();
    const margin = document.getElementById("layout-margins")?.value || "compact";
    const marginLabel = margin === "comfortable" ? "margens confortáveis" : "margens compactas";
    const presetSel = document.getElementById("layout-print-preset");
    if (presetSel && preset.key) presetSel.value = preset.key;
    if (size && size.tagName !== "SELECT") {
      const ori = preset.hMm > preset.wMm ? "Retrato" : "Paisagem";
      const paper = (preset.label || "A4").split(" ")[0];
      size.textContent = `${paper} · ${ori} · ${Math.round(preset.wMm)} × ${Math.round(preset.hMm)} mm`;
    }
    if (dpiEl) dpiEl.textContent = String(dpi());
    if (itemsEl) itemsEl.textContent = String(items.length);
    if (layersEl) layersEl.textContent = String(visibleLayerEntries().length);
  }

  function applySizeKey(key) {
    const presetKey = PAGE_PRESETS[key] ? key : "a4-landscape";
    const size = document.getElementById("layout-page-size");
    const vis = document.getElementById("layout-print-preset");
    const fmtEl = document.getElementById("layout-page-format");
    const oriEl = document.getElementById("layout-page-orient");
    if (size) size.value = presetKey;
    if (vis) vis.value = presetKey;
    if (fmtEl) {
      if (presetKey.startsWith("a3")) fmtEl.value = "a3";
      else if (presetKey.startsWith("letter")) fmtEl.value = "letter";
      else fmtEl.value = "a4";
    }
    if (oriEl) {
      oriEl.value = presetKey.includes("portrait") ? "portrait" : "landscape";
    }
  }

  function currentPreset() {
    const key = document.getElementById("layout-page-size")?.value || "a4-landscape";
    return { key, ...(PAGE_PRESETS[key] || PAGE_PRESETS["a4-landscape"]) };
  }

  function applySheetChrome() {
    const showScale = document.getElementById("layout-show-scale")?.checked !== false;
    const showCredits = document.getElementById("layout-show-credits")?.checked !== false;
    items.forEach((it) => {
      if (it.type === "scale") it.visible = showScale;
      if (it.role === "footer-credit" || it.role === "footer-meta") it.visible = showCredits;
    });
  }

  function setPreviewZoom(next) {
    previewZoom = Math.min(1.4, Math.max(0.6, next));
    const wrap = document.getElementById("layout-page-wrap");
    const label = document.getElementById("layout-zoom-label");
    if (wrap) wrap.style.transform = `scale(${previewZoom})`;
    if (label) label.textContent = `${Math.round(previewZoom * 100)}%`;
  }

  function layersPop() {
    return document.getElementById("layout-layers-pop");
  }

  function setLayersPop(open) {
    const pop = layersPop();
    const btn = document.getElementById("btn-layout-layers");
    if (!pop) return;
    pop.hidden = !open;
    btn?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      renderLayerChips();
      renderBasemapChips();
    }
  }

  const BASEMAP_LABELS = {
    "Esri Light Gray": "Mapa claro",
    "Esri Light Gray + rótulos": "Mapa com nomes",
    "Esri Streets": "Ruas",
    OpenStreetMap: "Mapa (ruas)",
    "Satélite (Esri)": "Satélite (Esri)",
    "Sentinel-2": "Sentinel-2",
    "Google Earth": "Satélite (Google)",
    "Esri Topográfico": "Terreno",
    OpenTopoMap: "Relevo",
  };

  function renderBasemapChips() {
    const host = document.getElementById("layout-basemap-chips");
    if (!host) return;
    const names = window.InfraGeoMap?.getBasemapNames?.() || [];
    const active = window.InfraGeoMap?.getActiveBasemapName?.();
    const rank = (n) => {
      const t = String(n).toLowerCase();
      if (t.includes("satél") || t.includes("google earth") || t.includes("sentinel")) return 0;
      if (t.includes("topo") || t.includes("relev")) return 2;
      return 3;
    };
    const ordered = [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "pt"));
    if (!ordered.length) {
      host.innerHTML = `<span class="layout-studio__empty">Nenhum mapa base</span>`;
      return;
    }
    host.innerHTML = ordered
      .map((name) => {
        const on = name === active;
        const label = BASEMAP_LABELS[name] || name;
        return (
          `<button type="button" class="layout-chip${on ? " is-on" : ""}" data-basemap="${esc(name)}" aria-pressed="${on}">` +
          (on ? `<span class="layout-chip__check" aria-hidden="true">✓</span>` : "") +
          `${esc(label)}</button>`
        );
      })
      .join("");
  }

  function renderLayerChips() {
    const host = document.getElementById("layout-layer-chips");
    if (!host) return;
    const metas = catalogMetas();
    if (!metas.length) {
      host.innerHTML = `<li class="layout-studio__empty">Nenhuma camada no catálogo</li>`;
      return;
    }
    const onFirst = [...metas].sort((a, b) => {
      const ao = isLayerOnById(a.id) ? 0 : 1;
      const bo = isLayerOnById(b.id) ? 0 : 1;
      return ao - bo;
    });
    const onRows = onFirst.filter((m) => isLayerOnById(m.id));
    const offRows = onFirst.filter((m) => !isLayerOnById(m.id));
    const row = (m, on) => {
      const id = String(m.id);
      const st = layerStyle(m);
      const c = st.fillColor || st.color || "#0A2E2C";
      const name = esc(m.name || m.schema || id);
      const solo = on && selectedLayerId && String(selectedLayerId) === id;
      return (
        `<li>` +
        `<button type="button" class="layout-layer-pill${on ? " is-on" : ""}${solo ? " is-solo" : ""}" data-toggle-layer="${esc(id)}" aria-pressed="${on}">` +
        `<span class="layout-layer-dot" style="background:${safeColor(c)}"></span>` +
        `<span class="layout-layer-name">${name}</span>` +
        `<span class="layout-layer-action">${on ? "Remover" : "Adicionar"}</span>` +
        `</button></li>`
      );
    };
    host.innerHTML =
      (onRows.length
        ? `<li class="layout-studio__group-label">No mapa</li>${onRows.map((m) => row(m, true)).join("")}`
        : `<li class="layout-studio__empty">Nenhuma camada no mapa</li>`) +
      `<li class="layout-studio__group-label">Disponíveis</li>` +
      (offRows.length
        ? offRows.map((m) => row(m, false)).join("")
        : `<li class="layout-studio__empty">Todas as camadas já estão no mapa</li>`);
  }

  function renderPopupPinList() {
    const host = document.getElementById("layout-popup-pins");
    if (!host) return;
    const pins = window.InfraGeoHoverPopup?.getExportPins?.() || [];
    host.hidden = !pins.length;
    host.innerHTML = pins
      .map(
        (p) =>
          `<li>` +
          `<span class="layout-layer-dot" style="background:${safeColor(p.color)}"></span>` +
          `<span>${esc(p.title || "Ponto")}</span>` +
          `<button type="button" data-del-pin="${esc(p.id)}">Remover</button>` +
          `</li>`
      )
      .join("");
  }

  function applyPageSize() {
    const page = pageEl();
    if (!page) return;
    const preset = currentPreset();
    const workspace = document.getElementById("layout-workspace");
    const cw = workspace?.clientWidth || 900;
    const ch = workspace?.clientHeight || 700;
    const pad = cw < 720 ? 8 : 16;
    const maxW = Math.max(360, cw - pad);
    const maxH = Math.max(320, ch - pad);
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
    const wrap = document.getElementById("layout-page-wrap");
    if (wrap) {
      wrap.style.width = `${Math.round(w)}px`;
      wrap.style.height = `${Math.round(h)}px`;
      wrap.style.transform = "none";
    }
    previewZoom = 1;
    syncExportStats();
  }

  let tileScrubTimer = 0;

  function scrubLayoutTiles() {
    document.querySelectorAll(".layout-mode img.leaflet-tile").forEach((img) => {
      const broken =
        img.classList.contains("leaflet-tile-error") ||
        !img.getAttribute("src") ||
        (img.complete && img.naturalWidth === 0);
      if (!broken) return;
      img.dataset.igEmpty = "1";
      img.classList.add("leaflet-tile-error");
      img.style.cssText =
        "display:none!important;visibility:hidden!important;opacity:0!important;width:0!important;height:0!important";
      try {
        if (img.getAttribute("src") !== EMPTY_TILE) img.src = EMPTY_TILE;
      } catch {
        /* ignore */
      }
    });
  }

  function setTileScrub(on) {
    if (tileScrubTimer) {
      window.clearInterval(tileScrubTimer);
      tileScrubTimer = 0;
    }
    if (!on) return;
    scrubLayoutTiles();
    tileScrubTimer = window.setInterval(scrubLayoutTiles, 120);
  }

  async function open(show, opts = {}) {
    const el = root();
    if (!el) return;
    if (!show) {
      setTileScrub(false);
      stopAdjustMap(false).catch(() => {});
      el.classList.remove("is-open", "is-map-focus");
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
      document.body.classList.remove("layout-mode-open");
      setLayersPop(false);
      return;
    }
    let liveSrc = "";
    const fromSelection = !!opts.fromSelection && !!selectionGeojson?.features?.length;
    if (show && !fromSelection) {
      sheetSoloSelection = false;
      selectionGeojson = null;
      selectionBounds = null;
      selectedLayerId = null;
    }
    if (!fromSelection) {
      try {
        liveSrc = await captureLiveMainMap();
      } catch {
        liveSrc = "";
      }
    }
    el.hidden = false;
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    document.body.classList.add("layout-mode-open");
    setTileScrub(true);
    applyPageSize();
    items = items.filter((it) => it.type !== "layer-chip");
    seedDefaultLayout();
    if (!fromSelection) syncMapItemsFromMain();
    if (liveSrc) {
      items.forEach((it) => {
        if (it.type === "map") it.src = liveSrc;
      });
    }
    syncPageTheme();
    syncGridClasses();
    syncLayerSelectUi();
    renderAll();
    window.setTimeout(() => {
      if (!fromSelection) syncMapItemsFromMain();
      syncLayerSelectUi();
      const mapItem = items.find((it) => it.type === "map" && it.visible !== false);
      if (mapItem) {
        if (fromSelection && selectionBounds) {
          mapItem.bounds = boundsToItem(selectionBounds);
          const c = selectionBounds.getCenter?.();
          if (c) mapItem.center = [c.lat, c.lng];
        }
        adjustMapId = mapItem.id;
        mapInteractMode = "adjust";
        mountAdjustLeaflet(mapItem);
      }
      scheduleLocatorMount();
      refreshMapSnapshots().catch(() => {});
    }, 180);
  }

  async function openWithSelection(opts = {}) {
    const layerId = opts.layerId || null;
    const collection = {
      type: "FeatureCollection",
      features: (opts.collection?.features || []).filter((f) => f?.geometry),
    };
    sheetSoloSelection = true;
    selectedLayerId = layerId;
    selectionGeojson = collection;
    selectionBounds = expandBoundsForSheet(boundsFromCollection(collection));
    locatorCenter = null;
    locatorZoom = null;
    await open(true, { fromSelection: true });
    selectedLayerId = layerId;
    selectionGeojson = collection;
    selectionBounds = expandBoundsForSheet(boundsFromCollection(collection));
    const bounds = selectionBounds;
    if (bounds) {
      items.forEach((it) => {
        if (it.type !== "map") return;
        it.bounds = boundsToItem(bounds);
        const c = bounds.getCenter();
        it.center = [c.lat, c.lng];
        it.src = "";
      });
    }
    if (opts.title) {
      const titleEl = document.getElementById("layout-map-title");
      if (titleEl) titleEl.value = opts.title;
    }
    syncLayerSelectUi();
    refreshSoloMap();
  }

  function syncPageTheme() {
    const page = pageEl();
    if (!page) return;
    page.classList.toggle("is-recommended", pageTheme === "recommended");
  }

  function seedDefaultLayout() {
    const loc = document.getElementById("layout-show-locator");
    if (loc) loc.checked = true;
    applyRecommendedLayout({ silentOpen: true });
  }

  function layerGeomKind(entry) {
    const gj = entry?.geojson;
    const t = String(
      gj?.features?.[0]?.geometry?.type || gj?.geometry?.type || entry?.meta?.geom || ""
    );
    if (/polygon/i.test(t)) return 0;
    if (/line/i.test(t)) return 1;
    return 2;
  }

  function activeLayerNames() {
    return visibleLayerEntries().map((e) => e.meta?.name || e.meta?.id).filter(Boolean);
  }

  function autoSubtitle() {
    const names = activeLayerNames();
    if (!names.length) return "Nenhuma camada ligada no mapa";
    if (names.length <= 3) return names.join(" · ");
    return `${names.slice(0, 3).join(" · ")} +${names.length - 3}`;
  }

  function suggestedComposition() {
    return visibleLayerEntries().length >= 5 ? "side" : "full";
  }

  function resolveComposition() {
    if (sheetAuto) sheetCompose = suggestedComposition();
    return sheetCompose;
  }

  function applyRecommendedLayout(opts = {}) {
    stopAdjustMap(false).catch(() => {});
    pageTheme = "recommended";
    if (opts.resetUi) {
      sheetAuto = true;
      const scale = document.getElementById("layout-show-scale");
      const north = document.getElementById("layout-show-north");
      const loc = document.getElementById("layout-show-locator");
      const credits = document.getElementById("layout-show-credits");
      const titleOn = document.getElementById("layout-show-title");
      const legendOn = document.getElementById("layout-show-legend");
      if (scale) scale.checked = true;
      if (north) north.checked = true;
      if (loc) loc.checked = true;
      if (credits) credits.checked = true;
      if (titleOn) titleOn.checked = true;
      if (legendOn) legendOn.checked = true;
      overlayPos = {};
      overlaySize = {};
      overlayUnlocked = {};
      locatorCenter = null;
      locatorZoom = null;
    }
    applyPageSize();
    syncGridClasses();

    const prevMap = items.find((it) => it.type === "map");
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
    const mapItem = addItem("map", { x: 0, y: 0, w: 400, h: 300 }, {
      skipSelect: true,
      silent: true,
      role: "hero-map",
    });
    if (prevMap?.src && mapItem) mapItem.src = prevMap.src;
    const bounds = boundsFromMap(main);
    if (mapItem && bounds) mapItem.bounds = bounds;

    renderAll();
    selectedId = mapItem?.id ?? null;
    captureLiveMainMap()
      .then((src) => {
        if (src) {
          items.forEach((it) => {
            if (it.type === "map") it.src = src;
          });
        }
        renderAll();
      })
      .catch(() => {});
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  const EMPTY_TILE =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  function purgeBrokenTiles(root) {
    const scope = root || document;
    scope.querySelectorAll?.("img.leaflet-tile")?.forEach((img) => {
      if (img.classList.contains("leaflet-tile-error") || (img.complete && img.naturalWidth === 0)) {
        img.dataset.igEmpty = "1";
        img.classList.add("leaflet-tile-error");
        img.style.cssText =
          "display:none!important;visibility:hidden!important;opacity:0!important;width:0!important;height:0!important";
        try {
          if (img.getAttribute("src") !== EMPTY_TILE) img.src = EMPTY_TILE;
        } catch {
          /* ignore */
        }
      }
    });
  }

  function hideBrokenTiles(map) {
    if (!map?.on) return;
    map.on("tileerror", (ev) => {
      const img = ev && ev.tile;
      if (!img || img.dataset.igEmpty === "1") return;
      img.dataset.igEmpty = "1";
      img.classList.add("leaflet-tile-error");
      img.alt = "";
      img.style.cssText =
        "display:none!important;visibility:hidden!important;opacity:0!important;width:0!important;height:0!important";
      try {
        if (img.src !== EMPTY_TILE) img.src = EMPTY_TILE;
      } catch {
        /* ignore */
      }
    });
    map.on("load", () => purgeBrokenTiles(map.getContainer?.()));
  }

  function safeCanvasDataUrl(canvas, type = "image/jpeg", quality = 0.92) {
    if (!canvas) return "";
    try {
      return canvas.toDataURL(type, quality);
    } catch (err) {
      console.warn("layout-mode: canvas contaminado (CORS)", err);
      return "";
    }
  }

  function tileImageSafeToCopy(img) {
    if (!img?.src) return false;
    const src = String(img.src);
    if (src.startsWith("data:") || src.startsWith("blob:")) return true;
    const cors = String(img.crossOrigin || "").toLowerCase();
    return cors === "anonymous" || cors === "use-credentials";
  }

  function loadCorsImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const im = new Image();
      if (!String(src).startsWith("data:") && !String(src).startsWith("blob:")) {
        im.crossOrigin = "anonymous";
      }
      const timer = window.setTimeout(() => resolve(null), 2800);
      im.onload = () => {
        window.clearTimeout(timer);
        resolve(im);
      };
      im.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      im.src = src;
    });
  }

  function cloneBasemapTo(targetMap, optsIn = {}) {
    if (!targetMap || !window.L) return;
    const cors = !!optsIn.cors;
    const esriImg =
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    const cap = Number(optsIn.maxZoom) || EXPORT_MAX_ZOOM;
    const opts = {
      maxZoom: cap,
      maxNativeZoom: 19,
      opacity: 1,
      detectRetina: false,
      attribution: "© Esri",
      errorTileUrl: EMPTY_TILE,
    };
    if (cors) opts.crossOrigin = "anonymous";
    L.tileLayer(esriImg, opts).addTo(targetMap);
  }

  function sheetDrawStyle(meta) {
    const st = layerStyle(meta);
    return {
      ...st,
      color: st.color || "#e11d48",
      fillColor: st.fillColor || st.color || "#e11d48",
      weight: Math.max(2.5, Number(st.weight) || 2),
      radius: Math.max(6, Number(st.radius) || 6),
      opacity: 1,
      fillOpacity: st.fillOpacity ?? 0.35,
    };
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

  function geojsonForSheet(entry) {
    if (!entry) return null;
    const id = entry.meta?.id;
    if (sheetSoloSelection) {
      if (!layerAllowedOnSheet(id)) return null;
      const feats = (selectionGeojson?.features || []).filter((f) => f?.geometry);
      if (!feats.length) return null;
      return { type: "FeatureCollection", features: feats };
    }
    if (!layerIsOn(entry) || !layerAllowedOnSheet(id)) return null;
    let geojson = entry.geojson;
    if (!geojson && entry.leaflet?.toGeoJSON) {
      try {
        geojson = entry.leaflet.toGeoJSON();
      } catch {
        geojson = null;
      }
    }
    return geojson || null;
  }

  function cloneVisibleLayersTo(targetMap, opts = {}) {
    const pickable = !!opts.pickable;
    const radiusBoost = Number(opts.radiusBoost) || 0;
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    const soloGeo = sheetSoloSelection
      ? {
          type: "FeatureCollection",
          features: (selectionGeojson?.features || []).filter((f) => f?.geometry),
        }
      : null;
    const entries = soloGeo?.features?.length
      ? [
          {
            meta:
              Object.values(registry).find(
                (e) => String(e?.meta?.id) === String(selectedLayerId)
              )?.meta || { id: selectedLayerId, style: { color: "#e11d48", weight: 4 } },
            geojson: soloGeo,
          },
        ]
      : Object.values(registry);
    entries.forEach((entry) => {
      const geojson = soloGeo?.features?.length ? soloGeo : geojsonForSheet(entry);
      if (!geojson) return;
      const style = sheetDrawStyle(entry.meta);
      const layerId = entry.meta.id;
      const pointRadius = Math.max(3, (style.radius || 6) + radiusBoost);
      try {
        const group = L.geoJSON(geojson, {
          style: () => ({
            ...style,
            weight: style.weight,
            interactive: pickable,
          }),
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, {
              ...style,
              radius: pointRadius,
              interactive: pickable,
            }),
          interactive: pickable,
          onEachFeature: pickable
            ? (feature, layer) => {
                layer.on("click", (ev) => {
                  L.DomEvent.stopPropagation(ev);
                  setSelectedLayer(layerId);
                  if (document.getElementById("layout-include-popups")?.checked) {
                    window.InfraGeoHoverPopup?.addExportPin?.(
                      feature,
                      layer,
                      entry.meta,
                      ev.latlng
                    );
                    renderPopupPinList();
                    refreshMapSnapshots().catch(() => {});
                  }
                });
              }
            : undefined,
        }).addTo(targetMap);
        try {
          group.setStyle({ ...style, weight: style.weight });
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
            window.setTimeout(done, 80);
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

  const SAT_WAIT_HTML =
    `<div class="layout-map-sat-wait" hidden>` +
    `<span class="layout-map-sat-wait__spin" aria-hidden="true"></span>` +
    `<p>Carregando imagem de satélite…</p>` +
    `</div>` +
    `<div class="layout-map-zoom-limit" hidden role="status">` +
    `Limite de zoom excedido. Não há imagem de satélite neste nível.` +
    `</div>`;

  function satWaitRoot(from) {
    if (from?.closest) {
      const box = from.closest(".layout-el--map") || from.closest(".layout-sheet__map");
      if (box) return box.querySelector(".layout-map-sat-wait");
    }
    return document.querySelector(".layout-sheet .layout-map-sat-wait");
  }

  function setSatWait(on, from) {
    const el = satWaitRoot(from);
    if (!el) return;
    el.hidden = !on;
    el.setAttribute("aria-busy", on ? "true" : "false");
  }

  function bindSatWait(map, host) {
    if (!map || !host) return;
    setSatWait(true, host);
    const hide = () => setSatWait(false, host);
    map.on("loading", () => setSatWait(true, host));
    map.on("load", hide);
    waitForTiles(map, 9000).then(hide);
  }

  function bindLayoutZoomLimit(map, host) {
    if (!map) return;
    map.setMaxZoom(EXPORT_MAX_ZOOM);
    const box =
      host?.closest?.(".layout-el--map")?.querySelector(".layout-map-zoom-limit") ||
      document.querySelector(".layout-map-zoom-limit");
    const atCap = () => map.getZoom() >= map.getMaxZoom() - 0.05;
    const sync = () => {
      const on = atCap();
      if (box) box.hidden = !on;
      if (on) window.InfraGeoMap?.notifyZoomLimit?.(true);
    };
    map.on("zoomend", sync);
    map.on("zoom", () => {
      if (map.getZoom() > EXPORT_MAX_ZOOM) {
        map.setZoom(EXPORT_MAX_ZOOM, { animate: false });
        sync();
      }
    });
    host?.addEventListener(
      "wheel",
      (ev) => {
        if (ev.deltaY < 0 && atCap()) {
          if (box) box.hidden = false;
          window.InfraGeoMap?.notifyZoomLimit?.(true);
        }
      },
      { passive: true }
    );
    window.setTimeout(sync, 120);
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
      if (!tileImageSafeToCopy(img)) return;
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
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
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

  function paintOverlayCanvasesToCanvas(ctx, mapDiv, mapW, mapH) {
    const hostRect = mapDiv.getBoundingClientRect();
    if (!(hostRect.width > 0)) return 0;
    const scaleX = mapW / hostRect.width;
    const scaleY = mapH / hostRect.height;
    let painted = 0;
    mapDiv
      .querySelectorAll(".leaflet-overlay-pane canvas, .leaflet-marker-pane canvas")
      .forEach((cnv) => {
        if (!(cnv.width > 0) || !(cnv.height > 0)) return;
        try {
          const r = cnv.getBoundingClientRect();
          ctx.drawImage(
            cnv,
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

  function paintMapLayerGeojson(ctx, map) {
    if (!map?.eachLayer) return 0;
    let count = 0;
    map.eachLayer((layer) => {
      if (!layer || typeof layer.toGeoJSON !== "function") return;
      if (layer instanceof L.TileLayer || layer instanceof L.GridLayer) return;
      if (layer instanceof L.LayerGroup && !(layer instanceof L.GeoJSON)) return;
      let geojson = null;
      try {
        geojson = layer.toGeoJSON();
      } catch {
        return;
      }
      if (!geojson) return;
      const opt = layer.options || {};
      const style = {
        color: opt.color || "#111827",
        fillColor: opt.fillColor || opt.color || "#111827",
        weight: opt.weight ?? 2,
        opacity: opt.opacity ?? 1,
        fillOpacity: opt.fillOpacity ?? 0.2,
        radius: opt.radius || 6,
      };
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

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function ellipsizeText(ctx, text, maxW) {
    let t = String(text ?? "");
    if (!t) return "";
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  function boxesOverlap(a, b, pad = 8) {
    return !(
      a.x + a.w + pad <= b.x ||
      b.x + b.w + pad <= a.x ||
      a.y + a.h + pad <= b.y ||
      b.y + b.h + pad <= a.y
    );
  }

  function projectPin(leafletMap, pin, canvasW, canvasH) {
    const ll = window.L?.latLng?.(pin.lat, pin.lng);
    if (!ll || !leafletMap?.latLngToContainerPoint) return null;
    const raw = leafletMap.latLngToContainerPoint(ll);
    const size = leafletMap.getSize?.() || { x: canvasW, y: canvasH };
    const sx = size.x ? canvasW / size.x : 1;
    const sy = size.y ? canvasH / size.y : 1;
    return { x: raw.x * sx, y: raw.y * sy };
  }

  function paintExportPopupsOnMap(ctx, leafletMap) {
    if (!document.getElementById("layout-include-popups")?.checked) return;
    const pins = window.InfraGeoHoverPopup?.getExportPins?.() || [];
    if (!pins.length || !leafletMap?.latLngToContainerPoint) return;
    const canvasW = ctx.canvas?.width && ctx.getTransform
      ? ctx.canvas.width / (ctx.getTransform().a || 1)
      : leafletMap.getSize?.().x || 800;
    const canvasH = ctx.canvas?.height && ctx.getTransform
      ? ctx.canvas.height / (ctx.getTransform().d || 1)
      : leafletMap.getSize?.().y || 600;
    const size = { x: canvasW, y: canvasH };
    const cardW = 196;
    const rowH = 15;
    const headH = 26;
    const fontStack = "Segoe UI, Arial, sans-serif";
    const placed = [];
    const layout = pins.map((pin) => {
      const pt = projectPin(leafletMap, pin, canvasW, canvasH);
      if (!pt) return null;
      const rows = (pin.rows || []).slice(0, 3);
      const cardH = headH + 8 + rows.length * rowH + 8;
      const clamp = (x, y) => ({
        x: Math.max(8, Math.min(x, size.x - cardW - 8)),
        y: Math.max(8, Math.min(y, size.y - cardH - 8)),
        w: cardW,
        h: cardH,
      });
      const candidates = [
        clamp(pt.x - cardW / 2, pt.y - cardH - 20),
        clamp(pt.x + 18, pt.y - cardH - 10),
        clamp(pt.x - cardW - 18, pt.y - cardH - 10),
        clamp(pt.x + 18, pt.y + 16),
        clamp(pt.x - cardW - 18, pt.y + 16),
        clamp(pt.x - cardW / 2, pt.y + 16),
      ];
      const free = candidates.filter((c) => !placed.some((p) => boxesOverlap(c, p)));
      const score = (c) => Math.hypot(c.x + c.w / 2 - pt.x, c.y + c.h / 2 - pt.y);
      const box = (free.length ? free : candidates).slice().sort((a, b) => score(a) - score(b))[0];
      placed.push(box);
      return { pin, pt, rows, box, cardH };
    }).filter(Boolean);

    layout.forEach(({ pin, pt }) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = pin.color || "#f59e0b";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    layout.forEach(({ pin, pt, rows, box }) => {
      const { x, y, w, h } = box;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      const cx = Math.max(x + 12, Math.min(pt.x, x + w - 12));
      const cy = pt.y < y ? y : pt.y > y + h ? y + h : y + h;
      ctx.lineTo(cx, cy);
      ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.shadowColor = "rgba(16, 42, 67, 0.22)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;
      roundRectPath(ctx, x, y, w, h, 10);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#e6edf4";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x + 14, y + 14, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = pin.color || "#f59e0b";
      ctx.fill();

      ctx.fillStyle = "#12263a";
      ctx.font = `700 12px ${fontStack}`;
      ctx.fillText(ellipsizeText(ctx, pin.title || "Ponto", w - 36), x + 24, y + 18);

      ctx.font = `500 10px ${fontStack}`;
      rows.forEach((row, i) => {
        const yy = y + headH + 6 + i * rowH;
        ctx.fillStyle = "#7a8ca0";
        ctx.fillText(ellipsizeText(ctx, row.label || "", 72), x + 12, yy);
        ctx.fillStyle = "#16324f";
        ctx.fillText(ellipsizeText(ctx, row.value || "", w - 96), x + 88, yy);
      });
      ctx.restore();
    });
  }

  function captureLeafletView(leafletMap, scale = 2) {
    if (!leafletMap || !window.L) return "";
    const mapDiv = leafletMap.getContainer?.();
    const size = leafletMap.getSize?.();
    const w = Math.round(size?.x || mapDiv?.clientWidth || 0);
    const h = Math.round(size?.y || mapDiv?.clientHeight || 0);
    if (!mapDiv || w < 40 || h < 40) return "";
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintBasemapTilesToCanvas(ctx, mapDiv, w, h);
    paintOverlayCanvasesToCanvas(ctx, mapDiv, w, h);
    const drawnView = paintVisibleLayersToCanvas(ctx, leafletMap);
    if (!drawnView) paintMapLayerGeojson(ctx, leafletMap);
    paintExportPopupsOnMap(ctx, leafletMap);
    return safeCanvasDataUrl(canvas, "image/jpeg", 0.97);
  }

  async function paintBasemapTilesToCanvasAsync(ctx, mapDiv, mapW, mapH) {
    const bg = window.getComputedStyle(mapDiv).backgroundColor || "#dbe4ea";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, mapW, mapH);
    const hostRect = mapDiv.getBoundingClientRect();
    if (!(hostRect.width > 0) || !(hostRect.height > 0)) return 0;
    const scaleX = mapW / hostRect.width;
    const scaleY = mapH / hostRect.height;
    const tiles = [...mapDiv.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")];
    let painted = 0;
    await Promise.all(
      tiles.map(async (img) => {
        if (!img.complete || !(img.naturalWidth > 0)) return;
        const r = img.getBoundingClientRect();
        const dx = (r.left - hostRect.left) * scaleX;
        const dy = (r.top - hostRect.top) * scaleY;
        const dw = r.width * scaleX;
        const dh = r.height * scaleY;
        let src = img;
        if (!tileImageSafeToCopy(img)) {
          src = await loadCorsImage(img.currentSrc || img.src);
        }
        if (!src) return;
        try {
          ctx.drawImage(src, dx, dy, dw, dh);
          painted += 1;
        } catch {
          /* tainted */
        }
      })
    );
    return painted;
  }

  async function captureLeafletViewAsync(leafletMap, scale = 2) {
    if (!leafletMap || !window.L) return "";
    const mapDiv = leafletMap.getContainer?.();
    const size = leafletMap.getSize?.();
    const w = Math.round(size?.x || mapDiv?.clientWidth || 0);
    const h = Math.round(size?.y || mapDiv?.clientHeight || 0);
    if (!mapDiv || w < 40 || h < 40) return "";
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const painted = await paintBasemapTilesToCanvasAsync(ctx, mapDiv, w, h);
    paintOverlayCanvasesToCanvas(ctx, mapDiv, w, h);
    const drawnAsync = paintVisibleLayersToCanvas(ctx, leafletMap);
    if (!drawnAsync) paintMapLayerGeojson(ctx, leafletMap);
    paintExportPopupsOnMap(ctx, leafletMap);
    let url = safeCanvasDataUrl(canvas, "image/jpeg", 0.97);
    if (painted && url) return url;
    const cloned = await captureMapDataUrl({
      w: Math.max(720, w * 2),
      h: Math.max(480, h * 2),
      center: leafletMap.getCenter?.()
        ? [leafletMap.getCenter().lat, leafletMap.getCenter().lng]
        : null,
      zoom: leafletMap.getZoom?.(),
      bounds: boundsFromMap(leafletMap),
    });
    if (cloned) return cloned;
    if (url) return url;
    if (window.html2canvas) {
      try {
        purgeBrokenTiles(mapDiv);
        const shot = await window.html2canvas(mapDiv, {
          useCORS: true,
          allowTaint: false,
          backgroundColor: null,
          scale,
          logging: false,
          ignoreElements(el) {
            return (
              el instanceof HTMLImageElement &&
              el.classList.contains("leaflet-tile") &&
              (el.classList.contains("leaflet-tile-error") ||
                (el.complete && el.naturalWidth === 0))
            );
          },
        });
        url = safeCanvasDataUrl(shot, "image/jpeg", 0.97);
      } catch {
        url = "";
      }
    }
    return url;
  }

  function placeFreezeImage(host, src) {
    if (!host) return;
    host.querySelectorAll(".layout-export-freeze").forEach((n) => n.remove());
    if (!src) return;
    const img = document.createElement("img");
    img.className = "layout-export-freeze";
    img.alt = "";
    img.src = src;
    host.appendChild(img);
  }

  function paintVisibleLayersToCanvas(ctx, map) {
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    let count = 0;
    const soloFeats = sheetSoloSelection
      ? (selectionGeojson?.features || []).filter((f) => f?.geometry)
      : null;
    const paintEntry = (entry, geojson) => {
      if (!geojson) return;
      const style = sheetDrawStyle(entry?.meta || { style: { color: "#e11d48", weight: 10 } });
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
    };
    if (soloFeats?.length) {
      const meta =
        Object.values(registry).find((e) => String(e?.meta?.id) === String(selectedLayerId))
          ?.meta || { style: { color: "#e11d48", weight: 10 } };
      paintEntry({ meta }, { type: "FeatureCollection", features: soloFeats });
      return count;
    }
    Object.values(registry).forEach((entry) => {
      paintEntry(entry, geojsonForSheet(entry));
    });
    return count;
  }

  async function captureMapDataUrl(opts = {}) {
    const main = window.InfraGeoMap?.getMap?.();
    if (!main || !window.L) return "";
    const w = Math.max(320, Math.round(opts.w || 900));
    const h = Math.max(240, Math.round(opts.h || 560));
    const source = adjustLeaflet || main;

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
        maxZoom: EXPORT_MAX_ZOOM,
      });
      hideBrokenTiles(exportMap);
      cloneBasemapTo(exportMap, { cors: true });
      cloneVisibleLayersTo(exportMap);
      applyViewToMap(exportMap, {
        bounds: opts.bounds || boundsFromMap(source),
        center: opts.center,
        zoom: opts.zoom,
      }, source);
      exportMap.invalidateSize({ animate: false });
      await wait(120);
      exportMap.invalidateSize({ animate: false });
      await waitForTiles(exportMap, 8000);
      await wait(280);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const painted = await paintBasemapTilesToCanvasAsync(ctx, mapDiv, w, h);
      paintOverlayCanvasesToCanvas(ctx, mapDiv, w, h);
      const drawn = paintVisibleLayersToCanvas(ctx, exportMap);
      if (!drawn) paintMapLayerGeojson(ctx, exportMap);
      paintExportPopupsOnMap(ctx, exportMap);

      if (!painted && !drawn) {
        if (window.html2canvas) {
          const shot = await window.html2canvas(mapDiv, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: "#dbe4ea",
            scale: 2,
            logging: false,
          });
          return safeCanvasDataUrl(shot, "image/jpeg", 0.96);
        }
        return "";
      }
      return safeCanvasDataUrl(canvas, "image/jpeg", 0.96);
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

  async function snapshotMapForExport(it) {
    persistAdjustView();
    const scale = mapExportScale();
    const liveEl = document.querySelector(
      `.layout-el--map[data-id="${it.id}"] .layout-map-live`
    );
    const rw = liveEl?.clientWidth || it.w || 900;
    const rh = liveEl?.clientHeight || it.h || 560;
    const hi = await captureMapDataUrl({
      w: Math.max(960, Math.round(rw * scale)),
      h: Math.max(640, Math.round(rh * scale)),
      center: it.center,
      zoom: it.zoom,
      bounds: it.bounds || boundsFromMap(adjustLeaflet),
    });
    if (hi) return hi;
    if (adjustLeaflet && adjustMapId === it.id) {
      const live = await captureLeafletViewAsync(adjustLeaflet, scale);
      if (live) return live;
    }
    return "";
  }

  async function refreshMapSnapshots() {
    persistAdjustView();
    const maps = items.filter((it) => it.type === "map" && it.visible !== false);
    if (!maps.length) return;
    for (const it of maps) {
      const url = await snapshotMapForExport(it);
      if (url) it.src = url;
    }
    renderAll();
  }

  async function waitForPageImages(page) {
    const imgs = [...(page?.querySelectorAll("img") || [])];
    await Promise.all(
      imgs.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
              })
      )
    );
  }

  async function preparePageForExport() {
    persistAdjustView();
    persistLocatorView();
    const resumeId = adjustMapId;
    const resumeMode = mapInteractMode;
    const wrap = document.getElementById("layout-page-wrap");
    const prevTransform = wrap?.style.transform || "";
    if (wrap) wrap.style.transform = "none";
    const page = pageEl();
    page?.classList.add("is-exporting");
    purgeBrokenTiles(page);
    if (adjustLeaflet?.getContainer) purgeBrokenTiles(adjustLeaflet.getContainer());
    if (locatorLive?.getContainer) purgeBrokenTiles(locatorLive.getContainer());
    const scale = mapExportScale();
    const mapHost = document.querySelector(".layout-el--map .layout-map-live");
    const locHost = document.querySelector(".layout-locator__live");
    let mapShot = "";
    if (adjustLeaflet) {
      mapShot = await captureMapDataUrl({
        w: Math.max(960, Math.round((mapHost?.clientWidth || 900) * scale)),
        h: Math.max(640, Math.round((mapHost?.clientHeight || 560) * scale)),
        center: adjustLeaflet.getCenter?.()
          ? [adjustLeaflet.getCenter().lat, adjustLeaflet.getCenter().lng]
          : null,
        zoom: adjustLeaflet.getZoom?.(),
        bounds: boundsFromMap(adjustLeaflet),
      });
      if (!mapShot) mapShot = await captureLeafletViewAsync(adjustLeaflet, scale);
    }
    const locShot = locatorLive
      ? await captureLeafletViewAsync(locatorLive, Math.max(2, scale - 1))
      : "";
    placeFreezeImage(document.querySelector(".layout-el--map"), mapShot);
    placeFreezeImage(document.querySelector(".layout-locator"), locShot);
    page?.querySelectorAll("[contenteditable]").forEach((el) => {
      el.setAttribute("contenteditable", "false");
    });
    await wait(80);
    await waitForPageImages(page);
    await wait(40);
    return { resumeId, resumeMode, prevTransform };
  }

  function finishPageExport(resume) {
    pageEl()?.classList.remove("is-exporting");
    document.querySelectorAll(".layout-export-freeze").forEach((n) => n.remove());
    const wrap = document.getElementById("layout-page-wrap");
    if (wrap) wrap.style.transform = resume?.prevTransform || "";
    if (!resume?.prevTransform) setPreviewZoom(previewZoom);
    items.forEach((it) => {
      if (it._exportBox) delete it._exportBox;
    });
  }

  async function captureSheetCanvas() {
    const page = pageEl();
    const scale = Math.min(4, Math.max(2, dpi() / 150));
    return window.html2canvas(page, {
      backgroundColor: "#fbfaf7",
      scale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      letterRendering: true,
      windowWidth: page.scrollWidth,
      windowHeight: page.scrollHeight,
      ignoreElements(el) {
        if (!(el instanceof Element)) return false;
        if (el.classList.contains("layout-export-freeze")) return false;
        return (
          el.id === "layout-locator-engine" ||
          el.classList.contains("layout-locator-engine") ||
          el.classList.contains("layout-map-live") ||
          el.classList.contains("layout-locator__live") ||
          el.classList.contains("leaflet-tile-pane") ||
          el.classList.contains("leaflet-tile") ||
          el.classList.contains("leaflet-container") ||
          el.classList.contains("layout-sheet__overlay-remove") ||
          el.classList.contains("layout-sheet__overlay-resize")
        );
      },
      onclone(doc) {
        const wrap = doc.getElementById("layout-page-wrap");
        if (wrap) wrap.style.transform = "none";
        const cloned = doc.getElementById("layout-page");
        cloned?.classList.add("is-exporting");
        cloned?.querySelectorAll("img.leaflet-tile").forEach((img) => {
          if (!img.complete || img.naturalWidth === 0 || img.classList.contains("leaflet-tile-error")) {
            img.remove();
          }
        });
        cloned?.querySelectorAll(".layout-map-live, .layout-locator__live, .leaflet-container").forEach((n) => {
          n.style.visibility = "hidden";
        });
      },
    });
  }

  async function stopAdjustMap(commit) {
    if (adjustMapId == null) return;
    const item = items.find((it) => it.id === adjustMapId);
    const wasPick = mapInteractMode === "pick" || mapInteractMode === "select";
    if (adjustLeaflet && item && commit && !wasPick) {
      try {
        const c = adjustLeaflet.getCenter();
        item.center = [c.lat, c.lng];
        item.zoom = Math.min(adjustLeaflet.getZoom(), EXPORT_MAX_ZOOM);
        const b = boundsFromMap(adjustLeaflet);
        if (b) item.bounds = b;
        const live = captureLeafletView(adjustLeaflet, 2);
        if (live) item.src = live;
        else {
          const url = await captureMapDataUrl({
            w: Math.max(720, item.w * 2),
            h: Math.max(480, item.h * 2),
            center: item.center,
            zoom: item.zoom,
            bounds: item.bounds,
          });
          if (url) item.src = url;
        }
      } catch (err) {
        console.warn("layout-mode: concluir ajuste", err);
      }
    }
    if (wasPick && commit) {
      // Mantém a camada selecionada; só fecha o cursor
      await refreshMapSnapshots().catch(() => {});
    }
    try {
      boxDrawCleanup?.();
      boxDrawCleanup = null;
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
    document.getElementById("btn-layout-box-select")?.classList.remove("is-active");
    document.getElementById("btn-layout-box-select")?.setAttribute("aria-pressed", "false");
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

  function featureIntersectsBounds(feature, bounds) {
    const geom = feature?.geometry;
    if (!geom || !bounds) return false;
    const pts = [];
    const walk = (c) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number" && typeof c[1] === "number") {
        pts.push([c[1], c[0]]);
        return;
      }
      c.forEach(walk);
    };
    walk(geom.coordinates);
    if (!pts.length) return false;
    try {
      return bounds.intersects(L.latLngBounds(pts));
    } catch {
      return pts.some((p) => bounds.contains(p));
    }
  }

  function isCoveringPolygon(feature, bounds) {
    const t = String(feature?.geometry?.type || "");
    if (!/polygon/i.test(t)) return false;
    try {
      const fb = boundsFromCollection({
        type: "FeatureCollection",
        features: [feature],
      });
      if (!fb?.isValid?.()) return false;
      const selH = Math.abs(bounds.getNorth() - bounds.getSouth());
      const selW = Math.abs(bounds.getEast() - bounds.getWest());
      const fH = Math.abs(fb.getNorth() - fb.getSouth());
      const fW = Math.abs(fb.getEast() - fb.getWest());
      return fH * fW > selH * selW * 8;
    } catch {
      return false;
    }
  }

  function collectFeaturesInBounds(bounds) {
    const features = [];
    const counts = {};
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    Object.values(registry).forEach((entry) => {
      if (!layerIsOn(entry)) return;
      const id = entry.meta?.id;
      if (selectedLayerId && id && String(id) !== String(selectedLayerId)) return;
      let geojson = entry.geojson;
      if (!geojson && entry.leaflet?.toGeoJSON) {
        try {
          geojson = entry.leaflet.toGeoJSON();
        } catch {
          geojson = null;
        }
      }
      if (!geojson) return;
      const list =
        geojson.type === "FeatureCollection"
          ? geojson.features || []
          : geojson.type === "Feature"
            ? [geojson]
            : [{ type: "Feature", geometry: geojson, properties: {} }];
      list.forEach((f) => {
        if (!featureIntersectsBounds(f, bounds)) return;
        if (isCoveringPolygon(f, bounds)) return;
        features.push({
          type: "Feature",
          geometry: f.geometry,
          properties: { ...(f.properties || {}), _layerId: id },
        });
        if (id) counts[id] = (counts[id] || 0) + 1;
      });
    });
    return { type: "FeatureCollection", features, counts };
  }

  function boundsFromCollection(collection) {
    const feats = collection?.features || [];
    const pts = [];
    const walk = (c) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number" && typeof c[1] === "number") {
        pts.push([c[1], c[0]]);
        return;
      }
      c.forEach(walk);
    };
    feats.forEach((f) => walk(f?.geometry?.coordinates));
    if (!pts.length || !window.L) return null;
    try {
      const b = L.latLngBounds(pts);
      return b.isValid() ? b : null;
    } catch {
      return null;
    }
  }

  function expandBoundsForSheet(b) {
    if (!b?.isValid?.()) return b;
    const dlat = Math.abs(b.getNorth() - b.getSouth());
    const dlng = Math.abs(b.getEast() - b.getWest());
    const pad = Math.max(0.035, Math.max(dlat, dlng) * 0.55);
    const c = b.getCenter();
    return L.latLngBounds(
      [c.lat - pad, c.lng - pad],
      [c.lat + pad, c.lng + pad]
    );
  }

  function boundsToItem(bounds) {
    if (!bounds) return null;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    return [
      [sw.lat, sw.lng],
      [ne.lat, ne.lng],
    ];
  }

  function applyDrawnSelection(bounds, fromMount) {
    if (!bounds || !bounds.isValid?.()) return;
    if (Math.abs(bounds.getNorth() - bounds.getSouth()) < 1e-8) return;
    selectionBounds = bounds;
    const item = items.find((it) => it.id === adjustMapId);
    if (item) {
      item.bounds = boundsToItem(bounds);
      const c = bounds.getCenter();
      item.center = [c.lat, c.lng];
    }
    try {
      selectionHighlight?.remove?.();
      selectionRectLayer?.remove?.();
    } catch {
      /* ignore */
    }
    selectionHighlight = null;
    selectionRectLayer = null;
    const fc = collectFeaturesInBounds(bounds);
    const counts = fc.counts || {};
    let best = null;
    let bestN = 0;
    Object.entries(counts).forEach(([id, n]) => {
      if (n > bestN) {
        bestN = n;
        best = id;
      }
    });
    if (best) selectedLayerId = best;
    selectionGeojson = {
      type: "FeatureCollection",
      features: (fc.features || []).filter(
        (f) => !best || String(f.properties?._layerId) === String(best)
      ),
    };
    if (selectionGeojson.features.length) sheetSoloSelection = true;
    if (!fromMount) {
      syncLayerSelectUi();
      refreshSoloMap();
      return;
    }
    if (adjustLeaflet) {
      selectionRectLayer = L.rectangle(bounds, {
        color: "#0f3b34",
        weight: 2,
        dashArray: "7 5",
        fillColor: "#0f3b34",
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(adjustLeaflet);
      if (fc.features.length) {
        selectionHighlight = L.geoJSON(fc, {
          style: {
            color: "#f59e0b",
            weight: 3,
            fillColor: "#f59e0b",
            fillOpacity: 0.18,
            interactive: false,
          },
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, {
              radius: 8,
              color: "#f59e0b",
              fillColor: "#f59e0b",
              fillOpacity: 0.85,
              weight: 2,
              interactive: false,
            }),
        }).addTo(adjustLeaflet);
      }
    }
    const hint = document.getElementById("layout-box-select-hint");
    if (hint) {
      const n = selectionGeojson?.features?.length || 0;
      hint.textContent = n
        ? `${n} feição(ões) na seleção. Mova o mapa ou desenhe outra área.`
        : "Área definida. Mova o mapa ou desenhe novamente.";
    }
    const pickHint = document.querySelector(".layout-pick-hint");
    if (pickHint) {
      pickHint.textContent = boxDrawArmed
        ? "Arraste para desenhar · Mover para navegar"
        : "Arraste para mover · Desenhar ou Shift+arraste para selecionar";
    }
    syncLayerSelectUi();
  }

  function selectionCollectionForExport() {
    if (selectionGeojson?.features?.length) {
      return {
        type: "FeatureCollection",
        features: selectionGeojson.features.map((f) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: Object.fromEntries(
            Object.entries(f.properties || {}).filter(([k]) => k !== "_layerId")
          ),
        })),
      };
    }
    if (!selectedLayerId) return { type: "FeatureCollection", features: [] };
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    const entry = Object.values(registry).find(
      (e) => String(e.meta?.id) === String(selectedLayerId)
    );
    if (!entry) return { type: "FeatureCollection", features: [] };
    let geojson = entry.geojson;
    if (!geojson && entry.leaflet?.toGeoJSON) {
      try {
        geojson = entry.leaflet.toGeoJSON();
      } catch {
        geojson = null;
      }
    }
    if (!geojson) return { type: "FeatureCollection", features: [] };
    if (geojson.type === "FeatureCollection") return geojson;
    if (geojson.type === "Feature") return { type: "FeatureCollection", features: [geojson] };
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: geojson, properties: {} }],
    };
  }

  async function exportSelectedShp() {
    const collection = selectionCollectionForExport();
    if (!collection.features?.length) {
      window.alert("Selecione uma camada ou desenhe a área no mapa antes de exportar o SHP.");
      return;
    }
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    const entry = Object.values(registry).find(
      (e) => String(e.meta?.id) === String(selectedLayerId)
    );
    const name = (entry?.meta?.name || "selecao").replace(/\s+/g, "_");
    const url = window.InfraGeoApi?.url?.("/api/postgis/export-shp") || "/api/postgis/export-shp";
    const headers = window.InfraGeoAuth?.authHeaders?.({ "Content-Type": "application/json" }) || {
      "Content-Type": "application/json",
    };
    const res = await fetch(url, {
      method: "POST",
      credentials: window.InfraGeoApi?.credentials?.() || "include",
      headers,
      body: JSON.stringify({ name, collection }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg =
        (typeof data.detail === "string" && data.detail) ||
        data.message ||
        `Não foi possível exportar o SHP (${res.status})`;
      throw new Error(msg);
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function setBoxDrawArmed(on) {
    boxDrawArmed = !!on;
    if (adjustLeaflet) {
      try {
        if (boxDrawArmed) adjustLeaflet.dragging.disable();
        else adjustLeaflet.dragging.enable();
      } catch {
        /* ignore */
      }
      const cur = boxDrawArmed ? "crosshair" : "grab";
      adjustLeaflet.getContainer().style.cursor = cur;
      const live = document.querySelector(".layout-el--map.is-selecting .layout-map-live");
      if (live) live.style.cursor = cur;
      document.querySelector(".layout-el--map.is-selecting")?.classList.toggle("is-picking", boxDrawArmed);
    }
    syncLayerSelectUi();
    const pickHint = document.querySelector(".layout-pick-hint");
    if (pickHint && mapInteractMode === "select") {
      pickHint.textContent = boxDrawArmed
        ? "Arraste para desenhar a área"
        : "Arraste para mover o mapa · Shift+arraste para selecionar";
    }
  }

  function clearDrawnSelection() {
    selectionBounds = null;
    selectionGeojson = null;
    selectedLayerId = null;
    try {
      selectionHighlight?.remove?.();
      selectionRectLayer?.remove?.();
    } catch {
      /* ignore */
    }
    selectionHighlight = null;
    selectionRectLayer = null;
    const hint = document.getElementById("layout-box-select-hint");
    if (hint) {
      hint.textContent = "O cursor vira uma cruz: arraste no mapa para desenhar a área.";
    }
    refreshSoloMap();
  }

  function attachBoxDraw(map) {
    boxDrawCleanup?.();
    if (!map) return;
    map.boxZoom?.disable?.();
    try {
      if (boxDrawArmed) map.dragging.disable();
      else map.dragging.enable();
    } catch {
      /* ignore */
    }
    const el = map.getContainer();
    el.style.cursor = boxDrawArmed ? "crosshair" : "grab";
    el.classList.toggle("is-box-select", boxDrawArmed);
    let startPt = null;
    let rubber = null;

    const place = (a, b) => {
      if (!rubber) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      rubber.style.left = `${x}px`;
      rubber.style.top = `${y}px`;
      rubber.style.width = `${Math.abs(b.x - a.x)}px`;
      rubber.style.height = `${Math.abs(b.y - a.y)}px`;
    };

    const onMove = (ev) => {
      if (!startPt || !rubber) return;
      place(startPt, map.mouseEventToContainerPoint(ev));
    };

    const onUp = (ev) => {
      L.DomEvent.off(document, "mousemove", onMove);
      L.DomEvent.off(document, "mouseup", onUp);
      if (!startPt) return;
      const origin = startPt;
      const endPt = map.mouseEventToContainerPoint(ev);
      const a = map.containerPointToLatLng(origin);
      const b = map.containerPointToLatLng(endPt);
      startPt = null;
      rubber?.remove?.();
      rubber = null;
      if (!boxDrawArmed) {
        try {
          map.dragging.enable();
        } catch {
          /* ignore */
        }
      }
      if (Math.abs(endPt.x - origin.x) < 8 && Math.abs(endPt.y - origin.y) < 8) {
        return;
      }
      applyDrawnSelection(L.latLngBounds(a, b));
    };

    const onDown = (ev) => {
      const oe = ev.originalEvent || ev;
      if (oe.button != null && oe.button !== 0) return;
      const shift = !!oe.shiftKey;
      if (!boxDrawArmed && !shift) return;
      L.DomEvent.preventDefault(ev);
      L.DomEvent.stopPropagation(ev);
      try {
        map.dragging.disable();
      } catch {
        /* ignore */
      }
      startPt = ev.containerPoint || map.mouseEventToContainerPoint(oe);
      rubber?.remove?.();
      rubber = document.createElement("div");
      rubber.className = "layout-select-box";
      el.appendChild(rubber);
      place(startPt, startPt);
      L.DomEvent.on(document, "mousemove", onMove);
      L.DomEvent.on(document, "mouseup", onUp);
    };

    map.on("mousedown", onDown);
    boxDrawCleanup = () => {
      map.off("mousedown", onDown);
      L.DomEvent.off(document, "mousemove", onMove);
      L.DomEvent.off(document, "mouseup", onUp);
      rubber?.remove?.();
      el.classList.remove("is-box-select");
      try {
        map.dragging.enable();
      } catch {
        /* ignore */
      }
      boxDrawCleanup = null;
    };
  }

  function startBoxSelect(targetId) {
    setLayersPop(false);
    if (mapInteractMode === "select" && adjustMapId != null && adjustLeaflet) {
      setBoxDrawArmed(true);
      return;
    }
    boxDrawArmed = true;
    startMapInteract("select", targetId);
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
    if (mapInteractMode === "adjust") return;
    if (!mapInteractMode || adjustMapId == null) return;
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest(".layout-el--map.is-adjusting")) return;
    if (t.closest("#btn-layout-adjust-map, [data-add='adjust-map']")) return;
    if (t.closest("#btn-layout-pick-layer, [data-add='pick-layer']")) return;
    if (t.closest("#btn-layout-box-select, #btn-layout-box-clear, #btn-layout-export-shp")) return;
    if (t.closest("#layout-layers-pop, #btn-layout-layers")) return;
    if (t.closest("[data-select-nav], [data-select-draw], [data-export-shp]")) return;
    if (t.closest("#btn-layout-back-map, .layout-studio__back")) return;
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
    const picking = mapInteractMode === "pick";
    const selecting = mapInteractMode === "select";

    adjustLeaflet = L.map(host, {
      zoomControl: !picking,
      attributionControl: false,
      maxZoom: EXPORT_MAX_ZOOM,
      dragging: !picking && !(selecting && boxDrawArmed),
      boxZoom: false,
    });
    hideBrokenTiles(adjustLeaflet);
    applyViewToMap(adjustLeaflet, item, main);

    if (picking) {
      host.style.cursor = "crosshair";
      adjustLeaflet.getContainer().style.cursor = "crosshair";
    } else if (selecting) {
      const cur = boxDrawArmed ? "crosshair" : "grab";
      host.style.cursor = cur;
      adjustLeaflet.getContainer().style.cursor = cur;
    }

    cloneBasemapTo(adjustLeaflet);
    bindSatWait(adjustLeaflet, host);
    bindLayoutZoomLimit(adjustLeaflet, host);
    cloneVisibleLayersTo(adjustLeaflet, {
      pickable:
        picking || !!document.getElementById("layout-include-popups")?.checked,
    });
    if (picking || (selecting && boxDrawArmed)) {
      try {
        adjustLeaflet.doubleClickZoom?.disable?.();
      } catch {
        /* ignore */
      }
    }
    adjustLeaflet.invalidateSize({ animate: false });
    applyViewToMap(adjustLeaflet, item, main);
    window.setTimeout(() => {
      adjustLeaflet?.invalidateSize?.({ animate: false });
      applyViewToMap(adjustLeaflet, item, main);
      if (selecting && adjustLeaflet) attachBoxDraw(adjustLeaflet);
    }, 80);

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
        opts.text !== undefined
          ? opts.text
          : type === "title"
            ? "Título do Mapa"
            : type === "subtitle"
              ? "Subtítulo"
              : type === "text"
                ? "Texto livre"
                : "",
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
    const entries = visibleLayerEntries().sort((a, b) => {
      const d = layerGeomKind(a) - layerGeomKind(b);
      if (d) return d;
      return String(a.meta?.name || "").localeCompare(String(b.meta?.name || ""));
    });
    const layers = entries.map((entry) => {
      const st = layerStyle(entry.meta);
      const color = safeColor(st.fillColor || st.color || "#64748b");
      const kind = layerGeomKind(entry);
      const shape =
        kind === 1
          ? "layout-legend__swatch--line"
          : kind === 2
            ? "layout-legend__swatch--point"
            : "layout-legend__swatch--area";
      const swatch = `<span class="layout-legend__swatch ${shape}" style="--sw:${color};background:${color}"></span>`;
      return (
        `<div class="layout-legend__row">${swatch}` +
        `<span class="layout-legend__name">${esc(entry.meta.name || entry.meta.id)}</span></div>`
      );
    });
    const n = layers.length;
    const compose = resolveComposition();
    const cls = ["layout-legend", compose === "classic" || compose === "full" ? "is-inline" : "is-stack"];
    const body = n
      ? layers.join("")
      : `<div class="layout-legend__empty">Nenhuma camada visível</div>`;
    return (
      `<div class="${cls.join(" ")}">` +
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

    if (it.role === "footer-legend") {
      el.style.overflow = "visible";
      el.style.height = `${it.h || 28}px`;
      return;
    }

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
    const ratio = document.getElementById("layout-scale-ratio")?.value;
    if (ratio && ratio !== "auto") return ratio;
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
    if (!list || list.closest(".layout-studio__sr")) return;
    list.innerHTML = "";
    [...items].reverse().forEach((it) => {
      const li = document.createElement("li");
      li.className = `layout-mode__item${selectedId === it.id ? " is-selected" : ""}`;
      li.innerHTML = `
        <button type="button" data-vis="${esc(it.id)}" title="Visibilidade">${it.visible ? "👁" : "🚫"}</button>
        <span class="layout-mode__item-name">${esc(itemListLabel(it))}</span>
        <button type="button" data-del="${esc(it.id)}" title="Excluir">×</button>
      `;
      li.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-vis]") || ev.target.closest("[data-del]")) return;
        selectItem(it.id);
      });
      list.appendChild(li);
    });
  }

  function renderItemDom(it, opts = {}) {
    const el = document.createElement("div");
    el.className = `layout-el layout-el--${it.type}${selectedId === it.id ? " is-selected" : ""}${
      it.visible ? "" : " is-hidden"
    }`;
    if (it.role) el.classList.add(`layout-el-role--${it.role}`);
    el.dataset.id = String(it.id);
    if (opts.flow) {
      el.style.position = "relative";
      el.style.inset = "auto";
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.left = "0";
      el.style.top = "0";
    } else {
      el.style.left = `${it.x}px`;
      el.style.top = `${it.y}px`;
    }
    if (!opts.flow && it.type !== "triangle" && it.type !== "line") {
      el.style.width = `${it.w}px`;
      el.style.height = `${it.h}px`;
    } else if (!opts.flow && it.type === "line") {
      el.style.width = `${it.w}px`;
    } else if (!opts.flow && it.type === "triangle") {
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
        el.contentEditable = it.role === "hero-title" ? "false" : "true";
        el.spellcheck = false;
        el.textContent = it.text || "";
        if (el.contentEditable === "true") {
          el.addEventListener("input", () => {
            it.text = el.textContent || "";
          });
        }
      }
    } else if (it.type === "map") {
      const adjusting = adjustMapId === it.id;
      if (adjusting) {
        const picking = mapInteractMode === "pick";
        const selecting = mapInteractMode === "select";
        el.classList.add("is-adjusting");
        if (picking || (selecting && boxDrawArmed)) el.classList.add("is-picking");
        if (selecting) el.classList.add("is-selecting");
        el.innerHTML = picking
          ? `<div class="layout-map-adjust-bar">
            <button type="button" class="is-primary" data-map-done="1">Concluir seleção</button>
            <span class="layout-pick-hint">${
              selectedLayerId
                ? "Camada selecionada"
                : "Clique na feição no mapa"
            }</span>
          </div>
          <div class="layout-map-live"></div>${SAT_WAIT_HTML}`
          : selecting
            ? `<div class="layout-map-adjust-bar">
            <button type="button" class="is-primary" data-map-done="1">Concluir</button>
            <span class="layout-pick-hint">Arraste no mapa para marcar a área</span>
          </div>
          <div class="layout-map-live"></div>${SAT_WAIT_HTML}`
          : `<div class="layout-map-live" title="Arraste para mover. Duplo clique para sair."></div>${SAT_WAIT_HTML}`;
        el.querySelector("[data-map-done]")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          stopAdjustMap(true).catch((e) => window.alert(e.message || e));
        });
        el.querySelector(".layout-map-live")?.addEventListener("dblclick", (ev) => {
          if (mapInteractMode === "select" && !boxDrawArmed) return;
          ev.stopPropagation();
          ev.preventDefault();
          stopAdjustMap(true).catch(() => {});
        });
      } else if (pageEl()?.classList.contains("is-exporting")) {
        const mapSrc = safeImgSrc(it.src);
        el.innerHTML = mapSrc
          ? `<img alt="Mapa" src="${mapSrc}" />`
          : `<div class="layout-map-placeholder">Atualizar Mapa ou Ajustar Mapa</div>`;
      } else {
        el.classList.add("is-adjusting");
        el.innerHTML =
          `<div class="layout-map-live" title="Arraste para mover. Duplo clique para enquadrar."></div>` +
          SAT_WAIT_HTML;
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
          `<span>${esc(scaleLabel())}</span>` +
          `<div class="layout-el--scale-bar"></div>` +
          `</div></div>`;
      } else if (it.role === "map-scale") {
        el.innerHTML =
          `<div class="layout-map-scale">` +
          `<span>${esc(scaleLabel())}</span>` +
          `<div class="layout-el--scale-bar"></div>` +
          `</div>`;
      } else {
        el.innerHTML = `<div class="layout-el--scale-bar"></div><span>${esc(scaleLabel())}</span>`;
      }
    } else if (it.type === "image") {
      const imgSrc = safeImgSrc(it.src);
      el.innerHTML = imgSrc
        ? `<img alt="Imagem" src="${imgSrc}" />`
        : `<div style="padding:8px;font-size:12px;color:#64748b">Sem imagem</div>`;
    } else if (it.type === "arrow") {
      el.textContent = "➤";
    }

    applyItemColorStyles(el, it);

    const lockedChrome = it.type !== "map" || opts.flow;
    if (selectedId === it.id && it.type === "map" && adjustMapId !== it.id && !opts.flow) {
      const handle = document.createElement("span");
      handle.className = "layout-el__handle";
      handle.dataset.resize = "1";
      el.appendChild(handle);
    }

    if (adjustMapId !== it.id && !lockedChrome) {
      el.classList.add("is-draggable");
      el.addEventListener("pointerdown", onPointerDown);
    }
    return el;
  }

  function flagOn(id) {
    return !!document.getElementById(id)?.checked;
  }

  function fitTitleBox(wrap) {
    const box =
      wrap?.classList?.contains("layout-sheet__title")
        ? wrap
        : wrap?.closest?.(".layout-sheet__title") ||
          pageEl()?.querySelector(".layout-sheet__title");
    const input = box?.querySelector?.("#layout-sheet-title");
    if (!box || !input) return;
    if (overlaySize.title) return;
    const cs = window.getComputedStyle(input);
    const canvas = fitTitleBox._c || (fitTitleBox._c = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = String(input.value || "");
    const tw = Math.ceil(ctx.measureText(text || " ").width);
    const parentW = box.parentElement?.clientWidth || 900;
    const max = Math.max(180, parentW - 28);
    const w = Math.min(max, Math.max(180, tw + 56));
    box.style.width = `${w}px`;
    box.style.maxWidth = `${max}px`;
    input.style.width = "100%";
  }

  function syncOverlayChrome() {
    document.querySelectorAll("[data-overlay]").forEach((node) => {
      const on = node.getAttribute("data-overlay") === overlaySelected;
      node.classList.toggle("is-editing", on);
      node.classList.toggle("is-unlocked", on);
    });
  }

  function clearMapMarking() {
    selectedLayerId = null;
    if (selectedId != null) {
      const it = items.find((x) => x.id === selectedId);
      if (it?.type === "map") selectedId = null;
    }
    document.querySelectorAll(".layout-el--map.is-selected").forEach((n) => {
      n.classList.remove("is-selected");
    });
  }

  function bindSheetOverlay(el, id, opts = {}) {
    if (!el || pageEl()?.classList.contains("is-exporting")) return;
    const flag = opts.flag;
    el.dataset.overlay = id;
    el.classList.add("layout-sheet__movable");
    if (overlaySelected === id) el.classList.add("is-editing", "is-unlocked");
    el.title = "Clique para marcar · arraste para mover";
    overlayUnlocked[id] = true;
    const pin = opts.pin !== false;
    const pos = overlayPos[id];
    if (pin && pos) {
      el.style.position = "absolute";
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.gridArea = "auto";
    }
    const size = overlaySize[id];
    if (pin && size?.w) {
      el.style.width = `${size.w}px`;
      el.style.maxWidth = "none";
      if (size.h) {
        el.style.height = `${size.h}px`;
        el.style.maxHeight = "none";
      }
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "layout-sheet__overlay-remove";
    btn.setAttribute("aria-label", "Remover");
    btn.textContent = "×";
    btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (flag) {
        const box = document.getElementById(flag);
        if (box) box.checked = false;
      }
      renderAll();
    });
    const resize = document.createElement("span");
    resize.className = "layout-sheet__overlay-resize";
    resize.title = "Redimensionar";
    resize.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      overlayDrag = {
        id,
        el,
        mode: "resize",
        startX: ev.clientX,
        startY: ev.clientY,
        origW: el.offsetWidth,
        origH: el.offsetHeight,
        origL: el.offsetLeft,
        origT: el.offsetTop,
      };
      el.classList.add("is-resizing");
      resize.setPointerCapture?.(ev.pointerId);
    });
    el.appendChild(btn);
    el.appendChild(resize);
    el.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("input, textarea, button, .layout-sheet__overlay-resize, .leaflet-container, .leaflet-control")) {
        return;
      }
      ev.stopPropagation();
      ev.preventDefault();
      overlaySelected = id;
      syncOverlayChrome();
      overlayDrag = {
        id,
        el,
        mode: "move",
        startX: ev.clientX,
        startY: ev.clientY,
        origL: el.offsetLeft,
        origT: el.offsetTop,
      };
      el.classList.add("is-dragging");
      el.setPointerCapture?.(ev.pointerId);
    });
  }

  function limiteEstadualRings() {
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    const rings = [];
    const walk = (geom) => {
      if (!geom) return;
      if (geom.type === "Polygon") rings.push(geom.coordinates?.[0] || []);
      else if (geom.type === "MultiPolygon") {
        (geom.coordinates || []).forEach((poly) => rings.push(poly?.[0] || []));
      } else if (geom.type === "GeometryCollection") {
        (geom.geometries || []).forEach(walk);
      }
    };
    Object.values(registry).forEach((entry) => {
      const schema = String(entry?.meta?.schema || entry?.meta?.id || "").toUpperCase();
      if (!schema.startsWith("LIMITE_ESTADUAL") && !/LIMITE_ESTADUAL/.test(schema)) return;
      const gj = entry.geojson;
      if (!gj) return;
      if (gj.type === "FeatureCollection") (gj.features || []).forEach((f) => walk(f.geometry));
      else if (gj.type === "Feature") walk(gj.geometry);
      else walk(gj);
    });
    return rings.filter((r) => r.length > 3);
  }

  function locatorBBox() {
    const rings = limiteEstadualRings().map((ring) => {
      const step = Math.max(1, Math.floor(ring.length / 280));
      return ring.filter((_, i) => i % step === 0 || i === ring.length - 1);
    });
    let west = -73.9;
    let south = -9.9;
    let east = -56.0;
    let north = 2.3;
    try {
      const b = window.InfraGeoMap?.getAmazonasBounds?.();
      if (b?.isValid?.()) {
        south = b.getSouth();
        north = b.getNorth();
        west = b.getWest();
        east = b.getEast();
      }
    } catch {
      /* keep defaults */
    }
    rings.forEach((ring) => {
      ring.forEach((c) => {
        const lng = Number(c[0]);
        const lat = Number(c[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      });
    });
    return { west, east, south, north, rings };
  }

  function paintLocatorMini(canvas) {
    if (!canvas?.getContext) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const box = locatorBBox();
    const pad = 14;
    const geoW = Math.max(0.0001, box.east - box.west);
    const geoH = Math.max(0.0001, box.north - box.south);
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    const scale = Math.min(innerW / geoW, innerH / geoH);
    const ox = pad + (innerW - geoW * scale) / 2;
    const oy = pad + (innerH - geoH * scale) / 2;
    const toXY = (lat, lng) => [
      ox + (lng - box.west) * scale,
      oy + (box.north - lat) * scale,
    ];

    const round = 16;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(round, 0);
    ctx.arcTo(w, 0, w, h, round);
    ctx.arcTo(w, h, 0, h, round);
    ctx.arcTo(0, h, 0, 0, round);
    ctx.arcTo(0, 0, w, 0, round);
    ctx.closePath();
    ctx.clip();

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#d7e8e3");
    sky.addColorStop(1, "#c3d6d0");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const drawState = (fill, stroke, width) => {
      if (!box.rings.length) {
        ctx.fillStyle = fill;
        ctx.fillRect(ox, oy, geoW * scale, geoH * scale);
        return;
      }
      box.rings.forEach((ring) => {
        ctx.beginPath();
        ring.forEach((c, i) => {
          const p = toXY(c[1], c[0]);
          if (i === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        });
        ctx.closePath();
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = width;
          ctx.lineJoin = "round";
          ctx.stroke();
        }
      });
    };

    ctx.shadowColor = "rgba(15, 59, 52, 0.18)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    drawState("#8eaaa3", null, 0);
    ctx.shadowColor = "transparent";
    const land = ctx.createLinearGradient(0, oy, 0, oy + geoH * scale);
    land.addColorStop(0, "#a8c2bb");
    land.addColorStop(1, "#6f9088");
    drawState(land, "#f7fbf9", 3.5);
    drawState(null, "#0f3b34", 1.35);

    ctx.restore();
    ctx.strokeStyle = "rgba(15, 59, 52, 0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(round, 1);
    ctx.arcTo(w - 1, 1, w - 1, h - 1, round);
    ctx.arcTo(w - 1, h - 1, 1, h - 1, round);
    ctx.arcTo(1, h - 1, 1, 1, round);
    ctx.arcTo(1, 1, w - 1, 1, round);
    ctx.stroke();
  }

  function locatorHtml(forExport) {
    if (forExport) {
      return (
        `<div class="layout-locator" aria-label="Mini mapa de localização">` +
        `<img class="layout-locator__map" alt="Localização no Amazonas" />` +
        `</div>`
      );
    }
    return (
      `<div class="layout-locator" aria-label="Mini mapa de localização">` +
      `<div class="layout-locator__live"></div>` +
      `</div>`
    );
  }

  function mainMapFocusBounds() {
    try {
      if (selectionBounds?.isValid?.()) return selectionBounds;
    } catch {
      /* ignore */
    }
    const item = items.find((it) => it.type === "map" && it.visible !== false);
    if (item?.bounds) {
      try {
        const b = L.latLngBounds(item.bounds[0], item.bounds[1]);
        if (b.isValid()) return b;
      } catch {
        /* ignore */
      }
    }
    try {
      const b = window.InfraGeoMap?.getMap?.()?.getBounds?.();
      if (b?.isValid?.()) return b;
    } catch {
      /* ignore */
    }
    return window.InfraGeoMap?.getAmazonasBounds?.() || null;
  }

  function paddedLocatorBounds(b) {
    if (!b?.isValid?.()) return b;
    const span = Math.max(
      Math.abs(b.getNorth() - b.getSouth()),
      Math.abs(b.getEast() - b.getWest())
    );
    const pad = Math.max(0.12, span * 2.2);
    const c = b.getCenter();
    return L.latLngBounds(
      [c.lat - pad, c.lng - pad],
      [c.lat + pad, c.lng + pad]
    );
  }

  function applyLocatorView(map) {
    if (!map) return;
    if (locatorCenter && Number.isFinite(locatorZoom)) {
      map.setView(
        locatorCenter,
        Math.min(locatorZoom, LOCATOR_MAX_ZOOM),
        { animate: false }
      );
      return;
    }
    const focus = paddedLocatorBounds(mainMapFocusBounds());
    if (focus?.isValid?.()) {
      map.fitBounds(focus, {
        padding: [10, 10],
        animate: false,
        maxZoom: LOCATOR_MAX_ZOOM,
      });
      return;
    }
    map.setView([-3.5, -64.5], 6, { animate: false });
  }

  function persistLocatorView() {
    if (!locatorLive) return;
    try {
      const c = locatorLive.getCenter();
      locatorCenter = [c.lat, c.lng];
      locatorZoom = locatorLive.getZoom();
    } catch {
      /* ignore */
    }
  }

  function destroyLocatorLive() {
    persistLocatorView();
    try {
      locatorLive?.off?.();
      locatorLive?.remove?.();
    } catch {
      /* ignore */
    }
    locatorLive = null;
  }

  function addLocatorDecorations(map) {
    cloneVisibleLayersTo(map, { pickable: false, radiusBoost: 1 });
    try {
      locatorRect?.remove?.();
    } catch {
      /* ignore */
    }
    locatorRect = null;
    const extent = mainMapFocusBounds();
    if (extent?.isValid?.()) {
      locatorRect = L.rectangle(extent, {
        color: "#f8fafc",
        weight: 2,
        fillColor: "#34d399",
        fillOpacity: 0.16,
        interactive: false,
      }).addTo(map);
    }
  }

  let locatorMountTimer = 0;
  function scheduleLocatorMount() {
    if (locatorMountTimer) window.clearTimeout(locatorMountTimer);
    locatorMountTimer = window.setTimeout(() => {
      locatorMountTimer = 0;
      const loc = document.querySelector(".layout-sheet__float--locator");
      if (!loc || pageEl()?.classList.contains("is-exporting")) return;
      mountLocatorLive(loc);
    }, 80);
  }

  function mountLocatorLive(el) {
    destroyLocatorLive();
    const box = el?.querySelector?.(".layout-locator__live");
    if (!box || !window.L) return;
    locatorLive = L.map(box, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: true,
      dragging: true,
      doubleClickZoom: true,
      boxZoom: false,
      keyboard: false,
      maxZoom: LOCATOR_MAX_ZOOM,
      minZoom: 5,
    });
    hideBrokenTiles(locatorLive);
    cloneBasemapTo(locatorLive, { maxZoom: LOCATOR_MAX_ZOOM, preferEsri: true });
    addLocatorDecorations(locatorLive);
    applyLocatorView(locatorLive);
    locatorLive.on("zoomend", persistLocatorView);
    locatorLive.on("moveend", persistLocatorView);
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    const kick = () => {
      if (!locatorLive) return;
      locatorLive.invalidateSize({ animate: false });
      applyLocatorView(locatorLive);
    };
    window.requestAnimationFrame(kick);
    window.setTimeout(kick, 80);
    window.setTimeout(kick, 240);
  }

  function ensureLocatorEngine() {
    const host = document.getElementById("layout-locator-engine");
    if (!host || !window.L) return null;
    if (locatorEngine) return locatorEngine;
    locatorEngine = L.map(host, {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      maxZoom: LOCATOR_MAX_ZOOM,
      minZoom: 5,
    });
    hideBrokenTiles(locatorEngine);
    cloneBasemapTo(locatorEngine, { cors: true, maxZoom: LOCATOR_MAX_ZOOM, preferEsri: true });
    return locatorEngine;
  }

  function updateLocatorLayers(map) {
    if (locatorRect) {
      try {
        map.removeLayer(locatorRect);
      } catch {
        /* ignore */
      }
      locatorRect = null;
    }
    if (!locatorOutline) {
      const rings = limiteEstadualRings();
      if (rings.length) {
        const latlngs = rings.map((ring) =>
          ring.map((c) => [c[1], c[0]])
        );
        locatorOutline = L.polygon(latlngs, {
          color: "#ffffff",
          weight: 1.4,
          fill: false,
          interactive: false,
          opacity: 0.95,
        }).addTo(map);
      }
    }
  }

  async function fillLocatorImage(img) {
    if (!img) return;
    const seq = (locatorSeq += 1);
    const map = ensureLocatorEngine();
    if (!map) {
      const canvas = document.createElement("canvas");
      canvas.width = 220;
      canvas.height = 200;
      paintLocatorMini(canvas);
      img.src = safeCanvasDataUrl(canvas, "image/png") || "";
      return;
    }
    map.invalidateSize({ animate: false });
    applyLocatorView(map);
    updateLocatorLayers(map);
    addLocatorDecorations(map);
    await waitForTiles(map, 2800);
    await wait(120);
    if (seq !== locatorSeq || !img.isConnected) return;
    const host = map.getContainer();
    const w = 256;
    const h = 256;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const painted = paintBasemapTilesToCanvas(ctx, host, w, h);
    paintOverlayCanvasesToCanvas(ctx, host, w, h);
    paintVisibleLayersToCanvas(ctx, map);
    if (!painted) paintLocatorMini(canvas);
    const locUrl = safeCanvasDataUrl(canvas, "image/jpeg", 0.9);
    if (locUrl) img.src = locUrl;
    else {
      paintLocatorMini(canvas);
      img.src = safeCanvasDataUrl(canvas, "image/png") || "";
    }
  }

  function renderElementChips() {
    const host = document.getElementById("layout-element-chips");
    if (!host) return;
    const chips = [
      ["layout-show-title", "Título"],
      ["layout-show-legend", "Legenda"],
      ["layout-show-scale", "Escala"],
      ["layout-show-north", "Norte"],
      ["layout-show-locator", "Localização"],
      ["layout-show-credits", "Créditos"],
    ];
    host.innerHTML = chips
      .map(([id, label]) => {
        const on = !!document.getElementById(id)?.checked;
        return (
          `<button type="button" class="layout-chip${on ? " is-on" : ""}" data-flag="${id}" aria-pressed="${on}">` +
          (on ? `<span class="layout-chip__check" aria-hidden="true">✓</span>` : "") +
          `${label}</button>`
        );
      })
      .join("");
  }

  function syncCompositionUi() {
    const auto = document.getElementById("layout-auto-toggle");
    if (auto) auto.checked = sheetAuto;
    const compose = resolveComposition();
    document.querySelectorAll(".layout-compose-card").forEach((btn) => {
      const id = btn.getAttribute("data-compose");
      btn.setAttribute("aria-pressed", id === compose ? "true" : "false");
    });
  }

  function syncExportButtonLabel() {
    const fmt = document.getElementById("layout-export-format")?.value || "pdf";
    const label = "PDF";
    const top = document.getElementById("btn-layout-export-main");
    const dock = document.getElementById("btn-layout-export-pdf");
    if (top) {
      top.innerHTML =
        `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>` +
        label;
    }
    if (dock) dock.textContent = label;
  }

  function renderSheet(page) {
    const compose = resolveComposition();
    const overlay = compose === "full";
    const titleText = (
      document.getElementById("layout-map-title")?.value ||
      "Mapa de Infraestrutura — Amazonas"
    ).trim();
    const year = new Date().getFullYear();
    page.classList.add("layout-sheet", "is-recommended");
    page.classList.toggle("layout-sheet--overlays", overlay);
    page.dataset.compose = compose;
    page.innerHTML = "";

    const mapCell = document.createElement("div");
    mapCell.className = "layout-sheet__map";
    const mapIt = items.find((it) => it.type === "map");
    if (mapIt) mapCell.appendChild(renderItemDom(mapIt, { flow: true }));

    const putChrome = (el, host) => {
      if (overlay) mapCell.appendChild(el);
      else host.appendChild(el);
    };

    if (flagOn("layout-show-title")) {
      const title = document.createElement("div");
      title.className = "layout-sheet__title";
      title.innerHTML =
        `<label class="visually-hidden" for="layout-sheet-title">Título do mapa</label>` +
        `<input id="layout-sheet-title" class="layout-sheet__title-input" type="text" maxlength="80" value="${esc(titleText)}" />`;
      putChrome(title, page);
      bindSheetOverlay(title, "title", { flag: "layout-show-title", pin: overlay });
      if (overlay) window.requestAnimationFrame(() => fitTitleBox(title));
    }
    if (flagOn("layout-show-north")) {
      const n = document.createElement("div");
      n.className = "layout-sheet__float layout-sheet__float--north";
      n.innerHTML = northArrowHtml();
      mapCell.appendChild(n);
      bindSheetOverlay(n, "north", { flag: "layout-show-north" });
    }
    if (flagOn("layout-show-scale")) {
      const s = document.createElement("div");
      s.className = "layout-sheet__float layout-sheet__float--scale";
      s.innerHTML =
        `<div class="layout-map-scale">` +
        `<div class="layout-el--scale-bar" aria-hidden="true"></div>` +
        `<span>${esc(scaleLabel())}</span></div>`;
      mapCell.appendChild(s);
      bindSheetOverlay(s, "scale", { flag: "layout-show-scale" });
    }
    if (flagOn("layout-show-locator")) {
      const exporting = page.classList.contains("is-exporting");
      const loc = document.createElement("div");
      loc.className = "layout-sheet__float layout-sheet__float--locator";
      loc.innerHTML = locatorHtml(exporting);
      mapCell.appendChild(loc);
      if (!exporting) {
        bindSheetOverlay(loc, "locator", { flag: "layout-show-locator" });
      } else {
        const img = loc.querySelector("img");
        if (img) fillLocatorImage(img).catch(() => {});
      }
    }
    if (flagOn("layout-show-legend")) {
      const legend = document.createElement("div");
      legend.className = "layout-sheet__legend";
      legend.innerHTML = legendHtml();
      putChrome(legend, page);
      bindSheetOverlay(legend, "legend", { flag: "layout-show-legend", pin: overlay });
    }
    if (flagOn("layout-show-credits")) {
      const meta = document.createElement("div");
      meta.className = "layout-sheet__meta";
      meta.textContent = `InfraGeo · ${year}`;
      putChrome(meta, page);
      bindSheetOverlay(meta, "credits", { flag: "layout-show-credits", pin: overlay });
    }
    page.appendChild(mapCell);
  }

  function persistAdjustView() {
    if (!adjustLeaflet || adjustMapId == null) return;
    const item = items.find((it) => it.id === adjustMapId);
    if (!item) return;
    try {
      const c = adjustLeaflet.getCenter();
      item.center = [c.lat, c.lng];
      item.zoom = adjustLeaflet.getZoom();
      const b = boundsFromMap(adjustLeaflet);
      if (b) item.bounds = b;
    } catch {
      /* ignore */
    }
  }

  function renderAll() {
    const page = pageEl();
    if (!page) return;
    const keepAdjustId = adjustMapId;
    persistAdjustView();
    persistLocatorView();
    destroyLocatorLive();
    if (keepAdjustId != null) {
      try {
        adjustLeaflet?.off?.();
        adjustLeaflet?.remove?.();
      } catch {
        /* ignore */
      }
      adjustLeaflet = null;
    }
    renderSheet(page);
    syncPageTheme();
    renderList();
    renderLayerChips();
    renderBasemapChips();
    renderElementChips();
    syncCompositionUi();
    syncExportButtonLabel();
    syncExportStats();
    window.requestAnimationFrame(() => {
      applyPageSize();
      fitTitleBox();
      if (page.classList.contains("is-exporting")) return;
      const mapItem =
        items.find((it) => it.id === keepAdjustId && it.type === "map") ||
        items.find((it) => it.type === "map" && it.visible !== false);
      if (mapItem) {
        adjustMapId = mapItem.id;
        if (!mapInteractMode) mapInteractMode = "adjust";
        window.setTimeout(() => mountAdjustLeaflet(mapItem), 40);
      }
      scheduleLocatorMount();
    });
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
    if (overlayDrag?.el) {
      const el = overlayDrag.el;
      const parent = el.offsetParent || el.parentElement;
      if (overlayDrag.mode === "resize") {
        const mins = OVERLAY_MIN[overlayDrag.id] || [32, 16];
        const maxW = Math.max(mins[0], (parent?.clientWidth || 1200) * 0.98);
        const maxH = Math.max(mins[1], (parent?.clientHeight || 800) * 0.98);
        const w = Math.min(maxW, Math.max(mins[0], overlayDrag.origW + ev.clientX - overlayDrag.startX));
        const h = Math.min(maxH, Math.max(mins[1], overlayDrag.origH + ev.clientY - overlayDrag.startY));
        el.style.width = `${Math.round(w)}px`;
        el.style.height = `${Math.round(h)}px`;
        el.style.maxWidth = "none";
        el.style.maxHeight = "none";
        overlaySize[overlayDrag.id] = { w: Math.round(w), h: Math.round(h) };
        if (overlayDrag.id === "locator") {
          locatorLive?.invalidateSize?.({ animate: false });
        }
        return;
      }
      const slack = 48;
      const maxX = Math.max(slack, (parent?.clientWidth || 0) - slack);
      const maxY = Math.max(slack, (parent?.clientHeight || 0) - slack);
      const left = Math.max(-slack, Math.min(maxX, overlayDrag.origL + ev.clientX - overlayDrag.startX));
      const top = Math.max(-slack, Math.min(maxY, overlayDrag.origT + ev.clientY - overlayDrag.startY));
      el.style.position = "absolute";
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
      overlayPos[overlayDrag.id] = { left, top };
      return;
    }
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
    if (overlayDrag?.el) {
      overlayDrag.el.classList.remove("is-dragging", "is-resizing");
      if (overlayDrag.id === "locator") locatorLive?.invalidateSize?.({ animate: false });
    }
    overlayDrag = null;
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
      const canvas = await captureSheetCanvas();
      const href = safeCanvasDataUrl(canvas, "image/png");
      if (!href) throw new Error("Não foi possível gerar o PNG.");
      const a = document.createElement("a");
      a.href = href;
      a.download = `infrageo-layout-${Date.now()}.png`;
      a.click();
    } finally {
      finishPageExport(resume);
      selectedId = wasSelected;
      renderAll();
    }
  }

  async function exportSvg() {
    const page = pageEl();
    if (!page || !window.html2canvas) {
      window.alert("html2canvas indisponível");
      return;
    }
    const wasSelected = selectedId;
    let resume = { resumeId: null, resumeMode: null };
    try {
      resume = await preparePageForExport();
      const canvas = await captureSheetCanvas();
      const png = safeCanvasDataUrl(canvas, "image/png");
      if (!png) throw new Error("Não foi possível gerar o SVG.");
      const preset = currentPreset();
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${preset.wMm}mm" height="${preset.hMm}mm" ` +
        `viewBox="0 0 ${canvas.width} ${canvas.height}">` +
        `<image href="${png}" width="${canvas.width}" height="${canvas.height}"/>` +
        `</svg>`;
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `infrageo-layout-${Date.now()}.svg`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      finishPageExport(resume);
      selectedId = wasSelected;
      renderAll();
    }
  }

  async function exportCurrent() {
    const fmt = document.getElementById("layout-export-format")?.value || "pdf";
    if (fmt === "png") return exportPng();
    if (fmt === "svg") return exportSvg();
    return exportPdf();
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
      const canvas = await captureSheetCanvas();
      const preset = currentPreset();
      const landscape = preset.wMm >= preset.hMm;
      const pdf = new JsPDF({
        orientation: landscape ? "landscape" : "portrait",
        unit: "mm",
        format: [preset.wMm, preset.hMm],
      });
      const img = safeCanvasDataUrl(canvas, "image/jpeg", 0.95);
      if (!img) throw new Error("Não foi possível gerar o PDF.");
      pdf.addImage(img, "JPEG", 0, 0, preset.wMm, preset.hMm);
      pdf.save(`infrageo-layout-${Date.now()}.pdf`);
    } finally {
      finishPageExport(resume);
      selectedId = wasSelected;
      renderAll();
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
    backBtn?.addEventListener(
      "click",
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        open(false);
      },
      true
    );
    const rebuildSheet = () => {
      applyPageSize();
      applyRecommendedLayout({ keepSize: true, silentOpen: true });
      const mapItem = items.find((it) => it.type === "map" && it.visible !== false);
      if (mapItem && !root()?.hidden) {
        window.setTimeout(() => {
          mountAdjustLeaflet(mapItem);
          adjustLeaflet?.invalidateSize?.({ animate: false });
        }, 40);
      }
    };
    pageSize?.addEventListener("change", rebuildSheet);
    document.getElementById("layout-print-preset")?.addEventListener("change", (ev) => {
      applySizeKey(ev.target.value);
      rebuildSheet();
    });
    document.getElementById("layout-page-format")?.addEventListener("change", rebuildSheet);
    document.getElementById("layout-page-orient")?.addEventListener("change", rebuildSheet);
    document.getElementById("layout-margins")?.addEventListener("change", rebuildSheet);
    document.getElementById("layout-scale-ratio")?.addEventListener("change", () => renderAll());
    document.getElementById("layout-show-scale")?.addEventListener("change", () => {
      applySheetChrome();
      renderAll();
    });
    document.getElementById("layout-show-credits")?.addEventListener("change", () => {
      applySheetChrome();
      renderAll();
    });
    document.getElementById("layout-include-popups")?.addEventListener("change", () => {
      renderPopupPinList();
      refreshMapSnapshots().catch(() => {});
    });
    document.getElementById("btn-layout-add-popup")?.addEventListener("click", () => {
      const pin = window.InfraGeoHoverPopup?.addCurrentExportPin?.();
      if (!pin) {
        window.alert("Abra um ponto no mapa (clique na feição) e tente de novo.");
        return;
      }
      const box = document.getElementById("layout-include-popups");
      if (box) box.checked = true;
      renderPopupPinList();
      refreshMapSnapshots().catch(() => {});
    });
    document.getElementById("layout-popup-pins")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest?.("[data-del-pin]");
      if (!btn) return;
      window.InfraGeoHoverPopup?.removeExportPin?.(btn.getAttribute("data-del-pin"));
      renderPopupPinList();
      refreshMapSnapshots().catch(() => {});
    });
    document.addEventListener("infrageo-export-pins", () => {
      renderPopupPinList();
    });
    document.getElementById("btn-layout-zoom-in")?.addEventListener("click", () => {
      setPreviewZoom(previewZoom + 0.1);
    });
    document.getElementById("btn-layout-zoom-out")?.addEventListener("click", () => {
      setPreviewZoom(previewZoom - 0.1);
    });
    document.getElementById("btn-layout-layers")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setLayersPop(!!layersPop()?.hidden);
    });
    document.getElementById("btn-layout-layers-close")?.addEventListener("click", () => {
      setLayersPop(false);
    });
    document.getElementById("btn-layout-box-select")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      startBoxSelect(selectedId);
    });
    document.addEventListener("pointerdown", (ev) => {
      const pop = layersPop();
      if (pop && !pop.hidden) {
        if (!pop.contains(ev.target) && !ev.target.closest?.("#btn-layout-layers")) {
          setLayersPop(false);
        }
      }
      const studio = root();
      if (!studio || studio.hidden || !(ev.target instanceof Element)) return;
      if (!studio.contains(ev.target)) return;
      if (ev.target.closest("[data-overlay]")) return;
      overlaySelected = null;
      syncOverlayChrome();
      if (!ev.target.closest(".layout-sheet__map")) {
        clearMapMarking();
      }
    });
    document.getElementById("layout-basemap-chips")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest?.("[data-basemap]");
      if (!btn) return;
      const name = btn.getAttribute("data-basemap");
      if (!name) return;
      window.InfraGeoMap?.setBasemapByName?.(name);
      renderBasemapChips();
      const keepId = adjustMapId;
      if (keepId != null) {
        const item = items.find((x) => x.id === keepId);
        if (item) mountAdjustLeaflet(item);
      }
      scheduleLocatorMount();
      refreshMapSnapshots().catch(() => {});
    });
    document.getElementById("layout-layer-chips")?.addEventListener("click", async (ev) => {
      const btn = ev.target.closest?.("[data-toggle-layer]");
      if (!btn) return;
      const id = btn.getAttribute("data-toggle-layer");
      const on = btn.getAttribute("aria-pressed") === "true";
      if (on) {
        await window.InfraGeoLayers?.setLayerVisible?.(id, false, { fit: false });
        if (String(selectedLayerId) === String(id)) selectedLayerId = null;
        refreshSoloMap();
        return;
      }
      await window.InfraGeoLayers?.setLayerVisible?.(id, true, { fit: false });
      setSelectedLayer(id);
    });
    document.getElementById("layout-element-chips")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest?.("[data-flag]");
      if (!btn) return;
      const id = btn.getAttribute("data-flag");
      const box = document.getElementById(id);
      if (box) box.checked = !box.checked;
      renderAll();
    });
    document.getElementById("layout-auto-toggle")?.addEventListener("change", (ev) => {
      sheetAuto = !!ev.target.checked;
      renderAll();
    });
    document.getElementById("layout-compose-list")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest?.("[data-compose]");
      if (!btn) return;
      sheetAuto = false;
      sheetCompose = btn.getAttribute("data-compose") || "classic";
      renderAll();
    });
    document.getElementById("layout-map-title")?.addEventListener("input", (ev) => {
      const text = String(ev.target.value || "");
      const node = pageEl()?.querySelector("#layout-sheet-title");
      if (node && node !== document.activeElement) node.value = text;
      fitTitleBox();
    });
    document.getElementById("layout-page")?.addEventListener("input", (ev) => {
      const field = ev.target?.closest?.("#layout-sheet-title");
      if (!field) return;
      const header = document.getElementById("layout-map-title");
      if (header) header.value = field.value;
      fitTitleBox(field);
    });
    const onDpi = () => {
      if (dpiValue) dpiValue.textContent = String(dpi());
      syncExportStats();
    };
    dpiRange?.addEventListener("input", onDpi);
    dpiRange?.addEventListener("change", onDpi);
    document.getElementById("layout-screen-grid")?.addEventListener("change", syncGridClasses);
    document.getElementById("layout-wgs84-grid")?.addEventListener("change", syncGridClasses);
    document.getElementById("layout-scale-unit")?.addEventListener("change", renderAll);
    document.getElementById("btn-layout-export-png")?.addEventListener("click", () => {
      exportPng().catch((e) => window.alert(e.message || e));
    });
    const runExport = () => exportCurrent().catch((e) => window.alert(e.message || e));
    document.getElementById("btn-layout-export-pdf")?.addEventListener("click", runExport);
    document.getElementById("btn-layout-export-main")?.addEventListener("click", runExport);
    document.getElementById("layout-export-format")?.addEventListener("change", syncExportButtonLabel);
    document.getElementById("btn-layout-clear")?.addEventListener("click", clearItems);
    document.getElementById("btn-layout-delete-sel")?.addEventListener("click", () => {
      if (selectedId != null) removeItem(selectedId);
    });
    document.getElementById("btn-layout-recommended")?.addEventListener("click", () => {
      const fmt = document.getElementById("layout-page-format");
      const ori = document.getElementById("layout-page-orient");
      const title = document.getElementById("layout-map-title");
      const margins = document.getElementById("layout-margins");
      if (fmt) fmt.value = "a4";
      if (ori) ori.value = "landscape";
      if (title) title.value = "Mapa de Infraestrutura — Amazonas";
      if (margins) margins.value = "compact";
      sheetAuto = true;
      applyRecommendedLayout({ silentOpen: true, resetUi: true });
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
      const id = ev.target.value || null;
      setSelectedLayer(id);
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
      if (ev.key === "Escape" && root() && !root().hidden) {
        if (layersPop() && !layersPop().hidden) {
          ev.preventDefault();
          setLayersPop(false);
          return;
        }
        open(false);
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && selectedId != null) {
        const tag = (ev.target?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || ev.target?.isContentEditable) return;
        if (root()?.classList.contains("layout-studio")) return;
        if (!root()?.hidden) removeItem(selectedId);
      }
    });
  }

  return { init, open, openWithSelection, refreshMapSnapshots };
})();
