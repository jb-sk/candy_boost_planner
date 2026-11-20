import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitPokemonNameAndForm } from "./pokemon-form-resolution.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ING_NULL_KNOWN_PATH = path.join(__dirname, "ing-null-known.json");

function normalize(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * Wiki の日本語食材名（正規名・明示した別表記の完全一致） → 内部食材キーの対応ルール（単一情報源）。
 * 部分一致は新食材の誤マッチ（例: 「ピーナッツ」→「ナッツ」）を招くため使わない。
 * 新しい食材がゲームに追加されたら、ここと src/composables/useBoxStore.ts の
 * ingredientJa / ingredientEn の両方に同一キーを追加する。
 */
export const INGREDIENT_KEY_RULES = Object.freeze([
  { key: "leek", labels: Object.freeze(["ふといながねぎ"]) },
  { key: "mushroom", labels: Object.freeze(["あじわいキノコ"]) },
  { key: "egg", labels: Object.freeze(["とくせんエッグ"]) },
  { key: "potato", labels: Object.freeze(["ほっこりポテト"]) },
  { key: "apple", labels: Object.freeze(["とくせんリンゴ"]) },
  { key: "herb", labels: Object.freeze(["げきからハーブ"]) },
  { key: "sausage", labels: Object.freeze(["マメミート"]) },
  { key: "milk", labels: Object.freeze(["モーモーミルク"]) },
  { key: "honey", labels: Object.freeze(["あまいミツ"]) },
  { key: "oil", labels: Object.freeze(["ピュアなオイル"]) },
  { key: "ginger", labels: Object.freeze(["あったかジンジャー"]) },
  { key: "tomato", labels: Object.freeze(["あんみんトマト"]) },
  { key: "cacao", labels: Object.freeze(["リラックスカカオ"]) },
  { key: "tail", labels: Object.freeze(["おいしいシッポ"]) },
  { key: "soy", labels: Object.freeze(["ワカクサ大豆"]) },
  { key: "corn", labels: Object.freeze(["ワカクサコーン"]) },
  { key: "coffee", labels: Object.freeze(["めざましコーヒー"]) },
  { key: "pumpkin", labels: Object.freeze(["ずっしりカボチャ"]) },
  { key: "avocado", labels: Object.freeze(["つやつやアボカド"]) },
  { key: "nuts", labels: Object.freeze(["ひとくちナッツ"]) },
]);

export const KNOWN_INGREDIENT_KEYS = Object.freeze(
  INGREDIENT_KEY_RULES.map((rule) => rule.key),
);

const EXACT_LABEL_TO_KEY = new Map();
for (const rule of INGREDIENT_KEY_RULES) {
  for (const label of rule.labels) {
    EXACT_LABEL_TO_KEY.set(normalize(label), rule.key);
  }
}

// Wiki の空セル用プレースホルダー・非食材アイテム（拡張子除去・正規化後の完全一致のみ除外）
const IGNORED_EXACT_LABELS = new Set([
  "spacer",
  "ひらめきのたね",
]);

/**
 * 食材 A/B/C をユーザー任意で選択できる特殊仕様ポケモン（Mew, Darkrai 等）の
 * 許可セットを scripts/ing-null-known.json（単一情報源）から構築する。
 * 数値 `151` は `"151:0"`、文字列 `"151:0"` はそのまま扱う。
 * @param {Array<number | string>} rawList
 * @returns {Set<string>}
 */
export function buildIngredientsNullSet(rawList) {
  const set = new Set();
  if (!Array.isArray(rawList)) return set;
  for (const entry of rawList) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      set.add(`${entry}:0`);
      continue;
    }
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (/^\d+$/.test(trimmed)) {
        set.add(`${Number(trimmed)}:0`);
      } else if (/^\d+:\d+$/.test(trimmed)) {
        const [d, f] = trimmed.split(":");
        set.add(`${Number(d)}:${Number(f)}`);
      }
    }
  }
  return set;
}

/**
 * @param {string} [filePath]
 * @returns {Set<string>}
 */
