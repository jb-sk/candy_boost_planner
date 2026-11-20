#!/usr/bin/env node
/**
 * verify-form-mapping.mjs — フォーム番号3ソース突合 & 自動修正スクリプト
 *
 * 3つのデータソースを突合し、不整合を検出して自動修正する:
 *   A) Wiki pokemon-db.json（日本語フォーム名の正）
 *   B) pokesleep-tool PokemonIv.ts formMap + pokemon.json（英名・番号の正）
 *   C) candy_boost_planner のマッピングテーブル (form-ja-to-number.json 等) および生成済み pokemon-names.ts
 *
 * 実行モード:
 *   - 事前検証（既定）: マッピング定義・旧エイリアス残存・Wiki重複・種消失を厳格検証し、安全な自動修正を行う。
 *     生成済み索引(pokemon-names.ts)の古い値は needs_regenerate=true として返し、再生成へ進める。
 *   - 生成後検証（--verify-generated）: 読み取り専用。未反映の修正や生成済み索引の不整合をすべてエラーにする。
 *
 * Usage:
 *   POKESLEEP_TOOL_PATH=<path> node scripts/verify-form-mapping.mjs [--db <path>] [--master <path>] [--names <path>]
 *     [--form-ja-to-number <path>] [--form-label-ja-to-en <path>] [--form-aliases <path>]
 *     [--dry-run] [--verify-generated] [--allow-removed-dex <ids>]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  MAX_DEX_NO,
  MAX_FORM_NO,
  encodeIdForm,
  isValidDexNo,
  isValidFormNo,
  parseExportedJsonObjectsFromTs,
  parsePokemonMasterEntriesFromTs,
  validatePokemonDbItems,
  validatePokemonDbPayload,
} from "./pokemon-db-validation.mjs";
import { splitPokemonNameAndForm } from "./pokemon-form-resolution.mjs";
import {
  KNOWN_INGREDIENT_KEYS,
  isIngredientsNullPokemon,
  loadIngredientsNullSet,
  resolveIngredientSlot,
} from "./pokemon-ingredient-resolution.mjs";
import { acquirePublishLocks } from "./publish-lock.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWN_INGREDIENT_KEY_SET = new Set(KNOWN_INGREDIENT_KEYS);

const VALID_SPECIALTIES = new Set(["Berries", "Ingredients", "Skills", "All"]);
const BERRY_JA_TO_TYPE = {
  "キーのみ": "Normal",
  "ヒメリのみ": "Fire",
  "オレンのみ": "Water",
  "ウブのみ": "Electric",
  "ドリのみ": "Grass",
  "チーゴのみ": "Ice",
  "クラボのみ": "Fighting",
  "カゴのみ": "Poison",
  "フィラのみ": "Ground",
  "シーヤのみ": "Flying",
  "マゴのみ": "Psychic",
  "ラムのみ": "Bug",
  "オボンのみ": "Rock",
  "ブリーのみ": "Ghost",
  "ヤチェのみ": "Dragon",
  "ウイのみ": "Dark",
  "ベリブのみ": "Steel",
  "モモンのみ": "Fairy",
};
const VALID_TYPES = new Set(Object.values(BERRY_JA_TO_TYPE));

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function normalize(s) {
  return String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function toIdForm(pokedexId, form) {
  return encodeIdForm(pokedexId, form);
}

function normalizeSpecialtyJa(s) {
  const t = normalize(s);
  if (t.includes("きのみ")) return "Berries";
  if (t.includes("食材")) return "Ingredients";
  if (t.includes("スキル")) return "Skills";
  if (t.includes("オール")) return "All";
  return null;
}

function normalizeBerryLabel(s) {
  const t0 = normalize(s);
  if (!t0) return null;
  if (/^spacer(\.gif)?$/i.test(t0)) return null;
  const t = t0.replace(/\.(png|gif|jpg|jpeg|webp)$/i, "");
  return t || null;
}

// ---------------------------------------------------------------------------
// Parse: PokemonIv.ts / pokemon-names.ts / pokemon-master.ts
// ---------------------------------------------------------------------------
function unwrapTsExpression(node) {
  let cur = node;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

/**
 * PokemonIv.ts の formMap 定義を TypeScript 構文解析で厳密に読み取る。
 * - コメント内の旧定義を無視し、実際の変数宣言だけを対象にする。
 * - 宣言自体の構文エラー（例: `1/**\/1` のトークン分離等）や小数（例: `11.5`）・未解釈値を切り詰めずにエラーにする。
 * @param {string} source
 * @returns {Record<string, number> | null}
 */
export function parseFormMapFromTs(source) {
  const sf = ts.createSourceFile("PokemonIv.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** @type {ts.VariableDeclaration[]} */
  const matches = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "formMap" &&
      node.initializer
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`PokemonIv.ts に formMap 宣言が複数あります (${matches.length} 件)`);
  }

  const decl = matches[0];
  const syntaxCheck = ts.transpileModule(`const ${decl.getText(sf)};`, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  });
  const syntaxErrors = (syntaxCheck.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (syntaxErrors.length > 0) {
    const msg = syntaxErrors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
      .join("; ");
    throw new Error(`PokemonIv.ts formMap に構文エラーがあります: ${msg}`);
  }

  const init = unwrapTsExpression(decl.initializer);
  if (!ts.isObjectLiteralExpression(init)) {
    throw new Error(
      `PokemonIv.ts formMap の初期化子がオブジェクトリテラルではありません: "${init.getText(sf)}"`,
    );
  }

  /** @type {Record<string, number>} */
  const entries = {};
  for (const prop of init.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      throw new Error(`PokemonIv.ts formMap のエントリを解釈できません: "${prop.getText(sf)}"`);
    }
    let key;
    if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) {
      key = prop.name.text;
    } else {
      throw new Error(`PokemonIv.ts formMap のキーを解釈できません: "${prop.name.getText(sf)}"`);
    }
    if (Object.hasOwn(entries, key)) {
      throw new Error(`PokemonIv.ts formMap に重複キーがあります: "${key}"`);
    }

    const valNode = unwrapTsExpression(prop.initializer);
    const rawValue = prop.initializer.getText(sf).trim();
    let num;
    if (ts.isNumericLiteral(valNode)) {
      num = Number(valNode.text);
    } else if (
      ts.isPrefixUnaryExpression(valNode) &&
      (valNode.operator === ts.SyntaxKind.MinusToken || valNode.operator === ts.SyntaxKind.PlusToken) &&
      ts.isNumericLiteral(valNode.operand)
    ) {
      const magnitude = Number(valNode.operand.text);
      num = valNode.operator === ts.SyntaxKind.MinusToken ? -magnitude : magnitude;
    } else {
      throw new Error(
        `PokemonIv.ts formMap["${key}"] の値を数値リテラルとして解釈できません: "${rawValue}"`,
      );
    }

    if (!isValidFormNo(num)) {
      throw new Error(
        `PokemonIv.ts formMap["${key}"]=${rawValue} は有効なフォーム番号 (0..${MAX_FORM_NO} の整数) ではありません`,
      );
    }
    entries[key] = num;
  }

  if (Object.keys(entries).length === 0) {
    throw new Error("PokemonIv.ts formMap にエントリがありません");
  }

  return entries;
}

/**
 * PokemonIv.ts の formNames 配列を TypeScript AST で厳密に読み取る。
 * - 配列の穴（OmittedExpression）や文字列リテラル以外の要素を詰めずにエラーにする。
 * @param {string} source
 * @returns {string[] | null}
 */
export function parseFormNamesArrayFromTs(source) {
  const sf = ts.createSourceFile("PokemonIv.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** @type {ts.VariableDeclaration[]} */
  const matches = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "formNames" &&
      node.initializer
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`PokemonIv.ts に formNames 宣言が複数あります (${matches.length} 件)`);
  }

  const decl = matches[0];
  const syntaxCheck = ts.transpileModule(`const ${decl.getText(sf)};`, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  });
  const syntaxErrors = (syntaxCheck.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (syntaxErrors.length > 0) {
    const msg = syntaxErrors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
      .join("; ");
    throw new Error(`PokemonIv.ts formNames に構文エラーがあります: ${msg}`);
  }

  const init = unwrapTsExpression(decl.initializer);
  if (!ts.isArrayLiteralExpression(init)) {
    throw new Error(
      `PokemonIv.ts formNames の初期化子が配列リテラルではありません: "${init.getText(sf)}"`,
    );
  }

  /** @type {string[]} */
  const names = [];
  for (let i = 0; i < init.elements.length; i++) {
    const el = init.elements[i];
    if (ts.isOmittedExpression(el)) {
      throw new Error(`PokemonIv.ts formNames[${i}] が欠落（配列の穴）しています`);
    }
    const unwrapped = unwrapTsExpression(el);
    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
      names[i] = unwrapped.text;
    } else {
      throw new Error(
        `PokemonIv.ts formNames[${i}] の要素を文字列リテラルとして解釈できません: "${el.getText(sf)}"`,
      );
    }
  }
  return names;
}

/**
 * pokemon-names.ts から生成済みマップ群を TypeScript AST で抽出する。
 * @param {string} namesTsContent
 */
export function parseGeneratedNamesIndex(namesTsContent) {
  const map = parseExportedJsonObjectsFromTs(
    namesTsContent,
    [
      "pokemonNameJaByIdForm",
      "pokemonIngredientsByIdForm",
      "pokemonSpecialtyByIdForm",
      "pokemonTypeByIdForm",
    ],
    "pokemon-names.ts",
  );
  return {
    nameJaByIdForm: map.get("pokemonNameJaByIdForm") ?? null,
    ingredientsByIdForm: map.get("pokemonIngredientsByIdForm") ?? null,
    specialtyByIdForm: map.get("pokemonSpecialtyByIdForm") ?? null,
    typeByIdForm: map.get("pokemonTypeByIdForm") ?? null,
  };
}

