import { createApp } from "vue";
import App from "./App.vue";
import "./components/main.css";
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

const saved = localStorage.getItem("candy-boost-planner:lang");
const i18n = createAppI18n(normalizeLocale(saved));

createApp(App).use(i18n).mount("#app");
