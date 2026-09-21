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
import {
  EXPORT_NATURE_MARK_WIDTH,
  type ExportNatureTone,
} from "./exportNatureMark";
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
export const TITLE_MARGIN_BELOW = 12;
export const SECTION_TITLE_BLOCK = TITLE_TEXT_H + TITLE_MARGIN_BELOW;

export const WARNING_H = 30;

export const CARD_H = 74;
export const CARD_GAP = 10;
export const CARDS_MARGIN_BELOW = 32;

export const BAR_BLOCK_H = 38;
export const BAR_HEAD_H = 20;
export const BAR_TRACK_H = 14;
export const BAR_GAP = 14;
export const BARS_MARGIN_BELOW = 32;

export const SECTION_GAP = 22;

export const COL_GAP = 0;
export const TABLE_HEAD_H = 38;
export const TABLE_HEAD_MULTILINE_H = 50;
export const TABLE_HEAD_LINE_H = 18;
/** 2行見出しの右端が罫線へ近づきすぎないための左右余白。 */
export const TABLE_HEAD_MULTILINE_PAD_X = 10;
export const ROW_H = 42;
export const TOTAL_ROW_H = 46;
export const CELL_PAD = 6;
export const NAME_CELL_PAD = 10;
/** 睡眠育成を含むLv表記で、端末のフォント幅にかかわらず確保する左右余白。 */
export const LV_CELL_PAD = 10;
export const BADGE_PAD_X = 6;
export const BADGE_GAP = 8;

export const RANKING_TOTAL_H = 32;
/** ランキング本文を見出しより少し内側へ入れる。 */
export const RANKING_CONTENT_PAD_X = 12;
export const PIE_MARGIN_TOP = 12;
export const PIE_D = 144;
/** ドーナツの外半径に対する穴の半径比。SVG と Canvas で共有する。 */
export const PIE_HOLE_RATIO = 0.56;
/** フォントの見た目上の重心を補正する中央数値の下方向オフセット。 */
export const PIE_CENTER_VALUE_OFFSET_Y = 2;
export const PIE_LEGEND_GAP = 24;
export const LEGEND_SWATCH = 14;
export const LEGEND_SWATCH_GAP = 8;
/** ランキングの割合表示と、左右の名前・アイテム内訳との間隔。 */
export const LEGEND_INLINE_GAP = 14;
export const LEGEND_ITEM_H = 30;
export const LEGEND_DETAIL_CHIP_PAD_X = 6;
export const LEGEND_DETAIL_VALUE_GAP = 4;
export const LEGEND_DETAIL_GROUP_GAP = 10;

// ── フォント（layout の measure と renderer の描画で同じ文字列を使う）──────────
export type ExportFonts = {
  brandProduct: string;
  brand: string;
  month: string;
  monthYear: string;
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
  pieCenterValue: string;
};

function fontString(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}

/** 画像内の役割別ウェイト。フォントの事前読込でもこの一覧を共有する。 */
export const EXPORT_FONT_WEIGHTS = {
  regular: 550,
  strong: 650,
  emphasis: 750,
  display: 800,
} as const;

export const EXPORT_FONT_WEIGHT_VALUES = Object.values(EXPORT_FONT_WEIGHTS);

export function buildFonts(style: ExportImageStyle): ExportFonts {
  const body = style.bodyFontFamily;
  const head = style.headingFontFamily;
  const weight = EXPORT_FONT_WEIGHTS;
  return {
    brandProduct: fontString(weight.strong, 13, head),
    brand: fontString(weight.display, 29, head),
    month: fontString(weight.display, 27, head),
    monthYear: fontString(weight.strong, 14, head),
    sectionTitle: fontString(weight.strong, 21, head),
    warning: fontString(weight.strong, 17, body),
    cardLabel: fontString(weight.strong, 13, body),
    cardValue: fontString(weight.emphasis, 29, head),
    barLabel: fontString(weight.regular, 15, body),
    barCap: fontString(weight.regular, 15, body),
    tableHead: fontString(weight.strong, 15, body),
    cellName: fontString(weight.strong, 17, body),
    cellNature: fontString(weight.regular, 12, body),
    cellLv: fontString(weight.regular, 17, body),
    cellNum: fontString(weight.regular, 17, body),
    totalNum: fontString(weight.strong, 17, body),
    rankingTotalLabel: fontString(weight.strong, 15, body),
    rankingTotalItem: fontString(weight.regular, 17, body),
    legendName: fontString(weight.strong, 17, body),
    legendPct: fontString(weight.strong, 18, head),
    legendDetail: fontString(weight.regular, 15, body),
    pieCenterValue: fontString(weight.emphasis, 25, head),
  };
}

