/**
 * 睡眠目標の性質表。
 *
 * 行の睡眠目標は `sleepTargetMode`（時間でない目標）と `sleepTargetHours`（時間の目標）の2フィールドで保存する。
 * 計算が知りたいのはモードの名前ではなく、次の独立した2つの性質である。
 * - `candy`: アメの使い方（普通に配る／在庫だけ使う／1個も配らない）
 * - `rest`: 残EXPを埋める手段（なし／睡眠／おひるね島）
 * - `napTicket`: おひるね島でリラックスチケットを使うか
 *
 * `sleepTargetMode` を文字列リテラルと比べてよいのはこのファイルの中だけ
 * （`tests/unit/compat/sleep-target-literal.test.ts` が止める）。それ以外は `sleepTargetTraits` を通す。
 */

export const SLEEP_TARGET_MODES = ["all", "stock", "nap", "napTicket", "napStock", "napStockTicket"] as const;
export type SleepTargetMode = typeof SLEEP_TARGET_MODES[number];

export function isSleepTargetMode(v: unknown): v is SleepTargetMode {
  return (SLEEP_TARGET_MODES as readonly unknown[]).includes(v);
}

export type CandyPolicy = "normal" | "stockOnly" | "none";
export type RestFiller = "none" | "sleep" | "napIsland";
export type SleepTargetTraits = {
  readonly candy: CandyPolicy;
  readonly rest: RestFiller;
  readonly napTicket: boolean;
};

const MODE_TRAITS = {
  all: { candy: "none", rest: "sleep", napTicket: false },
  stock: { candy: "stockOnly", rest: "sleep", napTicket: false },
  nap: { candy: "none", rest: "napIsland", napTicket: false },
  napTicket: { candy: "none", rest: "napIsland", napTicket: true },
  napStock: { candy: "stockOnly", rest: "napIsland", napTicket: false },
  napStockTicket: { candy: "stockOnly", rest: "napIsland", napTicket: true },
} as const satisfies Record<SleepTargetMode, SleepTargetTraits>;

const UNSET_TRAITS: SleepTargetTraits = { candy: "normal", rest: "none", napTicket: false };
const HOURS_TRAITS: SleepTargetTraits = { candy: "normal", rest: "sleep", napTicket: false };

/** 睡眠目標の性質。行の2フィールドからモードを読むのはこの関数だけ */
export function sleepTargetTraits(row: {
  sleepTargetMode?: SleepTargetMode;
  sleepTargetHours?: number;
}): SleepTargetTraits {
  if (row.sleepTargetMode !== undefined) return MODE_TRAITS[row.sleepTargetMode];
  return row.sleepTargetHours !== undefined ? HOURS_TRAITS : UNSET_TRAITS;
}

/** 画面の選び方。数値の目標・未設定にはチェックボックスが無い */
export type SleepTargetChoice =
  | { base: "none" }
  | { base: "hours"; hours: number }
  | { base: "sleep"; stock: boolean }
  | { base: "napIsland"; stock: boolean; ticket: boolean };

/** 保存値 → 画面の選び方 */
export function sleepTargetChoiceOf(row: {
  sleepTargetMode?: SleepTargetMode;
  sleepTargetHours?: number;
}): SleepTargetChoice {
  if (row.sleepTargetMode !== undefined) {
    const traits = MODE_TRAITS[row.sleepTargetMode];
    const stock = traits.candy === "stockOnly";
    return traits.rest === "napIsland"
      ? { base: "napIsland", stock, ticket: traits.napTicket }
      : { base: "sleep", stock };
  }
  if (row.sleepTargetHours !== undefined) return { base: "hours", hours: row.sleepTargetHours };
  return { base: "none" };
}

/** 画面の選び方 → 保存値（`setRowSleepTarget` へ渡す形）。`MODE_TRAITS` を引くので、モード名の対応はこのファイルの表だけが持つ */
export function sleepTargetOfChoice(choice: SleepTargetChoice): number | SleepTargetMode | undefined {
  switch (choice.base) {
    case "none":
      return undefined;
    case "hours":
      return choice.hours;
    case "sleep":
      return findMode("sleep", choice.stock, false);
    case "napIsland":
      return findMode("napIsland", choice.stock, choice.ticket);
  }
}

function findMode(rest: RestFiller, stock: boolean, napTicket: boolean): SleepTargetMode {
  const candy: CandyPolicy = stock ? "stockOnly" : "none";
  const mode = SLEEP_TARGET_MODES.find((m) => {
    const traits = MODE_TRAITS[m];
    return traits.rest === rest && traits.candy === candy && traits.napTicket === napTicket;
  });
  if (mode === undefined) throw new Error(`no sleep target mode for ${rest} / ${candy} / ticket ${napTicket}`);
  return mode;
}
