/**
 * Modal Ajuda + atalhos do rodapé/header.
 * Carrega data de atualização (upload ou commit) em /api/info.
 */
window.InfraGeoAbout = (function () {
  "use strict";

  let loadedOnce = false;
  let lastFocus = null;
  let trapHandler = null;

  const CHAPTERS = [0, 5, 10, 15, 20, 25, 33, 39, 46];

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

  function setTexts(ids, text) {
    ids.forEach((id) => setText(id, text));
  }

  function videoEl() {
    return document.getElementById("sobre-tutorial");
  }

  function modalEl() {
    return document.getElementById("modal-sobre");
  }

  function focusables(root) {
    return [...(root?.querySelectorAll?.(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video, [tabindex]:not([tabindex="-1"])'
    ) || [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  async function refreshLastUpdate() {
    const el = document.getElementById("sobre-ultima-atualizacao");
    if (el && !loadedOnce) el.textContent = "—";
    try {
      const res = await fetch(
        window.InfraGeoApi?.url?.("/api/info") || "/api/info"
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.version) setTexts(["sobre-versao", "info-sobre-versao"], data.version);

      const display =
        data.last_data_update_display ||
        formatDate(data.last_data_update) ||
        "Nenhuma atualização registrada";
      setTexts(["sobre-ultima-atualizacao", "info-sobre-atualizacao"], display);
      loadedOnce = true;
    } catch (err) {
      console.warn("Ajuda: falha ao ler /api/info", err);
      setTexts(["sobre-ultima-atualizacao", "info-sobre-atualizacao"], "Indisponível");
    }
  }

  function pauseTutorial() {
    const video = videoEl();
    if (!video) return;
    try {
      video.pause();
    } catch {
      /* ignore */
    }
  }

  function syncChips(t) {
    const chips = [...document.querySelectorAll(".about-modal__chap[data-seek]")];
    if (!chips.length) return;
    const time = Number(t) || 0;
    let active = 0;
    CHAPTERS.forEach((sec, i) => {
      if (time >= sec) active = i;
    });
    chips.forEach((btn, i) => {
      btn.classList.toggle("is-on", i === active);
    });
  }

  function seekTo(sec) {
    const video = videoEl();
    if (!video) return;
    const t = Number(sec);
    if (!Number.isFinite(t)) return;
    try {
      video.currentTime = t;
      const play = video.play();
      if (play && typeof play.catch === "function") play.catch(() => {});
    } catch {
      /* ignore */
    }
    syncChips(t);
  }

  function bindTrap(on, modal, onClose) {
    if (trapHandler) {
      document.removeEventListener("keydown", trapHandler, true);
      trapHandler = null;
    }
    if (!on || !modal) return;
    trapHandler = (ev) => {
      if (modal.hidden) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
        return;
      }
      if (ev.key !== "Tab") return;
      const list = focusables(modal);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapHandler, true);
  }

  function returnFocus() {
    const target =
      lastFocus ||
      document.querySelector('[data-chrome="sobre"]') ||
      document.querySelector('[data-chrome="ajuda"]') ||
      document.getElementById("btn-sobre");
    lastFocus = null;
    try {
      target?.focus?.();
    } catch {
      /* ignore */
    }
  }

  function hideQuiet(el) {
    if (!el || el.hidden) return;
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
  }

  function open(show) {
    const modal = modalEl();
    if (!modal) return;
    if (show) {
      lastFocus = document.activeElement;
      hideQuiet(infoModalEl());
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      refreshLastUpdate();
      bindTrap(true, modal, () => open(false));
      window.requestAnimationFrame(() => {
        document.getElementById("btn-fechar-sobre")?.focus();
      });
    } else {
      pauseTutorial();
      bindTrap(false);
      hideQuiet(modal);
      returnFocus();
    }
  }

  function infoModalEl() {
    return document.getElementById("modal-info-sobre");
  }

  function openInfo(show) {
    const modal = infoModalEl();
    if (!modal) return;
    if (show) {
      lastFocus = document.activeElement;
      pauseTutorial();
      hideQuiet(modalEl());
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      refreshLastUpdate();
      bindTrap(true, modal, () => openInfo(false));
      window.requestAnimationFrame(() => {
        document.getElementById("btn-fechar-info-sobre")?.focus();
      });
    } else {
      bindTrap(false);
      hideQuiet(modal);
      returnFocus();
    }
  }

  function init() {
    const modal = modalEl();
    const video = videoEl();
    const closers = [
      document.getElementById("btn-fechar-sobre"),
      document.getElementById("btn-ok-sobre"),
    ];

    closers.forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => open(false));
    });
    if (modal) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) open(false);
      });
    }
    modal?.addEventListener("click", (ev) => {
      const btn = ev.target.closest?.("[data-seek]");
      if (!btn || !modal.contains(btn)) return;
      seekTo(btn.getAttribute("data-seek"));
    });
    document.getElementById("btn-ajuda-play")?.addEventListener("click", () => seekTo(0));
    const infoModal = infoModalEl();
    ["btn-sobre", "btn-sobre-footer"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", () => openInfo(true));
    });
    ["btn-fechar-info-sobre", "btn-ok-info-sobre"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", () => openInfo(false));
    });
    infoModal?.addEventListener("click", (ev) => {
      if (ev.target === infoModal) openInfo(false);
    });
    video?.addEventListener("timeupdate", () => syncChips(video.currentTime));
    video?.addEventListener("play", () => syncChips(video.currentTime));

    if (!loadedOnce) refreshLastUpdate().catch(() => {});
  }

  return { init, open, openInfo, refreshLastUpdate };
})();