/**
 * 既存の pokemon-master.ts から dexNo 集合を TypeScript AST で厳密に抽出する。
 * ファイルが存在するのに構造欠損・空配列・JSON 破損がある場合は例外を送出する。
 * @param {string} masterTsContent
 * @param {string} [sourceLabel]
 */
export function extractExistingDexNosFromMasterTs(masterTsContent, sourceLabel = "pokemon-master.ts") {
  return new Set(parsePokemonMasterEntriesFromTs(masterTsContent, sourceLabel).map((e) => e.dexNo));
}

function buildEnToJaMap(formLabelJaToEn) {
  /** @type {Record<string, string[]>} */
  const m = {};
  for (const [ja, en] of Object.entries(formLabelJaToEn)) {
    if (!m[en]) m[en] = [];
    m[en].push(ja);
  }
  return m;
}

function extractWikiProfile(item) {
  const ingA = resolveIngredientSlot(item.ingAJa).key;
  const ingB = resolveIngredientSlot(item.ingBJa).key;
  const ingC = resolveIngredientSlot(item.ingCJa).key;
  const specialty = item.specialtyJa ? normalizeSpecialtyJa(item.specialtyJa) : null;
  const berryJa0 = Array.isArray(item.berryJa) ? normalizeBerryLabel(item.berryJa[0]) : null;
  const type = berryJa0 ? (BERRY_JA_TO_TYPE[berryJa0] ?? null) : null;
  return {
    specialty,
    type,
    ingredients: ingA && ingB ? { a: ingA, b: ingB, c: ingC ?? null } : null,
  };
}

function extractNitoyonProfile(p) {
  const ingA = typeof p?.ing1?.name === "string" ? p.ing1.name : null;
  const ingB = typeof p?.ing2?.name === "string" ? p.ing2.name : null;
  const ingC = typeof p?.ing3?.name === "string" ? p.ing3.name : null;
  const specialty = typeof p?.specialty === "string" ? p.specialty : null;
  return {
    specialty,
    ingredients: ingA && ingB ? { a: ingA, b: ingB, c: ingC ?? null } : null,
  };
}

function sameIngredients(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.a === b.a && a.b === b.b && (a.c ?? null) === (b.c ?? null);
}

function isValidIngredientsObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (typeof v.a !== "string" || !KNOWN_INGREDIENT_KEY_SET.has(v.a)) return false;
  if (typeof v.b !== "string" || !KNOWN_INGREDIENT_KEY_SET.has(v.b)) return false;
  if (v.c !== null && (typeof v.c !== "string" || !KNOWN_INGREDIENT_KEY_SET.has(v.c))) return false;
  return true;
}

function buildWikiByDex(wikiItems, formJaToNumber) {
  /** @type {Map<number, Array<{ nameJa: string, baseNameJa: string, form: number | null, formLabelJa: string | null, isUnknownForm: boolean, profile: ReturnType<typeof extractWikiProfile> }>>} */
  const wikiByDex = new Map();
  for (const item of wikiItems) {
    const dexNo = Number(item.dexNo);
    if (!Number.isFinite(dexNo)) continue;
    const parsed = splitPokemonNameAndForm(item.nameJa, formJaToNumber);
    const isUnknownForm = parsed.formLabelJa !== null && parsed.form === null;
    if (!wikiByDex.has(dexNo)) wikiByDex.set(dexNo, []);
    wikiByDex.get(dexNo).push({
      nameJa: normalize(item.nameJa),
      baseNameJa: parsed.baseNameJa,
      form: parsed.form,
      formLabelJa: parsed.formLabelJa,
      isUnknownForm,
      profile: extractWikiProfile(item),
    });
  }
  return wikiByDex;
}

function buildWikiFormsByDex(wikiByDex) {
  /** @type {Map<number, Set<number>>} */
  const map = new Map();
  for (const [dexNo, entries] of wikiByDex) {
    const forms = new Set();
    for (const e of entries) {
      if (e.form !== null) forms.add(e.form);
    }
    map.set(dexNo, forms);
  }
  return map;
}

/**
 * 同一 (dexNo, form) に複数行があるとき、利用フィールド（名前・とくい・タイプ・食材）が
 * すべて一致しているかを検証し、食い違いがあれば一覧を返す。
 */
function collectWikiDuplicateConflicts(wikiByDex) {
  /** @type {Array<{ dexNo: number, form: number, nameJa: string, diffs: string[] }>} */
  const conflicts = [];
  for (const [dexNo, entries] of wikiByDex) {
    /** @type {Map<number, typeof entries>} */
    const byForm = new Map();
    for (const entry of entries) {
      if (entry.form === null) continue;
      if (!byForm.has(entry.form)) byForm.set(entry.form, []);
      byForm.get(entry.form).push(entry);
    }
    for (const [form, group] of byForm) {
      if (group.length <= 1) continue;
      const base = group[0];
      for (let i = 1; i < group.length; i++) {
        const cur = group[i];
        const diffs = [];
        if (base.nameJa !== cur.nameJa) {
          diffs.push(`nameJa: "${base.nameJa}" !== "${cur.nameJa}"`);
        }
        if (base.profile.specialty !== cur.profile.specialty) {
          diffs.push(`specialty: ${JSON.stringify(base.profile.specialty)} !== ${JSON.stringify(cur.profile.specialty)}`);
        }
        if (base.profile.type !== cur.profile.type) {
          diffs.push(`type: ${JSON.stringify(base.profile.type)} !== ${JSON.stringify(cur.profile.type)}`);
        }
        if (!sameIngredients(base.profile.ingredients, cur.profile.ingredients)) {
          diffs.push(
            `ingredients: ${JSON.stringify(base.profile.ingredients)} !== ${JSON.stringify(cur.profile.ingredients)}`,
          );
        }
        if (diffs.length > 0) {
          conflicts.push({ dexNo, form, nameJa: base.nameJa, diffs });
        }
      }
    }
  }
  return conflicts;
}

function isFormResolvedDirectly(enName, nitoyonNum, enToJa, formJaToNumber) {
  const jaNames = enToJa[enName] || [];
  return jaNames.some((ja) => formJaToNumber[ja] === nitoyonNum);
}

function getObjectMeta(formAliases, key) {
  const raw = formAliases?.[key];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function getApprovedRemovalSet(formAliases, explicitAllowRemoved) {
  const set = new Set();
  const fromJson = formAliases?._approvedRemovals;
  if (Array.isArray(fromJson)) {
    for (const v of fromJson) {
      const n = Number(v);
      if (isValidDexNo(n)) set.add(n);
    }
  }
  if (explicitAllowRemoved) {
    for (const v of explicitAllowRemoved) {
      const n = Number(v);
      if (isValidDexNo(n)) set.add(n);
    }
  }
  return set;
}

function validateIngredientOverrideValue(aliasKey, overrideVal) {
  if (overrideVal === null) return { valid: true, value: null };
  if (
    overrideVal &&
    typeof overrideVal === "object" &&
    !Array.isArray(overrideVal) &&
    typeof overrideVal.a === "string" &&
    typeof overrideVal.b === "string" &&
    (overrideVal.c === null || overrideVal.c === undefined || typeof overrideVal.c === "string") &&
    KNOWN_INGREDIENT_KEY_SET.has(overrideVal.a) &&
    KNOWN_INGREDIENT_KEY_SET.has(overrideVal.b) &&
    (overrideVal.c === null || overrideVal.c === undefined || KNOWN_INGREDIENT_KEY_SET.has(overrideVal.c))
  ) {
    return {
      valid: true,
      value: { a: overrideVal.a, b: overrideVal.b, c: overrideVal.c ?? null },
    };
  }
  return {
    valid: false,
    error: `form-aliases.json の _ingredientOverrides["${aliasKey}"] が不正です: ${JSON.stringify(overrideVal)}`,
  };
}

/**
 * マッピング表に未登録の括弧付きフォーム名が残っている Wiki 行を検出する。
 */
function collectUnknownWikiFormIssues(wikiByDex) {
  /** @type {string[]} */
  const issues = [];
  const seen = new Set();
  for (const [dexNo, entries] of wikiByDex) {
    for (const entry of entries) {
      if (!entry.isUnknownForm) continue;
      const key = `${dexNo}:${entry.formLabelJa}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(
        `#${dexNo} ${entry.nameJa}: Wiki に未登録のフォーム括弧名「${entry.formLabelJa}」があります。scripts/form-ja-to-number.json / form-label-ja-to-en.json を確認してください`,
      );
    }
  }
  return issues;
}

/**
 * PokemonIv.ts の formMap と formNames 配列の双方向整合性（欠落スロット・添字ずれ）を検証する。
 */
function collectFormNamesIssues(nitoyonFormMap, nitoyonFormNames) {
  /** @type {string[]} */
  const issues = [];
  if (!Array.isArray(nitoyonFormNames)) return issues;

  for (const [enName, num] of Object.entries(nitoyonFormMap)) {
    const hasSlot = Object.hasOwn(nitoyonFormNames, num);
    const actual = hasSlot ? nitoyonFormNames[num] : undefined;
    if (!hasSlot || actual !== enName) {
      issues.push(
        `PokemonIv.ts 内部不整合: formMap["${enName}"]=${num}, formNames[${num}]=${hasSlot ? JSON.stringify(actual) : "(missing)"}`,
      );
    }
  }

  for (let i = 0; i < nitoyonFormNames.length; i++) {
    if (!Object.hasOwn(nitoyonFormNames, i) || typeof nitoyonFormNames[i] !== "string") {
      issues.push(`PokemonIv.ts formNames[${i}] が欠落または文字列ではありません`);
      continue;
    }
    const name = nitoyonFormNames[i];
    if (i === 0) {
      if (name !== "") {
        issues.push(`PokemonIv.ts 内部不整合: formNames[0]=${JSON.stringify(name)} は空文字列である必要があります`);
      }
      continue;
    }
    if (name !== "" && nitoyonFormMap[name] !== i) {
      issues.push(`PokemonIv.ts 内部不整合: formNames[${i}]="${name}" が formMap と一致しません`);
    }
  }

  return issues;
}

