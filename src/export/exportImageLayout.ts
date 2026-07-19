/**
 * exportImageLayout — 論理寸法・scale・section 配置・列幅・ellipsis を計算する純関数。
 *
 * DOM/Canvas を保持しない。文字幅は注入された `measureText` から得るため、
 * fake measure を渡せば node 環境の vitest で高さ・列幅・ellipsis・scale・oversize を検証できる。
 */

import type {
  ExportColumn,
  ExportImageModel,
  ExportModelRow,
  ExportPieSlice,
} from "./exportImageModel";
import type { ExportImageStyle } from "./exportImageStyle";

// ── サイズ制限（allocation 前に総 pixel 数と辺長の両方を検査する）─────────────
/** iOS 15 世代 Safari の安全上限（16.7MP に 5% 余裕）。 */
export const MAX_CANVAS_AREA = 16_000_000;
/** 辺長上限（定数として分離。対象実機で確認できる値）。 */
export const MAX_CANVAS_SIDE = 8192;
/** 目標 PNG scale。UI の表示 scale とは無関係。 */
export const TARGET_SCALE = 2;

// ── 論理レイアウト定数（すべて論理 px）────────────────────────────────
export const LOGICAL_WIDTH = 760;
export const PAD_X = 32;
export const PAD_BOTTOM = 28;

export const HEADER_H = 76;
export const GAP_AFTER_HEADER = 20;

export const TITLE_TEXT_H = 30;
export const TITLE_UNDERLINE_GAP = 6;
export const TITLE_MARGIN_BELOW = 12;
export const SECTION_TITLE_BLOCK = TITLE_TEXT_H + TITLE_UNDERLINE_GAP + 2 + TITLE_MARGIN_BELOW;

export const WARNING_H = 30;

export const CARD_H = 66;
export const CARD_GAP = 10;
export const CARDS_MARGIN_BELOW = 18;

export const BAR_BLOCK_H = 34;
export const BAR_HEAD_H = 20;
export const BAR_TRACK_H = 8;
export const BAR_GAP = 14;

export const SECTION_GAP = 22;

export const COL_GAP = 8;
export const TABLE_HEAD_H = 36;
export const ROW_H = 40;
export const TOTAL_ROW_H = 46;
export const CELL_PAD = 6;
export const BADGE_PAD_X = 6;
export const BADGE_GAP = 8;

export const RANKING_TOTAL_H = 32;
export const PIE_D = 160;
export const PIE_LEGEND_GAP = 24;
export const LEGEND_SWATCH = 14;
export const LEGEND_SWATCH_GAP = 8;
export const LEGEND_PCT_RESERVE = 56;
export const LEGEND_NAME_H = 28;
export const LEGEND_DETAIL_H = 22;

// ── フォント（layout の measure と renderer の描画で同じ文字列を使う）──────────
export type ExportFonts = {
  brand: string;
  month: string;
  sectionTitle: string;
  warning: string;
  cardLabel: string;
  cardValue: string;
  barLabel: string;
  barCap: string;
  tableHead: string;
  cellName: string;
  cellNature: string;
  cellLv: string;
  cellNum: string;
  totalNum: string;
  rankingTotalLabel: string;
  rankingTotalItem: string;
  legendName: string;
  legendPct: string;
  legendDetail: string;
};

function fontString(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}

export function buildFonts(style: ExportImageStyle): ExportFonts {
  const body = style.bodyFontFamily;
  const head = style.headingFontFamily;
  return {
    brand: fontString(800, 26, head),
    month: fontString(700, 22, head),
    sectionTitle: fontString(700, 21, head),
    warning: fontString(700, 17, body),
    cardLabel: fontString(700, 13, body),
    cardValue: fontString(800, 26, head),
    barLabel: fontString(600, 15, body),
    barCap: fontString(600, 15, body),
    tableHead: fontString(700, 15, body),
    cellName: fontString(700, 17, body),
    cellNature: fontString(600, 12, body),
    cellLv: fontString(600, 17, body),
    cellNum: fontString(600, 17, body),
    totalNum: fontString(700, 17, body),
    rankingTotalLabel: fontString(700, 15, body),
    rankingTotalItem: fontString(600, 17, body),
    legendName: fontString(700, 17, body),
    legendPct: fontString(700, 18, head),
    legendDetail: fontString(600, 15, body),
  };
}

export type MeasureText = (text: string, font: string) => number;

/** 列幅の fr 比。model.columns（mode により 6/4 列）からそのまま列を作る。 */
const COLUMN_FR: Record<ExportColumn["key"], number> = {
  name: 2.5,
  lv: 1,
  boost: 1,
  normal: 1,
  total: 1,
  shards: 1.3,
};

export type ExportLayoutColumn = {
  key: ExportColumn["key"];
  x: number;
  width: number;
  align: "left" | "center" | "right";
  /** 固定列幅に収まる描画用見出し。 */
  displayLabel: string;
};

