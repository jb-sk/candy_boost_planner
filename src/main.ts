import { createApp } from "vue";
import App from "./App.vue";

import { createAppI18n, normalizeLocale } from "./i18n";

// Cloudflare Web Analytics (optional)
// Set VITE_CF_WEB_ANALYTICS_TOKEN in your environment to enable.
const cfToken = (import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN ?? "").trim();
if (cfToken) {
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfToken }));
  document.head.appendChild(s);
}

const savedLocale = localStorage.getItem("candy-boost-planner:lang");
const i18n = createAppI18n(normalizeLocale(savedLocale));

// Theme CSS loading
// Production: loaded via blocking <link> in index.html (vite-plugin-theme-css)
// Development: loaded via dynamic import below
import { DEFAULT_THEME_ID, DESIGN_STORAGE_KEY } from "./config/themes";

async function boot() {
  if (import.meta.env.DEV) {
    const design = localStorage.getItem(DESIGN_STORAGE_KEY) || DEFAULT_THEME_ID;
    const themes: Record<string, () => Promise<unknown>> =
      import.meta.glob("./styles/*.css");
    const loader = themes[`./styles/${design}.css`];
    if (loader) {
      await loader();
    } else {
      await import("./styles/blue.css");
    }
  }
  // In production, theme CSS is already loaded by the inline script in <head>
  createApp(App).use(i18n).mount("#app");
}
boot();
