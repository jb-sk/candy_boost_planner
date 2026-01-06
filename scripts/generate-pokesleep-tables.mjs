import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as cheerio from "cheerio";

const WIKI_URL =
  "https://wikiwiki.jp/poke_sleep/%E8%82%B2%E6%88%90/%E3%83%AC%E3%83%99%E3%83%AB";

const TABLES_PATH = path.join(process.cwd(), "src", "domain", "pokesleep", "tables.ts");
const OVERRIDE_PATH = path.join(process.cwd(), "scripts", "exp-tables-override.json");

// 倍率定義
const EXP_TYPE_RATIOS = {
  900: 1.5,
  1080: 1.8,
  1320: 2.2,
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function toInt(s) {
  if (typeof s !== "string") return NaN;
  const cleaned = s.replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeText(t) {
  return (t ?? "").replace(/\s+/g, " ").trim();
}

function findExpTable($) {
  const tables = $("table").toArray().map((t) => $(t));
  let best = null;
  let bestScore = -Infinity;

  for (const $t of tables) {
    const rows = $t.find("tr").toArray();
    let parsed = 0;
    let maxLevel = 0;
    let hasLv25Text = false;

    const tableText = normalizeText($t.text());
    if (tableText.includes("Lv.25")) hasLv25Text = true;

    for (const r of rows) {
      const cells = $(r).find("th,td").toArray().map((c) => normalizeText($(c).text()));
      if (cells.length < 6) continue;

      const level = toInt(cells[0]);
      if (!Number.isFinite(level) || level < 2) continue;

      const expTotal = toInt(cells[2]);
      const shardsPerCandy = toInt(cells[5]);
      if (!Number.isFinite(expTotal) || !Number.isFinite(shardsPerCandy)) continue;

      parsed++;
      if (level > maxLevel) maxLevel = level;
    }

    const score = parsed * 10 + maxLevel + (hasLv25Text ? 50 : 0) + (rows.length >= 60 ? 20 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = $t;
    }
  }
  return best;
}

function parseTablesFromWiki(html) {
  const $ = cheerio.load(html);
  const $table = findExpTable($);
  assert($table, "必要EXP表のテーブルが見つかりませんでした。");

  const rows = $table.find("tr").toArray();
  const expTotalByLevel = [];
  const shardsPerCandyByLevel = [];
  let maxLevel = 0;

  for (const r of rows) {
    const cells = $(r).find("th,td").toArray().map((c) => normalizeText($(c).text()));
    if (cells.length < 6) continue;

    const level = toInt(cells[0]);
    if (!Number.isFinite(level) || level < 2) continue;

    const expTotal = toInt(cells[2]);
    const shardsPerCandy = toInt(cells[5]);
    if (!Number.isFinite(expTotal) || !Number.isFinite(shardsPerCandy)) continue;

    expTotalByLevel[level] = expTotal;
    shardsPerCandyByLevel[level] = shardsPerCandy;
    if (level > maxLevel) maxLevel = level;
  }

  assert(maxLevel >= 30, `抽出できた最大レベルが小さすぎます: ${maxLevel}`);

  expTotalByLevel[0] = 0;
  expTotalByLevel[1] = 0;
  shardsPerCandyByLevel[0] = 0;
  shardsPerCandyByLevel[1] = 0;

  const expTotal = Array.from({ length: maxLevel + 1 }, (_, i) => expTotalByLevel[i] ?? 0);
  const shardsPerCandy = Array.from({ length: maxLevel + 1 }, (_, i) => shardsPerCandyByLevel[i] ?? 0);

  return { expTotal, shardsPerCandy, maxLevel };
}

// 既存の tables.ts からデータを読み込む
function parseExistingTables() {
  if (!fs.existsSync(TABLES_PATH)) {
    return null;
  }
  const content = fs.readFileSync(TABLES_PATH, "utf8");

  const extractArray = (name) => {
    const regex = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`);
    const match = content.match(regex);
    if (!match) return null;
    const nums = match[1]
      .replace(/\/\/.*$/gm, "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number);
    return nums;
  };

  return {
    totalExpToTheLevel: extractArray("totalExpToTheLevel"),
    totalExpToTheLevel900: extractArray("totalExpToTheLevel900"),
    totalExpToTheLevel1080: extractArray("totalExpToTheLevel1080"),
    totalExpToTheLevel1320: extractArray("totalExpToTheLevel1320"),
    dreamShardsPerCandy: extractArray("dreamShardsPerCandy"),
  };
}

// Override ファイルを読み込む
function loadOverrides() {
  if (!fs.existsSync(OVERRIDE_PATH)) {
    return {};
  }
  const content = fs.readFileSync(OVERRIDE_PATH, "utf8");
  return JSON.parse(content);
}

// 600 から他のタイプを計算（累積EXPベース）
// Override は「累積EXP」形式
function deriveExpTable(base600, expType, overrides) {
  const ratio = EXP_TYPE_RATIOS[expType];
  const overrideData = overrides[String(expType)] || {};
  const result = [0, 0]; // Lv0, Lv1

  for (let lv = 2; lv < base600.length; lv++) {
    // Override があればそちらを優先、なければ公式計算
    if (overrideData[String(lv)] !== undefined) {
      result[lv] = overrideData[String(lv)];
    } else {
      // 累積EXP × 倍率 で計算
      result[lv] = Math.round(base600[lv] * ratio);
    }
  }

  return result;
}

function formatTsArray(arr) {
  const cols = 11;
  const lines = [];
  for (let i = 0; i < arr.length; i += cols) {
    lines.push("  " + arr.slice(i, i + cols).join(", ") + ",");
  }
  return "[\n" + lines.join("\n") + "\n]";
}

async function main() {
  const args = process.argv.slice(2);
  const overwriteMode = args.includes("--overwrite");

  console.log(`[generate:tables] モード: ${overwriteMode ? "上書き" : "追加"}`);
  console.log(`[generate:tables] Fetch: ${WIKI_URL}`);

  const res = await fetch(WIKI_URL, {
    headers: {
      "user-agent": "candy-boost-planner/0.1 (table-generator)",
      "accept-language": "ja,en;q=0.8",
    },
  });
  assert(res.ok, `Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const wiki = parseTablesFromWiki(html);
  const existing = parseExistingTables();
  const overrides = loadOverrides();

  let finalExp600, finalShards, finalMaxLevel;
  let final900, final1080, final1320;

  if (overwriteMode || !existing) {
    // 上書きモード: Wiki データで全置換
    console.log("[generate:tables] 上書きモード: 全データをWikiから再生成");
    finalExp600 = wiki.expTotal;
    finalShards = wiki.shardsPerCandy;
    finalMaxLevel = wiki.maxLevel;
  } else {
    // 追加モード: 既存データを維持、新レベルのみ追加
    const existingMax = existing.totalExpToTheLevel ? existing.totalExpToTheLevel.length - 1 : 0;

    if (wiki.maxLevel > existingMax) {
      console.log(`[generate:tables] 新レベル追加: Lv${existingMax + 1} ~ Lv${wiki.maxLevel}`);
      finalExp600 = [...existing.totalExpToTheLevel];
      finalShards = [...existing.dreamShardsPerCandy];

      for (let lv = existingMax + 1; lv <= wiki.maxLevel; lv++) {
        finalExp600[lv] = wiki.expTotal[lv];
        finalShards[lv] = wiki.shardsPerCandy[lv];
      }
      finalMaxLevel = wiki.maxLevel;
    } else {
      console.log("[generate:tables] 新レベルなし: 既存データを維持");
      finalExp600 = existing.totalExpToTheLevel;
      finalShards = existing.dreamShardsPerCandy;
      finalMaxLevel = existingMax;
    }
  }

  // 900/1080/1320 を生成（追加モードでは既存データ優先）
  if (overwriteMode || !existing) {
    console.log("[generate:tables] 900/1080/1320: 公式計算 + Override");
    final900 = deriveExpTable(finalExp600, 900, overrides);
    final1080 = deriveExpTable(finalExp600, 1080, overrides);
    final1320 = deriveExpTable(finalExp600, 1320, overrides);
  } else {
    // 追加モード: 既存データを優先、新レベルは計算
    const existingMax = existing.totalExpToTheLevel900 ? existing.totalExpToTheLevel900.length - 1 : 0;

    if (wiki.maxLevel > existingMax) {
      console.log(`[generate:tables] 900/1080/1320: 新レベル (Lv${existingMax + 1}~) を計算追加`);

      // 基本は既存データを維持
      final900 = [...existing.totalExpToTheLevel900];
      final1080 = [...existing.totalExpToTheLevel1080];
      final1320 = [...existing.totalExpToTheLevel1320];

      // 新レベルは計算で追加
      for (let lv = existingMax + 1; lv <= wiki.maxLevel; lv++) {
        const reqBase = finalExp600[lv] - finalExp600[lv - 1];

        // Override があればそちらを優先
        if (overrides["900"] && overrides["900"][String(lv)] !== undefined) {
          final900[lv] = overrides["900"][String(lv)];
        } else {
          final900[lv] = final900[lv - 1] + Math.round(reqBase * 1.5);
        }

        if (overrides["1080"] && overrides["1080"][String(lv)] !== undefined) {
          final1080[lv] = overrides["1080"][String(lv)];
        } else {
          final1080[lv] = final1080[lv - 1] + Math.round(reqBase * 1.8);
        }

        if (overrides["1320"] && overrides["1320"][String(lv)] !== undefined) {
          final1320[lv] = overrides["1320"][String(lv)];
        } else {
          final1320[lv] = final1320[lv - 1] + Math.round(reqBase * 2.2);
        }
      }
    } else {
      console.log("[generate:tables] 900/1080/1320: 既存データを維持");
      final900 = existing.totalExpToTheLevel900;
      final1080 = existing.totalExpToTheLevel1080;
      final1320 = existing.totalExpToTheLevel1320;
    }
  }

  const file = `// 経験値・ゆめのかけらテーブル
// データ参照元: RaenonX (https://pks.raenonx.cc/ja/xp/table)

export const maxLevel = ${finalMaxLevel} as const;

// totalExpToTheLevel[level] = そのレベル到達までの累積EXP（ExpType 600: 一般ポケモン）
export const totalExpToTheLevel = ${formatTsArray(finalExp600)} as const;

// totalExpToTheLevel900[level] = そのレベル到達までの累積EXP（ExpType 900: 600族）
export const totalExpToTheLevel900 = ${formatTsArray(final900)} as const;

// totalExpToTheLevel1080[level] = そのレベル到達までの累積EXP（ExpType 1080: 準伝説）
export const totalExpToTheLevel1080 = ${formatTsArray(final1080)} as const;

// totalExpToTheLevel1320[level] = そのレベル到達までの累積EXP（ExpType 1320: 幻）
export const totalExpToTheLevel1320 = ${formatTsArray(final1320)} as const;

// dreamShardsPerCandy[level] = アメ1個あたりのゆめのかけら
export const dreamShardsPerCandy = ${formatTsArray(finalShards)} as const;
`;

  fs.mkdirSync(path.dirname(TABLES_PATH), { recursive: true });
  fs.writeFileSync(TABLES_PATH, file, "utf8");
  console.log(`[generate:tables] Wrote: ${TABLES_PATH}`);
  console.log(`[generate:tables] maxLevel = ${finalMaxLevel}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
