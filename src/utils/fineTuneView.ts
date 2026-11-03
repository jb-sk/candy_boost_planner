import type { SleepReach } from "../domain/fine-tune/rowView";

/** かんたんで選べる欄。`row` は行の詳細（動かせる欄が無い行・名前を押したとき）。 */
export type FineTuneField = "row" | "target" | "boost" | "candy";

/** 調整バーで選べる量。目標Lvは Lv の刻み、アメブ・アメは個数の刻み。大きい順。 */
export const FINE_TUNE_STEPS: Readonly<Record<Exclude<FineTuneField, "row">, readonly number[]>> = {
  target: [5, 1],
  boost: [100, 10, 1],
  candy: [100, 10, 1],
};

/** 睡眠到達Lv「60.2」。「約」は付けず、小数第1位が 0（と Lv70）は整数だけ。 */
export function sleepReachText(reach: SleepReach): string {
  return reach.tenths === null || reach.tenths === 0 ? `${reach.level}` : `${reach.level}.${reach.tenths}`;
}
