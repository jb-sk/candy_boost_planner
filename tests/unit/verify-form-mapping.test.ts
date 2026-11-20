import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PUBLIC_FILES,
  acquirePublishLocks,
  resolvePokesleepToolPath,
  runMasterPipeline,
} from "../../scripts/generate-master.mjs";
import { splitPokemonNameAndForm } from "../../scripts/pokemon-form-resolution.mjs";
import {
  extractExistingDexNosFromMasterTs,
  parseFormMapFromTs,
  parseFormNamesArrayFromTs,
  parseGeneratedNamesIndex,
  verifyAndFixFormMapping,
} from "../../scripts/verify-form-mapping.mjs";

const ROOT = new URL("../../", import.meta.url);
const ROOT_DIR = fileURLToPath(ROOT);

const baseFormJaToNumber = {
  ハロウィン: 1,
  ホリデー: 2,
  パルデア: 4,
  ロー: 6,
};

const baseFormLabelJaToEn = {
  ハロウィン: "Halloween",
  ホリデー: "Holiday",
  パルデア: "Paldea",
  ロー: "Low Key",
};

const baseNitoyonFormMap = {
  Halloween: 1,
  Holiday: 2,
  Paldea: 4,
  "Low Key": 6,
  Halloween2: 12,
};

const samplePokemonList = [
  {
    id: 25,
    name: "Pikachu",
    specialty: "Berries",
    ing1: { name: "apple" },
    ing2: { name: "ginger" },
    ing3: { name: "egg" },
  },
  {
    id: 25,
    name: "Pikachu (Low Key)",
    form: "Low Key",
    specialty: "Berries",
    ing1: { name: "apple" },
    ing2: { name: "cacao" },
    ing3: { name: "honey" },
  },
  {
    id: 25,
    name: "Pikachu (Halloween)",
    form: "Halloween",
    specialty: "Berries",
    ing1: { name: "apple" },
    ing2: { name: "ginger" },
    ing3: { name: "egg" },
  },
  {
    id: 25,
    name: "Pikachu (Halloween2)",
    form: "Halloween2",
    specialty: "Berries",
    ing1: { name: "apple" },
    ing2: { name: "ginger" },
    ing3: { name: "egg" },
  },
  {
    id: 25,
    name: "Pikachu (Holiday)",
    form: "Holiday",
    specialty: "Skills",
    ing1: { name: "apple" },
    ing2: { name: "ginger" },
    ing3: { name: "egg" },
  },
  {
    id: 133,
    name: "Eevee",
    specialty: "Skills",
    ing1: { name: "milk" },
    ing2: { name: "cacao" },
    ing3: { name: "sausage" },
  },
  {
    id: 133,
    name: "Eevee (Halloween)",
    form: "Halloween",
    specialty: "Skills",
    ing1: { name: "pumpkin" },
    ing2: { name: "cacao" },
    ing3: { name: "milk" },
  },
  {
    id: 133,
    name: "Eevee (Halloween2)",
    form: "Halloween2",
    specialty: "Skills",
    ing1: { name: "pumpkin" },
    ing2: { name: "cacao" },
    ing3: { name: "milk" },
  },
  {
    id: 133,
    name: "Eevee (Holiday)",
    form: "Holiday",
    specialty: "Berries",
    ing1: { name: "milk" },
    ing2: { name: "cacao" },
    ing3: { name: "sausage" },
  },
  {
    id: 980,
    name: "Clodsire",
    form: "Paldea",
    specialty: "Ingredients",
    ing1: { name: "cacao" },
    ing2: { name: "coffee" },
    ing3: { name: "potato" },
  },
];

const sampleWikiItems = [
  {
    dexNo: 25,
    nameJa: "ピカチュウ",
    specialtyJa: "きのみ",
    berryJa: ["ウブのみ"],
    ingAJa: ["とくせんリンゴ"],
    ingBJa: ["あったかジンジャー"],
    ingCJa: ["とくせんエッグ"],
  },
  {
    dexNo: 25,
    nameJa: "ピカチュウ(ハロウィン)",
    specialtyJa: "きのみ",
    berryJa: ["ウブのみ"],
    ingAJa: ["とくせんリンゴ"],
    ingBJa: ["あったかジンジャー"],
    ingCJa: ["とくせんエッグ"],
  },
  {
    dexNo: 25,
    nameJa: "ピカチュウ(ハロウィン)",
    specialtyJa: "きのみ",
    berryJa: ["ウブのみ"],
    ingAJa: ["とくせんリンゴ"],
    ingBJa: ["あったかジンジャー"],
    ingCJa: ["とくせんエッグ"],
  },
  {
    dexNo: 25,
    nameJa: "ピカチュウ(ホリデー)",
    specialtyJa: "スキル",
    berryJa: ["ウブのみ"],
    ingAJa: ["とくせんリンゴ"],
    ingBJa: ["あったかジンジャー"],
    ingCJa: ["とくせんエッグ"],
  },
  {
    dexNo: 133,
    nameJa: "イーブイ",
    specialtyJa: "スキル",
    berryJa: ["キーのみ"],
    ingAJa: ["モーモーミルク"],
    ingBJa: ["リラックスカカオ"],
    ingCJa: ["マメミート"],
  },
  {
    dexNo: 133,
    nameJa: "イーブイ(ハロウィン)",
    specialtyJa: "スキル",
    berryJa: ["キーのみ"],
    ingAJa: ["ずっしりカボチャ"],
    ingBJa: ["リラックスカカオ"],
    ingCJa: ["モーモーミルク"],
  },
  {
    dexNo: 133,
    nameJa: "イーブイ(ハロウィン)",
    specialtyJa: "スキル",
    berryJa: ["キーのみ"],
    ingAJa: ["ずっしりカボチャ"],
    ingBJa: ["リラックスカカオ"],
    ingCJa: ["モーモーミルク"],
  },
  {
    dexNo: 133,
    nameJa: "イーブイ(ホリデー)",
    specialtyJa: "きのみ",
    berryJa: ["キーのみ"],
    ingAJa: ["モーモーミルク"],
    ingBJa: ["リラックスカカオ"],
    ingCJa: ["マメミート"],
  },
  {
    dexNo: 980,
    nameJa: "ドオー",
    specialtyJa: "食材",
    berryJa: ["カゴのみ"],
    ingAJa: ["リラックスカカオ"],
    ingBJa: ["めざましコーヒー"],
    ingCJa: ["ほっこりポテト"],
  },
];

const validAliases = {
  _normalFallbackReasons: {
    "25:6": "Pikachu (Low Key) は Wiki に別行なし",
  },
  _ingredientOverrides: {
    "25:6": { a: "apple", b: "cacao", c: "honey" },
  },
  "980:4": 0,
  "25:6": 0,
  "25:12": 1,
  "133:12": 1,
};

const SAMPLE_INDEX_KEYS = [
  "25",
  "24601",
  "4121",
  "49177",
  "8217",
  "133",
  "4229",
  "49285",
  "8325",
  "980",
  "17364",
];

function pickSampleGeneratedIndex(namesTsContent: string) {
  const full = parseGeneratedNamesIndex(namesTsContent);
  const pick = <T,>(obj: Record<string, T> | null) => {
    const out: Record<string, T> = {};
    if (!obj) return out;
    for (const k of SAMPLE_INDEX_KEYS) {
      if (Object.hasOwn(obj, k)) out[k] = obj[k]!;
    }
    return out;
  };
  return {
    nameJaByIdForm: pick(full.nameJaByIdForm),
    ingredientsByIdForm: pick(full.ingredientsByIdForm),
    specialtyByIdForm: pick(full.specialtyByIdForm),
    typeByIdForm: pick(full.typeByIdForm),
  };
}

