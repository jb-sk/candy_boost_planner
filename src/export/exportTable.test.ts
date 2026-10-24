import { describe, expect, it } from "vitest";
import {
  buildExportTable,
  formatExportCsv,
  formatExportedAt,
  formatExportTsv,
  type ExportTableLabels,
  type ExportTableMeta,
  type ExportTableRow,
} from "./exportTable";

const labels: ExportTableLabels = {
  pokemon: "ポケモン", expAdj: "EXP補正", srcLevel: "現在Lv", expRemaining: "あとEXP", candyReachLevel: "アメ到達Lv", candyReachExpToNext: "アメ到達後のあとEXP",
  targetLevel: "目標Lv", sleepTarget: "睡眠目標", remainingExp: "残EXP", remainingSleepTime: "残EXPの睡眠時間", restTime: "睡眠・島の時間", restReachLevel: "睡眠・島到達Lv",
  boostReachLevel: "アメブ目標Lv", boostCandy: "アメブ", normalCandy: "通常アメ", totalCandy: "アメ合計", shards: "かけら",
  species: "種族アメ", typeS: "タイプS", typeM: "タイプM", universalS: "万能S", universalM: "万能M", universalL: "万能L",
  growthIncense: "成長のお香", napTickets: "おひるね島チケット", surplus: "余り",
  candyShortage: "アメ不足", shardsShortage: "かけら不足", boostShortage: "アメブ不足",
  total: "合計", exportedAt: "出力日時", boostKind: "アメブ種別", boostUsed: "アメブ使用", boostCap: "アメブ上限",
  boostUnused: "アメブ未使用", shardsUsed: "かけら使用", shardsCap: "かけら上限",
};

const meta: ExportTableMeta = {
  exportedAt: "2026-10-13 12:34", boostKindLabel: "ミニブ",
  boostUsed: 20, boostCap: 350, boostUnused: 330, shardsUsed: 126882, shardsCap: 12500000,
};

function row(patch: Partial<ExportTableRow> = {}): ExportTableRow {
  return {
    title: "70ラティアス", natureLabel: "-", srcLevel: 68, expRemaining: 1644, candyReachLevel: 69, candyReachExpToNext: 5804, targetLevel: 70,
    sleepTarget: "おひるね島（アメ在庫）", remainingExp: 5804, remainingSleepTime: "約45日（585時間）", restTime: "38日16時間39分", restReachLevel: "約70",
    boostReachLevel: 69, boostCandy: 20, normalCandy: 28, totalCandy: 48, shards: 126882,
    species: 48, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0,
    growthIncense: 0, napTickets: 0, surplus: 0, candyShortage: 0, shardsShortage: 0, boostShortage: 0,
    ...patch,
  };
}

describe("buildExportTable", () => {
  it("並びは 見出し → 行 → 合計 → 空行 → 表全体の情報。合計は数の列だけ足す", () => {
    const table = buildExportTable({
      rows: [row(), row({ title: "B", boostCandy: 5, normalCandy: 1, totalCandy: 6, shards: 100, species: 2, universalS: 4, growthIncense: 3, napTickets: 2, candyShortage: 7 })],
      meta, labels, boostMode: true,
    });
    const head = table[0]!;
    expect(head).toEqual([
      "ポケモン", "EXP補正", "現在Lv", "あとEXP", "目標Lv", "アメ到達Lv", "アメ到達後のあとEXP", "残EXP", "残EXPの睡眠時間", "睡眠目標", "睡眠・島の時間", "睡眠・島到達Lv",
      "アメブ目標Lv", "アメブ", "通常アメ", "アメ合計", "かけら",
      "種族アメ", "タイプS", "タイプM", "万能S", "万能M", "万能L",
      "成長のお香", "おひるね島チケット", "余り", "アメ不足", "かけら不足", "アメブ不足",
    ]);
    const cell = (line: (string | number)[], label: string) => line[head.indexOf(label)];
    expect(cell(table[1]!, "睡眠・島の時間")).toBe("38日16時間39分");

    const total = table[3]!;
    expect(total[0]).toBe("合計");
    // Lv・残EXP・文字の列は足さない
    expect(cell(total, "現在Lv")).toBe("");
    expect(cell(total, "あとEXP")).toBe("");
    expect(cell(total, "残EXP")).toBe("");
    expect(cell(total, "残EXPの睡眠時間")).toBe("");
    expect(cell(total, "睡眠目標")).toBe("");
    expect(cell(total, "アメブ")).toBe(25);
    expect(cell(total, "アメ合計")).toBe(54);
    expect(cell(total, "かけら")).toBe(126982);
    expect(cell(total, "種族アメ")).toBe(50);
    expect(cell(total, "万能S")).toBe(4);
    expect(cell(total, "成長のお香")).toBe(3);
    expect(cell(total, "おひるね島チケット")).toBe(2);
    expect(cell(total, "アメ不足")).toBe(7);

    expect(table[4]).toEqual([]);
    expect(table.slice(5)).toEqual([
      ["出力日時", "2026-10-13 12:34"],
      ["アメブ種別", "ミニブ"],
      ["アメブ使用", 20],
      ["アメブ上限", 350],
      ["アメブ未使用", 330],
      ["かけら使用", 126882],
      ["かけら上限", 12500000],
    ]);
  });

  it("アメブなしでは、アメブの列と情報を出さない", () => {
    const table = buildExportTable({ rows: [row()], meta, labels, boostMode: false });
    for (const label of ["アメブ目標Lv", "アメブ", "通常アメ", "アメブ不足"]) expect(table[0]).not.toContain(label);
    expect(table[0]).toContain("アメ合計");
    expect(table.slice(4).map((line) => line[0])).toEqual(["出力日時", "かけら使用", "かけら上限"]);
  });
});

describe("formatExportCsv / formatExportTsv", () => {
  const table = [["名前", "メモ"], ["a,b", 'say "hi"'], ["タブ\tと\n改行", 3], [], ["出力日時", "2026-10-13 12:34"]];

  it("CSV は , \" 改行を含むセルを引用し、改行は CRLF", () => {
    expect(formatExportCsv(table)).toBe('名前,メモ\r\n"a,b","say ""hi"""\r\n"タブ\tと\n改行",3\r\n\r\n出力日時,2026-10-13 12:34\r\n');
  });

  it("TSV はセルの中のタブ・改行を空白にし、\" を含むセルは引用する（貼り付けで列・行が崩れない）", () => {
    expect(formatExportTsv(table)).toBe('名前\tメモ\na,b\t"say ""hi"""\nタブ と 改行\t3\n\n出力日時\t2026-10-13 12:34\n');
    // " で始まる名前（閉じない引用）でも、後ろの列を取り込まない
    expect(formatExportTsv([['"Eevee', 1], ['"Pikachu"', 2]])).toBe('"""Eevee"\t1\n"""Pikachu"""\t2\n');
  });
});

describe("formatExportedAt", () => {
  it("端末の時刻を YYYY-MM-DD HH:mm で書く", () => {
    expect(formatExportedAt(new Date(2026, 0, 5, 7, 3))).toBe("2026-01-05 07:03");
  });
});
