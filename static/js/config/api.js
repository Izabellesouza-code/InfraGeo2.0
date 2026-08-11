/**
 * Base da API (Render) vs assets estáticos (Vercel).
 * Em local/monólito: INFRA_GEO_API_URL vazio → mesmas rotas /api.
 * Em produção (Vercel): defina window.INFRA_GEO_API_URL no config.runtime.js
 */
window.InfraGeoApi = (function () {
  "use strict";

  function base() {
    const raw =
      (typeof window.INFRA_GEO_API_URL === "string" && window.INFRA_GEO_API_URL) ||
      (typeof window.__INFRA_GEO_API_URL__ === "string" && window.__INFRA_GEO_API_URL__) ||
      "";
    return String(raw).trim().replace(/\/$/, "");
  }

  function url(path) {
    if (path == null || path === "") return base() || "";
    const s = String(path);
    if (/^https?:\/\//i.test(s) || s.startsWith("data:") || s.startsWith("blob:")) {
      return s;
    }
    const p = s.startsWith("/") ? s : `/${s}`;
    const b = base();
    return b ? `${b}${p}` : p;
  }

  function fetch(path, opts) {
    return window.fetch(url(path), opts);
  }

  return { base, url, fetch };
})();
