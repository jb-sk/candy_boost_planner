import { describe, expect, it } from "vitest";
import {
  buildExportImageModel,
  type ExportImageSource,
  type ExportImageTranslate,
} from "./exportImageModel";
import { EXPORT_IMAGE_FONT_FAMILY, FALLBACK_STYLE } from "./exportImageStyle";
import {
  COL_GAP,
  buildFonts,
  computeExportImageLayout,
  EXPORT_FONT_WEIGHT_VALUES,
  ellipsize,
  fitSleepLevelLine,
  LOGICAL_WIDTH,
  MAX_CANVAS_AREA,
  MAX_CANVAS_SIDE,
  PAD_X,
  ROW_H,
  TABLE_HEAD_H,
  TABLE_HEAD_MULTILINE_H,
  splitLegendDetail,
  TARGET_SCALE,
  type MeasureText,
} from "./exportImageLayout";

describe("buildFonts", () => {
  it("タイトルと月だけウェイト800を維持する", () => {
    const fonts = buildFonts(FALLBACK_STYLE);
    const weights = Object.values(fonts).map((font) => Number(font.split(" ", 1)[0]));
    const displayWeightKeys = Object.entries(fonts)
      .filter(([, font]) => font.startsWith("800 "))
      .map(([key]) => key);

    expect(displayWeightKeys).toEqual(["brand", "month"]);
    expect(new Set(weights)).toEqual(new Set(EXPORT_FONT_WEIGHT_VALUES));
    expect(Object.values(fonts).every((font) => font.endsWith(EXPORT_IMAGE_FONT_FAMILY))).toBe(true);
  });
});

const fakeT: ExportImageTranslate = (key, params) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")})`
    : key;

/** font 文字列から px サイズを取り出し、text 長で幅を近似する決定的な measure。 */
const fakeMeasure: MeasureText = (text, font) => {
  const m = font.match(/(\d+)px/);
  const size = m ? Number(m[1]) : 16;
  return text.length * size * 0.5;
};

function makeRows(n: number): ExportImageSource["rows"] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    title: `ポケ${i}`,
    srcLevel: 10,
    dstLevel: 30,
    boostCandy: 10,
    normalCandy: 20,
    totalCandy: 30,
    shards: 100,
  }));
}

function makeSource(n: number, overrides: Partial<ExportImageSource> = {}): ExportImageSource {
  return {
    rows: makeRows(n),
    totals: { boostCandy: 10 * n, normalCandy: 20 * n, totalCandy: 30 * n, shards: 100 * n },
    boostUnused: 0,
    shardsUsed: 100 * n,
    shardsCap: 4000000,
    boostUsagePct: 10,
    boostCap: 1000,
    boostFillPct: 10,
    shardsUsagePct: 1,
    shardsFillPct: 1,
    universalCandyRanking: [],
    universalCandyUsedTotal: { s: 0, m: 0, l: 0 },
    boostKind: "full",
    hasCandyStock: true,
    ...overrides,
  };
}

function layoutFor(n: number, overrides: Partial<ExportImageSource> = {}) {
  const model = buildExportImageModel(makeSource(n, overrides), {
    locale: "ja",
    now: new Date(2026, 6, 19),
    t: fakeT,
  });
  return computeExportImageLayout(model, FALLBACK_STYLE, fakeMeasure);
}

describe("computeExportImageLayout — 高さ", () => {
  it("boost・1行・pie/warning なしの論理高さが固定値", () => {
    expect(layoutFor(1).logicalHeight).toBe(562);
  });

  it("行が増えると ROW_H 分だけ高くなる", () => {
    const h1 = layoutFor(1).logicalHeight;
    const h30 = layoutFor(30).logicalHeight;
    expect(h30).toBe(h1 + 29 * ROW_H);
  });

  it("0 行でも有限・正の高さになる", () => {
    const layout = layoutFor(0);
    expect(layout.logicalHeight).toBeGreaterThan(0);
    expect(Number.isFinite(layout.logicalHeight)).toBe(true);
    expect(layout.rows).toHaveLength(0);
  });

  it("warning があると WARNING_H 分高くなる", () => {
    const base = layoutFor(1);
    const warned = layoutFor(1, { hasCandyStock: false });
    expect(warned.resources.warningTop).toBeDefined();
    expect(warned.logicalHeight).toBe(base.logicalHeight + 30);
  });
});

