/**
 * Vite plugin — static theme CSS loading.
 *
 * In production builds:
 *  1. Each src/styles/<id>.css is emitted as a standalone CSS asset.
 *  2. A tiny inline script is injected into index.html <head> that reads
 *     the user's theme from localStorage and uses document.write to inject
 *     a render-blocking <link> into the parser stream.
 *
 * This eliminates FOUC because the browser treats the written <link> as
 * a static stylesheet and blocks rendering until it is loaded.
 * As a fallback, index.html also sets body { visibility: hidden } which
 * is revealed by reset.css (body { visibility: visible }).
 *
 * In dev mode this plugin is a no-op; main.ts uses dynamic import instead.
 */

import { type Plugin, type ResolvedConfig } from "vite";

const STORAGE_KEY = "candy-boost-planner:design";
const DEFAULT_THEME = "blue";
const EXCLUDED = new Set(["base"]);

export default function themeCSS(): Plugin {
  let config: ResolvedConfig;
  // themeId → hashed asset filename (e.g. "blue" → "assets/blue-DrMzsgg2.css")
  const themeMap: Record<string, string> = {};

  return {
    name: "theme-css",
    apply: "build",

    configResolved(resolved) {
      config = resolved;
    },

    /**
     * After the bundle is generated, scan for CSS assets that correspond
     * to our themes and build the mapping.
     */
    generateBundle(_opts, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "asset" || !fileName.endsWith(".css")) continue;
        // fileName looks like "assets/blue-DrMzsgg2.css"
        const match = fileName.match(/\/([a-z]\w*)-[\w-]+\.css$/);
        if (match) {
          const id = match[1];
          if (!EXCLUDED.has(id)) {
            themeMap[id] = fileName;
          }
        }
      }
    },

    /**
     * Inject a blocking inline script into <head> that picks the right
     * theme CSS and inserts a <link rel="stylesheet"> before any module
     * scripts run.
     */
    transformIndexHtml() {
      if (Object.keys(themeMap).length === 0) return [];

      const base = config.base || "/";
      const mapJson = JSON.stringify(themeMap);

      // This script runs synchronously in <head>, before any deferred
      // module script. It uses document.write to inject a <link> directly
      // into the parser stream, which the browser treats as render-blocking
      // (just like a static <link> written in the HTML source).
      //
      // document.write is intentional here: createElement+appendChild
      // inserts the <link> *after* the parser has already seen it, so some
      // browsers (Chrome, Safari) treat it as non-blocking and may paint
      // unstyled content (FOUC). document.write feeds the tag into the
      // parser *during* parsing, guaranteeing render-blocking behavior.
      //
      // As an extra safety net, index.html sets body { visibility: hidden }
      // and reset.css (loaded by every theme) sets body { visibility: visible }.
      const inlineScript = `
(function(){
  var K="${STORAGE_KEY}",D="${DEFAULT_THEME}",B="${base}";
  var T=${mapJson};
  var s=localStorage.getItem(K)||D;
  var f=T[s]||T[D];
  if(f){
    document.write('<link rel="stylesheet" id="theme-css" href="'+B+f+'">');
  }
})();`.trim();

      return [
        {
          tag: "script",
          attrs: { id: "theme-loader" },
          children: inlineScript,
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