export type SleepLevelLineLayout = {
  levelFont: string;
  sleepMarkFont: string;
  candyWidth: number;
  sleepMarkWidth: number;
  sleepLevelWidth: number;
  totalWidth: number;
};

function scaleFont(font: string, scale: number): string {
  return font.replace(/([\d.]+)px/, (_match, size: string) => `${Number(size) * scale}px`);
}

/** 睡眠育成込みのLv表記を、左右余白を除いた幅へ端末フォントごとに収める。 */
export function fitSleepLevelLine(
  candyLevels: string,
  sleepLevel: string,
  maxWidth: number,
  levelFont: string,
  sleepMarkFont: string,
  measure: MeasureText,
): SleepLevelLineLayout {
  const sleepMark = "zzZ";
  const gapBeforeMark = 7;
  const gapBeforeLevel = 4;
  const fixedGapWidth = gapBeforeMark + gapBeforeLevel;
  const baseTextWidth = measure(candyLevels, levelFont)
    + measure(sleepMark, sleepMarkFont)
    + measure(sleepLevel, levelFont);
  const scale = baseTextWidth > 0
    ? Math.min(1, Math.max(0, maxWidth - fixedGapWidth) / baseTextWidth)
    : 1;
  const fittedLevelFont = scaleFont(levelFont, scale);
  const fittedSleepMarkFont = scaleFont(sleepMarkFont, scale);
  const candyWidth = measure(candyLevels, fittedLevelFont);
  const sleepMarkWidth = measure(sleepMark, fittedSleepMarkFont);
  const sleepLevelWidth = measure(sleepLevel, fittedLevelFont);
  return {
    levelFont: fittedLevelFont,
    sleepMarkFont: fittedSleepMarkFont,
    candyWidth,
    sleepMarkWidth,
    sleepLevelWidth,
    totalWidth: candyWidth + fixedGapWidth + sleepMarkWidth + sleepLevelWidth,
  };
}

export type MeasureText = (text: string, font: string) => number;

/** 列幅の fr 比。model.columns（mode により 6/4 列）からそのまま列を作る。 */
const COLUMN_FR: Record<ExportColumn["key"], number> = {
  name: 2.25,
  lv: 1.5,
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
  /** 固定列幅に収まる描画用見出し。英語は単語境界で最大2行にする。 */
  displayLines: string[];
};

/** 見出しを単語境界で最大2行に収める。分割できない言語は従来どおり1行省略。 */
function wrapColumnLabel(
  measure: MeasureText,
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  const words = text.trim().split(/\s+/);
  let best: { lines: [string, string]; imbalance: number } | undefined;
  for (let split = 1; split < words.length; split += 1) {
    const first = words.slice(0, split).join(" ");
    const second = words.slice(split).join(" ");
    const firstWidth = measure(first, font);
    const secondWidth = measure(second, font);
    if (firstWidth > maxWidth || secondWidth > maxWidth) continue;
    const imbalance = Math.abs(firstWidth - secondWidth);
    if (!best || imbalance < best.imbalance) {
      best = { lines: [first, second], imbalance };
    }
  }

  if (best) return best.lines;
  return [ellipsize(measure, text, maxWidth, font)];
}

export type ExportLayoutRowMeta = {
  displayName: string;
  natureLabel?: string;
  natureTone?: ExportNatureTone;
  natureBadgeWidth: number;
};

export type ExportLayoutLegendItem = {
  slice: ExportPieSlice;
  displayName: string;
  top: number;
  nameCenterY: number;
};

export type ExportLayoutCard = {
  x: number;
  width: number;
  top: number;
};

export type ExportLayoutBar = { top: number };

export type ExportLegendDetailPart = { label: string; value: string };

/** `万能 S124 / M25` のような内訳を、チップと値へ分ける。 */
export function splitLegendDetail(detail?: string): ExportLegendDetailPart | undefined {
  if (!detail) return undefined;
  const separator = detail.indexOf(" ");
  if (separator < 0) return { label: detail, value: "" };
  return {
    label: detail.slice(0, separator),
    value: detail.slice(separator + 1),
  };
}

