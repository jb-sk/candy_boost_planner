import type { ExpGainNature, ExpType } from "../types";

export type NitoyonBoxLine = {
  iv: string;
  nickname: string;
};

export type NitoyonIvDecoded = {
  pokedexId: number;
  form: number;
  level: number;
  natureName: string;
  expGainNature: ExpGainNature;
  expType: ExpType;
};

export type NitoyonIvDecodedDetail = NitoyonIvDecoded & {
  ingredientType: IngredientType | null;
  subSkills: Array<{
    lv: 10 | 25 | 50 | 75 | 100;
    nameEn: string;
    nameJa: string;
  }>;
};

/**
 * にとよんさんの「ボックスエクスポート」1行をパースする。
 * 形式: `${iv}` または `${iv}@${nickname}`（nicknameは空文字もありうる）
 */
export function parseNitoyonBoxLine(line: string): NitoyonBoxLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const at = trimmed.indexOf("@");
  if (at === -1) {
    return { iv: trimmed, nickname: "" };
  }
  return {
    iv: trimmed.slice(0, at),
    nickname: trimmed.slice(at + 1),
  };
}

/**
 * にとよんさんの PokemonIv.serialize() を（最小限）デコードする。
 * 取り出すのは Planner で必要な: 図鑑ID / form / level / nature（EXP↑↓）のみ。
 *
 * 元実装: pokesleep-tool/src/util/PokemonIv.ts を参照（bit packing）
 */
export function decodeNitoyonIvMinimal(iv: string): NitoyonIvDecoded | null {
  try {
    let v = iv;
    if (v.length === 12) {
      v = v.replace(/-/g, "/") + "AAAA";
    } else if (v.length === 16) {
      v = v.replace(/-/g, "/");
    } else {
      return null;
    }

    const bin = atob(v);
    const array8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      array8[i] = bin.charCodeAt(i);
    }
    const array16 = new Uint16Array(array8.buffer);

    // validate version
    if ((array16[0] & 0xf) !== 1) return null;

    const pokedexId = array16[0] >> 4;
    const form = array16[1] & 0x3f;
    const level = (array16[1] >> 6) & 0x7f;
    const natureIndex = (array16[2] >> 6) & 31;

    const natureName = NatureAllNames[natureIndex];
    if (!natureName) return null;

    const expGainNature = expGainNatureFromNatureName(natureName);
    const expType = inferExpTypeByPokedexId(pokedexId);

    return { pokedexId, form, level, natureName, expGainNature, expType };
  } catch {
    return null;
  }
}

/**
 * にとよんIVを詳細デコード（食材タイプ・サブスキルを含む）。
 * 表示用なので「未知/範囲外」は落とさず null/skip にする。
 */
export function decodeNitoyonIvDetail(iv: string): NitoyonIvDecodedDetail | null {
  try {
    let v = iv;
    if (v.length === 12) {
      v = v.replace(/-/g, "/") + "AAAA";
    } else if (v.length === 16) {
      v = v.replace(/-/g, "/");
    } else {
      return null;
    }

    const bin = atob(v);
    const array8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      array8[i] = bin.charCodeAt(i);
    }
    const array16 = new Uint16Array(array8.buffer);

    if ((array16[0] & 0xf) !== 1) return null;

    const pokedexId = array16[0] >> 4;
    const form = array16[1] & 0x3f;
    const level = (array16[1] >> 6) & 0x7f;
    const natureIndex = (array16[2] >> 6) & 31;
    const natureName = NatureAllNames[natureIndex];
    if (!natureName) return null;

    const expGainNature = expGainNatureFromNatureName(natureName);
    const expType = inferExpTypeByPokedexId(pokedexId);

    const ingIndex = (array16[1] >> 13) & 0x7;
    const ingredientType = IngredientTypes[ingIndex] ?? null;

    const subSkills: NitoyonIvDecodedDetail["subSkills"] = [];
    const addSub = (lv: 10 | 25 | 50 | 75 | 100, idx: number) => {
      if (idx === 31) return;
      const nameEn = SubSkillAllNames[idx];
      if (!nameEn) return;
      const nameJa = SubSkillNameJaByEn[nameEn] ?? nameEn;
      subSkills.push({ lv, nameEn, nameJa });
    };
    addSub(10, (array16[2] >> 11) & 31);
    addSub(25, (array16[3] >> 0) & 31);
    addSub(50, (array16[3] >> 5) & 31);
    addSub(75, (array16[3] >> 10) & 31);
    addSub(100, (array16[4] >> 0) & 31);

    return { pokedexId, form, level, natureName, expGainNature, expType, ingredientType, subSkills };
  } catch {
    return null;
  }
}