export type ExportLayoutRowMeta = {
  displayName: string;
  natureLabel?: string;
  natureBadgeWidth: number;
};

export type ExportLayoutLegendItem = {
  slice: ExportPieSlice;
  displayName: string;
  top: number;
  nameCenterY: number;
  detailCenterY?: number;
};

export type ExportLayoutCard = {
  x: number;
  width: number;
  top: number;
};

export type ExportLayoutBar = { top: number };

export type ExportImageLayout = {
  logicalWidth: number;
  logicalHeight: number;
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
  /** scale 1 でも制限に収まらない。true なら allocation せず image_too_large にする。 */
  oversize: boolean;
  contentX: number;
  contentWidth: number;
  fonts: ExportFonts;

  headerHeight: number;

  resources: {
    titleTop: number;
    warningTop?: number;
    cardsTop: number;
    cards: ExportLayoutCard[];
    barsTop: number;
    bars: ExportLayoutBar[];
  };

  table: {
    titleTop: number;
    headTop: number;
    firstRowTop: number;
    totalRowTop: number;
  };

  ranking?: {
    titleTop: number;
    totalTop: number;
    pieTop: number;
    pieCX: number;
    pieCY: number;
    pieR: number;
    legend: ExportLayoutLegendItem[];
  };

  columns: ExportLayoutColumn[];
  rows: ExportLayoutRowMeta[];
};

/** measureText で maxWidth を超える text を末尾 … で 1 行に収める。 */
export function ellipsize(
  measure: MeasureText,
  text: string,
  maxWidth: number,
  font: string,
): string {
  if (maxWidth <= 0) return "";
  if (measure(text, font) <= maxWidth) return text;
  const ell = "…";
  if (measure(ell, font) > maxWidth) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid) + ell, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ell;
}

export function layoutColumns(
  columns: ExportColumn[],
  contentX: number,
  contentWidth: number,
  font: string,
  measure: MeasureText,
): ExportLayoutColumn[] {
  const n = columns.length;
  const available = contentWidth - COL_GAP * (n - 1);
  const sumFr = columns.reduce((s, c) => s + COLUMN_FR[c.key], 0);
  const result: ExportLayoutColumn[] = [];
  let x = contentX;
  for (const c of columns) {
    const width = (COLUMN_FR[c.key] / sumFr) * available;
    result.push({
      key: c.key,
      x,
      width,
      align: c.align,
      displayLabel: ellipsize(measure, c.label, width - CELL_PAD * 2, font),
    });
    x += width + COL_GAP;
  }
  return result;
}

function layoutCards(
  count: number,
  keys: Array<"boost" | "unused" | "normal" | "shards">,
  contentX: number,
  contentWidth: number,
  top: number,
): ExportLayoutCard[] {
  const available = contentWidth - CARD_GAP * (count - 1);
  const weights = keys.map((k) => (k === "shards" ? 1.3 : 1));
  const sum = weights.reduce((s, w) => s + w, 0);
  const cards: ExportLayoutCard[] = [];
  let x = contentX;
  for (let i = 0; i < count; i++) {
    const width = (weights[i] / sum) * available;
    cards.push({ x, width, top });
    x += width + CARD_GAP;
  }
  return cards;
}

function computeRowMeta(
  rows: ExportModelRow[],
  nameColWidth: number,
  fonts: ExportFonts,
  measure: MeasureText,
): ExportLayoutRowMeta[] {
  return rows.map((r) => {
    let natureBadgeWidth = 0;
    if (r.natureLabel) {
      natureBadgeWidth = measure(r.natureLabel, fonts.cellNature) + BADGE_PAD_X * 2;
    }
    const budget =
      nameColWidth - CELL_PAD - (natureBadgeWidth > 0 ? natureBadgeWidth + BADGE_GAP : 0);
    return {
      displayName: ellipsize(measure, r.name, budget, fonts.cellName),
      natureLabel: r.natureLabel,
      natureBadgeWidth,
    };
  });
}

function computeCanvasSize(logicalWidth: number, logicalHeight: number) {
  const W = logicalWidth;
  const H = logicalHeight;
  const area = W * H;
  const maxByArea = Math.sqrt(MAX_CANVAS_AREA / area);
  const limit = Math.min(maxByArea, MAX_CANVAS_SIDE / W, MAX_CANVAS_SIDE / H);
  const requestedScale = Math.min(TARGET_SCALE, limit);
  let scale = requestedScale;
  let oversize = false;
  if (scale < 1) {
    // scale 1 でも制限に収まらない。行を切り捨てず image_too_large として扱う。
    oversize = true;
    scale = 1;
  }
  // round() は両辺を切り上げた時に面積上限をわずかに超え得るため floor() する。
  const pixelWidth = Math.max(1, Math.floor(W * scale));
  const pixelHeight = Math.max(1, Math.floor(H * scale));
  if (!oversize) {
    // floor 後の実pixelへ収まるscaleを使い、右端・下端の部分pixel切れも防ぐ。
    scale = Math.min(pixelWidth / W, pixelHeight / H);
  }
  return { scale, pixelWidth, pixelHeight, oversize };
}