describe("computeExportImageLayout — 列", () => {
  it("boost モードは 6 列で幅合計 + gap が contentWidth に一致する", () => {
    const layout = layoutFor(3);
    expect(layout.columns).toHaveLength(6);
    const sum = layout.columns.reduce((s, c) => s + c.width, 0);
    expect(sum + COL_GAP * 5).toBeCloseTo(LOGICAL_WIDTH - PAD_X * 2, 6);
    expect(layout.columns[0].key).toBe("name");
    // name 列が最も広い
    const nameW = layout.columns[0].width;
    for (const c of layout.columns.slice(1)) expect(nameW).toBeGreaterThan(c.width);
    // x は左から増える
    for (let i = 1; i < layout.columns.length; i++) {
      expect(layout.columns[i].x).toBeGreaterThan(layout.columns[i - 1].x);
    }
  });

  it("none モードは 4 列（boost/normal を含まない）", () => {
    const layout = layoutFor(3, { boostKind: "none" });
    expect(layout.columns.map((c) => c.key)).toEqual(["name", "lv", "total", "shards"]);
  });

  it("英語の長い列見出しを単語境界で2行にして高さを広げる", () => {
    const model = buildExportImageModel(makeSource(1), {
      locale: "en",
      now: new Date(2026, 6, 19),
      t: (key) => ({
        "calc.export.colPokemon": "Pokémon",
        "calc.export.colLv": "Level",
        "calc.export.colBoost": "Boost",
        "calc.export.colNormal": "Normal candy",
        "calc.export.colTotal": "Total",
        "calc.export.colShards": "Dream Shards",
      }[key] ?? key),
    });
    const layout = computeExportImageLayout(model, FALLBACK_STYLE, fakeMeasure);
    for (const col of layout.columns) {
      for (const line of col.displayLines) {
        expect(fakeMeasure(line, layout.fonts.tableHead))
          .toBeLessThanOrEqual(col.width - 12);
      }
    }
    expect(layout.columns.find((col) => col.key === "normal")?.displayLines)
      .toEqual(["Normal", "candy"]);
    expect(layout.columns.find((col) => col.key === "shards")?.displayLines)
      .toEqual(["Dream", "Shards"]);
    expect(layout.table.headHeight).toBe(TABLE_HEAD_MULTILINE_H);
    expect(layout.table.headHeight).toBeGreaterThan(TABLE_HEAD_H);
  });
});

describe("睡眠育成Lv表記", () => {
  it("幅の広い端末フォントでも指定幅へ収める", () => {
    const fitted = fitSleepLevelLine(
      "63 → 69",
      "70",
      100,
      "600 17px sans-serif",
      "600 12px sans-serif",
      (text, font) => {
        const size = Number(font.match(/([\d.]+)px/)?.[1] ?? 16);
        return text.length * size;
      },
    );

    expect(fitted.totalWidth).toBeLessThanOrEqual(100);
    expect(fitted.levelFont).not.toBe("600 17px sans-serif");
    expect(fitted.sleepMarkFont).not.toBe("600 12px sans-serif");
  });
});

describe("ellipsize", () => {
  it("収まる文字列はそのまま返す", () => {
    expect(ellipsize(fakeMeasure, "短い", 1000, "700 17px x")).toBe("短い");
  });

  it("長い文字列は末尾 … で budget 内に収める", () => {
    const font = "700 17px x";
    const long = "あ".repeat(80);
    const budget = 120;
    const out = ellipsize(fakeMeasure, long, budget, font);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(long.length);
    expect(fakeMeasure(out, font)).toBeLessThanOrEqual(budget);
  });

  it("… すら入らない幅では空文字を返す", () => {
    expect(ellipsize(fakeMeasure, "テスト", 1, "700 17px x")).toBe("");
  });

  it("長い名前は name 列幅に収まるよう displayName へ ellipsize される", () => {
    const layout = layoutFor(1, {
      rows: [
        {
          id: "r0",
          title: "とてもながいポケモンのなまえ".repeat(4),
          natureLabel: "EXP▲▲",
          srcLevel: 10,
          dstLevel: 30,
          boostCandy: 10,
          normalCandy: 20,
          totalCandy: 30,
          shards: 100,
        },
      ],
    });
    const meta = layout.rows[0];
    expect(meta.displayName.endsWith("…")).toBe(true);
    expect(meta.natureBadgeWidth).toBeGreaterThan(0);
  });
});

