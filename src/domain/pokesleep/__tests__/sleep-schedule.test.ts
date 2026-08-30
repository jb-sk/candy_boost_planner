import { describe, expect, it } from "vitest";
import { createSleepSchedule, resolveEventMultiplier, type EventMultiplierSegment } from "../sleep-schedule";
import { MAX_GROWTH_INCENSE_STOCK, MAX_SLEEP_PLANNING_DAYS, type GrowthIncenseNormalPerWeek } from "../../types";
import { calcSleepExp } from "../sleep-growth";

const fullMoonDates = ["2026-01-05", "2026-02-04", "2026-03-06"] as const;

describe("sleep-schedule", () => {
  it("イベント区間を両端含みで解決し、区間外と区間なしは1にする", () => {
    const segments: EventMultiplierSegment[] = [
      { from: "2026-01-02", to: "2026-01-04", multiplier: 1.5 },
    ];

    expect(resolveEventMultiplier("2026-01-01", segments)).toBe(1);
    expect(resolveEventMultiplier("2026-01-02", segments)).toBe(1.5);
    expect(resolveEventMultiplier("2026-01-03", segments)).toBe(1.5);
    expect(resolveEventMultiplier("2026-01-04", segments)).toBe(1.5);
    expect(resolveEventMultiplier("2026-01-05", segments)).toBe(1);
    expect(resolveEventMultiplier("2026-01-03", [])).toBe(1);
  });

  it("重なったイベント区間は最も大きい倍率を採用する", () => {
    expect(resolveEventMultiplier("2026-01-03", [
      { from: "2026-01-01", to: "2026-01-05", multiplier: 1.5 },
      { from: "2026-01-03", to: "2026-01-03", multiplier: 3 },
    ])).toBe(3);
  });

  it("GSDとイベントのうち大きい倍率だけを外側へ掛ける", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-04",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [
        { from: "2026-01-04", to: "2026-01-06", multiplier: 1.5 },
        { from: "2026-01-07", to: "2026-01-07", multiplier: 1.25 },
      ],
      fullMoonDates,
    });

    expect(schedule.days(4)).toMatchObject([
      { gsdMultiplier: 2, eventMultiplier: 1.5, eventBonus: 2 },
      { gsdMultiplier: 3, eventMultiplier: 1.5, eventBonus: 3 },
      { gsdMultiplier: 2, eventMultiplier: 1.5, eventBonus: 2 },
      { gsdMultiplier: 1, eventMultiplier: 1.25, eventBonus: 1.25 },
    ]);
  });

  it("GSDを含めない場合もイベント倍率は残す", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-05",
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [{ from: "2026-01-05", to: "2026-01-05", multiplier: 1.5 }],
      fullMoonDates,
    });

    expect(schedule.dayAt(0)).toMatchObject({
      dayKind: "normal",
      gsdMultiplier: 1,
      eventMultiplier: 1.5,
      eventBonus: 1.5,
    });
  });

  it("GSDとイベントが重なるゲーム内実測の素EXPを再現する", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-04",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [
        { from: "2026-01-04", to: "2026-01-06", multiplier: 1.5 },
        { from: "2026-01-07", to: "2026-01-07", multiplier: 1.25 },
      ],
      fullMoonDates,
    });

    expect(calcSleepExp({
      sleepMinutes: 510,
      sleepExpBonus: 1.70,
      incenseMultiplier: 2,
      eventBonus: schedule.dayAt(0).eventBonus,
      nature: "normal",
    })).toBe(680);
    expect(calcSleepExp({
      sleepMinutes: 510,
      sleepExpBonus: 1.42,
      incenseMultiplier: 2,
      eventBonus: schedule.dayAt(1).eventBonus,
      nature: "normal",
    })).toBe(852);
    expect(calcSleepExp({
      sleepMinutes: 469,
      sleepExpBonus: 1.14,
      incenseMultiplier: 2,
      eventBonus: schedule.dayAt(3).eventBonus,
      nature: "normal",
    })).toBe(262);
  });

  it.each([
    [[{ from: "2026-02-30", to: "2026-03-01", multiplier: 1.5 }], /segment date/],
    [[{ from: "2026-03-02", to: "2026-03-01", multiplier: 1.5 }], /segment range/],
    [[{ from: "2026-03-01", to: "2026-03-02", multiplier: 0 }], /event multiplier/],
  ] as const)("壊れたイベント区間を拒否する", (eventSegments, expected) => {
    expect(() => createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments,
    })).toThrow(expected);
  });

  it("前日・満月日・翌日を実日付で分類する", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-04",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      fullMoonDates,
    });
    expect(schedule.days(3)).toMatchObject([
      { date: "2026-01-04", dayKind: "flank", eventBonus: 2 },
      { date: "2026-01-05", dayKind: "fullMoon", eventBonus: 3 },
      { date: "2026-01-06", dayKind: "flank", eventBonus: 2 },
    ]);
    expect(schedule.intersectingFullMoonDates(3)).toEqual(["2026-01-05"]);
  });

  it.each([
    [{ beforeFullMoon: false, fullMoon: false, afterFullMoon: false }, [false, false, false]],
    [{ beforeFullMoon: false, fullMoon: true, afterFullMoon: false }, [false, true, false]],
    [{ beforeFullMoon: true, fullMoon: true, afterFullMoon: false }, [true, true, false]],
    [{ beforeFullMoon: false, fullMoon: true, afterFullMoon: true }, [false, true, true]],
    [{ beforeFullMoon: true, fullMoon: true, afterFullMoon: true }, [true, true, true]],
  ] as const)("GSDのお香3日指定を独立して解決する", (days, expected) => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-04",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: days,
      growthIncenseNormalPerWeek: 0,
      fullMoonDates,
    });
    expect(schedule.days(3).map(day => day.useIncense)).toEqual(expected);
  });

  it("計算区間が3日目から始まっても、3日目の指定をそのまま使う", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-06",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: true },
      growthIncenseNormalPerWeek: 0,
      fullMoonDates,
    });
    expect(schedule.dayAt(0)).toMatchObject({ dayKind: "flank", useIncense: true });
  });

  /**
   * 割当は**週ごとに月曜から**決める。計画が週の途中から始まっても割当は動かない
   * （途中から詰め直すと、開始曜日だけで総数が変わってしまう）。
   */
  it("週の途中から始めても月曜から数えるので、その週は残り枠だけになる", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-07", // Wednesday
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 3,
      fullMoonDates,
    });
    // 1/5(月)・1/6(火)・1/7(水) が3個ぶん。見えるのは水曜だけで、木〜日は無し。
    // 次の週は月曜(1/12)から2日ぶんが見える。
    expect(schedule.days(7).map(day => day.useIncense)).toEqual([
      true, false, false, false, false, true, true,
    ]);
  });

  it("日曜始まりの計画では、その週にお香を置かない（月曜から数えるため）", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-11", // Sunday
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 1,
      fullMoonDates,
    });
    // 週1個は 1/5(月) で使い切っている。翌週の月曜(1/12)が次の1個。
    expect(schedule.days(3).map(day => day.useIncense)).toEqual([false, true, false]);
  });

  /**
   * 「GSDの成長のお香」でチェックした日は**個数設定に関係なく必ず使う**。
   * 残り枠は 満月 → 前後日 → 平常日（月曜から）の順に配る。
   */
  it("GSDのチェックは個数設定に関係なく使い、残り枠だけ他の日へ配る", () => {
    // 1/5(月)〜1/11(日)の週はGSDで2日使う。週2個ならその週の平常日には配らない。
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-04",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 2,
      fullMoonDates,
    });
    expect(schedule.days(5).map(day => ({ kind: day.dayKind, incense: day.useIncense })))
      .toEqual([
        { kind: "flank", incense: true },
        { kind: "fullMoon", incense: true },
        { kind: "flank", incense: true },
        { kind: "normal", incense: false },
        { kind: "normal", incense: false },
      ]);
  });

  /** GSD週（1/5月〜1/11日 に 前後日=1/4,1/6 満月=1/5 が入る週）での配り方を1つずつ固定する。 */
  describe("GSD週の配り方", () => {
    function gsdWeek(perWeek: GrowthIncenseNormalPerWeek, gsdDays: { beforeFullMoon: boolean; fullMoon: boolean; afterFullMoon: boolean }) {
      const schedule = createSleepSchedule({
        startGameDate: "2026-01-05", // Monday。この週は 1/5満月・1/6前後日
        timeZone: "UTC",
        includeGSD: true,
        growthIncenseGsdDays: gsdDays,
        growthIncenseNormalPerWeek: perWeek,
        fullMoonDates,
      });
      return schedule.days(7).map(day => ({ kind: day.dayKind, incense: day.useIncense }));
    }
    const allGsd = { beforeFullMoon: true, fullMoon: true, afterFullMoon: true };
    const noGsd = { beforeFullMoon: false, fullMoon: false, afterFullMoon: false };

    it("週0個でもGSD3日チェックなら3個使う（チェックは個数に縛られない）", () => {
      // 1/4(日)は前の週なので、この週に入るGSDは 1/5満月・1/6前後日 の2日。
      const week = gsdWeek(0, allGsd);
      expect(week.filter(day => day.incense)).toEqual([
        { kind: "fullMoon", incense: true },
        { kind: "flank", incense: true },
      ]);
    });

    it("週1個・GSDチェック無しなら満月日に1個だけ置く", () => {
      const week = gsdWeek(1, noGsd);
      expect(week.filter(day => day.incense)).toEqual([{ kind: "fullMoon", incense: true }]);
    });

    it("週4個・GSDチェック無しならGSD日を先に埋め、残りを平常日へ配る", () => {
      // この週のGSDは2日（満月・前後日）。残り2個が平常日（月曜から）へ。
      const week = gsdWeek(4, noGsd);
      expect(week.map(day => day.incense)).toEqual([true, true, true, true, false, false, false]);
      expect(week.filter(day => day.incense).map(day => day.kind))
        .toEqual(["fullMoon", "flank", "normal", "normal"]);
    });

    it("週7個なら全曜日に置く", () => {
      expect(gsdWeek(7, noGsd).every(day => day.incense)).toBe(true);
    });
  });

  it("イベント倍率のある日を平常日より優先して使う", () => {
    // GSD無し・週1個。1/8(木)〜1/9(金)だけイベント×1.5。
    // 月曜から詰めるのではなく、倍率の高いイベント初日へ置く。
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-05", // Monday
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 1,
      eventSegments: [{ from: "2026-01-08", to: "2026-01-09", multiplier: 1.5 }],
      fullMoonDates,
    });
    expect(schedule.days(7).map(day => day.useIncense))
      .toEqual([false, false, false, true, false, false, false]);
  });

  it("GSDとイベントが同じ週にあるとGSD（×3）を先に使う", () => {
    // 1/5(月)が満月。イベント×1.5より満月の方が効きが大きい。
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-05",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 2,
      eventSegments: [{ from: "2026-01-08", to: "2026-01-09", multiplier: 1.5 }],
      fullMoonDates,
    });
    // 満月(1/5) → 前後日(1/6, ×2) の順。イベント×1.5はその次。
    expect(schedule.days(7).map(day => day.useIncense))
      .toEqual([true, true, false, false, false, false, false]);
  });

  it("週の枠がGSDの使用数より多ければ、余りを平常日へ配る", () => {
    // 同じ週でGSDは2日。週3個なら平常日に1個だけ回る。
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-04",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 3,
      fullMoonDates,
    });
    expect(schedule.days(6).map(day => ({ kind: day.dayKind, incense: day.useIncense })))
      .toEqual([
        { kind: "flank", incense: true },
        { kind: "fullMoon", incense: true },
        { kind: "flank", incense: true },
        { kind: "normal", incense: true },
        { kind: "normal", incense: false },
        { kind: "normal", incense: false },
      ]);
  });

  /**
   * 手持ちの個数（在庫）は「使う日」を決め直すのではなく、**先の夜から順に消費して
   * 尽きたら打ち切る**だけ。お香は行の持ち物ではなく夜の属性なので、行へ配らない。
   */
  describe("手持ちの個数（在庫）", () => {
    function stockSchedule(growthIncenseStock: number | null | undefined) {
      return createSleepSchedule({
        startGameDate: "2026-01-05", // Monday
        timeZone: "UTC",
        includeGSD: false,
        growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
        growthIncenseNormalPerWeek: 7,
        growthIncenseStock,
        fullMoonDates,
      });
    }

    it("未指定なら無制限で、設定どおりに全日使う", () => {
      expect(stockSchedule(undefined).days(7).map(day => day.useIncense))
        .toEqual([true, true, true, true, true, true, true]);
      expect(stockSchedule(null).growthIncenseStock).toBeNull();
    });

    it("在庫が尽きた日以降は使わない", () => {
      const days = stockSchedule(3).days(7);
      expect(days.map(day => day.useIncense)).toEqual([true, true, true, false, false, false, false]);
      // 設定では使う日だったが在庫が無い、を区別できるようにしておく。
      expect(days.map(day => day.incenseOutOfStock))
        .toEqual([false, false, false, true, true, true, true]);
    });

    it("0個なら1個も使わない", () => {
      expect(stockSchedule(0).days(3).map(day => day.useIncense)).toEqual([false, false, false]);
    });

    it("GSDでチェックした日も在庫が無ければ使えない", () => {
      const schedule = createSleepSchedule({
        startGameDate: "2026-01-04",
        timeZone: "UTC",
        includeGSD: true,
        growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
        growthIncenseNormalPerWeek: 0,
        growthIncenseStock: 1,
        fullMoonDates,
      });
      expect(schedule.days(3).map(day => ({ kind: day.dayKind, incense: day.useIncense })))
        .toEqual([
          { kind: "flank", incense: true },
          { kind: "fullMoon", incense: false },
          { kind: "flank", incense: false },
        ]);
    });

    it("不正な在庫は受け付けない（保存・設定画面と同じ範囲）", () => {
      expect(() => stockSchedule(-1)).toThrow(/growth incense stock/);
      expect(() => stockSchedule(1.5)).toThrow(/growth incense stock/);
      expect(() => stockSchedule(MAX_GROWTH_INCENSE_STOCK + 1)).toThrow(/growth incense stock/);
      expect(stockSchedule(MAX_GROWTH_INCENSE_STOCK).growthIncenseStock).toBe(MAX_GROWTH_INCENSE_STOCK);
    });
  });

  it("公開schedule APIも計画上限を超える同期生成を拒否する", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
    });
    expect(() => schedule.dayAt(MAX_SLEEP_PLANNING_DAYS)).toThrow(/schedule day index/);
    expect(() => schedule.days(MAX_SLEEP_PLANNING_DAYS + 1)).toThrow(/schedule day count/);
    expect(() => schedule.intersectingFullMoonDates(MAX_SLEEP_PLANNING_DAYS + 1))
      .toThrow(/schedule day count/);
  });
});
