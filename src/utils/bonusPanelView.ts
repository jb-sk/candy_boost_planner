import { addGameDays, compareGameDates, formatGameMonthDay, gameDateDayOfWeek, parseGameDate, type GameDate } from "../domain/pokesleep/game-date";
import type { BlueSeedShift } from "../domain/pokesleep/growth-flower";
import type { EventMultiplierSegment } from "../domain/pokesleep/sleep-schedule";
import type { EventOccurrence, ProjectedEventOccurrence } from "../domain/pokesleep/projected-events";
import type { SleepBonusContribution, SleepBonusKind, SleepNightContribution } from "../domain/pokesleep/sleep-growth";
import { localizeEventName } from "../i18n/eventNames";
import type { AppLocale } from "../i18n";

/** ボーナス内訳の1行ぶんの表示文。空文字はそのセルを出さないことを表す。 */
export type BonusPanelRow = {
  /** 「素EXP」「GSD」「イベント」 */
  name: string;
  /** 「＋お香」タグを添えるか */
  withIncense: boolean;
  /** 「×3」。お香の行は空 */
  multiplier: string;
  /** 「4日」 */
  amount: string;
  /** 「+2,000EXP」。素EXPの行だけ「+」が付かない */
  exp: string;
  isBase: boolean;
};

/** 日別の表の1行ぶん。3晩以内の計画では、この行が内訳そのものになる。 */
export type BonusNightRow = {
  /** 「9/29」 */
  date: string;
  /** 日付に添える「GSD」「イベント」「仮イベント」 */
  subLabel?: string;
  /** 「＋お香」タグを添えるか */
  withIncense: boolean;
  /** 「×3」。お香だけ、またはボーナス無しなら空 */
  multiplier: string;
  /** 「8h30m」 */
  time: string;
  /** 「睡眠時間8時間30分」。読み上げ用 */
  timeAriaLabel: string;
  /** 「114＋28EXP」。素EXPと上乗せぶんに分けて出す。上乗せが無ければ「93EXP」 */
  exp: string;
  /** 「素EXP114、ボーナス28、合計142EXP」。読み上げ用 */
  expAriaLabel: string;
};

/** 展開したボーナス明細ひと箱ぶん。どれも空の行は明細そのものを出さない。 */
export type BonusPanelView = {
  /**
   * 内訳の表。内訳が無ければ持たない。
   *
   * **`rows` と `nights` は排他**（§10.5）。3晩以内は日別（`nights`）だけ、
   * 4晩以上は種類別（`rows`）だけ。日付列は3晩までしか出さない
   * （長期はGSDが何周期も入り、日付を並べると読めない）。
   */
  table?: {
    rows: BonusPanelRow[];
    nights: BonusNightRow[];
    total: string;
  };
  /** イベント一覧。1件も無ければ持たない */
  events?: EventChipListView;
  /** あおいタネのずらし通知。無ければ持たない */
  notes?: string[];
};

export type EventChipView = {
  /** 「2027年7月第2週」。年は計画が年をまたぐときだけ前置する */
  label: string;
  name: string;
  multiplier: number;
  /** 仮イベントか。ラベル横の「仮」印と、断り書きを出すかの判断に使う */
  projected: boolean;
  /** おいわいフラワーの補足。倍率はラベルへ混ぜない（他のチップと同じ体裁で出すため） */
  flower?: { label: string; multiplier: number };
};

export type EventChipListView = {
  chips: EventChipView[];
  /** 断り書き（「※「仮」は…」）を出すか。テンプレートで数えない */
  hasProjected: boolean;
};

type Translator = (key: string, params?: Record<string, unknown>) => string;

