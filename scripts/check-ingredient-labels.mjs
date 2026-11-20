/**
 * 食材キーの整合性を3段階で突合する:
 *   1. Wiki 生データ（pokemon-db.json）に未登録の食材名・複数候補・不正型・A/B欠損がないか
 *   2. 食材変換ルール（KNOWN_INGREDIENT_KEYS）およびマスター（pokemonIngredientsByIdForm）の全キーが
 *      useBoxStore の ingredientJa / ingredientEn に登録されているか
 *   3. ingredientJa と ingredientEn のキー集合が一致しているか
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  parseExportedJsonObjectsFromTs,
  validatePokemonDbItems,
  validatePokemonDbPayload,
} from "./pokemon-db-validation.mjs";
import {
  KNOWN_INGREDIENT_KEYS,
  collectIngredientMappingIssues,
  formatIngredientMappingIssues,
  loadIngredientsNullSet,
} from "./pokemon-ingredient-resolution.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const NAMES_TS = path.join(root, "src/domain/pokesleep/pokemon-names.ts");
const BOX_STORE_TS = path.join(root, "src/composables/useBoxStore.ts");
const DB_JSON = path.join(root, "src/domain/pokesleep/_generated/pokemon-db.json");
const FORM_JA_TO_NUMBER_JSON = path.join(root, "scripts/form-ja-to-number.json");

function readUtf8(p) {
  return fs.readFileSync(p, "utf8");
}

/** @param {string} namesTs */
export function collectMasterIngredientKeys(namesTs) {
  const maps = parseExportedJsonObjectsFromTs(namesTs, ["pokemonIngredientsByIdForm"], NAMES_TS);
  const ingMap = maps.get("pokemonIngredientsByIdForm");
  if (!ingMap) throw new Error(`${NAMES_TS}: pokemonIngredientsByIdForm が見つからないか不正です`);
  const keys = new Set();
  for (const entry of Object.values(ingMap)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = /** @type {{ a?: unknown, b?: unknown, c?: unknown }} */ (entry);
    for (const slot of [obj.a, obj.b, obj.c]) {
      if (typeof slot === "string" && slot.length > 0) keys.add(slot);
    }
  }
  return keys;
}

/**
 * useBoxStore.ts の ingredientJa / ingredientEn オブジェクトリテラルを AST 抽出し、
 * キー集合と空・空白のみ・非文字列リテラル等の不正エントリ一覧を返す。
 * @param {string} source
 * @param {string} constName
 */
export function extractRecordEntries(source, constName) {
  const sf = ts.createSourceFile(BOX_STORE_TS, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** @type {ts.ObjectLiteralExpression[]} */
  const objects = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName &&
      node.initializer
    ) {
      let init = node.initializer;
      while (
        ts.isParenthesizedExpression(init) ||
        ts.isAsExpression(init) ||
        ts.isSatisfiesExpression(init)
      ) {
        init = init.expression;
      }
      if (ts.isObjectLiteralExpression(init)) objects.push(init);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (objects.length !== 1) {
    throw new Error(`${BOX_STORE_TS}: ${constName} ブロックが見つからないか複数あります (${objects.length}件)`);
  }

  /** @type {Set<string>} */
  const keys = new Set();
  /** @type {Array<{ key: string, detail: string }>} */
  const invalidEntries = [];
  for (const prop of objects[0].properties) {
    if (!ts.isPropertyAssignment(prop)) {
      invalidEntries.push({
        key: prop.getText(sf).trim(),
        detail: "静的なプロパティ定義ではありません",
      });
      continue;
    }
    if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
      invalidEntries.push({
        key: prop.name.getText(sf).trim(),
        detail: "キーが識別子または文字列リテラルではありません",
      });
      continue;
    }
    const key = prop.name.text;
    if (keys.has(key)) {
      invalidEntries.push({ key, detail: "重複キーが定義されています" });
    }
    keys.add(key);

    let val = prop.initializer;
    while (
      ts.isParenthesizedExpression(val) ||
      ts.isAsExpression(val) ||
      ts.isSatisfiesExpression(val)
    ) {
      val = val.expression;
    }
    if (!ts.isStringLiteral(val) && !ts.isNoSubstitutionTemplateLiteral(val)) {
      invalidEntries.push({
        key,
        detail: `値が静的な文字列リテラルではありません (${prop.initializer.getText(sf).trim()})`,
      });
      continue;
    }
    if (val.text.trim().length === 0) {
      invalidEntries.push({
        key,
        detail: `ラベルが空文字または空白のみです (${JSON.stringify(val.text)})`,
      });
    }
  }
  return { keys, invalidEntries };
}

