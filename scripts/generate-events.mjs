/**
 * ポケモンスリープ攻略Wikiから「睡眠EXPボーナス」の期間と倍率を取り出し、
 * src/domain/pokesleep/_generated/sleep-exp-events.ts を生成する。
 *
 *   pnpm run generate:events            生成
 *   pnpm run generate:events -- --verify  生成物が最新かを検査（CI用。差分があれば exit 1）
 *   pnpm run generate:events -- --dry-run 書き込まずに結果を表示
 *
 * 設計:
 *   - 一覧ページ = 開催回（名称・期間・年）の権威
 *   - 各イベントページ = 倍率の権威
 *   - 読めなかったものは warnings に積んで表示する。黙って 1.0 に落とさない
 *   - 判断が要るものは scripts/events-overrides.json に人手で書く
 *
 * @see .agent/sessions/睡眠EXP実測記録.md §3.2
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  compareDates,
  isSleepExpLabel,
  mergeSegments,
  normalizeText,
  parseBonusList,
  parseBonusTable,
  parseBoostFromSummary,
  parseBoostKindsFromSummary,
  parseDateRange,
  parseGameDate,
  parseHistoryTable,
  parseSleepExpFromSummary,
} from "./event-bonus-parser.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const BASE = "https://wikiwiki.jp";
const LIST_PATH = "/poke_sleep/イベント";
const USER_AGENT = "candy-boost-planner (generate-events)";
const DEFAULT_OUTPUT = path.join(ROOT, "src/domain/pokesleep/_generated/sleep-exp-events.ts");
const DEFAULT_OVERRIDES = path.join(__dirname, "events-overrides.json");
const CACHE_DIR = path.join(ROOT, "_local/wiki-cache/events");

/** Wikiへの連続アクセスは 429 を返すため、1件ごとに待つ */
const REQUEST_INTERVAL_MS = 2000;
const MAX_RETRY = 6;

