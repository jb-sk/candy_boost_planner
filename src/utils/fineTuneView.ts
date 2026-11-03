import type { Composer } from "vue-i18n";
import type { SleepReach } from "../domain/fine-tune/rowView";
import type { SleepTargetChoice } from "../domain/sleep-target";
import { sleepTargetHoursLabel } from "./sleepTimeText";

/** シンプルで選べる欄。`row` は行の詳細（動かせる欄が無い行・名前を押したとき）。 */
export type FineTuneField = "row" | "target" | "sleep" | "boost" | "candy";

/** 調整バーで選べる量（アメブ・アメの個数の刻み）。大きい順。目標Lvは Lvピッカーと同じ形で動かす。 */
export const FINE_TUNE_STEPS: Readonly<Record<"boost" | "candy", readonly number[]>> = {
  boost: [100, 10, 1],
  candy: [100, 10, 1],
};

/** 目標Lvの丸いボタン（計算機の Lvピッカーと同じ並び） */
export const LEVEL_PRESETS: readonly number[] = [10, 25, 30, 40, 50, 55, 60, 65, 70];

/**
 * 押せない見た目のボタン（全体のLvを伸ばす・最小アメブ）を押したときに出す、理由のトーストの表示時間（ふつうのトーストは 2 秒）。
 * 理由は長いので読み切れるよう長めに出し、折り返し、画面のどこかを押すとすぐ消す。
 */
export const FINE_TUNE_REASON_TOAST = { durationMs: 6000, dismissOnPress: true, wrap: true } as const;

/** 睡眠目標でアメ在庫・チケットを使う印（計算機の睡眠目標の欄と同じ絵文字） */
export const SLEEP_STOCK_EMOJI = "\u{1F36C}";
export const SLEEP_TICKET_EMOJI = "\u{1F3AB}";

/** 睡眠到達Lv「60.2」。「約」は付けず、小数第1位が 0（と Lv70）は整数だけ。 */
export function sleepReachText(reach: SleepReach): string {
  return reach.tenths === null || reach.tenths === 0 ? `${reach.level}` : `${reach.level}.${reach.tenths}`;
}

/**
 * 睡眠目標の名前（200h〜2000h・全て・おひるね島。未設定は「-」）と印（チケット → アメ在庫の順。計算機と同じ）。
 * `short` はおひるね島を「島」と縮めた名前（狭い表の欄で使う）。
 */
export function sleepTargetText(t: Composer["t"], choice: SleepTargetChoice): { name: string; short: string; icons: string } {
  switch (choice.base) {
    case "none":
      return { name: "-", short: "-", icons: "" };
    case "hours": {
      const name = sleepTargetHoursLabel(choice.hours);
      return { name, short: name, icons: "" };
    }
    case "sleep":
      return { name: t("calc.fineTune.sleepOption.all"), short: t("calc.fineTune.sleepOption.all"), icons: choice.stock ? SLEEP_STOCK_EMOJI : "" };
    case "napIsland":
      return {
        name: t("calc.fineTune.sleepOption.nap"),
        short: t("calc.fineTune.sleepOption.napShort"),
        icons: (choice.ticket ? SLEEP_TICKET_EMOJI : "") + (choice.stock ? SLEEP_STOCK_EMOJI : ""),
      };
  }
}
