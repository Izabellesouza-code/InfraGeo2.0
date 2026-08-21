/**
 * Layout de impressão / exportação do mapa (PNG).
 * Proporções reais de papel + estilos selecionáveis.
 */
window.InfraGeoPrintMap = (function () {
  "use strict";

  /** mm → px @ 300 DPI — resolução de impressão para todos os formatos */
  const DPI = 300;
  const MM_TO_PX = DPI / 25.4;
  /** Escala do html2canvas: 1 = layout já está em 300 dpi (evita PNG gigante) */
  const CAPTURE_SCALE = 1;
  /**
   * Captura do mapa em resolução limitada (evita “Página sem resposta”).
   * O layout final continua em 300 DPI — a imagem é ampliada no compose.
   */
  const CAPTURE_MAX_EDGE = 1400;
  const GEOJSON_CHUNK = 200;
  const GENERATE_TIMEOUT_MS = 90000;

  const PAPER_SIZES = {
    a4: { label: "A4", wMm: 210, hMm: 297 },
    a3: { label: "A3", wMm: 297, hMm: 420 },
    letter: { label: "Carta", wMm: 215.9, hMm: 279.4 },
    legal: { label: "Ofício", wMm: 215.9, hMm: 355.6 },
    wide16x9: { label: "16∶9", wMm: 190.5, hMm: 338.7 },
    square: { label: "1∶1", wMm: 210, hMm: 210 },
  };

  /** Atalhos de proporção ideal (impressão / PDF / download). */
  const LAYOUT_PRESETS = {
    "a4-landscape": { size: "a4", orient: "landscape", format: "pdf" },
    "a4-portrait": { size: "a4", orient: "portrait", format: "pdf" },
    "a3-landscape": { size: "a3", orient: "landscape", format: "pdf" },
    "letter-landscape": { size: "letter", orient: "landscape", format: "pdf" },
    "wide-16x9": { size: "wide16x9", orient: "landscape", format: "png" },
    "square-1x1": { size: "square", orient: "portrait", format: "png" },
  };

  const PAPER_STYLES = {
    infrageo: {
      label: "InfraGeo",
      paper: "#f8fafc",
      frame: "#cbd5e1",
      header: ["#1e3a5f", "#0f766e", "#14532d"],
      headerText: "#ffffff",
      headerMuted: "rgba(255,255,255,0.85)",
      mapFrame: "#e2e8f0",
      mapStroke: "#94a3b8",
      legendBg: "#ffffff",
      legendStroke: "#cbd5e1",
      text: "#0f172a",
      muted: "#64748b",
      footerBg: "#f1f5f9",
      titleChip: "rgba(15, 23, 42, 0.82)",
      titleChipText: "#f8fafc",
      radius: 10,
    },
    institucional: {
      label: "Institucional",
      paper: "#f5f3ee",
      frame: "#c4b8a8",
      header: ["#0b1f3a", "#123a6b", "#0b1f3a"],
      headerText: "#ffffff",
      headerMuted: "rgba(255,255,255,0.82)",
      mapFrame: "#e8e2d8",
      mapStroke: "#a89880",
      legendBg: "#fffcf7",
      legendStroke: "#d4c8b8",
      text: "#1a1520",
      muted: "#6b5e4e",
      footerBg: "#ebe4d8",
      titleChip: "rgba(11, 31, 58, 0.88)",
      titleChipText: "#f8fafc",
      radius: 6,
    },
    minimal: {
      label: "Minimalista",
      paper: "#ffffff",
      frame: "#e5e5e5",
      header: ["#111111", "#111111", "#111111"],
      headerText: "#ffffff",
      headerMuted: "rgba(255,255,255,0.75)",
      mapFrame: "#f4f4f4",
      mapStroke: "#cccccc",
      legendBg: "#ffffff",
      legendStroke: "#e5e5e5",
      text: "#111111",
      muted: "#737373",
      footerBg: "#fafafa",
      titleChip: "rgba(0, 0, 0, 0.78)",
      titleChipText: "#ffffff",
      radius: 2,
    },
    tecnico: {
      label: "Técnico",
      paper: "#f0f4f8",
      frame: "#94a3b8",
      header: ["#334155", "#475569", "#334155"],
      headerText: "#f8fafc",
      headerMuted: "rgba(248,250,252,0.8)",
      mapFrame: "#e2e8f0",
      mapStroke: "#64748b",
      legendBg: "#ffffff",
      legendStroke: "#94a3b8",
      text: "#0f172a",
      muted: "#475569",
      footerBg: "#e2e8f0",
      titleChip: "rgba(51, 65, 85, 0.9)",
      titleChipText: "#f8fafc",
      radius: 0,
    },
  };

  let busy = false;
  let liveMiniMap = null;
  let liveSyncHandler = null;
  let liveSyncRaf = 0;
  let printFrameEl = null;
  let printFrameMoveHandler = null;

  function els() {
    return {
      modal: document.getElementById("modal-print-map"),
      canvas: document.getElementById("print-map-canvas"),
      preview: document.getElementById("print-map-preview"),
      title: document.getElementById("print-map-title"),
      paperSize: document.getElementById("print-paper-size"),
      paperOrient: document.getElementById("print-paper-orient"),
      paperStyle: document.getElementById("print-paper-style"),
      exportFormat: document.getElementById("print-export-format"),
      proportions: document.getElementById("print-proportions"),
      legendTitle: document.getElementById("print-legend-title"),
      legendLabel: document.getElementById("print-legend-label"),
      featureColor: document.getElementById("print-feature-color"),
      featureStroke: document.getElementById("print-feature-stroke"),
      fontSize: document.getElementById("print-font-size"),
      fontFamily: document.getElementById("print-font-family"),
      status: document.getElementById("print-map-status"),
      btnDownload: document.getElementById("btn-print-download"),
      btnDownloadPng: document.getElementById("btn-print-download-png"),
      btnClose: document.getElementById("btn-fechar-print"),
      btnCancel: document.getElementById("btn-cancelar-print"),
      btnGenerate: document.getElementById("btn-print-gerar"),
      btnPreview: document.getElementById("btn-print-preview"),
      btnOpen: document.getElementById("btn-exportar-mapa"),
      btnFitFeature: document.getElementById("btn-print-fit-feature"),
      btnFitLayer: document.getElementById("btn-print-fit-layer"),
      btnZoomIn: document.getElementById("btn-print-zoom-in"),
      btnZoomOut: document.getElementById("btn-print-zoom-out"),
      btnAdjustMap: document.getElementById("btn-print-adjust-map"),
      frameHint: document.getElementById("print-frame-hint"),
    };
  }

  function editOptions() {
    const {
      legendTitle,
      legendLabel,
      featureColor,
      featureStroke,
      fontSize,
      fontFamily,
    } = els();
    const sizeKey = fontSize?.value || "md";
    const sizeMul = sizeKey === "sm" ? 0.88 : sizeKey === "lg" ? 1.18 : 1;
    return {
      legendTitle: (legendTitle?.value || "LEGENDA").trim() || "LEGENDA",
      legendLabel: (legendLabel?.value || "").trim(),
      featureColor: featureColor?.value || "#14b8a6",
      featureStroke: featureStroke?.value || "#0f766e",
      fontSizeMul: sizeMul,
      fontFamily: fontFamily?.value || "Manrope, Segoe UI, sans-serif",
    };
  }

  function syncEditDefaultsFromSelection() {
    const sel = window.InfraGeoHoverPopup?.getSelection?.();
    const { legendLabel, featureColor, featureStroke } = els();
    if (sel?.meta) {
      if (legendLabel && !legendLabel.value.trim()) {
        legendLabel.value = sel.meta.name || "";
      }
      const st = sel.meta.style || {};
      if (featureColor && st.fillColor) featureColor.value = st.fillColor;
      if (featureStroke && (st.color || st.fillColor)) {
        featureStroke.value = st.color || st.fillColor;
      }
    }
  }

  function selectedOptions() {
    const { paperSize, paperOrient, paperStyle, exportFormat } = els();
    return {
      sizeKey: paperSize?.value || "a4",
      orient: paperOrient?.value || "landscape",
      styleKey: paperStyle?.value || "infrageo",
      format: exportFormat?.value || "png",
    };
  }

  /** Layout em pixels com proporção real do papel escolhido. */
  function getLayout() {
    const { sizeKey, orient, styleKey } = selectedOptions();
    const paper = PAPER_SIZES[sizeKey] || PAPER_SIZES.a4;
    const style = PAPER_STYLES[styleKey] || PAPER_STYLES.infrageo;
    const landscape = orient !== "portrait";

    const shortPx = Math.round(paper.wMm * MM_TO_PX);
    const longPx = Math.round(paper.hMm * MM_TO_PX);
    const width = landscape ? longPx : shortPx;
    const height = landscape ? shortPx : longPx;

    // Painel lateral: marca + legenda (sem rodapé de escala/CRS)
    const pad = Math.max(40, Math.round(Math.min(width, height) * 0.028));
    const headerH = Math.max(120, Math.round(height * 0.11));
    const footerH = Math.max(16, Math.round(height * 0.012));
    const gap = Math.max(12, Math.round(pad * 0.32));
    const legendW = Math.min(
      landscape ? 480 : 380,
      Math.max(300, Math.round(width * (landscape ? 0.21 : 0.26)))
    );

    return {
      width,
      height,
      pad,
      headerH,
      footerH,
      legendW,
      gap,
      landscape,
      paperLabel: paper.label,
      orientLabel: landscape ? "paisagem" : "retrato",
      style,
      styleKey,
      sizeKey,
      dpi: DPI,
    };
  }

  function getExportMapSize() {
    const { width: W, height: H, pad, headerH, footerH, legendW, gap } = getLayout();
    const s = DPI / 150;
    // Mesmas proporções do compose (layout cartográfico)
    const mapXPad = Math.round(28 * s);
    const mapY = pad + Math.round(22 * s);
    const mapW = W - pad * 2 - legendW - gap - mapXPad;
    const mapH = H - mapY - footerH - pad - gap;
    return { mapW: Math.round(mapW), mapH: Math.round(mapH) };
  }

  /** Tamanho real do mapa offscreen (limitado para não travar o Chrome). */
  function getCaptureMapSize() {
    const full = getExportMapSize();
    const maxEdge = Math.max(full.mapW, full.mapH) || 1;
    if (maxEdge <= CAPTURE_MAX_EDGE) {
      return { mapW: full.mapW, mapH: full.mapH, scale: 1 };
    }
    const scale = CAPTURE_MAX_EDGE / maxEdge;
    return {
      mapW: Math.max(320, Math.round(full.mapW * scale)),
      mapH: Math.max(240, Math.round(full.mapH * scale)),
      scale,
    };
  }

  function updatePreviewChrome() {
    const { preview, canvas } = els();
    const layout = getLayout();
    if (preview) {
      preview.classList.toggle("is-portrait", !layout.landscape);
      if (canvas?.dataset.ready === "1") {
        preview.classList.add("is-visible");
      }
    }
    if (canvas && canvas.dataset.ready !== "1") {
      // placeholder na proporção correta
      const maxW = 800;
      const scale = maxW / layout.width;
      canvas.width = Math.round(layout.width * scale);
      canvas.height = Math.round(layout.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = layout.style.paper;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = layout.style.frame;
      ctx.lineWidth = 2;
      ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
      ctx.fillStyle = layout.style.muted;
      ctx.font = "600 14px Manrope, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `${layout.paperLabel} · ${layout.orientLabel} · ${layout.style.label}`,
        canvas.width / 2,
        canvas.height / 2 - 8
      );
      ctx.font = "500 12px Manrope, Segoe UI, sans-serif";
      ctx.fillText("Clique em Ver como ou Gerar layout", canvas.width / 2, canvas.height / 2 + 14);
      if (preview) preview.classList.remove("is-visible");
    }
  }

  /** Popup grande na mesma página com a prévia completa. */
  function openPreviewLightbox(sourceCanvas) {
    const lightbox = document.getElementById("print-preview-lightbox");
    const viewCanvas = document.getElementById("print-preview-lightbox-canvas");
    const metaEl = document.getElementById("print-preview-lightbox-meta");
    const titleEl = document.getElementById("print-preview-lightbox-title");
    if (!lightbox || !viewCanvas || !sourceCanvas) return false;

    const mapTitle = els().title?.value?.trim() || defaultTitle();
    const layout = getLayout();
    if (titleEl) titleEl.textContent = mapTitle;
    if (metaEl) {
      metaEl.textContent = `${layout.paperLabel} · ${layout.orientLabel} · ${layout.style.label}`;
    }

    viewCanvas.width = sourceCanvas.width;
    viewCanvas.height = sourceCanvas.height;
    const ctx = viewCanvas.getContext("2d");
    ctx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);

    lightbox.hidden = false;
    lightbox.setAttribute("aria-hidden", "false");
    document.getElementById("btn-fechar-print-preview")?.focus?.();
    return true;
  }

  function closePreviewLightbox() {
    const lightbox = document.getElementById("print-preview-lightbox");
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lightbox.setAttribute("aria-hidden", "true");
  }

  /** Gera a prévia e abre o popup grande na mesma página. */
  async function previewLayout() {
    setStatus("Gerando prévia do layout…");
    await generate();
    const { canvas, modal } = els();
    if (!canvas || canvas.dataset.ready !== "1") {
      setStatus("Não foi possível montar a prévia.");
      return;
    }
    // Sai do modo painel lateral para o popup ficar em tela cheia
    if (modal?.classList.contains("is-map-adjust")) {
      setMapAdjustMode(false);
    }
    const opened = openPreviewLightbox(canvas);
    setStatus(
      opened
        ? "Prévia aberta. Feche o popup para voltar ao layout."
        : "Prévia gerada no painel."
    );
  }

  function applyLayoutPreset(presetKey) {
    const preset = LAYOUT_PRESETS[presetKey];
    if (!preset) return;
    const { paperSize, paperOrient, exportFormat, proportions } = els();
    if (paperSize) paperSize.value = preset.size;
    if (paperOrient) paperOrient.value = preset.orient;
    if (exportFormat) exportFormat.value = preset.format;
    if (proportions) {
      proportions.querySelectorAll(".print-prop").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.preset === presetKey);
      });
    }
    onPaperOptionsChange();
    const paper = PAPER_SIZES[preset.size];
    setStatus(
      `Proporção: ${paper?.label || preset.size} (${preset.orient === "landscape" ? "paisagem" : "retrato"}) · formato sugerido ${preset.format.toUpperCase()}. Clique em Gerar layout.`
    );
  }

  function syncPresetFromSelects() {
    const { sizeKey, orient, format } = selectedOptions();
    const { proportions } = els();
    if (!proportions) return;
    let match = null;
    Object.keys(LAYOUT_PRESETS).forEach((key) => {
      const p = LAYOUT_PRESETS[key];
      if (p.size === sizeKey && p.orient === orient) match = key;
    });
    proportions.querySelectorAll(".print-prop").forEach((btn) => {
      btn.classList.toggle("is-active", match != null && btn.dataset.preset === match);
    });
    // format may differ; still highlight size/orient match
  }

  function setFrameHint(text) {
    const { frameHint } = els();
    if (frameHint) frameHint.textContent = text;
  }

  function getMainMap() {
    return window.InfraGeoMap?.getMap?.() || null;
  }

  function invalidateReady() {
    const { canvas, btnDownload, btnDownloadPng } = els();
    if (canvas) canvas.dataset.ready = "0";
    if (btnDownload) btnDownload.disabled = true;
    if (btnDownloadPng) btnDownloadPng.disabled = true;
  }

  /** Enquadra a feição selecionada (clique no mapa). */
  function fitSelectedFeature() {
    const map = getMainMap();
    const sel = window.InfraGeoHoverPopup?.getSelection?.();
    if (!map) return;
    if (!sel?.feature) {
      setFrameHint("Clique em uma feição no mapa e depois em “Enquadrar feição”.");
      setStatus("Nenhuma feição selecionada. Clique em uma feição no mapa.");
      return;
    }

    try {
      const geomType = String(sel.feature?.geometry?.type || "");
      const isPoint = geomType === "Point" || geomType === "MultiPoint";
      if (isPoint && sel.feature.geometry.coordinates) {
        const c =
          geomType === "Point"
            ? sel.feature.geometry.coordinates
            : sel.feature.geometry.coordinates[0];
        map.setView(L.latLng(c[1], c[0]), Math.max(map.getZoom(), 15), {
          animate: true,
        });
      } else {
        const b = L.geoJSON(sel.feature).getBounds();
        if (b?.isValid?.()) {
          map.fitBounds(b, { padding: [40, 40], maxZoom: 17, animate: true });
        }
      }
      setFrameHint(
        `Feição enquadrada: ${sel.meta?.name || "seleção"}. Use “Mexer no mapa” para ajustar.`
      );
      setStatus("Feição enquadrada. Ajuste se quiser e clique em Gerar layout.");
      invalidateReady();
    } catch (err) {
      console.warn("fitSelectedFeature", err);
      setStatus("Não foi possível enquadrar a feição.");
    }
  }

  /** Enquadra camadas ativas do export. */
  function fitActiveLayer() {
    const map = getMainMap();
    if (!map) return;
    const metas = layersForExport();
    if (!metas.length) {
      setFrameHint("Ligue uma camada na sidebar ou selecione uma feição.");
      setStatus("Nenhuma camada ativa para enquadrar.");
      return;
    }

    let bounds = null;
    metas.forEach((meta) => {
      const entry = window.InfraGeoMap.overlayRegistry?.[meta.id];
      const b = entry?.leaflet?.getBounds?.();
      if (b?.isValid?.()) {
        bounds = bounds
          ? bounds.extend(b)
          : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
      }
    });

    if (!bounds?.isValid?.()) {
      setStatus("Não há geometria válida para enquadrar.");
      return;
    }

    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16, animate: true });
    setFrameHint("Camada(s) enquadrada(s). Use “Mexer no mapa” para ajustar fino.");
    setStatus("Camada enquadrada. Clique em Gerar layout quando estiver pronto.");
    invalidateReady();
  }

  function zoomMainMap(delta) {
    const map = getMainMap();
    if (!map) return;
    const next = Math.max(1, Math.min(22, map.getZoom() + delta));
    map.setZoom(next, { animate: true });
    invalidateReady();
    setStatus(`Zoom ${next}. A visão atual será usada no layout.`);
  }

  function destroyLiveMinimap() {
    const host = document.getElementById("print-live-minimap");
    const preview = document.getElementById("print-map-preview");
    const main = getMainMap();

    if (liveSyncHandler && main) {
      try {
        main.off("move", liveSyncHandler);
        main.off("zoom", liveSyncHandler);
        main.off("moveend", liveSyncHandler);
        main.off("zoomend", liveSyncHandler);
      } catch {
        /* ignore */
      }
    }
    liveSyncHandler = null;
    if (liveSyncRaf) {
      cancelAnimationFrame(liveSyncRaf);
      liveSyncRaf = 0;
    }

    if (liveMiniMap) {
      try {
        liveMiniMap.off();
        liveMiniMap.remove();
      } catch {
        /* ignore */
      }
      liveMiniMap = null;
    }
    if (host) {
      host.innerHTML = "";
      host.hidden = true;
    }
    preview?.classList.remove("is-live");
  }

  function syncLiveMinimapView() {
    const main = getMainMap();
    if (!liveMiniMap || !main) return;
    try {
      const host = document.getElementById("print-live-minimap");
      const aspect = getPrintMapAspect();
      if (host) {
        host.style.setProperty("--print-map-aspect", String(aspect));
      }
      liveMiniMap.invalidateSize({ animate: false });
      const snap = getVisibleMapSnapshot(main);
      if (snap?.bounds?.isValid?.()) {
        liveMiniMap.fitBounds(snap.bounds, {
          animate: false,
          padding: [0, 0],
          maxZoom: 22,
        });
        return;
      }
      liveMiniMap.setView(main.getCenter(), main.getZoom(), { animate: false });
    } catch (err) {
      console.warn("live minimap sync", err);
    }
  }

  function scheduleLiveMinimapSync() {
    if (liveSyncRaf) return;
    liveSyncRaf = requestAnimationFrame(() => {
      liveSyncRaf = 0;
      syncLiveMinimapView();
    });
  }

  function ensureLiveMinimap() {
    const host = document.getElementById("print-live-minimap");
    const preview = document.getElementById("print-map-preview");
    if (!host || !window.L) return null;

    host.hidden = false;
    preview?.classList.add("is-live");
    preview?.classList.add("is-visible");

    if (liveMiniMap) {
      liveMiniMap.invalidateSize({ animate: false });
      return liveMiniMap;
    }

    liveMiniMap = L.map(host, {
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
    });

    try {
      cloneBasemap(liveMiniMap);
      void cloneOverlays(liveMiniMap);
      window.InfraGeoMap?.addAmazonasMaskToMap?.(liveMiniMap);
    } catch (err) {
      console.warn("live minimap layers", err);
    }

    return liveMiniMap;
  }

  function startLiveMinimapSync() {
    const main = getMainMap();
    destroyLiveMinimap();
    if (!main) return;

    ensureLiveMinimap();
    liveSyncHandler = () => scheduleLiveMinimapSync();
    main.on("move", liveSyncHandler);
    main.on("zoom", liveSyncHandler);
    main.on("moveend", liveSyncHandler);
    main.on("zoomend", liveSyncHandler);

    // Dois frames: host precisa de altura no layout antes do invalidateSize
    requestAnimationFrame(() => {
      ensureLiveMinimap();
      syncLiveMinimapView();
      requestAnimationFrame(() => {
        syncLiveMinimapView();
      });
    });
  }

  function setMapAdjustMode(on) {
    const { modal, btnAdjustMap } = els();
    if (!modal) return;
    modal.classList.toggle("is-map-adjust", !!on);
    if (btnAdjustMap) {
      btnAdjustMap.textContent = on ? "Voltar ao layout" : "Mexer no mapa";
    }
    const map = getMainMap();
    if (on) {
      setFrameHint(
        "O quadro teal é a área do layout. Arraste/zoom no mapa — a prévia acompanha."
      );
      setStatus("Modo ajuste: enquadre o mapa dentro do limite do layout de impressão.");
      showPrintFrameOverlay(true);
      startLiveMinimapSync();
    } else {
      showPrintFrameOverlay(false);
      destroyLiveMinimap();
      setFrameHint(
        "A exportação usa a área do layout. Use “Mexer no mapa” para ajustar o enquadramento."
      );
    }
    if (map) {
      requestAnimationFrame(() => {
        try {
          map.invalidateSize({ animate: false, pan: false });
          if (on) {
            updatePrintFrameOverlay();
            syncLiveMinimapView();
          }
        } catch {
          /* ignore */
        }
      });
    }
  }

  function toggleMapAdjust() {
    const { modal } = els();
    setMapAdjustMode(!modal?.classList.contains("is-map-adjust"));
  }

  function open(show, opts) {
    const { modal } = els();
    if (!modal) return;
    modal.hidden = !show;
    modal.setAttribute("aria-hidden", String(!show));
    if (show) {
      const { title, canvas, btnDownload, btnDownloadPng } = els();
      if (title && !title.value.trim()) {
        title.value = defaultTitle();
      }
      syncEditDefaultsFromSelection();
      if (btnDownload) btnDownload.disabled = true;
      if (btnDownloadPng) btnDownloadPng.disabled = true;
      if (canvas) canvas.dataset.ready = "0";
      if (opts?.preset) applyLayoutPreset(opts.preset);
      else syncPresetFromSelects();
      setMapAdjustMode(false);
      updatePreviewChrome();
    setStatus(
      "A exportação usa a visão atual do mapa. Use “Mexer no mapa” só se quiser ajustar antes."
    );
    } else {
      closePreviewLightbox();
      setMapAdjustMode(false);
      cleanupPrintArtifacts();
    }
  }

  /** Abre o layout já focado em proporções de impressão/download. */
  function openLayoutChooser() {
    open(true, { fromEditor: false, preset: "a4-landscape" });
  }

  function defaultTitle() {
    const sel = window.InfraGeoHoverPopup?.getSelection?.();
    if (sel?.meta?.name) {
      const props = sel.feature?.properties || {};
      const hint =
        props.nome ||
        props.NOME ||
        props.name ||
        props.NAME ||
        props.codigo ||
        props.CODIGO ||
        "";
      if (hint) return `${sel.meta.name} — ${hint}`;
      return sel.meta.name;
    }
    const layers = window.InfraGeoMap?.getVisibleLayers?.() || [];
    const named = layers.filter((l) => !isLimiteEstadualMeta(l));
    if (named.length === 1) return named[0].name || "Mapa temático";
    if (named.length > 1) return `Mapa — ${named.length} camadas`;
    return "Mapa InfraGeo AM";
  }

  function setStatus(msg) {
    const { status } = els();
    if (status) status.textContent = msg || "";
  }

  function isLimiteEstadualMeta(meta) {
    if (!meta) return false;
    if (window.InfraGeoLayers?.isLimiteEstadual?.(meta)) {
      return window.InfraGeoLayers.isLimiteEstadual(meta);
    }
    const schema = String(meta.schema || "").toUpperCase();
    const table = String(meta.table || meta.id || "").toUpperCase();
    return schema.startsWith("LIMITE_ESTADUAL") || table.includes("LIMITE_ESTADUAL");
  }

  function findLimiteEstadualMeta() {
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    const fromRegistry = Object.values(registry)
      .map((e) => e?.meta)
      .find(isLimiteEstadualMeta);
    if (fromRegistry) return fromRegistry;
    const catalog = window.InfraGeoLayers?.allLayerMetas?.() || [];
    return catalog.find(isLimiteEstadualMeta) || null;
  }

  /** Bounds do Amazonas (limite estadual), mesmo se a camada estiver oculta no registry. */
  function getAmazonasBounds() {
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    for (const entry of Object.values(registry)) {
      if (!isLimiteEstadualMeta(entry?.meta)) continue;
      const b = entry?.leaflet?.getBounds?.();
      if (b?.isValid?.()) return b;
    }
    const ab = window.InfraGeoConfig?.amazonaBounds;
    if (ab) return L.latLngBounds(ab[0], ab[1]);
    return null;
  }

  /**
   * Todas as camadas ligadas no mapa entram na captura/legenda.
   * (Não filtra pela seleção — o clique só destaca no mapa principal.)
   */
  function layersForExport() {
    const registry = window.InfraGeoMap?.overlayRegistry || {};
    const checked = window.InfraGeoLayers?.getState?.()?.checked || {};

    // Preferência: checkboxes ligados com dados carregados
    const fromChecked = Object.keys(checked)
      .filter((id) => checked[id] && registry[id]?.leaflet)
      .map((id) => registry[id].meta)
      .filter(Boolean);
    if (fromChecked.length) return fromChecked;

    const visible = window.InfraGeoMap?.getVisibleLayers?.() || [];
    if (visible.length) return visible.slice();

    const fromRegistry = Object.values(registry)
      .filter((e) => e?.visible && e?.meta)
      .map((e) => e.meta);
    if (fromRegistry.length) return fromRegistry;

    const meta = findLimiteEstadualMeta();
    return meta ? [meta] : [];
  }

  function legendItems() {
    const edit = editOptions();
    const active = layersForExport().filter((l) => !isLimiteEstadualMeta(l));
    const single = active.length === 1;
    return active.map((l) => {
      const style = l.style || {};
      const isPoint = l.type === "Point" || l.type === "MultiPoint";
      const isLine =
        l.type === "LineString" ||
        l.type === "MultiLineString" ||
        String(l.type || "").toLowerCase().includes("line");
      const customName =
        edit.legendLabel && single ? edit.legendLabel : null;
      const useEditColor = single;
      return {
        name: customName || l.name || l.id,
        color: useEditColor
          ? edit.featureColor || style.fillColor || style.color || "#64748b"
          : style.fillColor || style.color || "#64748b",
        stroke: useEditColor
          ? edit.featureStroke || style.color || style.fillColor || "#334155"
          : style.color || style.fillColor || "#334155",
        isPoint,
        isLine,
        weight: style.weight || 2,
      };
    });
  }

  function formatDate() {
    return new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

  /** Escalas cartográficas padrão (denominador). */
  const STANDARD_SCALES = [
    500, 1000, 2000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000,
    100000, 150000, 200000, 250000, 500000, 750000, 1000000, 1500000, 2000000,
    2500000, 5000000, 7500000, 10000000,
  ];

  function roundToStandardScale(den) {
    if (!den || den <= 0) return null;
    let best = STANDARD_SCALES[0];
    let bestDiff = Math.abs(den - best);
    STANDARD_SCALES.forEach((s) => {
      const d = Math.abs(den - s);
      if (d < bestDiff) {
        best = s;
        bestDiff = d;
      }
    });
    // se estiver muito longe do padrão (zoom intermediário), arredonda para múltiplo "bonito"
    if (bestDiff / den > 0.35) {
      const mag = Math.pow(10, Math.floor(Math.log10(den)));
      const norm = den / mag;
      const steps = [1, 1.5, 2, 2.5, 5, 7.5, 10];
      let n = steps[0];
      let nd = Math.abs(norm - n);
      steps.forEach((st) => {
        const dd = Math.abs(norm - st);
        if (dd < nd) {
          n = st;
          nd = dd;
        }
      });
      return Math.round(n * mag);
    }
    return best;
  }

  /** Denominador real da escala (sem arredondar). */
  function scaleDenominatorRaw(map, mapWidthPx) {
    try {
      if (!map || !mapWidthPx) return null;
      const center = map.getCenter();
      const zoom = map.getZoom();
      const mpp =
        (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) /
        Math.pow(2, zoom);
      const metersAcross = mpp * mapWidthPx;
      const paperWidthM = (mapWidthPx / DPI) * 0.0254;
      return Math.max(1, Math.round(metersAcross / paperWidthM));
    } catch {
      return null;
    }
  }

  /** Denominador arredondado para escala cartográfica padrão (ex.: 50000). */
  function scaleDenominator(map, mapWidthPx) {
    const raw = scaleDenominatorRaw(map, mapWidthPx);
    return roundToStandardScale(raw);
  }

  /** Escala formatada (ex.: 1: 50.000). */
  function approxScale(map, mapWidthPx) {
    const den = scaleDenominator(map, mapWidthPx);
    if (!den) return "—";
    return `1: ${den.toLocaleString("pt-BR")}`;
  }

  function niceScaleKm(rawKm) {
    const candidates = [
      0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 150, 200, 250, 500,
      750, 1000, 1500, 2000,
    ];
    let best = candidates[0];
    let bestDiff = Math.abs(rawKm - best);
    candidates.forEach((c) => {
      const d = Math.abs(rawKm - c);
      if (d < bestDiff) {
        best = c;
        bestDiff = d;
      }
    });
    return best;
  }

  /**
   * Barra gráfica com distância real no terreno (usa denominador bruto).
   * O rótulo "ESCALA 1:…" usa o valor padronizado à parte.
   */
  function drawScaleBar(ctx, x, y, mapWidthPx, denRaw, theme, fontFamily, fontMul) {
    if (!denRaw) return y;
    const paperWidthM = (mapWidthPx / DPI) * 0.0254;
    const targetBarPx = Math.min(mapWidthPx * 0.34, 280 * (DPI / 150));
    const rawKm = ((targetBarPx / mapWidthPx) * (denRaw * paperWidthM)) / 1000;
    const niceKm = niceScaleKm(rawKm);
    const barPx = Math.max(
      48,
      Math.min(mapWidthPx * 0.5, (niceKm * 1000 * mapWidthPx) / (denRaw * paperWidthM))
    );
    const segs = niceKm >= 1 ? 4 : 2;
    const segW = barPx / segs;
    const barH = Math.max(7, Math.round(8 * (DPI / 150)));
    const s = DPI / 150;
    const ff = fontFamily || "Manrope, Segoe UI, sans-serif";
    const fm = fontMul || 1;

    ctx.save();
    for (let i = 0; i < segs; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? "#111111" : "#ffffff";
      ctx.fillRect(x + i * segW, y, segW, barH);
    }
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = Math.max(1, s);
    ctx.strokeRect(x, y, barPx, barH);

    ctx.fillStyle = theme.text || "#111111";
    ctx.font = `600 ${Math.max(9, Math.round(10 * s * fm))}px ${ff}`;
    ctx.textAlign = "center";
    const labelY = y + barH + Math.round(12 * s * fm);
    ctx.fillText("0", x, labelY);
    if (segs === 4) {
      ctx.fillText(String(niceKm / 2).replace(".", ","), x + barPx / 2, labelY);
    }
    const unit = niceKm < 1 ? `${Math.round(niceKm * 1000)} m` : `${niceKm} km`;
    ctx.fillText(unit, x + barPx, labelY);
    ctx.restore();
    return labelY + Math.round(6 * s);
  }

  function drawGraticuleFrame(ctx, x, y, w, h, map) {
    const tick = Math.max(6, Math.round(8 * (DPI / 150)));
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = Math.max(1.5, 2 * (DPI / 150));
    ctx.strokeRect(x, y, w, h);
    // moldura dupla
    const inset = Math.max(3, Math.round(4 * (DPI / 150)));
    ctx.lineWidth = Math.max(0.8, 1 * (DPI / 150));
    ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);

    // Apenas ticks discretos — sem números de lat/long
    if (!map) return;
    let bounds;
    try {
      bounds = map.getBounds();
    } catch {
      return;
    }
    if (!bounds?.isValid?.()) return;

    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const px = x + w * t;
      const py = y + h * (1 - t);

      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + tick);
      ctx.moveTo(px, y + h);
      ctx.lineTo(px, y + h - tick);
      ctx.moveTo(x, py);
      ctx.lineTo(x + tick, py);
      ctx.moveTo(x + w, py);
      ctx.lineTo(x + w - tick, py);
      ctx.stroke();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawNorthArrow(ctx, x, y) {
    const s = DPI / 150;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // Fundo circular para ler sobre o mapa
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Rosa dos ventos (N/S/E/W)
    const arms = [
      { rot: 0, fill: "#e11d48", label: "N" },
      { rot: Math.PI / 2, fill: "#111111", label: "E" },
      { rot: Math.PI, fill: "#111111", label: "S" },
      { rot: -Math.PI / 2, fill: "#111111", label: "W" },
    ];
    arms.forEach((arm) => {
      ctx.save();
      ctx.rotate(arm.rot);
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(5, 2);
      ctx.lineTo(0, -2);
      ctx.lineTo(-5, 2);
      ctx.closePath();
      ctx.fillStyle = arm.fill;
      ctx.fill();
      ctx.restore();
    });

    ctx.fillStyle = "#111111";
    ctx.font = "800 11px Manrope, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", 0, -22);
    ctx.restore();
  }

  /** Desenha a rosa dos ventos DENTRO da moldura do mapa. */
  function drawNorthArrowInMap(ctx, mapX, mapY, mapW, mapH) {
    const s = DPI / 150;
    const ax = mapX + mapW - Math.round(42 * s);
    const ay = mapY + Math.round(42 * s);
    // Garante que fique dentro do retângulo do mapa
    if (ax < mapX + 20 || ay < mapY + 20) return;
    if (ax > mapX + mapW - 10 || ay > mapY + mapH - 10) return;
    drawNorthArrow(ctx, ax, ay);
  }

  function drawLegendSwatch(ctx, item, x, y) {
    const s = DPI / 150;
    if (item.isPoint) {
      ctx.beginPath();
      ctx.fillStyle = item.color;
      ctx.strokeStyle = item.stroke;
      ctx.lineWidth = 1.5 * s;
      ctx.arc(x + 8 * s, y, 6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    if (item.isLine) {
      ctx.strokeStyle = item.stroke || item.color;
      ctx.lineWidth = Math.max(2, item.weight || 2) * s;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 22 * s, y);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = item.color;
    ctx.strokeStyle = item.stroke;
    ctx.lineWidth = 1.25 * s;
    ctx.beginPath();
    ctx.rect(x, y - 6 * s, 18 * s, 12 * s);
    ctx.fill();
    ctx.stroke();
  }

  function drawConventions(ctx, x, y, theme, fontFamily, fontMul, maxY) {
    const s = DPI / 150;
    const ff = fontFamily || "Manrope, Segoe UI, sans-serif";
    const fm = fontMul || 1;
    const rows = [
      { label: "Limite estadual", draw: (cx, cy) => {
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = 2.2 * s;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 20 * s, cy);
        ctx.stroke();
      }},
      { label: "Limite interestadual", draw: (cx, cy) => {
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 1.1 * s;
        ctx.setLineDash([4 * s, 3 * s]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 20 * s, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }},
      { label: "Limite internacional", draw: (cx, cy) => {
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = 1.8 * s;
        ctx.setLineDash([5 * s, 2.5 * s, 1.2 * s, 2.5 * s]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 20 * s, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }},
      { label: "Hidrografia", draw: (cx, cy) => {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 1.8 * s;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 20 * s, cy);
        ctx.stroke();
      }},
      { label: "Sede municipal", draw: (cx, cy) => {
        ctx.fillStyle = "#dc2626";
        ctx.beginPath();
        ctx.arc(cx + 9 * s, cy, 3.5 * s, 0, Math.PI * 2);
        ctx.fill();
      }},
    ];
    const rowH = Math.round(18 * s * fm);
    ctx.fillStyle = theme.text;
    ctx.font = `800 ${Math.max(10, Math.round(11 * s * fm))}px ${ff}`;
    ctx.textAlign = "left";
    ctx.fillText("CONVENÇÕES CARTOGRÁFICAS", x, y);
    let yy = y + Math.round(18 * s * fm);
    ctx.font = `600 ${Math.max(9, Math.round(10 * s * fm))}px ${ff}`;
    rows.forEach((row) => {
      if (maxY && yy + rowH > maxY) return;
      row.draw(x, yy - 3);
      ctx.fillStyle = theme.text;
      ctx.fillText(row.label, x + 28 * s, yy);
      yy += rowH;
    });
    return yy;
  }

  async function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function loadLogo() {
    return loadImage("/static/img/logo-spu.svg");
  }

  async function loadBrandLogo() {
    return loadImage("/static/img/infrageo-brand.png");
  }

  /** Marca InfraGEO minimalista (imagem ou wordmark). */
  function drawMinimalBrand(ctx, x, y, maxW, maxH, brandImg) {
    if (brandImg && brandImg.width > 0) {
      const ratio = brandImg.width / brandImg.height;
      let h = maxH;
      let w = h * ratio;
      if (w > maxW) {
        w = maxW;
        h = w / ratio;
      }
      ctx.drawImage(brandImg, x, y, w, h);
      return { w, h };
    }
    // Fallback tipográfico (paleta da marca)
    const navy = "#0b2a4a";
    const green = "#1a7a3a";
    const gray = "#8a8a8a";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const titleSize = Math.max(18, Math.round(maxH * 0.38));
    ctx.font = `800 ${titleSize}px Manrope, Segoe UI, sans-serif`;
    const infra = "Infra";
    const geo = "GEO";
    ctx.fillStyle = navy;
    ctx.fillText(infra, x, y + titleSize);
    const infraW = ctx.measureText(infra).width;
    ctx.fillStyle = green;
    ctx.fillText(geo, x + infraW, y + titleSize);
    const lineY = y + titleSize + Math.round(maxH * 0.18);
    ctx.strokeStyle = "#cfcfcf";
    ctx.lineWidth = Math.max(1, maxH * 0.02);
    ctx.beginPath();
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + Math.min(maxW, infraW + ctx.measureText(geo).width), lineY);
    ctx.stroke();
    ctx.fillStyle = green;
    ctx.font = `700 ${Math.max(11, Math.round(maxH * 0.22))}px Manrope, Segoe UI, sans-serif`;
    ctx.fillText("Meio Ambiente", x, lineY + Math.round(maxH * 0.28));
    return { w: maxW, h: maxH };
  }

  function collectExportBounds() {
    // 1) Camadas temáticas ativas (SHP / camada com zoom) — sem o limite estadual
    const thematic = layersForExport().filter((l) => !isLimiteEstadualMeta(l));
    let bounds = null;
    thematic.forEach((l) => {
      const entry = window.InfraGeoMap.overlayRegistry?.[l.id];
      const b = entry?.leaflet?.getBounds?.();
      if (b?.isValid?.()) {
        bounds = bounds
          ? bounds.extend(b)
          : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
      }
    });
    if (bounds?.isValid?.()) return bounds;

    // 2) Feição selecionada (se não houver bounds de camada)
    const sel = window.InfraGeoHoverPopup?.getSelection?.();
    if (sel?.feature && !isLimiteEstadualMeta(sel.meta)) {
      try {
        const b = L.geoJSON(sel.feature).getBounds();
        if (b?.isValid?.()) return b;
      } catch {
        /* ignore */
      }
    }

    // 3) Visão atual do mapa principal
    const mainMap = window.InfraGeoMap?.getMap?.();
    const mb = mainMap?.getBounds?.();
    if (mb?.isValid?.()) return mb;

    // 4) Fallback: limite estadual
    return getAmazonasBounds();
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Garante que o mapa principal volte a preencher .map-area. */
  function restoreMainMapLayout() {
    document
      .querySelectorAll(
        "#print-capture-host, #print-capture-shield, #print-capture-map"
      )
      .forEach((el) => {
        try {
          el.remove();
        } catch {
          /* ignore */
        }
      });

    const map = window.InfraGeoMap?.getMap?.();
    const container = map?.getContainer?.() || document.getElementById("map");
    const mapArea = document.querySelector(".map-area");

    if (container && mapArea && container.parentElement !== mapArea) {
      mapArea.prepend(container);
    }

    if (container) {
      // remove TODOS os estilos inline (fixed/left/width da exportação antiga)
      container.removeAttribute("style");
      const ctrl = container.querySelector(".leaflet-control-container");
      if (ctrl) ctrl.style.display = "";
    }

    const modal = els().modal;
    if (modal) modal.style.visibility = "";

    if (map) {
      try {
        // só recalcula tamanho — NÃO muda centro/zoom do mapa principal
        requestAnimationFrame(() => {
          map.invalidateSize({ animate: false, pan: false });
        });
      } catch {
        /* ignore */
      }
    }
  }

  function cleanupPrintArtifacts() {
    restoreMainMapLayout();
  }

  function findActiveBasemapLayer() {
    const map = window.InfraGeoMap?.getMap?.();
    if (!map) return null;
    let tile = null;
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) tile = layer;
    });
    return tile;
  }

  function cloneBasemap(exportMap) {
    const src = findActiveBasemapLayer();
    const url =
      src?._url ||
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
    const opts = {
      ...(src?.options || {}),
      crossOrigin: true,
      opacity: 1,
    };
    delete opts.pane;
    delete opts.map;
    delete opts.renderer;
    L.tileLayer(url, opts).addTo(exportMap);
  }

  function layerGeoJSONForExport(entry) {
    if (!entry) return null;
    if (entry.geojson) return entry.geojson;
    try {
      return entry.leaflet?.toGeoJSON?.() || null;
    } catch {
      return null;
    }
  }

  function geojsonFeatureList(geojson) {
    if (!geojson) return [];
    if (geojson.type === "FeatureCollection") return geojson.features || [];
    if (geojson.type === "Feature") return [geojson];
    return [{ type: "Feature", properties: {}, geometry: geojson }];
  }

  function projectPoint(exportMap, lng, lat) {
    return exportMap.latLngToContainerPoint([lat, lng]);
  }

  function buildExportStyle(meta, thematicCount, edit) {
    const style = meta.style || {};
    const isLimite = isLimiteEstadualMeta(meta);
    const useEdit = !isLimite && thematicCount === 1;
    const isLine =
      meta.type === "LineString" ||
      meta.type === "MultiLineString" ||
      String(meta.type || "").toLowerCase().includes("line");
    const isPoint = meta.type === "Point" || meta.type === "MultiPoint";

    const fill = isLimite
      ? "transparent"
      : useEdit
        ? edit.featureColor || style.fillColor || style.color || "#14b8a6"
        : style.fillColor || style.color || "#14b8a6";
    const stroke = isLimite
      ? style.color || "#111827"
      : useEdit
        ? edit.featureStroke || style.color || "#0f766e"
        : style.color || style.fillColor || "#0f766e";

    const baseWeight = isLimite
      ? style.weight ?? 2.5
      : style.weight ?? (isLine ? 2.5 : 2);

    return {
      isLimite,
      isLine,
      isPoint,
      fillColor: fill,
      color: stroke,
      weight: isLimite ? baseWeight : Math.max(baseWeight, isLine ? 2.5 : 1.5),
      opacity: style.opacity ?? 1,
      fillOpacity: isLimite
        ? 0
        : isLine
          ? 0
          : isPoint
            ? style.fillOpacity ?? 0.9
            : style.fillOpacity ?? 0.45,
      radius: Math.max(style.radius || 7, 5),
      dashArray: style.dashArray || null,
    };
  }

  function paintRing(ctx, exportMap, ring) {
    if (!ring || ring.length < 2) return;
    for (let i = 0; i < ring.length; i += 1) {
      const coord = ring[i];
      if (!coord || coord.length < 2) continue;
      const p = projectPoint(exportMap, coord[0], coord[1]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  }

  function applyStrokeDash(ctx, style) {
    if (style?.dashArray) {
      const parts = String(style.dashArray)
        .split(/[\s,]+/)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0);
      ctx.setLineDash(parts.length ? parts : []);
    } else {
      ctx.setLineDash([]);
    }
  }

  function paintGeometry(ctx, exportMap, geometry, style) {
    if (!geometry || !geometry.type) return;
    const type = geometry.type;

    if (type === "GeometryCollection") {
      (geometry.geometries || []).forEach((g) =>
        paintGeometry(ctx, exportMap, g, style)
      );
      return;
    }

    if (type === "Point") {
      const [lng, lat] = geometry.coordinates || [];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const p = projectPoint(exportMap, lng, lat);
      ctx.beginPath();
      ctx.arc(p.x, p.y, style.radius, 0, Math.PI * 2);
      ctx.fillStyle = style.fillColor;
      ctx.globalAlpha = style.fillOpacity ?? 0.9;
      ctx.fill();
      ctx.globalAlpha = style.opacity ?? 1;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = Math.max(1, style.weight * 0.7);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    if (type === "MultiPoint") {
      (geometry.coordinates || []).forEach((c) =>
        paintGeometry(ctx, exportMap, { type: "Point", coordinates: c }, style)
      );
      return;
    }

    if (type === "LineString") {
      ctx.beginPath();
      paintRing(ctx, exportMap, geometry.coordinates || []);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.weight;
      ctx.globalAlpha = style.opacity ?? 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      applyStrokeDash(ctx, style);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }

    if (type === "MultiLineString") {
      (geometry.coordinates || []).forEach((line) =>
        paintGeometry(
          ctx,
          exportMap,
          { type: "LineString", coordinates: line },
          style
        )
      );
      return;
    }

    if (type === "Polygon") {
      const rings = geometry.coordinates || [];
      ctx.beginPath();
      rings.forEach((ring) => {
        paintRing(ctx, exportMap, ring);
        ctx.closePath();
      });
      if ((style.fillOpacity ?? 0) > 0 && style.fillColor !== "transparent") {
        ctx.fillStyle = style.fillColor;
        ctx.globalAlpha = style.fillOpacity;
        ctx.fill("evenodd");
      }
      ctx.globalAlpha = style.opacity ?? 1;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.weight;
      applyStrokeDash(ctx, style);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }

    if (type === "MultiPolygon") {
      (geometry.coordinates || []).forEach((poly) =>
        paintGeometry(
          ctx,
          exportMap,
          { type: "Polygon", coordinates: poly },
          style
        )
      );
    }
  }

  /** Desenha camadas ligadas direto no canvas (independe do canvas Leaflet). */
  async function paintVisibleLayersOnCanvas(ctx, exportMap) {
    const layers = layersForExport();
    if (!layers.length) return 0;

    const edit = editOptions();
    const thematicCount = layers.filter((l) => !isLimiteEstadualMeta(l)).length;
    const ordered = [...layers].sort((a, b) => {
      const aLim = isLimiteEstadualMeta(a) ? 0 : 1;
      const bLim = isLimiteEstadualMeta(b) ? 0 : 1;
      return aLim - bLim;
    });

    let painted = 0;
    for (const meta of ordered) {
      const entry = window.InfraGeoMap?.overlayRegistry?.[meta.id];
      const geojson = layerGeoJSONForExport(entry);
      if (!geojson) continue;

      const baseStyle = buildExportStyle(meta, thematicCount, edit);
      const features = geojsonFeatureList(geojson);
      const dense = features.length > 400;
      const style = {
        ...baseStyle,
        radius: dense
          ? Math.max(3, Math.round(baseStyle.radius * 0.55))
          : baseStyle.radius,
        weight: dense && baseStyle.isPoint ? 1 : baseStyle.weight,
      };

      for (let i = 0; i < features.length; i += 1) {
        const geom = features[i]?.geometry;
        if (!geom) continue;
        try {
          paintGeometry(ctx, exportMap, geom, style);
          painted += 1;
        } catch {
          /* feição inválida */
        }
        if (i > 0 && i % GEOJSON_CHUNK === 0) {
          await wait(0);
        }
      }
      await wait(0);
    }
    return painted;
  }

  /** Prévia ao vivo: clona camadas de forma leve. */
  async function cloneOverlays(exportMap) {
    const layers = layersForExport();
    const edit = editOptions();
    const thematicCount = layers.filter((l) => !isLimiteEstadualMeta(l)).length;

    for (const meta of layers) {
      const entry = window.InfraGeoMap?.overlayRegistry?.[meta.id];
      const geojson = layerGeoJSONForExport(entry);
      if (!geojson) continue;
      const style = buildExportStyle(meta, thematicCount, edit);
      try {
        L.geoJSON(geojson, {
          style: () => ({
            color: style.color,
            fillColor: style.fillColor,
            weight: style.weight,
            opacity: style.opacity,
            fillOpacity: style.fillOpacity,
            ...(style.dashArray ? { dashArray: style.dashArray } : {}),
          }),
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, {
              radius: Math.min(style.radius, 6),
              fillColor: style.fillColor,
              color: style.color,
              weight: 1,
              opacity: 1,
              fillOpacity: style.fillOpacity || 0.9,
            }),
          interactive: false,
        }).addTo(exportMap);
      } catch {
        /* ignore */
      }
      await wait(0);
    }
  }

  function drawElementToCapture(ctx, el, hostRect, scaleX, scaleY) {
    if (!el || !hostRect) return;
    try {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return;
      ctx.drawImage(
        el,
        (r.left - hostRect.left) * scaleX,
        (r.top - hostRect.top) * scaleY,
        r.width * scaleX,
        r.height * scaleY
      );
    } catch {
      /* tainted / vazio */
    }
  }

  function paintBasemapTiles(ctx, mapDiv, mapW, mapH) {
    ctx.fillStyle = "#e8eef5";
    ctx.fillRect(0, 0, mapW, mapH);

    const hostRect = mapDiv.getBoundingClientRect();
    if (!(hostRect.width > 0) || !(hostRect.height > 0)) return false;

    const scaleX = mapW / hostRect.width;
    const scaleY = mapH / hostRect.height;
    let painted = 0;

    mapDiv
      .querySelectorAll(".leaflet-tile-pane img.leaflet-tile")
      .forEach((img) => {
        if (!img.complete || !(img.naturalWidth > 0)) return;
        drawElementToCapture(ctx, img, hostRect, scaleX, scaleY);
        painted += 1;
      });

    return painted > 0;
  }

  async function rasterizeExportMap(exportMap, mapDiv, mapW, mapH) {
    const canvas = document.createElement("canvas");
    canvas.width = mapW;
    canvas.height = mapH;
    const ctx = canvas.getContext("2d");

    paintBasemapTiles(ctx, mapDiv, mapW, mapH);
    setStatus("Desenhando camadas no layout…");
    const count = await paintVisibleLayersOnCanvas(ctx, exportMap);
    if (!count) {
      console.warn("print-map: nenhuma feição pintada na exportação");
    }
    return canvas;
  }

  function forceExportRedraw(exportMap) {
    if (!exportMap) return;
    try {
      exportMap.invalidateSize({ animate: false });
    } catch {
      /* ignore */
    }
  }

  function waitForTiles(map, timeoutMs = 2500) {
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
        if (layer._loading === false && layer._tiles && Object.keys(layer._tiles).length) {
          setTimeout(onLoad, 0);
        } else {
          layer.once("load", onLoad);
        }
      });
    });
  }

  function fitExportMap(map, bounds, opts) {
    const pad = opts?.padding || [48, 48];
    const maxZoom = opts?.maxZoom ?? 17;
    const target =
      bounds ||
      (window.InfraGeoConfig?.amazonaBounds
        ? L.latLngBounds(
            window.InfraGeoConfig.amazonaBounds[0],
            window.InfraGeoConfig.amazonaBounds[1]
          )
        : null);
    if (!target?.isValid?.()) return;

    map.invalidateSize({ animate: false });
    map.fitBounds(target, {
      padding: pad,
      maxZoom,
      animate: false,
    });
    const zoom = Math.min(map.getBoundsZoom(target, false, pad), maxZoom);
    if (Number.isFinite(zoom)) {
      map.setView(target.getCenter(), zoom, { animate: false });
    }
  }

  function getPrintMapAspect() {
    const { mapW, mapH } = getExportMapSize();
    if (!mapW || !mapH) return 1.4;
    return mapW / mapH;
  }

  /** Retângulo (px no container) com a proporção da área do mapa no layout de impressão. */
  function getPrintFrameScreenRect(mainMap) {
    if (!mainMap) return null;
    const size = mainMap.getSize();
    if (!size || !(size.x > 0) || !(size.y > 0)) return null;

    const modal = els().modal;
    const inAdjust =
      !!modal && !modal.hidden && modal.classList.contains("is-map-adjust");

    let visibleW = size.x;
    let visibleH = size.y;
    let originX = 0;
    let originY = 0;

    if (inAdjust) {
      const card = modal.querySelector(".print-modal__card");
      const cardRect = card?.getBoundingClientRect?.();
      const mapRect = mainMap.getContainer()?.getBoundingClientRect?.();
      if (cardRect && mapRect) {
        const overlapRight = Math.max(0, mapRect.right - cardRect.left);
        const overlapLeft = Math.max(0, cardRect.right - mapRect.left);
        const overlayW = Math.min(Math.max(overlapRight, 0), size.x * 0.85);
        visibleW = Math.max(120, size.x - overlayW);
        if (overlapLeft > overlapRight && overlapLeft > 80) {
          originX = Math.min(overlapLeft, size.x * 0.85);
          visibleW = Math.max(120, size.x - originX);
        }
      }
    }

    const aspect = getPrintMapAspect();
    const margin = 28;
    const availW = Math.max(80, visibleW - margin * 2);
    const availH = Math.max(80, visibleH - margin * 2);
    let fw;
    let fh;
    if (availW / availH > aspect) {
      fh = availH;
      fw = fh * aspect;
    } else {
      fw = availW;
      fh = fw / aspect;
    }

    const left = originX + (visibleW - fw) / 2;
    const top = originY + (visibleH - fh) / 2;

    return {
      left,
      top,
      width: fw,
      height: fh,
      right: left + fw,
      bottom: top + fh,
      visibleW,
      visibleH,
      originX,
      originY,
      inAdjust,
      aspect,
    };
  }

  function updatePrintFrameOverlay() {
    const mainMap = getMainMap();
    if (!mainMap || !printFrameEl) return;
    const rect = getPrintFrameScreenRect(mainMap);
    if (!rect) return;
    printFrameEl.style.left = `${rect.left}px`;
    printFrameEl.style.top = `${rect.top}px`;
    printFrameEl.style.width = `${rect.width}px`;
    printFrameEl.style.height = `${rect.height}px`;
    const label = printFrameEl.querySelector(".print-layout-frame__label");
    if (label) {
      const layout = getLayout();
      label.textContent = `Área do layout · ${layout.paperLabel} ${layout.orientLabel}`;
    }
  }

  function showPrintFrameOverlay(on) {
    const mainMap = getMainMap();
    const container = mainMap?.getContainer?.();
    if (!on) {
      if (printFrameMoveHandler && mainMap) {
        try {
          mainMap.off("move", printFrameMoveHandler);
          mainMap.off("zoom", printFrameMoveHandler);
          mainMap.off("resize", printFrameMoveHandler);
          mainMap.off("moveend", printFrameMoveHandler);
          mainMap.off("zoomend", printFrameMoveHandler);
        } catch {
          /* ignore */
        }
      }
      printFrameMoveHandler = null;
      if (printFrameEl) {
        try {
          printFrameEl.remove();
        } catch {
          /* ignore */
        }
        printFrameEl = null;
      }
      return;
    }
    if (!container) return;

    if (!printFrameEl) {
      printFrameEl = document.createElement("div");
      printFrameEl.className = "print-layout-frame";
      printFrameEl.setAttribute("aria-hidden", "true");
      printFrameEl.innerHTML =
        '<span class="print-layout-frame__label">Área do layout</span>';
      // leaflet-container is position:relative
      container.appendChild(printFrameEl);
    }

    if (!printFrameMoveHandler) {
      printFrameMoveHandler = () => updatePrintFrameOverlay();
      mainMap.on("move", printFrameMoveHandler);
      mainMap.on("zoom", printFrameMoveHandler);
      mainMap.on("resize", printFrameMoveHandler);
      mainMap.on("moveend", printFrameMoveHandler);
      mainMap.on("zoomend", printFrameMoveHandler);
    }
    updatePrintFrameOverlay();
  }

  /**
   * Área geográfica = retângulo do layout de impressão (proporção do mapa no papel).
   * No modo “Mexer no mapa”, o quadro fica na área livre (fora do painel).
   */
  function getVisibleMapSnapshot(mainMap) {
    if (!mainMap) return null;
    const rect = getPrintFrameScreenRect(mainMap);
    if (!rect) return null;

    const nw = mainMap.containerPointToLatLng([rect.left, rect.top]);
    const ne = mainMap.containerPointToLatLng([rect.right, rect.top]);
    const sw = mainMap.containerPointToLatLng([rect.left, rect.bottom]);
    const se = mainMap.containerPointToLatLng([rect.right, rect.bottom]);
    const bounds = L.latLngBounds([nw, ne, sw, se]);
    const center = mainMap.containerPointToLatLng([
      (rect.left + rect.right) / 2,
      (rect.top + rect.bottom) / 2,
    ]);

    return {
      bounds,
      center,
      zoom: mainMap.getZoom(),
      visibleW: rect.visibleW,
      visibleH: rect.visibleH,
      frameW: rect.width,
      frameH: rect.height,
      aspect: rect.aspect,
      inAdjust: rect.inAdjust,
    };
  }

  /**
   * Visão da exportação = área do quadro do layout de impressão.
   */
  function syncExportView(exportMap, mainMap, lockedSnapshot) {
    exportMap.invalidateSize({ animate: false });

    const snap = lockedSnapshot || getVisibleMapSnapshot(mainMap);
    if (snap?.bounds?.isValid?.()) {
      exportMap.fitBounds(snap.bounds, {
        animate: false,
        padding: [0, 0],
        maxZoom: 22,
      });
      return;
    }

    if (snap?.center && Number.isFinite(snap.zoom)) {
      exportMap.setView(snap.center, snap.zoom, { animate: false });
      return;
    }

    if (mainMap) {
      exportMap.setView(mainMap.getCenter(), mainMap.getZoom(), {
        animate: false,
      });
      return;
    }

    const target = collectExportBounds();
    fitExportMap(exportMap, target || getAmazonasBounds(), { maxZoom: 16 });
  }

  /**
   * Captura fora da tela — o mapa de fundo (principal) não muda de zoom/visão
   * e não aparece o mapa enquadrado atrás do modal.
   */
  async function captureExportMapImage() {
    // remove só artefatos de captura; não mexe na visão do mapa principal
    document
      .querySelectorAll("#print-capture-host, #print-capture-shield")
      .forEach((el) => {
        try {
          el.remove();
        } catch {
          /* ignore */
        }
      });

    const mainMap = window.InfraGeoMap?.getMap?.();
    if (!mainMap) {
      throw new Error("Mapa principal não está pronto. Recarregue a página.");
    }
    // Trava a visão ANTES de qualquer async / invalidate (zoom do “Mexer no mapa”)
    const lockedSnapshot = getVisibleMapSnapshot(mainMap);
    const savedView = lockedSnapshot
      ? { center: lockedSnapshot.center, zoom: lockedSnapshot.zoom }
      : { center: mainMap.getCenter(), zoom: mainMap.getZoom() };

    const { mapW, mapH } = getCaptureMapSize();

    const host = document.createElement("div");
    host.id = "print-capture-host";
    host.setAttribute("aria-hidden", "true");
    // Dentro da viewport, sob o modal (z-index 2100)
    host.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      `width:${mapW}px`,
      `height:${mapH}px`,
      "z-index:2000",
      "opacity:1",
      "margin:0",
      "padding:0",
      "border:0",
      "overflow:hidden",
      "background:#e8eef5",
      "transform:none",
      "pointer-events:none",
    ].join(";");

    const mapDiv = document.createElement("div");
    mapDiv.style.cssText =
      "width:100%;height:100%;margin:0;padding:0;border:0;transform:none;";
    host.appendChild(mapDiv);
    document.body.appendChild(host);

    let exportMap = null;
    try {
      setStatus("Preparando mapa de captura…");
      await wait(0);

      // Só basemap no Leaflet — camadas são pintadas no canvas depois
      exportMap = L.map(mapDiv, {
        zoomControl: false,
        attributionControl: false,
        fadeAnimation: false,
        zoomAnimation: false,
        markerZoomAnimation: false,
        inertia: false,
      });

      cloneBasemap(exportMap);
      exportMap.invalidateSize({ animate: false });
      await wait(50);
      syncExportView(exportMap, mainMap, lockedSnapshot);
      setStatus("Carregando mapa base…");
      await waitForTiles(exportMap, 2500);
      syncExportView(exportMap, mainMap, lockedSnapshot);
      await wait(80);

      setStatus("Capturando imagem…");
      await wait(0);
      return await rasterizeExportMap(exportMap, mapDiv, mapW, mapH);
    } finally {
      try {
        if (exportMap) {
          exportMap.off();
          exportMap.remove();
          exportMap = null;
        }
      } catch {
        /* ignore */
      }
      try {
        host.remove();
      } catch {
        /* ignore */
      }
      if (mainMap && savedView) {
        try {
          mainMap.setView(savedView.center, savedView.zoom, {
            animate: false,
          });
          mainMap.invalidateSize({ animate: false, pan: false });
        } catch {
          /* ignore */
        }
      }
    }
  }


  async function compose(mapShot, titleText) {
    const layout = getLayout();
    const {
      width: W,
      height: H,
      pad,
      headerH,
      footerH,
      legendW,
      gap,
    } = layout;
    const edit = editOptions();
    const ff = edit.fontFamily;
    const fm = edit.fontSizeMul;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const s = DPI / 150;
    const map = window.InfraGeoMap?.getMap?.();
    const brand = await loadBrandLogo();

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const frame = Math.max(8, Math.round(10 * s));
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = Math.max(2, 2.2 * s);
    ctx.strokeRect(frame, frame, W - frame * 2, H - frame * 2);
    ctx.lineWidth = Math.max(0.8, 1 * s);
    ctx.strokeRect(
      frame + 3 * s,
      frame + 3 * s,
      W - (frame + 3 * s) * 2,
      H - (frame + 3 * s) * 2
    );

    const margin = pad;
    const titleBoxH = headerH;
    const bottomH = footerH;
    const sideW = legendW;

    const mapX = margin + Math.round(28 * s);
    const mapY = margin + Math.round(22 * s);
    const mapW = W - margin * 2 - sideW - gap - Math.round(28 * s);
    const mapH = H - mapY - bottomH - margin - gap;

    const sideX = mapX + mapW + gap;
    const titleY = mapY;
    const legY = titleY + titleBoxH + gap;
    const legH = mapH - titleBoxH - gap;

    // Mapa
    ctx.fillStyle = "#e8eef5";
    ctx.fillRect(mapX, mapY, mapW, mapH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapW, mapH);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mapShot, mapX, mapY, mapW, mapH);
    ctx.restore();
    drawGraticuleFrame(ctx, mapX, mapY, mapW, mapH, map);
    drawNorthArrowInMap(ctx, mapX, mapY, mapW, mapH);

    // Cabeçalho minimalista — marca InfraGEO
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = Math.max(1.1, 1.3 * s);
    ctx.fillRect(sideX, titleY, sideW, titleBoxH);
    ctx.strokeRect(sideX, titleY, sideW, titleBoxH);

    const titlePad = Math.round(14 * s);
    const brandMaxW = sideW - titlePad * 2;
    const brandMaxH = titleBoxH - titlePad * 2 - Math.round(22 * s * fm);
    const brandBox = drawMinimalBrand(
      ctx,
      sideX + titlePad,
      titleY + titlePad,
      brandMaxW,
      Math.max(48 * s, brandMaxH),
      brand
    );

    // Título do mapa — uma linha discreta
    const mapTitle = String(titleText || "").trim();
    if (mapTitle) {
      ctx.fillStyle = "#4b5563";
      ctx.font = `600 ${Math.max(9, Math.round(10 * s * fm))}px ${ff}`;
      ctx.textAlign = "left";
      const maxChars = sideW > 400 ? 36 : 28;
      const short =
        mapTitle.length > maxChars
          ? `${mapTitle.slice(0, maxChars - 1)}…`
          : mapTitle;
      ctx.fillText(
        short,
        sideX + titlePad,
        titleY + titlePad + brandBox.h + Math.round(16 * s * fm)
      );
    }

    // Legenda só com itens
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = Math.max(1.1, 1.3 * s);
    ctx.fillRect(sideX, legY, sideW, legH);
    ctx.strokeRect(sideX, legY, sideW, legH);

    let ly = legY + Math.round(22 * s);
    ctx.fillStyle = "#111111";
    ctx.font = `800 ${Math.max(11, Math.round(12 * s * fm))}px ${ff}`;
    ctx.textAlign = "left";
    ctx.fillText(edit.legendTitle, sideX + titlePad, ly);
    ly += Math.round(10 * s);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = Math.max(0.8, s);
    ctx.beginPath();
    ctx.moveTo(sideX + titlePad, ly);
    ctx.lineTo(sideX + sideW - titlePad, ly);
    ctx.stroke();
    ly += Math.round(18 * s);

    const items = legendItems();
    const rowH = Math.round(20 * s * fm);
    ctx.font = `600 ${Math.max(10, Math.round(11 * s * fm))}px ${ff}`;
    if (!items.length) {
      ctx.fillStyle = "#666666";
      ctx.fillText("Nenhuma camada ativa", sideX + titlePad, ly);
    } else {
      items.forEach((item) => {
        if (ly > legY + legH - Math.round(20 * s)) return;
        drawLegendSwatch(ctx, item, sideX + titlePad, ly - 3);
        ctx.fillStyle = "#111111";
        const maxChars = sideW > 380 ? 34 : 26;
        const label =
          String(item.name).length > maxChars
            ? `${String(item.name).slice(0, maxChars - 1)}…`
            : item.name;
        ctx.fillText(label, sideX + titlePad + Math.round(28 * s), ly);
        ly += rowH;
      });
    }

    return canvas;
  }

  async function generate() {
    if (busy) return;
    busy = true;
    const { btnGenerate, btnPreview, btnDownload, btnDownloadPng, canvas: preview, title, modal } = els();
    if (btnGenerate) btnGenerate.disabled = true;
    if (btnPreview) btnPreview.disabled = true;
    if (btnDownload) btnDownload.disabled = true;
    if (btnDownloadPng) btnDownloadPng.disabled = true;
    if (modal) modal.classList.add("is-generating");

    const layout = getLayout();
    const format = selectedOptions().format || "png";
    const sel = window.InfraGeoHoverPopup?.getSelection?.();
    if (title && !title.value.trim()) {
      title.value = defaultTitle();
    }

    setStatus(
      sel?.meta?.name
        ? `Gerando ${format.toUpperCase()} da visão atual (${sel.meta.name})…`
        : `Gerando ${format.toUpperCase()} da visão atual do mapa…`
    );

    const run = async () => {
      try {
        await Promise.race([
          window.InfraGeoLayers?.ensureLimiteEstadualOn?.() || Promise.resolve(),
          wait(6000),
        ]);
      } catch {
        /* segue mesmo sem limite */
      }
      await wait(0);
      document
        .querySelectorAll("#print-capture-host, #print-capture-shield")
        .forEach((el) => el.remove());
      const shot = await captureExportMapImage();
      if (!shot || !(shot.width > 0) || !(shot.height > 0)) {
        throw new Error("A captura do mapa ficou vazia.");
      }
      await wait(0);
      setStatus("Montando layout…");
      const composed = await compose(shot, title?.value?.trim() || defaultTitle());
      await wait(0);
      if (preview) {
        preview.width = composed.width;
        preview.height = composed.height;
        const pctx = preview.getContext("2d");
        pctx.clearRect(0, 0, preview.width, preview.height);
        pctx.imageSmoothingEnabled = true;
        pctx.imageSmoothingQuality = "high";
        pctx.drawImage(composed, 0, 0);
        preview.dataset.ready = "1";
      }
      const previewBox = els().preview;
      if (previewBox) previewBox.classList.add("is-visible");
      updatePreviewChrome();
      if (btnDownload) btnDownload.disabled = false;
      if (btnDownloadPng) btnDownloadPng.disabled = false;

      setStatus(
        `Pronto · ${layout.paperLabel} ${layout.orientLabel}. Baixe PNG ou PDF.`
      );
    };

    try {
      await Promise.race([
        run(),
        wait(GENERATE_TIMEOUT_MS).then(() => {
          throw new Error(
            "Tempo esgotado ao gerar o mapa. Aproxime o zoom ou ligue menos camadas e tente de novo."
          );
        }),
      ]);
    } catch (err) {
      console.error("print-map", err);
      setStatus(`Falha ao gerar: ${err.message || err}`);
      window.alert(
        `Não foi possível gerar o arquivo.\n${err.message || err}\n\nDica: use o basemap Carto Light ou OpenStreetMap e tente novamente.`
      );
    } finally {
      if (modal) modal.classList.remove("is-generating");
      document
        .querySelectorAll("#print-capture-host, #print-capture-shield")
        .forEach((el) => {
          try {
            el.remove();
          } catch {
            /* ignore */
          }
        });
      busy = false;
      if (btnGenerate) btnGenerate.disabled = false;
      if (btnPreview) btnPreview.disabled = false;
    }
  }

  function downloadSelected() {
    const format = selectedOptions().format || "png";
    if (format === "pdf") downloadPdf();
    else downloadPng();
  }

  function downloadAsPdf() {
    const { exportFormat } = els();
    if (exportFormat) exportFormat.value = "pdf";
    downloadPdf();
  }

  function downloadAsPng() {
    const { exportFormat } = els();
    if (exportFormat) exportFormat.value = "png";
    downloadPng();
  }

  function safeFileBase() {
    const layout = getLayout();
    const title = (els().title?.value || "mapa-infrageo").trim();
    const safe = title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "mapa-infrageo";
    return `${safe}_${layout.sizeKey}-${layout.landscape ? "paisagem" : "retrato"}_${new Date()
      .toISOString()
      .slice(0, 10)}`;
  }

  function downloadPng() {
    const { canvas } = els();
    if (!canvas || canvas.dataset.ready !== "1") {
      window.alert("Gere a imagem antes de baixar.");
      return;
    }
    const a = document.createElement("a");
    a.download = `${safeFileBase()}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  function downloadPdf() {
    const { canvas } = els();
    if (!canvas || canvas.dataset.ready !== "1") {
      window.alert("Gere a imagem antes de baixar o PDF.");
      return;
    }
    const jsPdfNs = window.jspdf;
    if (!jsPdfNs?.jsPDF) {
      window.alert("Biblioteca PDF não carregou. Atualize a página (Ctrl+F5).");
      return;
    }

    const layout = getLayout();
    const paper = PAPER_SIZES[layout.sizeKey] || PAPER_SIZES.a4;
    const pageW = layout.landscape ? paper.hMm : paper.wMm;
    const pageH = layout.landscape ? paper.wMm : paper.hMm;

    try {
      const pdf = new jsPdfNs.jsPDF({
        orientation: layout.landscape ? "landscape" : "portrait",
        unit: "mm",
        format: [pageW, pageH],
        compress: true,
      });

      // JPEG reduz o tamanho do PDF mantendo boa qualidade de impressão
      const imgData = canvas.toDataURL("image/jpeg", 0.93);
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
      pdf.save(`${safeFileBase()}.pdf`);
      setStatus(`PDF salvo · ${layout.paperLabel} ${layout.orientLabel} @ ${DPI} dpi.`);
    } catch (err) {
      console.error("print-map pdf", err);
      window.alert(`Não foi possível gerar o PDF.\n${err.message || err}`);
    }
  }

  function onPaperOptionsChange() {
    const { canvas, btnDownload, btnDownloadPng, modal } = els();
    if (canvas) canvas.dataset.ready = "0";
    if (btnDownload) btnDownload.disabled = true;
    if (btnDownloadPng) btnDownloadPng.disabled = true;
    syncPresetFromSelects();
    updatePreviewChrome();
    const layout = getLayout();
    setStatus(
      `Layout: ${layout.paperLabel} ${layout.orientLabel} · ${layout.style.label}. Gere novamente.`
    );
    if (modal?.classList.contains("is-map-adjust")) {
      updatePrintFrameOverlay();
      syncLiveMinimapView();
    }
  }

  function onEditOptionsChange() {
    const { canvas, btnDownload, btnDownloadPng } = els();
    if (canvas) canvas.dataset.ready = "0";
    if (btnDownload) btnDownload.disabled = true;
    if (btnDownloadPng) btnDownloadPng.disabled = true;
    setStatus("Feições/legenda/fonte alterados. Clique em Gerar layout para atualizar.");
  }

  function init() {
    restoreMainMapLayout();
    const {
      btnOpen,
      btnClose,
      btnCancel,
      btnGenerate,
      btnPreview,
      btnDownload,
      btnDownloadPng,
      btnFitFeature,
      btnFitLayer,
      btnZoomIn,
      btnZoomOut,
      btnAdjustMap,
      modal,
      paperSize,
      paperOrient,
      paperStyle,
      exportFormat,
      proportions,
      legendTitle,
      legendLabel,
      featureColor,
      featureStroke,
      fontSize,
      fontFamily,
    } = els();
    if (btnOpen) btnOpen.addEventListener("click", () => open(true));
    if (btnClose) btnClose.addEventListener("click", () => open(false));
    if (btnCancel) btnCancel.addEventListener("click", () => open(false));
    if (btnGenerate) btnGenerate.addEventListener("click", () => generate());
    if (btnPreview) btnPreview.addEventListener("click", () => previewLayout());
    const btnClosePreview = document.getElementById("btn-fechar-print-preview");
    const btnClosePreview2 = document.getElementById("btn-fechar-print-preview-2");
    const lightbox = document.getElementById("print-preview-lightbox");
    if (btnClosePreview) btnClosePreview.addEventListener("click", () => closePreviewLightbox());
    if (btnClosePreview2) btnClosePreview2.addEventListener("click", () => closePreviewLightbox());
    if (lightbox) {
      lightbox.addEventListener("click", (ev) => {
        if (ev.target === lightbox) closePreviewLightbox();
      });
    }
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closePreviewLightbox();
    });
    if (btnDownload) btnDownload.addEventListener("click", () => downloadAsPdf());
    if (btnDownloadPng) btnDownloadPng.addEventListener("click", () => downloadAsPng());
    if (btnFitFeature) btnFitFeature.addEventListener("click", () => fitSelectedFeature());
    if (btnFitLayer) btnFitLayer.addEventListener("click", () => fitActiveLayer());
    if (btnZoomIn) btnZoomIn.addEventListener("click", () => zoomMainMap(1));
    if (btnZoomOut) btnZoomOut.addEventListener("click", () => zoomMainMap(-1));
    if (btnAdjustMap) btnAdjustMap.addEventListener("click", () => toggleMapAdjust());
    if (paperSize) paperSize.addEventListener("change", onPaperOptionsChange);
    if (paperOrient) paperOrient.addEventListener("change", onPaperOptionsChange);
    if (paperStyle) paperStyle.addEventListener("change", onPaperOptionsChange);
    if (exportFormat) exportFormat.addEventListener("change", onPaperOptionsChange);
    if (proportions) {
      proportions.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".print-prop[data-preset]");
        if (!btn) return;
        applyLayoutPreset(btn.dataset.preset);
      });
    }
    [
      legendTitle,
      legendLabel,
      featureColor,
      featureStroke,
      fontSize,
      fontFamily,
    ].forEach((el) => {
      if (!el) return;
      el.addEventListener("change", onEditOptionsChange);
      el.addEventListener("input", onEditOptionsChange);
    });
    if (modal) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) open(false);
      });
    }
    window.addEventListener("beforeunload", restoreMainMapLayout);
    window.addEventListener("resize", () => {
      const map = window.InfraGeoMap?.getMap?.();
      if (map) {
        try {
          map.invalidateSize({ animate: false, pan: false });
        } catch {
          /* ignore */
        }
      }
    });
  }

  return {
    init,
    open,
    openLayoutChooser,
    generate,
    download: downloadSelected,
    downloadPdf,
    downloadPng,
    cleanupPrintArtifacts,
    restoreMainMapLayout,
  };
})();
