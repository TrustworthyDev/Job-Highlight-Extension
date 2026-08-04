/* Resolves the colour theme before first paint (this file is loaded from <head>,
   so it runs synchronously and there is no flash of the wrong theme).

   Preference lives in localStorage as "system" | "light" | "dark". The resolved
   value is stamped on <html data-theme>, so hidden.css only needs light tokens
   plus a [data-theme="dark"] override. */

(function () {
  const KEY = "lhvj-theme";
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function pref() {
    try {
      const v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) {
      return "system";
    }
  }

  function apply(p) {
    const resolved = p === "system" ? (media.matches ? "dark" : "light") : p;
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themePref = p;
    root.style.colorScheme = resolved;
  }

  // Exposed for hidden.js (the toggle button).
  window.lhvjTheme = {
    get: pref,
    set(p) {
      try {
        if (p === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, p);
      } catch (e) {
        /* private mode — theme just won't persist */
      }
      apply(p);
    },
    cycle() {
      const order = ["system", "light", "dark"];
      const next = order[(order.indexOf(pref()) + 1) % order.length];
      this.set(next);
      return next;
    },
  };

  apply(pref());

  // Follow the OS while the preference is "system".
  media.addEventListener("change", () => {
    if (pref() === "system") apply("system");
  });
})();
