import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(() => {
  // Cloudflare Pages provides CF_PAGES=1 during build.
  // GitHub Pages serves under /<repo>/, so we keep the subpath there.
  // NOTE: This repo doesn't include Node types for TS, so avoid direct `process` reference.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
  const isCloudflarePages = env.CF_PAGES === "1";
  const base = isCloudflarePages ? "/" : "/candy_boost_planner/";

  return {
    // GitHub Pagesのサブパス配下でも動きやすいように調整します（Cloudflare Pagesは / 配信）
    // ルーティング方式（history/hash）を入れる場合は別途調整します。
    base,
    plugins: [vue()],
  };
});