export function loadIngredientsNullSet(filePath = DEFAULT_ING_NULL_KNOWN_PATH) {
  if (!fs.existsSync(filePath)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath}: JSON 配列である必要があります`);
  }
  return buildIngredientsNullSet(parsed);
}

/**
 * @param {number} dexNo
 * @param {number | null} [form]
 * @param {Set<string>} [ingredientsNullSet]
 */
export function isIngredientsNullPokemon(
  dexNo,
  form = 0,
  ingredientsNullSet = loadIngredientsNullSet(),
) {
  if (form === null || form === undefined) return false;
  return ingredientsNullSet.has(`${Number(dexNo)}:${Number(form)}`);
}

export function normalizeIngredientLabel(value) {
  const t0 = normalize(value);
  if (!t0) return null;
  // 画像ファイル名が混ざることがあるので拡張子は落とす
  const t = t0.replace(/\.(png|gif|jpg|jpeg|webp)$/i, "");
  if (!t) return null;
  // プレースホルダー・非食材アイテムは正規化後の完全一致でのみ除外する
  if (IGNORED_EXACT_LABELS.has(t.toLowerCase()) || IGNORED_EXACT_LABELS.has(t)) {
    return null;
  }
  return t;
}

export function ingredientKeyFromWikiJa(value) {
  const t = normalizeIngredientLabel(value);
  if (!t) return null;
  return EXACT_LABEL_TO_KEY.get(t) ?? null;
}

/**
 * 1 スロット（ingAJa / ingBJa / ingCJa）内の全要素を正規化して解決する。
 * スロット値は null / undefined または文字列配列のみ許容し、それ以外は invalid_type とする。
 * @param {unknown} rawValues
 * @returns {{
 *   status: "empty" | "ok" | "unknown" | "ambiguous" | "invalid_type",
 *   key: string | null,
 *   labels: string[],
 *   unknownLabels: string[],
 *   matchedKeys: string[],
 *   invalidDetail?: string,
 * }}
 */
export function resolveIngredientSlot(rawValues) {
  if (rawValues === null || rawValues === undefined) {
    return { status: "empty", key: null, labels: [], unknownLabels: [], matchedKeys: [] };
  }
  if (!Array.isArray(rawValues)) {
    return {
      status: "invalid_type",
      key: null,
      labels: [],
      unknownLabels: [],
      matchedKeys: [],
      invalidDetail: `配列ではありません (${typeof rawValues}: ${JSON.stringify(rawValues)})`,
    };
  }
  const nonStringIndex = rawValues.findIndex((el) => typeof el !== "string");
  if (nonStringIndex >= 0) {
    return {
      status: "invalid_type",
      key: null,
      labels: [],
      unknownLabels: [],
      matchedKeys: [],
      invalidDetail: `要素[${nonStringIndex}]が文字列ではありません (${typeof rawValues[nonStringIndex]})`,
    };
  }

  /** @type {string[]} */
  const labels = [];
  for (const raw of rawValues) {
    const label = normalizeIngredientLabel(raw);
    if (label) labels.push(label);
  }
  if (labels.length === 0) {
    return { status: "empty", key: null, labels: [], unknownLabels: [], matchedKeys: [] };
  }

  /** @type {string[]} */
  const unknownLabels = [];
  /** @type {Set<string>} */
  const matchedKeySet = new Set();

  for (const label of labels) {
    const key = ingredientKeyFromWikiJa(label);
    if (key) {
      matchedKeySet.add(key);
    } else if (!unknownLabels.includes(label)) {
      unknownLabels.push(label);
    }
  }

  const matchedKeys = [...matchedKeySet];
  if (unknownLabels.length > 0) {
    return { status: "unknown", key: null, labels, unknownLabels, matchedKeys };
  }
  if (matchedKeys.length > 1) {
    return { status: "ambiguous", key: null, labels, unknownLabels: [], matchedKeys };
  }
  return { status: "ok", key: matchedKeys[0] ?? null, labels, unknownLabels: [], matchedKeys };
}

/**
 * Wiki の pokemon-db items から、未登録食材・複数候補・不正型・必須スロット(A/B)欠損を収集する。
 * @param {Array<{ dexNo?: unknown, nameJa?: unknown, ingAJa?: unknown, ingBJa?: unknown, ingCJa?: unknown }>} items
 * @param {Record<string, number>} [formJaToNumber]
 * @param {Set<string>} [ingredientsNullSet]
 */
export function collectIngredientMappingIssues(
  items,
  formJaToNumber = {},
  ingredientsNullSet = loadIngredientsNullSet(),
) {
  if (!Array.isArray(items)) {
    throw new Error("pokemon-db の items が配列ではありません");
  }

  /** @type {Map<string, Array<{ dexNo: number, nameJa: string, slot: "A" | "B" | "C" }>>} */
  const unknownLabels = new Map();
  /** @type {Array<{ dexNo: number, nameJa: string, slot: "A" | "B" | "C", labels: string[], matchedKeys: string[] }>} */
  const ambiguousSlots = [];
  /** @type {Array<{ dexNo: number, nameJa: string, slot: "A" | "B" | "C", detail: string }>} */
  const invalidSlots = [];
  /** @type {Array<{ dexNo: number, nameJa: string, missingSlots: Array<"A" | "B"> }>} */
  const missingRequiredSlots = [];

  for (const it of items) {
    const dexNo = Number(it?.dexNo);
    if (!Number.isFinite(dexNo)) continue;
    const nameJa = normalize(it?.nameJa);
    if (!nameJa) continue;

    const { form } = splitPokemonNameAndForm(nameJa, formJaToNumber);
    if (isIngredientsNullPokemon(dexNo, form, ingredientsNullSet)) continue;

    /** @type {Array<["A" | "B" | "C", ReturnType<typeof resolveIngredientSlot>]>} */
    const resolvedSlots = [
      ["A", resolveIngredientSlot(it.ingAJa)],
      ["B", resolveIngredientSlot(it.ingBJa)],
      ["C", resolveIngredientSlot(it.ingCJa)],
    ];

    for (const [slot, res] of resolvedSlots) {
      if (res.status === "invalid_type") {
        invalidSlots.push({
          dexNo,
          nameJa,
          slot,
          detail: res.invalidDetail ?? "不正な型",
        });
        continue;
      }
      for (const label of res.unknownLabels) {
        if (!unknownLabels.has(label)) unknownLabels.set(label, []);
        unknownLabels.get(label).push({ dexNo, nameJa, slot });
      }
      if (res.status === "ambiguous") {
        ambiguousSlots.push({
          dexNo,
          nameJa,
          slot,
          labels: res.labels,
          matchedKeys: res.matchedKeys,
        });
      }
    }

    /** @type {Array<"A" | "B">} */
    const missingSlots = [];
    if (resolvedSlots[0][1].status === "empty") missingSlots.push("A");
    if (resolvedSlots[1][1].status === "empty") missingSlots.push("B");
    if (missingSlots.length > 0) {
      missingRequiredSlots.push({ dexNo, nameJa, missingSlots });
    }
  }

  return { unknownLabels, ambiguousSlots, invalidSlots, missingRequiredSlots };
}

/**
 * @param {ReturnType<typeof collectIngredientMappingIssues>} result
 */
export function formatIngredientMappingIssues(result) {
  const lines = [];
  const { unknownLabels, ambiguousSlots, invalidSlots, missingRequiredSlots } = result;

  if (unknownLabels.size > 0) {
    lines.push(`未知の食材名が ${unknownLabels.size} 件あります（MasterDB に取り込めません）:`);
    for (const label of [...unknownLabels.keys()].sort((a, b) => a.localeCompare(b, "ja"))) {
      const refs = unknownLabels.get(label) ?? [];
      const examples = refs
        .slice(0, 5)
        .map((r) => `#${r.dexNo} ${r.nameJa} (${r.slot})`)
        .join(", ");
      const more = refs.length > 5 ? ` ... +${refs.length - 5}件` : "";
      lines.push(`  - "${label}" (例: ${examples}${more})`);
    }
    lines.push(
      "  対応: scripts/pokemon-ingredient-resolution.mjs の INGREDIENT_KEY_RULES と " +
      "src/composables/useBoxStore.ts の ingredientJa / ingredientEn に同じキーを追加してください。",
    );
  }

  if (invalidSlots.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`食材スロットの型が不正な行が ${invalidSlots.length} 件あります:`);
    for (const entry of invalidSlots.slice(0, 10)) {
      lines.push(`  - #${entry.dexNo} ${entry.nameJa} (${entry.slot}): ${entry.detail}`);
    }
    if (invalidSlots.length > 10) {
      lines.push(`  ... +${invalidSlots.length - 10}件`);
    }
  }

  if (ambiguousSlots.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`1 スロットに複数の食材候補が含まれる行が ${ambiguousSlots.length} 件あります:`);
    for (const entry of ambiguousSlots.slice(0, 10)) {
      lines.push(
        `  - #${entry.dexNo} ${entry.nameJa} (${entry.slot}): ${entry.labels.join(", ")} -> [${entry.matchedKeys.join(", ")}]`,
      );
    }
    if (ambiguousSlots.length > 10) {
      lines.push(`  ... +${ambiguousSlots.length - 10}件`);
    }
  }

  if (missingRequiredSlots.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`食材 A/B が未記載のポケモンが ${missingRequiredSlots.length} 件あります:`);
    for (const entry of missingRequiredSlots.slice(0, 10)) {
      lines.push(`  - #${entry.dexNo} ${entry.nameJa} (未記載: ${entry.missingSlots.join(", ")})`);
    }
    if (missingRequiredSlots.length > 10) {
      lines.push(`  ... +${missingRequiredSlots.length - 10}件`);
    }
    lines.push(
      "  対応: Wiki の記載待ち、または幻ポケモン等の特殊仕様であれば " +
      "scripts/ing-null-known.json を確認してください。",
    );
  }

  return lines.join("\n");
}

