import { describe, expect, it } from "vitest";

import type { EventHistoryEntry } from "../../../src/domain/pokesleep/_generated/sleep-exp-events";
import type { GameDate } from "../../../src/domain/pokesleep/game-date";
import { resolveBlueSeedSegments } from "../../../src/domain/pokesleep/growth-flower";
import { buildEventHistoryView } from "../../../src/utils/eventHistoryView";

/** ラベルはキーと引数をそのまま返す。文言の変更でテストが落ちないようにする */
const translate = (key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params ?? {})}`;

const flowers = [{ match: "周年記念フェスティバル", days: 7 }];

/** 周年フェス（2週間開催・睡眠EXPは1週目のみ・ミニブあり） */
const anniversary: EventHistoryEntry = {
  name: "3周年記念フェスティバル",
  from: "2026-07-13",
  to: "2026-07-26",
  sleepExp: { multiplier: 1.5, from: "2026-07-13", to: "2026-07-19" },
  boost: "mini",
};

/** 1週間開催・睡眠EXPが期間ぜんぶ */
const week: EventHistoryEntry = {
  name: "アニポケコラボウィーク",
  from: "2026-08-17",
  to: "2026-08-23",
  sleepExp: { multiplier: 1.25, from: "2026-08-17", to: "2026-08-23" },
};

/** 睡眠EXPなし・アメブあり */
const boostOnly: EventHistoryEntry = {
  name: "ホリデー2025：ダブルゆめのかけらリサーチ",
  from: "2025-12-22",
  to: "2025-12-28",
  boost: "full",
};

function build(history: readonly EventHistoryEntry[], options?: { cutoffDate?: string; locale?: "ja" | "en" }) {
  return buildEventHistoryView({
    history,
    flowers,
    cutoffDate: (options?.cutoffDate ?? "2026-09-27") as GameDate,
    t: translate,
    locale: options?.locale ?? "ja",
  });
}

describe("buildEventHistoryView", () => {
  describe("年ごとの塊", () => {
    it("開始年ごとに分け、渡された順（新しい順）を保つ", () => {
      const view = build([week, anniversary, boostOnly]);

      expect(view.groups.map(group => group.year)).toEqual(['eventHistory.year:{"year":"2026"}', 'eventHistory.year:{"year":"2025"}']);
      expect(view.groups[0].rows).toHaveLength(2);
      expect(view.groups[1].rows).toHaveLength(1);
    });

    it("年合計は 開催回数 / 睡眠EXPのある回数 / ミニブとアメブの合計 の順に並ぶ", () => {
      const view = build([week, anniversary, boostOnly]);

      expect(view.groups[0].summary.map(cell => cell.value)).toEqual([
        'eventHistory.yearCount:{"count":2}',
        'eventHistory.yearCount:{"count":2}',
        'eventHistory.yearCount:{"count":1}',
      ]);
      // アメブとミニブは1つの列にまとめる（内訳は見出し下の2段が持つ）
      expect(view.groups[1].summary.map(cell => cell.value)).toEqual([
        'eventHistory.yearCount:{"count":1}',
        'eventHistory.yearCount:{"count":0}',
        'eventHistory.yearCount:{"count":1}',
      ]);
    });

    it("同じ年が離れて現れたら別の塊になる（並べ替えない）", () => {
      const older2026: EventHistoryEntry = { ...week, name: "1月のイベント", from: "2026-01-05", to: "2026-01-11" };
      const view = build([week, boostOnly, older2026]);

      expect(view.groups).toHaveLength(3);
    });
  });

  describe("期間の表記", () => {
    it("年見出しと同じ年は年を省く", () => {
      const view = build([week]);

      expect(view.groups[0].rows[0].period).toBe("8/17–8/23");
    });

    it("年をまたぐ回は、はみ出した側にだけ年が残る", () => {
      const crossing: EventHistoryEntry = { ...boostOnly, from: "2025-12-29", to: "2026-01-04" };
      const view = build([crossing]);

      expect(view.groups[0].rows[0].period).toBe("12/29–2026/1/4");
    });

    it("単日開催は1つだけ出す", () => {
      const single: EventHistoryEntry = { ...boostOnly, from: "2025-12-22", to: "2025-12-22" };
      const view = build([single]);

      expect(view.groups[0].rows[0].period).toBe("12/22");
    });

    it("英語ロケールは月日の順を変える", () => {
      const view = build([week], { locale: "en" });

      expect(view.groups[0].rows[0].period).toBe("08/17–08/23");
    });
  });

  describe("睡眠EXPの段", () => {
    it("開催期間ぜんぶに掛かる回は、週の断りが空文字の段を1つだけ出す", () => {
      const view = build([week]);

      expect(view.groups[0].rows[0].expLines).toEqual([{ tag: "", multiplier: 1.25, flower: false }]);
    });

    it("周年フェスは「1週目の倍率」と「2週目のおいわいフラワー ×3」の2段になる", () => {
      const view = build([anniversary]);

      expect(view.groups[0].rows[0].expLines).toEqual([
        { tag: "eventHistory.firstWeek:{}", multiplier: 1.5, flower: false },
        { tag: "eventHistory.secondWeek:{}", multiplier: 3, flower: true },
      ]);
    });

    it("花の定義に名前が当たらない回には花を出さない", () => {
      const partial: EventHistoryEntry = { ...anniversary, name: "ながいコラボウィーク" };
      const view = build([partial]);

      expect(view.groups[0].rows[0].expLines).toHaveLength(1);
    });

    it("睡眠EXPを持たない回（1周年）には段そのものを出さない", () => {
      const firstAnniversary: EventHistoryEntry = { name: "1周年記念フェスティバル", from: "2024-07-15", to: "2024-07-28", boost: "mini" };
      const view = build([firstAnniversary]);

      expect(view.groups[0].rows[0].expLines).toEqual([]);
    });

    it("睡眠EXPが開催期間の末日まで掛かる回には花を出さない（2週目が無い）", () => {
      const fullSpan: EventHistoryEntry = { ...anniversary, sleepExp: { multiplier: 1.5, from: "2026-07-13", to: "2026-07-26" } };
      const view = build([fullSpan]);

      expect(view.groups[0].rows[0].expLines).toEqual([{ tag: "", multiplier: 1.5, flower: false }]);
    });
  });

  describe("アメブースト", () => {
    it("種別ごとのラベルを付ける", () => {
      const view = build([anniversary, boostOnly]);

      expect(view.groups[0].rows[0].boost).toEqual({ kind: "mini", label: "eventHistory.boostMini:{}" });
      expect(view.groups[1].rows[0].boost).toEqual({ kind: "full", label: "eventHistory.boostFull:{}" });
    });

    it("無い回は持たない", () => {
      const view = build([week]);

      expect(view.groups[0].rows[0].boost).toBeNull();
    });
  });

  describe("件数の2段", () => {
    it("直近1年は cutoffDate から 365 日さかのぼった窓で数える（今日には依存しない）", () => {
      const view = build([week, anniversary, boostOnly], { cutoffDate: "2026-09-27" });

      // 全期間は3件（睡眠EXP2 / ミニブ1 / アメブ1）
      expect(view.counts[0].text).toBe('eventHistory.count:{"sleepExp":2,"boostMini":1,"boostFull":1}');
      // 直近1年（2025-09-27〜2026-09-27）は 2025-12-22 開始の回も入る
      expect(view.counts[1].text).toBe('eventHistory.count:{"sleepExp":2,"boostMini":1,"boostFull":1}');
      expect(view.counts[1].range).toBe("2025/9/27–2026/9/27");
    });

    it("cutoffDate を戻すと窓から外れた回が落ちる", () => {
      const view = build([week, anniversary, boostOnly], { cutoffDate: "2026-12-01" });

      // 窓は 2025-12-01〜2026-12-01。2025-12-22 のアメブは残り、範囲だけが動く
      expect(view.counts[1].range).toBe("2025/12/1–2026/12/1");

      const narrower = build([week, anniversary, boostOnly], { cutoffDate: "2026-12-30" });
      // 窓が 2025-12-30 始まりになると 2025-12-22 のアメブが落ちる
      expect(narrower.counts[1].text).toBe('eventHistory.count:{"sleepExp":2,"boostMini":1,"boostFull":0}');
    });

    it("全期間の行には範囲を付けない", () => {
      const view = build([week]);

      expect(view.counts[0].range).toBe("");
    });
  });

  it("行のキーは名前と期間で作る（同名で複数回開催されるイベントがある）", () => {
    const first: EventHistoryEntry = { ...week, name: "ポケモンすくすくウィーク", from: "2026-03-02", to: "2026-03-08", sleepExp: { multiplier: 1.5, from: "2026-03-02", to: "2026-03-08" } };
    const second: EventHistoryEntry = { ...first, from: "2026-05-11", to: "2026-05-17", sleepExp: { multiplier: 1.5, from: "2026-05-11", to: "2026-05-17" } };
    const view = build([second, first]);

    const keys = view.groups[0].rows.map(row => row.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("履歴が空でも落ちない", () => {
    const view = build([]);

    expect(view.groups).toEqual([]);
    expect(view.counts).toHaveLength(2);
  });

  // 表示と計算で花の根拠がズレると、内訳に ×3 が出ているのに履歴には出ない（逆も）という食い違いになる。
  // 片方だけ直したときに落とすため、同じ入力を両方へ通して突き合わせる
  describe("花の判定は計算側（resolveBlueSeedSegments）と一致する", () => {
    it.each([
      ["周年フェス（睡眠EXPは1週目のみ）", anniversary, true],
      ["花の定義に当たらない名前", { ...anniversary, name: "ながいコラボウィーク" }, false],
      ["睡眠EXPが末日まで掛かる回", { ...anniversary, sleepExp: { multiplier: 1.5, from: "2026-07-13", to: "2026-07-26" } }, false],
    ] as const)("%s", (_label, entry, expected) => {
      const view = build([entry]);
      const hasFlowerLine = view.groups[0].rows[0].expLines.some(line => line.flower);

      const { segments } = resolveBlueSeedSegments({
        // 計算側は睡眠EXP区間（1週目）を受け取り、その翌日から2週目を数える
        realSegments: [{ name: entry.name, from: entry.sleepExp!.from, to: entry.sleepExp!.to }],
        projectedOccurrences: [],
        flowers,
        weekday: 1,
        includeGSD: false,
        dayKind: () => "normal",
        until: "2027-12-31",
      });
      // 計算側は2週目の有無を知らない（区間しか持たない）ので、開催期間に2週目があるかで絞る
      const hasFlowerSegment = segments.length > 0 && entry.sleepExp!.to < entry.to;

      expect(hasFlowerLine).toBe(expected);
      expect(hasFlowerSegment).toBe(expected);
    });
  });
});
