/**
 * PokéSleep Super Wiki と Bulbapedia から英語名を取得し、日本語Wiki由来の
 * eventHistory と突き合わせて、ランタイム用の日英辞書を生成する。
 *
 *   pnpm run generate:event-names-en
 *   pnpm run generate:event-names-en -- --refresh
 *   pnpm run generate:event-names-en -- --force
 *
 * 名前同士は比較しない。Super Wiki はゲーム日 [from, to] の完全一致、Bulbapedia は
 * 終了日表記が一定しないため from の完全一致だけで採用する。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { readOverrides } from "./generate-events.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SOURCE_ORIGIN = "https://wiki.pokesleep.com";
const SOURCE_PATH = "/en/events";
const SOURCE_URL = `${SOURCE_ORIGIN}${SOURCE_PATH}`;
const ROBOTS_URL = `${SOURCE_ORIGIN}/robots.txt`;
const BULBAPEDIA_ORIGIN = "https://bulbapedia.bulbagarden.net";
const BULBAPEDIA_PATH = "/wiki/List_of_events_in_Pok%C3%A9mon_Sleep";
const BULBAPEDIA_URL = `${BULBAPEDIA_ORIGIN}${BULBAPEDIA_PATH}`;
const BULBAPEDIA_ROBOTS_URL = `${BULBAPEDIA_ORIGIN}/robots.txt`;
const USER_AGENT = "candy-boost-planner (generate-event-names-en)";
const REQUEST_INTERVAL_MS = 2000;
const CACHE_PATH = path.join(ROOT, "_local", "wiki-cache", "event-names-en.html");
const BULBAPEDIA_REQUEST_INTERVAL_MS = 5000;
const BULBAPEDIA_CACHE_PATH = path.join(ROOT, "_local", "wiki-cache", "event-names-en-bulbapedia.html");
const HISTORY_PATH = path.join(ROOT, "src", "domain", "pokesleep", "_generated", "sleep-exp-events.ts");
const OVERRIDES_PATH = path.join(__dirname, "events-overrides.json");
const OUTPUT_PATH = path.join(ROOT, "src", "i18n", "_generated", "event-name-en.ts");

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const formatDate = (date) => date.toISOString().slice(0, 10);

function parseArgs(argv) {
  return {
    refresh: argv.includes("--refresh") || argv.includes("--force"),
    force: argv.includes("--force"),
    listPending: argv.includes("--list-pending"),
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText} — ${url}`);
  return response.text();
}

/** 対象パスに最長一致する Allow/Disallow を使う、robots.txt の基本規則。 */
export function isPathAllowedByRobots(robotsText, targetPath) {
  const groups = [];
  let agents = [];
  let rules = [];
  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (rules.length > 0) flush();
      agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && agents.length > 0) {
      rules.push({ allow: field === "allow", path: value });
    }
  }
  flush();
  const applicable = groups.filter(group => group.agents.includes("*"));
  const matching = applicable.flatMap(group => group.rules)
    .filter(rule => rule.path && targetPath.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}

async function loadSourceHtml({ refresh, force }, source) {
  const robots = await fetchText(source.robotsUrl);
  if (!isPathAllowedByRobots(robots, source.path)) {
    throw new Error(`robots.txt が取得を許可していない: ${source.path}`);
  }
  console.log(`[generate-event-names-en] robots.txt: ${source.path} は取得可`);
  await sleep(source.requestIntervalMs);
  if (!refresh && fs.existsSync(source.cachePath)) {
    console.log(`[generate-event-names-en] キャッシュ読み込み: ${path.relative(ROOT, source.cachePath)}`);
    return fs.readFileSync(source.cachePath, "utf8");
  }
  if (force && fs.existsSync(source.cachePath)) fs.rmSync(source.cachePath);

  const html = await fetchText(source.url);
  fs.mkdirSync(path.dirname(source.cachePath), { recursive: true });
  fs.writeFileSync(source.cachePath, html, "utf8");
  return html;
}

