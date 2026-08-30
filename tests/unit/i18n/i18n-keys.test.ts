import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../../../src/i18n/en";
import { ja } from "../../../src/i18n/ja";

/**
 * i18n キーの整合性。**画面を開かずに壊れたことが分かる唯一の網**なので、
 * リファクタでキー名を動かしたときはここが落ちる。
 *
 * - キーを消し忘れる → 未使用キーとして落ちる
 * - キーを消したのに参照が残る → 欠落キーとして落ちる（画面には生のキー文字列が出る）
 * - 片方のロケールだけ直す → 構造不一致として落ちる
 */

const SRC = fileURLToPath(new URL("../../../src", import.meta.url));
const I18N_DIR = path.join(SRC, "i18n");

/**
 * 実行時にコードから組み立てるキーの親。`t(\`backup.warning.${code}\`)` のように
 * 呼ばれるので、子キーは文字列リテラルとしてソースに現れない。
 */
const DYNAMIC_KEY_PARENTS = ["backup.migrationNotice", "backup.warning"] as const;

/** i18n キーとして扱う文字列リテラルの形。`calc.row.srcLevel` のようなドット区切り。 */
const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+$/;

function leafKeyPaths(messages: object, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null ? leafKeyPaths(value, full) : [full];
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return full === I18N_DIR ? [] : sourceFiles(full);
    return /\.(ts|vue)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * キーの形をした文字列リテラル。**未使用キーの検出にだけ**使う。
 *
 * `.vue` のテンプレート式（`@click="box.onDeleteSelected"` など）まで拾ってしまうが、
 * 「参照されている」側を広めに取るぶんには未使用を見逃す方向にしか外れない。
 *
 * 引用符の種類ごとに別々に走査する。1本の正規表現でまとめると
 * `:title="t('calc.export.open')"` のような入れ子で外側の `"` に食われ、
 * 中の `'...'` を拾えない。
 */
function keyShapedLiterals(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const quote of ['"', "'", "`"]) {
      const literals = new RegExp(`${quote}([^${quote}\\n]*)${quote}`, "g");
      for (const [, literal] of source.matchAll(literals)) {
        if (KEY_SHAPE.test(literal)) found.add(literal);
      }
    }
  }
  return found;
}

/**
 * 実際に翻訳キーとして渡している文字列。**欠落キーの検出**に使うので、
 * テンプレート式を巻き込まないよう `t(...)` の第1引数だけに絞る。
 * `${}` を含む動的キーは中身が定数でないので拾わない（`DYNAMIC_KEY_PARENTS` で守る）。
 */
function translatedKeys(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const [, key] of source.matchAll(/\bt\(\s*["'`]([^"'`\n]*)["'`]/g)) {
      if (KEY_SHAPE.test(key)) found.add(key);
    }
  }
  return found;
}

const jaKeys = leafKeyPaths(ja);
const enKeys = leafKeyPaths(en);

describe("i18n keys", () => {
  it("keeps ja and en on the same key structure", () => {
    expect([...jaKeys].sort()).toEqual([...enKeys].sort());
  });

  it("defines every key passed to t()", () => {
    const defined = new Set(jaKeys);
    const missing = [...translatedKeys()]
      .filter(key => !defined.has(key))
      // 動的キーの親そのものを渡している箇所（プレフィックス）は欠落ではない。
      .filter(key => !DYNAMIC_KEY_PARENTS.some(parent => key === parent || key.startsWith(`${parent}.`)));

    expect(missing).toEqual([]);
  });

  it("keeps no unused key", () => {
    const referenced = keyShapedLiterals();
    const unused = jaKeys
      .filter(key => !referenced.has(key))
      .filter(key => !DYNAMIC_KEY_PARENTS.some(parent => key.startsWith(`${parent}.`)));

    expect(unused).toEqual([]);
  });
});

/**
 * 設定画面の単位。**選択肢の文字列へ埋め込まず別要素で出す**方針なので、
 * 単数形の分岐を持たない（英語で `1` を選ぶと `1 days` になるのは承知の上）。
 * e2e は「単位が別要素で出るか」を見る。**訳語そのもの**が変わったことは画面を開かずに
 * 分かるべきなので、こちらで固定する。
 */
describe("設定の単位", () => {
  it("keeps the settings unit wording on both locales", () => {
    expect(ja.calc.sleep.sleepExpBonusUnit).toBe("匹");
    expect(en.calc.sleep.sleepExpBonusUnit).toBe("Pokémon");
    expect(ja.calc.sleep.blueSeedIncenseUnit).toBe("日");
    expect(en.calc.sleep.blueSeedIncenseUnit).toBe("days");
  });
});
