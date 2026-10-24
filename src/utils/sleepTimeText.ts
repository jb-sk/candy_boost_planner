import type { SleepTimeFormatTokens } from "../domain/pokesleep/sleep-growth-format";
import type { SleepTargetChoice } from "../domain/sleep-target";

/** 翻訳関数。vue-i18n の `t` を、引数を絞った形で受け取る */
export type TextTranslate = (key: string, params?: Record<string, unknown>) => string;

/** 睡眠時間・島の預け時間の書式の単位（計算画面と育成プランの表出力で共通） */
export function sleepTimeFormatTokens(t: TextTranslate): SleepTimeFormatTokens {
  return {
    hourUnit: t("calc.sleep.hourUnit"),
    minuteUnit: t("calc.sleep.minuteUnit"),
    dayUnit: t("calc.sleep.dayUnit"),
    hourMinuteSeparator: t("calc.sleep.hourMinuteSeparator"),
    rangeSeparator: t("calc.sleep.rangeSeparator"),
    exactDayJoiner: t("calc.sleep.exactDayJoiner"),
    approximatePrefix: t("calc.sleep.approximatePrefix"),
    estimateOpen: t("calc.sleep.estimateOpen"),
    estimateClose: t("calc.sleep.estimateClose"),
  };
}

/**
 * 睡眠到達Lv・島到達Lv の書式（睡眠・島で共通）。「約」は Lv70 でも付ける（推定値であることは変わらない）。
 * `hours` があれば「これから寝る時間」を括弧で添える。
 */
export function formatReachLevelText(
  t: TextTranslate,
  reach: { level: number; tenths: number | null },
  hours?: number,
): string {
  const value = reach.tenths === null ? `${reach.level}` : `${reach.level}.${reach.tenths}`;
  const base = `${t("calc.sleep.approximatePrefix")}${value}`;
  if (hours === undefined) return base;
  return `${base}${t("calc.sleep.estimateOpen")}${hours}${t("calc.sleep.hourUnit")}${t("calc.sleep.estimateClose")}`;
}

/** 数値の睡眠目標の名前 */
export function sleepTargetHoursLabel(hours: number): string {
  return `${hours}h`;
}

/**
 * 睡眠目標の名前と、チェックボックスの文字（「（チケット・アメ在庫）」）。順はチケット → アメ在庫（一覧の並びと同じ）。
 * 読み上げ（`calc.row.sleepTargetAriaLabel`）と育成プランの表出力で共通。
 */
export function sleepTargetNameParts(t: TextTranslate, choice: SleepTargetChoice): { name: string; options: string } {
  const name = choice.base === "none" ? t("calc.row.sleepTargetNone")
    : choice.base === "hours" ? sleepTargetHoursLabel(choice.hours)
    : choice.base === "napIsland" ? t("calc.row.sleepTargetNap")
    : t("calc.row.sleepTargetSleep");
  const list: string[] = [];
  if (choice.base === "napIsland" && choice.ticket) list.push(t("calc.row.sleepTargetAriaTicket"));
  if ((choice.base === "sleep" || choice.base === "napIsland") && choice.stock) list.push(t("calc.row.sleepTargetAriaStock"));
  return {
    name,
    options: list.length > 0
      ? t("calc.row.sleepTargetAriaOptions", { list: list.join(t("calc.row.sleepTargetAriaSeparator")) })
      : "",
  };
}