/** @param {string} source @param {string} constName */
export function extractRecordKeys(source, constName) {
  return extractRecordEntries(source, constName).keys;
}

function sorted(arr) {
  return [...arr].sort();
}

/**
 * @param {{
 *   namesTs: string,
 *   boxTs: string,
 *   dbItems: Array<{ dexNo?: unknown, nameJa?: unknown, ingAJa?: unknown, ingBJa?: unknown, ingCJa?: unknown }>,
 *   formJaToNumber?: Record<string, number>,
 *   ingredientsNullSet?: Set<string>,
 *   requireNonEmptyDb?: boolean,
 * }} options
 */
export function checkIngredientLabels({
  namesTs,
  boxTs,
  dbItems,
  formJaToNumber = {},
  ingredientsNullSet = loadIngredientsNullSet(),
  requireNonEmptyDb = false,
}) {
  validatePokemonDbItems(dbItems, "pokemon-db.json", { allowEmpty: !requireNonEmptyDb });

  const masterKeys = collectMasterIngredientKeys(namesTs);
  const knownRuleKeys = new Set(KNOWN_INGREDIENT_KEYS);
  const expectedKeys = new Set([...masterKeys, ...knownRuleKeys]);

  const jaEntries = extractRecordEntries(boxTs, "ingredientJa");
  const enEntries = extractRecordEntries(boxTs, "ingredientEn");
  const jaKeys = jaEntries.keys;
  const enKeys = enEntries.keys;
  const invalidJa = jaEntries.invalidEntries;
  const invalidEn = enEntries.invalidEntries;

  const dbIssues = collectIngredientMappingIssues(dbItems, formJaToNumber, ingredientsNullSet);
  const hasDbIssues =
    dbIssues.unknownLabels.size > 0 ||
    dbIssues.ambiguousSlots.length > 0 ||
    dbIssues.invalidSlots.length > 0 ||
    dbIssues.missingRequiredSlots.length > 0;

  const missingInJa = sorted([...expectedKeys].filter((k) => !jaKeys.has(k)));
  const missingInEn = sorted([...expectedKeys].filter((k) => !enKeys.has(k)));
  const unknownMasterKeys = sorted([...masterKeys].filter((k) => !knownRuleKeys.has(k)));
  const orphanJa = sorted([...jaKeys].filter((k) => !expectedKeys.has(k)));
  const orphanEn = sorted([...enKeys].filter((k) => !expectedKeys.has(k)));
  const jaOnly = sorted([...jaKeys].filter((k) => !enKeys.has(k)));
  const enOnly = sorted([...enKeys].filter((k) => !jaKeys.has(k)));

  const lines = [];
  lines.push("=== 食材キーと表示マップの突合 ===");
  lines.push(
    `変換ルール（INGREDIENT_KEY_RULES）のキー種類: ${knownRuleKeys.size} / マスター（pokemonIngredientsByIdForm）のキー種類: ${masterKeys.size}`,
  );
  lines.push(`ingredientJa エントリ数: ${jaKeys.size} / ingredientEn エントリ数: ${enKeys.size}`);
  lines.push("");

  let hasProblem = false;

  if (hasDbIssues) {
    hasProblem = true;
    lines.push("要対応 Wikiデータ（pokemon-db.json）に未解決の食材があります。");
    lines.push("");
    lines.push(formatIngredientMappingIssues(dbIssues));
  }

  if (missingInJa.length || missingInEn.length) {
    if (hasProblem) lines.push("");
    hasProblem = true;
    lines.push("要対応 変換ルールまたはマスターに存在するが表示マップに無いキーがあります（ボックスUIで英語キーがそのまま表示されます）。");
    if (missingInJa.length) {
      lines.push("");
      lines.push("  ingredientJa に未登録:");
      for (const k of missingInJa) lines.push(`    - ${k}`);
    }
    if (missingInEn.length) {
      lines.push("");
      lines.push("  ingredientEn に未登録:");
      for (const k of missingInEn) lines.push(`    - ${k}`);
    }
    lines.push("");
    lines.push("  対応: src/composables/useBoxStore.ts の ingredientJa と ingredientEn に同一キーで追加する。");
  }

  if (unknownMasterKeys.length) {
    if (hasProblem) lines.push("");
    hasProblem = true;
    lines.push("要確認 マスターに存在するが INGREDIENT_KEY_RULES に無いキーがあります:");
    for (const k of unknownMasterKeys) lines.push(`  - ${k}`);
  }

  if (invalidJa.length || invalidEn.length) {
    if (hasProblem) lines.push("");
    hasProblem = true;
    lines.push("要対応 ingredientJa / ingredientEn に空文字・空白のみ・不正なラベル値があります。");
    if (invalidJa.length) {
      lines.push("  ingredientJa:");
      for (const item of invalidJa) lines.push(`    - ${item.key}: ${item.detail}`);
    }
    if (invalidEn.length) {
      lines.push("  ingredientEn:");
      for (const item of invalidEn) lines.push(`    - ${item.key}: ${item.detail}`);
    }
  }

  if (jaOnly.length || enOnly.length) {
    if (hasProblem) lines.push("");
    hasProblem = true;
    lines.push("要確認 ingredientJa と ingredientEn のキー集合が一致しません。");
    if (jaOnly.length) {
      lines.push("  Ja にだけあるキー:");
      for (const k of jaOnly) lines.push(`    - ${k}`);
    }
    if (enOnly.length) {
      lines.push("  En にだけあるキー:");
      for (const k of enOnly) lines.push(`    - ${k}`);
    }
  }

  if (!hasProblem) {
    lines.push("OK Wikiデータ・変換ルール・マスターと ingredientJa / ingredientEn に不整合はありません。");
  }

  if (orphanJa.length || orphanEn.length) {
    lines.push("");
    lines.push("参考 変換ルール・マスターに現れないがマップにだけあるキー（古いキーや将来削除候補の可能性）:");
    if (orphanJa.length) {
      lines.push("  ingredientJa:");
      for (const k of orphanJa) lines.push(`    - ${k}`);
    }
    if (orphanEn.length) {
      lines.push("  ingredientEn:");
      for (const k of orphanEn) lines.push(`    - ${k}`);
    }
  }

  return {
    hasProblem,
    text: lines.join("\n"),
    masterKeys,
    knownRuleKeys,
    jaKeys,
    enKeys,
    missingInJa,
    missingInEn,
    invalidJa,
    invalidEn,
    unknownMasterKeys,
    jaOnly,
    enOnly,
    orphanJa,
    orphanEn,
    dbIssues,
  };
}

function parseArgs(argv) {
  const out = {
    failOnGap: false,
    dbJson: DB_JSON,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fail-on-gap") {
      out.failOnGap = true;
    } else if (a === "--db" && argv[i + 1]) {
      out.dbJson = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);

  const namesTs = readUtf8(NAMES_TS);
  const boxTs = readUtf8(BOX_STORE_TS);
  const dbParsed = validatePokemonDbPayload(JSON.parse(readUtf8(args.dbJson)), args.dbJson);
  const formJaToNumber = fs.existsSync(FORM_JA_TO_NUMBER_JSON)
    ? JSON.parse(readUtf8(FORM_JA_TO_NUMBER_JSON))
    : {};

  const result = checkIngredientLabels({
    namesTs,
    boxTs,
    dbItems: dbParsed.items,
    formJaToNumber,
    requireNonEmptyDb: true,
  });

  console.log(result.text);

  if (args.failOnGap && result.hasProblem) {
    process.exit(1);
  }
  process.exit(0);
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  try {
    main();
  } catch (err) {
    console.error(`[check-ingredient-labels] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
