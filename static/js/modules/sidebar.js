/**
 * Ações do menu lateral (ligar/desligar, enquadrar, upload SHP, legendas).
 * Em tablet/celular: gaveta com botão do header.
 */
window.InfraGeoSidebar = (function () {
  "use strict";

  const MQ = "(max-width: 980px)";

  function isMobileLayout() {
    return window.matchMedia?.(MQ)?.matches === true;
  }

  function ensureBackdrop() {
    let backdrop = document.getElementById("sidebar-backdrop");
    if (backdrop) return backdrop;
    backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.id = "sidebar-backdrop";
    backdrop.className = "sidebar-backdrop";
    backdrop.setAttribute("aria-label", "Fechar menu");
    backdrop.addEventListener("click", () => setOpen(false));
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function setOpen(open) {
    const next = !!open && isMobileLayout();
    document.body.classList.toggle("sidebar-open", next);
    const btn = document.getElementById("btn-toggle-sidebar");
    if (btn) {
      btn.setAttribute("aria-expanded", String(next));
      btn.setAttribute(
        "aria-label",
        next ? "Fechar menu de camadas" : "Abrir menu de camadas"
      );
    }
    if (next) ensureBackdrop();
    // Leaflet precisa recalcular o tamanho após o layout mudar
    window.setTimeout(() => {
      try {
        window.InfraGeoMap?.getMap?.()?.invalidateSize?.({ animate: false });
      } catch {
        /* ignore */
      }
    }, 220);
  }

  function toggle() {
    setOpen(!document.body.classList.contains("sidebar-open"));
  }

  function setUploadBusy(busy) {
    const btn = document.getElementById("btn-upload-shp");
    if (!btn) return;
    btn.disabled = !!busy;
    btn.classList.toggle("is-busy", !!busy);
    const label = btn.querySelector(".menu-btn__label");
    if (label) {
      label.innerHTML = busy ? "Enviando…" : "Upload<br />SHP";
    }
  }

  async function uploadShapefile(fileList, handlers) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const hasZip = files.some((f) => /\.zip$/i.test(f.name));
    const hasShp = files.some((f) => /\.shp$/i.test(f.name));
    if (!hasZip && !hasShp) {
      window.alert("Envie um .zip do shapefile ou os arquivos .shp/.shx/.dbf.");
      return;
    }

    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    const baseName = (files.find((f) => /\.shp$/i.test(f.name)) || files[0]).name.replace(
      /\.(zip|shp)$/i,
      ""
    );
    form.append("name", baseName);

    setUploadBusy(true);
    try {
      const headers = window.InfraGeoAuth?.authHeaders?.() || {};
      const res = await fetch(window.InfraGeoApi.url("/api/postgis/upload"), {
        method: "POST",
        headers,
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.InfraGeoAuth?.logout?.();
        window.alert("Sessão expirada. Faça login novamente.");
        window.InfraGeoAuth?.requireLogin?.(() => uploadShapefile(files, handlers));
        return;
      }
      if (!res.ok) {
        throw new Error(data.detail || data.message || `HTTP ${res.status}`);
      }
      if (handlers.onUploadSuccess) {
        await handlers.onUploadSuccess(data);
      } else {
        window.alert(`Camada gravada: ${data.schema}.${data.table} (${data.feature_count} feições)`);
      }
    } catch (err) {
      console.error("Upload SHP:", err);
      window.alert(`Falha no upload: ${err.message || err}`);
    } finally {
      setUploadBusy(false);
      const input = document.getElementById("input-upload-shp");
      if (input) input.value = "";
    }
  }

  function init(handlers) {
    const root = document.querySelector(".sidebar");
    const fileInput = document.getElementById("input-upload-shp");
    if (!root) return;

    ensureBackdrop();
    const menuBtn = document.getElementById("btn-toggle-sidebar");
    if (menuBtn) {
      menuBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        toggle();
      });
    }

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && document.body.classList.contains("sidebar-open")) {
        setOpen(false);
      }
    });

    window.matchMedia?.(MQ)?.addEventListener?.("change", (ev) => {
      if (!ev.matches) setOpen(false);
    });

    root.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === "toggle-layers" && handlers.onToggleLayers) {
        btn.classList.toggle("is-active");
        handlers.onToggleLayers(btn.classList.contains("is-active"));
      }
      if (action === "fit-amazonas" && handlers.onFitAmazonas) {
        handlers.onFitAmazonas();
      }
      if (action === "upload-shp") {
        const openPicker = () => {
          if (fileInput) fileInput.click();
        };
        if (window.InfraGeoAuth) {
          window.InfraGeoAuth.requireLogin(openPicker);
        } else {
          openPicker();
        }
      }
      if (action === "toggle-legend" && handlers.onToggleLegend) {
        btn.classList.toggle("is-active");
        handlers.onToggleLegend(btn.classList.contains("is-active"));
      }
    });

    if (fileInput) {
      fileInput.addEventListener("change", () => {
        uploadShapefile(fileInput.files, handlers);
      });
    }
  }

  return { init, uploadShapefile, setOpen, toggle, isMobileLayout };
})();
