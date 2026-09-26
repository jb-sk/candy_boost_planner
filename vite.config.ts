import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import themeCSS from "./vite-plugin-theme-css";

/** ES モジュール・動的 import・import.meta が使える最も古い範囲（Vite の「Browser Compatibility」）。 */
const LEGACY_BROWSER_TARGET = ["chrome64", "edge79", "firefox67", "safari11.1"];

export default defineConfig(() => {
  // 独自ドメイン (candy.jb-sk.com) 移行に伴いルートパスに固定
  const base = "/";

    return {
    // GitHub Pagesのサブパス配下でも動きやすいように調整します（Cloudflare Pagesは / 配信）
    // ルーティング方式（history/hash）を入れる場合は別途調整します。
    base,
    plugins: [vue(), themeCSS()],
      server: {
        host: true,
        port: 5173,
        strictPort: true,
      },
      build: {
        // 古い端末でも動くよう、Vite の既定（Baseline Widely Available: Safari 16・Chrome 107）より下げる。
        // Vite の出力は ES モジュール・動的 import・import.meta を使うので、それらが使える最も古い範囲にする
        // （これより古い端末には @vitejs/plugin-legacy が要る）。構文と CSS はこの範囲へ変換されるが、
        // 実行時の機能（メソッドなど）は変換されない。新しい機能を使うときは対応開始の版を確かめること。
        target: LEGACY_BROWSER_TARGET,
        cssTarget: LEGACY_BROWSER_TARGET,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes("node_modules")) return;

              const vendorPackages = [
                "/node_modules/vue/",
                "/node_modules/@vue/",
                "/node_modules/vue-i18n/",
                "/node_modules/@intlify/",
              ];

              if (vendorPackages.some((pkg) => id.includes(pkg))) {
                return "vendor";
              }
            },
          },
        },
      },
    };
});
