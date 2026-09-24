/**
 * Painel de legendas das camadas ativas.
 */
window.InfraGeoLegend = (function () {
  "use strict";

  const GROUP_HELP = {
    OAE: "Obras de arte especiais — pontes e travessias",
    OAC: "Obras de arte correntes — bueiros",
    Usina: "Instalações de usina ligadas à obra",
    Canteiro: "Canteiros de obras",
    PRADS: "Planos de recuperação de áreas degradadas",
    "PCA PRADS": "Programas de controle ambiental dos PRADS",
    "Faixa de domínio": "Faixa de domínio das rodovias",
    Jazidas: "Áreas de extração de material",
    "BR-AM": "Rodovias federais no Amazonas",
    Aquaviário: "Trechos e pontos aquaviários",
    "Unidades de Conservação": "UCs, terras indígenas e zonas de amortecimento",
    "Limites AM": "Divisas do estado e dos municípios",
    Outros: "Demais camadas ligadas no mapa",
    Camadas: "Camadas visíveis neste momento",
  };

  const EYE_ON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;

  const KIND_LABEL = {
    point: "Ponto — um local no mapa",
    line: "Linha — um traçado",
    area: "Área — uma superfície",
  };

  function open(show) {
    const panel = document.getElementById("painel-legendas");
    const btn = document.getElementById("btn-legendas");
    if (!panel) return;
    if (show) window.InfraGeoSidebar?.setOpen?.(false);
    panel.hidden = !show;
    panel.setAttribute("aria-hidden", String(!show));
    if (btn) btn.classList.toggle("is-active", show);
    if (show) refresh();
  }

  function toggle() {
    const panel = document.getElementById("painel-legendas");
    open(panel.hidden);
  }

  function layerColor(l) {
    const s = l?.style || {};
    const fill = String(s.fillColor || "").trim();
    const stroke = String(s.color || "").trim();
    if (fill && fill.toLowerCase() !== "transparent") return fill;
    if (stroke && stroke.toLowerCase() !== "transparent") return stroke;
    return "#64748b";
  }

  function geomKind(l) {
    const t = String(l?.type || "");
    const s = l?.style || {};
    if (t.includes("Point")) return "point";
    if (
      t.includes("Line") ||
      s.fillOpacity === 0 ||
      String(s.fillColor || "").toLowerCase() === "transparent"
    ) {
      return "line";
    }
    if (t.includes("Polygon")) return "area";
    if (s.radius) return "point";
    return "area";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function refresh() {
    const body = document.getElementById("legend-content");
    if (!body) return;

    const active = window.InfraGeoMap?.getVisibleLayers?.() || [];
    if (!active.length) {
      body.innerHTML =
        '<p class="empty-hint">Nenhuma camada ligada. Abra <strong>Camadas</strong> e marque o que deve aparecer no mapa.</p>';
      return;
    }

    const byGroup = {};
    active.forEach((meta) => {
      const full = window.InfraGeoLayers.allLayerMetas().find((l) => l.id === meta.id) || meta;
      const g = full.groupName || "Camadas";
      byGroup[g] = byGroup[g] || [];
      byGroup[g].push({ ...full, ...meta });
    });

    const n = active.length;
    const key = `
      <div class="legend-key" aria-hidden="true">
        <span><i class="legend-swatch is-point"></i> Ponto</span>
        <span><i class="legend-swatch is-line"></i> Linha</span>
        <span><i class="legend-swatch is-area"></i> Área</span>
      </div>
      <p class="legend-count">${n} camada${n === 1 ? "" : "s"} visíve${n === 1 ? "l" : "is"}</p>
    `;

    const groups = Object.entries(byGroup)
      .map(([group, layers]) => {
        const help = GROUP_HELP[group] || "Grupo de camadas no mapa";
        const rows = layers
          .map((l) => {
            const color = layerColor(l);
            const kind = geomKind(l);
            return `<div class="legend-row">
              <span class="legend-swatch is-${kind}" style="--sw:${color};background:${color}"></span>
              <span class="legend-row__copy">
                <strong>${esc(l.name)}</strong>
                <small>${KIND_LABEL[kind]}</small>
              </span>
              <button type="button" class="legend-eye is-on" data-toggle-layer="${esc(l.id)}" title="Ligada no mapa — clique para ocultar" aria-label="Ocultar ${esc(l.name)}" aria-pressed="true">
                ${EYE_ON}
              </button>
            </div>`;
          })
          .join("");
        return `<details class="legend-group" open>
          <summary>
            <span class="legend-group__name">${esc(group)}</span>
            <small class="legend-group__help">${esc(help)}</small>
            <span class="legend-group__n">${layers.length}</span>
          </summary>
          <div class="legend-group__rows">${rows}</div>
        </details>`;
      })
      .join("");

    body.innerHTML = key + groups;
  }

  function init() {
    const closeBtn = document.getElementById("btn-fechar-legendas");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => open(false));
    }

    const body = document.getElementById("legend-content");
    if (body) {
      body.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("[data-toggle-layer]");
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        const id = btn.getAttribute("data-toggle-layer");
        if (!id) return;
        await window.InfraGeoLayers?.setLayerVisible?.(id, false);
      });
    }

    const clearBtn = document.getElementById("btn-limpar-legendas");
    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        clearBtn.disabled = true;
        try {
          if (window.InfraGeoLayers?.clearAll) {
            await window.InfraGeoLayers.clearAll();
          }
          const toggleBtn = document.getElementById("btn-ligar-camadas");
          if (toggleBtn) toggleBtn.classList.remove("is-active");
          refresh();
        } catch (err) {
          console.warn("limpar camadas", err);
        } finally {
          clearBtn.disabled = false;
        }
      });
    }
  }

  return { init, open, toggle, refresh };
})();