describe("computeExportImageLayout — scale と oversize", () => {
  it("通常サイズは目標 scale 2・oversize false・整数 pixel 寸法", () => {
    const layout = layoutFor(3);
    expect(layout.scale).toBe(TARGET_SCALE);
    expect(layout.oversize).toBe(false);
    expect(Number.isInteger(layout.pixelWidth)).toBe(true);
    expect(Number.isInteger(layout.pixelHeight)).toBe(true);
    expect(layout.pixelWidth).toBe(LOGICAL_WIDTH * 2);
    expect(layout.pixelHeight).toBe(layout.logicalHeight * 2);
  });

  it("辺長上限に近い高さでは scale が 1..2 に縮小され oversize しない", () => {
    const layout = layoutFor(120);
    expect(layout.logicalHeight).toBeGreaterThan(MAX_CANVAS_SIDE / 2);
    expect(layout.scale).toBeGreaterThan(1);
    expect(layout.scale).toBeLessThan(2);
    expect(layout.oversize).toBe(false);
    expect(layout.pixelHeight).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(layout.pixelWidth * layout.pixelHeight).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });

  it("scale 1 でも辺長上限を超える高さは oversize（切り捨てない）", () => {
    const layout = layoutFor(220);
    expect(layout.logicalHeight).toBeGreaterThan(MAX_CANVAS_SIDE);
    expect(layout.oversize).toBe(true);
    expect(layout.scale).toBe(1);
    // 行は落とさずモデル全行分を保持する
    expect(layout.rows).toHaveLength(220);
  });
});

describe("computeExportImageLayout — pie 配置", () => {
  it("万能アメ内訳をチップ名と値へ分割する", () => {
    expect(splitLegendDetail("万能 S124 / M25")).toEqual({
      label: "万能",
      value: "S124 / M25",
    });
    expect(splitLegendDetail(undefined)).toBeUndefined();
  });

  it("pie ありでランキング section・legend 項目が配置される", () => {
    const layout = layoutFor(2, {
      universalCandyRanking: [
        { id: "a", pokemonName: "A", universalValue: 3, usagePct: 0, uniSUsed: 3, uniMUsed: 0, uniLUsed: 0, typeSUsed: 0, typeMUsed: 0 },
        { id: "b", pokemonName: "B", universalValue: 1, usagePct: 0, uniSUsed: 0, uniMUsed: 1, uniLUsed: 0, typeSUsed: 0, typeMUsed: 0 },
      ],
      universalCandyUsedTotal: { s: 3, m: 1, l: 0 },
    });
    expect(layout.ranking).toBeDefined();
    expect(layout.ranking!.legend).toHaveLength(2);
    expect(layout.ranking!.pieR).toBe(72);
    expect(layout.ranking!.pieCX).toBe(layout.contentX + 12 + layout.ranking!.pieR);
    const legendCenter = (
      layout.ranking!.legend[0].top
      + layout.ranking!.legend[layout.ranking!.legend.length - 1].top
      + 30
    ) / 2;
    expect(legendCenter).toBe(layout.ranking!.pieCY);
    expect(layout.ranking!.legendNameWidth).toBeGreaterThan(0);
    expect(layout.ranking!.legendPctWidth).toBeGreaterThan(0);
    // legend 項目は上から下へ
    expect(layout.ranking!.legend[1].top).toBeGreaterThan(layout.ranking!.legend[0].top);
    // 名前・%・アメ内訳を同じ行へ置くため、項目間隔は固定の1行分。
    expect(layout.ranking!.legend[1].top - layout.ranking!.legend[0].top).toBe(30);
  });
});
