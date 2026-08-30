import { describe, expect, it } from "vitest";

import { en } from "../../../src/i18n/en";
import { ja } from "../../../src/i18n/ja";
import type { SleepBonusContribution, SleepNightContribution } from "../../../src/domain/pokesleep/sleep-growth";
import { buildBlueSeedShiftNotes, buildBonusPanelView, buildEventChipList } from "../../../src/utils/bonusPanelView";

const translate = (key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params ?? {})}`;

const anniversary = {
  name: "周年記念フェスティバル",
  from: "2026-07-13" as const,
  to: "2026-07-19" as const,
  multiplier: 1.5,
  month: 7,
  weekOfMonth: 2,
};

const base = {
  realEvents: [],
  projectedEvents: [],
  flowers: [{ match: "周年記念フェスティバル", days: 7 }],
  flowerSegments: [],
  t: translate,
  locale: "ja" as const,
};

const panelBase = {
  contributions: [] as SleepBonusContribution[],
  nights: [] as SleepNightContribution[],
  realEvents: [],
  projectedEvents: [],
  flowers: [],
  flowerSegments: [],
  shifts: [],
  t: translate,
  locale: "ja" as const,
  fmtNum: (value: number) => value.toLocaleString("en-US"),
};

function contribution(overrides: Partial<SleepBonusContribution> = {}): SleepBonusContribution {
  return {
    kind: "gsd",
    multiplier: 2,
    withIncense: false,
    days: 1,
    score: 100,
    exp: 100,
    ...overrides,
  };
}

function night(overrides: Partial<SleepNightContribution> = {}): SleepNightContribution {
  return {
    date: "2026-09-29",
    kind: "event",
    multiplier: 1.25,
    withIncense: false,
    minutes: 510,
    score: 100,
    exp: 125,
    baseExp: 100,
    ...overrides,
  };
}

describe("bonus panel view", () => {
  it("builds the table from whichever axis is given", () => {
    expect(buildBonusPanelView({
      ...panelBase,
      contributions: [contribution()],
    })?.table?.rows).toHaveLength(1);

    expect(buildBonusPanelView({
      ...panelBase,
      nights: [night()],
    })?.table?.nights).toHaveLength(1);

    expect(buildBonusPanelView({
      ...panelBase,
      neededFrom: "2026-07-13",
      neededTo: "2026-07-19",
      realEvents: [anniversary],
    })).not.toHaveProperty("table");
  });

  it("prefers the by-night axis when both are given", () => {
    // 呼び出し側は片方だけ渡す約束だが、両方来ても日付の軸を優先する（3晩以内が主）。
    const view = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution()],
      nights: [night()],
    });

    expect(view?.table?.rows).toEqual([]);
    expect(view?.table?.nights).toHaveLength(1);
  });

  it("formats populated days, multiplier, and bonus EXP cells", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution({ kind: "gsd", multiplier: 2, days: 1, exp: 100 })],
    });

    expect(view?.table?.rows[0]).toMatchObject({
      amount: "1calc.sleep.dayUnit:{}",
      multiplier: "×2",
      exp: "+100EXP",
    });
    // 日数は行どうしで足せないので、合計行に第3列の値は持たせない。
    expect(view?.table).not.toHaveProperty("totalAmount");
  });

  it("splits base EXP from the bonus on top", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      nights: [night({ baseExp: 114, exp: 142 }), night({ date: "2026-09-30", kind: null, multiplier: null, baseExp: 93, exp: 93 })],
    });

    expect(view?.table?.nights.map(row => row.exp)).toEqual([
      "114calc.sleep.nightExpJoiner:{}28EXP",
      "93EXP",
    ]);
    expect(view?.table?.nights.map(row => row.expAriaLabel)).toEqual([
      'calc.sleep.nightExpSplitAria:{"base":"114","extra":"28","total":"142"}',
      'calc.sleep.nightExpAria:{"exp":"93"}',
    ]);
  });

  it("builds the by-night rows by date with each night's sleep time and EXP", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      nights: [
        night(),
        night({ date: "2026-09-30", kind: "gsd", multiplier: 3, withIncense: true, minutes: 187, score: 37, exp: 273, baseExp: 91 }),
      ],
    });

    expect(view?.table?.nights).toEqual([
      {
        date: "9/29",
        subLabel: "calc.row.bonusEvent:{}",
        withIncense: false,
        multiplier: "×1.25",
        time: "8calc.sleep.hourShort:{}30calc.sleep.minuteShort:{}",
        timeAriaLabel:
          'calc.sleep.nightTimeAria:{"time":"8calc.sleep.hourUnit:{}calc.sleep.hourMinuteSeparator:{}30calc.sleep.minuteUnit:{}"}',
        exp: "100calc.sleep.nightExpJoiner:{}25EXP",
        expAriaLabel: 'calc.sleep.nightExpSplitAria:{"base":"100","extra":"25","total":"125"}',
      },
      {
        date: "9/30",
        subLabel: "calc.row.bonusGsd:{}",
        withIncense: true,
        multiplier: "×3",
        time: "3calc.sleep.hourShort:{}7calc.sleep.minuteShort:{}",
        timeAriaLabel:
          'calc.sleep.nightTimeAria:{"time":"3calc.sleep.hourUnit:{}calc.sleep.hourMinuteSeparator:{}7calc.sleep.minuteUnit:{}"}',
        exp: "91calc.sleep.nightExpJoiner:{}182EXP",
        expAriaLabel: 'calc.sleep.nightExpSplitAria:{"base":"91","extra":"182","total":"273"}',
      },
    ]);
    // 合計は全晩の総額。
    expect(view?.table?.total).toBe("398EXP");
  });

  it("drops the zero minutes of a full night and keeps a sub-hour night in minutes", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      nights: [night({ minutes: 480 }), night({ date: "2026-09-30", minutes: 42 })],
    });

    expect(view?.table?.nights.map(row => row.time)).toEqual([
      "8calc.sleep.hourShort:{}",
      "42calc.sleep.minuteShort:{}",
    ]);
  });

  it("represents incense-only nights with the incense tag and no multiplier chip", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      nights: [night({ kind: "incense", multiplier: null, withIncense: true })],
    });

    expect(view?.table?.nights[0]).toMatchObject({ withIncense: true, multiplier: "" });
    expect(view?.table?.nights[0]).not.toHaveProperty("subLabel");
  });

  it("adds the incense tag to combined rows but not to the incense row itself", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      contributions: [
        contribution({ kind: "event", withIncense: true }),
        contribution({ kind: "incense", multiplier: null, withIncense: true }),
      ],
    });

    expect(view?.table?.rows.map(row => row.withIncense)).toEqual([true, false]);
  });

  it("uses an empty multiplier cell when the multiplier is null", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution({ kind: "incense", multiplier: null, withIncense: true })],
    });

    expect(view?.table?.rows[0]?.multiplier).toBe("");
  });

  it("marks base EXP and omits its plus sign", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution({ kind: "base", multiplier: 1, exp: 1_234 })],
    });

    expect(view?.table?.rows[0]).toMatchObject({ exp: "1,234EXP", isBase: true });
  });

  it("sums contribution EXP for the total", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution({ exp: 1_200 }), contribution({ kind: "event", exp: 345 })],
    });

    expect(view?.table?.total).toBe("1,545EXP");
  });

  it("resolves every bonus kind to its display translation", () => {
    const kinds = ["base", "gsd", "event", "projectedEvent", "incense"] as const;
    const view = buildBonusPanelView({
      ...panelBase,
      contributions: kinds.map(kind => contribution({ kind })),
    });

    expect(view?.table?.rows.map(row => row.name)).toEqual([
      "calc.row.bonusBase:{}",
      "calc.row.bonusGsd:{}",
      "calc.row.bonusEvent:{}",
      "calc.row.bonusProjectedEvent:{}",
      "calc.row.bonusIncense:{}",
    ]);
  });

  it("adds events only when the filtered chip list is non-empty", () => {
    const within = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution()],
      realEvents: [anniversary],
      neededFrom: "2026-07-13",
      neededTo: "2026-07-19",
    });
    const outside = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution()],
      realEvents: [anniversary],
      neededFrom: "2026-08-01",
      neededTo: "2026-08-31",
    });

    expect(within?.events?.chips).toHaveLength(1);
    expect(outside).toBeDefined();
    expect(outside).not.toHaveProperty("events");
  });

  it("adds notes only when the filtered note list is non-empty", () => {
    const shift = { year: 2027, from: "2027-07-21" as const, to: "2027-07-26" as const };
    const within = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution()],
      shifts: [shift],
      neededFrom: "2027-07-01",
      neededTo: "2027-07-31",
    });
    const outside = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution()],
      shifts: [shift],
      neededFrom: "2027-08-01",
      neededTo: "2027-08-31",
    });

    expect(within?.notes).toHaveLength(1);
    expect(outside).toBeDefined();
    expect(outside).not.toHaveProperty("notes");
  });

  it("does not build events or notes without both needed dates", () => {
    const view = buildBonusPanelView({
      ...panelBase,
      contributions: [contribution()],
      realEvents: [anniversary],
      shifts: [{ year: 2027, from: "2027-07-21", to: "2027-07-26" }],
      neededFrom: "2027-07-01",
    });

    expect(view).not.toHaveProperty("events");
    expect(view).not.toHaveProperty("notes");
  });

  it("returns no panel when table, events, and notes are all absent", () => {
    expect(buildBonusPanelView(panelBase)).toBeUndefined();
  });
});

describe("event chip list", () => {
  it("uses the specified month/week labels and flower wording", () => {
    expect(ja.calc.sleep.monthWeek.replace("{month}", "7").replace("{week}", "2")).toBe("7月第2週");
    expect(en.calc.sleep.monthWeek.replace("{month}", "7").replace("{week}", "2")).toBe("7/W2");
    expect(ja.calc.sleep.blueSeedHint).toBe(
      "・周年フェス2週目のおいわいフラワーであおいタネを使う曜日です\n"
      + "・植えた日から睡眠EXP×3になります",
    );
    expect(en.calc.sleep.blueSeedHint).toContain("Sleep EXP is ×3 from the day you plant it");
    // 併用の説明は blueSeedIncenseHint だけが持つ。あおいタネ側へ書き戻すと重複する。
    expect(ja.calc.sleep.blueSeedHint).not.toContain("自動");
    expect(en.calc.sleep.blueSeedHint).not.toContain("Auto");
    // 日数指定では、期間内の残りの日を週設定やGSDへ戻さないことまで説明する。
    expect(ja.calc.sleep.blueSeedIncenseHint).toBe(
      "・あおいタネとお香を併用する日数です\n"
      + "・「自動」は週の個数とGSDの設定に準じます\n"
      + "・指定日数を過ぎたら使用しません",
    );
    expect(en.calc.sleep.blueSeedIncenseHint).toContain("Auto follows the weekly count and GSD settings");
    expect(en.calc.sleep.blueSeedIncenseHint).toContain("not used after the specified number of days");
    expect(ja.help.sleepFormula.incenseNote1).toBe(
      "① 週の個数を基準に、倍率が高いGSDやあおいタネの設定を優先します",
    );
    // ヘルプは**項目を並べ直さない**（個々の説明は設定画面の「?」が持つ）。
    expect(ja.help.basic.sleepDesc).toBe(
      "ポケモンの睡眠EXPにかかわる設定です。",
    );
    expect(ja.help.basic.resultDesc).toContain(
      "計算結果の「内訳」を展開すると睡眠EXPの詳細が表示されます。",
    );
    expect(en.help.basic.sleepDesc).not.toContain("Expand \"Breakdown\" in the results");
    expect(en.help.basic.resultDesc).toContain("Expand \"Breakdown\" in the results");
    // 展開リンクの名前と、それを引用する**すべての**ヘルプ文を一致させる。
    // 片方だけ改名すると、ヘルプが存在しない名前を案内する。
    for (const desc of [ja.help.basic.resultDesc, ja.help.sleepFormula.desc]) {
      expect(desc).toContain(`「${ja.calc.row.sleepBonusesLabel}」`);
    }
    for (const desc of [en.help.basic.resultDesc, en.help.sleepFormula.desc]) {
      expect(desc).toContain(`"${en.calc.row.sleepBonusesLabel}"`);
    }
  });

  it("prefixes the year only when the plan spans two calendar years", () => {
    expect(buildEventChipList({ ...base, realEvents: [anniversary], neededFrom: "2026-07-01", neededTo: "2026-07-31" })).toEqual({
      chips: [{
        label: 'calc.sleep.monthWeek:{"month":7,"week":2}',
        name: "周年記念フェスティバル",
        multiplier: 1.5,
        projected: false,
      }],
      hasProjected: false,
    });
    expect(buildEventChipList({ ...base, realEvents: [anniversary], neededFrom: "2026-07-01", neededTo: "2027-01-31" }).chips[0]?.label)
      .toBe('calc.sleep.monthWeekWithYear:{"month":7,"week":2,"year":2026}');
  });

  it("lists real events before projected ones and names unnamed manual bonuses", () => {
    const list = buildEventChipList({
      ...base,
      realEvents: [
        { name: "", from: "2026-07-20", to: "2026-07-21", multiplier: 2, month: 7, weekOfMonth: 3 },
        { name: "アニポケコラボウィーク", from: "2026-08-17", to: "2026-08-23", multiplier: 1.25, month: 8, weekOfMonth: 3 },
      ],
      // 実より前の日付を混ぜても、仮イベントは常に実の後ろ。
      projectedEvents: [
        { name: "ポケモンデー記念キャンペーン", sourceFrom: "2026-03-02", from: "2026-07-06", to: "2026-07-12", multiplier: 1.5, month: 7, weekOfMonth: 1 },
      ],
      neededFrom: "2026-07-01",
      neededTo: "2026-08-31",
    });

    expect(list.chips.map(chip => [chip.name, chip.projected])).toEqual([
      ["calc.row.manualEventName:{}", false],
      ["アニポケコラボウィーク", false],
      ["ポケモンデー記念キャンペーン", true],
    ]);
    expect(list.hasProjected).toBe(true);
  });

  it("localizes generated event names only for the English locale", () => {
    const list = buildEventChipList({
      ...base,
      locale: "en",
      realEvents: [{
        name: "3周年記念フェスティバル",
        from: "2026-07-13",
        to: "2026-07-19",
        multiplier: 1.5,
        month: 7,
        weekOfMonth: 2,
      }],
      neededFrom: "2026-07-13",
      neededTo: "2026-07-19",
    });

    expect(list.chips[0]?.name).toBe("Third Anniversary Fest");
  });

  it("uses a projected event's source start date for its period-specific English name", () => {
    const list = buildEventChipList({
      ...base,
      locale: "en",
      projectedEvents: [{
        name: "ポケモンすくすくウィーク",
        sourceFrom: "2024-07-01",
        from: "2027-07-05",
        to: "2027-07-11",
        multiplier: 1.5,
        month: 7,
        weekOfMonth: 1,
      }],
      neededFrom: "2027-07-05",
      neededTo: "2027-07-11",
    });

    expect(list.chips[0]?.name).toBe("Pokémon Growth Week");
  });

  it("localizes a projected Sleep EXP segment alias through its source start date", () => {
    const list = buildEventChipList({
      ...base,
      locale: "en",
      projectedEvents: [{
        name: "ポケモンデー記念キャンペーン",
        sourceFrom: "2026-03-02",
        from: "2027-03-01",
        to: "2027-03-07",
        multiplier: 1.5,
        month: 3,
        weekOfMonth: 1,
      }],
      neededFrom: "2027-03-01",
      neededTo: "2027-03-07",
    });

    expect(list.chips[0]?.name).toBe("Pokémon Day Celebration Event Vol. 1");
  });

  it("keeps events that touch either end of the needed interval and drops the rest", () => {
    const list = buildEventChipList({
      ...base,
      realEvents: [
        { name: "before", from: "2027-07-01", to: "2027-07-11", multiplier: 1.5, month: 7, weekOfMonth: 1 },
        { name: "touch-start", from: "2027-07-12", to: "2027-07-18", multiplier: 1.5, month: 7, weekOfMonth: 2 },
        { name: "touch-end", from: "2027-07-18", to: "2027-07-24", multiplier: 1.5, month: 7, weekOfMonth: 3 },
        { name: "after", from: "2027-07-19", to: "2027-07-25", multiplier: 1.5, month: 7, weekOfMonth: 3 },
      ],
      neededFrom: "2027-07-12",
      neededTo: "2027-07-18",
    });

    expect(list.chips.map(chip => chip.name)).toEqual(["touch-start", "touch-end"]);
  });

  it("keeps the anniversary chip when only its flower week falls inside the plan", () => {
    // 花は1週目の終了後に生える。親の期間だけで絞ると、2週目だけの計画で
    // 「内訳に ×3 が出ているのに一覧が空」になる。
    const list = buildEventChipList({
      ...base,
      realEvents: [anniversary],
      flowerSegments: [{ from: "2026-07-20", to: "2026-07-26", multiplier: 3, source: "flower" }],
      neededFrom: "2026-07-20",
      neededTo: "2026-07-26",
    });

    expect(list.chips).toEqual([{
      label: 'calc.sleep.monthWeek:{"month":7,"week":2}',
      name: "周年記念フェスティバル",
      multiplier: 1.5,
      projected: false,
      flower: { label: 'calc.sleep.projectedFlowerLabel:{"week":2}', multiplier: 3 },
    }]);
  });

  it("matches the flower source to the anniversary it belongs to", () => {
    // 同じ週に実と仮の周年が並んでも（手入力が仮イベント期間へ重なった場合など）、
    // 日付の窓だけで結ぶと実の件へ仮の花が付く。
    const list = buildEventChipList({
      ...base,
      realEvents: [anniversary],
      projectedEvents: [{ ...anniversary, sourceFrom: anniversary.from }],
      flowerSegments: [{ from: "2026-07-20", to: "2026-07-26", multiplier: 3, source: "projectedFlower" }],
      neededFrom: "2026-07-13",
      neededTo: "2026-07-26",
    });

    expect(list.chips.map(chip => [chip.projected, chip.flower !== undefined])).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  it("adds the flower label only when the flower overlaps the needed interval", () => {
    const flowerSegments = [{ from: "2026-07-20" as const, to: "2026-07-26" as const, multiplier: 3, source: "flower" as const }];
    const flower = { label: 'calc.sleep.projectedFlowerLabel:{"week":2}', multiplier: 3 };

    // 花は仮イベントにも実イベントにも付く（実の周年の2週目は仮オフでも計算に入る）。
    // 内訳の行は花を「イベント／仮イベント」へ畳むので、×3 の出どころを示すのはこの併記だけ。
    expect(buildEventChipList({
      ...base,
      projectedEvents: [{ ...anniversary, sourceFrom: anniversary.from }],
      flowerSegments: [{ ...flowerSegments[0]!, source: "projectedFlower" as const }],
      neededFrom: "2026-07-13",
      neededTo: "2026-07-26",
    }).chips[0]?.flower).toEqual(flower);
    expect(buildEventChipList({
      ...base,
      realEvents: [anniversary],
      flowerSegments,
      neededFrom: "2026-07-13",
      neededTo: "2026-07-26",
    }).chips[0]?.flower).toEqual(flower);

    // 2週目に届かない計画では、内訳に花の行が出ないので一覧にも出さない。
    expect(buildEventChipList({
      ...base,
      realEvents: [anniversary],
      flowerSegments,
      neededFrom: "2026-07-13",
      neededTo: "2026-07-19",
    }).chips[0]?.flower).toBeUndefined();
  });
});

describe("blue seed shift notes", () => {
  it("uses the shifted planting weekday and hides notes outside the needed interval", () => {
    const shift = { year: 2027, from: "2027-07-21" as const, to: "2027-07-26" as const };
    expect(buildBlueSeedShiftNotes({
      shifts: [shift],
      neededFrom: "2027-07-01",
      neededTo: "2027-07-31",
      t: translate,
    })).toEqual(['calc.sleep.blueSeedShiftedNote:{"year":2027,"weekday":"calc.sleep.weekdayWed:{}"}']);
    expect(buildBlueSeedShiftNotes({
      shifts: [shift],
      neededFrom: "2027-08-01",
      neededTo: "2027-08-31",
      t: translate,
    })).toEqual([]);
  });
});
