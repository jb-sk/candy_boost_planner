import { describe, expect, it } from "vitest";
import type { ExpGainNature } from "../../types";
import {
  NAP_ISLAND_FULL_MINUTES,
  calcNapIslandTime,
  napIslandGainedExp,
  napIslandRawExp,
} from "../nap-island";

const dhm = (days: number, hours: number, minutes: number) => days * 1440 + hours * 60 + minutes;

describe("calcNapIslandTime: 検算表", () => {
  type Case = { req: number; nature: ExpGainNature; ticket: boolean; minutes: number; tickets?: number; memo: string };
  const cases: Case[] = [
    { req: 1, nature: "normal", ticket: false, minutes: dhm(0, 0, 10), memo: "raw=1 → 切り上げで1" },
    { req: 1, nature: "normal", ticket: true, minutes: dhm(0, 0, 3), tickets: 1, memo: "実測どおり" },
    { req: 1, nature: "up", ticket: true, minutes: dhm(0, 0, 3), tickets: 1, memo: "実測どおり" },
    { req: 75, nature: "normal", ticket: false, minutes: dhm(0, 23, 51), memo: "raw=149 → 75" },
    { req: 524, nature: "normal", ticket: false, minutes: dhm(6, 23, 32), memo: "" },
    { req: 525, nature: "normal", ticket: false, minutes: dhm(6, 23, 51), memo: "半減のまま7日未満で届く最後" },
    { req: 526, nature: "normal", ticket: false, minutes: dhm(7, 0, 0), memo: "ここから7日待ち" },
    { req: 600, nature: "normal", ticket: false, minutes: dhm(7, 0, 0), memo: "1,050 もらえる" },
    { req: 1050, nature: "normal", ticket: false, minutes: dhm(7, 0, 0), memo: "7日分ちょうど" },
    { req: 1051, nature: "normal", ticket: false, minutes: dhm(7, 0, 10), memo: "通常速度へ" },
    { req: 1500, nature: "normal", ticket: false, minutes: dhm(10, 0, 0), memo: "" },
    { req: 2070, nature: "normal", ticket: true, minutes: dhm(6, 21, 34), tickets: 1, memo: "" },
    { req: 2100, nature: "normal", ticket: true, minutes: dhm(6, 23, 58), tickets: 1, memo: "半減のまま届く最後" },
    { req: 2101, nature: "normal", ticket: true, minutes: dhm(7, 0, 0), tickets: 1, memo: "" },
    { req: 4200, nature: "normal", ticket: true, minutes: dhm(7, 0, 0), tickets: 1, memo: "" },
    { req: 4201, nature: "normal", ticket: true, minutes: dhm(7, 0, 3), tickets: 2, memo: "2枚目は3分" },
    { req: 18000, nature: "normal", ticket: true, minutes: dhm(30, 0, 0), tickets: 5, memo: "チケット5枚" },
    { req: 610, nature: "up", ticket: false, minutes: dhm(6, 21, 18), memo: "" },
    { req: 619, nature: "up", ticket: false, minutes: dhm(6, 23, 44), memo: "半減のまま届く最後" },
    { req: 620, nature: "up", ticket: false, minutes: dhm(7, 0, 0), memo: "" },
    { req: 1239, nature: "up", ticket: false, minutes: dhm(7, 0, 0), memo: "177×7 ちょうど（境界）" },
    { req: 1240, nature: "up", ticket: false, minutes: dhm(7, 0, 9), memo: "" },
    { req: 18000, nature: "up", ticket: true, minutes: dhm(25, 10, 11), tickets: 4, memo: "36,611分 ÷ 10,080 の切り上げ" },
  ];

  it.each(cases)("残EXP $req / $nature / チケット$ticket → $minutes 分 ($memo)", ({ req, nature, ticket, minutes, tickets }) => {
    const result = calcNapIslandTime({ expToTarget: req, nature, ticket });
    expect(result.minutes).toBe(minutes);
    expect(result.ticketCount).toBe(ticket ? tickets : 0);
    expect(result.napGainedExp).toBeGreaterThanOrEqual(req);
  });

  it("EXP↓ は補正なしと同じ結果になる（睡眠用の 0.82 を使わない）", () => {
    for (const ticket of [false, true]) {
      for (const req of [1, 75, 525, 526, 1050, 1051, 4201, 18000]) {
        expect(calcNapIslandTime({ expToTarget: req, nature: "down", ticket }))
          .toEqual(calcNapIslandTime({ expToTarget: req, nature: "normal", ticket }));
      }
    }
  });
});

describe("境界（同じ4点を性格・チケットごとに）", () => {
  it.each([
    { nature: "normal", ticket: false, points: [525, 526, 1050, 1051] },
    { nature: "up", ticket: false, points: [619, 620, 1239, 1240] },
    { nature: "normal", ticket: true, points: [2100, 2101, 4200, 4201] },
    { nature: "up", ticket: true, points: [2478, 2479, 4956, 4957] },
  ] as const)("$nature / チケット$ticket", ({ nature, ticket, points }) => {
    const [lastHalf, firstFull, fullExact, firstNormal] = points.map(
      (req) => calcNapIslandTime({ expToTarget: req, nature, ticket }).minutes,
    );
    expect(lastHalf).toBeLessThan(NAP_ISLAND_FULL_MINUTES);
    expect(firstFull).toBe(NAP_ISLAND_FULL_MINUTES);
    expect(fullExact).toBe(NAP_ISLAND_FULL_MINUTES);
    expect(firstNormal).toBeGreaterThan(NAP_ISLAND_FULL_MINUTES);
  });

  it("177×7 の境界: ▲▲ 1,239 EXP がちょうど 10080 分、1,240 EXP が 10089 分", () => {
    expect(calcNapIslandTime({ expToTarget: 1239, nature: "up", ticket: false }).minutes).toBe(10080);
    expect(calcNapIslandTime({ expToTarget: 1240, nature: "up", ticket: false }).minutes).toBe(10089);
  });
});

