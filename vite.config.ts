import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  // GitHub Pagesのサブパス配下でも動きやすいように相対パスで出力します。
  // ルーティング方式（history/hash）を入れる場合は別途調整します。
  base: "./",
  plugins: [vue()],
});
