import { createApp } from "vue";
import App from "./App.vue";
import "./styles/main.css";
import { createAppI18n, normalizeLocale } from "./i18n";

const saved = localStorage.getItem("candy-boost-planner:lang");
const i18n = createAppI18n(normalizeLocale(saved));

createApp(App).use(i18n).mount("#app");
