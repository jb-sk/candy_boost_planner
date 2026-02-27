/**
 * Vite plugin — static theme CSS loading.
 *
 * In production builds:
 *  1. Each src/styles/<id>.css is emitted as a standalone CSS asset.
 *  2. A tiny inline script is injected into index.html <head> that reads
 *     the user's theme from localStorage and inserts a blocking <link>.
 *
 * This eliminates FOUC because the browser loads the CSS synchronously
 * before any JS executes or DOM is painted.
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
        const match = fileName.match(/\/([a-z][\w-]*)-\w+\.css$/);
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
      // module script. It inserts a <link> for the chosen theme CSS.
      const inlineScript = `
(function(){
  var K="${STORAGE_KEY}",D="${DEFAULT_THEME}",B="${base}";
  var T=${mapJson};
  var s=localStorage.getItem(K)||D;
  var f=T[s]||T[D];
  if(f){
    var l=document.createElement("link");
    l.rel="stylesheet";l.id="theme-css";l.href=B+f;
    document.head.appendChild(l);
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
