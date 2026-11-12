import type { Composer } from "vue-i18n";
import type { FineTuneOp, RowExclusion } from "../domain/fine-tune/draft";
import type { SleepReach } from "../domain/fine-tune/rowView";
import type { SleepTargetChoice } from "../domain/sleep-target";
import type { ExpGainNature } from "../domain/types";
import { sleepTargetHoursLabel } from "./sleepTimeText";

/** シンプルで選べる欄。`row` は行の詳細（動かせる欄が無い行・名前を押したとき）。 */
export type FineTuneField = "row" | "sleep" | "boost" | "candy";

/** 調整バーで選べる量（アメブ・アメの個数の刻み）。大きい順。目標Lvは表の欄から開く Lvピッカーで動かす。 */
export const FINE_TUNE_STEPS: Readonly<Record<"boost" | "candy", readonly number[]>> = {
  boost: [100, 10, 1],
  candy: [100, 10, 1],
};

/**
 * 押せない見た目のボタン（全体のLvを伸ばす・目標Lvに届く最小限のアメブ個数）を押したときに出す、理由のトーストの表示時間（ふつうのトーストは 2 秒）。
 * 理由は長いので読み切れるよう長めに出し、折り返し、画面のどこかを押すとすぐ消す。
 */
export const FINE_TUNE_REASON_TOAST = { durationMs: 6000, dismissOnPress: true, wrap: true } as const;

/**
 * 機械がまとめて調整するもの（「全体のLvを伸ばす」）に添えるキラキラ。`viewBox="0 0 16 16"` の塗りの形で、大小2つの星。
 */
export const SPARKLE_PATH =
  "M6.5 2.2C7 5.6 7.9 6.6 11.3 7.1 7.9 7.6 7 8.6 6.5 12 6 8.6 5.1 7.6 1.7 7.1 5.1 6.6 6 5.6 6.5 2.2Z"
  + "M12.4 9.6C12.6 11 12.9 11.4 14.3 11.6 12.9 11.8 12.6 12.2 12.4 13.6 12.2 12.2 11.9 11.8 10.5 11.6 11.9 11.4 12.2 11 12.4 9.6Z";

/** 睡眠目標でアメ在庫・チケットを使う印（計算機の睡眠目標の欄と同じ絵文字） */
export const SLEEP_STOCK_EMOJI = "\u{1F36C}";
export const SLEEP_TICKET_EMOJI = "\u{1F3AB}";

/** 前 → 後の増減「+12」「−3」（変わっていなければ null）。減るときはマイナス記号「−」（U+2212） */
export function deltaText(before: number, after: number, fmt: (n: number) => string): string | null {
  const d = after - before;
  if (d === 0) return null;
  return `${d > 0 ? "+" : "\u2212"}${fmt(Math.abs(d))}`;
}

/** EXP補正（性格）の印（計算機の行と同じ ▲▲・▼▼）。補正なしは null */
export function natureMarkText(t: Composer["t"], nature: ExpGainNature): string | null {
  if (nature === "up") return t("calc.row.natureUp");
  if (nature === "down") return t("calc.row.natureDown");
  return null;
}

/** 睡眠到達Lv「60.2」。「約」は付けず、小数第1位が 0（と Lv70）は整数だけ。 */
export function sleepReachText(reach: SleepReach): string {
  return reach.tenths === null || reach.tenths === 0 ? `${reach.level}` : `${reach.level}.${reach.tenths}`;
}

/**
 * 睡眠目標の名前（200h〜2000h・睡眠・おひるね島。未設定は「-」）と印（チケット → アメ在庫の順。計算機と同じ）。
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

/**
 * アメブを動かせない理由の文言。null は文言を出さない理由。
 * アメを使わない睡眠目標（🍬の無い睡眠・おひるね島）は、睡眠の欄を見れば分かるので出さない
 */
export const EXCLUSION_TEXT: Readonly<Record<RowExclusion, string | null>> = {
  noCandy: null,
  sleepOnly: "calc.fineTune.exclusion.sleepOnly",
  maxLevel: "calc.fineTune.exclusion.maxLevel",
  unknownPokemon: "calc.fineTune.exclusion.unknownPokemon",
};

/** 選んだ欄（アメブ・アメ）の刻み・範囲・op */
export interface FineTuneStepper {
  label: string;
  inputLabel: string;
  value: number;
  base: number;
  min: number;
  max: number;
  steps: readonly number[];
  stepOp: (by: number) => FineTuneOp;
  setOp: (value: number) => FineTuneOp;
}
