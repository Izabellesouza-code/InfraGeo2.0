/**
 * Modal Sobre + atalhos do rodapé/header.
 * Carrega data de atualização (upload ou commit) em /api/info.
 */
window.InfraGeoAbout = (function () {
  "use strict";

  let loadedOnce = false;

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return null;
    }
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  async function refreshLastUpdate() {
    const el = document.getElementById("sobre-ultima-atualizacao");
    if (el) el.textContent = "Carregando…";
    try {
      const res = await fetch(
        window.InfraGeoApi?.url?.("/api/info") || "/api/info"
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.version) setText("sobre-versao", data.version);

      const display =
        data.last_data_update_display ||
        formatDate(data.last_data_update) ||
        "Nenhuma atualização registrada";
      if (el) el.textContent = display;
      loadedOnce = true;
    } catch (err) {
      console.warn("Sobre: falha ao ler /api/info", err);
      if (el) el.textContent = "Indisponível no momento";
    }
  }

  function open(show) {
    const modal = document.getElementById("modal-sobre");
    if (!modal) return;
    modal.hidden = !show;
    modal.setAttribute("aria-hidden", String(!show));
    if (show) refreshLastUpdate();
  }

  function init() {
    const modal = document.getElementById("modal-sobre");
    const openers = [
      document.getElementById("btn-sobre"),
      document.getElementById("btn-sobre-footer"),
    ];
    const closers = [
      document.getElementById("btn-fechar-sobre"),
      document.getElementById("btn-ok-sobre"),
    ];

    openers.forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => open(true));
    });
    closers.forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => open(false));
    });
    if (modal) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) open(false);
      });
    }
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && modal && !modal.hidden) open(false);
    });

    if (!loadedOnce) refreshLastUpdate().catch(() => {});
  }

  return { init, open, refreshLastUpdate };
})();
