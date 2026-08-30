import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `auto-update-events.yml` は npm script 名とテストファイルのパスを**文字列で**参照している。
 * 名前を変えても手元のテストは全部通るので、**壊れたことに気づけるのはCIが走った翌日**になる
 * （しかも英語名の取得ステップは `continue-on-error` なので、赤くならず静かに機能だけ止まる）。
 *
 * ここでは「ワークフローが呼ぶものが実在するか」だけを見る。
 * ステップの並びも実装も見ないので、ワークフローの中身を組み替えても壊れない。
 */
const WORKFLOW_PATH = fileURLToPath(new URL("../../.github/workflows/auto-update-events.yml", import.meta.url));
const ROOT = new URL("../../", import.meta.url);
const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("package.json", ROOT)), "utf8")) as {
  scripts: Record<string, string>;
};

describe("auto-update-events workflow references", () => {
  it("only calls npm scripts that exist", () => {
    const called = [...workflow.matchAll(/pnpm run ([\w:-]+)/g)].map(match => match[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const script of called) {
      expect(Object.keys(packageJson.scripts), script).toContain(script);
    }
  });

  it("still drives the English-name steps through generate and check scripts", () => {
    // 英語名の取得は「未解決がある日だけ」動く。この2本のどちらかが外れると、
    // 毎日取りに行くか、二度と取りに行かないかのどちらかへ倒れる（設計書 §21.7）。
    expect(workflow).toContain("pnpm run check:event-names-en");
    expect(workflow).toContain("pnpm run generate:event-names-en");
  });

  it("only runs unit test files that exist", () => {
    const referenced = [...workflow.matchAll(/(tests\/unit\/[\w/-]+\.test\.ts)/g)].map(match => match[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(existsSync(fileURLToPath(new URL(file, ROOT))), file).toBe(true);
    }
  });

  it("watches both generated files for changes", () => {
    // 片方だけだと「英語名しか変わらなかった日」にPRが出ない（設計書 §21.7）。
    const diffSteps = workflow.split("\n").filter(line => line.includes("git diff"));
    expect(diffSteps.length).toBeGreaterThan(0);
    for (const line of diffSteps) {
      expect(line).toContain("src/domain/pokesleep/_generated/sleep-exp-events.ts");
      expect(line).toContain("src/i18n/_generated/event-name-en.ts");
    }
  });

  it("keeps the English-name generation from failing the job", () => {
    // 表示都合のソースが壊れただけで、計算データの自動更新PRまで止めない（設計書 §21.7）。
    const step = workflow.slice(workflow.indexOf("Generate English event names"));
    expect(step.slice(0, step.indexOf("- name:", 1))).toContain("continue-on-error: true");
  });
});
