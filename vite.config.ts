import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(() => {
  // 独自ドメイン (candy.jb-sk.com) 移行に伴いルートパスに固定
  const base = "/";

  return {
    // GitHub Pagesのサブパス配下でも動きやすいように調整します（Cloudflare Pagesは / 配信）
    // ルーティング方式（history/hash）を入れる場合は別途調整します。
    base,
    plugins: [vue()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
  };
});