/**
 * すでに Wiki 側に直接行が存在する旧エイリアス、およびエイリアス本体がない孤立メタデータを検出する。
 * 直接行優先ルールを生成器と検証器で一致させ、旧エイリアス残存による誤上書き・誤検証を防ぐ。
 */
function collectStaleAliasIssues(formAliases, wikiFormsByDex) {
  /** @type {string[]} */
  const issues = [];
  const activeAliasKeys = new Set();

  for (const [key, rawTarget] of Object.entries(formAliases)) {
    if (key.startsWith("_")) continue;
    activeAliasKeys.add(key);
    const [dexStr, aliasFormStr] = key.split(":");
    const dexNo = Number(dexStr);
    const aliasForm = Number(aliasFormStr);
    if (!Number.isSafeInteger(dexNo) || !Number.isSafeInteger(aliasForm)) continue;

    if (wikiFormsByDex.get(dexNo)?.has(aliasForm)) {
      issues.push(
        `旧エイリアス "${key}":${String(rawTarget)} は不要です（Wiki に #${dexNo} form=${aliasForm} の直接行が存在します）。form-aliases.json から "${key}" と付随する _ingredientOverrides / _normalFallbackReasons を削除してください`,
      );
    }
  }

  for (const metaKey of ["_ingredientOverrides", "_normalFallbackReasons"]) {
    const meta = getObjectMeta(formAliases, metaKey);
    for (const k of Object.keys(meta)) {
      if (!activeAliasKeys.has(k)) {
        issues.push(
          `form-aliases.json の ${metaKey}["${k}"] に対応するエイリアス本体がありません。不要なエントリを削除してください`,
        );
      }
    }
  }

  return issues;
}

/**
 * 既登録エイリアスの妥当性を検証する。問題なければ null、不正ならエラー理由文字列を返す。
 */
function validateAliasTarget({
  dexNo,
  nitoyonEntry,
  targetForm,
  wikiEntries,
  wikiForms,
  formAliases,
}) {
  const aliasKey = `${dexNo}:${nitoyonEntry.formNum}`;
  if (typeof targetForm !== "number" || !Number.isInteger(targetForm)) {
    return `#${dexNo}: alias "${aliasKey}" の値が整数ではありません (${String(targetForm)})`;
  }
  if (!wikiForms || !wikiForms.has(targetForm)) {
    return `#${dexNo}: alias "${aliasKey}":${targetForm} の target form=${targetForm} が Wiki 側に存在しない。手動で form-aliases.json を確認してください`;
  }

  // 複数フォームを持つ種（Wiki に括弧付きフォームがある種）で target=0 へ向ける場合は、
  // 誤って通常フォームへフォールバックしないよう _normalFallbackReasons に明示的な根拠を要求する。
  const wikiHasFormedEntry = wikiEntries.some((e) => e.formLabelJa !== null);
  if (targetForm === 0 && wikiHasFormedEntry) {
    const reasons = getObjectMeta(formAliases, "_normalFallbackReasons");
    const reason = typeof reasons[aliasKey] === "string" ? reasons[aliasKey].trim() : "";
    if (!reason) {
      return `#${dexNo} ${nitoyonEntry.name}: 複数フォームを持つ種で alias "${aliasKey}":0 を指定していますが _normalFallbackReasons に根拠がありません。正しい対応先フォーム（例: ハロウィンなら 1）か根拠を form-aliases.json に明記してください`;
    }
  }

  const targetEntries = wikiEntries.filter((e) => e.form === targetForm);
  const ingredientOverrides = getObjectMeta(formAliases, "_ingredientOverrides");
  const hasIngredientOverride = Object.hasOwn(ingredientOverrides, aliasKey);

  // とくいの一致検証
  if (nitoyonEntry.profile.specialty && targetEntries.length > 0) {
    const specMismatch = targetEntries.some(
      (e) => e.profile.specialty && e.profile.specialty !== nitoyonEntry.profile.specialty,
    );
    if (specMismatch) {
      return `#${dexNo} ${nitoyonEntry.name}: alias "${aliasKey}":${targetForm} はとくいが一致しません (にとよん=${nitoyonEntry.profile.specialty}, Wiki=${targetEntries.map((e) => e.profile.specialty).join(",")})`;
    }
  }

  // 食材の一致検証（_ingredientOverrides がある場合は固有食材を検証、無ければ canonical の食材と一致必須）
  if (hasIngredientOverride) {
    const checked = validateIngredientOverrideValue(aliasKey, ingredientOverrides[aliasKey]);
    if (!checked.valid) return checked.error;
    if (
      checked.value !== null &&
      nitoyonEntry.profile.ingredients &&
      !sameIngredients(checked.value, nitoyonEntry.profile.ingredients)
    ) {
      return `#${dexNo} ${nitoyonEntry.name}: _ingredientOverrides["${aliasKey}"] (${JSON.stringify(checked.value)}) が pokesleep-tool の食材 (${JSON.stringify(nitoyonEntry.profile.ingredients)}) と一致しません`;
    }
  } else if (nitoyonEntry.profile.ingredients && targetEntries.length > 0) {
    const wikiHasIng = targetEntries.some((e) => e.profile.ingredients !== null);
    const anyMismatch = targetEntries.some(
      (e) => e.profile.ingredients !== null && !sameIngredients(e.profile.ingredients, nitoyonEntry.profile.ingredients),
    );
    if (wikiHasIng && anyMismatch) {
      const betterForms = [
        ...new Set(
          wikiEntries
            .filter(
              (e) =>
                e.form !== null &&
                e.form !== targetForm &&
                e.profile.ingredients !== null &&
                sameIngredients(e.profile.ingredients, nitoyonEntry.profile.ingredients),
            )
            .map((e) => e.form),
        ),
      ].sort((a, b) => a - b);
      const hint = betterForms.length > 0
        ? `（一致する候補 form=[${betterForms.join(", ")}]）`
        : "（Wiki に一致フォームが無い場合は _ingredientOverrides で固有食材または null を設定してください）";
      return `#${dexNo} ${nitoyonEntry.name}: alias "${aliasKey}":${targetForm} は食材が一致しません${hint}`;
    }
  }

  return null;
}

/**
 * formMap のエントリ（例: Halloween2=12）が form-ja-to-number.json に直接無くても、
 * そのフォームを持つ pokemon.json 上の対象ポケモンが妥当な form-aliases.json 経由で
 * Wiki 側のフォームへ解決できているかを判定する。
 * - 元々 pokemon.json に対象ポケモンが 0 件なら空真にせず false。
 * - 明示承認で実際に Wiki から消えた種は対象から除外し、承認削除の結果 0 件になった場合は true。
 */