/**
 * ボーナス明細ひと箱ぶんの表示モデル。表示文も出し分けもここで決めきり、
 * テンプレートと呼び出し側には描画・配線以外の判断を持たせない。
 *
 * `needed` が無い行ではイベントと通知を調べない。計画期間を持たないイベントまで一覧へ
 * 混ざるのを防ぐ。表・一覧・通知がすべて空なら、結果行の「内訳」リンクも明細も出さないため
 * `undefined` を返し、呼び出し側が行のキーごと省けるようにする。
 *
 * 種類名に倍率や「＋お香」を混ぜないこと。1つの文字列にすると列が揃わず、
 * ×1.25 と ×3 を読み比べられない。
 *
 * **表は計画の長さで軸が変わる**（§10.5）。3晩以内は日別（日付・倍率・睡眠時間・EXP）、
 * 4晩以上は種類別（種類・倍率・日数・EXP）。**列数と並びは同じ**（名前 → 倍率 → 量 → EXP）で
 * 1列目と3列目の中身だけが変わるため、どちらも同じグリッドで描ける。
 */
export function buildBonusPanelView(params: {
  contributions: readonly SleepBonusContribution[];
  nights: readonly SleepNightContribution[];
  neededFrom?: GameDate;
  neededTo?: GameDate;
  realEvents: readonly EventOccurrence[];
  projectedEvents: readonly ProjectedEventOccurrence[];
  flowers: readonly { match: string; days: number }[];
  flowerSegments: readonly EventMultiplierSegment[];
  shifts: readonly BlueSeedShift[];
  t: Translator;
  locale: AppLocale;
  fmtNum: (value: number) => string;
}): BonusPanelView | undefined {
  const view: BonusPanelView = {};

  // 日別（3晩以内）と種類別（4晩以上）は排他。呼び出し側がどちらかだけを渡す。
  if (params.nights.length > 0) {
    view.table = {
      rows: [],
      nights: params.nights.map(night => {
        const extra = Math.max(0, night.exp - night.baseExp);
        const base = params.fmtNum(night.baseExp);
        return {
          date: formatGameMonthDay(night.date),
          ...(night.kind && night.kind !== "incense"
            ? { subLabel: bonusKindName(night.kind, params.t) }
            : {}),
          withIncense: night.withIncense,
          multiplier: night.multiplier === null ? "" : `×${night.multiplier}`,
          time: formatShortDuration(night.minutes, params.t),
          timeAriaLabel: params.t("calc.sleep.nightTimeAria", {
            time: formatSpokenDuration(night.minutes, params.t),
          }),
          // 素EXPと上乗せぶんを分けて出す。全体は「その晩に得るEXP」なので「+」で始めない。
          exp: extra > 0
            ? `${base}${params.t("calc.sleep.nightExpJoiner")}${params.fmtNum(extra)}EXP`
            : `${base}EXP`,
          expAriaLabel: extra > 0
            ? params.t("calc.sleep.nightExpSplitAria", {
                base,
                extra: params.fmtNum(extra),
                total: params.fmtNum(night.exp),
              })
            : params.t("calc.sleep.nightExpAria", { exp: base }),
        };
      }),
      total: `${params.fmtNum(params.nights.reduce((sum, night) => sum + night.exp, 0))}EXP`,
    };
  } else if (params.contributions.length > 0) {
    view.table = {
      rows: params.contributions.map(bonus => {
        return {
          name: bonusKindName(bonus.kind, params.t),
          withIncense: bonus.withIncense && bonus.kind !== "incense",
          multiplier: bonus.multiplier === null ? "" : `×${bonus.multiplier}`,
          amount: `${bonus.days}${params.t("calc.sleep.dayUnit")}`,
          exp: `${bonus.kind === "base" ? "" : "+"}${params.fmtNum(bonus.exp)}EXP`,
          isBase: bonus.kind === "base",
        };
      }),
      nights: [],
      // 合計＝この計画を寝きるともらえる睡眠EXP
      total: `${params.fmtNum(params.contributions.reduce((sum, bonus) => sum + bonus.exp, 0))}EXP`,
    };
  }

  if (params.neededFrom && params.neededTo) {
    // 期間での絞り込みは各ビルダーが正本。ここで先に絞ると配線漏れを純関数テストで拾えない。
    const events = buildEventChipList({
      realEvents: params.realEvents,
      projectedEvents: params.projectedEvents,
      neededFrom: params.neededFrom,
      neededTo: params.neededTo,
      flowers: params.flowers,
      flowerSegments: params.flowerSegments,
      t: params.t,
      locale: params.locale,
    });
    if (events.chips.length > 0) view.events = events;

    const notes = buildBlueSeedShiftNotes({
      shifts: params.shifts,
      neededFrom: params.neededFrom,
      neededTo: params.neededTo,
      t: params.t,
    });
    if (notes.length > 0) view.notes = notes;
  }

  return view.table || view.events || view.notes ? view : undefined;
}