function parseEnglishEndDate(periodText, start) {
  const candidates = [];
  const isoPattern = /(\d{4})-(\d{2})-(\d{2})\s+03:59/gi;
  for (const match of periodText.matchAll(isoPattern)) {
    candidates.push({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
  }

  const englishPattern = new RegExp(
    `(${Object.keys(MONTHS).join("|")})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s+(?:at\\s+)?(?:03:59|3:59\\s*a\\.m\\.)`,
    "gi",
  );
  for (const match of periodText.matchAll(englishPattern)) {
    const month = MONTHS[match[1].toLowerCase()];
    const startYear = Number(start.slice(0, 4));
    const startMonth = Number(start.slice(5, 7));
    candidates.push({
      year: match[3] ? Number(match[3]) : startYear + (month < startMonth ? 1 : 0),
      month,
      day: Number(match[2]),
    });
  }
  const end = candidates.at(-1);
  if (!end) return null;
  // Wikiの終了は 03:59。ゲーム日は04:00で切り替わるので暦日の前日が inclusive な to。
  return formatDate(new Date(Date.UTC(end.year, end.month - 1, end.day) - 86_400_000));
}

/** 通常HTMLのイベントカードから英語名とゲーム日区間を読む。 */
export function parseEnglishEventArchive(html) {
  const $ = cheerio.load(html);
  const events = [];
  const warnings = [];
  $("article.event-index-card").each((index, element) => {
    const card = $(element);
    const enName = card.find("h3").first().text().trim();
    const from = card.find("time").first().attr("datetime")?.trim();
    const periodText = card.find(".event-card-main small").first().text().replace(/\s+/g, " ").trim();
    const href = card.find("h3 a").first().attr("href") ?? "";
    const to = from ? parseEnglishEndDate(periodText, from) : null;
    if (!enName || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !to) {
      warnings.push(`英語Wiki カード${index + 1}: 開催期間を読めない (${enName || href || "名称なし"}: ${periodText})`);
      return;
    }
    events.push({ enName, from, to, source: new URL(href, SOURCE_ORIGIN).href });
  });
  return { events, warnings };
}

function parseBulbapediaStartDate(heading) {
  const normalized = heading.replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
  const start = normalized.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*-/);
  const trailingYear = normalized.match(/,\s*(\d{4})\s*$/);
  if (!start) return null;
  const month = MONTHS[start[1].toLowerCase()];
  const year = Number(start[3] ?? trailingYear?.[1]);
  const day = Number(start[2]);
  if (!month || !Number.isInteger(year)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return formatDate(date);
}

/** Bulbapedia の日付見出しと直後の説明段落から、英語名と開始日だけを読む。 */
export function parseBulbapediaEventArchive(html) {
  const $ = cheerio.load(html);
  const events = [];
  const warnings = [];
  $("h4").each((index, element) => {
    const heading = $(element).text().replace(/\s+/g, " ").trim();
    if (!/^[A-Za-z]+\s+\d/.test(heading)) return;
    const from = parseBulbapediaStartDate(heading);
    let sibling = $(element).next();
    while (sibling.length && !/^h[234]$/i.test(sibling[0].tagName) && sibling[0].tagName !== "p") {
      sibling = sibling.next();
    }
    const nameLink = sibling.is("p") ? sibling.find("b a").first() : $([]);
    const enName = nameLink.text().replace(/\s+/g, " ").trim();
    if (!from || !enName) {
      warnings.push(`Bulbapedia 見出し${index + 1}: 開始日またはイベント名を読めない (${heading || "見出しなし"})`);
      return;
    }
    events.push({ enName, from, source: nameLink.attr("href") || BULBAPEDIA_URL });
  });
  return { events, warnings };
}

/**
 * ソース間の食い違いを見るときだけ使う正規化。ダッシュ類（`—` / `–` / `−`）と空白の差は
 * **単なる表記ゆれ**で、人が裏を取る価値が無い。ここで吸わないと
 * 「Holiday 2025 — …」対「Holiday 2025 - …」のような警告が並び、
 * 本当に見てほしい食い違い（"No. 2" 対 "Vol. 2" など）が埋もれる。
 *
 * **辞書へ入れる値は正規化しない。** 採用したソースの表記をそのまま出す。
 */
function normalizeEnNameForCompare(enName) {
  return enName.replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
}

/** 開催期間で日英を結び、開催回辞書と「全開催回で一意な名前」辞書を作る。 */
export function matchEventNames(japaneseEvents, englishEvents, nameOverrides = [], bulbapediaEvents = []) {
  const warnings = [];
  const periodMapping = {};
  const resolved = new Map();
  const sources = { override: 0, superWiki: 0, bulbapedia: 0 };
  let unmatchedOccurrences = 0;
  let ambiguousOccurrences = 0;
  // 人が `nameEn` で裁定済みの開催回。ソース間の食い違いを警告しても、
  // **採用されるのは override** なので「Super Wiki を採用」と書くと嘘になる。
  // 裁定済みのものを毎回警告し続けても、人が消せない警告が残るだけで意味が無い。
  const adjudicatedKeys = new Set(
    nameOverrides.filter(override => override.from != null).map(override => `${override.name}@${override.from}`),
  );

  for (const event of japaneseEvents) {
    const superCandidates = englishEvents.filter(candidate => candidate.from === event.from && candidate.to === event.to);
    const bulbapediaCandidates = bulbapediaEvents.filter(candidate => candidate.from === event.from);
    if (superCandidates.length > 1) {
      ambiguousOccurrences++;
      warnings.push(`${event.name} ${event.from}..${event.to}: Super Wiki に同期間の英語イベントが複数 (${superCandidates.map(x => x.enName).join(" / ")})`);
    }
    if (bulbapediaCandidates.length > 1) {
      ambiguousOccurrences++;
      warnings.push(`${event.name} ${event.from}: Bulbapedia に同じ開始日の英語イベントが複数 (${bulbapediaCandidates.map(x => x.enName).join(" / ")})`);
    }
    const superMatch = superCandidates.length === 1 ? superCandidates[0] : null;
    const bulbapediaMatch = bulbapediaCandidates.length === 1 ? bulbapediaCandidates[0] : null;
    if (superMatch && bulbapediaMatch
      && !adjudicatedKeys.has(`${event.name}@${event.from}`)
      && normalizeEnNameForCompare(superMatch.enName) !== normalizeEnNameForCompare(bulbapediaMatch.enName)) {
      warnings.push(`${event.name} ${event.from}: 英語名がソース間で不一致。Super Wiki "${superMatch.enName}" (${superMatch.source ?? SOURCE_URL}) を採用し、Bulbapedia "${bulbapediaMatch.enName}" (${bulbapediaMatch.source ?? BULBAPEDIA_URL}) は不採用`);
    }
    if (superMatch) resolved.set(`${event.name}@${event.from}`, { enName: superMatch.enName, source: "superWiki", sourceUrl: superMatch.source ?? SOURCE_URL });
    else if (bulbapediaMatch) resolved.set(`${event.name}@${event.from}`, { enName: bulbapediaMatch.enName, source: "bulbapedia", sourceUrl: bulbapediaMatch.source ?? BULBAPEDIA_URL });
  }

  const periodOverrides = nameOverrides.filter(override => override.from != null);
  const nameOnlyOverrides = nameOverrides.filter(override => override.from == null);
  for (const override of periodOverrides) {
    const occurrence = japaneseEvents.find(event => event.name === override.name && event.from === override.from);
    if (!occurrence) {
      throw new Error(`nameEn が eventHistory の開催回に当たらない: ${override.name}@${override.from}`);
    }
    resolved.set(`${override.name}@${override.from}`, { enName: override.en, source: "override", sourceUrl: override.source ?? "scripts/events-overrides.json" });
  }
  const knownJapaneseNames = new Set(japaneseEvents.map(event => event.name));
  for (const override of nameOnlyOverrides) {
    if (!knownJapaneseNames.has(override.name)) throw new Error(`nameEn が eventHistory の名前に当たらない: ${override.name}`);
    const occurrences = japaneseEvents.filter(event => event.name === override.name);
    const resolvedNames = new Set(occurrences
      .map(event => resolved.get(`${event.name}@${event.from}`)?.enName)
      .filter(Boolean));
    if ([...resolvedNames].some(enName => enName !== override.en)) {
      throw new Error(
        `nameEn "${override.name}" は開催回ごとに異なる自動取得名を一つへ潰すため適用できない: `
        + `${[...resolvedNames].join(" / ")}`,
      );
    }
    for (const event of occurrences) {
      resolved.set(`${event.name}@${event.from}`, { enName: override.en, source: "override", sourceUrl: override.source ?? "scripts/events-overrides.json" });
    }
  }

  const matchesByJaName = new Map();
  const unresolvedJaNames = new Set();
  const provenance = [];
  for (const event of japaneseEvents) {
    const key = `${event.name}@${event.from}`;
    const match = resolved.get(key);
    if (!match) {
      unmatchedOccurrences++;
      unresolvedJaNames.add(event.name);
      for (const alias of event.aliases ?? []) unresolvedJaNames.add(alias.name);
      warnings.push(`${event.name} ${event.from}..${event.to}: Super Wiki の期間にも Bulbapedia の開始日にも一致しない`);
      continue;
    }
    sources[match.source]++;
    const occurrenceNames = [...new Set([event.name, ...(event.aliases ?? []).map(alias => alias.name)])];
    for (const japaneseName of occurrenceNames) {
      const occurrenceKey = `${japaneseName}@${event.from}`;
      periodMapping[occurrenceKey] = match.enName;
      provenance.push({ key: occurrenceKey, enName: match.enName, source: match.source, sourceUrl: match.sourceUrl });
      const names = matchesByJaName.get(japaneseName) ?? [];
      names.push(match.enName);
      matchesByJaName.set(japaneseName, names);
    }
  }

  const nameMapping = {};
  for (const [jaName, names] of matchesByJaName) {
    if (unresolvedJaNames.has(jaName)) {
      warnings.push(`${jaName}: 未解決の開催回があるため、別開催回の英語名を全件へ流用せず辞書から除外`);
      continue;
    }
    const distinct = [...new Set(names)];
    if (distinct.length > 1) {
      warnings.push(`${jaName}: 開催回により英語名が異なる (${distinct.join(" / ")})。期間キーだけを生成`);
      continue;
    }
    nameMapping[jaName] = distinct[0];
  }

  return {
    periodMapping,
    nameMapping,
    warnings,
    provenance,
    stats: { matchedOccurrences: japaneseEvents.length - unmatchedOccurrences, unmatchedOccurrences, ambiguousOccurrences, sources },
  };
}

export function parseJapaneseEventDataSource(source) {
  const historyMatch = source.match(/export const eventHistory[^=]*=\s*(\[[\s\S]*?\])\s+as const;/);
  const segmentsMatch = source.match(/export const sleepExpEventSegments[^=]*=\s*(\[[\s\S]*?\])\s+as const;/);
  if (!historyMatch || !segmentsMatch) {
    throw new Error("eventHistory または sleepExpEventSegments を読み取れない");
  }
  const sleepExpEventSegments = [];
  const segmentPattern = /\{\s*name:\s*("(?:\\.|[^"\\])*")\s*,\s*from:\s*("\d{4}-\d{2}-\d{2}")\s*,\s*to:\s*("\d{4}-\d{2}-\d{2}")\s*,\s*multiplier:\s*([\d.]+)\s*,\s*source:\s*"(?:wiki|wiki-list|override)"\s*\}/g;
  for (const match of segmentsMatch[1].matchAll(segmentPattern)) {
    sleepExpEventSegments.push({
      name: JSON.parse(match[1]),
      from: JSON.parse(match[2]),
      to: JSON.parse(match[3]),
      multiplier: Number(match[4]),
    });
  }
  if (sleepExpEventSegments.length === 0) {
    throw new Error("sleepExpEventSegments が空か、形式を読み取れない");
  }
  return { eventHistory: JSON.parse(historyMatch[1]), sleepExpEventSegments };
}

function readJapaneseEventData() {
  return parseJapaneseEventDataSource(fs.readFileSync(HISTORY_PATH, "utf8"));
}

/** 生成物2つだけを比較する。Wiki読込やHTTP取得を呼ぶ経路からは独立している。 */
export function listPendingEventNameKeys(eventDataSource, eventNameSource) {
  const { eventHistory, sleepExpEventSegments } = parseJapaneseEventDataSource(eventDataSource);
  const mappingMatch = eventNameSource.match(/export const eventNameJaToEnByPeriod[^=]*=\s*\{([\s\S]*?)\}\s*;/);
  if (!mappingMatch) throw new Error("eventNameJaToEnByPeriod を読み取れない");
  const resolvedKeys = new Set();
  const keyPattern = /^\s*("(?:\\.|[^"\\])*")\s*:/gm;
  for (const match of mappingMatch[1].matchAll(keyPattern)) resolvedKeys.add(JSON.parse(match[1]));
  const requiredKeys = new Set([
    ...eventHistory.map(event => `${event.name}@${event.from}`),
    ...sleepExpEventSegments.map(segment => `${segment.name}@${segment.from}`),
  ]);
  return [...requiredKeys].filter(key => !resolvedKeys.has(key)).sort((a, b) => a.localeCompare(b, "ja"));
}

function printPendingEventNames() {
  const pending = listPendingEventNameKeys(
    fs.readFileSync(HISTORY_PATH, "utf8"),
    fs.readFileSync(OUTPUT_PATH, "utf8"),
  );
  if (pending.length === 0) console.log("[check-event-names-en] 未解決なし");
  else {
    console.log(`[check-event-names-en] 未解決 ${pending.length} 件`);
    for (const key of pending) console.log(`  ? ${key}`);
  }
  console.log(`[SUMMARY] pending=${pending.length}`);
}

/** 睡眠EXP区間の表示名を、その区間を持つ開催回の別名として結び付ける。 */
export function attachSleepExpSegmentAliases(eventHistory, sleepExpEventSegments) {
  const aliasesByHistoryKey = new Map();
  for (const segment of sleepExpEventSegments) {
    const candidates = eventHistory.filter(event => (
      event.sleepExp?.from === segment.from
      && event.sleepExp?.to === segment.to
      && event.sleepExp?.multiplier === segment.multiplier
    ));
    if (candidates.length !== 1) {
      throw new Error(
        `sleepExpEventSegments の開催回を一意に特定できない: ${segment.name}@${segment.from} `
        + `(候補 ${candidates.length} 件)`,
      );
    }
    const historyKey = `${candidates[0].name}@${candidates[0].from}`;
    const aliases = aliasesByHistoryKey.get(historyKey) ?? [];
    aliases.push({ name: segment.name, from: segment.from });
    aliasesByHistoryKey.set(historyKey, aliases);
  }
  return eventHistory.map(event => ({
    ...event,
    aliases: aliasesByHistoryKey.get(`${event.name}@${event.from}`) ?? [],
  }));
}

function renderRecord(mapping) {
  return Object.entries(mapping)
    .sort(([a], [b]) => a.localeCompare(b, "ja"))
    .map(([ja, en]) => `  ${JSON.stringify(ja)}: ${JSON.stringify(en)},`);
}

/**
 * 生成物の本文を組む。**`listPendingEventNameKeys` が読み返せる形であること**が契約。
 * 書く側と読む側がずれると、CIの未解決判定が黙って狂う（テストで往復を固定している）。
 */
export function renderOutput(periodMapping, nameMapping) {
  const periodLines = renderRecord(periodMapping);
  const nameLines = renderRecord(nameMapping);
  return `// This file is auto-generated by scripts/generate-event-names-en.mjs — do not edit by hand.\n`
    + `// Source: ${SOURCE_URL}\n`
    + `// Source: ${BULBAPEDIA_URL}\n`
    + `// Manual overrides: scripts/events-overrides.json (nameEn)\n\n`
    + `/** 開催回ごとの英語名。キーは \`\${日本語名}@\${from}\`（from はゲーム日 YYYY-MM-DD）。 */\n`
    + `export const eventNameJaToEnByPeriod: Record<string, string> = {\n${periodLines.join("\n")}\n};\n\n`
    + `/** 全開催回で英語名が同一で、名前だけでも一意に決まるイベント。 */\n`
    + `export const eventNameJaToEn: Record<string, string> = {\n${nameLines.join("\n")}\n};\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const overrides = readOverrides(OVERRIDES_PATH);
  const html = await loadSourceHtml(args, { url: SOURCE_URL, robotsUrl: ROBOTS_URL, path: SOURCE_PATH, cachePath: CACHE_PATH, requestIntervalMs: REQUEST_INTERVAL_MS });
  const bulbapediaHtml = await loadSourceHtml(args, { url: BULBAPEDIA_URL, robotsUrl: BULBAPEDIA_ROBOTS_URL, path: BULBAPEDIA_PATH, cachePath: BULBAPEDIA_CACHE_PATH, requestIntervalMs: BULBAPEDIA_REQUEST_INTERVAL_MS });
  const parsed = parseEnglishEventArchive(html);
  const bulbapediaParsed = parseBulbapediaEventArchive(bulbapediaHtml);
  if (parsed.events.length === 0) throw new Error("英語Wikiからイベントを1件も取得できない（HTML構造が変わった可能性）");
  if (bulbapediaParsed.events.length === 0) throw new Error("Bulbapediaからイベントを1件も取得できない（HTML構造が変わった可能性）");
  const japaneseData = readJapaneseEventData();
  const japaneseEvents = attachSleepExpSegmentAliases(
    japaneseData.eventHistory,
    japaneseData.sleepExpEventSegments,
  );
  const result = matchEventNames(japaneseEvents, parsed.events, overrides.nameEn, bulbapediaParsed.events);
  const warnings = [...parsed.warnings, ...bulbapediaParsed.warnings, ...result.warnings];
  const content = renderOutput(result.periodMapping, result.nameMapping);
  const oldContent = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  if (args.force || content !== oldContent) fs.writeFileSync(OUTPUT_PATH, content, "utf8");
  else console.log("[generate-event-names-en] 生成物に変更なし（書き込みスキップ）");

  console.log(`[generate-event-names-en] 日本語開催回 ${japaneseEvents.length} 件 / Super Wiki ${parsed.events.length} 件 / Bulbapedia ${bulbapediaParsed.events.length} 件`);
  console.log(`[generate-event-names-en] 解決 ${result.stats.matchedOccurrences} 件 (override ${result.stats.sources.override} / Super Wiki ${result.stats.sources.superWiki} / Bulbapedia ${result.stats.sources.bulbapedia}) / 期間辞書 ${Object.keys(result.periodMapping).length} 件 / 名前辞書 ${Object.keys(result.nameMapping).length} 件`);
  for (const item of result.provenance) {
    console.log(`  [${item.source}] ${item.key} -> ${item.enName} (${item.sourceUrl})`);
  }
  if (warnings.length > 0) {
    console.warn(`[generate-event-names-en] 要確認 ${warnings.length} 件`);
    for (const warning of warnings) console.warn(`  ! ${warning}`);
  }
  console.log(`[SUMMARY] japanese=${japaneseEvents.length} super_wiki=${parsed.events.length} bulbapedia=${bulbapediaParsed.events.length} matched=${result.stats.matchedOccurrences} override=${result.stats.sources.override} super_matched=${result.stats.sources.superWiki} bulbapedia_matched=${result.stats.sources.bulbapedia} period_mapped=${Object.keys(result.periodMapping).length} name_mapped=${Object.keys(result.nameMapping).length} warnings=${warnings.length} unmatched=${result.stats.unmatchedOccurrences} ambiguous=${result.stats.ambiguousOccurrences}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = parseArgs(process.argv);
  if (args.listPending) {
    try {
      printPendingEventNames();
    } catch (error) {
      console.error(`[check-event-names-en] 判定不能: ${error instanceof Error ? error.message : String(error)}`);
      console.log("[SUMMARY] pending=unknown");
    }
  } else await main();
}