describe("verify-form-mapping", () => {
  it("複数フォームを持つポケモンの未解決フォーム(Halloween2)を通常フォーム(0)へ誤エイリアスしない", () => {
    const result = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: {
        _normalFallbackReasons: validAliases._normalFallbackReasons,
        _ingredientOverrides: validAliases._ingredientOverrides,
        "980:4": 0,
        "25:6": 0,
      },
    });

    expect(result.formAliases["25:12"]).toBeUndefined();
    expect(result.formAliases["133:12"]).toBeUndefined();
    expect(result.unfixable.length).toBeGreaterThanOrEqual(3);
    expect(result.finalErrors).toBe(1);
    expect(result.skipped).toBe(false);
  });

  it("誤った 133:12 → 0 や _ingredientOverrides なしの 25:6 → 0（食材不一致）を拒否する", () => {
    const wrong133 = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: {
        ...validAliases,
        "133:12": 0,
      },
    });
    expect(wrong133.skipped).toBe(false);
    expect(wrong133.unfixable.length).toBeGreaterThan(0);
    expect(wrong133.finalErrors).toBeGreaterThan(0);

    // 25:6 → 0 は _ingredientOverrides が無いと Low Key (apple/cacao/honey) と通常 (apple/ginger/egg) の不一致で拒否される
    const wrong25_6 = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: {
        _normalFallbackReasons: validAliases._normalFallbackReasons,
        "980:4": 0,
        "25:6": 0,
        "25:12": 1,
        "133:12": 1,
      },
    });
    expect(wrong25_6.skipped).toBe(false);
    expect(wrong25_6.unfixable.some((u) => u.message.includes("食材が一致しません"))).toBe(true);
  });

  it("旧索引のある状態では事前検証が needsRegenerate=true・errors=0 で再生成へ通し、再生成後検証(--verify-generated)で厳格に検証する", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-regen-flow-"));
    try {
      const snapshotPath = path.join(tmp, "pokemon-db.json");
      const outMasterPath = path.join(tmp, "pokemon-master.ts");
      const outIndexPath = path.join(tmp, "pokemon-names.ts");
      const outKnownPath = path.join(tmp, "exp-type-known.json");
      const outOverridesPath = path.join(tmp, "exp-type-overrides.json");
      const outIngCNullPath = path.join(tmp, "ing-c-null-known.json");
      const outFormJaPath = path.join(tmp, "form-ja-to-number.json");
      const outFormEnPath = path.join(tmp, "form-label-ja-to-en.json");
      const outFormLabelTsPath = path.join(tmp, "form-label-ja-to-en.ts");
      const aliasesPath = path.join(tmp, "form-aliases.json");

      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({ source: "test://snapshot", items: sampleWikiItems }, null, 2),
        "utf8",
      );
      fs.writeFileSync(outKnownPath, JSON.stringify([25, 133, 980], null, 2), "utf8");
      fs.writeFileSync(outOverridesPath, "{}\n", "utf8");
      fs.writeFileSync(outIngCNullPath, "[]\n", "utf8");
      fs.writeFileSync(outFormJaPath, JSON.stringify(baseFormJaToNumber, null, 2) + "\n", "utf8");
      fs.writeFileSync(outFormEnPath, JSON.stringify(baseFormLabelJaToEn, null, 2) + "\n", "utf8");
      fs.writeFileSync(aliasesPath, JSON.stringify(validAliases, null, 2), "utf8");

      // 旧索引（49285 が旧設定の通常イーブイのまま残っている状態）
      const staleIndex = {
        nameJaByIdForm: {
          "25": "ピカチュウ",
          "24601": "ピカチュウ",
          "4121": "ピカチュウ(ハロウィン)",
          "49177": "ピカチュウ(ハロウィン)",
          "8217": "ピカチュウ(ホリデー)",
          "133": "イーブイ",
          "4229": "イーブイ(ハロウィン)",
          "49285": "イーブイ", // 旧設定のまま
          "8325": "イーブイ(ホリデー)",
          "980": "ドオー",
          "17364": "ドオー",
        },
        ingredientsByIdForm: {
          "25": { a: "apple", b: "ginger", c: "egg" },
          "24601": { a: "apple", b: "cacao", c: "honey" },
          "4121": { a: "apple", b: "ginger", c: "egg" },
          "49177": { a: "apple", b: "ginger", c: "egg" },
          "8217": { a: "apple", b: "ginger", c: "egg" },
          "133": { a: "milk", b: "cacao", c: "sausage" },
          "4229": { a: "pumpkin", b: "cacao", c: "milk" },
          "49285": { a: "milk", b: "cacao", c: "sausage" }, // 旧設定のまま
          "8325": { a: "milk", b: "cacao", c: "sausage" },
          "980": { a: "cacao", b: "coffee", c: "potato" },
          "17364": { a: "cacao", b: "coffee", c: "potato" },
        },
        specialtyByIdForm: {
          "25": "Berries",
          "24601": "Berries",
          "4121": "Berries",
          "49177": "Berries",
          "8217": "Skills",
          "133": "Skills",
          "4229": "Skills",
          "49285": "Skills",
          "8325": "Berries",
          "980": "Ingredients",
          "17364": "Ingredients",
        },
        typeByIdForm: {
          "25": "Electric",
          "24601": "Electric",
          "4121": "Electric",
          "49177": "Electric",
          "8217": "Electric",
          "133": "Normal",
          "4229": "Normal",
          "49285": "Normal",
          "8325": "Normal",
          "980": "Poison",
          "17364": "Poison",
        },
      };

      // 1. 事前検証（verifyGenerated=false）: 対応表は正しいので errors=0、再生成必要を返す
      const preCheck = verifyAndFixFormMapping({
        pokemonList: samplePokemonList,
        nitoyonFormMap: baseNitoyonFormMap,
        wikiItems: sampleWikiItems,
        formJaToNumber: baseFormJaToNumber,
        formLabelJaToEn: baseFormLabelJaToEn,
        formAliases: validAliases,
        parsedGeneratedIndex: staleIndex,
        verifyGenerated: false,
      });
      expect(preCheck.unfixable).toEqual([]);
      expect(preCheck.finalErrors).toBe(0);
      expect(preCheck.needsRegenerate).toBe(true);
      expect(preCheck.skipped).toBe(false);

      // 旧索引のまま --verify-generated を実行すると厳格にエラーになる
      const preStrict = verifyAndFixFormMapping({
        pokemonList: samplePokemonList,
        nitoyonFormMap: baseNitoyonFormMap,
        wikiItems: sampleWikiItems,
        formJaToNumber: baseFormJaToNumber,
        formLabelJaToEn: baseFormLabelJaToEn,
        formAliases: validAliases,
        parsedGeneratedIndex: staleIndex,
        verifyGenerated: true,
      });
      expect(preStrict.finalErrors).toBeGreaterThan(0);

      // 2. マスター再生成
      execFileSync(
        process.execPath,
        [
          path.join(ROOT_DIR, "scripts/generate-pokemon-master.mjs"),
          "--non-interactive",
          "--db",
          snapshotPath,
          "--known",
          outKnownPath,
          "--overrides",
          outOverridesPath,
          "--ing-c-null-known",
          outIngCNullPath,
          "--form-ja-to-number",
          outFormJaPath,
          "--form-label-ja-to-en",
          outFormEnPath,
          "--form-aliases",
          aliasesPath,
          "--out-master",
          outMasterPath,
          "--out-index",
          outIndexPath,
          "--out-form-label-ts",
          outFormLabelTsPath,
        ],
        { encoding: "utf8" },
      );

      const generatedIndex = parseGeneratedNamesIndex(fs.readFileSync(outIndexPath, "utf8"));
      expect(generatedIndex.nameJaByIdForm?.["49285"]).toBe("イーブイ(ハロウィン)");
      expect(generatedIndex.ingredientsByIdForm?.["49285"]).toEqual({
        a: "pumpkin",
        b: "cacao",
        c: "milk",
      });
      expect(generatedIndex.ingredientsByIdForm?.["24601"]).toEqual({
        a: "apple",
        b: "cacao",
        c: "honey",
      });

      // 3. 生成後検証（--verify-generated）: 完全一致で通過
      const postCheck = verifyAndFixFormMapping({
        pokemonList: samplePokemonList,
        nitoyonFormMap: baseNitoyonFormMap,
        wikiItems: sampleWikiItems,
        formJaToNumber: baseFormJaToNumber,
        formLabelJaToEn: baseFormLabelJaToEn,
        formAliases: validAliases,
        parsedGeneratedIndex: generatedIndex,
        verifyGenerated: true,
      });
      expect(postCheck.skipped).toBe(true);
      expect(postCheck.finalErrors).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--verify-generated は必須マップ欠落・必須キー欠落(undefined===undefined)をエラーにする", () => {
    const namesOnlyIndex = parseGeneratedNamesIndex(
      `export const pokemonNameJaByIdForm = {"25":"ピカチュウ","133":"イーブイ","980":"ドオー"} as const;`,
    );
    const missingMapResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      parsedGeneratedIndex: namesOnlyIndex,
      verifyGenerated: true,
    });
    expect(missingMapResult.skipped).toBe(false);
    expect(missingMapResult.finalErrors).toBeGreaterThan(0);
    expect(missingMapResult.logs.join("\n")).toContain("必須マップが欠落");

    const realNamesTs = fs.readFileSync(
      fileURLToPath(new URL("src/domain/pokesleep/pokemon-names.ts", ROOT)),
      "utf8",
    );
    const missingBothSpec = pickSampleGeneratedIndex(realNamesTs);
    delete missingBothSpec.specialtyByIdForm["4229"];
    delete missingBothSpec.specialtyByIdForm["49285"];

    const specMissingResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      parsedGeneratedIndex: missingBothSpec,
      verifyGenerated: true,
    });
    expect(specMissingResult.skipped).toBe(false);
    expect(specMissingResult.finalErrors).toBeGreaterThanOrEqual(2);
    const specMissingLogs = specMissingResult.logs.join("\n");
    expect(specMissingLogs).toContain("idForm=4229");
    expect(specMissingLogs).toContain("idForm=49285");
    expect(specMissingLogs).toContain("pokemonSpecialtyByIdForm が不正または欠落");
  });

  it("同一 (dexNo, form) の Wiki 重複行で食材が食い違う場合と、既存種の Wiki からの消失をエラーにする", () => {
    const conflictedWiki = structuredClone(sampleWikiItems);
    const secondHalloweenEevee = conflictedWiki.filter(
      (x) => x.dexNo === 133 && x.nameJa === "イーブイ(ハロウィン)",
    )[1];
    secondHalloweenEevee!.ingAJa = ["モーモーミルク"];

    const dupResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: conflictedWiki,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
    });
    expect(dupResult.skipped).toBe(false);
    expect(dupResult.finalErrors).toBeGreaterThan(0);
    expect(dupResult.logs.join("\n")).toContain("Wiki 重複行矛盾");

    // 既存マスターにあった #980 が Wiki から消失し pokesleep-tool に残っている場合
    const vanishedWiki = sampleWikiItems.filter((x) => x.dexNo !== 980);
    const vanishedResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: vanishedWiki,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      existingMasterDexNos: [25, 133, 980],
    });
    expect(vanishedResult.skipped).toBe(false);
    expect(vanishedResult.finalErrors).toBeGreaterThan(0);
    expect(vanishedResult.logs.join("\n")).toContain("既存種 #980");

    // 明示的に承認した場合は消失エラーにしない
    const approvedResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: vanishedWiki,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      existingMasterDexNos: [25, 133, 980],
      allowRemovedDexNos: [980],
    });
    expect(approvedResult.logs.join("\n")).not.toContain("既存種 #980");
  });

  it("Phase 1 の新規候補同士のラベル衝突および部分衝突を自動登録せずエラーにする", () => {
    // 2つの別フォームに同じ未登録ラベル「イベント」が候補になる衝突
    const sameLabelResult = verifyAndFixFormMapping({
      pokemonList: [
        { id: 25, name: "Pikachu (Captain)", form: "Captain" },
        { id: 133, name: "Eevee (Halloween2)", form: "Halloween2" },
      ],
      nitoyonFormMap: { Captain: 11, Halloween2: 12 },
      wikiItems: [
        { dexNo: 25, nameJa: "ピカチュウ(イベント)" },
        { dexNo: 133, nameJa: "イーブイ(イベント)" },
      ],
      formJaToNumber: {},
      formLabelJaToEn: {},
      formAliases: {},
    });
    expect(sameLabelResult.formJaToNumber["イベント"]).toBeUndefined();
    expect(sameLabelResult.fixes).toEqual([]);
    expect(sameLabelResult.unfixable.some((u) => u.message.includes("複数フォームで衝突"))).toBe(true);
    expect(sameLabelResult.finalErrors).toBeGreaterThan(0);

    // 部分衝突（片方が既登録と衝突・もう片方が未登録候補）
    const partialConflictResult = verifyAndFixFormMapping({
      pokemonList: [
        { id: 25, name: "Pikachu (Halloween)", form: "Halloween" },
        { id: 25, name: "Pikachu (Halloween2)", form: "Halloween2" },
        { id: 133, name: "Eevee (Halloween)", form: "Halloween" },
        { id: 133, name: "Eevee (Halloween2)", form: "Halloween2" },
      ],
      nitoyonFormMap: { Halloween: 1, Halloween2: 12 },
      wikiItems: [
        { dexNo: 25, nameJa: "ピカチュウ(ハロウィン)" },
        { dexNo: 25, nameJa: "ピカチュウ(ハロウィン)" },
        { dexNo: 133, nameJa: "イーブイ(ハロウィン)" },
        { dexNo: 133, nameJa: "イーブイ(かぼちゃ)" },
      ],
      formJaToNumber: { ハロウィン: 1 },
      formLabelJaToEn: { ハロウィン: "Halloween" },
      formAliases: {},
    });
    expect(partialConflictResult.formJaToNumber["かぼちゃ"]).toBeUndefined();
    expect(partialConflictResult.unfixable.some((u) => u.message.includes("#25") && u.message.includes("衝突"))).toBe(true);
    expect(partialConflictResult.finalErrors).toBeGreaterThan(0);
  });

  it("Phase 2 の厳格 1対1 制限、Phase 1 の残差一意登録、および NFKC 正規化の一貫性を満たす", () => {
    // 共通パーサーで半角カナ括弧名も NFKC 正規化される
    expect(splitPokemonNameAndForm("イーブイ(ﾊﾛｳｨﾝ)", { ハロウィン: 1 })).toEqual({
      baseNameJa: "イーブイ",
      form: 1,
      formLabelJa: "ハロウィン",
    });
    expect(splitPokemonNameAndForm("イーブイ(未登録)", { ハロウィン: 1 })).toEqual({
      baseNameJa: "イーブイ",
      form: null,
      formLabelJa: "未登録",
    });

    // Phase 2: 複数フォームや未登録括弧名を 0 へ丸めない
    const multiFormResult = verifyAndFixFormMapping({
      pokemonList: [
        { id: 25, name: "Pikachu (Halloween)", form: "Halloween" },
        { id: 25, name: "Pikachu (Holiday)", form: "Holiday" },
      ],
      nitoyonFormMap: { Halloween: 1, Holiday: 2 },
      wikiItems: [{ dexNo: 25, nameJa: "ピカチュウ" }],
      formJaToNumber: { ハロウィン: 1, ホリデー: 2 },
      formLabelJaToEn: { ハロウィン: "Halloween", ホリデー: "Holiday" },
      formAliases: {},
    });
    expect(multiFormResult.formAliases["25:1"]).toBeUndefined();
    expect(multiFormResult.formAliases["25:2"]).toBeUndefined();
    expect(multiFormResult.unfixable).toHaveLength(2);

    const unknownBracketResult = verifyAndFixFormMapping({
      pokemonList: [{ id: 25, name: "Pikachu (Holiday)", form: "Holiday" }],
      nitoyonFormMap: { Holiday: 2 },
      wikiItems: [{ dexNo: 25, nameJa: "ピカチュウ(未登録衣装)" }],
      formJaToNumber: { ホリデー: 2 },
      formLabelJaToEn: { ホリデー: "Holiday" },
      formAliases: {},
    });
    expect(unknownBracketResult.formAliases["25:2"]).toBeUndefined();
    expect(unknownBracketResult.unfixable.length).toBeGreaterThan(0);

    // Phase 1: 既知フォーム消し込み後の残差 1対1 一意登録
    const residualResult = verifyAndFixFormMapping({
      pokemonList: [
        { id: 25, name: "Pikachu" },
        { id: 25, name: "Pikachu (Halloween)", form: "Halloween" },
        { id: 25, name: "Pikachu (Captain)", form: "Captain" },
      ],
      nitoyonFormMap: { Halloween: 1, Captain: 11 },
      wikiItems: [
        { dexNo: 25, nameJa: "ピカチュウ" },
        { dexNo: 25, nameJa: "ピカチュウ(キャプテン)" },
        { dexNo: 25, nameJa: "ピカチュウ(ハロウィン)" },
      ],
      formJaToNumber: { ハロウィン: 1 },
      formLabelJaToEn: { ハロウィン: "Halloween" },
      formAliases: {},
    });
    expect(residualResult.formJaToNumber["キャプテン"]).toBe(11);
    expect(residualResult.formLabelJaToEn["キャプテン"]).toBe("Captain");
    expect(residualResult.finalErrors).toBe(0);

    // ドオー(#980) 厳密 1対1 は引き続き 0 へ自動エイリアス
    const clodsireResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: {
        _normalFallbackReasons: validAliases._normalFallbackReasons,
        _ingredientOverrides: validAliases._ingredientOverrides,
        "25:6": 0,
        "25:12": 1,
        "133:12": 1,
      },
    });
    expect(clodsireResult.formAliases["980:4"]).toBe(0);
    expect(clodsireResult.fixes).toHaveLength(1);
    expect(clodsireResult.finalErrors).toBe(0);
  });

  it("にとよん側の未知フォーム名と Wiki DB 未生成をエラーとして明示する", () => {
    const unknownNitoyonResult = verifyAndFixFormMapping({
      pokemonList: [
        { id: 133, name: "Eevee" },
        { id: 133, name: "Eevee (Halloween2)", form: "Halloween2" },
      ],
      nitoyonFormMap: { Halloween: 1 },
      wikiItems: [{ dexNo: 133, nameJa: "イーブイ" }],
      formJaToNumber: { ハロウィン: 1 },
      formLabelJaToEn: { ハロウィン: "Halloween" },
      formAliases: {},
    });
    expect(unknownNitoyonResult.skipped).toBe(false);
    expect(unknownNitoyonResult.finalErrors).toBeGreaterThan(0);
    expect(unknownNitoyonResult.unfixable.some((u) => u.message.includes('form="Halloween2"'))).toBe(true);

    const noDbResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: [],
      hasPokemonDb: false,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
    });
    expect(noDbResult.skipped).toBe(false);
    expect(noDbResult.finalErrors).toBe(1);
    expect(noDbResult.unfixable[0]?.message).toContain("pokemon-db.json が未生成");
    expect(noDbResult.logs.join("\n")).not.toContain("フォーム括弧がなく");
  });

  it("通常フォームの食材が空オブジェクト({})やタイプ・とくいが unknown でも --verify-generated で拒否する", () => {
    const realNamesTs = fs.readFileSync(
      fileURLToPath(new URL("src/domain/pokesleep/pokemon-names.ts", ROOT)),
      "utf8",
    );
    const corrupted = pickSampleGeneratedIndex(realNamesTs);
    corrupted.ingredientsByIdForm["25"] = {};
    corrupted.specialtyByIdForm["25"] = "unknown";
    corrupted.typeByIdForm["25"] = "unknown";

    const result = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      parsedGeneratedIndex: corrupted,
      verifyGenerated: true,
    });

    expect(result.skipped).toBe(false);
    expect(result.finalErrors).toBeGreaterThanOrEqual(3);
    const joined = result.logs.join("\n");
    expect(joined).toContain("pokemonIngredientsByIdForm の形またはキーが不正");
    expect(joined).toContain("pokemonSpecialtyByIdForm が不正または欠落");
    expect(joined).toContain("pokemonTypeByIdForm が不正または欠落");
  });

  it("Wiki に正式なフォーム行が追加された旧エイリアス(25:6)と孤立メタデータを検知して停止する", () => {
    const wikiWithDirectLowKey = [
      ...sampleWikiItems,
      {
        dexNo: 25,
        nameJa: "ピカチュウ(ロー)",
        specialtyJa: "きのみ",
        berryJa: ["ウブのみ"],
        ingAJa: ["とくせんリンゴ"],
        ingBJa: ["リラックスカカオ"],
        ingCJa: ["あまいミツ"],
      },
    ];

    const result = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: wikiWithDirectLowKey,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
    });

    expect(result.skipped).toBe(false);
    expect(result.finalErrors).toBeGreaterThan(0);
    expect(result.unfixable.some((u) => u.message.includes('旧エイリアス "25:6"'))).toBe(true);
  });

  it("エイリアスがある種を明示承認で削除でき、承認削除で対象0件になる場合と元々0件の場合を区別する", () => {
    // 1. #133 のみ承認削除 → 残る #25 のエイリアスだけで Halloween2 は解決済み
    const wikiWithout133 = sampleWikiItems.filter((x) => x.dexNo !== 133);
    const remove133 = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: wikiWithout133,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      existingMasterDexNos: [25, 133, 980],
      allowRemovedDexNos: [133],
    });
    expect(remove133.unfixable).toEqual([]);
    expect(remove133.finalErrors).toBe(0);

    // 2. #25 と #133 の両方を承認削除 → Halloween2 の対象が承認削除の結果 0 件になってもエラーにしない
    const wikiOnly980 = sampleWikiItems.filter((x) => x.dexNo === 980);
    const removeAllHalloween2 = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: wikiOnly980,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      existingMasterDexNos: [25, 133, 980],
      allowRemovedDexNos: [25, 133],
    });
    expect(removeAllHalloween2.unfixable).toEqual([]);
    expect(removeAllHalloween2.finalErrors).toBe(0);

    // 3. 一方、最初から pokemon.json に対象が 0 件の未登録 formMap エントリは空真にせずエラーにする
    const emptyFormResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: { ...baseNitoyonFormMap, GhostOnly: 99 },
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
    });
    expect(emptyFormResult.skipped).toBe(false);
    expect(emptyFormResult.finalErrors).toBeGreaterThan(0);
  });

  it("ローカル generate-master.mjs で既存種が消失したスナップショットを渡すと公開前に停止し公開済みファイルが変わらない", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-local-vanish-"));
    try {
      // 最小の偽 pokesleep-tool（#546, #547 を含む）を作成
      const fakeToolRoot = path.join(tmp, "pokesleep-tool");
      fs.mkdirSync(path.join(fakeToolRoot, "src/data"), { recursive: true });
      fs.mkdirSync(path.join(fakeToolRoot, "src/util"), { recursive: true });
      fs.writeFileSync(
        path.join(fakeToolRoot, "src/util/PokemonIv.ts"),
        `const formMap: Record<ValidFormType, number> = { Halloween: 1, Holiday: 2, Alola: 3, Paldea: 4, Amped: 5, "Low Key": 6, Small: 7, Medium: 8, Large: 9, Jumbo: 10, Captain: 11, Halloween2: 12 };\n` +
          `const formNames: ("" | ValidFormType)[] = ["", "Halloween", "Holiday", "Alola", "Paldea", "Amped", "Low Key", "Small", "Medium", "Large", "Jumbo", "Captain", "Halloween2"];\n`,
        "utf8",
      );
      fs.writeFileSync(
        path.join(fakeToolRoot, "src/data/pokemon.json"),
        JSON.stringify([
          { id: 546, name: "Cottonee" },
          { id: 547, name: "Whimsicott" },
        ]),
        "utf8",
      );

      // 実 DB から #546 と #547 を取り除いたスナップショットを作成
      const realDbPath = path.join(ROOT_DIR, "src/domain/pokesleep/_generated/pokemon-db.json");
      const realMasterPath = path.join(ROOT_DIR, "src/domain/pokesleep/pokemon-master.ts");
      const realNamesPath = path.join(ROOT_DIR, "src/domain/pokesleep/pokemon-names.ts");
      const beforeMaster = fs.readFileSync(realMasterPath, "utf8");
      const beforeNames = fs.readFileSync(realNamesPath, "utf8");
      const beforeDb = fs.readFileSync(realDbPath, "utf8");

      const parsedDb = JSON.parse(beforeDb) as { items: Array<{ dexNo: number }> };
      const vanishedDb = {
        ...parsedDb,
        items: parsedDb.items.filter((x) => x.dexNo !== 546 && x.dexNo !== 547),
      };
      const vanishedDbPath = path.join(tmp, "vanished-db.json");
      fs.writeFileSync(vanishedDbPath, JSON.stringify(vanishedDb, null, 2), "utf8");

      let exitCode = 0;
      let output = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/generate-master.mjs"),
            "--non-interactive",
            "--db",
            vanishedDbPath,
            "--pokesleep-tool",
            fakeToolRoot,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        exitCode = e.status ?? 1;
        output = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
      }

      expect(exitCode).not.toBe(0);
      expect(output).toContain("既存種 #546");
      expect(output).toContain("既存種 #547");
      // 公開済みファイルが 1 バイトも書き換わっていないこと
      expect(fs.readFileSync(realMasterPath, "utf8")).toBe(beforeMaster);
      expect(fs.readFileSync(realNamesPath, "utf8")).toBe(beforeNames);
      expect(fs.readFileSync(realDbPath, "utf8")).toBe(beforeDb);

      // 環境変数 POKESLEEP_TOOL_PATH のみ指定（--pokesleep-tool 省略）でも親が事前検証・消失検査を実行する
      expect(resolvePokesleepToolPath(null, { POKESLEEP_TOOL_PATH: "  /tmp/tool  " })).toBe("/tmp/tool");
      expect(resolvePokesleepToolPath("--cli-path", { POKESLEEP_TOOL_PATH: "/tmp/tool" })).toBe("--cli-path");
      expect(resolvePokesleepToolPath(null, { POKESLEEP_TOOL_PATH: "   " })).toBeNull();

      let envExitCode = 0;
      let envOutput = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/generate-master.mjs"),
            "--non-interactive",
            "--db",
            vanishedDbPath,
          ],
          {
            encoding: "utf8",
            stdio: "pipe",
            env: { ...process.env, POKESLEEP_TOOL_PATH: fakeToolRoot },
          },
        );
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        envExitCode = e.status ?? 1;
        envOutput = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
      }
      expect(envExitCode).not.toBe(0);
      expect(envOutput).toContain("既存種 #546");
      expect(fs.readFileSync(realMasterPath, "utf8")).toBe(beforeMaster);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("厳格検証(--verify-generated)は未登録の Wiki フォーム行と承認削除済みの余剰索引キーをどちらも検出する", () => {
    const realNamesTs = fs.readFileSync(
      fileURLToPath(new URL("src/domain/pokesleep/pokemon-names.ts", ROOT)),
      "utf8",
    );
    const cleanSampleIndex = pickSampleGeneratedIndex(realNamesTs);

    // 1. Wiki に未登録括弧名の行「イーブイ(新しい括弧名)」が追加された場合、skipped にせずエラーにする
    const wikiWithUnknownRow = [
      ...sampleWikiItems,
      {
        dexNo: 133,
        nameJa: "イーブイ(新しい括弧名)",
        specialtyJa: "スキル",
        berryJa: ["キーのみ"],
        ingAJa: ["モーモーミルク"],
        ingBJa: ["リラックスカカオ"],
        ingCJa: ["マメミート"],
      },
    ];
    const unknownRowResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: wikiWithUnknownRow,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      parsedGeneratedIndex: cleanSampleIndex,
      verifyGenerated: true,
    });
    expect(unknownRowResult.skipped).toBe(false);
    expect(unknownRowResult.finalErrors).toBeGreaterThan(0);
    expect(unknownRowResult.logs.join("\n")).toContain("未登録のフォーム括弧名「新しい括弧名」");

    // 2. 承認削除済みの #980 を Wiki から除いたのに索引に 980 / 17364 が残っている場合
    const wikiWithout980 = sampleWikiItems.filter((x) => x.dexNo !== 980);
    const strictExtraResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: wikiWithout980,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      parsedGeneratedIndex: cleanSampleIndex,
      existingMasterDexNos: [25, 133, 980],
      allowRemovedDexNos: [980],
      verifyGenerated: true,
    });
    expect(strictExtraResult.skipped).toBe(false);
    expect(strictExtraResult.finalErrors).toBeGreaterThanOrEqual(4);
    expect(strictExtraResult.logs.join("\n")).toContain("余剰キー (idForm=980)");
    expect(strictExtraResult.logs.join("\n")).toContain("余剰キー (idForm=17364)");

    // 事前検証（verifyGenerated=false）ではエラーにせず needsRegenerate=true を返す
    const preExtraResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: wikiWithout980,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      parsedGeneratedIndex: cleanSampleIndex,
      existingMasterDexNos: [25, 133, 980],
      allowRemovedDexNos: [980],
      verifyGenerated: false,
    });
    expect(preExtraResult.skipped).toBe(false);
    expect(preExtraResult.finalErrors).toBe(0);
    expect(preExtraResult.needsRegenerate).toBe(true);
  });

  it("generate-master の --dry-run は事前検証の自動修正をステージング内へ反映して後続生成・厳格検証まで通し、公開先を変更しない", () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-dryrun-autofix-"));
    try {
      // キャプテン(11) の自動登録が必要な小規模公開先フィクスチャを作成（ネットワーク不要）
      const fakeToolRoot = path.join(tmp, "pokesleep-tool");
      fs.mkdirSync(path.join(fakeToolRoot, "src/data"), { recursive: true });
      fs.mkdirSync(path.join(fakeToolRoot, "src/util"), { recursive: true });
      fs.writeFileSync(
        path.join(fakeToolRoot, "src/util/PokemonIv.ts"),
        `const formMap: Record<ValidFormType, number> = { Halloween: 1, Holiday: 2, Paldea: 4, "Low Key": 6, Captain: 11, Halloween2: 12 };\n` +
          `const formNames: ("" | ValidFormType)[] = ["", "Halloween", "Holiday", "", "Paldea", "", "Low Key", "", "", "", "", "Captain", "Halloween2"];\n`,
        "utf8",
      );
      fs.writeFileSync(
        path.join(fakeToolRoot, "src/data/pokemon.json"),
        JSON.stringify([
          ...samplePokemonList.map((p) => ({
            ...p,
            ancestor: p.id === 25 ? 172 : p.id === 133 ? 133 : 194,
          })),
          {
            id: 25,
            name: "Pikachu (Captain)",
            form: "Captain",
            ancestor: 172,
            specialty: "Skills",
            ing1: { name: "apple" },
            ing2: { name: "ginger" },
            ing3: { name: "egg" },
          },
        ]),
        "utf8",
      );

      const snapshotItems = [
        ...sampleWikiItems,
        {
          dexNo: 25,
          nameJa: "ピカチュウ(キャプテン)",
          specialtyJa: "スキル",
          sleepTypeJa: "すやすや",
          berryJa: ["ウブのみ"],
          ingAJa: ["とくせんリンゴ"],
          ingBJa: ["あったかジンジャー"],
          ingCJa: ["とくせんエッグ"],
          mainSkillJa: "ゆめのかけらゲットS",
          fp: 5,
          helpSeconds: 2700,
          link: null,
        },
      ];
      const snapshotPath = path.join(tmp, "snapshot.json");
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({ source: "test://captain", headers: [], items: snapshotItems }, null, 2),
        "utf8",
      );

      const pubDir = path.join(tmp, "public");
      fs.mkdirSync(pubDir, { recursive: true });
      const tempPublicFiles: typeof PUBLIC_FILES = {
        dbTs: path.join(pubDir, "pokemon-db.ts"),
        dbJson: path.join(pubDir, "pokemon-db.json"),
        master: path.join(pubDir, "pokemon-master.ts"),
        index: path.join(pubDir, "pokemon-names.ts"),
        formLabelTs: path.join(pubDir, "form-label-ja-to-en.ts"),
        candyFamily: path.join(pubDir, "candy-family.ts"),
        known: path.join(pubDir, "exp-type-known.json"),
        overrides: path.join(pubDir, "exp-type-overrides.json"),
        ingCNullKnown: path.join(pubDir, "ing-c-null-known.json"),
        formJaToNumber: path.join(pubDir, "form-ja-to-number.json"),
        formLabelJaToEn: path.join(pubDir, "form-label-ja-to-en.json"),
        formAliases: path.join(pubDir, "form-aliases.json"),
        testConfig: path.join(pubDir, "test-config.json"),
      };

      const initialFormJa = JSON.stringify(baseFormJaToNumber, null, 2) + "\n";
      const initialFormEn = JSON.stringify(baseFormLabelJaToEn, null, 2) + "\n";
      fs.writeFileSync(tempPublicFiles.formJaToNumber, initialFormJa, "utf8");
      fs.writeFileSync(tempPublicFiles.formLabelJaToEn, initialFormEn, "utf8");
      fs.writeFileSync(tempPublicFiles.formAliases, JSON.stringify(validAliases, null, 2) + "\n", "utf8");
      fs.writeFileSync(tempPublicFiles.known, JSON.stringify([25, 133, 980], null, 2) + "\n", "utf8");
      fs.writeFileSync(tempPublicFiles.overrides, "{}\n", "utf8");
      fs.writeFileSync(tempPublicFiles.ingCNullKnown, "[]\n", "utf8");
      fs.writeFileSync(
        tempPublicFiles.master,
        `export const pokemonMaster: unknown[] = [\n  {"dexNo":25,"pokedexId":25},\n  {"dexNo":133,"pokedexId":133},\n  {"dexNo":980,"pokedexId":980}\n] as const;\n`,
        "utf8",
      );
      fs.writeFileSync(
        tempPublicFiles.candyFamily,
        `export const candyFamilyByPokedexId = {"25":25,"133":133,"980":980} as const;\nexport const candyFamilyAncestorByPokedexId = {"25":172,"133":133,"980":194} as const;\n`,
        "utf8",
      );
      fs.writeFileSync(tempPublicFiles.testConfig, JSON.stringify({ latestPokemon: { name: "ドオー" } }, null, 2) + "\n", "utf8");

      const dryRunResult = runMasterPipeline({
        dryRun: true,
        interactive: false,
        pokesleepTool: fakeToolRoot,
        explicitDbPath: snapshotPath,
        publicFiles: tempPublicFiles,
      });

      expect(dryRunResult.exitCode).toBe(0);
      expect(dryRunResult.hasChanges).toBe(true);
      expect(dryRunResult.changedFiles).toContain(tempPublicFiles.dbTs);
      expect(dryRunResult.changedFiles).toContain(tempPublicFiles.dbJson);
      expect(dryRunResult.changedFiles).toContain(tempPublicFiles.formJaToNumber);
      // 公開先マッピングファイルが dry-run によって書き換わっていないこと
      expect(fs.readFileSync(tempPublicFiles.formJaToNumber, "utf8")).toBe(initialFormJa);
      expect(fs.readFileSync(tempPublicFiles.formLabelJaToEn, "utf8")).toBe(initialFormEn);
      expect(fs.existsSync(tempPublicFiles.index)).toBe(false);

      // まず通常実行で公開先を最新状態に揃える
      const publishResult = runMasterPipeline({
        dryRun: false,
        interactive: false,
        pokesleepTool: fakeToolRoot,
        explicitDbPath: snapshotPath,
        publicFiles: tempPublicFiles,
      });
      expect(publishResult.exitCode).toBe(0);

      // Wiki DB の helpSeconds だけ +1 変更したとき、マスター差分なしでも dry-run の hasChanges が true で dbTs/dbJson を報告する
      const helpChangedItems: Array<Record<string, unknown>> = structuredClone(snapshotItems);
      const cap = helpChangedItems.find((x) => x.nameJa === "ピカチュウ(キャプテン)")!;
      cap.helpSeconds = 2701;
      const helpChangedPath = path.join(tmp, "snapshot-help-changed.json");
      fs.writeFileSync(
        helpChangedPath,
        JSON.stringify({ source: "test://captain", headers: [], items: helpChangedItems }, null, 2),
        "utf8",
      );

      const dbOnlyDryRun = runMasterPipeline({
        dryRun: true,
        interactive: false,
        pokesleepTool: fakeToolRoot,
        explicitDbPath: helpChangedPath,
        publicFiles: tempPublicFiles,
      });
      expect(dbOnlyDryRun.exitCode).toBe(0);
      expect(dbOnlyDryRun.hasChanges).toBe(true);
      expect(dbOnlyDryRun.changedFiles).toEqual([tempPublicFiles.dbTs, tempPublicFiles.dbJson]);

      // 排他ロック取得中に別の通常実行を開始すると即座に中断し公開先を変更しない
      const releaseOtherLock = acquirePublishLocks([tempPublicFiles.master]);
      try {
        const lockedResult = runMasterPipeline({
          dryRun: false,
          interactive: false,
          pokesleepTool: fakeToolRoot,
          explicitDbPath: helpChangedPath,
          publicFiles: tempPublicFiles,
        });
        expect(lockedResult.exitCode).not.toBe(0);
      } finally {
        releaseOtherLock();
      }

      // 生成失敗時にステージング削除が EBUSY で失敗しても、元の失敗終了コードを保ちつつ全ロックを解放する
      const brokenSnapshotPath = path.join(tmp, "broken-snapshot.json");
      fs.writeFileSync(brokenSnapshotPath, JSON.stringify({ items: [] }), "utf8");
      const leakedStagingDirs: string[] = [];
      const ebusyResult = runMasterPipeline({
        dryRun: false,
        interactive: false,
        pokesleepTool: fakeToolRoot,
        explicitDbPath: brokenSnapshotPath,
        publicFiles: tempPublicFiles,
        removeTmpDir: (dir) => {
          leakedStagingDirs.push(dir);
          throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
        },
      });
      try {
        expect(ebusyResult.exitCode).not.toBe(0);
        expect(fs.readdirSync(pubDir).filter((f) => f.includes(".publish.lock"))).toEqual([]);
        // ロックが残っていないため、次回実行が正常に通ること
        const recoveryResult = runMasterPipeline({
          dryRun: false,
          interactive: false,
          pokesleepTool: fakeToolRoot,
          explicitDbPath: helpChangedPath,
          publicFiles: tempPublicFiles,
        });
        expect(recoveryResult.exitCode).toBe(0);
      } finally {
        for (const d of leakedStagingDirs) {
          fs.rmSync(d, { recursive: true, force: true });
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("12ビット上限 (4095) を超える dexNo (例: 4642) や範囲外フォーム番号を厳格に拒否する", () => {
    // dexNo=4642 (= 546 + (1 << 12)) を混ぜ、546 の消失を承認しても入力境界で拒否する
    const overflowWiki = [
      ...sampleWikiItems,
      {
        dexNo: 4642,
        nameJa: "モンメン",
        specialtyJa: "スキル",
        berryJa: ["ドリのみ"],
        ingAJa: ["ひとくちナッツ"],
        ingBJa: ["つやつやアボカド"],
        ingCJa: ["あんみんトマト"],
      },
    ];
    const overflowResult = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: overflowWiki,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
      allowRemovedDexNos: [546],
    });
    expect(overflowResult.skipped).toBe(false);
    expect(overflowResult.finalErrors).toBeGreaterThan(0);
    expect(overflowResult.logs.join("\n")).toContain("1..4095");

    // pokemon.json 側の範囲外 id や formMap の範囲外フォーム番号も拒否する
    const overflowNitoyon = verifyAndFixFormMapping({
      pokemonList: [...samplePokemonList, { id: 4642, name: "Cottonee" }],
      nitoyonFormMap: baseNitoyonFormMap,
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
    });
    expect(overflowNitoyon.skipped).toBe(false);
    expect(overflowNitoyon.finalErrors).toBeGreaterThan(0);
    expect(overflowNitoyon.logs.join("\n")).toContain("1..4095");

    const overflowFormMap = verifyAndFixFormMapping({
      pokemonList: samplePokemonList,
      nitoyonFormMap: { ...baseNitoyonFormMap, TooBig: 0x80000 },
      wikiItems: sampleWikiItems,
      formJaToNumber: baseFormJaToNumber,
      formLabelJaToEn: baseFormLabelJaToEn,
      formAliases: validAliases,
    });
    expect(overflowFormMap.skipped).toBe(false);
    expect(overflowFormMap.finalErrors).toBeGreaterThan(0);
    expect(overflowFormMap.logs.join("\n")).toContain("0..524287");

    // parseFormMapFromTs は小数 (11.5) や未解釈値 (foo) を切り詰めずエラーにし、16進数 (0xB) は 11 として正しく読む
    expect(
      parseFormMapFromTs(`const formMap: Record<ValidFormType, number> = {
        Halloween: 1, // comment
        /* block */ Captain: 0xB,
        "Low Key": 6,
      };`),
    ).toEqual({ Halloween: 1, Captain: 11, "Low Key": 6 });

    expect(() =>
      parseFormMapFromTs(`const formMap: Record<ValidFormType, number> = { Captain: 11.5 };`),
    ).toThrow(/Captain.*11\.5/);
    expect(() =>
      parseFormMapFromTs(`const formMap: Record<ValidFormType, number> = { Captain: -1 };`),
    ).toThrow(/Captain.*-1/);
    expect(() =>
      parseFormMapFromTs(`const formMap: Record<ValidFormType, number> = { Captain: foo };`),
    ).toThrow(/Captain.*"foo"/);
    expect(() =>
      parseFormMapFromTs(`const formMap: Record<ValidFormType, number> = { Captain: 0x80000 };`),
    ).toThrow(/Captain.*0x80000/);

    // コメント内の旧 formMap 宣言を無視し、実際の宣言にある小数 (11.5) やトークン分断 (1/**/1) を確実に拒否する
    expect(() =>
      parseFormMapFromTs(`
        /* const formMap: Record<ValidFormType, number> = { Halloween: 1, Captain: 11 }; */
        const formMap: Record<ValidFormType, number> = { Halloween: 1, Captain: 11.5 };
      `),
    ).toThrow(/Captain.*11\.5/);
    expect(() =>
      parseFormMapFromTs(`const formMap: Record<ValidFormType, number> = { Captain: 1/**/1 };`),
    ).toThrow(/構文エラー/);

    // parseFormNamesArrayFromTs は配列の穴や非文字列要素を詰めずに拒否し、verifyGenerated では formMap との不一致もエラーにする
    expect(
      parseFormNamesArrayFromTs(`const formNames: ("" | ValidFormType)[] = ["", "Halloween", "Holiday"];`),
    ).toEqual(["", "Halloween", "Holiday"]);
    expect(() =>
      parseFormNamesArrayFromTs(`const formNames: ("" | ValidFormType)[] = ["", , "Holiday"];`),
    ).toThrow(/formNames\[1\].*欠落/);
    expect(() =>
      parseFormNamesArrayFromTs(`const formNames: ("" | ValidFormType)[] = ["", 123, "Holiday"];`),
    ).toThrow(/formNames\[1\].*解釈できません/);

    const realNamesTs = fs.readFileSync(
      fileURLToPath(new URL("src/domain/pokesleep/pokemon-names.ts", ROOT)),
      "utf8",
    );
    const cleanSampleIndex = pickSampleGeneratedIndex(realNamesTs);
    // 早期リターン対象になり得る整合済みデータでも、formNames[1] の不一致は事前検証 (verifyGenerated=false) でも
    // 厳格検証 (verifyGenerated=true) でも確実にエラーにする
    const mismatchedFormNames: string[] = [
      "",
      "Holiday", // formMap.Halloween=1 と不一致
      "Holiday",
      "",
      "Paldea",
      "",
      "Low Key",
      "",
      "",
      "",
      "",
      "",
      "Halloween2",
    ];
    for (const strict of [false, true]) {
      const formNamesMismatchResult = verifyAndFixFormMapping({
        pokemonList: samplePokemonList,
        nitoyonFormMap: baseNitoyonFormMap,
        nitoyonFormNames: mismatchedFormNames,
        wikiItems: sampleWikiItems,
        formJaToNumber: baseFormJaToNumber,
        formLabelJaToEn: baseFormLabelJaToEn,
        formAliases: validAliases,
        parsedGeneratedIndex: cleanSampleIndex,
        verifyGenerated: strict,
      });
      expect(formNamesMismatchResult.skipped).toBe(false);
      expect(formNamesMismatchResult.finalErrors).toBeGreaterThan(0);
      expect(formNamesMismatchResult.unfixable.length).toBeGreaterThan(0);
      expect(formNamesMismatchResult.logs.join("\n")).toContain('formMap["Halloween"]=1');
    }

    // 破損・途中切れ・空配列の基準 pokemon-master.ts は拒否し、先頭コメント内の擬似宣言は無視して実宣言を読む
    expect(() =>
      extractExistingDexNosFromMasterTs(
        `export const pokemonMaster: PokemonMasterEntry[] = [\n  {"dexNo": 546, "pokedexId": 546`,
      ),
    ).toThrow(/構文エラー|終端|パース/);
    expect(() =>
      extractExistingDexNosFromMasterTs(
        `export const pokemonMaster: PokemonMasterEntry[] = [ {broken ] as const;`,
      ),
    ).toThrow(/構文エラー|JSON パース/);
    expect(() =>
      extractExistingDexNosFromMasterTs(
        `export const pokemonMaster: PokemonMasterEntry[] = [] as const;\n`,
      ),
    ).toThrow(/空です/);
    // 不正型（dexNo: true / 文字列 / pokedexId 不一致 / form: true）を数値へ暗黙変換せず拒否する
    expect(() =>
      extractExistingDexNosFromMasterTs(
        `export const pokemonMaster: PokemonMasterEntry[] = [{"dexNo": true, "pokedexId": 546, "form": 0}] as const;\n`,
      ),
    ).toThrow(/dexNo が不正/);
    expect(() =>
      extractExistingDexNosFromMasterTs(
        `export const pokemonMaster: PokemonMasterEntry[] = [{"dexNo": "546", "pokedexId": 546, "form": 0}] as const;\n`,
      ),
    ).toThrow(/dexNo が不正/);
    expect(() =>
      extractExistingDexNosFromMasterTs(
        `export const pokemonMaster: PokemonMasterEntry[] = [{"dexNo": 546, "pokedexId": 547, "form": 0}] as const;\n`,
      ),
    ).toThrow(/一致しません/);
    expect(() =>
      extractExistingDexNosFromMasterTs(
        `export const pokemonMaster: PokemonMasterEntry[] = [{"dexNo": 546, "pokedexId": 546, "form": true}] as const;\n`,
      ),
    ).toThrow(/form が不正/);
    const commentedMasterDex = extractExistingDexNosFromMasterTs(
      `// export const pokemonMaster = [] as const;\n` +
        `export const pokemonMaster: PokemonMasterEntry[] = [\n  {"dexNo": 546, "pokedexId": 546, "form": 0},\n  {"dexNo": 547, "pokedexId": 547, "form": 0}\n] as const;\n`,
    );
    expect([...commentedMasterDex]).toEqual([546, 547]);

    // CLI 実行でも Captain: 11.5・formNames 欠落/穴・破損基準マスター・ロック競合をすべて拒否する
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "cbp-formmap-cli-"));
    try {
      const badToolRoot = path.join(tmp, "bad-tool");
      fs.mkdirSync(path.join(badToolRoot, "src/data"), { recursive: true });
      fs.mkdirSync(path.join(badToolRoot, "src/util"), { recursive: true });
      fs.writeFileSync(
        path.join(badToolRoot, "src/util/PokemonIv.ts"),
        `const formMap: Record<ValidFormType, number> = { Halloween: 1, Captain: 11.5 };\n`,
        "utf8",
      );
      fs.writeFileSync(path.join(badToolRoot, "src/data/pokemon.json"), "[]", "utf8");

      let badFloatExit = 0;
      let badFloatStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/verify-form-mapping.mjs"),
            "--pokesleep-tool",
            badToolRoot,
            "--verify-generated",
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        badFloatExit = e.status ?? 1;
        badFloatStderr = e.stderr ?? "";
      }
      expect(badFloatExit).not.toBe(0);
      expect(badFloatStderr).toContain("11.5");

      // formNames 宣言自体を省いた PokemonIv.ts は CLI --verify-generated で拒否する
      const missingFormNamesRoot = path.join(tmp, "no-formnames-tool");
      fs.mkdirSync(path.join(missingFormNamesRoot, "src/data"), { recursive: true });
      fs.mkdirSync(path.join(missingFormNamesRoot, "src/util"), { recursive: true });
      fs.writeFileSync(
        path.join(missingFormNamesRoot, "src/util/PokemonIv.ts"),
        `const formMap: Record<ValidFormType, number> = { Halloween: 1, Holiday: 2, Alola: 3, Paldea: 4, Amped: 5, "Low Key": 6, Small: 7, Medium: 8, Large: 9, Jumbo: 10, Captain: 11, Halloween2: 12 };\n`,
        "utf8",
      );
      fs.writeFileSync(path.join(missingFormNamesRoot, "src/data/pokemon.json"), "[]", "utf8");
      let noFormNamesExit = 0;
      let noFormNamesStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/verify-form-mapping.mjs"),
            "--pokesleep-tool",
            missingFormNamesRoot,
            "--verify-generated",
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        noFormNamesExit = e.status ?? 1;
        noFormNamesStderr = e.stderr ?? "";
      }
      expect(noFormNamesExit).not.toBe(0);
      expect(noFormNamesStderr).toContain("formNames を抽出できませんでした");

      // 基準 pokemon-master.ts が途中切れでパース不能な場合、Wiki から #546 が消えていてもすり抜けずに停止する
      const validToolRoot = path.join(tmp, "valid-tool");
      fs.mkdirSync(path.join(validToolRoot, "src/data"), { recursive: true });
      fs.mkdirSync(path.join(validToolRoot, "src/util"), { recursive: true });
      fs.writeFileSync(
        path.join(validToolRoot, "src/util/PokemonIv.ts"),
        `const formMap: Record<ValidFormType, number> = { Halloween: 1, Holiday: 2, Alola: 3, Paldea: 4, Amped: 5, "Low Key": 6, Small: 7, Medium: 8, Large: 9, Jumbo: 10, Captain: 11, Halloween2: 12 };\n` +
          `const formNames: ("" | ValidFormType)[] = ["", "Halloween", "Holiday", "Alola", "Paldea", "Amped", "Low Key", "Small", "Medium", "Large", "Jumbo", "Captain", "Halloween2"];\n`,
        "utf8",
      );
      fs.writeFileSync(
        path.join(validToolRoot, "src/data/pokemon.json"),
        JSON.stringify([{ id: 546, name: "Cottonee" }]),
        "utf8",
      );
      const truncatedMaster = path.join(tmp, "truncated-master.ts");
      fs.writeFileSync(
        truncatedMaster,
        `export const pokemonMaster: PokemonMasterEntry[] = [\n  {"dexNo": 546, "pokedexId": 546`,
        "utf8",
      );
      const dbWithout546 = JSON.parse(
        fs.readFileSync(path.join(ROOT_DIR, "src/domain/pokesleep/_generated/pokemon-db.json"), "utf8"),
      ) as { source: string; headers: string[]; items: Array<{ dexNo: number }> };
      const dbWithout546Path = path.join(tmp, "db-without-546.json");
      fs.writeFileSync(
        dbWithout546Path,
        JSON.stringify({ ...dbWithout546, items: dbWithout546.items.filter((x) => x.dexNo !== 546) }, null, 2),
        "utf8",
      );
      let truncatedExit = 0;
      let truncatedStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/verify-form-mapping.mjs"),
            "--pokesleep-tool",
            validToolRoot,
            "--db",
            dbWithout546Path,
            "--master",
            truncatedMaster,
            "--dry-run",
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        truncatedExit = e.status ?? 1;
        truncatedStderr = e.stderr ?? "";
      }
      expect(truncatedExit).not.toBe(0);
      expect(truncatedStderr).toContain("基準マスター");

      // 先頭にコメント内宣言 `// export const pokemonMaster = [] as const;` があっても実宣言から #546 の消失を検出し、
      // 実際の基準マスターが空配列の場合もエラー停止する
      const realMasterContent = fs.readFileSync(
        path.join(ROOT_DIR, "src/domain/pokesleep/pokemon-master.ts"),
        "utf8",
      );
      const commentedMasterPath = path.join(tmp, "commented-master.ts");
      fs.writeFileSync(
        commentedMasterPath,
        `// export const pokemonMaster = [] as const;\n${realMasterContent}`,
        "utf8",
      );
      let commentedExit = 0;
      let commentedOut = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/verify-form-mapping.mjs"),
            "--pokesleep-tool",
            validToolRoot,
            "--db",
            dbWithout546Path,
            "--master",
            commentedMasterPath,
            "--dry-run",
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        commentedExit = e.status ?? 1;
        commentedOut = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
      }
      expect(commentedExit).not.toBe(0);
      expect(commentedOut).toContain("既存種 #546");

      const emptyMasterPath = path.join(tmp, "empty-master.ts");
      fs.writeFileSync(
        emptyMasterPath,
        `export const pokemonMaster: PokemonMasterEntry[] = [] as const;\n`,
        "utf8",
      );
      let emptyMasterExit = 0;
      let emptyMasterStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/verify-form-mapping.mjs"),
            "--pokesleep-tool",
            validToolRoot,
            "--db",
            dbWithout546Path,
            "--master",
            emptyMasterPath,
            "--dry-run",
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        emptyMasterExit = e.status ?? 1;
        emptyMasterStderr = e.stderr ?? "";
      }
      expect(emptyMasterExit).not.toBe(0);
      expect(emptyMasterStderr).toContain("空です");

      // 基準マスターの #546 dexNo を true に壊した場合、Number(true)=1 へ丸めずエラー停止する
      const boolDexMasterPath = path.join(tmp, "bool-dex-master.ts");
      fs.writeFileSync(
        boolDexMasterPath,
        realMasterContent.replace('"dexNo": 546,', '"dexNo": true,'),
        "utf8",
      );
      let boolDexExit = 0;
      let boolDexStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/verify-form-mapping.mjs"),
            "--pokesleep-tool",
            validToolRoot,
            "--db",
            dbWithout546Path,
            "--master",
            boolDexMasterPath,
            "--dry-run",
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        boolDexExit = e.status ?? 1;
        boolDexStderr = e.stderr ?? "";
      }
      expect(boolDexExit).not.toBe(0);
      expect(boolDexStderr).toContain("dexNo が不正");

      // アメ系統生成も先頭コメント内の空配列を無視して実マスター 237 種を読み、空配列マスターはエラー停止する
      const candyCommentOut = execFileSync(
        process.execPath,
        [
          path.join(ROOT_DIR, "scripts/generate-candy-families.mjs"),
          "--master",
          commentedMasterPath,
          "--dry-run",
        ],
        { encoding: "utf8" },
      );
      expect(candyCommentOut).toContain("has_changes=false ids=237 families=109");

      let candyEmptyExit = 0;
      let candyEmptyStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/generate-candy-families.mjs"),
            "--master",
            emptyMasterPath,
            "--dry-run",
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        candyEmptyExit = e.status ?? 1;
        candyEmptyStderr = e.stderr ?? "";
      }
      expect(candyEmptyExit).not.toBe(0);
      expect(candyEmptyStderr).toContain("空です");

      // formNames[1] が配列の穴になっている PokemonIv.ts も CLI --verify-generated で拒否する
      const holeToolRoot = path.join(tmp, "hole-tool");
      fs.mkdirSync(path.join(holeToolRoot, "src/data"), { recursive: true });
      fs.mkdirSync(path.join(holeToolRoot, "src/util"), { recursive: true });
      fs.writeFileSync(
        path.join(holeToolRoot, "src/util/PokemonIv.ts"),
        `const formMap: Record<ValidFormType, number> = { Halloween: 1, Holiday: 2 };\n` +
          `const formNames: ("" | ValidFormType)[] = ["", , "Holiday"];\n`,
        "utf8",
      );
      fs.writeFileSync(path.join(holeToolRoot, "src/data/pokemon.json"), "[]", "utf8");
      let holeExit = 0;
      let holeStderr = "";
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT_DIR, "scripts/verify-form-mapping.mjs"),
            "--pokesleep-tool",
            holeToolRoot,
            "--verify-generated",
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        holeExit = e.status ?? 1;
        holeStderr = e.stderr ?? "";
      }
      expect(holeExit).not.toBe(0);
      expect(holeStderr).toContain("formNames[1]");

      // verify-form-mapping.mjs の通常実行が入力 DB (pokemon-db.json) と対応表の両方の排他ロックを尊重すること
      const lockDb = path.join(tmp, "pokemon-db.json");
      const lockMaster = path.join(tmp, "pokemon-master.ts");
      const lockFormJa = path.join(tmp, "form-ja-to-number.json");
      const lockFormEn = path.join(tmp, "form-label-ja-to-en.json");
      const lockFormAliases = path.join(tmp, "form-aliases.json");
      fs.writeFileSync(lockDb, JSON.stringify({ source: "test://lock", items: sampleWikiItems }, null, 2), "utf8");
      fs.writeFileSync(
        lockMaster,
        `export const pokemonMaster = [{"dexNo": 25, "pokedexId": 25, "form": 0}] as const;\n`,
        "utf8",
      );
      fs.writeFileSync(lockFormJa, "{}\n", "utf8");
      fs.writeFileSync(lockFormEn, "{}\n", "utf8");
      fs.writeFileSync(lockFormAliases, "{}\n", "utf8");

      for (const lockedTarget of [lockDb, lockFormAliases]) {
        const release = acquirePublishLocks([lockedTarget]);
        try {
          let lockExit = 0;
          let lockStderr = "";
          try {
            execFileSync(
              process.execPath,
              [
                path.join(ROOT_DIR, "scripts/verify-form-mapping.mjs"),
                "--pokesleep-tool",
                badToolRoot,
                "--db",
                lockDb,
                "--master",
                lockMaster,
                "--form-ja-to-number",
                lockFormJa,
                "--form-label-ja-to-en",
                lockFormEn,
                "--form-aliases",
                lockFormAliases,
              ],
              { encoding: "utf8", stdio: "pipe" },
            );
          } catch (err) {
            const e = err as { status?: number; stderr?: string };
            lockExit = e.status ?? 1;
            lockStderr = e.stderr ?? "";
          }
          expect(lockExit).not.toBe(0);
          expect(lockStderr).toContain("公開ロック取得に失敗");
        } finally {
          release();
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("auto-update-pokemon workflow safeguards", () => {
  const workflow = fs.readFileSync(
    fileURLToPath(new URL(".github/workflows/auto-update-pokemon.yml", ROOT)),
    "utf8",
  );
  const packageJson = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL("package.json", ROOT)), "utf8"),
  ) as { scripts: Record<string, string> };

  it("only calls npm scripts that exist", () => {
    const called = [...workflow.matchAll(/pnpm run ([\w:-]+)/g)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const script of called) {
      expect(Object.keys(packageJson.scripts), script).toContain(script);
    }
  });

  it("fetches Wiki once, shares snapshot across form verify and master generation, and runs --verify-generated before PR", () => {
    const fetchIdx = workflow.indexOf("- name: Fetch Wiki snapshot");
    const verifyIdx = workflow.indexOf("- name: Verify and auto-fix form mapping");
    const masterCheckIdx = workflow.indexOf("- name: Check for master data changes");
    const masterUpdateIdx = workflow.indexOf("- name: Update master data and verify generated index");
    const ingCheckIdx = workflow.indexOf("- name: Check ingredient label maps");
    const createPrIdx = workflow.indexOf("- name: Create Pull Request");

    expect(fetchIdx).toBeGreaterThan(0);
    expect(verifyIdx).toBeGreaterThan(fetchIdx);
    expect(masterCheckIdx).toBeGreaterThan(verifyIdx);
    expect(masterUpdateIdx).toBeGreaterThan(masterCheckIdx);
    expect(ingCheckIdx).toBeGreaterThan(masterUpdateIdx);
    expect(createPrIdx).toBeGreaterThan(ingCheckIdx);

    expect(workflow).toContain("--db /tmp/pokemon-db.json");
    expect(workflow).toContain("--verify-generated");
    expect(workflow).toContain("steps.form_verify.outputs.needs_regenerate == 'true'");
  });

  it("parses [SUMMARY] single line, stops immediately on form/ingredient errors without creating a PR", () => {
    expect(workflow).toContain("SUMMARY_LINE=$(printf '%s\\n' \"$VERIFY_OUTPUT\" | grep '^\\[SUMMARY\\]' | tail -n 1 || true)");
    expect(workflow).toContain('if [ "$UNFIXABLE" != "0" ] || [ "$ERRORS" != "0" ] || [ "$VERIFY_EXIT" -ne 0 ]; then');
    expect(workflow).toContain("node scripts/check-ingredient-labels.mjs --fail-on-gap");

    expect(workflow).not.toContain("Fail if unfixable form");
    const verifyStep = workflow.slice(
      workflow.indexOf("- name: Verify and auto-fix form mapping"),
      workflow.indexOf("- name: Check for master data changes"),
    );
    expect(verifyStep).toContain("exit 1");

    const ingStep = workflow.slice(
      workflow.indexOf("- name: Check ingredient label maps"),
      workflow.indexOf("- name: Create Pull Request"),
    );
    expect(ingStep).toContain("exit 1");
  });
});