describe("実測の再現", () => {
  // 半減前の raw と、受け取る napIslandGainedExp（7日未満なので ceil(raw/2)）を取り違えない
  it.each([
    { minutes: 2, rawUp: 0, rawNormal: 0, gainedUp: 0, gainedNormal: 0 },
    { minutes: 3, rawUp: 1, rawNormal: 1, gainedUp: 1, gainedNormal: 1 },
    { minutes: 7, rawUp: 3, rawNormal: 2, gainedUp: 2, gainedNormal: 1 },
  ])("実測: チケットあり $minutes 分", ({ minutes, rawUp, rawNormal, gainedUp, gainedNormal }) => {
    expect(napIslandRawExp(minutes, "up", true)).toBe(rawUp);
    expect(napIslandRawExp(minutes, "normal", true)).toBe(rawNormal);
    expect(napIslandGainedExp(minutes, "up", true)).toBe(gainedUp);
    expect(napIslandGainedExp(minutes, "normal", true)).toBe(gainedNormal);
  });

  it("実測: チケットありで3分後に1EXP、即引き取りでも1EXP（端数は切り上げ）", () => {
    expect(napIslandGainedExp(3, "normal", true)).toBe(1);
  });
});

describe("半減は切り上げ", () => {
  it("7日未満は ceil(raw/2)、7日以上は raw", () => {
    // raw が奇数になる分
    const minutes = 10; // 補正なし・チケなし: floor(15000×10/144000) = 1
    expect(napIslandRawExp(minutes, "normal", false)).toBe(1);
    expect(napIslandGainedExp(minutes, "normal", false)).toBe(1);
    expect(napIslandRawExp(1431, "normal", false)).toBe(149);
    expect(napIslandGainedExp(1431, "normal", false)).toBe(75);
    expect(napIslandGainedExp(NAP_ISLAND_FULL_MINUTES, "normal", false)).toBe(napIslandRawExp(NAP_ISLAND_FULL_MINUTES, "normal", false));
    expect(napIslandGainedExp(NAP_ISLAND_FULL_MINUTES - 1, "normal", false)).toBe(
      Math.ceil(napIslandRawExp(NAP_ISLAND_FULL_MINUTES - 1, "normal", false) / 2),
    );
  });
});

describe("総当たりとの一致", () => {
  const natures: ExpGainNature[] = ["normal", "up", "down"];
  for (const nature of natures) {
    for (const ticket of [false, true]) {
      it(`req=1..3000 / ${nature} / チケット${ticket}: 最小の分と一致し、napGainedExp が gained(minutes) に一致する`, () => {
        let m = 0;
        for (let req = 1; req <= 3000; req++) {
          // 獲得EXPは分について単調（10080 で跳ね上がるだけ）なので、最小の M は req とともに増える
          while (napIslandGainedExp(m, nature, ticket) < req) m++;
          const result = calcNapIslandTime({ expToTarget: req, nature, ticket });
          expect(result.minutes).toBe(m);
          expect(result.napGainedExp).toBe(napIslandGainedExp(result.minutes, nature, ticket));
        }
      });
    }
  }
});

describe("チケット枚数と最後の1枚", () => {
  it("7日以下は1枚、少しはみ出すと2枚、チケなしは0枚", () => {
    expect(calcNapIslandTime({ expToTarget: 4200, nature: "normal", ticket: true }).ticketCount).toBe(1);
    expect(calcNapIslandTime({ expToTarget: 4201, nature: "normal", ticket: true }).ticketCount).toBe(2);
    expect(calcNapIslandTime({ expToTarget: 4201, nature: "normal", ticket: false }).ticketCount).toBe(0);
  });

  it("lastTicketMinutes: 10080分→10080、10083分→3、20160分→10080、チケなし→0", () => {
    const at7d = calcNapIslandTime({ expToTarget: 4200, nature: "normal", ticket: true });
    expect([at7d.minutes, at7d.lastTicketMinutes]).toEqual([10080, 10080]);
    const at7d3 = calcNapIslandTime({ expToTarget: 4201, nature: "normal", ticket: true });
    expect([at7d3.minutes, at7d3.lastTicketMinutes]).toEqual([10083, 3]);
    const at14d = calcNapIslandTime({ expToTarget: 8400, nature: "normal", ticket: true });
    expect([at14d.minutes, at14d.ticketCount, at14d.lastTicketMinutes]).toEqual([20160, 2, 10080]);
    expect(calcNapIslandTime({ expToTarget: 8400, nature: "normal", ticket: false }).lastTicketMinutes).toBe(0);
  });
});

describe("残EXPが無い", () => {
  it("expToTarget <= 0 は全部 0", () => {
    for (const expToTarget of [0, -5]) {
      expect(calcNapIslandTime({ expToTarget, nature: "up", ticket: true }))
        .toEqual({ minutes: 0, napGainedExp: 0, ticketCount: 0, lastTicketMinutes: 0 });
    }
  });
});
