(function () {
  "use strict";

  const TOKEN_KEY = "infrageo_token";
  const USER_KEY = "infrageo_user";

  function formatApiError(data, status) {
    const d = data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length) {
      return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
    }
    if (d && typeof d === "object" && d.message) return d.message;
    return data?.message || `HTTP ${status}`;
  }

  function apiUrl(path) {
    return window.InfraGeoApi?.url?.(path) || path;
  }

  const errEl = document.getElementById("login-page-erro");
  const okEl = document.getElementById("login-page-ok");

  function showError(msg) {
    if (okEl) {
      okEl.hidden = true;
      okEl.textContent = "";
    }
    if (errEl) {
      errEl.textContent = msg || "Falha";
      errEl.hidden = false;
    }
  }

  function showOk(msg) {
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
    if (okEl) {
      okEl.textContent = msg || "";
      okEl.hidden = false;
    }
  }

  async function doLogin(goAdmin) {
    const username = document.getElementById("login-page-usuario")?.value?.trim();
    const password = document.getElementById("login-page-senha")?.value || "";
    if (!username || !password) {
      showError("Informe e-mail e senha.");
      return;
    }
    const form = document.getElementById("form-login-page");
    const card = document.getElementById("login-duo-card");
    const submitEl = document.getElementById("login-duo-submit");
    const submitLabel = submitEl?.querySelector(".login-duo__btn-label");
    const idleLabel = goAdmin ? "Entrar no painel" : "Entrar";
    const buttons = [
      ...(form ? [...form.querySelectorAll("button")] : []),
      document.getElementById("btn-login-admin"),
      document.getElementById("btn-login-user"),
    ].filter(Boolean);
    function setLoading(on) {
      card?.classList.toggle("is-loading", on);
      card?.setAttribute("aria-busy", on ? "true" : "false");
      buttons.forEach((b) => {
        b.disabled = on;
      });
      if (submitLabel) submitLabel.textContent = on ? "Entrando…" : idleLabel;
      document.getElementById("login-page-usuario")?.toggleAttribute("readonly", on);
      document.getElementById("login-page-senha")?.toggleAttribute("readonly", on);
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(data, res.status));
      if (data.access_token) localStorage.setItem(TOKEN_KEY, data.access_token);
      if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      if (goAdmin) {
        if (!data.user?.is_admin) {
          throw new Error("Esta conta não é de administrador.");
        }
        window.location.href = "/admin";
        return;
      }
      window.location.href = "/";
    } catch (err) {
      setLoading(false);
      showError(err.message || "Falha no login");
    }
  }

  const loginForm = document.getElementById("form-login-page");
  if (loginForm) {
    const card = document.getElementById("login-duo-card");
    const titleEl = document.getElementById("login-duo-title");
    const hintEl = document.getElementById("login-duo-hint");
    const submitEl = document.getElementById("login-duo-submit");
    const submitLabel = submitEl?.querySelector(".login-duo__btn-label");
    let switching = false;

    function setAdminMode(on) {
      if (!card || switching || card.classList.contains("is-loading")) return;
      if (card.classList.contains("is-admin") === on) return;
      switching = true;
      card.classList.add("is-switching");
      window.setTimeout(() => {
        card.classList.toggle("is-admin", on);
        if (titleEl) titleEl.textContent = on ? "Administrador" : "Entrar";
        if (hintEl) {
          hintEl.textContent = on
            ? "Entre com uma conta de administrador"
            : "Use o e-mail e a senha cadastrados";
        }
        if (submitLabel) submitLabel.textContent = on ? "Entrar no painel" : "Entrar";
        else if (submitEl) submitEl.textContent = on ? "Entrar no painel" : "Entrar";
        if (errEl) {
          errEl.hidden = true;
          errEl.textContent = "";
        }
        window.setTimeout(() => {
          card.classList.remove("is-switching");
        }, 80);
        window.setTimeout(() => {
          switching = false;
        }, 700);
      }, 160);
    }

    loginForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await doLogin(!!card?.classList.contains("is-admin"));
    });
    document.getElementById("btn-login-admin")?.addEventListener("click", () => {
      setAdminMode(true);
    });
    document.getElementById("btn-login-user")?.addEventListener("click", () => {
      setAdminMode(false);
    });
    const senha = document.getElementById("login-page-senha");
    document.getElementById("btn-toggle-senha")?.addEventListener("click", () => {
      if (!senha) return;
      senha.type = senha.type === "password" ? "text" : "password";
    });
  }

  const recoverForm = document.getElementById("form-recover-password");
  if (recoverForm) {
    recoverForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = document.getElementById("recover-email")?.value?.trim();
      const nome = document.getElementById("recover-nome")?.value?.trim();
      const newPassword = document.getElementById("recover-password")?.value || "";
      const btn = recoverForm.querySelector('button[type="submit"]');
      if (!email || !nome || newPassword.length < 6) {
        showError("Informe e-mail, nome completo e uma senha com pelo menos 6 caracteres.");
        return;
      }
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(apiUrl("/api/auth/recover-password"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, nome, new_password: newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(formatApiError(data, res.status));
        showOk(data.message || "Senha atualizada.");
        window.setTimeout(() => {
          window.location.href = "/login";
        }, 1200);
      } catch (err) {
        showError(err.message || "Não foi possível salvar a senha");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  const forgotForm = document.getElementById("form-forgot-password");
  if (forgotForm) {
    forgotForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = document.getElementById("forgot-email")?.value?.trim();
      const btn = forgotForm.querySelector('button[type="submit"]');
      if (!email) {
        showError("Informe o e-mail cadastrado.");
        return;
      }
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(apiUrl("/api/auth/forgot-password"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(formatApiError(data, res.status));
        showOk(data.message || "Se o e-mail estiver cadastrado, enviaremos um token.");
      } catch (err) {
        showError(err.message || "Não foi possível enviar o e-mail");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  const resetForm = document.getElementById("form-reset-password");
  if (resetForm) {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("token");
    if (fromUrl) {
      const tokenInput = document.getElementById("reset-token");
      if (tokenInput && !tokenInput.value) tokenInput.value = fromUrl;
    }
    resetForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const token = document.getElementById("reset-token")?.value?.trim();
      const newPassword = document.getElementById("reset-password")?.value || "";
      const btn = resetForm.querySelector('button[type="submit"]');
      if (!/^\d{6}$/.test(token) || newPassword.length < 6) {
        showError("Informe o código de 6 dígitos e uma senha com pelo menos 6 caracteres.");
        return;
      }
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(apiUrl("/api/auth/reset-password"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, new_password: newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(formatApiError(data, res.status));
        showOk(data.message || "Senha atualizada.");
        window.setTimeout(() => {
          window.location.href = "/login";
        }, 1200);
      } catch (err) {
        showError(err.message || "Não foi possível salvar a senha");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
})();
