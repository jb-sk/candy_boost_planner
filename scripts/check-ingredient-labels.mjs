/**
 * pokemonIngredientsByIdForm に現れる食材キーと、
 * useBoxStore の ingredientJa / ingredientEn のキー集合を突合する。
 * マスターにだけあるキー = 表示ラベル未登録（ボックスUIでキー文字列がそのまま出る）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const NAMES_TS = path.join(root, "src/domain/pokesleep/pokemon-names.ts");
const BOX_STORE_TS = path.join(root, "src/composables/useBoxStore.ts");

function readUtf8(p) {
  return fs.readFileSync(p, "utf8");
}

/** @param {string} ts */
function extractIngredientsBlock(ts) {
  const marker = "export const pokemonIngredientsByIdForm";
  const start = ts.indexOf(marker);
  if (start < 0) throw new Error(`${NAMES_TS}: pokemonIngredientsByIdForm が見つかりません`);
  const nextExport = ts.indexOf("\nexport const ", start + marker.length);
  if (nextExport < 0) throw new Error(`${NAMES_TS}: 次の export が見つかりません`);
  return ts.slice(start, nextExport);
}

/** @param {string} block */
function collectSlotKeys(block) {
  const keys = new Set();
  const re = /"([abc])":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(block))) {
    keys.add(m[2]);
  }
  return keys;
}

/** @param {string} ts @param {string} constName */
function extractRecordKeys(ts, constName) {
  const re = new RegExp(
    `const ${constName}:\\s*Record<string, string>\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`,
    "m"
  );
  const whole = ts.match(re);
  if (!whole) throw new Error(`${BOX_STORE_TS}: ${constName} ブロックが見つかりません`);
  const body = whole[1];
  const keys = new Set();
  for (const line of body.split("\n")) {
    const km = line.match(/^\s*(\w+):\s*"/);
    if (km) keys.add(km[1]);
  }
  return keys;
}

function sorted(arr) {
  return [...arr].sort();
}

function main() {
  const failOnGap = process.argv.includes("--fail-on-gap");

  const namesTs = readUtf8(NAMES_TS);
  const boxTs = readUtf8(BOX_STORE_TS);

  const ingBlock = extractIngredientsBlock(namesTs);
  const masterKeys = collectSlotKeys(ingBlock);

  const jaKeys = extractRecordKeys(boxTs, "ingredientJa");
  const enKeys = extractRecordKeys(boxTs, "ingredientEn");

  const missingInJa = sorted([...masterKeys].filter((k) => !jaKeys.has(k)));
  const missingInEn = sorted([...masterKeys].filter((k) => !enKeys.has(k)));
  const orphanJa = sorted([...jaKeys].filter((k) => !masterKeys.has(k)));
  const orphanEn = sorted([...enKeys].filter((k) => !masterKeys.has(k)));
  const jaOnly = sorted([...jaKeys].filter((k) => !enKeys.has(k)));
  const enOnly = sorted([...enKeys].filter((k) => !jaKeys.has(k)));

  const lines = [];
  lines.push("=== 食材キーと表示マップの突合 ===");
  lines.push(`マスター（pokemonIngredientsByIdForm）のキー種類: ${masterKeys.size}`);
  lines.push(`ingredientJa エントリ数: ${jaKeys.size} / ingredientEn エントリ数: ${enKeys.size}`);
  lines.push("");

  let hasProblem = false;

  if (missingInJa.length === 0 && missingInEn.length === 0) {
    lines.push("OK マスターにあって ingredientJa / ingredientEn に無いキーはありません。");
  } else {
    hasProblem = true;
    lines.push("要対応 マスターに存在するが表示マップに無いキーがあります（ボックスUIで英語キーがそのまま表示されます）。");
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

  if (jaOnly.length || enOnly.length) {
    hasProblem = true;
    lines.push("");
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

  if (orphanJa.length || orphanEn.length) {
    lines.push("");
    lines.push("参考 マスターに現れないがマップにだけあるキー（古いキーや将来削除候補の可能性）:");
    if (orphanJa.length) {
      lines.push("  ingredientJa:");
      for (const k of orphanJa) lines.push(`    - ${k}`);
    }
    if (orphanEn.length) {
      lines.push("  ingredientEn:");
      for (const k of orphanEn) lines.push(`    - ${k}`);
    }
  }

  const text = lines.join("\n");
  console.log(text);

  if (failOnGap && hasProblem) {
    process.exit(1);
  }
  process.exit(0);
}

main();
