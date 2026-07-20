import { describe, expect, it } from "vitest";
import {
  buildExportImageModel,
  type ExportImageSource,
  type ExportImageTranslate,
} from "./exportImageModel";

const TAU = Math.PI * 2;

/** key と params をそのまま返すテスト用翻訳関数。 */
const fakeT: ExportImageTranslate = (key, params) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")})`
    : key;

function makeSource(overrides: Partial<ExportImageSource> = {}): ExportImageSource {
  return {
    rows: [
      {
        id: "r1",
        title: "ピカチュウ",
        natureLabel: "EXP▲",
        srcLevel: 10,
        dstLevel: 30,
        boostCandy: 50,
        normalCandy: 1500,
        totalCandy: 1550,
        shards: 12345,
        candySupply: "万S475",
      },
    ],
    totals: { boostCandy: 50, normalCandy: 1500, totalCandy: 1550, shards: 12345 },
    boostUnused: 0,
    shardsUsed: 12345,
    shardsCap: 4000000,
    boostUsagePct: 65,
    boostCap: 1000,
    boostFillPct: 65,
    shardsUsagePct: 1,
    shardsFillPct: 1,
    universalCandyRanking: [],
    universalCandyUsedTotal: { s: 0, m: 0, l: 0 },
    boostKind: "full",
    ...overrides,
  };
}

const jaPresentation = (t: ExportImageTranslate = fakeT) => ({
  locale: "ja",
  now: new Date(2026, 6, 19),
  t,
});

describe("buildExportImageModel — 情報同等性とブランド", () => {
  it("full モードで brandBoost・6列・boost/normal 値を含む", () => {
    const model = buildExportImageModel(makeSource({ boostKind: "full" }), jaPresentation());
    expect(model.brandLabel).toBe("calc.export.brandBoost");
    expect(model.columns.map((c) => c.key)).toEqual([
      "name",
      "lv",
      "boost",
      "normal",
      "total",
      "shards",
    ]);
    expect(model.rows[0].boostCandy).toBe("50");
    expect(model.rows[0].normalCandy).toBe("1,500");
    expect(model.rows[0].totalCandy).toBe("1,550");
    expect(model.totalRow.boostCandy).toBe("50");
  });

  it("mini モードで brandMini・6列を維持する", () => {
    const model = buildExportImageModel(makeSource({ boostKind: "mini" }), jaPresentation());
    expect(model.brandLabel).toBe("calc.export.brandMini");
    expect(model.columns).toHaveLength(6);
    expect(model.rows[0].boostCandy).toBeDefined();
  });

  it("none モードで brand・4列・boost/normal を省く", () => {
    const model = buildExportImageModel(makeSource({ boostKind: "none" }), jaPresentation());
    expect(model.brandLabel).toBe("calc.export.brand");
    expect(model.columns.map((c) => c.key)).toEqual(["name", "lv", "total", "shards"]);
    expect(model.rows[0].boostCandy).toBeUndefined();
    expect(model.rows[0].normalCandy).toBeUndefined();
    expect(model.totalRow.boostCandy).toBeUndefined();
    expect(model.totalRow.normalCandy).toBeUndefined();
    // Total/Shards は none でも残る
    expect(model.rows[0].totalCandy).toBe("1,550");
    expect(model.rows[0].shards).toBe("12,345");
  });

  it("育成リスト列に candySupply 専用列を作らない", () => {
    const model = buildExportImageModel(makeSource(), jaPresentation());
    expect(model.columns.some((c) => (c.key as string) === "candySupply")).toBe(false);
    expect(model.columns.some((c) => c.label.includes("candySupply"))).toBe(false);
  });
});

describe("buildExportImageModel — stat cards", () => {
  it("boost 未使用が 0 のとき unused カードを出さない", () => {
    const model = buildExportImageModel(makeSource({ boostUnused: 0 }), jaPresentation());
    expect(model.statCards.map((c) => c.key)).toEqual(["boost", "normal", "shards"]);
  });

  it("boost 未使用が正のとき danger の unused カードを出す", () => {
    const model = buildExportImageModel(
      makeSource({ boostUnused: 300 }),
      jaPresentation(),
    );
    const unused = model.statCards.find((c) => c.key === "unused");
    expect(unused).toBeDefined();
    expect(unused?.variant).toBe("danger");
    expect(unused?.value).toBe("300");
    expect(model.statCards.find((c) => c.key === "shards")?.variant).toBe("primary");
    expect(model.statCards.find((c) => c.key === "normal")?.variant).toBe("plain");
  });

  it("none モードでは boost/unused カードを出さない", () => {
    const model = buildExportImageModel(
      makeSource({ boostKind: "none", boostUnused: 300 }),
      jaPresentation(),
    );
    expect(model.statCards.map((c) => c.key)).toEqual(["normal", "shards"]);
  });
});

describe("buildExportImageModel — bars", () => {
  it("boost モードで 2 本、shards は cap 有りで usage を出す", () => {
    const model = buildExportImageModel(makeSource(), jaPresentation());
    expect(model.bars.map((b) => b.key)).toEqual(["boost", "shards"]);
    const shards = model.bars.find((b) => b.key === "shards")!;
    expect(shards.usageLabel).toBe("calc.shardsUsage(pct=1)");
    expect(shards.capLabel).toContain("calc.cap");
  });

  it("shardsCap 0 のとき dash と capUnset を使う", () => {
    const model = buildExportImageModel(makeSource({ shardsCap: 0 }), jaPresentation());
    const shards = model.bars.find((b) => b.key === "shards")!;
    expect(shards.usageLabel).toBe("calc.shardsUsageDash");
    expect(shards.capLabel).toBe("calc.capUnset");
  });

  it("none モードでは boost bar を出さず shards のみ", () => {
    const model = buildExportImageModel(makeSource({ boostKind: "none" }), jaPresentation());
    expect(model.bars.map((b) => b.key)).toEqual(["shards"]);
  });

  it("fillPct は 0..100 にクランプする", () => {
    const model = buildExportImageModel(
      makeSource({ boostFillPct: 250, shardsFillPct: -10 }),
      jaPresentation(),
    );
    expect(model.bars.find((b) => b.key === "boost")!.fillPct).toBe(100);
    expect(model.bars.find((b) => b.key === "shards")!.fillPct).toBe(0);
  });
});

