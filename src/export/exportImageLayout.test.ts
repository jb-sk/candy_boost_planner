import { describe, expect, it } from "vitest";
import {
  buildExportImageModel,
  type ExportImageSource,
  type ExportImageTranslate,
} from "./exportImageModel";
import { FALLBACK_STYLE } from "./exportImageStyle";
import {
  COL_GAP,
  computeExportImageLayout,
  ellipsize,
  LOGICAL_WIDTH,
  MAX_CANVAS_AREA,
  MAX_CANVAS_SIDE,
  PAD_X,
  TARGET_SCALE,
  type MeasureText,
} from "./exportImageLayout";

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
    expect(layoutFor(1).logicalHeight).toBe(534);
  });

  it("行が増えると ROW_H 分だけ高くなる", () => {
    const h1 = layoutFor(1).logicalHeight;
    const h30 = layoutFor(30).logicalHeight;
    expect(h30).toBe(h1 + 29 * 40);
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

  it("英語の長い列見出しを各列幅へ収める", () => {
    const model = buildExportImageModel(makeSource(1), {
      locale: "en",
      now: new Date(2026, 6, 19),
      t: (key) => ({
        "calc.export.colPokemon": "Pokémon",
        "calc.export.colLv": "Level",
        "calc.export.colBoost": "Candy Boost",
        "calc.export.colNormal": "Normal candy",
        "calc.export.colTotal": "Candy total",
        "calc.export.colShards": "Dream Shards",
      }[key] ?? key),
    });
    const layout = computeExportImageLayout(model, FALLBACK_STYLE, fakeMeasure);
    for (const col of layout.columns) {
      expect(fakeMeasure(col.displayLabel, layout.fonts.tableHead))
        .toBeLessThanOrEqual(col.width - 12);
    }
    expect(layout.columns.some((col) => col.displayLabel.endsWith("…"))).toBe(true);
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
    expect(layout.ranking!.pieR).toBe(80);
    // legend 項目は上から下へ
    expect(layout.ranking!.legend[1].top).toBeGreaterThan(layout.ranking!.legend[0].top);
    // 詳細ありなので detailCenterY を持つ
    expect(layout.ranking!.legend[0].detailCenterY).toBeDefined();
  });
});
