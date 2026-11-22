(function () {
  "use strict";

  var KEY = "hdash.theme";

  function normalizeTheme(value) {
    return value === "light" ? "light" : "dark";
  }

  function nextTheme(current) {
    return normalizeTheme(current) === "light" ? "dark" : "light";
  }

  if (typeof document !== "undefined") {
    var current = "dark";
    try {
      current = normalizeTheme(window.localStorage.getItem(KEY));
    } catch (e) {
      current = "dark";
    }
    document.documentElement.dataset.theme = current;

    function apply(theme) {
      document.documentElement.dataset.theme = theme;
      var button = document.getElementById("themeBtn");
      if (button) {
        var label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
        button.textContent = theme === "light" ? "☾" : "☀";
        button.title = label;
        button.setAttribute("aria-label", label);
      }
    }

    document.addEventListener("DOMContentLoaded", function () {
      apply(current);
      var button = document.getElementById("themeBtn");
      if (button) {
        button.addEventListener("click", function () {
          current = nextTheme(current);
          try {
            window.localStorage.setItem(KEY, current);
          } catch (e) {
            /* private mode — theme still applies for this page */
          }
          apply(current);
        });
      }
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizeTheme: normalizeTheme, nextTheme: nextTheme };
  }
})();
