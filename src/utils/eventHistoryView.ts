import type { EventHistoryEntry, SleepExpEventFlower } from "../domain/pokesleep/_generated/sleep-exp-events";
import { addGameDays, type GameDate } from "../domain/pokesleep/game-date";
import { localizeEventName } from "../i18n/eventNames";
import type { AppLocale } from "../i18n";

/** おいわいフラワーのあおいタネによる睡眠EXP倍率（`growth-flower.ts` と同じ固定値） */
const BLUE_SEED_MULTIPLIER = 3;

/** 写し元の窓と同じ 365 日（§3.1）。`today` ではなく実データ末尾から数える */
const RECENT_WINDOW_DAYS = 365;

/** 睡眠EXP列の1段。周年フェスだけ2段（1週目の倍率と、2週目のおいわいフラワー）になる。 */
export type EventHistoryExpLine = {
  /** 「1週目」。開催期間ぜんぶに掛かる回は空文字。**空でも段は出す**（チップの縦ラインが揃わなくなる） */
  tag: string;
  multiplier: number;
  /** おいわいフラワー（あおいタネ ×3）の段か */
  flower: boolean;
};

export type EventHistoryRow = {
  key: string;
  /** 「8/17–8/23」。年見出しと同じ年は省く */
  period: string;
  name: string;
  expLines: EventHistoryExpLine[];
  /** アメブースト。無ければ持たない */
  boost: { kind: "mini" | "full"; label: string } | null;
};

export type EventHistoryYearGroup = {
  /** 「2026年」 */
  year: string;
  /** 年合計。**列の並びと同じ順**（イベント / 睡眠EXP / アメブ） */
  summary: { label: string; value: string }[];
  rows: EventHistoryRow[];
};

export type EventHistoryCountRow = {
  label: string;
  text: string;
  /** 「2025/9/27–2026/9/27」。全期間の行は空 */
  range: string;
};

export type EventHistoryView = {
  counts: EventHistoryCountRow[];
  groups: EventHistoryYearGroup[];
};

type Translator = (key: string, params?: Record<string, unknown>) => string;

type Counts = { sleepExp: number; boostMini: number; boostFull: number };

/**
 * イベント履歴モーダルの表示モデル。表示文も出し分けもここで決めきり、
 * テンプレートには描画以外の判断を持たせない。
 *
 * **生成物を import しない**（型だけ）。呼び出し側が `history` / `flowers` / `cutoffDate` を渡す。
 * 計算側の決定（§3.1 / §14.5）と同じ根拠で花と直近1年を出すため、判断の材料は引数で揃える。
 */
export function buildEventHistoryView(params: {
  /** 開始日の降順（生成物の並びのまま） */
  history: readonly EventHistoryEntry[];
  /** おいわいフラワーの定義（名前の部分一致） */
  flowers: readonly SleepExpEventFlower[];
  /** 実データ末尾（`wikiKnownThrough`）。直近1年の窓はここから 365 日さかのぼる */
  cutoffDate: GameDate;
  t: Translator;
  locale: AppLocale;
}): EventHistoryView {
  const { history, flowers, cutoffDate, t, locale } = params;
  const recentFrom = addGameDays(cutoffDate, -RECENT_WINDOW_DAYS);
  const recent = history.filter(entry => entry.from >= recentFrom && entry.from <= cutoffDate);

  return {
    counts: [
      { label: t("eventHistory.countAllLabel"), text: t("eventHistory.count", countEntries(history)), range: "" },
      {
        label: t("eventHistory.countRecentLabel"),
        text: t("eventHistory.count", countEntries(recent)),
        range: formatPeriod(recentFrom, cutoffDate, locale),
      },
    ],
    groups: groupByYear(history).map(({ year, entries }) => {
      const counts = countEntries(entries);
      return {
        year: t("eventHistory.year", { year }),
        summary: [
          { label: t("eventHistory.colEvent"), value: t("eventHistory.yearCount", { count: entries.length }) },
          { label: t("eventHistory.colSleepExp"), value: t("eventHistory.yearCount", { count: counts.sleepExp }) },
          // アメブ列はミニブとアメブの合計。内訳は見出し下の2段（全期間／直近1年）で読める
          { label: t("eventHistory.colBoost"), value: t("eventHistory.yearCount", { count: counts.boostMini + counts.boostFull }) },
        ],
        rows: entries.map(entry => ({
          key: `${entry.name}-${entry.from}-${entry.to}`,
          period: formatPeriod(entry.from, entry.to, locale, year),
          name: localizeEventName(entry.name, locale, entry.from),
          expLines: buildExpLines(entry, flowers, t),
          boost: entry.boost
            ? { kind: entry.boost, label: t(entry.boost === "mini" ? "eventHistory.boostMini" : "eventHistory.boostFull") }
            : null,
        })),
      };
    }),
  };
}

function countEntries(entries: readonly EventHistoryEntry[]): Counts {
  return {
    sleepExp: entries.filter(entry => entry.sleepExp !== undefined).length,
    boostMini: entries.filter(entry => entry.boost === "mini").length,
    boostFull: entries.filter(entry => entry.boost === "full").length,
  };
}

/** 開始年ごとの塊。`history` が降順なので**並べ替えない**（同じ年が離れていたら別の塊になる） */
function groupByYear(history: readonly EventHistoryEntry[]): { year: string; entries: EventHistoryEntry[] }[] {
  const groups: { year: string; entries: EventHistoryEntry[] }[] = [];
  for (const entry of history) {
    const year = entry.from.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last?.year === year) last.entries.push(entry);
    else groups.push({ year, entries: [entry] });
  }
  return groups;
}

/**
 * 花の判定は計算側（`resolveBlueSeedSegments`）と同じ根拠で行う:
 * **花の定義に名前が当たる** ＋ **睡眠EXP区間の後ろに2週目がある**。
 * `sleepExp` を持たない回（1周年）や、開催期間ぜんぶに睡眠EXPが掛かる回には出さない。
 */
function buildExpLines(entry: EventHistoryEntry, flowers: readonly SleepExpEventFlower[], t: Translator): EventHistoryExpLine[] {
  if (!entry.sleepExp) return [];
  const isPartial = entry.sleepExp.from !== entry.from || entry.sleepExp.to !== entry.to;
  const lines: EventHistoryExpLine[] = [
    { tag: isPartial ? t("eventHistory.firstWeek") : "", multiplier: entry.sleepExp.multiplier, flower: false },
  ];
  const hasFlower = entry.sleepExp.to < entry.to && flowers.some(flower => entry.name.includes(flower.match));
  if (hasFlower) lines.push({ tag: t("eventHistory.secondWeek"), multiplier: BLUE_SEED_MULTIPLIER, flower: true });
  return lines;
}

function formatDate(date: string, locale: AppLocale, omitYear: boolean): string {
  const [year, month, day] = date.split("-");
  if (locale === "ja") return omitYear ? `${Number(month)}/${Number(day)}` : `${year}/${Number(month)}/${Number(day)}`;
  return omitYear ? `${month}/${day}` : `${month}/${day}/${year}`;
}

/**
 * 期間の表記。`year` を渡した年見出しの中では、**その年と同じ年だけ年を省く**。
 * 年をまたぐ開催回（12月開始→1月終了）は終了側に年が残るので、どの年へ食い込むかが読める。
 */
function formatPeriod(from: string, to: string, locale: AppLocale, year?: string): string {
  const omit = (date: string) => year !== undefined && date.startsWith(year);
  const fromText = formatDate(from, locale, omit(from));
  return from === to ? fromText : `${fromText}–${formatDate(to, locale, omit(to))}`;
}
