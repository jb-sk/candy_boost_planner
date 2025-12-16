import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_URL =
  "https://wikiwiki.jp/poke_sleep/%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3%E3%81%AE%E4%B8%80%E8%A6%A7";

function parseArgs(argv) {
  const out = {
    url: DEFAULT_URL,
    outFile: path.join(__dirname, "../src/domain/pokesleep/pokemon-db.ts"),
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
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

function extractCellTextOrImgLabels(cell) {
  // 画像アイコンが多いので alt/title から拾う。無ければ text。
  const imgs = cell.find("img").toArray();
  const labels = [];
  for (const el of imgs) {
    const $img = cell.find(el);
    const alt = normText($img.attr("alt") ?? "");
    const title = normText($img.attr("title") ?? "");
    if (alt) {
      labels.push(alt);
      continue;
    }
    if (title) {
      labels.push(title);
      continue;
    }
    // alt/titleが無い場合は src のファイル名から推定（spacer等は除外）
    const src = normText($img.attr("src") ?? "");
    if (!src) continue;
    const base = src.split("/").pop() ?? "";
    const decoded = decodeURIComponent(base);
    const cleaned = decoded.replace(/\.(png|gif|jpg|jpeg|webp)$/i, "");
    if (!cleaned) continue;
    if (cleaned.toLowerCase() === "spacer") continue;
    if (cleaned.toLowerCase() === "spacer.gif") continue;
    labels.push(cleaned);
  }
  if (labels.length) return labels.filter(Boolean);
  const t = normText(cell.text());
  return t ? [t] : [];
}

function parseDexNo(s) {
  const m = normText(s).match(/^(\d{1,4})$/);
  return m ? Number(m[1]) : null;
}

function scoreHeader(headers) {
  const joined = headers.join(" ");
  const has = (re) => re.test(joined);
  let score = 0;
  if (has(/\bNo\.?\b/i) || has(/図鑑/)) score += 8;
  if (has(/とくい|得意/)) score += 8;
  if (has(/睡眠/)) score += 3;
  if (has(/メイン/)) score += 3;
  if (has(/食A|食B|食C/)) score += 3;
  if (has(/FP/)) score += 2;
  if (has(/手伝/)) score += 2;
  return score;
}

function pickBestTable($) {
  const tables = $("table").toArray();
  let best = null;

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const rows = $(table).find("tr").toArray();
    if (rows.length < 30) continue;

    // header: th がある行を優先。なければ先頭行。
    const headerRow =
      rows.find((tr) => $(tr).find("th").length > 0) ?? rows[0];
    const headers = $(headerRow)
      .find("th,td")
      .map((_, el) => normText($(el).text()))
      .get()
      .filter(Boolean);

    const s = scoreHeader(headers);
    if (s <= 0) continue;

    let dexRows = 0;
    for (const tr of rows) {
      const first = normText($(tr).find("td").first().text());
      if (parseDexNo(first) !== null) dexRows++;
    }

    // 「図鑑Noの行が多い」テーブルを優先
    const totalScore = s * 1000 + dexRows * 10 + rows.length;
    if (!best || totalScore > best.totalScore) {
      best = { idx: i, table, headers, rows, dexRows, totalScore };
    }
  }

  return best;
}

function detectColumn(headers, patterns) {
  const idx = headers.findIndex((h) => patterns.some((re) => re.test(h)));
  return idx >= 0 ? idx : null;
}

function parsePokemonTable($, best) {
  const { table } = best;
  const rows = $(table).find("tr").toArray();

  const headerRow =
    rows.find((tr) => $(tr).find("th").length > 0) ?? rows[0];
  const headers = $(headerRow)
    .find("th,td")
    .map((_, el) => normText($(el).text()))
    .get()
    .filter(Boolean);

  const noCol = detectColumn(headers, [/\bNo\.?\b/i, /No/i, /図鑑/]) ?? 0;
  const nameCol = detectColumn(headers, [/ポケモン/, /名称/, /名前/]) ?? 1;
  const specialtyCol = detectColumn(headers, [/とくい|得意/]);
  const sleepCol = detectColumn(headers, [/睡眠/]);
  const berryCol = detectColumn(headers, [/木実|きのみ/]);
  const ingACol = detectColumn(headers, [/食A/]);
  const ingBCol = detectColumn(headers, [/食B/]);
  const ingCCol = detectColumn(headers, [/食C/]);
  const mainSkillCol = detectColumn(headers, [/メイン/]);
  const fpCol = detectColumn(headers, [/FP/]);
  const helpCol = detectColumn(headers, [/手伝/]);

  const items = [];
  for (const tr of rows) {
    const tds = $(tr).find("td").toArray();
    if (tds.length === 0) continue;

    const no = parseDexNo(normText($(tds[noCol] ?? tds[0]).text()));
    if (no === null) continue;

    const nameCell = $(tds[nameCol] ?? tds[1] ?? tds[0]);
    const name = normText(nameCell.text());
    if (!name) continue;

    const specialty = specialtyCol !== null ? normText($(tds[specialtyCol] ?? "").text()) : "";
    const sleep = sleepCol !== null ? normText($(tds[sleepCol] ?? "").text()) : "";
    const berry = berryCol !== null ? extractCellTextOrImgLabels($(tds[berryCol])) : [];
    const ingA = ingACol !== null ? extractCellTextOrImgLabels($(tds[ingACol])) : [];
    const ingB = ingBCol !== null ? extractCellTextOrImgLabels($(tds[ingBCol])) : [];
    const ingC = ingCCol !== null ? extractCellTextOrImgLabels($(tds[ingCCol])) : [];
    const mainSkill = mainSkillCol !== null ? normText($(tds[mainSkillCol] ?? "").text()) : "";
    const fp = fpCol !== null ? normText($(tds[fpCol] ?? "").text()) : "";
    const help = helpCol !== null ? normText($(tds[helpCol] ?? "").text()) : "";

    const relLink = nameCell.find("a").first().attr("href");
    const link = relLink ? new URL(relLink, args.url).toString() : null;

    items.push({
      dexNo: no,
      nameJa: name,
      specialtyJa: specialty || null,
      sleepTypeJa: sleep || null,
      berryJa: berry.length ? berry : null,
      ingAJa: ingA.length ? ingA : null,
      ingBJa: ingB.length ? ingB : null,
      ingCJa: ingC.length ? ingC : null,
      mainSkillJa: mainSkill || null,
      fp: fp ? Number(fp.replace(/,/g, "")) : null,
      helpSeconds: help ? Number(help.replace(/,/g, "")) : null,
      link,
    });
  }

  return { headers, items };
}

const res = await fetch(args.url, {
  headers: {
    // 軽いブロック回避（UA必須ではないが念のため）
    "User-Agent": "candy-boost-planner (generate-pokemon-db)",
  },
});
if (!res.ok) {
  throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
}
const html = await res.text();
const $ = cheerio.load(html);

const best = pickBestTable($);
if (!best) {
  throw new Error(
    "実装済みポケモン一覧のテーブルが見つかりませんでした。ページ構造が変わった可能性があります。"
  );
}

const { headers, items } = parsePokemonTable($, best);
if (items.length < 50) {
  throw new Error(
    `抽出件数が少なすぎます（${items.length}件）。テーブルの選別ロジックが外れている可能性があります。`
  );
}

// 重複（同一Noで別姿）は許容。安定化のため dexNo→name の順でソート。
items.sort((a, b) => (a.dexNo - b.dexNo) || a.nameJa.localeCompare(b.nameJa, "ja"));

const outPath = path.resolve(args.outFile);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const generatedAt = new Date().toISOString();
const content =
  `// This file is auto-generated by scripts/generate-pokemon-db.mjs\n` +
  `// Source: ${args.url}\n` +
  `// Generated at: ${generatedAt}\n\n` +
  `export type PokemonDbEntry = {\n` +
  `  dexNo: number; // 全国図鑑No\n` +
  `  nameJa: string;\n` +
  `  specialtyJa: string | null; // Wiki表記（例: きのみ/食材/スキル/オール）\n` +
  `  sleepTypeJa: string | null;\n` +
  `  berryJa: string[] | null;\n` +
  `  ingAJa: string[] | null;\n` +
  `  ingBJa: string[] | null;\n` +
  `  ingCJa: string[] | null;\n` +
  `  mainSkillJa: string | null;\n` +
  `  fp: number | null;\n` +
  `  helpSeconds: number | null;\n` +
  `  link: string | null;\n` +
  `};\n\n` +
  `export const pokemonDb: PokemonDbEntry[] = ${JSON.stringify(items, null, 2)} as const;\n\n` +
  `export const pokemonDbHeaders = ${JSON.stringify(headers, null, 2)} as const;\n`;

fs.writeFileSync(outPath, content, "utf8");

// 中間JSON（Master生成の入力用）
const jsonOutPath = path.resolve(path.join(__dirname, "../src/domain/pokesleep/_generated/pokemon-db.json"));
fs.mkdirSync(path.dirname(jsonOutPath), { recursive: true });
fs.writeFileSync(
  jsonOutPath,
  JSON.stringify(
    {
      source: args.url,
      generatedAt,
      headers,
      items,
      pickedTable: { index: best.idx, headerScore: scoreHeader(best.headers), dexRows: best.dexRows },
    },
    null,
    2
  ),
  "utf8"
);

console.log(`[generate-pokemon-db] picked table index=${best.idx} dexRows=${best.dexRows} headers=${headers.length}`);
console.log(`[generate-pokemon-db] entries=${items.length} wrote=${outPath}`);
console.log(`[generate-pokemon-db] wrote json=${jsonOutPath}`);