/**
 * 日別の睡眠時間。**日本語でも `8h30m`**（「8時間30分」は列が長くなり、
 * 3行並ぶと日付より時間のほうが目立つ）。0分は落とすので満額の晩は `8h`。
 * 読み上げは `formatSpokenDuration` の側で「8時間30分」と綴る。
 */
function formatShortDuration(minutes: number, t: Translator): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const hourText = hours > 0 ? `${hours}${t("calc.sleep.hourShort")}` : "";
  const minuteText = mins > 0 || hours === 0 ? `${mins}${t("calc.sleep.minuteShort")}` : "";
  return `${hourText}${minuteText}`;
}

/** 読み上げ用。見出しの睡眠時間（`formatSleepTimeResult`）と同じ単位語を使う。 */
function formatSpokenDuration(minutes: number, t: Translator): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const hourText = hours > 0 ? `${hours}${t("calc.sleep.hourUnit")}` : "";
  const minuteText = mins > 0 || hours === 0 ? `${mins}${t("calc.sleep.minuteUnit")}` : "";
  if (!hourText) return minuteText;
  if (!minuteText) return hourText;
  return `${hourText}${t("calc.sleep.hourMinuteSeparator")}${minuteText}`;
}

function bonusKindName(kind: SleepBonusKind, t: Translator): string {
  return kind === "incense" ? t("calc.row.bonusIncense")
    : kind === "base" ? t("calc.row.bonusBase")
    : kind === "gsd" ? t("calc.row.bonusGsd")
    : kind === "event" ? t("calc.row.bonusEvent")
    : t("calc.row.bonusProjectedEvent");
}

function overlaps(from: GameDate, to: GameDate, otherFrom: GameDate, otherTo: GameDate): boolean {
  return compareGameDates(from, otherTo) <= 0 && compareGameDates(to, otherFrom) >= 0;
}

type ChipContext = {
  /** その行の計画期間（ボーナス内訳と同じ `needed`）。**絞り込みはこの関数の中でやる** */
  neededFrom: GameDate;
  neededTo: GameDate;
  flowers: readonly { match: string; days: number }[];
  flowerSegments: readonly EventMultiplierSegment[];
  spansMultipleYears: boolean;
  t: Translator;
  locale: AppLocale;
};

/**
 * イベント一覧のチップ。**実イベントを先、仮イベントを後**に並べる
 * （仮だけが並ぶと「実イベントが無い」ように読めるため。§6.2）。
 * どちらも同じ体裁で描き、仮の側だけ「仮」印を付ける。
 *
 * **計画期間での絞り込みもここで行う。** 呼び出し側で絞る形にすると、
 * 全区間を渡してしまう配線漏れを純関数テストで落とせない。
 */
export function buildEventChipList(params: {
  realEvents: readonly EventOccurrence[];
  projectedEvents: readonly ProjectedEventOccurrence[];
  neededFrom: GameDate;
  neededTo: GameDate;
  flowers: readonly { match: string; days: number }[];
  flowerSegments: readonly EventMultiplierSegment[];
  t: Translator;
  locale: AppLocale;
}): EventChipListView {
  const context: ChipContext = {
    ...params,
    // 522日計画では同じ「7月第2週」が2回出るので、年をまたぐときだけ年を前置する。
    spansMultipleYears: params.neededFrom.slice(0, 4) !== params.neededTo.slice(0, 4),
  };
  const chips = [
    ...buildChips(params.realEvents, false, context),
    ...buildChips(params.projectedEvents, true, context),
  ];
  return { chips, hasProjected: chips.some(chip => chip.projected) };
}