function measureLegendDetails(
  slice: ExportPieSlice,
  font: string,
  measure: MeasureText,
): number {
  const parts = [
    splitLegendDetail(slice.universalDetail),
    splitLegendDetail(slice.typeDetail),
  ].filter((part): part is ExportLegendDetailPart => part !== undefined);
  return parts.reduce((width, part, index) => width
    + (index > 0 ? LEGEND_DETAIL_GROUP_GAP : 0)
    + measure(part.label, font)
    + LEGEND_DETAIL_CHIP_PAD_X * 2
    + (part.value ? LEGEND_DETAIL_VALUE_GAP + measure(part.value, font) : 0), 0);
}

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
    headHeight: number;
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
    legendNameWidth: number;
    legendPctWidth: number;
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
    const labelWidth = width - CELL_PAD * 2;
    result.push({
      key: c.key,
      x,
      width,
      align: c.align,
      displayLines: wrapColumnLabel(measure, c.label, labelWidth, font),
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
      natureBadgeWidth = (r.natureTone ? EXPORT_NATURE_MARK_WIDTH : measure(r.natureLabel, fonts.cellNature)) + BADGE_PAD_X * 2;
    }
    const budget =
      nameColWidth - NAME_CELL_PAD - (natureBadgeWidth > 0 ? natureBadgeWidth + BADGE_GAP : 0);
    return {
      displayName: ellipsize(measure, r.name, budget, fonts.cellName),
      natureLabel: r.natureLabel,
      natureTone: r.natureTone,
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
  y += BARS_MARGIN_BELOW;

  // ── list (table) section ──
  const listTitleTop = y;
  y += SECTION_TITLE_BLOCK;
  const tableHeadTop = y;
  const tableHeadHeight = columns.some((column) => column.displayLines.length > 1)
    ? TABLE_HEAD_MULTILINE_H
    : TABLE_HEAD_H;
  y += tableHeadHeight;
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
    y += PIE_MARGIN_TOP;
    const pieTop = y;

    // 名前・%・アメ内訳を1行に並べる。%と内訳を先に確保し、長い名前だけ省略する。
    const pieR = PIE_D / 2;
    const pieCX = contentX + RANKING_CONTENT_PAD_X + pieR;
    const legendW = contentWidth - RANKING_CONTENT_PAD_X - PIE_D - PIE_LEGEND_GAP;
    const legendPctWidth = Math.max(...model.pie.slices.map((slice) =>
      measure(`${slice.displayPct}%`, fonts.legendPct)));
    const legendDetailWidth = Math.max(0, ...model.pie.slices.map((slice) =>
      measureLegendDetails(slice, fonts.legendDetail, measure)));
    const desiredNameWidth = Math.max(...model.pie.slices.map((slice) =>
      measure(slice.name, fonts.legendName)));
    const fixedWidth = LEGEND_SWATCH
      + LEGEND_SWATCH_GAP
      + legendPctWidth
      + LEGEND_INLINE_GAP * 2
      + legendDetailWidth;
    const legendNameWidth = Math.min(desiredNameWidth, Math.max(0, legendW - fixedWidth));
    const legendHeight = model.pie.slices.length * LEGEND_ITEM_H;
    const pieBlockHeight = Math.max(PIE_D, legendHeight);
    const legendTop = pieTop + (pieBlockHeight - legendHeight) / 2;
    const pieCY = pieTop + pieBlockHeight / 2;

    const legend: ExportLayoutLegendItem[] = [];
    let cursor = legendTop;
    for (const slice of model.pie.slices) {
      const top = cursor;
      const nameCenterY = top + LEGEND_ITEM_H / 2;
      legend.push({
        slice,
        displayName: ellipsize(measure, slice.name, legendNameWidth, fonts.legendName),
        top,
        nameCenterY,
      });
      cursor += LEGEND_ITEM_H;
    }
    y = pieTop + pieBlockHeight;

    ranking = {
      titleTop: rankingTitleTop,
      totalTop: rankingTotalTop,
      pieTop,
      pieCX,
      pieCY,
      pieR,
      legendNameWidth,
      legendPctWidth,
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
    table: {
      titleTop: listTitleTop,
      headTop: tableHeadTop,
      headHeight: tableHeadHeight,
      firstRowTop,
      totalRowTop,
    },
    ranking,
    columns,
    rows,
  };
}
