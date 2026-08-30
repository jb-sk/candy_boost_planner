/**
 * Astronomy Engine の満月をJST暦日へ変換し、実行時用の固定テーブルを生成する。
 *
 *   pnpm run generate:full-moon-dates
 *   pnpm run verify:full-moon-dates
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SearchMoonPhase } from "astronomy-engine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "src/domain/pokesleep/_generated/full-moon-dates.ts");

const FULL_MOON_FROM = "2023-01-01";
const FULL_MOON_THROUGH = "2046-12-31";
const SEARCH_FROM = new Date("2022-12-01T00:00:00.000Z");
const SEARCH_LIMIT_DAYS = 40;
const DAY_MS = 86_400_000;
const REFERENCE_TIME_ZONE = "Asia/Tokyo";

function calendarDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new Error(`Could not convert ${date.toISOString()} to ${timeZone}`);
  return `${year}-${month}-${day}`;
}

export function generateFullMoonDates() {
  const dates = [];
  let searchStart = SEARCH_FROM;
  while (true) {
    const event = SearchMoonPhase(180, searchStart, SEARCH_LIMIT_DAYS);
    if (!event || !Number.isFinite(event.date.getTime())) {
      throw new Error(`Could not find a full moon within ${SEARCH_LIMIT_DAYS} days of ${searchStart.toISOString()}`);
    }
    const date = calendarDateInTimeZone(event.date, REFERENCE_TIME_ZONE);
    if (date > FULL_MOON_THROUGH) break;
    if (date >= FULL_MOON_FROM) dates.push(date);
    searchStart = new Date(event.date.getTime() + DAY_MS);
  }
  return dates;
}

export function renderFullMoonDates(dates) {
  const rows = dates.map(date => `  "${date}",`).join("\n");
  return `/**
 * Astronomy Engine から生成したJST基準の満月日。
 * 生成物なので手で編集しないこと。
 * 再生成: pnpm run generate:full-moon-dates
 */
export const FULL_MOON_FROM = "${FULL_MOON_FROM}" as const;
export const FULL_MOON_THROUGH = "${FULL_MOON_THROUGH}" as const;

export const FULL_MOON_DATES = [
${rows}
] as const;
`;
}

function main() {
  const verify = process.argv.slice(2).filter(arg => arg !== "--").includes("--verify");
  const dates = generateFullMoonDates();
  const content = renderFullMoonDates(dates);
  if (verify) {
    const existing = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
    if (existing !== content) {
      console.error("[generate-full-moon-dates] 生成物が最新ではない。pnpm run generate:full-moon-dates を実行すること");
      process.exitCode = 1;
      return;
    }
    console.log("[generate-full-moon-dates] verify OK");
    return;
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, content, "utf8");
  console.log(`[generate-full-moon-dates] wrote ${dates.length} dates: ${OUTPUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();