function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    overrides: DEFAULT_OVERRIDES,
    verify: false,
    dryRun: false,
    noCache: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--output" && argv[i + 1]) args.output = path.resolve(argv[++i]);
    else if (arg === "--overrides" && argv[i + 1]) args.overrides = path.resolve(argv[++i]);
    else if (arg === "--verify") args.verify = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--no-cache") args.noCache = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchHtml(url, { noCache }) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${crypto.createHash("sha1").update(url).digest("hex")}.html`);
  if (!noCache && fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 6 * 60 * 60 * 1000) return fs.readFileSync(cacheFile, "utf8");
  }

  let backoff = REQUEST_INTERVAL_MS;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      const html = await res.text();
      fs.writeFileSync(cacheFile, html, "utf8");
      await sleep(REQUEST_INTERVAL_MS);
      return html;
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff;
      console.error(`  [retry ${res.status}] wait ${wait}ms — ${decodeURIComponent(url)}`);
      await sleep(wait);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} — ${url}`);
  }
  throw new Error(`Gave up after ${MAX_RETRY} attempts: ${url}`);
}

function toAbsoluteUrl(wikiPath) {
  return BASE + wikiPath.split("/").map((seg, i) => (i <= 1 ? seg : encodeURIComponent(seg))).join("/");
}

/**
 * 一覧ページの表から開催回を拾う。
 * 列は「名称 | 開催期間 | 主なイベントボーナス」。新しい順に並んでいる。
 */
export function parseEventList(html, { ignoredPages = new Set() } = {}) {
  const $ = cheerio.load(html);
  const occurrences = [];
  const unreadable = [];
  $("table").each((ti, table) => {
    const headerText = normalizeText($(table).find("tr").first().text());
    if (!/名称/.test(headerText) || !/開催期間/.test(headerText)) return;
    $(table)
      .find("tr")
      .slice(1)
      .each((ri, tr) => {
        const cells = $(tr).find("td,th").toArray();
        const link = $(tr).find("a[href]").filter((i, a) => {
          const href = decodeURIComponent($(a).attr("href") ?? "");
          return href.startsWith("/poke_sleep/") && href.includes("イベント/") && !href.includes("#");
        }).first();
        if (link.length === 0) return;
        const wikiPath = decodeURIComponent(link.attr("href"));
        const name = normalizeText(link.text());
        const texts = cells.map((c) => normalizeText($(c).text()));
        const periodIndex = texts.findIndex((t) => /\d+\s*[月/]\s*\d+/.test(t));
        if (!name) return;
        const pageName = wikiPath.replace("/poke_sleep/イベント/", "");
        if (periodIndex < 0) {
          // GSD/ニュームーンのように overrides.ignore で明示した常設行だけは
          // 日付を持たないことが仕様なので除外する。それ以外の名称付き行は、
          // 表記変更・未定・壊れた期間を黙って捨てず警告へ残す。
          if (!ignoredPages.has(pageName) && !ignoredPages.has(wikiPath)) {
            unreadable.push(`${name}: 開催期間を日付へ変換できない`);
          }
          return;
        }
        const range = parseDateRange(texts[periodIndex]);
        if (!range) {
          unreadable.push(`${name}: 開催期間を日付へ変換できない`);
          return; // 「満月の日とその前後」など日付にならない行
        }
        // 開催期間より後ろの列が「主なイベントボーナス」
        const bonusText = texts.slice(periodIndex + 1).join(" ");
        const boostKinds = parseBoostKindsFromSummary(bonusText);
        occurrences.push({
          name,
          wikiPath,
          from: range.from,
          to: range.to,
          bonusText,
          boost: parseBoostFromSummary(bonusText),
          boostWarning: boostKinds.mini && boostKinds.full ? "ミニアメブーストとアメブーストの両方が記載されているためミニを採用" : undefined,
        });
      });
  });
  return { occurrences, unreadable };
}

export function deriveWikiKnownThrough(occurrences) {
  if (occurrences.length === 0) throw new Error("イベント一覧が空です");
  return occurrences.reduce((latest, occurrence) => (
    compareDates(occurrence.to, latest) > 0 ? occurrence.to : latest
  ), occurrences[0].to);
}

/** 1つのイベントページから睡眠EXPの倍率区間を取る */
function parseEventPage(html, period) {
  const $ = cheerio.load(html);
  const scope = $("#body").length ? $("#body") : $("body");
  const warnings = [];
  const segments = [];

  $(scope)
    .find("table")
    .each((ti, table) => {
      let parsed;
      try {
        parsed = parseBonusTable($, table, period);
      } catch (error) {
        warnings.push(`表${ti}: ${error.message}`);
        return;
      }
      if (!parsed) return;
      segments.push(...parsed.segments);
      warnings.push(...parsed.warnings);
    });

  if (segments.length === 0) {
    const fromList = parseBonusList($, scope, period);
    if (fromList) {
      segments.push(...fromList.segments);
      warnings.push(...fromList.warnings);
    }
  }

  // 開催履歴表（複数回開催のイベントにある）。一覧との突き合わせに使う
  let historyPeriods = [];
  $(scope)
    .find("table")
    .each((ti, table) => {
      const periods = parseHistoryTable($, table);
      if (periods && periods.length > historyPeriods.length) historyPeriods = periods;
    });

  const mentionsSleepExp = isSleepExpLabel(normalizeText(scope.text()));
  if (mentionsSleepExp && segments.length === 0) {
    warnings.push("睡眠EXPの記述はあるが倍率を取り出せなかった");
  }
  return { segments: segments.length > 0 ? mergeSegments(segments) : [], warnings, historyPeriods };
}

export function readOverrides(overridesPath) {
  if (!fs.existsSync(overridesPath)) return { ignore: {}, segments: {}, periodFixes: [], anchors: [], flowers: [], nameEn: [] };
  const parsed = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
  const ignore = parsed.ignore ?? {};
  for (const [name, entry] of Object.entries(ignore)) {
    if (!String(entry?.reason ?? "").trim()) throw new Error(`ignore "${name}" に reason がない`);
  }
  const periodFixes = parsed.periodFixes ?? [];
  for (const fix of periodFixes) {
    if (!parseGameDate(fix?.from) || !parseGameDate(fix?.to)) throw new Error(`periodFixes の日付が不正: ${JSON.stringify(fix)}`);
    if (!String(fix?.name ?? "").trim()) throw new Error(`periodFixes に name がない: ${JSON.stringify(fix)}`);
    if (!String(fix?.reason ?? "").trim() || !String(fix?.source ?? "").trim()) {
      throw new Error(`periodFixes には reason と source が要る: ${JSON.stringify(fix)}`);
    }
  }

  const segments = parsed.segments ?? {};
  for (const [name, list] of Object.entries(segments)) {
    if (!Array.isArray(list)) throw new Error(`segments "${name}" は配列でなければならない`);
    for (const item of list) {
      if (!parseGameDate(item?.from) || !parseGameDate(item?.to)) throw new Error(`segments "${name}" の日付が不正: ${JSON.stringify(item)}`);
      if (!(Number(item?.multiplier) > 0)) throw new Error(`segments "${name}" の multiplier が不正: ${JSON.stringify(item)}`);
      if (!String(item?.reason ?? "").trim() || !String(item?.source ?? "").trim()) {
        throw new Error(`segments "${name}" には reason と source が要る: ${JSON.stringify(item)}`);
      }
    }
  }

  const anchors = parsed.anchors ?? [];
  if (!Array.isArray(anchors)) throw new Error("anchors は配列でなければならない");
  for (const anchor of anchors) {
    const month = Number(anchor?.month);
    const day = Number(anchor?.day);
    const candidate = `${String(2000).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!String(anchor?.match ?? "").trim() || !parseGameDate(candidate)) {
      throw new Error(`anchors の値が不正: ${JSON.stringify(anchor)}`);
    }
    if (!String(anchor?.reason ?? "").trim() || !String(anchor?.source ?? "").trim()) {
      throw new Error(`anchors には reason と source が要る: ${JSON.stringify(anchor)}`);
    }
  }

  const flowers = parsed.flowers ?? [];
  if (!Array.isArray(flowers)) throw new Error("flowers は配列でなければならない");
  for (const flower of flowers) {
    const days = Number(flower?.days);
    if (!String(flower?.match ?? "").trim() || !Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error(`flowers の値が不正: ${JSON.stringify(flower)}`);
    }
    if (!String(flower?.reason ?? "").trim() || !String(flower?.source ?? "").trim()) {
      throw new Error(`flowers には reason と source が要る: ${JSON.stringify(flower)}`);
    }
  }

  const nameEn = parsed.nameEn ?? [];
  if (!Array.isArray(nameEn)) throw new Error("nameEn は配列でなければならない");
  const seenNameEn = new Set();
  for (const override of nameEn) {
    const name = String(override?.name ?? "").trim();
    const en = String(override?.en ?? "").trim();
    const from = override?.from == null ? undefined : String(override.from).trim();
    if (!name || !en) throw new Error(`nameEn の name/en が不正: ${JSON.stringify(override)}`);
    if (from !== undefined && !parseGameDate(from)) {
      throw new Error(`nameEn の from が不正: ${JSON.stringify(override)}`);
    }
    if (!String(override?.reason ?? "").trim() || !String(override?.source ?? "").trim()) {
      throw new Error(`nameEn には reason と source が要る: ${JSON.stringify(override)}`);
    }
    const key = `${name}@${from ?? "*"}`;
    if (seenNameEn.has(key)) throw new Error(`nameEn の対象が重複している: ${key}`);
    seenNameEn.add(key);
  }
  return { ignore, segments, periodFixes, anchors, flowers, nameEn };
}

