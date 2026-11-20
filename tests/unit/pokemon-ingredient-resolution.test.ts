import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { checkIngredientLabels } from "../../scripts/check-ingredient-labels.mjs";
import {
  acquirePublishLocks,
  publishFilesWithRollback,
  stageExplicitDbSnapshot,
} from "../../scripts/generate-master.mjs";
import {
  encodeIdForm,
  sanitizeSingleLineComment,
  validatePokemonDbPayload,
} from "../../scripts/pokemon-db-validation.mjs";
import { splitPokemonNameAndForm } from "../../scripts/pokemon-form-resolution.mjs";
import {
  KNOWN_INGREDIENT_KEYS,
  assertNoIngredientMappingIssues,
  buildIngredientsNullSet,
  collectIngredientMappingIssues,
  ingredientKeyFromWikiJa,
  isIngredientsNullPokemon,
  normalizeIngredientLabel,
  resolveIngredientSlot,
} from "../../scripts/pokemon-ingredient-resolution.mjs";

const ROOT = new URL("../../", import.meta.url);
const ROOT_DIR = fileURLToPath(ROOT);

function copyIsolatedMasterConfigs(dir: string) {
  const files = {
    known: path.join(dir, "exp-type-known.json"),
    overrides: path.join(dir, "exp-type-overrides.json"),
    ingCNullKnown: path.join(dir, "ing-c-null-known.json"),
    formJaToNumber: path.join(dir, "form-ja-to-number.json"),
    formLabelJaToEn: path.join(dir, "form-label-ja-to-en.json"),
    formAliases: path.join(dir, "form-aliases.json"),
  };
  fs.copyFileSync(path.join(ROOT_DIR, "scripts/exp-type-known.json"), files.known);
  fs.copyFileSync(path.join(ROOT_DIR, "scripts/exp-type-overrides.json"), files.overrides);
  fs.copyFileSync(path.join(ROOT_DIR, "scripts/ing-c-null-known.json"), files.ingCNullKnown);
  fs.copyFileSync(path.join(ROOT_DIR, "scripts/form-ja-to-number.json"), files.formJaToNumber);
  fs.copyFileSync(path.join(ROOT_DIR, "scripts/form-label-ja-to-en.json"), files.formLabelJaToEn);
  fs.copyFileSync(path.join(ROOT_DIR, "scripts/form-aliases.json"), files.formAliases);
  return {
    files,
    args: [
      "--known",
      files.known,
      "--overrides",
      files.overrides,
      "--ing-c-null-known",
      files.ingCNullKnown,
      "--form-ja-to-number",
      files.formJaToNumber,
      "--form-label-ja-to-en",
      files.formLabelJaToEn,
      "--form-aliases",
      files.formAliases,
    ],
  };
}