function isFormResolvedByAliases({
  enName,
  nitoyonNum,
  nitoyonByFormEn,
  wikiByDex,
  wikiFormsByDex,
  formAliases,
  approvedRemovedInWiki,
}) {
  const members = nitoyonByFormEn.get(enName) || [];
  if (members.length === 0) return false;
  const activeMembers = members.filter((m) => !approvedRemovedInWiki.has(m.id));
  if (activeMembers.length === 0) return true;
  return activeMembers.every((member) => {
    const wikiEntries = wikiByDex.get(member.id);
    const wikiForms = wikiFormsByDex.get(member.id);
    if (!wikiEntries || !wikiForms) return false;
    if (wikiForms.has(nitoyonNum)) return true;
    const aliasKey = `${member.id}:${nitoyonNum}`;
    if (!Object.hasOwn(formAliases, aliasKey)) return false;
    return (
      validateAliasTarget({
        dexNo: member.id,
        nitoyonEntry: member,
        targetForm: formAliases[aliasKey],
        wikiEntries,
        wikiForms,
        formAliases,
      }) === null
    );
  });
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * 生成済み pokemon-names.ts に対し、必須4マップの存在と、通常フォーム・エイリアス双方の
 * 名前・とくい・タイプ・食材の妥当性および Wiki 期待値との一致を厳格に検証する。
 */
function collectGeneratedIndexIssues({
  nitoyonByDex,
  wikiByDex,
  wikiFormsByDex,
  formAliases,
  parsedGeneratedIndex,
  ingredientsNullSet,
}) {
  /** @type {string[]} */
  const issues = [];

  if (!parsedGeneratedIndex) {
    issues.push("pokemon-names.ts を読み込めないため、生成済み索引を検証できません");
    return issues;
  }

  const {
    nameJaByIdForm,
    ingredientsByIdForm,
    specialtyByIdForm,
    typeByIdForm,
  } = parsedGeneratedIndex;

  const missingMaps = [];
  if (!nameJaByIdForm) missingMaps.push("pokemonNameJaByIdForm");
  if (!ingredientsByIdForm) missingMaps.push("pokemonIngredientsByIdForm");
  if (!specialtyByIdForm) missingMaps.push("pokemonSpecialtyByIdForm");
  if (!typeByIdForm) missingMaps.push("pokemonTypeByIdForm");
  if (missingMaps.length > 0) {
    issues.push(`pokemon-names.ts の必須マップが欠落またはパース不能です: ${missingMaps.join(", ")}`);
    return issues;
  }

  const ingredientOverrides = getObjectMeta(formAliases, "_ingredientOverrides");
  const checkedIdForms = new Set();
  const expectedIdFormKeys = new Set();

  function verifySingleIdForm({
    label,
    dexNo,
    idForm,
    canonicalForm,
    wikiExpected,
    aliasKey,
  }) {
    const keyStr = String(idForm);
    if (checkedIdForms.has(keyStr)) return;
    checkedIdForms.add(keyStr);
    expectedIdFormKeys.add(keyStr);

    const actualName = nameJaByIdForm[keyStr];
    if (!isNonEmptyString(actualName)) {
      issues.push(`${label} (idForm=${keyStr}): pokemonNameJaByIdForm に未登録です`);
    } else if (wikiExpected && actualName !== wikiExpected.nameJa) {
      issues.push(`${label} (idForm=${keyStr}): 名前が不一致です ("${actualName}" !== "${wikiExpected.nameJa}")`);
    }

    const actualSpec = specialtyByIdForm[keyStr];
    if (!isNonEmptyString(actualSpec) || !VALID_SPECIALTIES.has(actualSpec)) {
      issues.push(`${label} (idForm=${keyStr}): pokemonSpecialtyByIdForm が不正または欠落しています (${String(actualSpec)})`);
    } else if (wikiExpected?.profile.specialty && actualSpec !== wikiExpected.profile.specialty) {
      issues.push(
        `${label} (idForm=${keyStr}): とくいが不一致です ("${actualSpec}" !== "${wikiExpected.profile.specialty}")`,
      );
    }

    const actualType = typeByIdForm[keyStr];
    if (!isNonEmptyString(actualType) || !VALID_TYPES.has(actualType)) {
      issues.push(`${label} (idForm=${keyStr}): pokemonTypeByIdForm が不正または欠落しています (${String(actualType)})`);
    } else if (wikiExpected?.profile.type && actualType !== wikiExpected.profile.type) {
      issues.push(
        `${label} (idForm=${keyStr}): タイプが不一致です ("${actualType}" !== "${wikiExpected.profile.type}")`,
      );
    }

    const hasOverride = aliasKey !== null && Object.hasOwn(ingredientOverrides, aliasKey);
    const actualIng = Object.hasOwn(ingredientsByIdForm, keyStr) ? ingredientsByIdForm[keyStr] : null;
    if (hasOverride) {
      const checked = validateIngredientOverrideValue(aliasKey, ingredientOverrides[aliasKey]);
      if (checked.valid) {
        if (checked.value === null) {
          if (actualIng !== null) {
            issues.push(`${label} (idForm=${keyStr}): _ingredientOverrides は null ですが食材が存在します (${JSON.stringify(actualIng)})`);
          }
        } else if (!isValidIngredientsObject(actualIng) || !sameIngredients(actualIng, checked.value)) {
          issues.push(
            `${label} (idForm=${keyStr}): 食材が _ingredientOverrides と不一致です (${JSON.stringify(actualIng)} !== ${JSON.stringify(checked.value)})`,
          );
        }
      }
      return;
    }

    const allowNull = isIngredientsNullPokemon(dexNo, canonicalForm, ingredientsNullSet);
    if (allowNull) {
      if (actualIng !== null) {
        issues.push(`${label} (idForm=${keyStr}): 幻ポケモン(null固定)に食材が存在します (${JSON.stringify(actualIng)})`);
      }
      return;
    }

    if (!isValidIngredientsObject(actualIng)) {
      issues.push(`${label} (idForm=${keyStr}): pokemonIngredientsByIdForm の形またはキーが不正です (${JSON.stringify(actualIng)})`);
      return;
    }
    if (wikiExpected?.profile.ingredients && !sameIngredients(actualIng, wikiExpected.profile.ingredients)) {
      issues.push(
        `${label} (idForm=${keyStr}): 食材が Wiki 期待値と不一致です (${JSON.stringify(actualIng)} !== ${JSON.stringify(wikiExpected.profile.ingredients)})`,
      );
    }
  }

  // 1. Wiki に存在する全通常/直接フォームを厳格検証
  for (const [dexNo, entries] of wikiByDex) {
    for (const entry of entries) {
      if (entry.form === null) continue;
      verifySingleIdForm({
        label: `#${dexNo} ${entry.nameJa}`,
        dexNo,
        idForm: toIdForm(dexNo, entry.form),
        canonicalForm: entry.form,
        wikiExpected: entry,
        aliasKey: null,
      });
    }
  }

  // 2. form-aliases.json の各エイリアス（直接行が無い有効エイリアスのみ）を厳格検証
  for (const [key, rawTarget] of Object.entries(formAliases)) {
    if (key.startsWith("_")) continue;
    const [dexStr, aliasFormStr] = key.split(":");
    const dexNo = Number(dexStr);
    const aliasForm = Number(aliasFormStr);
    const targetForm = Number(rawTarget);
    if (!Number.isFinite(dexNo) || !Number.isFinite(aliasForm) || !Number.isFinite(targetForm)) continue;
    if (aliasForm === targetForm) continue;
    // 直接行がある旧エイリアスは collectStaleAliasIssues で別途エラーになる
    if (wikiFormsByDex.get(dexNo)?.has(aliasForm)) continue;
    const targetEntry = (wikiByDex.get(dexNo) || []).find((e) => e.form === targetForm) ?? null;
    if (!targetEntry) continue;

    verifySingleIdForm({
      label: `alias "${key}":${targetForm}`,
      dexNo,
      idForm: toIdForm(dexNo, aliasForm),
      canonicalForm: targetForm,
      wikiExpected: targetEntry,
      aliasKey: key,
    });
  }

  // 3. pokemon.json かつ Wiki に存在する全レコードが索引に存在することを確認
  for (const [dexNo, entries] of nitoyonByDex) {
    const wikiForms = wikiFormsByDex.get(dexNo);
    if (!wikiForms || wikiForms.size === 0) continue;

    for (const entry of entries) {
      if (entry.isUnknownNitoyonForm) continue;
      const idForm = toIdForm(dexNo, entry.formNum);
      if (checkedIdForms.has(String(idForm))) continue;
      const aliasKey = `${dexNo}:${entry.formNum}`;
      const canonicalForm = Object.hasOwn(formAliases, aliasKey)
        ? Number(formAliases[aliasKey])
        : entry.formNum;
      const wikiExpected = (wikiByDex.get(dexNo) || []).find((e) => e.form === canonicalForm) ?? null;
      verifySingleIdForm({
        label: `#${dexNo} ${entry.name}${entry.form ? ` form="${entry.form}"(=${entry.formNum})` : ""}`,
        dexNo,
        idForm,
        canonicalForm,
        wikiExpected,
        aliasKey: Object.hasOwn(formAliases, aliasKey) ? aliasKey : null,
      });
    }
  }

  // 4. 双方向検査: 期待集合に含まれない余剰キー（承認削除済みの種・廃止エイリアス等の残存）を全4マップで検出
  for (const [mapName, mapObj] of [
    ["pokemonNameJaByIdForm", nameJaByIdForm],
    ["pokemonSpecialtyByIdForm", specialtyByIdForm],
    ["pokemonTypeByIdForm", typeByIdForm],
    ["pokemonIngredientsByIdForm", ingredientsByIdForm],
  ]) {
    for (const key of Object.keys(mapObj)) {
      if (!expectedIdFormKeys.has(key)) {
        issues.push(`${mapName} に余剰キー (idForm=${key}) が残っています`);
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Core verification & auto-fix (pure, testable)
// ---------------------------------------------------------------------------
/**
 * @param {{
 *   pokemonList: Array<{ id?: number, name?: string, form?: string | null, specialty?: string, ing1?: { name?: string }, ing2?: { name?: string }, ing3?: { name?: string } }>,
 *   nitoyonFormMap: Record<string, number>,
 *   nitoyonFormNames?: string[] | null,
 *   wikiItems?: Array<{ dexNo: number, nameJa: string, specialtyJa?: string | null, berryJa?: string[] | null, ingAJa?: string[] | null, ingBJa?: string[] | null, ingCJa?: string[] | null }>,
 *   hasPokemonDb?: boolean,
 *   formJaToNumber?: Record<string, number>,
 *   formLabelJaToEn?: Record<string, string>,
 *   formAliases?: Record<string, unknown>,
 *   parsedGeneratedIndex?: ReturnType<typeof parseGeneratedNamesIndex> | null,
 *   existingMasterDexNos?: Iterable<number> | null,
 *   allowRemovedDexNos?: Iterable<number> | null,
 *   ingredientsNullSet?: Set<string>,
 *   verifyGenerated?: boolean,
 * }} options
 */
export function verifyAndFixFormMapping({
  pokemonList,
  nitoyonFormMap,
  nitoyonFormNames = null,
  wikiItems = [],
  hasPokemonDb = true,
  formJaToNumber: initialFormJaToNumber = {},
  formLabelJaToEn: initialFormLabelJaToEn = {},
  formAliases: initialFormAliases = {},
  parsedGeneratedIndex = null,
  existingMasterDexNos = null,
  allowRemovedDexNos = null,
  ingredientsNullSet = loadIngredientsNullSet(),
  verifyGenerated = false,
}) {
  /** @type {Record<string, number>} */
  const formJaToNumber = { ...initialFormJaToNumber };
  /** @type {Record<string, string>} */
  const formLabelJaToEn = { ...initialFormLabelJaToEn };
  /** @type {Record<string, unknown>} */
  const formAliases = { ...initialFormAliases };

  /** @type {string[]} */
  const logs = [];
  const log = (line = "") => logs.push(line);
  /** @type {Array<{ file: string, action: string, detail: string }>} */
  const fixes = [];
  /** @type {Array<{ message: string }>} */
  const unfixable = [];

  function addFix(file, action, detail) {
    fixes.push({ file, action, detail });
    log(`  [AUTO-FIX] ${file}: ${action} — ${detail}`);
  }

  // 前提不足: Wiki DB が無い状態で括弧名調査を装って誤判定しない
  if (!hasPokemonDb) {
    const msg = "Wiki pokemon-db.json が未生成のためフォーム突合を実行できません。先に generate:pokemon-db を実行するか --db を指定してください";
    unfixable.push({ message: msg });
    log("=== フォーム番号 3ソース突合 & 自動修正 ===\n");
    log(`  [UNFIXABLE] ${msg}`);
    log(`  [ERROR] ${msg}`);
    return {
      formJaToNumber,
      formLabelJaToEn,
      formAliases,
      fixes,
      unfixable,
      finalErrors: 1,
      needsRegenerate: false,
      skipped: false,
      logs,
    };
  }

  // 共通の入力境界バリデータで空・不正型 DB を拒否
  try {
    validatePokemonDbItems(wikiItems, "pokemon-db.json", { allowEmpty: false });
  } catch (err) {
    const msg = `入力 DB が不正です: ${err instanceof Error ? err.message : String(err)}`;
    unfixable.push({ message: msg });
    log("=== フォーム番号 3ソース突合 & 自動修正 ===\n");
    log(`  [UNFIXABLE] ${msg}`);
    log(`  [ERROR] ${msg}`);
    return {
      formJaToNumber,
      formLabelJaToEn,
      formAliases,
      fixes,
      unfixable,
      finalErrors: 1,
      needsRegenerate: false,
      skipped: false,
      logs,
    };
  }

  // pokesleep-tool・マッピング表の ID / フォーム番号が idForm 符号化範囲（dexNo: 1..4095, form: 0..524287）に収まるかを検証
  /** @type {string[]} */
  const idBoundsIssues = [];
  for (const [enName, num] of Object.entries(nitoyonFormMap)) {
    if (!isValidFormNo(num)) {
      idBoundsIssues.push(
        `PokemonIv.ts formMap["${enName}"]=${String(num)} が有効範囲 (0..${MAX_FORM_NO}) 外です`,
      );
    }
  }
  for (const [jaLabel, num] of Object.entries(formJaToNumber)) {
    if (!isValidFormNo(num)) {
      idBoundsIssues.push(
        `form-ja-to-number.json の "${jaLabel}": ${String(num)} が有効範囲 (0..${MAX_FORM_NO}) 外です`,
      );
    }
  }
  for (const [key, rawTarget] of Object.entries(formAliases)) {
    if (key.startsWith("_")) continue;
    const parts = key.split(":");
    const d = parts.length === 2 && /^\d+$/.test(parts[0]) ? Number(parts[0]) : NaN;
    const af = parts.length === 2 && /^\d+$/.test(parts[1]) ? Number(parts[1]) : NaN;
    if (!isValidDexNo(d) || !isValidFormNo(af) || !isValidFormNo(rawTarget)) {
      idBoundsIssues.push(
        `form-aliases.json の "${key}": ${JSON.stringify(rawTarget)} が有効範囲 (dexNo: 1..${MAX_DEX_NO}, form: 0..${MAX_FORM_NO}) 外です`,
      );
    }
  }

  // pokesleep-tool のデータを整理（formMap に無い非空フォームは 0 に丸めず未知として保持）
  const nitoyonFormedPokemon = [];
  const nitoyonByDex = new Map();
  const nitoyonByFormEn = new Map();
  const unknownNitoyonForms = new Map();

  for (const p of pokemonList) {
    if (!p || typeof p !== "object") continue;
    const id = p.id;
    if (!isValidDexNo(id)) {
      idBoundsIssues.push(
        `pokemon.json の "${String(p.name ?? "")}" の id=${JSON.stringify(p.id)} が有効範囲 (1..${MAX_DEX_NO}) 外または数値ではありません`,
      );
      continue;
    }
    const formStr = p.form ? String(p.form) : null;
    const isUnknownNitoyonForm = formStr !== null && !Object.hasOwn(nitoyonFormMap, formStr);
    const rawFormNum = formStr && !isUnknownNitoyonForm ? nitoyonFormMap[formStr] : 0;
    const hasInvalidFormNum = formStr !== null && !isUnknownNitoyonForm && !isValidFormNo(rawFormNum);
    if (hasInvalidFormNum) continue;
    const formNum = formStr
      ? (isUnknownNitoyonForm ? -1 : Number(rawFormNum))
      : 0;
    const entry = {
      id,
      name: String(p.name ?? `#${id}`),
      form: formStr,
      formNum,
      isUnknownNitoyonForm,
      profile: extractNitoyonProfile(p),
    };
    if (!nitoyonByDex.has(id)) nitoyonByDex.set(id, []);
    nitoyonByDex.get(id).push(entry);
    if (formStr) {
      nitoyonFormedPokemon.push({ id, name: entry.name, form: formStr });
      if (!nitoyonByFormEn.has(formStr)) nitoyonByFormEn.set(formStr, []);
      nitoyonByFormEn.get(formStr).push(entry);
      if (isUnknownNitoyonForm) {
        if (!unknownNitoyonForms.has(formStr)) unknownNitoyonForms.set(formStr, []);
        unknownNitoyonForms.get(formStr).push({ id, name: entry.name });
      }
    }
  }

  if (idBoundsIssues.length > 0) {
    log("=== フォーム番号 3ソース突合 & 自動修正 ===\n");
    log("--- Phase 0: ID / フォーム番号範囲チェック ---");
    for (const msg of idBoundsIssues) {
      unfixable.push({ message: msg });
      log(`  [UNFIXABLE] ${msg}`);
      log(`  [ERROR] ${msg}`);
    }
    return {
      formJaToNumber,
      formLabelJaToEn,
      formAliases,
      fixes,
      unfixable,
      finalErrors: idBoundsIssues.length,
      needsRegenerate: false,
      skipped: false,
      logs,
    };
  }

  // 既存マスターの dexNo 集合（明示指定がなければ parsedGeneratedIndex から導出）
  const existingDexSet = new Set();
  if (existingMasterDexNos) {
    for (const d of existingMasterDexNos) {
      const n = Number(d);
      if (Number.isSafeInteger(n) && n > 0) existingDexSet.add(n);
    }
  } else if (parsedGeneratedIndex?.nameJaByIdForm) {
    for (const k of Object.keys(parsedGeneratedIndex.nameJaByIdForm)) {
      const idForm = Number(k);
      if (Number.isSafeInteger(idForm) && idForm > 0) {
        existingDexSet.add(idForm & 0xfff);
      }
    }
  }
  const approvedRemovalSet = getApprovedRemovalSet(formAliases, allowRemovedDexNos);

  const initialWikiByDex = buildWikiByDex(wikiItems, formJaToNumber);
  const initialWikiFormsByDex = buildWikiFormsByDex(initialWikiByDex);
  const initialWikiConflicts = collectWikiDuplicateConflicts(initialWikiByDex);
  const initialUnknownWikiForms = collectUnknownWikiFormIssues(initialWikiByDex);
  const initialStaleAliases = collectStaleAliasIssues(formAliases, initialWikiFormsByDex);
  const formNamesIssues = collectFormNamesIssues(nitoyonFormMap, nitoyonFormNames);

  // 明示承認され、かつ実際に Wiki から消えた種集合（フォーム照合対象からも除外する）
  const approvedRemovedInWiki = new Set(
    [...approvedRemovalSet].filter((dexNo) => !initialWikiByDex.has(dexNo)),
  );

  // 既存マスターにあり pokesleep-tool にも残っているのに Wiki から消失した種を検出
  const vanishedDexNos = [...existingDexSet]
    .filter((dexNo) => nitoyonByDex.has(dexNo) && !initialWikiByDex.has(dexNo) && !approvedRemovalSet.has(dexNo))
    .sort((a, b) => a - b);

  // 生成済み索引（pokemon-names.ts）との差分を確認（早期リターン対象から外して毎回確認）
  const initialGeneratedIssues = parsedGeneratedIndex || verifyGenerated
    ? collectGeneratedIndexIssues({
        nitoyonByDex,
        wikiByDex: initialWikiByDex,
        wikiFormsByDex: initialWikiFormsByDex,
        formAliases,
        parsedGeneratedIndex,
        ingredientsNullSet,
      })
    : [];

  // Pre-check
  function checkNeedsWork() {
    if (unknownNitoyonForms.size > 0) return true;
    if (initialWikiConflicts.length > 0) return true;
    if (initialUnknownWikiForms.length > 0) return true;
    if (initialStaleAliases.length > 0) return true;
    if (formNamesIssues.length > 0) return true;
    if (vanishedDexNos.length > 0) return true;
    if (initialGeneratedIssues.length > 0) return true;

    const enToJa0 = buildEnToJaMap(formLabelJaToEn);
    for (const [enName, nitoyonNum] of Object.entries(nitoyonFormMap)) {
      if (isFormResolvedDirectly(enName, nitoyonNum, enToJa0, formJaToNumber)) continue;
      if (
        isFormResolvedByAliases({
          enName,
          nitoyonNum,
          nitoyonByFormEn,
          wikiByDex: initialWikiByDex,
          wikiFormsByDex: initialWikiFormsByDex,
          formAliases,
          approvedRemovedInWiki,
        })
      ) {
        continue;
      }
      return true;
    }

    for (const [dexNo, nitoyonEntries] of nitoyonByDex) {
      const wikiEntries = initialWikiByDex.get(dexNo);
      const wikiForms = initialWikiFormsByDex.get(dexNo);
      if (!wikiEntries || !wikiForms) continue;
      for (const ne of nitoyonEntries) {
        if (ne.isUnknownNitoyonForm) return true;
        if (wikiForms.has(ne.formNum)) continue;
        const aliasKey = `${dexNo}:${ne.formNum}`;
        if (!Object.hasOwn(formAliases, aliasKey)) return true;
        const aliasErr = validateAliasTarget({
          dexNo,
          nitoyonEntry: ne,
          targetForm: formAliases[aliasKey],
          wikiEntries,
          wikiForms,
          formAliases,
        });
        if (aliasErr !== null) return true;
      }
    }

    return false;
  }

  if (!checkNeedsWork()) {
    log("[SUMMARY] fixes=0 unfixable=0 errors=0 needs_regenerate=false skipped=true");
    return {
      formJaToNumber,
      formLabelJaToEn,
      formAliases,
      fixes: [],
      unfixable: [],
      finalErrors: 0,
      needsRegenerate: false,
      skipped: true,
      logs,
    };
  }

  log("=== フォーム番号 3ソース突合 & 自動修正 ===\n");
  log("データソース:");
  log(`  A) Wiki pokemon-db.json:   ${wikiItems.length} ポケモン`);
  log(`  B) PokemonIv.ts formMap:   ${Object.keys(nitoyonFormMap).length} エントリ`);
  log(`  C) pokemon.json:           ${nitoyonFormedPokemon.length} フォーム付きレコード`);
  log(`  *) form-aliases.json:      ${Object.keys(formAliases).filter((k) => !k.startsWith("_")).length} エイリアス`);
  log();

  // -------------------------------------------------------------------------
  // Phase 0: 入力整合チェック（にとよん未知フォーム・formNames整合・Wiki重複矛盾・種消失）
  // -------------------------------------------------------------------------
  if (
    unknownNitoyonForms.size > 0 ||
    formNamesIssues.length > 0 ||
    initialWikiConflicts.length > 0 ||
    vanishedDexNos.length > 0
  ) {
    log("--- Phase 0: 入力データ整合チェック ---");
    for (const [formStr, refs] of unknownNitoyonForms) {
      const examples = refs.slice(0, 5).map((r) => `#${r.id} ${r.name}`).join(", ");
      const msg = `pokemon.json の form="${formStr}" が PokemonIv.ts の formMap に存在しません (例: ${examples})`;
      unfixable.push({ message: msg });
      log(`  [UNFIXABLE] ${msg}`);
    }
    for (const issue of formNamesIssues) {
      unfixable.push({ message: issue });
      log(`  [UNFIXABLE] ${issue}`);
    }
    for (const c of initialWikiConflicts) {
      const msg = `Wiki 重複行矛盾 #${c.dexNo} form=${c.form} (${c.nameJa}): ${c.diffs.join(" / ")}`;
      unfixable.push({ message: msg });
      log(`  [UNFIXABLE] ${msg}`);
    }
    for (const dexNo of vanishedDexNos) {
      const names = (nitoyonByDex.get(dexNo) || []).map((e) => e.name).slice(0, 2).join(", ");
      const msg = `既存種 #${dexNo} (${names}) が Wiki スナップショットから消失していますが pokesleep-tool には残っています（意図的な削除なら --allow-removed-dex または _approvedRemovals で明示承認してください）`;
      unfixable.push({ message: msg });
      log(`  [UNFIXABLE] ${msg}`);
    }
    log();
  }

  // -------------------------------------------------------------------------
  // Phase 1: PokemonIv.ts formMap → マッピングテーブル同期
  // -------------------------------------------------------------------------
  log("--- Phase 1: PokemonIv.ts formMap → マッピングテーブル同期 ---");

  let phase1Changed = false;
  let enToJa = buildEnToJaMap(formLabelJaToEn);

  // まず既知の英語名で番号ズレだけを修正しておく
  for (const [enName, nitoyonNum] of Object.entries(nitoyonFormMap)) {
    const existingJaNames = enToJa[enName] || [];
    if (existingJaNames.length === 0) continue;
    const registeredNums = existingJaNames
      .map((ja) => formJaToNumber[ja])
      .filter((n) => n !== undefined);
    if (registeredNums.includes(nitoyonNum)) continue;
    for (const ja of existingJaNames) {
      if (formJaToNumber[ja] !== undefined && formJaToNumber[ja] !== nitoyonNum) {
        const oldNum = formJaToNumber[ja];
        formJaToNumber[ja] = nitoyonNum;
        addFix("form-ja-to-number.json", "番号修正", `"${ja}": ${nitoyonNum} (was ${oldNum})`);
        phase1Changed = true;
      }
    }
  }

  const wikiByDexAfterNumFix = buildWikiByDex(wikiItems, formJaToNumber);
  const wikiFormsAfterNumFix = buildWikiFormsByDex(wikiByDexAfterNumFix);

  // 既知の対応（直接一致・有効な alias）を先に消し込み、残差が一意に決まる候補と種ごとの衝突を集める
  /** @type {Map<string, Set<string>>} */
  const newCandidatesByEn = new Map();
  /** @type {Map<string, Array<{ dexNo: number, jaName: string, existingNum: number | undefined, existingEn: string | undefined }>>} */
  const conflictsByEn = new Map();
  /** @type {Map<string, number[]>} */
  const ambiguousSpeciesByEn = new Map();

  for (const [dexNo, nitoyonEntries] of nitoyonByDex) {
    const formedNitoyon = nitoyonEntries.filter((e) => e.form !== null && !e.isUnknownNitoyonForm);
    if (formedNitoyon.length === 0) continue;

    const wikiEntries = wikiByDexAfterNumFix.get(dexNo);
    const wikiForms = wikiFormsAfterNumFix.get(dexNo);
    if (!wikiEntries || !wikiForms) continue;

    const remainingWikiFormed = wikiEntries
      .filter((e) => e.formLabelJa !== null)
      .map((e) => ({ ...e, consumed: false }));

    const unresolvedNitoyon = [];
    for (const ne of formedNitoyon) {
      const matchedDirect = remainingWikiFormed.find(
        (w) =>
          !w.consumed &&
          w.form === ne.formNum &&
          isFormResolvedDirectly(ne.form, ne.formNum, enToJa, formJaToNumber),
      );
      if (matchedDirect) {
        matchedDirect.consumed = true;
        continue;
      }

      const aliasKey = `${dexNo}:${ne.formNum}`;
      if (Object.hasOwn(formAliases, aliasKey)) {
        const target = formAliases[aliasKey];
        const aliasErr = validateAliasTarget({
          dexNo,
          nitoyonEntry: ne,
          targetForm: target,
          wikiEntries,
          wikiForms,
          formAliases,
        });
        if (aliasErr === null) {
          const matchedAlias = remainingWikiFormed.find((w) => !w.consumed && w.form === target);
          if (matchedAlias) matchedAlias.consumed = true;
          continue;
        }
      }

      unresolvedNitoyon.push(ne);
    }

    if (unresolvedNitoyon.length === 0) continue;

    const remainingWiki = remainingWikiFormed.filter((w) => !w.consumed);
    const unresolvedEnNames = [...new Set(unresolvedNitoyon.map((e) => e.form))];
    const remainingWikiLabels = [...new Set(remainingWiki.map((w) => w.formLabelJa))];

    if (unresolvedEnNames.length === 1 && remainingWikiLabels.length === 1) {
      const enName = unresolvedEnNames[0];
      const jaName = remainingWikiLabels[0];
      const hasNum = Object.hasOwn(formJaToNumber, jaName);
      const hasEn = Object.hasOwn(formLabelJaToEn, jaName);
      if (hasNum || hasEn) {
        if (!conflictsByEn.has(enName)) conflictsByEn.set(enName, []);
        conflictsByEn.get(enName).push({
          dexNo,
          jaName,
          existingNum: formJaToNumber[jaName],
          existingEn: formLabelJaToEn[jaName],
        });
      } else {
        if (!newCandidatesByEn.has(enName)) newCandidatesByEn.set(enName, new Set());
        newCandidatesByEn.get(enName).add(jaName);
      }
    } else {
      for (const enName of unresolvedEnNames) {
        if (!ambiguousSpeciesByEn.has(enName)) ambiguousSpeciesByEn.set(enName, []);
        ambiguousSpeciesByEn.get(enName).push(dexNo);
      }
    }
  }

  // 新規候補同士の日本語ラベル衝突を一括検査してから反映する
  /** @type {Array<{ enName: string, nitoyonNum: number, jaName: string }>} */
  const pendingNewRegistrations = [];
  /** @type {Map<string, Array<{ enName: string, nitoyonNum: number }>>} */
  const pendingByJaLabel = new Map();

  for (const [enName, nitoyonNum] of Object.entries(nitoyonFormMap)) {
    if (isFormResolvedDirectly(enName, nitoyonNum, enToJa, formJaToNumber)) continue;
    if (
      isFormResolvedByAliases({
        enName,
        nitoyonNum,
        nitoyonByFormEn,
        wikiByDex: wikiByDexAfterNumFix,
        wikiFormsByDex: wikiFormsAfterNumFix,
        formAliases,
        approvedRemovedInWiki,
      })
    ) {
      continue;
    }

    const conflicts = conflictsByEn.get(enName) || [];
    const candidates = newCandidatesByEn.get(enName) || new Set();
    const ambiguousSpecies = ambiguousSpeciesByEn.get(enName) || [];

    if (conflicts.length > 0) {
      const detail = conflicts
        .map((c) => `#${c.dexNo} "${c.jaName}" (既登録: form=${c.existingNum}, en="${c.existingEn}")`)
        .join(", ");
      const candidateNote = candidates.size > 0 ? ` / 他種の未登録候補: ${[...candidates].join(", ")}` : "";
      const msg = `"${enName}" (=${nitoyonNum}): 既登録の日本語フォーム名と衝突しているため自動登録できません (${detail}${candidateNote})。手動で scripts/form-aliases.json またはマッピング表を設定してください`;
      unfixable.push({ message: msg });
      log(`  [UNFIXABLE] ${msg}`);
      continue;
    }

    if (candidates.size > 1) {
      const msg = `"${enName}" (=${nitoyonNum}): 複数の日本語フォーム候補が見つかり一意に決定できません (${[...candidates].join(", ")})。手動で設定してください`;
      unfixable.push({ message: msg });
      log(`  [UNFIXABLE] ${msg}`);
      continue;
    }

    if (candidates.size === 1 && ambiguousSpecies.length === 0) {
      const [jaName] = [...candidates];
      pendingNewRegistrations.push({ enName, nitoyonNum, jaName });
      if (!pendingByJaLabel.has(jaName)) pendingByJaLabel.set(jaName, []);
      pendingByJaLabel.get(jaName).push({ enName, nitoyonNum });
      continue;
    }

    const speciesNote = ambiguousSpecies.length > 0 ? ` (対象種: ${ambiguousSpecies.map((d) => `#${d}`).join(", ")})` : "";
    const msg = `"${enName}" (=${nitoyonNum}): Wiki のフォーム括弧名を一意に特定できません${speciesNote}。手動で form-ja-to-number.json / form-label-ja-to-en.json または form-aliases.json に追加してください`;
    unfixable.push({ message: msg });
    log(`  [UNFIXABLE] ${msg}`);
  }

  for (const reg of pendingNewRegistrations) {
    const sharers = pendingByJaLabel.get(reg.jaName) || [];
    if (sharers.length > 1) {
      const peers = sharers.map((s) => `"${s.enName}" (=${s.nitoyonNum})`).join(", ");
      const msg = `"${reg.enName}" (=${reg.nitoyonNum}): 新規候補ラベル "${reg.jaName}" が複数フォームで衝突しています (${peers})。手動でマッピング表または form-aliases.json を設定してください`;
      unfixable.push({ message: msg });
      log(`  [UNFIXABLE] ${msg}`);
      continue;
    }
    formJaToNumber[reg.jaName] = reg.nitoyonNum;
    addFix("form-ja-to-number.json", "追加", `"${reg.jaName}": ${reg.nitoyonNum}`);
    formLabelJaToEn[reg.jaName] = reg.enName;
    enToJa = buildEnToJaMap(formLabelJaToEn);
    addFix("form-label-ja-to-en.json", "追加", `"${reg.jaName}": "${reg.enName}"`);
    phase1Changed = true;
  }

  if (!phase1Changed && unfixable.length === 0) {
    log("  → すべて登録済み");
  }
  log();

  const unfixableAfterPhase1 = unfixable.length;

  // -------------------------------------------------------------------------
  // Phase 2: Wiki vs にとよんのフォーム番号ずれ → form-aliases.json 検証・自動追加
  // -------------------------------------------------------------------------
  log("--- Phase 2: Wiki/pokesleep-tool フォーム番号ずれ → alias 検証・自動追加 ---");
  let phase2Changed = false;

  const wikiByDex = buildWikiByDex(wikiItems, formJaToNumber);
  const wikiFormsByDex = buildWikiFormsByDex(wikiByDex);
  const remainingUnknownWikiForms = collectUnknownWikiFormIssues(wikiByDex);
  for (const msg of remainingUnknownWikiForms) {
    unfixable.push({ message: msg });
    log(`  [UNFIXABLE] ${msg}`);
  }

  // 直接行が存在するのに残っている旧エイリアス・孤立メタデータを報告
  const staleAliasIssues = collectStaleAliasIssues(formAliases, wikiFormsByDex);
  for (const msg of staleAliasIssues) {
    unfixable.push({ message: msg });
    log(`  [ALIAS BAD] ${msg}`);
  }

  for (const [dexNo, nitoyonEntries] of nitoyonByDex) {
    const wikiEntries = wikiByDex.get(dexNo);
    const wikiForms = wikiFormsByDex.get(dexNo);
    if (!wikiEntries || !wikiForms) continue;

    const wikiHasUnknownForm = wikiEntries.some((e) => e.isUnknownForm);
    // 自動で 0 へエイリアスして安全なケースは、
    // 「Wiki 側が括弧なしの通常行ちょうど 1 件のみ」かつ「にとよん側も対象フォームちょうど 1 件のみ」
    // の厳密な 1 対 1 ケースに限定する（例: ドオー #980）。
    const isStrictSingleNormalWiki =
      !wikiHasUnknownForm &&
      wikiEntries.length === 1 &&
      wikiEntries[0].formLabelJa === null;
    const isStrictSingleNitoyonEntry = nitoyonEntries.length === 1;

    for (const ne of nitoyonEntries) {
      if (ne.isUnknownNitoyonForm) continue;
      if (wikiForms.has(ne.formNum)) continue;

      const aliasKey = `${dexNo}:${ne.formNum}`;
      if (Object.hasOwn(formAliases, aliasKey)) {
        const aliasErr = validateAliasTarget({
          dexNo,
          nitoyonEntry: ne,
          targetForm: formAliases[aliasKey],
          wikiEntries,
          wikiForms,
          formAliases,
        });
        if (aliasErr !== null) {
          unfixable.push({ message: aliasErr });
          log(`  [ALIAS BAD] ${aliasErr}`);
        }
        continue;
      }

      if (isStrictSingleNormalWiki && isStrictSingleNitoyonEntry && ne.formNum !== 0) {
        const aliasErr = validateAliasTarget({
          dexNo,
          nitoyonEntry: ne,
          targetForm: 0,
          wikiEntries,
          wikiForms,
          formAliases,
        });
        if (aliasErr === null) {
          formAliases[aliasKey] = 0;
          addFix("form-aliases.json", "追加", `"${aliasKey}": 0 (Wiki 括弧なし1件 ⇔ にとよん1件)`);
          phase2Changed = true;
        } else {
          unfixable.push({ message: aliasErr });
          log(`  [UNFIXABLE] ${aliasErr}`);
        }
      } else {
        const wikiFormList = [...wikiForms].sort((a, b) => a - b).join(", ");
        const unknownLabels = [...new Set(wikiEntries.filter((e) => e.isUnknownForm).map((e) => e.formLabelJa))];
        const unknownNote = unknownLabels.length > 0 ? `, 未登録括弧=[${unknownLabels.join(", ")}]` : "";
        const msg = `#${dexNo} ${ne.name}: にとよん form=${ne.formNum} ("${ne.form ?? ""}") が Wiki 側 forms=[${wikiFormList}]${unknownNote} に存在しない。手動で scripts/form-aliases.json またはフォーム定義を設定してください`;
        unfixable.push({ message: msg });
        log(`  [UNFIXABLE] ${msg}`);
      }
    }
  }

  if (!phase2Changed && unfixable.length === unfixableAfterPhase1) {
    log("  → alias の追加なし");
  }
  log();

  // -------------------------------------------------------------------------
  // Phase 3: 検証（自動修正後の最終チェック）
  // -------------------------------------------------------------------------
  log("--- Phase 3: 最終検証 ---");
  let finalErrors = 0;

  for (const [formStr] of unknownNitoyonForms) {
    log(`  [ERROR] pokemon.json の未知フォーム "${formStr}" が formMap に存在しない`);
    finalErrors++;
  }
  const finalWikiConflicts = collectWikiDuplicateConflicts(wikiByDex);
  for (const c of finalWikiConflicts) {
    log(`  [ERROR] Wiki 重複行矛盾 #${c.dexNo} form=${c.form} (${c.nameJa}): ${c.diffs.join(" / ")}`);
    finalErrors++;
  }
  for (const dexNo of vanishedDexNos) {
    log(`  [ERROR] 既存種 #${dexNo} が Wiki スナップショットから消失しています`);
    finalErrors++;
  }
  for (const msg of staleAliasIssues) {
    log(`  [ERROR] ${msg}`);
    finalErrors++;
  }
  for (const msg of remainingUnknownWikiForms) {
    log(`  [ERROR] ${msg}`);
    finalErrors++;
  }

  // --verify-generated は読み取り専用の生成後検証なので、未反映の自動修正がある時点でエラー
  if (verifyGenerated && fixes.length > 0) {
    log(`  [ERROR] --verify-generated モードで未反映の自動修正が ${fixes.length} 件検出されました`);
    finalErrors++;
  }

  // 3a: formMap の全エントリが直接マッピングまたは妥当な form-aliases.json 経由で解決可能か
  const enToJaFinal = buildEnToJaMap(formLabelJaToEn);
  for (const [enName, nitoyonNum] of Object.entries(nitoyonFormMap)) {
    const directOk = isFormResolvedDirectly(enName, nitoyonNum, enToJaFinal, formJaToNumber);
    const aliasOk = isFormResolvedByAliases({
      enName,
      nitoyonNum,
      nitoyonByFormEn,
      wikiByDex,
      wikiFormsByDex,
      formAliases,
      approvedRemovedInWiki,
    });
    if (!directOk && !aliasOk) {
      log(`  [ERROR] "${enName}" (=${nitoyonNum}) がマッピングテーブルおよび form-aliases.json で解決できない`);
      finalErrors++;
    }
  }

  // 3b: formMap vs formNames 配列の双方向一貫性（生成物差分の有無に関わらず事前・厳格検証ともエラー化）
  for (const issue of formNamesIssues) {
    log(`  [ERROR] ${issue}`);
    finalErrors++;
  }

  // 3c: 生成済み pokemon-names.ts の検証
  // - 事前検証（verifyGenerated=false）: 索引の差分は needsRegenerate=true（[WARN]）として再生成を促す
  // - 生成後検証（verifyGenerated=true）: 索引の不整合をすべて [ERROR] として厳格に失敗させる
  let needsRegenerate = fixes.length > 0;
  if (parsedGeneratedIndex || verifyGenerated) {
    const generatedIssues = collectGeneratedIndexIssues({
      nitoyonByDex,
      wikiByDex,
      wikiFormsByDex,
      formAliases,
      parsedGeneratedIndex,
      ingredientsNullSet,
    });
    if (generatedIssues.length > 0) {
      needsRegenerate = true;
      if (verifyGenerated) {
        for (const err of generatedIssues) {
          log(`  [ERROR] ${err}`);
          finalErrors++;
        }
      } else {
        for (const warn of generatedIssues.slice(0, 10)) {
          log(`  [WARN] ${warn}`);
        }
        if (generatedIssues.length > 10) {
          log(`  ... 他 ${generatedIssues.length - 10} 件`);
        }
        log(`  → 生成済み pokemon-names.ts の再生成が必要です (${generatedIssues.length} 件の差分)`);
      }
    }
  }

  if (finalErrors === 0 && unfixable.length === 0) {
    log("  → 最終検証OK");
  }
  log();

  const skipped =
    fixes.length === 0 &&
    unfixable.length === 0 &&
    finalErrors === 0 &&
    !needsRegenerate &&
    formNamesIssues.length === 0;
  return {
    formJaToNumber,
    formLabelJaToEn,
    formAliases,
    fixes,
    unfixable,
    finalErrors,
    needsRegenerate,
    skipped,
    logs,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {
    pokesleepTool: process.env.POKESLEEP_TOOL_PATH ?? null,
    dbJson: path.join(__dirname, "../src/domain/pokesleep/_generated/pokemon-db.json"),
    masterTs: path.join(__dirname, "../src/domain/pokesleep/pokemon-master.ts"),
    namesTs: path.join(__dirname, "../src/domain/pokesleep/pokemon-names.ts"),
    formJaToNumber: path.join(__dirname, "form-ja-to-number.json"),
    formLabelJaToEn: path.join(__dirname, "form-label-ja-to-en.json"),
    formAliases: path.join(__dirname, "form-aliases.json"),
    dryRun: false,
    verifyGenerated: false,
    allowRemovedDex: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pokesleep-tool" && argv[i + 1]) {
      out.pokesleepTool = argv[++i];
    } else if (a === "--db" && argv[i + 1]) {
      out.dbJson = argv[++i];
    } else if (a === "--master" && argv[i + 1]) {
      out.masterTs = argv[++i];
    } else if (a === "--names" && argv[i + 1]) {
      out.namesTs = argv[++i];
    } else if (a === "--form-ja-to-number" && argv[i + 1]) {
      out.formJaToNumber = argv[++i];
    } else if (a === "--form-label-ja-to-en" && argv[i + 1]) {
      out.formLabelJaToEn = argv[++i];
    } else if (a === "--form-aliases" && argv[i + 1]) {
      out.formAliases = argv[++i];
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--verify-generated") {
      out.verifyGenerated = true;
    } else if (a === "--allow-removed-dex" && argv[i + 1]) {
      out.allowRemovedDex = argv[++i]
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => isValidDexNo(n));
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.pokesleepTool) {
    console.error("[ERROR] pokesleep-tool path is required.");
    console.error("  POKESLEEP_TOOL_PATH または --pokesleep-tool で指定してください");
    process.exit(1);
  }
  const toolRoot = path.resolve(args.pokesleepTool);

  const pokemonJsonPath = path.join(toolRoot, "src/data/pokemon.json");
  const pokemonIvTsPath = path.join(toolRoot, "src/util/PokemonIv.ts");

  if (!fs.existsSync(pokemonJsonPath)) {
    console.error(`[ERROR] pokemon.json not found: ${pokemonJsonPath}`);
    console.error("  --pokesleep-tool オプションでにとよんツールのパスを指定してください");
    process.exit(1);
  }
  if (!fs.existsSync(pokemonIvTsPath)) {
    console.error(`[ERROR] PokemonIv.ts not found: ${pokemonIvTsPath}`);
    process.exit(1);
  }

  const pokemonList = readJson(pokemonJsonPath);
  const pokemonIvTs = fs.readFileSync(pokemonIvTsPath, "utf8");

  const formJaToNumberPath = path.resolve(args.formJaToNumber);
  const formLabelJaToEnPath = path.resolve(args.formLabelJaToEn);
  const formAliasesPath = path.resolve(args.formAliases);
  const pokemonDbPath = path.resolve(args.dbJson);
  const pokemonMasterTsPath = path.resolve(args.masterTs);

  // 書き込み可能モードでは、入力 DB・基準マスター・対応表3ファイルを初回読み込み前からロックし、
  // generate:pokemon-db 等の更新と競合して旧スナップショット向けのエイリアスを書き込むのを防ぐ
  const mayWriteMappings = !args.dryRun && !args.verifyGenerated;
  const releaseLock = mayWriteMappings
    ? acquirePublishLocks([
        pokemonDbPath,
        pokemonMasterTsPath,
        formJaToNumberPath,
        formLabelJaToEnPath,
        formAliasesPath,
      ])
    : () => {};

  let exitCode = 0;
  try {
    const formJaToNumber = fs.existsSync(formJaToNumberPath) ? readJson(formJaToNumberPath) : {};
    const formLabelJaToEn = fs.existsSync(formLabelJaToEnPath) ? readJson(formLabelJaToEnPath) : {};
    const formAliases = fs.existsSync(formAliasesPath) ? readJson(formAliasesPath) : {};

    let nitoyonFormMap;
    let nitoyonFormNames;
    try {
      nitoyonFormMap = parseFormMapFromTs(pokemonIvTs);
      nitoyonFormNames = parseFormNamesArrayFromTs(pokemonIvTs);
    } catch (err) {
      console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    if (!nitoyonFormMap) {
      console.error("[ERROR] PokemonIv.ts から formMap を抽出できませんでした");
      process.exitCode = 1;
      return;
    }
    if (!nitoyonFormNames) {
      console.error("[ERROR] PokemonIv.ts から formNames を抽出できませんでした");
      process.exitCode = 1;
      return;
    }

    const hasPokemonDb = fs.existsSync(pokemonDbPath);
    let wikiItems = [];
    if (hasPokemonDb) {
      try {
        wikiItems = validatePokemonDbPayload(readJson(pokemonDbPath), pokemonDbPath).items;
      } catch (err) {
        console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }
    }

    let parsedGeneratedIndex = null;
    const pokemonNamesTsPath = path.resolve(args.namesTs);
    if (fs.existsSync(pokemonNamesTsPath)) {
      parsedGeneratedIndex = parseGeneratedNamesIndex(fs.readFileSync(pokemonNamesTsPath, "utf8"));
    }

    let existingMasterDexNos = null;
    if (fs.existsSync(pokemonMasterTsPath)) {
      try {
        existingMasterDexNos = extractExistingDexNosFromMasterTs(
          fs.readFileSync(pokemonMasterTsPath, "utf8"),
          pokemonMasterTsPath,
        );
      } catch (err) {
        console.error(
          `[ERROR] 基準マスター (${pokemonMasterTsPath}) を読み込めないため既存種消失検査を実行できません: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }
    }

    const result = verifyAndFixFormMapping({
      pokemonList,
      nitoyonFormMap,
      nitoyonFormNames,
      wikiItems,
      hasPokemonDb,
      formJaToNumber,
      formLabelJaToEn,
      formAliases,
      parsedGeneratedIndex,
      existingMasterDexNos,
      allowRemovedDexNos: args.allowRemovedDex,
      verifyGenerated: args.verifyGenerated,
    });

    if (result.skipped) {
      console.log(result.logs.join("\n"));
      return;
    }

    console.log(result.logs.join("\n"));

    // 全検証に成功し、かつ読み取り専用モードではない場合だけマッピングファイルを書き出す
    const canWrite =
      result.fixes.length > 0 &&
      !args.dryRun &&
      !args.verifyGenerated &&
      result.unfixable.length === 0 &&
      result.finalErrors === 0;
    if (canWrite) {
      writeJson(formJaToNumberPath, result.formJaToNumber);
      writeJson(formLabelJaToEnPath, result.formLabelJaToEn);
      writeJson(formAliasesPath, result.formAliases);
      console.log("[WRITE] マッピングファイルを更新しました\n");
    }

    console.log("=== サマリー ===");
    console.log(`  自動修正:   ${result.fixes.length} 件${!canWrite && result.fixes.length > 0 ? " (未書き込み)" : ""}`);
    console.log(`  修正不可:   ${result.unfixable.length} 件`);
    console.log(`  検証エラー: ${result.finalErrors} 件`);
    console.log(`  再生成必要: ${result.needsRegenerate ? "はい" : "いいえ"}`);

    if (result.fixes.length > 0) {
      console.log("\n[AUTO-FIX 一覧]");
      for (const f of result.fixes) {
        console.log(`  - ${f.file}: ${f.action} — ${f.detail}`);
      }
    }
    if (result.unfixable.length > 0) {
      console.log("\n[UNFIXABLE 一覧]");
      for (const u of result.unfixable) {
        console.log(`  - ${u.message}`);
      }
    }

    console.log(
      `\n[SUMMARY] fixes=${result.fixes.length} unfixable=${result.unfixable.length} errors=${result.finalErrors} needs_regenerate=${result.needsRegenerate}`,
    );

    if (result.unfixable.length > 0 || result.finalErrors > 0) {
      exitCode = 1;
    }
  } finally {
    releaseLock();
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  main();
}