function renderOutput({ sleepExpRows, history, wikiKnownThrough, meta }) {
  const lines = sleepExpRows.map((row) => {
    const fields = [
      `name: ${JSON.stringify(row.name)}`,
      `from: ${JSON.stringify(row.from)}`,
      `to: ${JSON.stringify(row.to)}`,
      `multiplier: ${row.multiplier}`,
      `source: ${JSON.stringify(row.source)}`,
    ];
    return `  { ${fields.join(", ")} },`;
  });
  return `// This file is auto-generated by scripts/generate-events.mjs — do not edit by hand.
// Source: ${meta.listUrl}
// 手動確定した値: scripts/events-overrides.json
//
// 睡眠EXPボーナスの「イベント倍率」をゲーム日 [from, to]（両端を含む）で持つ。
// グッドスリープデーは月齢から求まるので、ここには入れず lunar-calendar.ts が扱う。

/** 睡眠EXPのイベント倍率が有効な区間。日付は 04:00 区切りのゲーム日。 */
export type SleepExpEventSegment = {
  /** Wiki上のイベント名 */
  readonly name: string;
  /** 開始ゲーム日 (YYYY-MM-DD, 両端含む) */
  readonly from: string;
  /** 終了ゲーム日 (YYYY-MM-DD, 両端含む) */
  readonly to: string;
  /** 睡眠EXPにかかる倍率 */
  readonly multiplier: number;
  /** "wiki" = イベントページ, "wiki-list" = 一覧ページ, "override" = scripts/events-overrides.json */
  readonly source: "wiki" | "wiki-list" | "override";
};

export const sleepExpEventSegments: readonly SleepExpEventSegment[] = [
${lines.join("\n")}
] as const;

export type EventAnchor = {
  readonly match: string;
  readonly month: number;
  readonly day: number;
};

export const sleepExpEventAnchors: readonly EventAnchor[] = ${JSON.stringify(meta.anchors.map(({ match, month, day }) => ({ match, month, day })))} as const;

export type SleepExpEventFlower = {
  readonly match: string;
  readonly days: number;
};

export const sleepExpEventFlowers: readonly SleepExpEventFlower[] = ${JSON.stringify(meta.flowers.map(({ match, days }) => ({ match, days })))} as const;

export type EventHistoryEntry = {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly sleepExp?: { readonly multiplier: number; readonly from: string; readonly to: string };
  readonly boost?: "mini" | "full";
};

export const eventHistory: readonly EventHistoryEntry[] = ${JSON.stringify(history)} as const;

/** Wikiのイベント一覧が把握している最後のゲーム日。仮イベントの写し元窓の右端。 */
export const wikiKnownThrough: string = ${JSON.stringify(wikiKnownThrough)};
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const overrides = readOverrides(args.overrides);

  const listUrl = toAbsoluteUrl(LIST_PATH);
  const listHtml = await fetchHtml(listUrl, args);
  const listResult = parseEventList(listHtml, { ignoredPages: new Set(Object.keys(overrides.ignore)) });
  const occurrences = listResult.occurrences;
  const warnings = [...listResult.unreadable];
  if (occurrences.length === 0) {
    if (warnings.length > 0) {
      console.warn(`[generate-events] 要確認 ${warnings.length} 件`);
      for (const line of warnings) console.warn(`  ! ${line}`);
    }
    throw new Error("イベント一覧から開催回を1件も取れなかった（表の構造が変わった可能性）");
  }

  for (const occurrence of occurrences) {
    if (occurrence.boostWarning) warnings.push(`${occurrence.name}: ${occurrence.boostWarning}`);
  }

  // Wikiの誤記を人手で訂正した分を反映する（一致しない fix は書き間違いなので落とす）
  for (const fix of overrides.periodFixes) {
    const target = occurrences.find(
      (o) => o.wikiPath.replace("/poke_sleep/イベント/", "") === fix.name && o.from === fix.from,
    );
    if (!target) throw new Error(`periodFixes が一覧のどの開催回にも当たらない: ${fix.name} ${fix.from}`);
    target.to = fix.to;
    target.fixed = true;
  }

  const byPath = new Map();
  for (const occurrence of occurrences) {
    const list = byPath.get(occurrence.wikiPath) ?? [];
    list.push(occurrence);
    byPath.set(occurrence.wikiPath, list);
  }

  const rows = [];
  const skipped = [];

  for (const [wikiPath, group] of byPath) {
    const pageName = wikiPath.replace("/poke_sleep/イベント/", "");
    const ignored = overrides.ignore[pageName];
    if (ignored) {
      skipped.push(`${pageName} — ${ignored.reason}`);
      continue;
    }

    const manual = overrides.segments[pageName];
    if (manual) {
      for (const item of manual) {
        rows.push({ name: pageName, from: item.from, to: item.to, multiplier: item.multiplier, source: "override" });
      }
      continue;
    }

    const html = await fetchHtml(toAbsoluteUrl(wikiPath), args);
    // 新しい順に並ぶので先頭が最新回。ページの記述は最新回のもの。
    const latest = [...group].sort((a, b) => compareDates(b.from, a.from))[0];
    let parsed;
    try {
      parsed = parseEventPage(html, latest);
    } catch (error) {
      warnings.push(`${pageName}: ${error.message}`);
      continue;
    }
    for (const warning of parsed.warnings) warnings.push(`${pageName}: ${warning}`);

    // 一覧の開催期間と、ページ内の開催履歴表を突き合わせる（Wikiの誤記を検出する）
    for (const occurrence of group) {
      if (occurrence.fixed) continue; // periodFixes で確定済み
      const matched = parsed.historyPeriods.find((p) => p.from === occurrence.from);
      if (matched && matched.to !== occurrence.to) {
        warnings.push(
          `${pageName}: 開催期間が一覧と履歴表で食い違う（${occurrence.from}.. 一覧=${occurrence.to} / 履歴表=${matched.to}）。`
          + ` events-overrides.json で確定すること`,
        );
      }
    }

    if (parsed.segments.length === 0) continue;

    for (const segment of parsed.segments) {
      rows.push({ name: pageName, from: segment.from, to: segment.to, multiplier: segment.multiplier, source: "wiki" });
    }

    // ページのボーナス記載は最新回のもの。過去回は一覧のボーナス列から補う
    for (const occurrence of group) {
      if (occurrence.from === latest.from) continue;
      const multiplier = parseSleepExpFromSummary(occurrence.bonusText);
      if (multiplier === null) {
        warnings.push(
          `${pageName}: 過去回 ${occurrence.from}..${occurrence.to} (${occurrence.name}) の睡眠EXP倍率が一覧に書かれていない。`
          + ` 最新回は x${parsed.segments[0].multiplier}。events-overrides.json で確定すること`,
        );
        continue;
      }
      rows.push({
        name: occurrence.name,
        from: occurrence.from,
        to: occurrence.to,
        multiplier,
        // 期間を periodFixes で訂正した回は、自動取得のままではないことを残す
        source: occurrence.fixed ? "override" : "wiki-list",
      });
    }
  }

  rows.sort((a, b) => compareDates(a.from, b.from) || a.name.localeCompare(b.name));

  // 期間の重なりは倍率の二重適用になるので、致命として落とす
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const current = rows[i];
    if (compareDates(current.from, prev.to) <= 0) {
      throw new Error(
        `睡眠EXPイベントの期間が重なっている: ${prev.name} ${prev.from}..${prev.to} と ${current.name} ${current.from}..${current.to}`,
      );
    }
  }

  const historyWithIndex = occurrences
    .map((occurrence, index) => {
      const candidates = rows
        .filter(row => (
          row.from >= occurrence.from
          && row.from <= occurrence.to
          && row.to >= occurrence.from
          && row.to <= occurrence.to
          && (row.name === occurrence.name || row.name === occurrence.wikiPath.replace("/poke_sleep/イベント/", ""))
        ))
        .sort((a, b) => compareDates(a.from, b.from));
      const sleepExp = candidates[0]
        ? { multiplier: candidates[0].multiplier, from: candidates[0].from, to: candidates[0].to }
        : undefined;
      if (!sleepExp && !occurrence.boost) return null;
      return {
        entry: {
          name: occurrence.name,
          from: occurrence.from,
          to: occurrence.to,
          ...(sleepExp ? { sleepExp } : {}),
          ...(occurrence.boost ? { boost: occurrence.boost } : {}),
        },
        index,
      };
    })
    .filter((value) => value !== null)
    .sort((a, b) => compareDates(b.entry.from, a.entry.from) || a.index - b.index)
    .map(value => value.entry);

  const wikiKnownThrough = deriveWikiKnownThrough(occurrences);
  const content = renderOutput({
    sleepExpRows: rows,
    history: historyWithIndex,
    wikiKnownThrough,
    meta: { listUrl, anchors: overrides.anchors, flowers: overrides.flowers },
  });

  console.log(`[generate-events] 開催回 ${occurrences.length} 件 / 睡眠EXP区間 ${rows.length} 件`);
  for (const row of rows) console.log(`  ${row.from}..${row.to}  x${row.multiplier}  ${row.name} (${row.source})`);
  if (skipped.length > 0) {
    console.log(`[generate-events] 除外 ${skipped.length} 件`);
    for (const line of skipped) console.log(`  - ${line}`);
  }
  if (warnings.length > 0) {
    console.warn(`[generate-events] 要確認 ${warnings.length} 件`);
    for (const line of warnings) console.warn(`  ! ${line}`);
  }

  if (args.verify) {
    const existing = fs.existsSync(args.output) ? fs.readFileSync(args.output, "utf8") : "";
    if (existing !== content) {
      console.error("[generate-events] 生成物が最新ではない。pnpm run generate:events を実行すること");
      process.exit(1);
    }
    console.log("[generate-events] verify OK");
    return;
  }
  if (args.dryRun) {
    console.log("[generate-events] --dry-run のため書き込みなし");
    return;
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, content, "utf8");
  console.log(`[generate-events] wrote: ${args.output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) await main();
