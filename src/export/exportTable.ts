/**
 * 育成プランの表出力（CSV / TSV）。画像とは別の、表計算ソフトへ渡す形。
 *
 * 1行目が見出し、その下にポケモンの行と合計行、空行を挟んで表全体の情報（出力日時・アメブ・かけら）を並べる。
 * 値は計算画面と同じ経路で求めたものを受け取るだけで、ここでは計算し直さない（`useCalcStore` の `exportTableRows`）。
 */

/** ポケモン1行ぶんの値。文字の値は表示言語で書式済み */
export type ExportTableRow = {
  title: string;
  /** EXP補正（▲▲ / ▼▼ / 補正なしの記号） */
  natureLabel: string;
  srcLevel: number;
  /** 現在Lvから次のLvまでのEXP（入力欄の「あとEXP」） */
  expRemaining: number;
  /** アメを使い終えた時点のLv */
  candyReachLevel: number;
  /** アメを使い終えた時点の次のLvまでのEXP */
  candyReachExpToNext: number;
  /** 最終目標Lv（睡眠・おひるね島のあとの目標を含む） */
  targetLevel: number;
  /** 睡眠目標（「おひるね島（チケット・アメ在庫）」など） */
  sleepTarget: string;
  /** アメのあと、目標Lvまでに残るEXP */
  remainingExp: number;
  /**
   * 残EXPを睡眠だけで埋めた場合の時間（計算画面の「残EXP 約N日」と同じ書式）。睡眠目標に関係なく、残EXPがある行すべて。
   * おひるね島の行も睡眠に換算する（島の時間は restTime）。残EXPが無い行は空
   */
  remainingSleepTime: string;
  /**
   * 実際に寝る（預ける）時間。数値の睡眠目標は睡眠目標までの残り時間（「82時間」）、
   * 睡眠・おひるね島は目標Lvまでの時間。睡眠目標が無い行は空
   */
  restTime: string;
  /** 睡眠・おひるね島のあとの着地点の Lv（「67.0」。Lv70 は「70」）。睡眠目標が無い行・睡眠・島のEXPが無い行は空 */
  restReachLevel: string;
  boostReachLevel: number;
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
  species: number;
  typeS: number;
  typeM: number;
  universalS: number;
  universalM: number;
  universalL: number;
  growthIncense: number;
  napTickets: number;
  surplus: number;
  /** 不足は計算画面の不足チップと同じ（律速の資源の1つと、アメブ枠）。無ければ 0 */
  candyShortage: number;
  shardsShortage: number;
  boostShortage: number;
};

/** 表全体の情報 */
export type ExportTableMeta = {
  exportedAt: string;
  boostKindLabel: string;
  boostUsed: number;
  boostCap: number;
  boostUnused: number;
  shardsUsed: number;
  shardsCap: number;
};

/** 見出しの文字（表示言語で翻訳済み） */
export type ExportTableLabels = {
  pokemon: string;
  expAdj: string;
  srcLevel: string;
  expRemaining: string;
  candyReachLevel: string;
  candyReachExpToNext: string;
  targetLevel: string;
  sleepTarget: string;
  remainingExp: string;
  remainingSleepTime: string;
  restTime: string;
  restReachLevel: string;
  boostReachLevel: string;
  boostCandy: string;
  normalCandy: string;
  totalCandy: string;
  shards: string;
  species: string;
  typeS: string;
  typeM: string;
  universalS: string;
  universalM: string;
  universalL: string;
  growthIncense: string;
  napTickets: string;
  surplus: string;
  candyShortage: string;
  shardsShortage: string;
  boostShortage: string;
  total: string;
  exportedAt: string;
  boostKind: string;
  boostUsed: string;
  boostCap: string;
  boostUnused: string;
  shardsUsed: string;
  shardsCap: string;
};

type Cell = string | number;

type Column = {
  label: keyof ExportTableLabels;
  value: (row: ExportTableRow) => Cell;
  /** 合計行に足し上げる列 */
  sum?: boolean;
  /** アメブを使うときだけ出す列 */
  boostOnly?: boolean;
};

