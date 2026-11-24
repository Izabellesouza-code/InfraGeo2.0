/**
 * Tabela de atributos — abrir registros, filtrar e localizar no mapa.
 */
window.InfraGeoAttrTable = (function () {
  "use strict";

  const state = {
    layerId: null,
    features: [],
    columns: [],
    filter: "",
    selected: new Set(),
    lastClicked: null,
    highlight: null,
  };

  function els() {
    return {
      panel: document.getElementById("attr-table-panel"),
      title: document.getElementById("attr-panel-title"),
      subtitle: document.getElementById("attr-panel-subtitle"),
      brand: document.getElementById("attr-brand-name"),
      crumbs: document.getElementById("attr-breadcrumb"),
      filter: document.getElementById("attr-table-filter"),
      count: document.getElementById("attr-table-count"),
      table: document.getElementById("attr-table"),
      thead: document.querySelector("#attr-table thead"),
      tbody: document.querySelector("#attr-table tbody"),
      closeBtn: document.getElementById("btn-fechar-attr"),
      mapBtn: document.getElementById("btn-attr-map"),
      exportBtn: document.getElementById("btn-attr-export"),
      exportPop: document.getElementById("attr-export-pop"),
      refreshBtn: document.getElementById("btn-attr-refresh"),
      filtersBtn: document.getElementById("btn-attr-filters"),
      clearBtn: document.getElementById("btn-attr-clear-sel"),
      selCount: document.getElementById("attr-sel-count"),
      helpBtn: document.getElementById("btn-attr-help"),
      helpPop: document.getElementById("attr-help-pop"),
    };
  }

  function closeMenus() {
    document.querySelectorAll(".layer-kebab-menu").forEach((m) => {
      m.hidden = true;
    });
    document.querySelectorAll(".layer-kebab.is-open").forEach((b) => {
      b.classList.remove("is-open");
    });
  }

  function hidePops() {
    const ui = els();
    if (ui.helpPop) ui.helpPop.hidden = true;
    if (ui.exportPop) ui.exportPop.hidden = true;
    if (ui.exportBtn) ui.exportBtn.setAttribute("aria-expanded", "false");
  }

  function buildMenuHtml(layerId) {
    return `
      <div class="layer-kebab-menu__head">Opções da camada</div>
      <button type="button" class="layer-kebab-item" role="menuitem" data-layer-action="table" data-layer-id="${layerId}">
        <span class="layer-kebab-item__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" focusable="false">
            <path d="M4.5 5.5h15v13h-15z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M4.5 9.2h15M4.5 13h15M9.2 5.5v13M14 5.5v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="layer-kebab-item__copy">
          <span class="layer-kebab-item__title">Tabela de atributos</span>
          <span class="layer-kebab-item__hint">Abrir registros, filtrar e localizar no mapa</span>
        </span>
      </button>
      <button type="button" class="layer-kebab-item" role="menuitem" data-layer-action="export" data-layer-id="${layerId}">
        <span class="layer-kebab-item__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" focusable="false">
            <path d="M12 4v10"/>
            <path d="m8 10 4 4 4-4"/>
            <path d="M5 18h14"/>
          </svg>
        </span>
        <span class="layer-kebab-item__copy">
          <span class="layer-kebab-item__title">Exportar tabela</span>
          <span class="layer-kebab-item__hint">Baixar atributos em CSV, Excel ou GeoJSON</span>
        </span>
      </button>
    `;
  }

  function positionMenu(btn, menu) {
    menu.hidden = false;
    const pad = 8;
    const r = btn.getBoundingClientRect();
    const mw = Math.min(268, Math.max(220, window.innerWidth - pad * 2));
    menu.style.width = `${mw}px`;
    menu.style.position = "fixed";
    menu.style.zIndex = "2000";
    menu.style.visibility = "hidden";
    menu.style.top = "0";
    menu.style.left = "0";

    const mh = Math.max(menu.offsetHeight || 0, 80);
    let left = r.right - mw;
    left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - pad) {
      top = Math.max(pad, r.top - mh - 6);
    }
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.visibility = "";
  }

  function attachKebab(row, layer) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "layer-kebab";
    btn.title = "Opções da camada";
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "⋯";

    const menu = document.createElement("div");
    menu.className = "layer-kebab-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.innerHTML = buildMenuHtml(layer.id);

    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const wasOpen = !menu.hidden;
      closeMenus();
      if (wasOpen) {
        btn.setAttribute("aria-expanded", "false");
        return;
      }
      btn.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      positionMenu(btn, menu);
    });

    menu.addEventListener("click", async (ev) => {
      const item = ev.target.closest("[data-layer-action]");
      if (!item) return;
      ev.stopPropagation();
      const action = item.getAttribute("data-layer-action");
      closeMenus();
      if (action === "table") {
        await openForLayer(layer.id);
      } else if (action === "export") {
        await openForLayer(layer.id);
        const ui = els();
        if (ui.exportPop) {
          ui.exportPop.hidden = false;
          if (ui.exportBtn) ui.exportBtn.setAttribute("aria-expanded", "true");
        }
      }
    });

    row.append(btn, menu);
  }

  async function ensureLayerLoaded(meta) {
    if (!window.InfraGeoMap.overlayRegistry[meta.id]) {
      await window.InfraGeoMap.loadGeoJSONLayer(meta);
    }
    if (!window.InfraGeoLayers.getState().checked[meta.id]) {
      await window.InfraGeoLayers.setLayerVisible(meta.id, true);
      window.InfraGeoLayers.renderGroups();
    }
  }

  function collectFeatures(layerId) {
    const entry = window.InfraGeoMap.overlayRegistry[layerId];
    if (!entry?.leaflet) return [];
    const out = [];
    const walk = (lyr) => {
      if (!lyr) return;
      if (lyr.feature) {
        out.push({
          feature: lyr.feature,
          leaflet: lyr,
          props: lyr.feature.properties || {},
        });
      }
      if (typeof lyr.eachLayer === "function") lyr.eachLayer(walk);
    };
    walk(entry.leaflet);
    return out;
  }

  function numKm(v) {
    if (v == null || v === "") return null;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function lineCoords(geom) {
    if (!geom) return [];
    if (geom.type === "LineString") return geom.coordinates || [];
    if (geom.type === "MultiLineString") return (geom.coordinates || []).flat();
    return [];
  }

  function coordDist(a, b) {
    const dx = (a[0] || 0) - (b[0] || 0);
    const dy = (a[1] || 0) - (b[1] || 0);
    return Math.hypot(dx, dy);
  }

  function sliceCoordsByT(coords, t0, t1) {
    if (!coords || coords.length < 2) return coords || [];
    const segs = [];
    let total = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const d = coordDist(coords[i - 1], coords[i]);
      segs.push(d);
      total += d;
    }
    if (total <= 0) return coords;
    const lo = Math.max(0, Math.min(t0, t1)) * total;
    const hi = Math.min(1, Math.max(t0, t1)) * total;
    const at = (target) => {
      let acc = 0;
      for (let i = 1; i < coords.length; i += 1) {
        const d = segs[i - 1];
        if (acc + d >= target || i === coords.length - 1) {
          const u = d ? Math.max(0, Math.min(1, (target - acc) / d)) : 0;
          const p = coords[i - 1];
          const q = coords[i];
          return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
        }
        acc += d;
      }
      return coords[coords.length - 1];
    };
    const out = [at(lo)];
    let acc = 0;
    for (let i = 1; i < coords.length; i += 1) {
      acc += segs[i - 1];
      if (acc > lo && acc < hi) out.push(coords[i]);
    }
    out.push(at(hi));
    return out;
  }

  function sliceGeomByKm(geom, featProps, rowProps) {
    const coords = lineCoords(geom);
    if (coords.length < 2) return geom;
    const a = numKm(rowProps?.KM_INICIAL ?? rowProps?.km_inicial);
    const b = numKm(rowProps?.KM_FINAL ?? rowProps?.km_final);
    const A = numKm(featProps?.KM_INICIAL ?? featProps?.km_inicial);
    const B = numKm(featProps?.KM_FINAL ?? featProps?.km_final);
    if (a == null || b == null || A == null || B == null) return geom;
    const span = Math.abs(B - A);
    if (span < 1e-6) return geom;
    if (Math.abs(Math.min(a, b) - Math.min(A, B)) < 0.05 && Math.abs(Math.max(a, b) - Math.max(A, B)) < 0.05) {
      return geom;
    }
    const t0 = (Math.min(a, b) - Math.min(A, B)) / span;
    const t1 = (Math.max(a, b) - Math.min(A, B)) / span;
    const sliced = sliceCoordsByT(coords, t0, t1);
    if (sliced.length < 2) return geom;
    return { type: "LineString", coordinates: sliced };
  }

  function layerLineFeatures(layerId) {
    const gj = window.InfraGeoMap?.overlayRegistry?.[layerId]?.geojson;
    const list = gj?.features || (gj?.type === "Feature" ? [gj] : []);
    return list.filter((ft) => /line/i.test(String(ft?.geometry?.type || "")));
  }

  function lineFeatureMatchingProps(layerId, props) {
    const list = layerLineFeatures(layerId);
    const kmI = numKm(props?.KM_INICIAL ?? props?.km_inicial);
    const kmF = numKm(props?.KM_FINAL ?? props?.km_final);
    const idKeys = ["ID_SNV", "id_snv", "CODIGO_SNV", "FIELD", "OBJECTID", "FID"];
    const exact = list.find((ft) => {
      const p = ft.properties || {};
      const a = numKm(p.KM_INICIAL ?? p.km_inicial);
      const b = numKm(p.KM_FINAL ?? p.km_final);
      return kmI != null && kmF != null && a != null && b != null && Math.abs(a - kmI) < 0.02 && Math.abs(b - kmF) < 0.02;
    });
    if (exact) return exact;
    const byId = list.find((ft) => {
      const p = ft.properties || {};
      return idKeys.some((k) => props?.[k] != null && p[k] != null && String(props[k]) === String(p[k]));
    });
    if (byId) return byId;
    if (kmI == null || kmF == null) return null;
    const mid = (kmI + kmF) / 2;
    return (
      list.find((ft) => {
        const p = ft.properties || {};
        const a = numKm(p.KM_INICIAL ?? p.km_inicial);
        const b = numKm(p.KM_FINAL ?? p.km_final);
        if (a == null || b == null) return false;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return mid >= lo - 0.05 && mid <= hi + 0.05;
      }) || null
    );
  }

  function trechoFeature(item) {
    const props = item?.props || item?.feature?.properties || {};
    const matched = lineFeatureMatchingProps(state.layerId, props);
    let geom = matched?.geometry || null;
    let srcProps = matched?.properties || props;
    if (!geom || !/line/i.test(String(geom.type || ""))) {
      const own = item?.feature?.geometry;
      if (own && /line/i.test(String(own.type || ""))) geom = own;
    }
    if (!geom) {
      const feat = featureFromRowRaw(item);
      geom = feat?.geometry || null;
      srcProps = feat?.properties || props;
    }
    if (!geom) return null;
    if (/line/i.test(String(geom.type || ""))) {
      geom = sliceGeomByKm(geom, srcProps, props) || geom;
    }
    return {
      type: "Feature",
      properties: props,
      geometry: geom,
    };
  }

  function featureFromRowRaw(f) {
    try {
      if (f?.leaflet && typeof f.leaflet.toGeoJSON === "function") {
        const g = f.leaflet.toGeoJSON();
        if (g?.type === "Feature" && g.geometry) return g;
        if (g?.type === "FeatureCollection") {
          return (g.features || []).find((x) => x?.geometry) || null;
        }
      }
    } catch {
      /* ignore */
    }
    if (f?.feature?.type === "Feature" && f.feature.geometry) {
      return {
        type: "Feature",
        properties: { ...(f.feature.properties || f.props || {}) },
        geometry: f.feature.geometry,
      };
    }
    const geom = f?.feature?.geometry || f?.leaflet?.feature?.geometry;
    if (!geom) return null;
    return { type: "Feature", properties: f.props || {}, geometry: geom };
  }

  function collectColumns(features) {
    const keys = new Set();
    features.forEach((f) => {
      Object.keys(f.props || {}).forEach((k) => keys.add(k));
    });
    return Array.from(keys);
  }

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function rowBlob(f) {
    return norm(state.columns.map((c) => String(f.props[c] ?? "")).join(" "));
  }

  function filteredRows() {
    const q = norm(state.filter);
    if (!q) return state.features.map((f, i) => ({ f, i }));
    const tokens = q.split(" ").filter((t) => t.length > 1);
    return state.features
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => {
        const blob = rowBlob(f);
        if (blob.includes(q)) return true;
        return tokens.length ? tokens.every((t) => blob.includes(t)) : false;
      });
  }

  function bestMatchIndex(q) {
    const nq = norm(q);
    if (!nq) return -1;
    const tokens = nq.split(" ").filter((t) => t.length > 1);
    let best = -1;
    let score = 0;
    state.features.forEach((f, i) => {
      const blob = rowBlob(f);
      let s = 0;
      if (blob.includes(nq)) s += 100 + nq.length;
      tokens.forEach((t) => {
        if (blob.includes(t)) s += t.length;
      });
      if (s > score) {
        score = s;
        best = i;
      }
    });
    return score > 0 ? best : -1;
  }

  function cellText(v) {
    if (v == null) return "";
    if (typeof v === "object") {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  }

  function layerFileStem() {
    const meta = window.InfraGeoLayers?.allLayerMetas?.().find((l) => l.id === state.layerId);
    const raw = String(meta?.name || state.layerId || "tabela")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    return raw || "tabela_atributos";
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function csvEscape(v) {
    const s = cellText(v);
    if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function xmlEscape(v) {
    return cellText(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function selectedRows() {
    const idxs = [...state.selected].sort((a, b) => a - b);
    return idxs
      .map((i) => ({ f: state.features[i], i }))
      .filter((row) => row.f);
  }

  function exportRows() {
    const cols = visibleColumns();
    const picked = selectedRows();
    const rows = picked.length ? picked : filteredRows();
    return { cols, rows, fromSelection: picked.length > 0 };
  }

  function exportCsv() {
    const { cols, rows, fromSelection } = exportRows();
    if (!rows.length) {
      window.alert(
        fromSelection
          ? "Não há registros selecionados para exportar."
          : "Não há registros visíveis para exportar."
      );
      return;
    }
    const header = cols.map(csvEscape).join(";");
    const body = rows
      .map(({ f }) => cols.map((c) => csvEscape(f.props[c])).join(";"))
      .join("\r\n");
    const csv = `\uFEFF${header}\r\n${body}`;
    downloadBlob(
      `${layerFileStem()}_atributos.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
  }

  function exportXls() {
    const { cols, rows, fromSelection } = exportRows();
    if (!rows.length) {
      window.alert(
        fromSelection
          ? "Não há registros selecionados para exportar."
          : "Não há registros visíveis para exportar."
      );
      return;
    }
    const header = `<Row>${cols
      .map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`)
      .join("")}</Row>`;
    const body = rows
      .map(({ f }) => {
        const cells = cols
          .map((c) => `<Cell><Data ss:Type="String">${xmlEscape(f.props[c])}</Data></Cell>`)
          .join("");
        return `<Row>${cells}</Row>`;
      })
      .join("");
    const xml =
      `<?xml version="1.0"?>\r\n` +
      `<?mso-application progid="Excel.Sheet"?>\r\n` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
      `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
      `<Worksheet ss:Name="Atributos"><Table>${header}${body}</Table></Worksheet>` +
      `</Workbook>`;
    downloadBlob(
      `${layerFileStem()}_atributos.xls`,
      new Blob([xml], { type: "application/vnd.ms-excel" })
    );
  }

  function exportGeojson() {
    const { rows, fromSelection } = exportRows();
    if (!rows.length) {
      window.alert(
        fromSelection
          ? "Não há registros selecionados para exportar."
          : "Não há registros visíveis para exportar."
      );
      return;
    }
    const collection = {
      type: "FeatureCollection",
      features: rows.map(({ f }) => {
        if (f.feature && f.feature.type === "Feature") return f.feature;
        return {
          type: "Feature",
          properties: f.props || {},
          geometry: f.feature?.geometry || null,
        };
      }),
    };
    downloadBlob(
      `${layerFileStem()}_atributos.geojson`,
      new Blob([JSON.stringify(collection)], { type: "application/geo+json" })
    );
  }

  async function exportShp() {
    const { rows, fromSelection } = exportRows();
    if (!rows.length) {
      window.alert(
        fromSelection
          ? "Não há registros selecionados para exportar."
          : "Selecione linhas na tabela ou deixe o filtro com os registros desejados."
      );
      return;
    }
    const collection = {
      type: "FeatureCollection",
      features: rows.map(({ f }) => {
        if (f.feature && f.feature.type === "Feature") return f.feature;
        return {
          type: "Feature",
          properties: f.props || {},
          geometry: f.feature?.geometry || null,
        };
      }),
    };
    const name = `${layerFileStem()}_selecao`;
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
      throw new Error(
        (typeof data.detail === "string" && data.detail) ||
          data.message ||
          `Não foi possível exportar o SHP (${res.status})`
      );
    }
    const blob = await res.blob();
    downloadBlob(`${name}.zip`, blob);
  }

  function featureFromRow(f) {
    return trechoFeature(f) || featureFromRowRaw(f);
  }

  function exportAsMap() {
    const rows = selectedRows();
    if (!rows.length) {
      window.alert("Clique nas linhas da tabela para selecionar e depois escolha Exportar mapa.");
      return;
    }
    const seen = new Set();
    const features = [];
    rows.forEach(({ f }) => {
      const ft = featureFromRow(f);
      if (!ft?.geometry) return;
      const key = JSON.stringify(ft.geometry);
      if (seen.has(key)) return;
      seen.add(key);
      features.push(ft);
    });
    if (!features.length) {
      window.alert("A seleção não tem geometria para exportar no mapa.");
      return;
    }
    const collection = {
      type: "FeatureCollection",
      features,
    };
    const meta = window.InfraGeoLayers?.allLayerMetas?.().find((l) => l.id === state.layerId);
    const title = `Seleção — ${meta?.name || "camada"}`;
    hidePops();
    close();
    const openMap = window.InfraGeoLayoutMode?.openWithSelection;
    if (!openMap) {
      window.alert("O modo de exportação de mapa não está disponível.");
      return;
    }
    openMap({
      layerId: state.layerId,
      collection,
      title,
    }).catch((e) => window.alert(e.message || e));
  }

  function runExport(fmt) {
    if (fmt === "map") exportAsMap();
    else if (fmt === "csv") exportCsv();
    else if (fmt === "xls") exportXls();
    else if (fmt === "geojson") exportGeojson();
    else if (fmt === "shp") {
      exportShp().catch((e) => window.alert(e.message || e));
    }
    hidePops();
  }

  function visibleColumns() {
    return state.columns;
  }

  function clearHighlight() {
    if (state.highlight && mapHas(state.highlight)) {
      window.InfraGeoMap.getMap().removeLayer(state.highlight);
    }
    state.highlight = null;
  }

  function clearSelection() {
    state.selected = new Set();
    state.lastClicked = null;
    clearHighlight();
    renderTable();
  }

  function syncSelChrome() {
    const ui = els();
    const n = state.selected.size;
    if (ui.selCount) {
      ui.selCount.hidden = n === 0;
      ui.selCount.textContent = n === 1 ? "1 selecionado" : `${n} selecionados`;
    }
    if (ui.clearBtn) ui.clearBtn.hidden = n === 0;
    const head = document.querySelector("#attr-export-pop .attr-pop__head");
    if (head) {
      head.textContent = n
        ? `Exportar ${n} selecionado${n === 1 ? "" : "s"}`
        : "Exportar registros visíveis";
    }
  }

  function mapHas(layer) {
    try {
      return window.InfraGeoMap.getMap().hasLayer(layer);
    } catch {
      return false;
    }
  }

  function ensureSelectPane(map) {
    if (!map?.getPane) return "overlayPane";
    if (!map.getPane("attr-select")) {
      map.createPane("attr-select");
      const pane = map.getPane("attr-select");
      pane.style.zIndex = "650";
      pane.style.pointerEvents = "none";
    }
    return "attr-select";
  }

  function trechoLabel(item) {
    const p = item?.props || {};
    const kmI = p.KM_INICIAL ?? p.km_inicial;
    const kmF = p.KM_FINAL ?? p.km_final;
    const br = p.RODOVIA || p.CODIGO_BR || p.CODIGO_SNV;
    const km =
      kmI != null && kmF != null
        ? `km ${String(kmI).replace(".", ",")}–${String(kmF).replace(".", ",")}`
        : "";
    if (br && km) return `${br} · ${km}`;
    if (km) return km;
    if (br) return String(br);
    return "Trecho selecionado";
  }

  function markOnMap(item) {
    if (!window.L) return null;
    const map = window.InfraGeoMap?.getMap?.();
    const pane = ensureSelectPane(map);
    const feat = trechoFeature(item);
    const gtype = String(feat?.geometry?.type || "");
    const group = L.featureGroup({ pane });
    const lineOpts = { pane, interactive: false, renderer: map ? L.svg({ pane }) : undefined };
    try {
      if (/line/i.test(gtype)) {
        L.geoJSON(feat, {
          ...lineOpts,
          style: {
            color: "#ffffff",
            weight: 16,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
          },
        }).addTo(group);
        L.geoJSON(feat, {
          ...lineOpts,
          style: {
            color: "#f59e0b",
            weight: 8,
            opacity: 1,
            lineCap: "round",
            lineJoin: "round",
          },
        }).addTo(group);
        const coords = lineCoords(feat.geometry);
        const ends = [coords[0], coords[coords.length - 1]].filter(Boolean);
        ends.forEach((c) => {
          L.circleMarker([c[1], c[0]], {
            pane,
            radius: 7,
            color: "#ffffff",
            weight: 2,
            fillColor: "#f59e0b",
            fillOpacity: 1,
            interactive: false,
          }).addTo(group);
        });
      } else if (/point/i.test(gtype) || item?.leaflet?.getLatLng) {
        const ll = /point/i.test(gtype)
          ? L.latLng(feat.geometry.coordinates[1], feat.geometry.coordinates[0])
          : item.leaflet.getLatLng();
        L.circleMarker(ll, {
          pane,
          radius: 12,
          color: "#ffffff",
          weight: 3,
          fillColor: "#f59e0b",
          fillOpacity: 1,
          interactive: false,
          className: "attr-map-sel-dot",
        }).addTo(group);
      } else if (feat?.geometry) {
        L.geoJSON(feat, {
          ...lineOpts,
          style: {
            color: "#f59e0b",
            weight: 3,
            fillColor: "#f59e0b",
            fillOpacity: 0.28,
          },
        }).addTo(group);
      } else {
        return null;
      }
      group.bindTooltip(`<span class="attr-map-sel-tip">${trechoLabel(item)}</span>`, {
        permanent: true,
        direction: "top",
        offset: [0, -12],
        className: "attr-map-sel-tooltip",
        opacity: 1,
      });
      return group;
    } catch {
      return null;
    }
  }

  function paintSelectionOnMap(focusItem) {
    const map = window.InfraGeoMap?.getMap?.();
    if (!map || !window.L) return;
    clearHighlight();
    const group = L.featureGroup();
    state.selected.forEach((idx) => {
      const mark = markOnMap(state.features[idx]);
      if (mark) group.addLayer(mark);
    });
    if (group.getLayers().length) {
      group.addTo(map);
      state.highlight = group;
    }
    try {
      const b = group.getBounds?.();
      if (b && b.isValid()) {
        map.fitBounds(b.pad(0.45), { maxZoom: 16, animate: true });
        return;
      }
      const item = focusItem || state.features[[...state.selected].pop()];
      const lyr = item?.leaflet;
      if (lyr?.getLatLng) {
        map.setView(lyr.getLatLng(), Math.min(Math.max(map.getZoom(), 14), 16));
      }
    } catch (err) {
      console.warn("paintSelectionOnMap", err);
    }
  }

  function applyRowClick(idx, ev) {
    const item = state.features[idx];
    if (!item) return;
    if (ev.shiftKey && state.lastClicked != null) {
      const vis = filteredRows().map((r) => r.i);
      const ia = vis.indexOf(state.lastClicked);
      const ib = vis.indexOf(idx);
      if (ia >= 0 && ib >= 0) {
        const a = Math.min(ia, ib);
        const b = Math.max(ia, ib);
        for (let k = a; k <= b; k += 1) state.selected.add(vis[k]);
      } else {
        state.selected.add(idx);
      }
    } else if (state.selected.has(idx)) {
      state.selected.delete(idx);
    } else {
      state.selected.add(idx);
    }
    state.lastClicked = idx;
    paintSelectionOnMap(item);
    renderTable();
  }

  function fitLayerOnMap() {
    if (state.selected.size) {
      paintSelectionOnMap();
      renderTable();
      return;
    }
    const group = window.InfraGeoMap?.overlayRegistry?.[state.layerId]?.leaflet;
    const map = window.InfraGeoMap?.getMap?.();
    if (!group || !map || !group.getBounds) return;
    try {
      const b = group.getBounds();
      if (b && b.isValid()) map.fitBounds(b.pad(0.2));
    } catch {
      /* ignore */
    }
  }

  function renderTable() {
    const { thead, tbody, count } = els();
    if (!thead || !tbody) return;

    const rows = filteredRows();
    const cols = visibleColumns();
    if (count) count.textContent = String(rows.length);
    const label = document.querySelector(".attr-toolbar__label");
    if (label) label.textContent = `de ${state.features.length} registros`;

    if (!cols.length) {
      thead.innerHTML = "";
      tbody.innerHTML =
        '<tr><td class="attr-table__empty" colspan="1">Esta camada não possui atributos.</td></tr>';
      syncSelChrome();
      return;
    }

    thead.innerHTML =
      "<tr>" +
      cols
        .map((c) => `<th title="${String(c).replace(/"/g, "&quot;")}">${c}</th>`)
        .join("") +
      "</tr>";

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="attr-table__empty" colspan="${cols.length}">Nenhum registro encontrado.</td></tr>`;
      syncSelChrome();
      return;
    }

    tbody.innerHTML = rows
      .map(({ f, i }) => {
        const selected = state.selected.has(i) ? " is-selected" : "";
        const cells = cols
          .map((c) => {
            const v = f.props[c];
            const text = v == null ? "" : String(v);
            return `<td title="${text.replace(/"/g, "&quot;")}">${text}</td>`;
          })
          .join("");
        return `<tr data-idx="${i}" class="${selected.trim()}" aria-selected="${state.selected.has(i) ? "true" : "false"}">${cells}</tr>`;
      })
      .join("");
    syncSelChrome();
  }

  async function openForLayer(layerId, opts) {
    const meta = window.InfraGeoLayers.allLayerMetas().find((l) => l.id === layerId);
    if (!meta) return;

    const ui = els();
    await ensureLayerLoaded(meta);

    state.layerId = layerId;
    state.features = collectFeatures(layerId);
    state.columns = collectColumns(state.features);
    state.filter = "";
    state.selected = new Set();
    state.lastClicked = null;

    const targetFeature = opts?.feature || null;
    if (targetFeature && state.features.length) {
      const idx = state.features.findIndex((item) => {
        if (item.feature === targetFeature) return true;
        try {
          return (
            JSON.stringify(item.feature?.properties || {}) ===
            JSON.stringify(targetFeature.properties || {})
          );
        } catch {
          return false;
        }
      });
      if (idx >= 0) {
        state.selected.add(idx);
        state.lastClicked = idx;
      }
    }

    if (ui.brand) ui.brand.textContent = meta.groupName || meta.name || "Atlas";
    if (ui.crumbs) {
      ui.crumbs.textContent = `Camadas › ${meta.groupName || "Grupo"} › ${meta.name || layerId}`;
    }
    if (ui.subtitle) {
      ui.subtitle.textContent = `${meta.name || layerId} — inventário da camada no mapa`;
    }
    const q = String(opts?.filter || "").trim();
    state.filter = q;
    if (ui.filter) ui.filter.value = q;
    if (ui.panel) {
      ui.panel.hidden = false;
      ui.panel.setAttribute("aria-hidden", "false");
    }

    if (q && !filteredRows().length) {
      const tokens = norm(q)
        .split(" ")
        .filter((t) => t.length > 2)
        .sort((a, b) => b.length - a.length);
      for (const t of tokens) {
        state.filter = t;
        if (filteredRows().length) {
          if (ui.filter) ui.filter.value = t;
          break;
        }
      }
      if (!filteredRows().length) {
        state.filter = "";
        if (ui.filter) ui.filter.value = "";
      }
    }

    if (!state.selected.size && q) {
      const idx = bestMatchIndex(q);
      if (idx >= 0) {
        state.selected.add(idx);
        state.lastClicked = idx;
        paintSelectionOnMap(state.features[idx]);
      }
    } else if (state.selected.size) {
      paintSelectionOnMap(state.features[state.lastClicked]);
    }

    renderTable();

    if (state.lastClicked != null && ui.tbody) {
      requestAnimationFrame(() => {
        const row = ui.tbody.querySelector(`tr[data-idx="${state.lastClicked}"]`);
        row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      });
    }
  }

  function close() {
    const ui = els();
    clearHighlight();
    hidePops();
    if (ui.panel) {
      ui.panel.hidden = true;
      ui.panel.setAttribute("aria-hidden", "true");
    }
  }

  function reopen() {
    const ui = els();
    if (!state.layerId || !ui.panel) return false;
    ui.panel.hidden = false;
    ui.panel.setAttribute("aria-hidden", "false");
    return true;
  }

  function init() {
    const ui = els();
    if (ui.closeBtn) ui.closeBtn.addEventListener("click", close);
    if (ui.mapBtn) ui.mapBtn.addEventListener("click", fitLayerOnMap);
    if (ui.exportBtn && ui.exportPop) {
      ui.exportBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const open = ui.exportPop.hidden;
        hidePops();
        ui.exportPop.hidden = !open;
        ui.exportBtn.setAttribute("aria-expanded", String(open));
      });
      ui.exportPop.addEventListener("click", (ev) => {
        const item = ev.target.closest("[data-attr-export]");
        if (!item) return;
        ev.stopPropagation();
        runExport(item.getAttribute("data-attr-export"));
      });
    }
    if (ui.refreshBtn) {
      ui.refreshBtn.addEventListener("click", async () => {
        if (!state.layerId) return;
        await openForLayer(state.layerId, { filter: state.filter });
      });
    }
    if (ui.filtersBtn && ui.filter) {
      ui.filtersBtn.addEventListener("click", () => {
        hidePops();
        ui.filter.focus();
      });
    }
    if (ui.helpBtn && ui.helpPop) {
      ui.helpBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ui.helpPop.hidden = !ui.helpPop.hidden;
      });
    }
    if (ui.filter) {
      ui.filter.addEventListener("input", () => {
        state.filter = ui.filter.value;
        renderTable();
      });
    }
    if (ui.clearBtn) ui.clearBtn.addEventListener("click", clearSelection);
    if (ui.tbody) {
      ui.tbody.addEventListener("click", (ev) => {
        const tr = ev.target.closest("tr[data-idx]");
        if (!tr) return;
        const idx = Number(tr.dataset.idx);
        applyRowClick(idx, ev);
      });
    }

    document.addEventListener("click", (ev) => {
      if (ev.target.closest(".layer-kebab, .layer-kebab-menu")) return;
      closeMenus();
      if (!ev.target.closest("#attr-help-pop, #btn-attr-help, #attr-export-pop, #btn-attr-export")) {
        hidePops();
      }
    });

    window.addEventListener("resize", closeMenus);
  }

  return {
    init,
    attachKebab,
    openForLayer,
    close,
    reopen,
    closeMenus,
  };
})();
