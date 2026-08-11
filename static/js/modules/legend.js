/**
 * Painel de legendas das camadas ativas.
 */
window.InfraGeoLegend = (function () {
  "use strict";

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

  function refresh() {
    const body = document.getElementById("legend-content");
    if (!body) return;

    const active = window.InfraGeoMap.getVisibleLayers();
    if (!active.length) {
      body.innerHTML = '<p class="empty-hint">Nenhuma camada no mapa.</p>';
      return;
    }

    const byGroup = {};
    active.forEach((meta) => {
      const full = window.InfraGeoLayers.allLayerMetas().find((l) => l.id === meta.id);
      const g = (full && full.groupName) || "Camadas";
      byGroup[g] = byGroup[g] || [];
      byGroup[g].push(meta);
    });

    body.innerHTML = Object.entries(byGroup)
      .map(([group, layers]) => {
        const rows = layers
          .map((l) => {
            const color = (l.style && (l.style.fillColor || l.style.color)) || "#94a3b8";
            const isPoint = l.type === "Point" || l.type === "MultiPoint";
            return `<div class="legend-row">
              <span class="legend-swatch ${isPoint ? "is-point" : ""}" style="background:${color}"></span>
              <span>${l.name}</span>
            </div>`;
          })
          .join("");
        return `<div class="legend-group"><h3>${group}</h3>${rows}</div>`;
      })
      .join("");
  }

  function init() {
    const closeBtn = document.getElementById("btn-fechar-legendas");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => open(false));
    }
  }

  return { init, open, toggle, refresh };
})();
