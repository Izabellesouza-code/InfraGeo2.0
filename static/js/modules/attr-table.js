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
    selectedIndex: null,
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
      refreshBtn: document.getElementById("btn-attr-refresh"),
      filtersBtn: document.getElementById("btn-attr-filters"),
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
    entry.leaflet.eachLayer((lyr) => {
      if (!lyr.feature) return;
      out.push({
        feature: lyr.feature,
        leaflet: lyr,
        props: lyr.feature.properties || {},
      });
    });
    return out;
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

  function visibleColumns() {
    return state.columns;
  }

  function clearHighlight() {
    if (state.highlight && mapHas(state.highlight)) {
      window.InfraGeoMap.getMap().removeLayer(state.highlight);
    }
    state.highlight = null;
    state.selectedIndex = null;
  }

  function mapHas(layer) {
    try {
      return window.InfraGeoMap.getMap().hasLayer(layer);
    } catch {
      return false;
    }
  }

  function zoomToFeature(item) {
    const map = window.InfraGeoMap.getMap();
    clearHighlight();
    if (!item?.leaflet) return;

    state.selectedIndex = state.features.indexOf(item);
    const lyr = item.leaflet;

    try {
      if (lyr.getBounds && lyr.getBounds().isValid()) {
        map.fitBounds(lyr.getBounds().pad(0.35));
        state.highlight = L.rectangle(lyr.getBounds(), {
          color: "#0A2E2C",
          weight: 2,
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(map);
      } else if (lyr.getLatLng) {
        const ll = lyr.getLatLng();
        map.setView(ll, Math.max(map.getZoom(), 14));
        state.highlight = L.circleMarker(ll, {
          radius: 10,
          color: "#0A2E2C",
          weight: 2,
          fillColor: "#0A2E2C",
          fillOpacity: 0.35,
          interactive: false,
        }).addTo(map);
      }
    } catch (err) {
      console.warn("zoomToFeature", err);
    }

    if (lyr.openPopup) {
      try {
        lyr.openPopup();
      } catch {
        /* ignore */
      }
    }
  }

  function fitLayerOnMap() {
    if (state.selectedIndex != null) {
      zoomToFeature(state.features[state.selectedIndex]);
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
      return;
    }

    tbody.innerHTML = rows
      .map(({ f, i }) => {
        const selected = i === state.selectedIndex ? " is-selected" : "";
        const cells = cols
          .map((c) => {
            const v = f.props[c];
            const text = v == null ? "" : String(v);
            return `<td title="${text.replace(/"/g, "&quot;")}">${text}</td>`;
          })
          .join("");
        return `<tr data-idx="${i}" class="${selected}">${cells}</tr>`;
      })
      .join("");
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
    state.selectedIndex = null;

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
      if (idx >= 0) state.selectedIndex = idx;
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

    if (state.selectedIndex == null && q) {
      const idx = bestMatchIndex(q);
      if (idx >= 0) {
        state.selectedIndex = idx;
        zoomToFeature(state.features[idx]);
      }
    }

    renderTable();

    if (state.selectedIndex != null && ui.tbody) {
      requestAnimationFrame(() => {
        const row = ui.tbody.querySelector(`tr[data-idx="${state.selectedIndex}"]`);
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
    if (ui.tbody) {
      ui.tbody.addEventListener("click", (ev) => {
        const tr = ev.target.closest("tr[data-idx]");
        if (!tr) return;
        const idx = Number(tr.dataset.idx);
        const item = state.features[idx];
        if (!item) return;
        zoomToFeature(item);
        renderTable();
      });
    }

    document.addEventListener("click", (ev) => {
      if (ev.target.closest(".layer-kebab, .layer-kebab-menu")) return;
      closeMenus();
      if (!ev.target.closest("#attr-help-pop, #btn-attr-help")) {
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
