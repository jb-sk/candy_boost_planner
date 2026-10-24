import { describe, expect, it } from "vitest";
import { build, type Plugin, type Rolldown } from "vite";

import { containsAstronomyRuntime } from "../../scripts/verify-runtime-bundle.mjs";
import { LEGACY_BROWSER_TARGET } from "../../vite.config";

const ENTRY_ID = "virtual:entry";

/** アプリのビルドと同じ圧縮・target で、ソース1つを固めた JS を返す。 */
async function bundle(source: string): Promise<string> {
  const entry: Plugin = {
    name: "entry",
    resolveId: id => (id === ENTRY_ID ? "\0" + ENTRY_ID : undefined),
    load: id => (id === "\0" + ENTRY_ID ? source : undefined),
  };
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [entry],
    build: {
      write: false,
      minify: true,
      target: LEGACY_BROWSER_TARGET,
      rolldownOptions: { input: ENTRY_ID },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  return outputs.flatMap(output => output.output)
    .map(chunk => (chunk.type === "chunk" ? chunk.code : ""))
    .join("\n");
}

describe("verify-runtime-bundle", () => {
  it("月齢の探索だけを固めた JS から astronomy-engine を見つける（KM_PER_AU は畳み込まれて残らない）", async () => {
    const code = await bundle(`
      import { SearchMoonPhase } from "astronomy-engine";
      console.log(SearchMoonPhase(180, new Date(0), 30));
    `);
    expect(containsAstronomyRuntime(code)).toBe(true);
  });

  it("KM_PER_AU を直接使う JS から astronomy-engine を見つける", async () => {
    const code = await bundle(`
      import { KM_PER_AU } from "astronomy-engine";
      console.log(KM_PER_AU);
    `);
    expect(containsAstronomyRuntime(code)).toBe(true);
  });

  it("esbuild の指数表記（14959787069098932e-8）の KM_PER_AU も見つける", () => {
    expect(containsAstronomyRuntime("const a=14959787069098932e-8;")).toBe(true);
  });

  it("識別子の一部の数字は KM_PER_AU と読まない", () => {
    expect(containsAstronomyRuntime("window.あ14959787069098932e-8;window.x14959787069098932e-8;")).toBe(false);
  });

  it("astronomy-engine を含まない JS は見つけない", async () => {
    const code = await bundle(`console.log(Math.round(29.530588 * 1000));`);
    expect(containsAstronomyRuntime(code)).toBe(false);
  });
});