const COLUMNS: readonly Column[] = [
  { label: "pokemon", value: (r) => r.title },
  { label: "expAdj", value: (r) => r.natureLabel },
  { label: "srcLevel", value: (r) => r.srcLevel },
  { label: "expRemaining", value: (r) => r.expRemaining },
  { label: "targetLevel", value: (r) => r.targetLevel },
  { label: "candyReachLevel", value: (r) => r.candyReachLevel },
  { label: "candyReachExpToNext", value: (r) => r.candyReachExpToNext },
  { label: "remainingExp", value: (r) => r.remainingExp },
  { label: "remainingSleepTime", value: (r) => r.remainingSleepTime },
  { label: "sleepTarget", value: (r) => r.sleepTarget },
  { label: "restTime", value: (r) => r.restTime },
  { label: "restReachLevel", value: (r) => r.restReachLevel },
  { label: "boostReachLevel", value: (r) => r.boostReachLevel, boostOnly: true },
  { label: "boostCandy", value: (r) => r.boostCandy, sum: true, boostOnly: true },
  { label: "normalCandy", value: (r) => r.normalCandy, sum: true, boostOnly: true },
  { label: "totalCandy", value: (r) => r.totalCandy, sum: true },
  { label: "shards", value: (r) => r.shards, sum: true },
  { label: "species", value: (r) => r.species, sum: true },
  { label: "typeS", value: (r) => r.typeS, sum: true },
  { label: "typeM", value: (r) => r.typeM, sum: true },
  { label: "universalS", value: (r) => r.universalS, sum: true },
  { label: "universalM", value: (r) => r.universalM, sum: true },
  { label: "universalL", value: (r) => r.universalL, sum: true },
  { label: "growthIncense", value: (r) => r.growthIncense, sum: true },
  { label: "napTickets", value: (r) => r.napTickets, sum: true },
  { label: "surplus", value: (r) => r.surplus, sum: true },
  { label: "candyShortage", value: (r) => r.candyShortage, sum: true },
  { label: "shardsShortage", value: (r) => r.shardsShortage, sum: true },
  { label: "boostShortage", value: (r) => r.boostShortage, sum: true, boostOnly: true },
];

/** 見出し・各行・合計行・表全体の情報を、セルの2次元配列で返す */
export function buildExportTable(params: {
  rows: readonly ExportTableRow[];
  meta: ExportTableMeta;
  labels: ExportTableLabels;
  /** アメブを使うか（アメブ種別が「なし」なら false。アメブの列と情報を出さない） */
  boostMode: boolean;
}): Cell[][] {
  const { rows, meta, labels, boostMode } = params;
  const columns = COLUMNS.filter((c) => boostMode || !c.boostOnly);

  const head = columns.map((c) => labels[c.label]);
  const body = rows.map((row) => columns.map((c) => c.value(row)));
  const total = columns.map((c, index): Cell => {
    if (index === 0) return labels.total;
    if (!c.sum) return "";
    return rows.reduce((acc, row) => acc + (c.value(row) as number), 0);
  });

  const info: Cell[][] = [
    [labels.exportedAt, meta.exportedAt],
    ...(boostMode
      ? [
        [labels.boostKind, meta.boostKindLabel],
        [labels.boostUsed, meta.boostUsed],
        [labels.boostCap, meta.boostCap],
        [labels.boostUnused, meta.boostUnused],
      ]
      : []),
    [labels.shardsUsed, meta.shardsUsed],
    [labels.shardsCap, meta.shardsCap],
  ];

  return [head, ...body, total, [], ...info];
}

function csvCell(v: Cell): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * TSV はセルの中のタブ・改行を空白に置き換える（表計算ソフトへの貼り付けで列・行が崩れないように）。
 * `"` を含むセルは引用する。Excel などは `"` で始まるセルを引用とみなし、閉じるまで後ろの列・行を取り込む
 */
function tsvCell(v: Cell): string {
  const s = String(v).replace(/[\t\r\n]+/g, " ");
  return s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV（RFC 4180 の引用、改行は CRLF） */
export function formatExportCsv(table: readonly Cell[][]): string {
  return table.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** TSV（表計算ソフトへ貼り付ける用。改行は LF） */
export function formatExportTsv(table: readonly Cell[][]): string {
  return table.map((row) => row.map(tsvCell).join("\t")).join("\n") + "\n";
}

/** 出力日時の書式（`2026-10-13 12:34`。端末の時刻） */
export function formatExportedAt(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
