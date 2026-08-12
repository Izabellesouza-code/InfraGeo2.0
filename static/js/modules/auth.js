/**
 * Autenticação (JWT) — consulta public.users no PostgreSQL via API.
 * Upload só com usuário ativo e permissão (can_upload / admin).
 */
window.InfraGeoAuth = (function () {
  "use strict";

  const TOKEN_KEY = "infrageo_token";
  const USER_KEY = "infrageo_user";

  let pendingUpload = null;

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function isLoggedIn() {
    const user = getUser();
    return !!(getToken() && user && (user.can_upload || user.is_admin));
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user || null));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function authHeaders(extra) {
    const h = { ...(extra || {}) };
    const t = getToken();
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  function formatApiError(data, status) {
    const d = data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length) {
      return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
    }
    if (d && typeof d === "object" && d.message) return d.message;
    return data?.message || `HTTP ${status}`;
  }

  function openLogin(show) {
    const modal = document.getElementById("modal-login");
    if (!modal) return;
    modal.hidden = !show;
    modal.setAttribute("aria-hidden", String(!show));
    if (show) {
      const err = document.getElementById("login-erro");
      if (err) {
        err.hidden = true;
        err.textContent = "";
      }
      const user = document.getElementById("login-usuario");
      if (user) setTimeout(() => user.focus(), 50);
    }
  }

  function requireLogin(onSuccess) {
    if (isLoggedIn()) {
      if (onSuccess) onSuccess();
      return;
    }
    clearSession();
    pendingUpload = onSuccess || null;
    openLogin(true);
  }

  async function login(username, password) {
    const res = await fetch(window.InfraGeoApi.url("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(formatApiError(data, res.status));
    }
    if (!data.user || !(data.user.can_upload || data.user.is_admin)) {
      clearSession();
      throw new Error("Usuário sem permissão para upload de camadas");
    }
    setSession(data.access_token, data.user);
    return data.user;
  }

  function logout() {
    clearSession();
    pendingUpload = null;
  }

  function init() {
    // Após F5 / reload, encerra a sessão — upload pede senha de novo
    clearSession();
    pendingUpload = null;

    const form = document.getElementById("form-login");
    const closeBtn = document.getElementById("btn-fechar-login");
    const cancelBtn = document.getElementById("btn-cancelar-login");
    const modal = document.getElementById("modal-login");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        pendingUpload = null;
        openLogin(false);
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        pendingUpload = null;
        openLogin(false);
      });
    }
    if (modal) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) {
          pendingUpload = null;
          openLogin(false);
        }
      });
    }

    if (form) {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const username = document.getElementById("login-usuario")?.value?.trim();
        const password = document.getElementById("login-senha")?.value || "";
        const errEl = document.getElementById("login-erro");
        const submitBtn = form.querySelector('button[type="submit"]');
        if (!username || !password) {
          if (errEl) {
            errEl.textContent = "Informe usuário e senha.";
            errEl.hidden = false;
          }
          return;
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
          await login(username, password);
          openLogin(false);
          const cb = pendingUpload;
          pendingUpload = null;
          if (cb) cb();
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || "Falha no login";
            errEl.hidden = false;
          }
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  return {
    init,
    getToken,
    getUser,
    isLoggedIn,
    authHeaders,
    requireLogin,
    login,
    logout,
    openLogin,
  };
})();