function buildChips(
  occurrences: readonly (EventOccurrence | ProjectedEventOccurrence)[],
  projected: boolean,
  context: ChipContext,
): EventChipView[] {
  return occurrences.flatMap(event => {
    const flower = hasFlower(event, projected, context);
    // **2週目だけが計画に掛かる場合も件を出す。** 花は1週目の終了後に生えるので、
    // 親の期間だけで絞ると「内訳に ×3 が出ているのに一覧が空」になる。
    // 花が計画期間へ届いているかは `hasFlower` 側で見ている。
    if (!flower && !overlaps(event.from, event.to, context.neededFrom, context.neededTo)) return [];
    return [{
      label: monthWeekLabel(event, context),
      // 手入力の区間は名前を持たないので既定の名前を当てる（空欄の行にしない）。
      // 英語名は開催回ごとに違う（「すくすくウィーク Vol.3 / Vol.4」）ので、
      // 仮イベントは**写した先ではなく写し元**の開始日で引く。
      name: event.name
        ? localizeEventName(event.name, context.locale, "sourceFrom" in event ? event.sourceFrom : event.from)
        : context.t("calc.row.manualEventName"),
      multiplier: event.multiplier,
      projected,
      ...(flower
        ? { flower: { label: context.t("calc.sleep.projectedFlowerLabel", { week: 2 }), multiplier: 3 } }
        : {}),
    }];
  });
}

function monthWeekLabel(event: EventOccurrence, context: ChipContext): string {
  const params = { month: event.month, week: event.weekOfMonth };
  return context.spansMultipleYears
    ? context.t("calc.sleep.monthWeekWithYear", { ...params, year: parseGameDate(event.from)!.year })
    : context.t("calc.sleep.monthWeek", params);
}

/**
 * 2週目のあおいタネがこの件に付くか。
 *
 * 花区間は `match` も `name` も持たない（表示都合を `EventMultiplierSegment` へ足さない決定）ので、
 * 「イベント終了の翌日から `days` 日」という2週目の窓を組み直して突き合わせる。
 * 計画期間に届いていない花は内訳にも出ないので、ここでも出さない。
 *
 * **実の周年に付いた花も出すこと。** 内訳の行は花を「イベント」「仮イベント」へ合流させる
 * ので、×3 が花由来だと分かるのはこの併記だけになった。
 *
 * **出自も突き合わせること。** 日付の窓だけで結ぶと、同じ週に実と仮の周年が並んだとき
 * （手入力が仮イベント期間へ重なった場合など）に、実の件へ仮の花が付く。
 */
function hasFlower(event: EventOccurrence, projected: boolean, context: ChipContext): boolean {
  const flower = context.flowers.find(candidate => event.name.includes(candidate.match));
  if (!flower) return false;
  const from = addGameDays(event.to, 1);
  const to = addGameDays(event.to, flower.days);
  return context.flowerSegments.some(segment => (
    segment.source === (projected ? "projectedFlower" : "flower")
    && segment.multiplier === 3
    && overlaps(segment.from, segment.to, from, to)
    && overlaps(segment.from, segment.to, context.neededFrom, context.neededTo)
  ));
}

const WEEKDAY_KEYS: Record<number, string> = {
  1: "calc.sleep.weekdayMon",
  2: "calc.sleep.weekdayTue",
  3: "calc.sleep.weekdayWed",
  4: "calc.sleep.weekdayThu",
  5: "calc.sleep.weekdayFri",
};

export function buildBlueSeedShiftNotes(params: {
  shifts: readonly BlueSeedShift[];
  neededFrom: GameDate;
  neededTo: GameDate;
  t: Translator;
}): string[] {
  return params.shifts
    .filter(shift => overlaps(shift.from, shift.to, params.neededFrom, params.neededTo))
    .map(shift => {
      const weekday = gameDateDayOfWeek(shift.from) || 7;
      return params.t("calc.sleep.blueSeedShiftedNote", {
        year: shift.year,
        weekday: params.t(WEEKDAY_KEYS[weekday] ?? "calc.sleep.weekdayNone"),
      });
    });
}
