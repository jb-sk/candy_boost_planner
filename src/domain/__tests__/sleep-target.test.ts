import { describe, expect, it } from "vitest";
import { SLEEP_TARGET_HOURS_OPTIONS } from "../types";
import {
  SLEEP_TARGET_MODES,
  isSleepTargetMode,
  sleepTargetChoiceOf,
  sleepTargetOfChoice,
  sleepTargetTraits,
  type SleepTargetChoice,
  type SleepTargetMode,
} from "../sleep-target";

type RowFields = { sleepTargetMode?: SleepTargetMode; sleepTargetHours?: number };

describe("sleepTargetTraits（8状態の性質表）", () => {
  const table: { name: string; row: RowFields; expected: ReturnType<typeof sleepTargetTraits> }[] = [
    { name: "未設定", row: {}, expected: { candy: "normal", rest: "none", napTicket: false } },
    { name: "数値", row: { sleepTargetHours: 1000 }, expected: { candy: "normal", rest: "sleep", napTicket: false } },
    { name: "すべて睡眠", row: { sleepTargetMode: "all" }, expected: { candy: "none", rest: "sleep", napTicket: false } },
    { name: "アメ在庫＋睡眠", row: { sleepTargetMode: "stock" }, expected: { candy: "stockOnly", rest: "sleep", napTicket: false } },
    { name: "おひるね島", row: { sleepTargetMode: "nap" }, expected: { candy: "none", rest: "napIsland", napTicket: false } },
    { name: "おひるね島＋チケ", row: { sleepTargetMode: "napTicket" }, expected: { candy: "none", rest: "napIsland", napTicket: true } },
    { name: "アメ在庫＋おひるね島", row: { sleepTargetMode: "napStock" }, expected: { candy: "stockOnly", rest: "napIsland", napTicket: false } },
    { name: "アメ在庫＋おひるね島＋チケ", row: { sleepTargetMode: "napStockTicket" }, expected: { candy: "stockOnly", rest: "napIsland", napTicket: true } },
  ];

  it.each(table)("$name", ({ row, expected }) => {
    expect(sleepTargetTraits(row)).toEqual(expected);
  });
});

describe("isSleepTargetMode", () => {
  it("6値だけを通す", () => {
    expect([...SLEEP_TARGET_MODES]).toEqual(["all", "stock", "nap", "napTicket", "napStock", "napStockTicket"]);
    for (const mode of SLEEP_TARGET_MODES) expect(isSleepTargetMode(mode)).toBe(true);
    for (const v of ["", "ALL", "island", undefined, null, 1000]) expect(isSleepTargetMode(v)).toBe(false);
  });
});

describe("sleepTargetChoiceOf / sleepTargetOfChoice", () => {
  const rows: { name: string; row: RowFields; choice: SleepTargetChoice; target: number | SleepTargetMode | undefined }[] = [
    { name: "未設定", row: {}, choice: { base: "none" }, target: undefined },
    ...SLEEP_TARGET_HOURS_OPTIONS.map((hours) => ({
      name: `${hours}h`,
      row: { sleepTargetHours: hours },
      choice: { base: "hours", hours } as SleepTargetChoice,
      target: hours as number | SleepTargetMode | undefined,
    })),
    { name: "睡眠", row: { sleepTargetMode: "all" }, choice: { base: "sleep", stock: false }, target: "all" },
    { name: "睡眠＋アメ在庫", row: { sleepTargetMode: "stock" }, choice: { base: "sleep", stock: true }, target: "stock" },
    { name: "おひるね島", row: { sleepTargetMode: "nap" }, choice: { base: "napIsland", stock: false, ticket: false }, target: "nap" },
    { name: "おひるね島＋チケット", row: { sleepTargetMode: "napTicket" }, choice: { base: "napIsland", stock: false, ticket: true }, target: "napTicket" },
    { name: "おひるね島＋アメ在庫", row: { sleepTargetMode: "napStock" }, choice: { base: "napIsland", stock: true, ticket: false }, target: "napStock" },
    { name: "おひるね島＋アメ在庫＋チケット", row: { sleepTargetMode: "napStockTicket" }, choice: { base: "napIsland", stock: true, ticket: true }, target: "napStockTicket" },
  ];

  it.each(rows)("$name: 保存値 ⇔ 画面の選び方が往復一致する", ({ row, choice, target }) => {
    expect(sleepTargetChoiceOf(row)).toEqual(choice);
    expect(sleepTargetOfChoice(choice)).toBe(target);
    expect(sleepTargetOfChoice(sleepTargetChoiceOf(row))).toBe(target);
  });

  it("全モードが往復で自分自身に戻る", () => {
    for (const mode of SLEEP_TARGET_MODES) {
      expect(sleepTargetOfChoice(sleepTargetChoiceOf({ sleepTargetMode: mode }))).toBe(mode);
    }
  });

  it("数値の目標は 200 / 500 / 1000 / 2000 の4つ", () => {
    expect([...SLEEP_TARGET_HOURS_OPTIONS]).toEqual([200, 500, 1000, 2000]);
  });
});
