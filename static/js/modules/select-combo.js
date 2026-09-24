/**
 * Selects customizados (destaque verde, mesmo padrão do admin).
 */
window.InfraGeoSelectCombo = (function () {
  "use strict";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function selectedLabel(sel) {
    return sel.options[sel.selectedIndex]?.textContent || sel.options[0]?.textContent || "";
  }

  function closeAll(except) {
    document.querySelectorAll(".ig-combo__list").forEach((el) => {
      if (el !== except) el.hidden = true;
    });
    document.querySelectorAll(".ig-combo__btn").forEach((el) => {
      if (!except || el.nextElementSibling !== except) {
        el.setAttribute("aria-expanded", "false");
      }
    });
  }

  function placeList(btn, list) {
    const r = btn.getBoundingClientRect();
    const maxH = Math.min(260, window.innerHeight - r.bottom - 12);
    list.style.position = "fixed";
    list.style.left = `${Math.max(8, r.left)}px`;
    list.style.width = `${r.width}px`;
    list.style.top = `${r.bottom + 4}px`;
    list.style.maxHeight = `${Math.max(120, maxH)}px`;
    list.style.zIndex = "5000";
  }

  function enhance(sel) {
    if (!sel || sel.dataset.nativeSelect === "1" || sel.size > 1 || sel.multiple) return;
    let wrap = sel.closest(".ig-combo");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "ig-combo";
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ig-combo__btn";
      btn.setAttribute("aria-haspopup", "listbox");
      btn.setAttribute("aria-expanded", "false");
      wrap.appendChild(btn);
      const list = document.createElement("div");
      list.className = "ig-combo__list";
      list.hidden = true;
      list.setAttribute("role", "listbox");
      wrap.appendChild(list);
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const willOpen = list.hidden;
        closeAll();
        if (willOpen) {
          list.hidden = false;
          btn.setAttribute("aria-expanded", "true");
          placeList(btn, list);
        }
      });
      list.addEventListener("click", (ev) => {
        const opt = ev.target.closest("[data-value]");
        if (!opt) return;
        sel.value = opt.getAttribute("data-value") || "";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        list.hidden = true;
        btn.setAttribute("aria-expanded", "false");
        enhance(sel);
      });
    }
    const btn = wrap.querySelector(".ig-combo__btn");
    const list = wrap.querySelector(".ig-combo__list");
    if (btn) btn.textContent = selectedLabel(sel);
    if (list) {
      list.innerHTML = [...sel.options]
        .map((opt) => {
          const active = opt.value === sel.value ? " is-active" : "";
          return `<button type="button" class="ig-combo__opt${active}" role="option" data-value="${escapeHtml(opt.value)}">${escapeHtml(opt.textContent)}</button>`;
        })
        .join("");
    }
  }

  function enhanceAll(root) {
    (root || document).querySelectorAll("select").forEach(enhance);
  }

  document.addEventListener("click", (ev) => {
    if (ev.target.closest(".ig-combo")) return;
    closeAll();
  });

  window.addEventListener("resize", () => closeAll());
  window.addEventListener("scroll", (ev) => {
    if (ev.target?.closest?.(".ig-combo__list")) return;
    closeAll();
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => enhanceAll());
  } else {
    enhanceAll();
  }

  const mo = new MutationObserver((muts) => {
    muts.forEach((m) => {
      if (m.target && m.target.tagName === "SELECT") enhance(m.target);
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.tagName === "SELECT") enhance(n);
        else n.querySelectorAll?.("select").forEach(enhance);
      });
    });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  return { enhance, enhanceAll };
})();