describe("buildExportImageModel — 在庫警告", () => {
  it("アメ・かけらが全て 0 のとき警告を出す", () => {
    const model = buildExportImageModel(
      makeSource({
        totals: { boostCandy: 0, normalCandy: 0, totalCandy: 0, shards: 0 },
      }),
      jaPresentation(),
    );
    expect(model.noStockWarning).toBe("calc.export.noStockWarning");
  });

  it("いずれかが正のとき警告を出さない", () => {
    const model = buildExportImageModel(makeSource(), jaPresentation());
    expect(model.noStockWarning).toBeUndefined();
  });
});

describe("buildExportImageModel — locale と now", () => {
  it("ja で年月と数値書式を固定する", () => {
    const model = buildExportImageModel(makeSource(), {
      locale: "ja",
      now: new Date(2026, 6, 19),
      t: fakeT,
    });
    expect(model.monthLabel).toContain("2026");
    expect(model.monthLabel).toContain("7");
    expect(model.rows[0].shards).toBe("12,345");
  });

  it("en で年月書式が変わる", () => {
    const model = buildExportImageModel(makeSource(), {
      locale: "en",
      now: new Date(2026, 6, 19),
      t: fakeT,
    });
    expect(model.monthLabel).toContain("2026");
    expect(model.monthLabel).toContain("Jul");
  });
});

describe("buildExportImageModel — pie", () => {
  const rankingItem = (over: Partial<ExportImageSource["universalCandyRanking"][number]>) => ({
    id: "x",
    pokemonName: "X",
    universalValue: 1,
    usagePct: 0,
    uniSUsed: 0,
    uniMUsed: 0,
    uniLUsed: 0,
    typeSUsed: 0,
    typeMUsed: 0,
    ...over,
  });

  it("ランキング空なら pie は undefined", () => {
    const model = buildExportImageModel(makeSource({ universalCandyRanking: [] }), jaPresentation());
    expect(model.pie).toBeUndefined();
  });

  it("universalValue 合計が 0 なら pie は undefined", () => {
    const model = buildExportImageModel(
      makeSource({
        universalCandyRanking: [rankingItem({ id: "a", universalValue: 0 })],
      }),
      jaPresentation(),
    );
    expect(model.pie).toBeUndefined();
  });

  it("単一スライスは 0..2π で displayPct 100", () => {
    const model = buildExportImageModel(
      makeSource({
        universalCandyRanking: [
          rankingItem({ id: "a", pokemonName: "ゴローニャ", universalValue: 475, uniSUsed: 475, typeMUsed: 3 }),
        ],
        universalCandyUsedTotal: { s: 475, m: 0, l: 0 },
      }),
      jaPresentation(),
    );
    expect(model.pie).toBeDefined();
    const slices = model.pie!.slices;
    expect(slices).toHaveLength(1);
    expect(slices[0].startAngle).toBe(0);
    expect(slices[0].endAngle).toBeCloseTo(TAU, 10);
    expect(slices[0].displayPct).toBe(100);
    expect(slices[0].universalDetail).toBe("calc.export.labelUni S475");
    expect(slices[0].typeDetail).toBe("calc.export.labelType M3");
    expect(model.pie!.totalLabels[0]).toContain("calc.export.totalUniversalS");
    expect(model.pie!.totalLabels[0]).toContain("475");
  });

  it("複数スライスは連続し最後の endAngle は厳密に 2π、合計角も 2π", () => {
    const model = buildExportImageModel(
      makeSource({
        universalCandyRanking: [
          rankingItem({ id: "a", pokemonName: "A", universalValue: 3, uniSUsed: 3 }),
          rankingItem({ id: "b", pokemonName: "B", universalValue: 1, uniMUsed: 1 }),
        ],
        universalCandyUsedTotal: { s: 3, m: 1, l: 0 },
      }),
      jaPresentation(),
    );
    const slices = model.pie!.slices;
    expect(slices).toHaveLength(2);
    expect(slices[0].startAngle).toBe(0);
    expect(slices[0].colorIndex).toBe(0);
    expect(slices[1].colorIndex).toBe(1);
    // 連続性
    expect(slices[1].startAngle).toBeCloseTo(slices[0].endAngle, 10);
    // 最後は厳密に 2π
    expect(slices[slices.length - 1].endAngle).toBe(TAU);
    // 合計角
    const sweep = slices.reduce((s, sl) => s + (sl.endAngle - sl.startAngle), 0);
    expect(sweep).toBeCloseTo(TAU, 10);
    // 表示 %（75 / 25）
    expect(slices[0].displayPct).toBe(75);
    expect(slices[1].displayPct).toBe(25);
  });

  it("8 スライス超で colorIndex が 8 で循環する", () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      rankingItem({ id: `p${i}`, pokemonName: `P${i}`, universalValue: 1 }),
    );
    const model = buildExportImageModel(
      makeSource({ universalCandyRanking: items }),
      jaPresentation(),
    );
    const slices = model.pie!.slices;
    expect(slices[8].colorIndex).toBe(0);
  });
});