describe("pokemon ingredient resolution", () => {
  it("新食材「ひとくちナッツ」を含む既知食材を完全一致で変換し、部分一致や特殊アイテム部分一致の誤マッチを防ぐ", () => {
    expect(ingredientKeyFromWikiJa("ひとくちナッツ")).toBe("nuts");
    expect(ingredientKeyFromWikiJa("つやつやアボカド")).toBe("avocado");
    expect(ingredientKeyFromWikiJa("ずっしりカボチャ")).toBe("pumpkin");
    expect(ingredientKeyFromWikiJa("マメミート")).toBe("sausage");
    expect(ingredientKeyFromWikiJa("ピーナッツ")).toBeNull();
    expect(ingredientKeyFromWikiJa("焼きリンゴ")).toBeNull();
    expect(ingredientKeyFromWikiJa("spacer.gif")).toBeNull();
    expect(ingredientKeyFromWikiJa("ひらめきのたね.png")).toBeNull();
    expect(normalizeIngredientLabel("ひとくちナッツ.png")).toBe("ひとくちナッツ");
    // 特殊アイテム名を含むだけの未知文字列は空扱いしない
    expect(normalizeIngredientLabel("ひらめきのたねとナッツ")).toBe("ひらめきのたねとナッツ");
    expect(ingredientKeyFromWikiJa("ひらめきのたねとナッツ")).toBeNull();
  });

  it("スロット内の全要素・型を検査し、非配列やプレースホルダー後の未知食材・複数候補を検出する", () => {
    expect(resolveIngredientSlot("なぞのスパイス").status).toBe("invalid_type");
    expect(resolveIngredientSlot([123]).status).toBe("invalid_type");
    expect(resolveIngredientSlot(["ひらめきのたねとナッツ"])).toEqual({
      status: "unknown",
      key: null,
      labels: ["ひらめきのたねとナッツ"],
      unknownLabels: ["ひらめきのたねとナッツ"],
      matchedKeys: [],
    });
    expect(resolveIngredientSlot(["spacer.gif", "なぞのスパイス"])).toEqual({
      status: "unknown",
      key: null,
      labels: ["なぞのスパイス"],
      unknownLabels: ["なぞのスパイス"],
      matchedKeys: [],
    });
    expect(resolveIngredientSlot(["ひとくちナッツ", "あんみんトマト"])).toEqual({
      status: "ambiguous",
      key: null,
      labels: ["ひとくちナッツ", "あんみんトマト"],
      unknownLabels: [],
      matchedKeys: ["nuts", "tomato"],
    });
    expect(resolveIngredientSlot(["spacer.gif", "あんみんトマト"])).toEqual({
      status: "ok",
      key: "tomato",
      labels: ["あんみんトマト"],
      unknownLabels: [],
      matchedKeys: ["tomato"],
    });
  });

  it("A/B/C の未知食材・複数候補・不正型を検出し生成を中断する", () => {
    const items = [
      {
        dexNo: 546,
        nameJa: "モンメン",
        ingAJa: ["ピーナッツ"],
        ingBJa: ["つやつやアボカド"],
        ingCJa: ["あんみんトマト"],
      },
      {
        dexNo: 547,
        nameJa: "エルフーン",
        ingAJa: ["ひとくちナッツ"],
        ingBJa: ["つやつやアボカド"],
        ingCJa: ["ひらめきのたねとナッツ"],
      },
      {
        dexNo: 557,
        nameJa: "イシズマイ",
        ingAJa: ["つやつやアボカド"],
        ingBJa: ["ほっこりポテト", "あんみんトマト"],
        ingCJa: "なぞのスパイス",
      },
    ];

    const result = collectIngredientMappingIssues(items, {});
    expect([...result.unknownLabels.keys()].sort()).toEqual(["ひらめきのたねとナッツ", "ピーナッツ"]);
    expect(result.ambiguousSlots).toHaveLength(1);
    expect(result.invalidSlots).toHaveLength(1);
    expect(result.invalidSlots[0]?.slot).toBe("C");
    expect(() => assertNoIngredientMappingIssues(items, {})).toThrow(/未知食材.*不正型.*複数候補/);
  });

  it("一般ポケモンの食材A/B欠損は中断し、食材C未実装と ing-null-known.json の幻ポケモンは許容する", () => {
    const nullSet = buildIngredientsNullSet([151, 491, "493:0"]);
    const validItems = [
      {
        dexNo: 52,
        nameJa: "ニャース",
        ingAJa: ["モーモーミルク"],
        ingBJa: ["あまいミツ"],
        ingCJa: ["spacer.gif"],
      },
      {
        dexNo: 151,
        nameJa: "ミュウ",
        ingAJa: ["ひらめきのたね"],
        ingBJa: null,
        ingCJa: null,
      },
      {
        dexNo: 491,
        nameJa: "ダークライ",
        ingAJa: null,
        ingBJa: null,
        ingCJa: null,
      },
      {
        dexNo: 493,
        nameJa: "アルセウス",
        ingAJa: null,
        ingBJa: null,
        ingCJa: null,
      },
    ];

    expect(isIngredientsNullPokemon(151, 0, nullSet)).toBe(true);
    expect(isIngredientsNullPokemon(491, 0, nullSet)).toBe(true);
    expect(isIngredientsNullPokemon(493, 0, nullSet)).toBe(true);
    expect(() => assertNoIngredientMappingIssues(validItems, {}, nullSet)).not.toThrow();

    const missingBItems = [
      {
        dexNo: 546,
        nameJa: "モンメン",
        ingAJa: ["ひとくちナッツ"],
        ingBJa: null,
        ingCJa: ["あんみんトマト"],
      },
    ];
    expect(() => assertNoIngredientMappingIssues(missingBItems, {}, nullSet)).toThrow(/食材A\/B未記載: #546 モンメン/);
  });

  it("リポジトリ実データの Wiki・変換ルール・マスター・UIラベルがすべて整合している", () => {
    const namesTs = fs.readFileSync(fileURLToPath(new URL("src/domain/pokesleep/pokemon-names.ts", ROOT)), "utf8");
    const boxTs = fs.readFileSync(fileURLToPath(new URL("src/composables/useBoxStore.ts", ROOT)), "utf8");
    const dbJson = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL("src/domain/pokesleep/_generated/pokemon-db.json", ROOT)), "utf8"),
    ) as { items: unknown[] };
    const formJaToNumber = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL("scripts/form-ja-to-number.json", ROOT)), "utf8"),
    ) as Record<string, number>;

    const result = checkIngredientLabels({
      namesTs,
      boxTs,
      dbItems: dbJson.items as Array<{ dexNo?: unknown }>,
      formJaToNumber,
      requireNonEmptyDb: true,
    });

    expect(result.hasProblem, result.text).toBe(false);
    expect(result.knownRuleKeys.size).toBe(KNOWN_INGREDIENT_KEYS.length);
    expect(result.masterKeys.has("nuts")).toBe(true);
    expect(result.jaKeys.has("nuts")).toBe(true);
    expect(result.enKeys.has("nuts")).toBe(true);
  });

  it("不正・空の pokemon-db を共通バリデータと CLI の両方で拒否する", () => {
    expect(() => validatePokemonDbPayload({ items: null })).toThrow(/配列ではありません/);
    expect(() => validatePokemonDbPayload({ items: [] })).toThrow(/空です/);
    expect(() => validatePokemonDbPayload({ items: [{ dexNo: 546, nameJa: "" }] })).toThrow(/nameJa/);
    expect(() =>
      validatePokemonDbPayload({ items: [{ dexNo: 546, nameJa: "モンメン", ingCJa: "なぞのスパイス" }] }),
    ).toThrow(/ingCJa/);

    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-invalid-db-"));
    try {
      const badPath = path.join(tmp, "bad-db.json");
      fs.writeFileSync(badPath, JSON.stringify({ items: null }), "utf8");

      let masterExit = 0;
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
            "--non-interactive",
            "--dry-run",
            "--db",
            badPath,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        masterExit = (err as { status?: number }).status ?? 1;
      }
      expect(masterExit).not.toBe(0);

      let labelExit = 0;
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/check-ingredient-labels.mjs"),
            "--fail-on-gap",
            "--db",
            badPath,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        labelExit = (err as { status?: number }).status ?? 1;
      }
      expect(labelExit).not.toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("日本語だけ余分なキーがあるときに OK と要確認を併記せず、Wiki生データの未知食材も要対応にする", () => {
    const namesTs = fs.readFileSync(fileURLToPath(new URL("src/domain/pokesleep/pokemon-names.ts", ROOT)), "utf8");
    const boxTs = fs.readFileSync(fileURLToPath(new URL("src/composables/useBoxStore.ts", ROOT)), "utf8");

    const unknownWikiResult = checkIngredientLabels({
      namesTs,
      boxTs,
      dbItems: [
        {
          dexNo: 999,
          nameJa: "テストポケモン",
          ingAJa: ["しんきしょくざい"],
          ingBJa: ["つやつやアボカド"],
          ingCJa: ["あんみんトマト"],
        },
      ],
      formJaToNumber: {},
    });
    expect(unknownWikiResult.hasProblem).toBe(true);
    expect(unknownWikiResult.text).toContain("しんきしょくざい");
    expect(unknownWikiResult.text).not.toContain("OK ");

    const extraJaBoxTs = boxTs.replace(
      'nuts: "ナッツ",',
      'nuts: "ナッツ",\n    extraOnlyJa: "余分な食材",',
    );
    const result = checkIngredientLabels({
      namesTs,
      boxTs: extraJaBoxTs,
      dbItems: [],
      formJaToNumber: {},
    });

    expect(result.hasProblem).toBe(true);
    expect(result.jaOnly).toContain("extraOnlyJa");
    expect(result.text).toContain("要確認 ingredientJa と ingredientEn のキー集合が一致しません。");
    expect(result.text).not.toContain("OK ");

    // 空文字・空白のみ・非文字列リテラルのラベルは hasProblem=true として拒否する
    for (const [desc, replacement] of [
      ["empty", 'nuts: "",'],
      ["spaces", 'nuts: "   \\u3000",'],
      ["non-literal", "nuts: String(123),"],
    ] as const) {
      const brokenBoxTs = boxTs.replace('nuts: "ナッツ",', replacement);
      const brokenResult = checkIngredientLabels({
        namesTs,
        boxTs: brokenBoxTs,
        dbItems: [],
        formJaToNumber: {},
      });
      expect(brokenResult.hasProblem, desc).toBe(true);
      expect(brokenResult.invalidJa.some((x) => x.key === "nuts"), desc).toBe(true);
      expect(brokenResult.text, desc).not.toContain("OK ");
    }
  });

  it("既存ポケモンの食材変更は has_changes=true になり、同一 idForm の重複行矛盾は停止する", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-master-test-"));
    try {
      const dbPath = path.join(ROOT_DIR, "src/domain/pokesleep/_generated/pokemon-db.json");
      const db = JSON.parse(fs.readFileSync(dbPath, "utf8")) as {
        source?: string;
        items: Array<{ dexNo: number; nameJa: string; ingAJa?: string[] | null; ingCJa?: string[] | null }>;
      };

      // 1. 既存 #546 の C だけ変更 → has_changes=true
      const mutated = structuredClone(db);
      const cottonee = mutated.items.find((x) => x.dexNo === 546);
      expect(cottonee).toBeDefined();
      cottonee!.ingCJa = ["リラックスカカオ"];
      const mutatedPath = path.join(tmp, "mutated-db.json");
      fs.writeFileSync(mutatedPath, JSON.stringify(mutated, null, 2), "utf8");

      const output = execFileSync(
        process.execPath,
        [
          path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
          "--non-interactive",
          "--dry-run",
          "--db",
          mutatedPath,
        ],
        { encoding: "utf8" },
      );
      expect(output).toMatch(/\[SUMMARY\] has_changes=true/);
      expect(output).toContain("pokemon-master.ts");
      expect(output).toContain("pokemon-names.ts");

      // 2. イーブイ(ハロウィン) 2行のうち片方だけ A をミルクに変更 → 重複矛盾で即停止
      const conflicted = structuredClone(db);
      const halloweenEevees = conflicted.items.filter(
        (x) => x.dexNo === 133 && x.nameJa === "イーブイ(ハロウィン)",
      );
      expect(halloweenEevees.length).toBe(2);
      halloweenEevees[1]!.ingAJa = ["モーモーミルク"];
      const conflictedPath = path.join(tmp, "conflicted-db.json");
      fs.writeFileSync(conflictedPath, JSON.stringify(conflicted, null, 2), "utf8");

      let conflictExit = 0;
      let conflictStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
            "--non-interactive",
            "--dry-run",
            "--db",
            conflictedPath,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        conflictExit = e.status ?? 1;
        conflictStderr = e.stderr ?? "";
      }
      expect(conflictExit).not.toBe(0);
      expect(conflictStderr).toContain("同一 idForm の重複 Wiki 行でフィールドが食い違っています");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("publishFilesWithRollback は準備中ENOSPC・容量不足継続下でのrename失敗・復元失敗時バックアップ保全を正しく扱う", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-rollback-"));
    try {
      const srcA = path.join(tmp, "srcA.txt");
      const srcB = path.join(tmp, "srcB.txt");
      const destA = path.join(tmp, "destA.txt");
      const destB = path.join(tmp, "destB.txt");
      fs.writeFileSync(srcA, "new-A", "utf8");
      fs.writeFileSync(srcB, "new-B", "utf8");
      fs.writeFileSync(destA, "old-A", "utf8");
      fs.writeFileSync(destB, "old-B", "utf8");

      // ケース1: Phase A（事前準備）で2件目以降すべて ENOSPC になっても公開先は無傷で一時ファイルも残らない
      let prepareWrites = 0;
      expect(() =>
        publishFilesWithRollback(
          [
            { src: srcA, dest: destA },
            { src: srcB, dest: destB },
          ],
          {
            writeFile: (p, data) => {
              prepareWrites++;
              if (prepareWrites >= 3) {
                fs.writeFileSync(p, "partial-B", "utf8");
                throw new Error("ENOSPC: no space left on device");
              }
              fs.writeFileSync(p, data, "utf8");
            },
          },
        ),
      ).toThrow("ENOSPC: no space left on device");

      expect(fs.readFileSync(destA, "utf8")).toBe("old-A");
      expect(fs.readFileSync(destB, "utf8")).toBe("old-B");
      expect(fs.readdirSync(tmp).filter((f) => f.includes(".tmp-") || f.includes(".bak-"))).toEqual([]);

      // ケース2: 1件目置換後に容量不足が継続（以降の writeFile は全滅）した状態で2件目の rename が失敗しても、
      // 確保済みバックアップの rename のみで書き込みゼロのまま全ファイルを復元できる
      let phaseAWrites = 0;
      let commitRenames = 0;
      let rollbackWritesAttempted = 0;
      expect(() =>
        publishFilesWithRollback(
          [
            { src: srcA, dest: destA },
            { src: srcB, dest: destB },
          ],
          {
            writeFile: (p, data) => {
              phaseAWrites++;
              if (phaseAWrites > 4) {
                rollbackWritesAttempted++;
                throw new Error("ENOSPC: persistent out of space");
              }
              fs.writeFileSync(p, data, "utf8");
            },
            renameFile: (src, dest) => {
              commitRenames++;
              if (commitRenames === 2) {
                fs.writeFileSync(dest, "corrupted-partial-B", "utf8");
                throw new Error("simulated rename failure under ENOSPC");
              }
              fs.renameSync(src, dest);
            },
          },
        ),
      ).toThrow("simulated rename failure under ENOSPC");

      expect(rollbackWritesAttempted).toBe(0);
      expect(fs.readFileSync(destA, "utf8")).toBe("old-A");
      expect(fs.readFileSync(destB, "utf8")).toBe("old-B");
      expect(fs.readdirSync(tmp).filter((f) => f.includes(".tmp-") || f.includes(".bak-"))).toEqual([]);

      // ケース3: ロールバック自体の rename に失敗した場合は手動復旧用バックアップを残す
      let case3Renames = 0;
      expect(() =>
        publishFilesWithRollback(
          [
            { src: srcA, dest: destA },
            { src: srcB, dest: destB },
          ],
          {
            renameFile: (src, dest) => {
              case3Renames++;
              if (case3Renames === 2) {
                throw new Error("simulated second rename error");
              }
              fs.renameSync(src, dest);
            },
            rollbackRenameFile: (src, dest) => {
              if (dest === destA) {
                throw new Error("simulated rollback rename error for A");
              }
              fs.renameSync(src, dest);
            },
          },
        ),
      ).toThrow("simulated second rename error");

      expect(fs.readFileSync(destB, "utf8")).toBe("old-B");
      expect(fs.readdirSync(tmp).filter((f) => f.includes(".tmp-"))).toEqual([]);
      const preservedBaks = fs.readdirSync(tmp).filter((f) => f.includes(".bak-"));
      expect(preservedBaks).toHaveLength(1);
      expect(fs.readFileSync(path.join(tmp, preservedBaks[0]!), "utf8")).toBe("old-A");
      expect(fs.readdirSync(tmp).filter((f) => f.endsWith(".publish.lock"))).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("publishFilesWithRollback は同時更新の割り込みを排他し、失敗した更新が別更新を巻き戻すのを防ぎ、ベースライン外部変更も拒否する", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-concurrent-"));
    try {
      const dir1 = path.join(tmp, "dir1");
      const dir2 = path.join(tmp, "dir2");
      const dir3 = path.join(tmp, "dir3");
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });
      fs.mkdirSync(dir3, { recursive: true });

      const destA = path.join(dir1, "db.ts");
      const destB = path.join(dir2, "index.ts");
      const destC = path.join(dir3, "candy.ts");
      fs.writeFileSync(destA, "old-A", "utf8");
      fs.writeFileSync(destB, "old-B", "utf8");
      fs.writeFileSync(destC, "old-C", "utf8");

      const srcA1 = path.join(tmp, "srcA1.ts");
      const srcB1 = path.join(tmp, "srcB1.ts");
      const srcA2 = path.join(tmp, "srcA2.ts");
      const srcB2 = path.join(tmp, "srcB2.ts");
      const srcC2 = path.join(tmp, "srcC2.ts");
      fs.writeFileSync(srcA1, "updateA-db", "utf8");
      fs.writeFileSync(srcB1, "updateA-index", "utf8");
      fs.writeFileSync(srcA2, "updateB-db", "utf8");
      fs.writeFileSync(srcB2, "updateB-index", "utf8");
      fs.writeFileSync(srcC2, "updateB-candy", "utf8");

      // 更新 A が destA を置換した直後に、重複サブセット [destA, destB, destC] で更新 B が割り込もうとする
      let bError: Error | null = null;
      let renameCalls = 0;
      expect(() =>
        publishFilesWithRollback(
          [
            { src: srcA1, dest: destA },
            { src: srcB1, dest: destB },
          ],
          {
            renameFile: (src, dest) => {
              renameCalls++;
              if (renameCalls === 1) {
                fs.renameSync(src, dest);
                // 割り込み更新 B はロック衝突で即座に失敗し、自身の部分ロックも掃除する
                try {
                  publishFilesWithRollback([
                    { src: srcA2, dest: destA },
                    { src: srcB2, dest: destB },
                    { src: srcC2, dest: destC },
                  ]);
                } catch (err) {
                  bError = err as Error;
                }
                return;
              }
              throw new Error("update A failed on index");
            },
          },
        ),
      ).toThrow("update A failed on index");

      expect(bError).not.toBeNull();
      expect(bError!.message).toContain("公開ロック取得に失敗");
      // A のロールバック後も新旧混在せず、3ファイルすべて元の内容で、ロック残存もゼロ
      expect(fs.readFileSync(destA, "utf8")).toBe("old-A");
      expect(fs.readFileSync(destB, "utf8")).toBe("old-B");
      expect(fs.readFileSync(destC, "utf8")).toBe("old-C");
      for (const d of [dir1, dir2, dir3]) {
        expect(fs.readdirSync(d).filter((f) => f.includes(".publish.lock") || f.includes(".tmp-") || f.includes(".bak-"))).toEqual([]);
      }

      // 公開前に比較元（ベースライン）が外部変更されていた場合は1件も書き換えずに中断する
      const staleBaseline = new Map<string, string | null>([
        [destA, "different-baseline"],
        [destB, "old-B"],
      ]);
      expect(() =>
        publishFilesWithRollback(
          [
            { src: srcA2, dest: destA },
            { src: srcB2, dest: destB },
          ],
          { expectedBaseline: staleBaseline },
        ),
      ).toThrow("外部変更");
      expect(fs.readFileSync(destA, "utf8")).toBe("old-A");
      expect(fs.readFileSync(destB, "utf8")).toBe("old-B");

      // A の完了後であれば B の公開は正常に成功する
      const updated = publishFilesWithRollback([
        { src: srcA2, dest: destA },
        { src: srcB2, dest: destB },
        { src: srcC2, dest: destC },
      ]);
      expect(updated).toEqual([destA, destB, destC]);
      expect(fs.readFileSync(destA, "utf8")).toBe("updateB-db");
      expect(fs.readFileSync(destB, "utf8")).toBe("updateB-index");
      expect(fs.readFileSync(destC, "utf8")).toBe("updateB-candy");

      // Phase A（一時ファイル/バックアップ準備中）にロック外の外部編集が入っても、最初の置換直前の再検証で検出し上書きしない
      const baselineBeforePhaseA = new Map<string, string | null>([
        [destA, "updateB-db"],
        [destB, "updateB-index"],
      ]);
      let phaseACall = 0;
      let phaseBRenames = 0;
      expect(() =>
        publishFilesWithRollback(
          [
            { src: srcA1, dest: destA },
            { src: srcB1, dest: destB },
          ],
          {
            expectedBaseline: baselineBeforePhaseA,
            writeFile: (p, data) => {
              phaseACall++;
              fs.writeFileSync(p, data, "utf8");
              if (phaseACall === 2) {
                // Phase A の途中で外部プロセス/手動編集が destA を変更
                fs.writeFileSync(destA, "manual-edit-during-prepare", "utf8");
              }
            },
            renameFile: (src, dest) => {
              phaseBRenames++;
              fs.renameSync(src, dest);
            },
          },
        ),
      ).toThrow("公開準備中に公開対象ファイルが外部変更");
      expect(phaseBRenames).toBe(0);
      expect(fs.readFileSync(destA, "utf8")).toBe("manual-edit-during-prepare");
      expect(fs.readFileSync(destB, "utf8")).toBe("updateB-index");
      for (const d of [dir1, dir2, dir3]) {
        expect(fs.readdirSync(d).filter((f) => f.includes(".publish.lock") || f.includes(".tmp-") || f.includes(".bak-"))).toEqual([]);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("acquirePublishLocks はロック作成直後の ENOSPC や mkdir 失敗でも残存ロックを残さず、既存コマンドと排他できる", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-lock-cleanup-"));
    try {
      const targetA = path.join(tmp, "a.json");
      const targetB = path.join(tmp, "b.json");

      // 1. 2件目の openSync("wx") 成功直後に PID 書き込みが ENOSPC で失敗しても、1件目・2件目ともロックを残さない
      let writeCalls = 0;
      expect(() =>
        acquirePublishLocks([targetA, targetB], {
          writeSync: (fd, data) => {
            writeCalls++;
            if (writeCalls === 2) {
              throw new Error("ENOSPC while writing lock metadata");
            }
            fs.writeFileSync(fd, data, "utf8");
          },
        }),
      ).toThrow("ENOSPC while writing lock metadata");
      expect(fs.readdirSync(tmp).filter((f) => f.includes(".publish.lock"))).toEqual([]);

      // 2. 2件目の mkdirSync が失敗しても、1件目で取得済みのロックを解放する
      let mkdirCalls = 0;
      expect(() =>
        acquirePublishLocks([targetA, targetB], {
          mkdirSync: (dir) => {
            mkdirCalls++;
            if (mkdirCalls === 2) {
              throw new Error("EACCES on second lock dir");
            }
            fs.mkdirSync(dir, { recursive: true });
          },
        }),
      ).toThrow("EACCES on second lock dir");
      expect(fs.readdirSync(tmp).filter((f) => f.includes(".publish.lock"))).toEqual([]);

      // 3. ロック残存がないため次回取得は即成功し、form-aliases.json ロック保持中（verify:forms 実行中想定）は
      // generate-pokemon-master.mjs が初回読み込み前に停止して古い索引を上書きしない
      const iso = copyIsolatedMasterConfigs(tmp);
      const dbCopy = path.join(tmp, "pokemon-db.json");
      fs.copyFileSync(path.join(ROOT_DIR, "src/domain/pokesleep/_generated/pokemon-db.json"), dbCopy);
      const outMaster = path.join(tmp, "pokemon-master.ts");
      const outIndex = path.join(tmp, "pokemon-names.ts");
      const outFormLabel = path.join(tmp, "form-label.ts");
      fs.writeFileSync(outMaster, "// sentinel\n", "utf8");
      fs.writeFileSync(outIndex, "// latest-index-sentinel\n", "utf8");
      // 読み込み前にロックで止まることを示すため、form-aliases.json に未保存/破損中の一時内容を置いてもロック衝突で即停止する
      fs.writeFileSync(iso.files.formAliases, "{invalid-json-mid-update", "utf8");

      const release = acquirePublishLocks([iso.files.formAliases]);
      try {
        let lockedExit = 0;
        let lockedStderr = "";
        try {
          execFileSync(
            process.execPath,
            [
              path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
              "--non-interactive",
              "--db",
              dbCopy,
              ...iso.args,
              "--out-master",
              outMaster,
              "--out-index",
              outIndex,
              "--out-form-label-ts",
              outFormLabel,
            ],
            { encoding: "utf8", stdio: "pipe" },
          );
        } catch (err) {
          const e = err as { status?: number; stderr?: string };
          lockedExit = e.status ?? 1;
          lockedStderr = e.stderr ?? "";
        }
        expect(lockedExit).not.toBe(0);
        expect(lockedStderr).toContain("公開ロック取得に失敗");
        expect(fs.readFileSync(outMaster, "utf8")).toBe("// sentinel\n");
        expect(fs.readFileSync(outIndex, "utf8")).toBe("// latest-index-sentinel\n");
      } finally {
        release();
      }
      expect(fs.readdirSync(tmp).filter((f) => f.includes(".publish.lock"))).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("重複排除で片方だけにある有効な link を保持し、異なる有効 link 複数や旧エイリアス残存はエラーにする", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-dup-link-"));
    try {
      const dbPath = path.join(ROOT_DIR, "src/domain/pokesleep/_generated/pokemon-db.json");
      const db = JSON.parse(fs.readFileSync(dbPath, "utf8")) as {
        source?: string;
        items: Array<{ dexNo: number; nameJa: string; link?: string | null }>;
      };

      // 1. 先頭行が link: null、後続行に有効 URL → 有効 URL が保持される
      const oneNullLink = structuredClone(db);
      const halloweenEevees = oneNullLink.items.filter(
        (x) => x.dexNo === 133 && x.nameJa === "イーブイ(ハロウィン)",
      );
      expect(halloweenEevees.length).toBe(2);
      const expectedLink = halloweenEevees[1]!.link;
      halloweenEevees[0]!.link = null;
      const oneNullPath = path.join(tmp, "one-null-link.json");
      const outMasterPath = path.join(tmp, "pokemon-master.ts");
      const outIndexPath = path.join(tmp, "pokemon-names.ts");
      const outFormLabelPath = path.join(tmp, "form-label.ts");
      const isoDup = copyIsolatedMasterConfigs(tmp);
      fs.writeFileSync(oneNullPath, JSON.stringify(oneNullLink, null, 2), "utf8");

      execFileSync(
        process.execPath,
        [
          path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
          "--non-interactive",
          "--db",
          oneNullPath,
          ...isoDup.args,
          "--out-master",
          outMasterPath,
          "--out-index",
          outIndexPath,
          "--out-form-label-ts",
          outFormLabelPath,
        ],
        { encoding: "utf8" },
      );

      const generatedMaster = fs.readFileSync(outMasterPath, "utf8");
      const arr = JSON.parse(
        generatedMaster.slice(generatedMaster.indexOf("] = [") + 4, generatedMaster.lastIndexOf("]") + 1),
      ) as Array<{ dexNo: number; form: number; link: string | null }>;
      const eeveeHalloween = arr.find((x) => x.dexNo === 133 && x.form === 1);
      expect(eeveeHalloween?.link).toBe(expectedLink);

      // 2. 異なる有効 link が複数ある場合は矛盾として停止
      const diffLinks = structuredClone(db);
      const diffEevees = diffLinks.items.filter(
        (x) => x.dexNo === 133 && x.nameJa === "イーブイ(ハロウィン)",
      );
      diffEevees[1]!.link = "https://wikiwiki.jp/poke_sleep/other_link";
      const diffLinksPath = path.join(tmp, "diff-links.json");
      fs.writeFileSync(diffLinksPath, JSON.stringify(diffLinks, null, 2), "utf8");

      let diffLinkExit = 0;
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
            "--non-interactive",
            "--dry-run",
            "--db",
            diffLinksPath,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        diffLinkExit = (err as { status?: number }).status ?? 1;
      }
      expect(diffLinkExit).not.toBe(0);

      // 3. 直接行が存在する idForm に旧エイリアスが残っている場合はエラー停止
      const directFormDb = structuredClone(db);
      directFormDb.items.push({
        ...directFormDb.items.find((x) => x.dexNo === 25 && x.nameJa === "ピカチュウ")!,
        nameJa: "ピカチュウ(ロー)",
      });
      const directFormDbPath = path.join(tmp, "direct-25-6.json");
      fs.writeFileSync(directFormDbPath, JSON.stringify(directFormDb, null, 2), "utf8");

      let staleAliasExit = 0;
      let staleAliasStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
            "--non-interactive",
            "--dry-run",
            "--db",
            directFormDbPath,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        staleAliasExit = e.status ?? 1;
        staleAliasStderr = e.stderr ?? "";
      }
      expect(staleAliasExit).not.toBe(0);
      expect(staleAliasStderr).toContain('25:6');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("stageExplicitDbSnapshot は PokemonDbEntry 準拠で正規化・型検証し、省略項目は null 補完・不正型は拒否する", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-stage-db-"));
    try {
      const realDbJsonPath = path.join(ROOT_DIR, "src/domain/pokesleep/_generated/pokemon-db.json");
      const realDbTsPath = path.join(ROOT_DIR, "src/domain/pokesleep/pokemon-db.ts");
      const stagedJson = path.join(tmp, "pokemon-db.json");
      const stagedTs = path.join(tmp, "pokemon-db.ts");

      // 1. 現行実データは JSON / TS ともに完全一致で出力される
      stageExplicitDbSnapshot(realDbJsonPath, stagedJson, stagedTs);
      expect(fs.readFileSync(stagedJson, "utf8").replace(/\r\n/g, "\n")).toBe(
        fs.readFileSync(realDbJsonPath, "utf8").replace(/\r\n/g, "\n"),
      );
      expect(fs.readFileSync(stagedTs, "utf8").replace(/\r\n/g, "\n")).toBe(
        fs.readFileSync(realDbTsPath, "utf8").replace(/\r\n/g, "\n"),
      );

      // 2. #546 の sleepTypeJa を省略した入力は null で補完され、TS/JSON の両方が PokemonDbEntry 全12キーを持つ
      const rawDb = JSON.parse(fs.readFileSync(realDbJsonPath, "utf8")) as {
        source: string;
        headers: string[];
        items: Array<Record<string, unknown>>;
      };
      const omitted = structuredClone(rawDb);
      const cottonee = omitted.items.find((x) => x.dexNo === 546)!;
      delete cottonee.sleepTypeJa;
      delete cottonee.mainSkillJa;
      const omittedPath = path.join(tmp, "omitted-db.json");
      const omittedOutJson = path.join(tmp, "omitted-out.json");
      const omittedOutTs = path.join(tmp, "omitted-out.ts");
      fs.writeFileSync(omittedPath, JSON.stringify(omitted, null, 2), "utf8");

      stageExplicitDbSnapshot(omittedPath, omittedOutJson, omittedOutTs);
      const normalizedJson = JSON.parse(fs.readFileSync(omittedOutJson, "utf8")) as {
        items: Array<Record<string, unknown>>;
      };
      const normalized546 = normalizedJson.items.find((x) => x.dexNo === 546)!;
      expect(normalized546.sleepTypeJa).toBeNull();
      expect(normalized546.mainSkillJa).toBeNull();
      expect(Object.keys(normalized546)).toEqual([
        "dexNo",
        "nameJa",
        "specialtyJa",
        "sleepTypeJa",
        "berryJa",
        "ingAJa",
        "ingBJa",
        "ingCJa",
        "mainSkillJa",
        "fp",
        "helpSeconds",
        "link",
      ]);
      const emittedTs = fs.readFileSync(omittedOutTs, "utf8");
      expect(emittedTs).toContain('"sleepTypeJa": null');
      expect(emittedTs).toContain('"mainSkillJa": null');

      // 3. fp / helpSeconds / headers の型不正および空 items は書き込み前にエラー停止する
      for (const [label, mutator, expectedPattern] of [
        [
          "empty",
          () => ({ items: [] }),
          /空/,
        ],
        [
          "bad-fp",
          () => {
            const c = structuredClone(rawDb);
            c.items.find((x) => x.dexNo === 546)!.fp = "5";
            return c;
          },
          /fp/,
        ],
        [
          "bad-help",
          () => {
            const c = structuredClone(rawDb);
            c.items.find((x) => x.dexNo === 546)!.helpSeconds = "3000";
            return c;
          },
          /helpSeconds/,
        ],
        [
          "bad-headers",
          () => ({ ...structuredClone(rawDb), headers: ["No.", 123] }),
          /headers/,
        ],
      ] as const) {
        const badPath = path.join(tmp, `bad-${label}.json`);
        const badOutJson = path.join(tmp, `bad-${label}-out.json`);
        const badOutTs = path.join(tmp, `bad-${label}-out.ts`);
        fs.writeFileSync(badPath, JSON.stringify(mutator()), "utf8");
        expect(() => stageExplicitDbSnapshot(badPath, badOutJson, badOutTs)).toThrow(expectedPattern);
        expect(fs.existsSync(badOutJson)).toBe(false);
        expect(fs.existsSync(badOutTs)).toBe(false);
      }
      // 4. source に改行（LF/CRLF/LS/PS）が含まれても pokemon-db.ts と pokemon-master.ts が TS 構文エラーにならない
      expect(sanitizeSingleLineComment("https://example.test/\n@evil\r\nok\u2028x\u2029y")).toBe(
        "https://example.test/ @evil ok x y",
      );
      const newlineSourceDb = structuredClone(rawDb);
      newlineSourceDb.source = "https://wikiwiki.jp/poke_sleep/\n@broken\r\nline\u2028tail";
      const newlinePath = path.join(tmp, "newline-source.json");
      const newlineOutJson = path.join(tmp, "newline-out.json");
      const newlineOutTs = path.join(tmp, "newline-out.ts");
      const newlineMasterTs = path.join(tmp, "newline-master.ts");
      const newlineNamesTs = path.join(tmp, "newline-names.ts");
      const newlineFormLabelTs = path.join(tmp, "newline-form-label.ts");
      const isoNewline = copyIsolatedMasterConfigs(tmp);
      fs.writeFileSync(newlinePath, JSON.stringify(newlineSourceDb, null, 2), "utf8");

      stageExplicitDbSnapshot(newlinePath, newlineOutJson, newlineOutTs);
      execFileSync(
        process.execPath,
        [
          path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
          "--non-interactive",
          "--db",
          newlineOutJson,
          ...isoNewline.args,
          "--out-master",
          newlineMasterTs,
          "--out-index",
          newlineNamesTs,
          "--out-form-label-ts",
          newlineFormLabelTs,
        ],
        { encoding: "utf8" },
      );

      for (const tsFile of [newlineOutTs, newlineMasterTs]) {
        const tsContent = fs.readFileSync(tsFile, "utf8");
        expect(tsContent).not.toContain("\n@broken");
        const transpiled = ts.transpileModule(tsContent, {
          reportDiagnostics: true,
          compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
        });
        expect(transpiled.diagnostics ?? []).toEqual([]);
      }

      // 5. idForm 下位12ビット (1..4095) を超える dexNo (例: 4642 = 546 + (1 << 12)) や範囲外 form を拒否する
      expect(() => encodeIdForm(4642, 0)).toThrow(/1\.\.4095/);
      expect(() => encodeIdForm(0, 0)).toThrow(/1\.\.4095/);
      expect(() => encodeIdForm(546, -1)).toThrow(/0\.\.524287/);
      expect(() => encodeIdForm(546, 0x80000)).toThrow(/0\.\.524287/);
      expect(() => splitPokemonNameAndForm("イーブイ(ハロウィン)", { ハロウィン: -1 })).toThrow(/0\.\.524287/);
      expect(() =>
        validatePokemonDbPayload({
          items: [{ dexNo: 4642, nameJa: "モンメン" }],
        }),
      ).toThrow(/1\.\.4095/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