export function computeExportImageLayout(
  model: ExportImageModel,
  style: ExportImageStyle,
  measure: MeasureText,
): ExportImageLayout {
  const contentX = PAD_X;
  const contentWidth = LOGICAL_WIDTH - PAD_X * 2;
  const fonts = buildFonts(style);

  const columns = layoutColumns(
    model.columns,
    contentX,
    contentWidth,
    fonts.tableHead,
    measure,
  );
  const nameCol = columns.find((c) => c.key === "name")!;
  const rows = computeRowMeta(model.rows, nameCol.width, fonts, measure);

  let y = HEADER_H + GAP_AFTER_HEADER;

  // ── resources section ──
  const resourcesTitleTop = y;
  y += SECTION_TITLE_BLOCK;
  let warningTop: number | undefined;
  if (model.noStockWarning) {
    warningTop = y;
    y += WARNING_H;
  }
  const cardsTop = y;
  const cards = layoutCards(
    model.statCards.length,
    model.statCards.map((c) => c.key),
    contentX,
    contentWidth,
    cardsTop,
  );
  y += CARD_H + CARDS_MARGIN_BELOW;
  const barsTop = y;
  const bars: ExportLayoutBar[] = model.bars.map((_, i) => ({
    top: barsTop + i * (BAR_BLOCK_H + BAR_GAP),
  }));
  y += model.bars.length * BAR_BLOCK_H + Math.max(0, model.bars.length - 1) * BAR_GAP;
  y += SECTION_GAP;

  // ── list (table) section ──
  const listTitleTop = y;
  y += SECTION_TITLE_BLOCK;
  const tableHeadTop = y;
  y += TABLE_HEAD_H;
  const firstRowTop = y;
  y += model.rows.length * ROW_H;
  const totalRowTop = y;
  y += TOTAL_ROW_H;

  // ── ranking section (pie) ──
  let ranking: ExportImageLayout["ranking"];
  if (model.pie) {
    y += SECTION_GAP;
    const rankingTitleTop = y;
    y += SECTION_TITLE_BLOCK;
    const rankingTotalTop = y;
    y += RANKING_TOTAL_H;
    const pieTop = y;

    const pieR = PIE_D / 2;
    const pieCX = contentX + pieR;
    const pieCY = pieTop + pieR;

    // legend 領域の名前列幅（x 位置は renderer 側で LEGEND_* 定数から再構成する）
    const legendW = contentWidth - PIE_D - PIE_LEGEND_GAP;
    const legendNameW = legendW - LEGEND_SWATCH - LEGEND_SWATCH_GAP - LEGEND_PCT_RESERVE - LEGEND_SWATCH_GAP;

    const legend: ExportLayoutLegendItem[] = [];
    let cursor = pieTop;
    for (const slice of model.pie.slices) {
      const hasDetail = Boolean(slice.universalDetail || slice.typeDetail);
      const top = cursor;
      const nameCenterY = top + LEGEND_NAME_H / 2;
      const detailCenterY = hasDetail ? top + LEGEND_NAME_H + LEGEND_DETAIL_H / 2 : undefined;
      legend.push({
        slice,
        displayName: ellipsize(measure, slice.name, legendNameW, fonts.legendName),
        top,
        nameCenterY,
        detailCenterY,
      });
      cursor += LEGEND_NAME_H + (hasDetail ? LEGEND_DETAIL_H : 0);
    }
    const legendHeight = cursor - pieTop;
    const pieBlockHeight = Math.max(PIE_D, legendHeight);
    y = pieTop + pieBlockHeight;

    ranking = {
      titleTop: rankingTitleTop,
      totalTop: rankingTotalTop,
      pieTop,
      pieCX,
      pieCY,
      pieR,
      legend,
    };
  }

  y += PAD_BOTTOM;
  const logicalHeight = Math.ceil(y);

  const { scale, pixelWidth, pixelHeight, oversize } = computeCanvasSize(
    LOGICAL_WIDTH,
    logicalHeight,
  );

  return {
    logicalWidth: LOGICAL_WIDTH,
    logicalHeight,
    scale,
    pixelWidth,
    pixelHeight,
    oversize,
    contentX,
    contentWidth,
    fonts,
    headerHeight: HEADER_H,
    resources: { titleTop: resourcesTitleTop, warningTop, cardsTop, cards, barsTop, bars },
    table: { titleTop: listTitleTop, headTop: tableHeadTop, firstRowTop, totalRowTop },
    ranking,
    columns,
    rows,
  };
}
