import { describe, expect, it } from "vitest";

import { resolveBlueSeedSegments } from "../../../src/domain/pokesleep/growth-flower";
import { projectPastYearEvents } from "../../../src/domain/pokesleep/projected-events";

type ProjectParams = Parameters<typeof projectPastYearEvents>[0];

function project(params: ProjectParams) {
  return projectPastYearEvents(params);
}

describe("projectPastYearEvents", () => {
  it("keeps anchored weeks and their measured offsets across calendar years", () => {
    const anniversary = project({
      currentGameDate: "2023-12-31",
      knownThrough: "2023-12-31",
      until: "2027-12-31",
      anchors: [{ match: "周年記念フェスティバル", month: 7, day: 17 }],
      segments: [{ name: "1周年記念フェスティバル", from: "2023-07-17", to: "2023-07-23", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(anniversary.map(event => event.from)).toEqual([
      "2024-07-15", "2025-07-14", "2026-07-13", "2027-07-12",
    ]);

    const pokemonDay = project({
      currentGameDate: "2026-04-01",
      knownThrough: "2026-04-01",
      until: "2029-12-31",
      anchors: [{ match: "ポケモンデー", month: 2, day: 27 }],
      segments: [{ name: "ポケモンデー記念キャンペーン", from: "2026-03-02", to: "2026-03-08", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(pokemonDay.map(event => event.from)).toEqual(["2027-03-01", "2028-02-28", "2029-03-05"]);
  });

  it("takes the Monday week containing an anchored Sunday or Monday", () => {
    const sunday = project({
      currentGameDate: "2025-12-31",
      knownThrough: "2025-12-31",
      until: "2026-12-31",
      anchors: [{ match: "日曜アンカー", month: 7, day: 20 }],
      segments: [{ name: "日曜アンカー", from: "2025-07-14", to: "2025-07-20", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    const monday = project({
      currentGameDate: "2025-12-31",
      knownThrough: "2025-12-31",
      until: "2026-12-31",
      anchors: [{ match: "月曜アンカー", month: 7, day: 14 }],
      segments: [{ name: "月曜アンカー", from: "2025-07-14", to: "2025-07-20", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(sunday[0]?.from).toBe("2026-07-20");
    expect(monday[0]?.from).toBe("2026-07-13");
  });

  it("falls back to the nth weekday and keeps interval duration", () => {
    const projected = project({
      currentGameDate: "2024-12-31",
      knownThrough: "2024-12-31",
      until: "2025-12-31",
      segments: [{ name: "5th weekday", from: "2024-01-29", to: "2024-02-04", multiplier: 1.25 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(projected).toEqual([expect.objectContaining({
      from: "2025-01-27", to: "2025-02-02", weekOfMonth: 4,
    })]);

    const leapDay = project({
      currentGameDate: "2027-12-31",
      knownThrough: "2027-12-31",
      until: "2028-12-31",
      segments: [{ name: "閏日イベント", from: "2027-02-25", to: "2027-03-02", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(leapDay).toEqual([expect.objectContaining({ from: "2028-02-24", to: "2028-02-29" })]);
  });

  it("falls back when an anchor offset is invalid, but accepts the -2 week boundary", () => {
    const invalid = project({
      currentGameDate: "2025-12-31",
      knownThrough: "2025-12-31",
      until: "2026-12-31",
      anchors: [{ match: "周年記念フェスティバル", month: 7, day: 17 }],
      segments: [{ name: "周年記念フェスティバル", from: "2025-06-01", to: "2025-06-07", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(invalid).toEqual([expect.objectContaining({ from: "2026-06-07", to: "2026-06-13" })]);

    const boundary = project({
      currentGameDate: "2025-12-31",
      knownThrough: "2025-12-31",
      until: "2026-12-31",
      anchors: [{ match: "周年記念フェスティバル", month: 7, day: 17 }],
      segments: [{ name: "周年記念フェスティバル", from: "2025-06-30", to: "2025-07-06", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(boundary).toEqual([expect.objectContaining({ from: "2026-06-29", to: "2026-07-05" })]);
  });

  it("アンカー付きも窓内で最新の開催回だけを使い、その週オフセットを保つ", () => {
    const projected = project({
      currentGameDate: "2025-12-31",
      knownThrough: "2025-12-31",
      until: "2026-12-31",
      anchors: [{ match: "周年記念フェスティバル", month: 7, day: 17 }],
      segments: [
        { name: "旧周年記念フェスティバル", from: "2025-07-07", to: "2025-07-13", multiplier: 1.25 },
        { name: "新周年記念フェスティバル", from: "2025-07-21", to: "2025-07-27", multiplier: 1.5 },
      ],
      realEvents: [],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([expect.objectContaining({
      name: "新周年記念フェスティバル",
      sourceFrom: "2025-07-21",
      from: "2026-07-20",
      to: "2026-07-26",
      multiplier: 1.5,
    })]);
  });

  it("先の日程が確定していても、その手前の未告知期間に仮イベントを残す", () => {
    const projected = project({
      currentGameDate: "2026-08-12",
      knownThrough: "2026-09-27",
      until: "2026-12-31",
      segments: [{ name: "未告知の候補", from: "2025-08-18", to: "2025-08-24", multiplier: 1.5 }],
      realEvents: [{ name: "先に告知されたイベント", from: "2026-09-21", to: "2026-09-27" }],
      realSleepExpSegments: [],
    });
    expect(projected).toEqual([expect.objectContaining({ from: "2026-08-17", to: "2026-08-23" })]);
  });

  it("睡眠EXPを持たない先行告知で仮イベントの範囲を動かさない", () => {
    const base = {
      currentGameDate: "2026-08-12" as const,
      until: "2027-12-31" as const,
      segments: [{ name: "繰り返すイベント", from: "2025-08-18", to: "2025-08-24", multiplier: 1.5 }],
      realSleepExpSegments: [],
    };
    const withoutAdvance = project({ ...base, knownThrough: "2026-08-23", realEvents: [] });
    const withAdvance = project({
      ...base,
      knownThrough: "2026-09-27",
      realEvents: [{ name: "睡眠EXPなし", from: "2026-09-21", to: "2026-09-27" }],
    });
    expect(withAdvance).toEqual(withoutAdvance);
  });

  it("現在ゲーム日を含む今週は出さず、来週以降だけを出す", () => {
    const projected = project({
      currentGameDate: "2026-08-10",
      knownThrough: "2026-08-23",
      until: "2026-12-31",
      segments: [
        { name: "今週の候補", from: "2025-08-11", to: "2025-08-17", multiplier: 1.5 },
        { name: "来週の候補", from: "2025-08-18", to: "2025-08-24", multiplier: 1.5 },
      ],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(projected.map(event => event.from)).toEqual(["2026-08-17"]);
  });

  it("非月曜開始でも現在ゲーム日を含む週は出さず、翌週は残す", () => {
    const projected = project({
      currentGameDate: "2026-08-12",
      knownThrough: "2026-08-31",
      until: "2026-12-31",
      segments: [
        { name: "今週木曜の候補", from: "2025-08-14", to: "2025-08-20", multiplier: 1.5 },
        { name: "翌週木曜の候補", from: "2025-08-21", to: "2025-08-27", multiplier: 1.5 },
      ],
      realEvents: [],
      realSleepExpSegments: [],
    });

    expect(projected.map(event => event.from)).toEqual(["2026-08-20"]);
  });

  it("週がずれた同じアンカー年の実イベントがあれば仮を捨てる", () => {
    const projected = project({
      currentGameDate: "2026-06-01",
      knownThrough: "2026-08-31",
      until: "2026-12-31",
      anchors: [{ match: "周年記念フェスティバル", month: 7, day: 17 }],
      segments: [{ name: "2周年記念フェスティバル", from: "2025-07-14", to: "2025-07-20", multiplier: 1.5 }],
      realEvents: [{ name: "3周年記念フェスティバル", from: "2026-07-27", to: "2026-08-02" }],
      realSleepExpSegments: [],
    });
    expect(projected).toEqual([]);
  });

  it("期間も年つき月も交わらない同じアンカー年の実イベントがあれば条件1だけで仮を捨てる", () => {
    const projected = project({
      currentGameDate: "2026-06-01",
      knownThrough: "2026-08-31",
      until: "2026-08-31",
      anchors: [{ match: "周年記念フェスティバル", month: 7, day: 17 }],
      // 2025年のアンカー週から-2週。2026年へ写すと6/29の1日だけになり、開催月は6月だけ。
      segments: [{ name: "2周年記念フェスティバル", from: "2025-06-30", to: "2025-06-30", multiplier: 1.5 }],
      // 2026年のアンカー週から+2週。同じアンカー年だが7月の1日だけで、仮とは期間も月も交わらない。
      realEvents: [{ name: "3周年記念フェスティバル", from: "2026-07-27", to: "2026-07-27" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([]);
  });

  it("手入力の睡眠EXP区間と重なる仮イベントを捨てる", () => {
    const projected = project({
      currentGameDate: "2026-08-01",
      knownThrough: "2026-09-30",
      until: "2026-12-31",
      segments: [{ name: "秋イベント", from: "2025-09-01", to: "2025-09-07", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [{ from: "2026-09-10", to: "2026-09-12" }],
    });
    expect(projected).toEqual([]);
  });

  it("同系統・同じ年つき月なら、期間が2週以上ずれて重ならなくても仮を捨てる", () => {
    const projected = project({
      currentGameDate: "2026-07-01",
      knownThrough: "2026-09-30",
      until: "2026-12-31",
      segments: [{ name: "アニポケコラボウィーク", from: "2025-08-18", to: "2025-08-24", multiplier: 1.25 }],
      realEvents: [{ name: "アニポケコラボウィーク", from: "2026-08-31", to: "2026-09-06" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([]);
  });

  it("同系統・同じ月でも年が違えば仮を残す", () => {
    const projected = project({
      currentGameDate: "2025-12-01",
      knownThrough: "2025-12-31",
      until: "2026-02-28",
      segments: [{ name: "連発！スキルウィーク", from: "2025-01-20", to: "2025-01-26", multiplier: 1.5 }],
      realEvents: [{ name: "連発！スキルウィーク", from: "2025-01-06", to: "2025-01-12" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([expect.objectContaining({ from: "2026-01-19", to: "2026-01-25" })]);
  });

  it("同じ年つき月でも名前の系統が違えば仮を残す", () => {
    const projected = project({
      currentGameDate: "2026-04-01",
      knownThrough: "2026-06-30",
      until: "2026-06-30",
      segments: [{ name: "ドラゴンイベント", from: "2025-05-05", to: "2025-05-11", multiplier: 1.5 }],
      realEvents: [{ name: "スキルイベント", from: "2026-05-18", to: "2026-05-24" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([expect.objectContaining({ name: "ドラゴンイベント", from: "2026-05-04" })]);
  });

  it("月をまたぐ実イベントの終了月と同系統の仮の開始月が交われば捨てる", () => {
    const projected = project({
      currentGameDate: "2026-01-01",
      knownThrough: "2026-04-30",
      until: "2026-04-30",
      segments: [{ name: "ポケモンすくすくウィーク", from: "2025-03-17", to: "2025-03-23", multiplier: 1.5 }],
      realEvents: [{ name: "ポケモンすくすくウィーク", from: "2026-02-24", to: "2026-03-02" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([]);
  });

  it("年をまたぐ仮イベントの終了月と同系統の実イベントの年つき月が交われば捨てる", () => {
    const projected = project({
      currentGameDate: "2026-10-01",
      knownThrough: "2026-10-31",
      until: "2027-02-28",
      segments: [{ name: "年末イベント", from: "2025-12-29", to: "2026-01-04", multiplier: 1.5 }],
      realEvents: [{ name: "年末イベント", from: "2027-01-18", to: "2027-01-24" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([]);
  });

  it("末尾のvol.Nの有無が違っても同系統として仮を捨てる", () => {
    const projected = project({
      currentGameDate: "2026-01-01",
      knownThrough: "2026-04-30",
      until: "2026-04-30",
      segments: [{ name: "ポケモンデー記念キャンペーン", from: "2025-03-03", to: "2025-03-09", multiplier: 1.5 }],
      realEvents: [{ name: "ポケモンデー記念キャンペーン vol.1", from: "2026-03-23", to: "2026-03-29" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([]);
  });

  it.each(["Vol.1", "VOL.1"])("末尾が大文字を含む%sでも同系統として仮を捨てる", volume => {
    const projected = project({
      currentGameDate: "2026-01-01",
      knownThrough: "2026-04-30",
      until: "2026-04-30",
      segments: [{ name: "ポケモンデー記念キャンペーン", from: "2025-03-03", to: "2025-03-09", multiplier: 1.5 }],
      realEvents: [{ name: `ポケモンデー記念キャンペーン ${volume}`, from: "2026-03-23", to: "2026-03-29" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([]);
  });

  it("vol.Nを落としても括弧内が違えば別系統として仮を残す", () => {
    const projected = project({
      currentGameDate: "2026-04-01",
      knownThrough: "2026-06-30",
      until: "2026-06-30",
      segments: [{ name: "ポケモンピックアップウィーク(ドラゴン)vol.1", from: "2025-05-05", to: "2025-05-11", multiplier: 1.5 }],
      realEvents: [{ name: "ポケモンピックアップウィーク(スキル)vol.1", from: "2026-05-18", to: "2026-05-24" }],
      realSleepExpSegments: [],
    });

    expect(projected).toEqual([expect.objectContaining({
      name: "ポケモンピックアップウィーク(ドラゴン)vol.1",
      from: "2026-05-04",
    })]);
  });

  it("窓内の同名イベントは入力順にかかわらず最新の開催回だけを写す", () => {
    const newer = { name: "定期イベント", from: "2026-03-02", to: "2026-03-08", multiplier: 1.5 };
    const older = { name: "定期イベント", from: "2025-03-03", to: "2025-03-09", multiplier: 1.25 };
    const base = {
      currentGameDate: "2026-01-01" as const,
      knownThrough: "2026-12-31" as const,
      until: "2027-12-31" as const,
      realEvents: [],
      realSleepExpSegments: [],
    };
    const forward = project({ ...base, segments: [older, newer] });
    const reverse = project({ ...base, segments: [newer, older] });
    expect(reverse).toEqual(forward);
    expect(forward.length).toBeGreaterThan(0);
    expect(forward.every(event => event.sourceFrom === "2026-03-02" && event.multiplier === 1.5)).toBe(true);
  });

  it("窓内でvol.Nだけが違う同系統も最新の開催回だけを写し、表示名は元のまま残す", () => {
    const newer = { name: "定期イベントvol.3", from: "2026-03-02", to: "2026-03-08", multiplier: 1.5 };
    const older = { name: "定期イベント vol.2", from: "2025-03-03", to: "2025-03-09", multiplier: 1.25 };
    const base = {
      currentGameDate: "2026-01-01" as const,
      knownThrough: "2026-12-31" as const,
      until: "2027-12-31" as const,
      realEvents: [],
      realSleepExpSegments: [],
    };
    const forward = project({ ...base, segments: [older, newer] });
    const reverse = project({ ...base, segments: [newer, older] });

    expect(reverse).toEqual(forward);
    expect(forward.length).toBeGreaterThan(0);
    expect(forward.every(event => (
      event.name === "定期イベントvol.3"
      && event.sourceFrom === "2026-03-02"
      && event.multiplier === 1.5
    ))).toBe(true);
  });

  it("1/1アンカーは前年12月開始でもアンカー日の年で同じ回を判定する", () => {
    const projected = project({
      currentGameDate: "2024-10-01",
      knownThrough: "2025-02-01",
      until: "2025-12-31",
      anchors: [{ match: "元日イベント", month: 1, day: 1 }],
      segments: [{ name: "元日イベント", from: "2023-12-18", to: "2023-12-24", multiplier: 1.5 }],
      realEvents: [{ name: "元日イベント", from: "2024-12-16", to: "2024-12-22" }],
      realSleepExpSegments: [],
    });
    expect(projected.some(event => event.from === "2024-12-16")).toBe(false);
    expect(projected).toEqual([expect.objectContaining({ from: "2025-12-15", to: "2025-12-21" })]);
  });

  it("実と同じ回の仮を花の入力前に除き、おいわいフラワーを二重に生やさない", () => {
    const realAnniversary = { name: "3周年記念フェスティバル", from: "2026-07-20", to: "2026-07-26" };
    const projectedOccurrences = project({
      currentGameDate: "2026-06-01",
      knownThrough: "2026-08-31",
      until: "2026-08-31",
      anchors: [{ match: "周年記念フェスティバル", month: 7, day: 17 }],
      segments: [{ name: "2周年記念フェスティバル", from: "2025-07-14", to: "2025-07-20", multiplier: 1.5 }],
      realEvents: [realAnniversary],
      realSleepExpSegments: [],
    });
    const flowers = resolveBlueSeedSegments({
      realSegments: [realAnniversary],
      projectedOccurrences,
      flowers: [{ match: "周年記念フェスティバル", days: 7 }],
      weekday: 1,
      includeGSD: false,
      dayKind: () => "normal",
      until: "2026-08-31",
    });
    expect(projectedOccurrences).toEqual([]);
    expect(flowers.segments).toEqual([expect.objectContaining({ source: "flower" })]);
  });

  it("uses start dates for both source-window edges and keeps an interval whole", () => {
    const outside = project({
      currentGameDate: "2025-03-01",
      knownThrough: "2025-03-01",
      until: "2026-12-31",
      segments: [{ name: "窓外から掛かるイベント", from: "2024-02-28", to: "2024-03-05", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [],
    });
    expect(outside).toEqual([]);

    const announced = project({
      currentGameDate: "2025-06-01",
      knownThrough: "2025-12-31",
      until: "2026-12-31",
      segments: [{ name: "告知済み未開始イベント", from: "2025-12-31", to: "2026-01-06", multiplier: 1.5 }],
      realEvents: [],
      realSleepExpSegments: [{ from: "2025-12-31", to: "2026-01-06" }],
    });
    expect(announced).toEqual([expect.objectContaining({ from: "2026-12-30", to: "2027-01-05" })]);
  });
});
