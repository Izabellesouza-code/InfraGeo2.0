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
      filter: document.getElementById("attr-table-filter"),
      count: document.getElementById("attr-table-count"),
      table: document.getElementById("attr-table"),
      thead: document.querySelector("#attr-table thead"),
      tbody: document.querySelector("#attr-table tbody"),
      closeBtn: document.getElementById("btn-fechar-attr"),
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
      const item = ev.target.closest("[data-layer-action='table']");
      if (!item) return;
      ev.stopPropagation();
      closeMenus();
      await openForLayer(layer.id);
    });

    row.append(btn, menu);
  }

  async function ensureLayerLoaded(meta) {
    if (!window.InfraGeoMap.overlayRegistry[meta.id]) {
      await window.InfraGeoMap.loadGeoJSONLayer(meta);
    }
    // Liga no mapa para localizar funcionar visualmente
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

  function filteredRows() {
    const q = state.filter.trim().toLowerCase();
    if (!q) return state.features.map((f, i) => ({ f, i }));
    return state.features
      .map((f, i) => ({ f, i }))
      .filter(({ f }) =>
        state.columns.some((c) =>
          String(f.props[c] ?? "")
            .toLowerCase()
            .includes(q)
        )
      );
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
          color: "#38bdf8",
          weight: 2,
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(map);
      } else if (lyr.getLatLng) {
        const ll = lyr.getLatLng();
        map.setView(ll, Math.max(map.getZoom(), 14));
        state.highlight = L.circleMarker(ll, {
          radius: 10,
          color: "#38bdf8",
          weight: 2,
          fillColor: "#38bdf8",
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

  function renderTable() {
    const { thead, tbody, count } = els();
    if (!thead || !tbody) return;

    const rows = filteredRows();
    if (count) count.textContent = `${rows.length}/${state.features.length}`;

    if (!state.columns.length) {
      thead.innerHTML = "";
      tbody.innerHTML =
        '<tr><td class="attr-table__empty" colspan="1">Esta camada não possui atributos.</td></tr>';
      return;
    }

    thead.innerHTML =
      "<tr>" +
      state.columns.map((c) => `<th title="${c}">${c}</th>`).join("") +
      "</tr>";

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="attr-table__empty" colspan="${state.columns.length}">Nenhum registro encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(({ f, i }) => {
        const selected = i === state.selectedIndex ? " is-selected" : "";
        const cells = state.columns
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

    if (ui.subtitle) ui.subtitle.textContent = meta.name || layerId;
    if (ui.filter) ui.filter.value = "";
    if (ui.panel) {
      ui.panel.hidden = false;
      ui.panel.setAttribute("aria-hidden", "false");
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
    if (ui.panel) {
      ui.panel.hidden = true;
      ui.panel.setAttribute("aria-hidden", "true");
    }
    state.layerId = null;
    state.features = [];
  }

  function init() {
    const ui = els();
    if (ui.closeBtn) ui.closeBtn.addEventListener("click", close);
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
    });

    window.addEventListener("resize", closeMenus);
  }

  return {
    init,
    attachKebab,
    openForLayer,
    close,
    closeMenus,
  };
})();