/**
 * @param {Array<{ dexNo?: unknown, nameJa?: unknown, ingAJa?: unknown, ingBJa?: unknown, ingCJa?: unknown }>} items
 * @param {Record<string, number>} [formJaToNumber]
 * @param {Set<string>} [ingredientsNullSet]
 */
export function assertNoIngredientMappingIssues(
  items,
  formJaToNumber = {},
  ingredientsNullSet = loadIngredientsNullSet(),
) {
  const result = collectIngredientMappingIssues(items, formJaToNumber, ingredientsNullSet);
  if (
    result.unknownLabels.size === 0 &&
    result.ambiguousSlots.length === 0 &&
    result.invalidSlots.length === 0 &&
    result.missingRequiredSlots.length === 0
  ) {
    return;
  }

  const summaryParts = [];
  if (result.unknownLabels.size > 0) {
    summaryParts.push(
      `未知食材: ${[...result.unknownLabels.keys()].sort((a, b) => a.localeCompare(b, "ja")).join(", ")}`,
    );
  }
  if (result.invalidSlots.length > 0) {
    summaryParts.push(
      `不正型: ${result.invalidSlots.map((x) => `#${x.dexNo} ${x.nameJa}(${x.slot})`).join(", ")}`,
    );
  }
  if (result.ambiguousSlots.length > 0) {
    summaryParts.push(
      `複数候補: ${result.ambiguousSlots.map((x) => `#${x.dexNo} ${x.nameJa}(${x.slot})`).join(", ")}`,
    );
  }
  if (result.missingRequiredSlots.length > 0) {
    summaryParts.push(
      `食材A/B未記載: ${result.missingRequiredSlots.map((x) => `#${x.dexNo} ${x.nameJa}`).join(", ")}`,
    );
  }

  throw new Error(
    `食材マッピングが未解決のため、MasterDB の生成を中断しました (${summaryParts.join(" / ")})\n` +
    formatIngredientMappingIssues(result),
  );
}
