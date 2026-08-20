/**
 * Ações do menu lateral (ligar/desligar, enquadrar, upload SHP, legendas).
 * Em tablet/celular: gaveta com botão do header.
 * Upload: escolhe camada existente ou cria nova (sem grupo Uploads).
 */
window.InfraGeoSidebar = (function () {
  "use strict";

  const MQ = "(max-width: 980px)";
  let pendingFiles = [];
  let pendingHandlers = null;
  let optionsCache = null;

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
    const confirmBtn = document.getElementById("btn-confirmar-upload-destino");
    if (btn) {
      btn.disabled = !!busy;
      btn.classList.toggle("is-busy", !!busy);
      const label = btn.querySelector(".menu-btn__label");
      if (label) {
        label.innerHTML = busy ? "Enviando…" : "Upload<br />SHP/GeoJSON";
      }
    }
    if (confirmBtn) confirmBtn.disabled = !!busy;
  }

  function setDestinoError(msg) {
    const el = document.getElementById("upload-destino-erro");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function syncDestinoMode() {
    const mode =
      document.querySelector('input[name="upload_destination"]:checked')
        ?.value || "existing";
    const existing = document.getElementById("upload-destino-existing");
    const neu = document.getElementById("upload-destino-new");
    const layerSel = document.getElementById("upload-destino-layer");
    const nome = document.getElementById("upload-destino-nome");
    const grupo = document.getElementById("upload-destino-grupo");
    if (existing) existing.hidden = mode !== "existing";
    if (neu) neu.hidden = mode !== "new";
    if (layerSel) layerSel.required = mode === "existing";
    if (nome) nome.required = mode === "new";
    if (grupo) grupo.required = mode === "new";
  }

  function openDestinoModal(show) {
    const modal = document.getElementById("modal-upload-destino");
    if (!modal) return;
    modal.hidden = !show;
    modal.setAttribute("aria-hidden", String(!show));
    if (!show) {
      pendingFiles = [];
      setDestinoError("");
      const input = document.getElementById("input-upload-shp");
      if (input) input.value = "";
    }
  }

  async function loadUploadOptions() {
    const headers = window.InfraGeoAuth?.authHeaders?.() || {};
    const res = await fetch(
      window.InfraGeoApi.url("/api/postgis/upload-options"),
      { headers }
    );
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw Object.assign(new Error("Sessão expirada"), { status: 401 });
    }
    if (!res.ok) {
      throw new Error(data.detail || data.message || `HTTP ${res.status}`);
    }
    optionsCache = data;
    return data;
  }

  function fillDestinoSelects(data, suggestedName) {
    const layerSel = document.getElementById("upload-destino-layer");
    const grupoSel = document.getElementById("upload-destino-grupo");
    const nome = document.getElementById("upload-destino-nome");
    if (layerSel) {
      layerSel.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent =
        (data.layers || []).length
          ? "Selecione a camada…"
          : "Nenhuma camada cadastrada";
      layerSel.appendChild(placeholder);
      (data.layers || []).forEach((layer) => {
        const opt = document.createElement("option");
        opt.value = `${layer.schema}||${layer.table}`;
        opt.textContent = `${layer.group_name || "Grupo"} · ${layer.name}`;
        layerSel.appendChild(opt);
      });
    }
    if (grupoSel) {
      grupoSel.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Selecione o grupo…";
      grupoSel.appendChild(placeholder);
      (data.groups || []).forEach((g) => {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = g.name;
        grupoSel.appendChild(opt);
      });
    }
    if (nome && suggestedName) nome.value = suggestedName;
  }

  async function prepareUpload(fileList, handlers) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const hasZip = files.some((f) => /\.zip$/i.test(f.name));
    const hasShp = files.some((f) => /\.shp$/i.test(f.name));
    const hasGeojson = files.some((f) => /\.(geojson|json)$/i.test(f.name));
    if (!hasZip && !hasShp && !hasGeojson) {
      window.alert(
        "Envie um .zip (somente shapefile ou GeoJSON), os arquivos .shp/.shx/.dbf ou um .geojson."
      );
      return;
    }
    if (hasZip && files.length > 1) {
      window.alert(
        "Envie o .zip sozinho, ou o conjunto .shp/.shx/.dbf, ou um único .geojson."
      );
      return;
    }

    pendingFiles = files;
    pendingHandlers = handlers;
    const baseName = (
      files.find((f) => /\.shp$/i.test(f.name)) ||
      files.find((f) => /\.(geojson|json)$/i.test(f.name)) ||
      files[0]
    ).name.replace(/\.(zip|shp|geojson|json)$/i, "");

    const fileHint = document.getElementById("upload-destino-arquivo");
    if (fileHint) {
      fileHint.textContent = `Arquivo: ${files.map((f) => f.name).join(", ")}`;
    }

    setDestinoError("");
    openDestinoModal(true);
    syncDestinoMode();
    try {
      const data = await loadUploadOptions();
      fillDestinoSelects(data, baseName);
      const existingRadio = document.querySelector(
        'input[name="upload_destination"][value="existing"]'
      );
      const newRadio = document.querySelector(
        'input[name="upload_destination"][value="new"]'
      );
      if (!(data.layers || []).length) {
        if (newRadio) newRadio.checked = true;
        if (existingRadio) existingRadio.disabled = true;
      } else if (existingRadio) {
        existingRadio.disabled = false;
        existingRadio.checked = true;
      }
      syncDestinoMode();
    } catch (err) {
      if (err.status === 401) {
        openDestinoModal(false);
        window.InfraGeoAuth?.logout?.();
        window.alert("Sessão expirada. Faça login novamente.");
        window.InfraGeoAuth?.requireLogin?.(() =>
          prepareUpload(files, handlers)
        );
        return;
      }
      setDestinoError(err.message || "Falha ao carregar camadas");
    }
  }

  async function uploadShapefile(fileList, handlers, destinationOpts) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    const opts = destinationOpts || {};
    const destination = opts.destination || "new";
    form.append("destination", destination);
    if (opts.name) form.append("name", opts.name);
    if (opts.group_id) form.append("group_id", opts.group_id);
    if (opts.target_schema) form.append("target_schema", opts.target_schema);
    if (opts.target_table) form.append("target_table", opts.target_table);

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
        window.InfraGeoAuth?.requireLogin?.(() =>
          uploadShapefile(files, handlers, destinationOpts)
        );
        return;
      }
      if (!res.ok) {
        throw new Error(data.detail || data.message || `HTTP ${res.status}`);
      }
      openDestinoModal(false);
      if (handlers?.onUploadSuccess) {
        await handlers.onUploadSuccess(data);
      } else {
        window.alert(
          `Camada gravada: ${data.schema}.${data.table} (${data.feature_count} feições)`
        );
      }
    } catch (err) {
      console.error("Upload SHP:", err);
      setDestinoError(err.message || String(err));
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
      const destModal = document.getElementById("modal-upload-destino");
      if (ev.key === "Escape" && destModal && !destModal.hidden) {
        openDestinoModal(false);
      }
    });

    window.matchMedia?.(MQ)?.addEventListener?.("change", (ev) => {
      if (!ev.matches) setOpen(false);
    });

    let resizeTimer = null;
    const onViewportChange = () => {
      if (!isMobileLayout()) setOpen(false);
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        try {
          window.InfraGeoMap?.getMap?.()?.invalidateSize?.({ animate: false });
        } catch {
          /* ignore */
        }
      }, 180);
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);

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
        prepareUpload(fileInput.files, handlers);
      });
    }

    document
      .querySelectorAll('input[name="upload_destination"]')
      .forEach((radio) => {
        radio.addEventListener("change", syncDestinoMode);
      });

    const closeBtn = document.getElementById("btn-fechar-upload-destino");
    const cancelBtn = document.getElementById("btn-cancelar-upload-destino");
    const form = document.getElementById("form-upload-destino");
    const modal = document.getElementById("modal-upload-destino");
    [closeBtn, cancelBtn].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => openDestinoModal(false));
    });
    if (modal) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) openDestinoModal(false);
      });
    }
    if (form) {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        setDestinoError("");
        if (!pendingFiles.length) {
          setDestinoError("Nenhum arquivo selecionado");
          return;
        }
        const mode =
          document.querySelector('input[name="upload_destination"]:checked')
            ?.value || "existing";
        if (mode === "existing") {
          const raw = document.getElementById("upload-destino-layer")?.value || "";
          const [schema, table] = raw.split("||");
          if (!schema || !table) {
            setDestinoError("Selecione uma camada existente");
            return;
          }
          await uploadShapefile(pendingFiles, pendingHandlers || handlers, {
            destination: "existing",
            target_schema: schema,
            target_table: table,
          });
          return;
        }
        const name = (
          document.getElementById("upload-destino-nome")?.value || ""
        ).trim();
        const groupId = document.getElementById("upload-destino-grupo")?.value || "";
        if (!name) {
          setDestinoError("Informe o nome da nova camada");
          return;
        }
        if (!groupId) {
          setDestinoError("Selecione o grupo da sidebar");
          return;
        }
        await uploadShapefile(pendingFiles, pendingHandlers || handlers, {
          destination: "new",
          name,
          group_id: groupId,
        });
      });
    }
  }

  return {
    init,
    uploadShapefile,
    prepareUpload,
    setOpen,
    toggle,
    isMobileLayout,
  };
})();
