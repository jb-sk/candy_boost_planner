import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `sleepTargetMode` を文字列リテラルと比べない（`src/domain/sleep-target.ts` を除く）。
 *
 * モードの名前ではなく性質（`sleepTargetTraits`）で書く。文字列比較が1つ残ると、
 * モードを足したときにその比較だけ直し漏れる。`!== undefined` / `=== undefined` は保存形式の不変条件を
 * 見る式なので対象外。コメントの中の一致も拾う（古い書き方が説明文に残らないようにするため）。
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ALLOWED = join(ROOT, "src/domain/sleep-target.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(name) ? [path] : [];
  });
}

const LITERAL = String.raw`(["'\`])[A-Za-z]\w*\1`;
const OPERATOR = String.raw`[!=]==?`;
const PATTERNS = [
  // sleepTargetMode === "all" / r.sleepTargetMode !== 'stock'
  new RegExp(String.raw`\bsleepTargetMode\s*${OPERATOR}\s*${LITERAL}`),
  // "all" === sleepTargetMode
  new RegExp(String.raw`${LITERAL}\s*${OPERATOR}\s*[\w.?]*\bsleepTargetMode\b`),
];

describe("sleepTargetMode を文字列リテラルと比べない", () => {
  it("sleep-target.ts 以外の src に比較が無い", () => {
    const hits = sourceFiles(join(ROOT, "src"))
      .filter((file) => file !== ALLOWED)
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => PATTERNS.some((pattern) => pattern.test(line)))
          .map(({ line, index }) => `${relative(ROOT, file)}:${index + 1}: ${line.trim()}`),
      );
    expect(hits).toEqual([]);
  });

  it("検査の正規表現が典型的な書き方を拾う", () => {
    const samples = [
      'row.sleepTargetMode === "all"',
      "r.sleepTargetMode !== 'stock'",
      'sleepTargetMode==="nap"',
      '"all" === row.sleepTargetMode',
      "// 古い書き方: sleepTargetMode !== \"stock\"",
    ];
    for (const sample of samples) {
      expect(PATTERNS.some((pattern) => pattern.test(sample)), sample).toBe(true);
    }
    for (const ok of ["row.sleepTargetMode !== undefined", "sleepTargetMode === undefined", "sleepTargetMode: row.sleepTargetMode,"]) {
      expect(PATTERNS.some((pattern) => pattern.test(ok)), ok).toBe(false);
    }
  });
});
