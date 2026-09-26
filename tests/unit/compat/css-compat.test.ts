import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 古い端末（vite.config.ts の build.target: iOS 11.3・Chrome 64 など）で効かない CSS を使っていないか。
 * ビルドは CSS をこの範囲へ変換しきれず（inset・min() などはそのまま出力される）、ESLint も CSS を見ないので、ここで止める。
 * 使いたいときは、対応開始の版を確かめて古い書き方に置き換えること（例: inset → top/right/bottom/left、
 * min(a, b) → width: a; max-width: b、:has() → テンプレートで付けるクラス）。
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

const FILES = [...cssFiles(join(ROOT, "src/styles")), ...cssFiles(join(ROOT, "src/components"))];

/** コメントを除いた CSS。説明文に書いた名前（「:has() は使わない」など）を拾わないため。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const BANNED: { name: string; pattern: RegExp; since: string }[] = [
  { name: ":has()", pattern: /:has\(/, since: "iOS 15.4・Chrome 105" },
  { name: "inset", pattern: /(^|[;{\s])inset\s*:/, since: "iOS 14.5・Chrome 87" },
  { name: "論理プロパティ（*-inline / *-block）", pattern: /(^|[;{\s])(margin|padding|border|inset)-(inline|block)(-start|-end)?\s*:/, since: "iOS 14.5・Chrome 87" },
  { name: "min() / max() / clamp()", pattern: /:[^;{}]*(?<![\w-])(min|max|clamp)\(/, since: "iOS 11.3〜13.4・Chrome 79" },
  { name: "color-mix()", pattern: /color-mix\(/, since: "iOS 16.2・Chrome 111" },
  { name: "dvh / svh / lvh", pattern: /\d(dvh|svh|lvh)\b/, since: "iOS 15.4・Chrome 108" },
  { name: "@container", pattern: /@container/, since: "iOS 16・Chrome 105" },
  { name: "lh 単位", pattern: /\d+(\.\d+)?lh\b/, since: "iOS 16.4・Chrome 109" },
  // `underline 2px` / `underline dotted` などの1行まとめは、古い Safari では宣言ごと無効になり下線が消える。
  // text-decoration には線の種類（underline / none など）だけを書き、太さ・色・種類は別の行へ分ける
  { name: "text-decoration の1行まとめ（線の種類以外の値）", pattern: /(^|[;{\s])text-decoration\s*:\s*[\w-]+\s+[^;!]/, since: "iOS 12.2（それより前は線の種類のみ）" },
];

describe("古い端末で効かない CSS を使わない", () => {
  it.each(BANNED)("$name（$since から）", ({ pattern }) => {
    const hits = FILES.flatMap((file) =>
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .filter((line) => pattern.test(line))
        .map((line) => `${relative(ROOT, file)}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("appearance は -webkit-appearance と並べる（接頭辞なしは iOS 15.4 から）", () => {
    const hits = FILES.flatMap((file) => {
      const rules = stripComments(readFileSync(file, "utf8")).match(/[^{}]+\{[^{}]*\}/g) ?? [];
      return rules
        .filter((rule) => /(^|[;{\s])appearance\s*:/.test(rule) && !/-webkit-appearance\s*:/.test(rule))
        .map((rule) => `${relative(ROOT, file)}: ${rule.split("{")[0]!.trim()}`);
    });
    expect(hits).toEqual([]);
  });

  it("text-decoration-color / -style は -webkit- 付きと並べる（接頭辞なしは iOS 12.2 から）", () => {
    const hits = FILES.flatMap((file) => {
      const rules = stripComments(readFileSync(file, "utf8")).match(/[^{}]+\{[^{}]*\}/g) ?? [];
      return rules
        .filter((rule) => ["color", "style"].some((part) =>
          new RegExp(`(^|[;{\\s])text-decoration-${part}\\s*:`).test(rule) && !new RegExp(`-webkit-text-decoration-${part}\\s*:`).test(rule)))
        .map((rule) => `${relative(ROOT, file)}: ${rule.split("{")[0]!.trim()}`);
    });
    expect(hits).toEqual([]);
  });

  it(":focus-visible を使わないセレクタと同じ規則に並べない（効かない端末では規則ごと無視される）", () => {
    const hits = FILES.flatMap((file) => {
      const selectors = stripComments(readFileSync(file, "utf8")).match(/[^{}]+(?=\{)/g) ?? [];
      return selectors
        .filter((selector) => {
          const parts = selector.split(",");
          return parts.some((part) => part.includes(":focus-visible")) && parts.some((part) => !part.includes(":focus-visible"));
        })
        .map((selector) => `${relative(ROOT, file)}: ${selector.trim()}`);
    });
    expect(hits).toEqual([]);
  });
});