// --- nature mapping (pokesleep-tool/src/util/Nature.ts) ---
const NatureAllNames = [
  "Bashful",
  "Hardy",
  "Docile",
  "Quirky",
  "Serious",
  "Bold",
  "Impish",
  "Lax",
  "Relaxed",
  "Timid",
  "Hasty",
  "Jolly",
  "Naive",
  "Lonely",
  "Adamant",
  "Naughty",
  "Brave",
  "Calm",
  "Gentle",
  "Careful",
  "Sassy",
  "Modest",
  "Mild",
  "Rash",
  "Quiet",
] as const;

const ExpGainsUp = new Set(["Timid", "Hasty", "Jolly", "Naive"] as const);
const ExpGainsDown = new Set(["Relaxed", "Brave", "Sassy", "Quiet"] as const);

export function expGainNatureFromNatureName(name: string): ExpGainNature {
  if ((ExpGainsUp as ReadonlySet<string>).has(name)) return "up";
  if ((ExpGainsDown as ReadonlySet<string>).has(name)) return "down";
  return "normal";
}

// --- exp type mapping (pokesleep-tool/src/data/pokemons.ts のコメントに基づく) ---
export function inferExpTypeByPokedexId(id: number): ExpType {
  // 1320: Darkrai (491)
  if (id === 491) return 1320;
  // 1080: Raikou/Entei/Suicune
  if (id === 243 || id === 244 || id === 245) return 1080;
  // 900: Dratini/Larvitar
  if (id === 147 || id === 246) return 900;
  return 600;
}

// --- ingredients mapping (pokesleep-tool/src/util/PokemonRp.ts) ---
export type IngredientType = "AAA" | "AAB" | "AAC" | "ABA" | "ABB" | "ABC";
export const IngredientTypes: IngredientType[] = ["AAA", "AAB", "AAC", "ABA", "ABB", "ABC"];

// --- subskill mapping (pokesleep-tool/src/util/SubSkill.ts + i18n/ja.json) ---
export const SubSkillAllNames = [
  "Berry Finding S",
  "Dream Shard Bonus",
  "Energy Recovery Bonus",
  "Helping Bonus",
  "Research EXP Bonus",
  "Skill Level Up M",
  "Sleep EXP Bonus",
  "Helping Speed M",
  "Ingredient Finder M",
  "Inventory Up L",
  "Inventory Up M",
  "Skill Level Up S",
  "Skill Trigger M",
  "Helping Speed S",
  "Ingredient Finder S",
  "Inventory Up S",
  "Skill Trigger S",
] as const;

export const SubSkillNameJaByEn: Record<(typeof SubSkillAllNames)[number], string> = {
  "Berry Finding S": "きのみの数S",
  "Dream Shard Bonus": "ゆめのかけらボーナス",
  "Energy Recovery Bonus": "げんき回復ボーナス",
  "Helping Bonus": "おてつだいボーナス",
  "Research EXP Bonus": "リサーチEXPボーナス",
  "Skill Level Up M": "スキルレベルアップM",
  "Sleep EXP Bonus": "睡眠EXPボーナス",
  "Helping Speed M": "おてつだいスピードM",
  "Ingredient Finder M": "食材確率アップM",
  "Inventory Up L": "最大所持数アップL",
  "Inventory Up M": "最大所持数アップM",
  "Skill Level Up S": "スキルレベルアップS",
  "Skill Trigger M": "スキル確率アップM",
  "Helping Speed S": "おてつだいスピードS",
  "Ingredient Finder S": "食材確率アップS",
  "Inventory Up S": "最大所持数アップS",
  "Skill Trigger S": "スキル確率アップS",
};

export const SubSkillAll: Array<{ nameEn: (typeof SubSkillAllNames)[number]; nameJa: string }> =
  SubSkillAllNames.map((nameEn) => ({ nameEn, nameJa: SubSkillNameJaByEn[nameEn] ?? nameEn }));

/** 新規追加フォーム等の補完向け：日本語名を「あいうえお順」に近い形で並べる */
export const SubSkillAllJaSorted = [...SubSkillAll].sort((a, b) => a.nameJa.localeCompare(b.nameJa, "ja"));

const subSkillEnByJa = (() => {
  const m = new Map<string, string>();
  for (const s of SubSkillAll) m.set(s.nameJa, s.nameEn);
  return m;
})();

export function subSkillEnFromJa(nameJa: string): string | null {
  const k = String(nameJa ?? "").trim();
  if (!k) return null;
  return subSkillEnByJa.get(k) ?? null;
}
