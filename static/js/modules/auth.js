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
    return !!(getToken() && getUser());
  }

  function canUpload() {
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
    if (canUpload()) {
      if (onSuccess) onSuccess();
      return;
    }
    pendingUpload = onSuccess || null;
    openLogin(true);
  }

  async function login(username, password) {
    const res = await fetch(window.InfraGeoApi.url("/api/auth/login"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(formatApiError(data, res.status));
    }
    setSession(data.access_token, data.user);
    return data.user;
  }

  async function logout() {
    try {
      await fetch(window.InfraGeoApi.url("/api/auth/logout"), {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      /* ignore */
    }
    clearSession();
    pendingUpload = null;
  }

  function permissionLabel(user) {
    if (!user) return "—";
    if (user.is_admin) return "Administrador";
    if (user.can_upload) return "Editor (upload)";
    return "Leitura";
  }

  function originLabel(user) {
    const email = String(user?.email || "");
    if (email.endsWith("@neon.role")) return "Role Neon (Postgres)";
    return "Usuário da aplicação";
  }

  function userInitial(user) {
    const name = String(user?.full_name || user?.nome || user?.username || "").trim();
    if (!name) return "";
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1] : "";
    const a = first.charAt(0);
    const b = last.charAt(0);
    return `${a}${b}`.toLocaleUpperCase("pt-BR");
  }

  function fillProfile(user) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || "—";
    };
    set("perfil-nome", user?.full_name || user?.nome || user?.username);
    set("perfil-usuario", user?.full_name || user?.nome || "—");
    set("perfil-permissao", permissionLabel(user));
    set("perfil-email", user?.email);
    const adminLink = document.getElementById("link-painel-admin");
    if (adminLink) adminLink.hidden = !user?.is_admin;
    const initial = userInitial(user) || "—";
    const avatar = document.getElementById("btn-user-menu");
    if (avatar) {
      avatar.innerHTML = `<span class="app-header__user-initial">${initial}</span>`;
      avatar.title = user?.full_name || user?.username || "Perfil";
    }
    const big = document.getElementById("perfil-avatar");
    if (big) big.textContent = initial;
  }

  function setProfileOpen(open) {
    const panel = document.getElementById("painel-perfil");
    const btn = document.getElementById("btn-user-menu");
    if (!panel) return;
    panel.classList.toggle("is-open", !!open);
    panel.setAttribute("aria-hidden", String(!open));
    if (btn) btn.setAttribute("aria-expanded", String(!!open));
  }

  async function refreshProfile() {
    let user = getUser();
    try {
      const res = await fetch(window.InfraGeoApi.url("/api/auth/me"), {
        credentials: "same-origin",
        headers: authHeaders(),
      });
      if (res.ok) {
        user = await res.json();
        if (user) {
          const token = getToken();
          if (token) setSession(token, user);
          else localStorage.setItem(USER_KEY, JSON.stringify(user));
        }
      }
    } catch {
      /* usa sessão local */
    }
    fillProfile(user);
    return user;
  }

  function init() {
    refreshProfile();

    const userBtn = document.getElementById("btn-user-menu");
    const panel = document.getElementById("painel-perfil");
    if (userBtn && panel) {
      userBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const willOpen = !panel.classList.contains("is-open");
        if (willOpen) await refreshProfile();
        setProfileOpen(willOpen);
      });
      document.addEventListener("click", (ev) => {
        if (panel.classList.contains("is-open") && !ev.target.closest(".app-header__account")) {
          setProfileOpen(false);
        }
      });
    }

    document.getElementById("btn-logout")?.addEventListener("click", async () => {
      await logout();
      window.location.href = "/login";
    });

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
    canUpload,
    authHeaders,
    requireLogin,
    login,
    logout,
    openLogin,
  };
})();
