import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_URL =
  "https://wikiwiki.jp/poke_sleep/%E5%A4%9A%E8%A8%80%E8%AA%9E%E3%81%AE%E5%90%8D%E8%A9%9E%E3%83%BB%E7%94%A8%E8%AA%9E%E3%81%AE%E4%B8%80%E8%A6%A7";

function parseArgs(argv) {
  const out = {
    url: DEFAULT_URL,
    outFile: path.join(__dirname, "../src/i18n/_generated/terms.ts"),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) {
      out.url = argv[i + 1];
      i++;
      continue;
    }
    if ((a === "--out" || a === "--out-file") && argv[i + 1]) {
      out.outFile = argv[i + 1];
      i++;
      continue;
    }
  }
  return out;
}

const args = parseArgs(process.argv);

function normText(s) {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\*\d+/g, "") // WikiWiki脚注マーカー除去 (*1, *3, etc.)
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

function closestSectionTitle($, tableEl) {
  // tableの直前にある見出しを拾う（h2/h3/h4）
  const $table = $(tableEl);
  let node = $table.prev();
  for (let i = 0; i < 40; i++) {
    if (!node || node.length === 0) break;
    const tag = (node.get(0)?.tagName ?? "").toLowerCase();
    if (tag === "h2" || tag === "h3" || tag === "h4") {
      const t = normText(node.text());
      if (t) return t;
    }
    node = node.prev();
  }
  return "";
}

function findLangCols(headers) {
  const ja = headers.findIndex((h) => /日本語|Japanese/i.test(h));
  const en = headers.findIndex((h) => /英語|English/i.test(h));
  return { ja: ja >= 0 ? ja : null, en: en >= 0 ? en : null };
}

/**
 * rowspan/colspan を考慮してテーブルを仮想グリッドに展開し、
 * 正確な列インデックスでセルを取得する。
 */
function buildGrid($, tableEl) {
  const rows = $(tableEl).find("tr").toArray();
  const grid = []; // grid[row][col] = element
  for (let r = 0; r < rows.length; r++) {
    if (!grid[r]) grid[r] = [];
    const cells = $(rows[r]).find("th,td").toArray();
    let cellIdx = 0;
    for (const cell of cells) {
      // 既に rowspan で埋まっている列をスキップ
      while (grid[r][cellIdx] !== undefined) cellIdx++;
      const rs = parseInt($(cell).attr("rowspan") || "1", 10);
      const cs = parseInt($(cell).attr("colspan") || "1", 10);
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          grid[r + dr][cellIdx + dc] = cell;
        }
      }
      cellIdx += cs;
    }
  }
  return grid;
}

function extractPairsFromTable($, tableEl) {
  const grid = buildGrid($, tableEl);
  if (grid.length === 0) return null;

  // ヘッダー行を探す（thを含む最初の行）
  const rows = $(tableEl).find("tr").toArray();
  let headerRowIdx = rows.findIndex((tr) => $(tr).find("th").length > 0);
  if (headerRowIdx < 0) headerRowIdx = 0;

  const headerGridRow = grid[headerRowIdx];
  if (!headerGridRow) return null;
  const headers = headerGridRow.map((el) => normText($(el).text()));
  const { ja: jaCol, en: enCol } = findLangCols(headers);
  if (jaCol === null || enCol === null) return null;

  const out = [];
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRowIdx) continue;
    const row = grid[r];
    if (!row) continue;
    const jaEl = row[jaCol];
    const enEl = row[enCol];
    if (!jaEl || !enEl) continue;
    const ja = normText($(jaEl).text());
    const en = normText($(enEl).text());
    if (!ja || !en) continue;
    // header行っぽいものは除外
    if (ja === "日本語" && en === "英語") continue;
    out.push([ja, en]);
  }
  // 重複除去（rowspanで同じセルが複数行に展開されるため）
  const seen = new Set();
  const unique = [];
  for (const [ja, en] of out) {
    const key = `${ja}\t${en}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push([ja, en]);
    }
  }
  return { headers, pairs: unique };
}

// WikiWikiのスクレイピング結果に含まれる既知のエラーを修正
const ERRATA = new Map([
  ["Send for Professer", "Send to Professor"],
  ["Sleep Datas", "Sleep Data"],
]);

function toObj(pairs) {
  const obj = {};
  for (const [ja, en] of pairs) {
    // 重複は先勝ち（後勝ちだと表の順序に左右されやすい）
    if (!obj[ja]) obj[ja] = ERRATA.get(en) ?? en;
  }
  return obj;
}

const res = await fetch(args.url, {
  headers: { "User-Agent": "candy-boost-planner (generate-terms)" },
});
if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
const html = await res.text();
const $ = cheerio.load(html);

const wanted = [
  { key: "subSkills", re: /サブスキル/i },
  { key: "ingredients", re: /食材/i },
  { key: "berries", re: /きのみ/i },
  { key: "types", re: /タイプ|属性/i },
  { key: "natures", re: /せいかく|性格/i },
];

const buckets = {
  subSkills: [],
  ingredients: [],
  berries: [],
  types: [],
  natures: [],
  other: [],
};

const tables = $("table").toArray();
for (const tbl of tables) {
  const extracted = extractPairsFromTable($, tbl);
  if (!extracted || extracted.pairs.length < 3) continue;
  const title = closestSectionTitle($, tbl);
  const bucket = wanted.find((w) => w.re.test(title))?.key ?? "other";
  buckets[bucket].push(...extracted.pairs);
}

const generatedAt = new Date().toISOString();
const outPath = path.resolve(args.outFile);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const content =
  `// This file is auto-generated by scripts/generate-terms.mjs\n` +
  `// Source: ${args.url}\n` +
  `// Generated at: ${generatedAt}\n\n` +
  `export const termJaToEn = ${JSON.stringify(toObj([].concat(...Object.values(buckets))), null, 2)} as const;\n`;

fs.writeFileSync(outPath, content, "utf8");
console.log(`[generate-terms] wrote: ${outPath}`);
const total = [].concat(...Object.values(buckets)).length;
console.log(
  `[generate-terms] counts: total=${total} subSkills=${buckets.subSkills.length} ingredients=${buckets.ingredients.length} berries=${buckets.berries.length} types=${buckets.types.length} natures=${buckets.natures.length} other=${buckets.other.length}`
);
