/**
 * renderExportImage — ExportImageModel を Canvas 2D へ直接描画する。
 *
 * DOM を変更せず、rect / roundRect相当 / line / text / arc だけを使う。
 * native roundRect には依存せず path helper を持つ。debug 用に canvas を body へ
 * append する分岐は入れない。
 */

import type {
  ExportColumn,
  ExportImageModel,
  ExportModelRow,
  ExportModelTotalRow,
} from "./exportImageModel";
import {
  BAR_BLOCK_H,
  BAR_HEAD_H,
  BAR_TRACK_H,
  CARD_H,
  CELL_PAD,
  LEGEND_SWATCH,
  LEGEND_SWATCH_GAP,
  LEGEND_DETAIL_CHIP_PAD_X,
  LEGEND_DETAIL_GROUP_GAP,
  LEGEND_DETAIL_VALUE_GAP,
  LEGEND_INLINE_GAP,
  LV_CELL_PAD,
  NAME_CELL_PAD,
  PIE_D,
  PIE_HOLE_RATIO,
  PIE_LEGEND_GAP,
  RANKING_CONTENT_PAD_X,
  RANKING_TOTAL_H,
  ROW_H,
  TABLE_HEAD_H,
  TABLE_HEAD_LINE_H,
  TABLE_HEAD_MULTILINE_PAD_X,
  TITLE_TEXT_H,
  TOTAL_ROW_H,
  WARNING_H,
  computeExportImageLayout,
  fitSleepLevelLine,
  splitLegendDetail,
  type ExportImageLayout,
} from "./exportImageLayout";
import {
  EXPORT_NATURE_MARK_HEIGHT,
  EXPORT_NATURE_MARK_TRIANGLES,
  EXPORT_NATURE_MARK_WIDTH,
  type ExportNatureTone,
} from "./exportNatureMark";
import { readExportImageStyle, type ExportImageStyle } from "./exportImageStyle";

export type ExportImageErrorReason = "image_too_large" | "no_context" | "zero_size";

export class ExportImageError extends Error {
  reason: ExportImageErrorReason;
  constructor(reason: ExportImageErrorReason) {
    super(`export image render failed: ${reason}`);
    this.name = "ExportImageError";
    this.reason = reason;
  }
}

type Ctx = CanvasRenderingContext2D;

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
/** M PLUS 2 の字面を意匠上やや詰める、画像専用の横幅補正。 */
const TEXT_WIDTH_SCALE = 0.97;
/** Canvas の middle baseline では追加の上下補正は不要。 */
const PIE_IMAGE_CENTER_VALUE_OFFSET_Y = 0;

const CARD_PAD_X = 16;
const CARD_LABEL_BASELINE_FROM_TOP = 24;
const CARD_VALUE_BASELINE_FROM_BOTTOM = 16;
const BADGE_H = 18;
const BAR_PANEL_PAD_X = 20;
const BAR_PANEL_PAD_Y = 16;

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function fillRoundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  alpha = 1,
): void {
  if (w <= 0 || h <= 0) return;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function line(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function fillCircle(ctx: Ctx, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawText(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(TEXT_WIDTH_SCALE, 1);
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

function measureTextWidth(ctx: Ctx, text: string, font: string): number {
  ctx.font = font;
  return ctx.measureText(text).width * TEXT_WIDTH_SCALE;
}

function drawNatureMark(
  ctx: Ctx,
  tone: ExportNatureTone,
  centerX: number,
  centerY: number,
  color: string,
): void {
  const left = centerX - EXPORT_NATURE_MARK_WIDTH / 2;
  const top = centerY - EXPORT_NATURE_MARK_HEIGHT / 2;

  ctx.beginPath();
  for (const [first, second, third] of EXPORT_NATURE_MARK_TRIANGLES[tone]) {
    ctx.moveTo(left + first.x, top + first.y);
    ctx.lineTo(left + second.x, top + second.y);
    ctx.lineTo(left + third.x, top + third.y);
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill();
}

function cellValue(row: ExportModelRow | ExportModelTotalRow, key: ExportColumn["key"]): string {
  switch (key) {
    case "boost":
      return row.boostCandy ?? "";
    case "normal":
      return row.normalCandy ?? "";
    case "total":
      return row.totalCandy;
    case "shards":
      return row.shards;
    default:
      return "";
  }
}

function drawHeader(ctx: Ctx, model: ExportImageModel, layout: ExportImageLayout, style: ExportImageStyle): void {
  ctx.fillStyle = style.paper;
  ctx.fillRect(0, 0, layout.logicalWidth, layout.headerHeight);
  line(ctx, 0, layout.headerHeight, layout.logicalWidth, layout.headerHeight, style.accentTint, 0.24);
  const midY = layout.headerHeight / 2;
  drawText(ctx, model.brandProduct, layout.contentX, midY - 13, layout.fonts.brandProduct, style.highlight, "left", "middle");
  drawText(ctx, model.planLabel, layout.contentX, midY + 13, layout.fonts.brand, style.ink, "left", "middle");
  const metaRight = layout.logicalWidth - layout.contentX;
  drawText(
    ctx,
    model.appName,
    metaRight,
    midY - 13,
    layout.fonts.brandProduct,
    style.highlight,
    "right",
    "middle",
  );
  const monthWidth = measureTextWidth(ctx, model.monthPartLabel, layout.fonts.month);
  drawText(
    ctx,
    model.yearPartLabel,
    metaRight - monthWidth - 7,
    midY + 14,
    layout.fonts.monthYear,
    style.muted,
    "right",
    "middle",
  );
  drawText(
    ctx,
    model.monthPartLabel,
    metaRight,
    midY + 12,
    layout.fonts.month,
    style.ink,
    "right",
    "middle",
  );
}

function drawSectionTitle(
  ctx: Ctx,
  layout: ExportImageLayout,
  style: ExportImageStyle,
  titleTop: number,
  label: string,
): void {
  fillRoundRect(ctx, layout.contentX, titleTop + 5, 7, 20, 4, style.highlight);
  drawText(
    ctx,
    label,
    layout.contentX + 15,
    titleTop + TITLE_TEXT_H / 2,
    layout.fonts.sectionTitle,
    style.ink,
    "left",
    "middle",
  );
}

function drawResources(ctx: Ctx, model: ExportImageModel, layout: ExportImageLayout, style: ExportImageStyle): void {
  const r = layout.resources;
  drawSectionTitle(ctx, layout, style, r.titleTop, model.sectionLabels.resources);

  if (model.noStockWarning && r.warningTop !== undefined) {
    drawText(
      ctx,
      model.noStockWarning,
      layout.contentX,
      r.warningTop + WARNING_H / 2,
      layout.fonts.warning,
      style.danger,
      "left",
      "middle",
    );
  }

  // stat cards
  model.statCards.forEach((card, i) => {
    const rect = r.cards[i];
    const isDanger = card.variant === "danger";
    const cardColor = {
      accent: style.statCardAccent,
      plain: style.statCardPlain,
      primary: style.statCardPrimary,
      danger: style.statCardDanger,
    }[card.variant];
    fillRoundRect(ctx, rect.x, rect.top, rect.width, CARD_H, 12, cardColor);
    drawText(
      ctx,
      card.label,
      rect.x + CARD_PAD_X,
      rect.top + CARD_LABEL_BASELINE_FROM_TOP,
      layout.fonts.cardLabel,
      style.statCardLabel,
      "left",
      "alphabetic",
    );
    drawText(
      ctx,
      card.value,
      rect.x + CARD_PAD_X,
      rect.top + CARD_H - CARD_VALUE_BASELINE_FROM_BOTTOM,
      layout.fonts.cardValue,
      isDanger ? style.statCardDangerInk : style.statCardInk,
      "left",
      "alphabetic",
    );
  });

  // bars: 上下に余白を持つ1つの領域へまとめる。
  if (model.bars.length > 0) {
    const lastBarTop = r.bars[r.bars.length - 1].top;
    const panelTop = r.barsTop - BAR_PANEL_PAD_Y;
    const panelHeight = lastBarTop + BAR_BLOCK_H - r.barsTop + BAR_PANEL_PAD_Y * 2;
    fillRoundRect(
      ctx,
      layout.contentX,
      panelTop,
      layout.contentWidth,
      panelHeight,
      8,
      style.accentTint,
      0.055,
    );
  }
  model.bars.forEach((bar, i) => {
    const top = r.bars[i].top;
    const headMid = top + BAR_HEAD_H / 2;
    const barX = layout.contentX + BAR_PANEL_PAD_X;
    const barWidth = layout.contentWidth - BAR_PANEL_PAD_X * 2;
    const barFill = bar.key === "shards" ? style.shardsBarFill : style.barFill;
    const barTrack = bar.key === "shards" ? style.shardsBarTrack : style.barTrack;
    drawText(ctx, bar.usageLabel, barX, headMid, layout.fonts.barLabel, style.ink, "left", "middle");
    drawText(
      ctx,
      bar.capLabel,
      barX + barWidth,
      headMid,
      layout.fonts.barCap,
      style.muted,
      "right",
      "middle",
    );
    const trackY = top + BAR_HEAD_H + 4;
    // 背景の指定がないテーマは、塗りの色を薄く重ねる（CSS の .exportBar__track と同じ）
    fillRoundRect(ctx, barX, trackY, barWidth, BAR_TRACK_H, BAR_TRACK_H / 2, barTrack ?? barFill, barTrack ? 1 : 0.22);
    const fillW = (barWidth * bar.fillPct) / 100;
    if (fillW > 0) {
      fillRoundRect(
        ctx,
        barX,
        trackY,
        fillW,
        BAR_TRACK_H,
        BAR_TRACK_H / 2,
        barFill,
        style.barFillAlpha,
      );
      // PNG の縮小表示でも白丸がトラック外へ飛び出して見えないよう、
      // 上下に 3px、右端に 3px の色を残す。
      const markerR = 4;
      const markerX = Math.max(
        barX + markerR + 3,
        Math.min(barX + fillW - markerR - 3, barX + barWidth - markerR - 3),
      );
      fillCircle(ctx, markerX, trackY + BAR_TRACK_H / 2, markerR, "#ffffff");
    }
  });
}

function drawColumnLabelX(
  col: ExportImageLayout["columns"][number],
  inlinePadding = CELL_PAD,
): number {
  if (col.key === "name") return col.x + NAME_CELL_PAD;
  if (col.align === "left") return col.x + inlinePadding;
  if (col.align === "right") return col.x + col.width - inlinePadding;
  return col.x + col.width / 2;
}

function drawTable(ctx: Ctx, model: ExportImageModel, layout: ExportImageLayout, style: ExportImageStyle): void {
  const tb = layout.table;
  drawSectionTitle(ctx, layout, style, tb.titleTop, model.sectionLabels.list);

  const tableBottom = tb.totalRowTop + TOTAL_ROW_H;
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = style.accentTint;
  ctx.fillRect(layout.contentX, tb.headTop, layout.contentWidth, tb.headHeight);
  ctx.globalAlpha = 0.11;
  ctx.fillRect(layout.contentX, tb.totalRowTop, layout.contentWidth, TOTAL_ROW_H);
  ctx.restore();

  const headMid = tb.headTop + tb.headHeight / 2;
  const headerInlinePadding = tb.headHeight > TABLE_HEAD_H
    ? TABLE_HEAD_MULTILINE_PAD_X
    : CELL_PAD;
  layout.columns.forEach((col) => {
    const firstLineY = headMid - ((col.displayLines.length - 1) * TABLE_HEAD_LINE_H) / 2;
    col.displayLines.forEach((lineLabel, index) => {
      drawText(
        ctx,
        lineLabel,
        drawColumnLabelX(col, headerInlinePadding),
        firstLineY + index * TABLE_HEAD_LINE_H,
        layout.fonts.tableHead,
        style.muted,
        col.align,
        "middle",
      );
    });
  });

  const nameCol = layout.columns.find((c) => c.key === "name")!;
  const lvCol = layout.columns.find((c) => c.key === "lv")!;

  // data rows
  model.rows.forEach((row, i) => {
    const top = tb.firstRowTop + i * ROW_H;
    const midY = top + ROW_H / 2;
    const meta = layout.rows[i];

    // name + nature badge
    const nameX = drawColumnLabelX(nameCol);
    drawText(ctx, meta.displayName, nameX, midY, layout.fonts.cellName, style.ink, "left", "middle");
    if (meta.natureLabel && meta.natureBadgeWidth > 0) {
      const badgeX = nameCol.x + nameCol.width - NAME_CELL_PAD - meta.natureBadgeWidth;
      const natureColor = meta.natureTone === "up"
        ? style.natureUp
        : meta.natureTone === "down"
          ? style.natureDown
          : style.muted;
      fillRoundRect(ctx, badgeX, midY - BADGE_H / 2, meta.natureBadgeWidth, BADGE_H, 4, natureColor, 0.11);
      if (meta.natureTone) {
        drawNatureMark(ctx, meta.natureTone, badgeX + meta.natureBadgeWidth / 2, midY, natureColor);
      } else {
        drawText(
          ctx,
          meta.natureLabel,
          badgeX + meta.natureBadgeWidth / 2,
          midY,
          layout.fonts.cellNature,
          natureColor,
          "center",
          "middle",
        );
      }
    }

    // Lv: アメ到達地点を表示し、睡眠育成がある行だけ最終目標を zzZ で分ける。
    const candyLevels = `${row.srcLevel} → ${row.candyReachLevel}`;
    if (row.sleepTargetLevel === undefined) {
      drawText(
        ctx,
        candyLevels,
        lvCol.x + lvCol.width / 2,
        midY,
        layout.fonts.cellLv,
        style.ink,
        "center",
        "middle",
      );
    } else {
      const sleepMark = "zzZ";
      const gapBeforeMark = 7;
      const gapBeforeLevel = 4;
      const fitted = fitSleepLevelLine(
        candyLevels,
        row.sleepTargetLevel,
        lvCol.width - LV_CELL_PAD * 2,
        layout.fonts.cellLv,
        layout.fonts.cellNature,
        (text, font) => {
          return measureTextWidth(ctx, text, font);
        },
      );
      let levelX = lvCol.x + (lvCol.width - fitted.totalWidth) / 2;

      drawText(ctx, candyLevels, levelX, midY, fitted.levelFont, style.ink, "left", "middle");
      levelX += fitted.candyWidth + gapBeforeMark;
      drawText(ctx, sleepMark, levelX, midY - 3, fitted.sleepMarkFont, style.accent, "left", "middle");
      levelX += fitted.sleepMarkWidth + gapBeforeLevel;
      drawText(ctx, row.sleepTargetLevel, levelX, midY, fitted.levelFont, style.ink, "left", "middle");
    }

    // numeric columns
    for (const col of layout.columns) {
      if (col.key === "name" || col.key === "lv") continue;
      drawText(
        ctx,
        cellValue(row, col.key),
        col.x + col.width - CELL_PAD,
        midY,
        layout.fonts.cellNum,
        style.ink,
        "right",
        "middle",
      );
    }
  });

  // total row
  const tTop = tb.totalRowTop;
  const tMid = tTop + TOTAL_ROW_H / 2;
  drawText(
    ctx,
    model.sectionLabels.total,
    drawColumnLabelX(nameCol),
    tMid,
    layout.fonts.totalNum,
    style.accent,
    "left",
    "middle",
  );
  for (const col of layout.columns) {
    if (col.key === "name" || col.key === "lv") continue;
    drawText(
      ctx,
      cellValue(model.totalRow, col.key),
      col.x + col.width - CELL_PAD,
      tMid,
      layout.fonts.totalNum,
      style.ink,
      "right",
      "middle",
    );
  }

  // 外枠と全セルの縦横罫線。縦線を含め、一覧を読みやすい通常の表として描く。
  line(ctx, layout.contentX, tb.headTop, layout.contentX + layout.contentWidth, tb.headTop, style.accentTint, 0.38);
  line(ctx, layout.contentX, tb.firstRowTop, layout.contentX + layout.contentWidth, tb.firstRowTop, style.accentTint, 0.38);
  model.rows.forEach((_, i) => {
    const y = tb.firstRowTop + (i + 1) * ROW_H;
    line(ctx, layout.contentX, y, layout.contentX + layout.contentWidth, y, style.accentTint, 0.28);
  });
  line(ctx, layout.contentX, tableBottom, layout.contentX + layout.contentWidth, tableBottom, style.accentTint, 0.38);
  line(ctx, layout.contentX, tb.headTop, layout.contentX, tableBottom, style.accentTint, 0.38);
  layout.columns.forEach((col) => {
    line(ctx, col.x + col.width, tb.headTop, col.x + col.width, tableBottom, style.accentTint, 0.32);
  });
}

function drawRanking(ctx: Ctx, model: ExportImageModel, layout: ExportImageLayout, style: ExportImageStyle): void {
  if (!model.pie || !layout.ranking) return;
  const rk = layout.ranking;
  drawSectionTitle(ctx, layout, style, rk.titleTop, model.sectionLabels.ranking);

  // total line: "合計" + 万能アメS/M/L
  const totalMid = rk.totalTop + RANKING_TOTAL_H / 2;
  const rankingContentX = layout.contentX + RANKING_CONTENT_PAD_X;
  drawText(ctx, model.pie.title, rankingContentX, totalMid, layout.fonts.rankingTotalLabel, style.muted, "left", "middle");
  let x = rankingContentX
    + measureTextWidth(ctx, model.pie.title, layout.fonts.rankingTotalLabel)
    + 16;
  for (const label of model.pie.totalLabels) {
    drawText(ctx, label, x, totalMid, layout.fonts.rankingTotalItem, style.ink, "left", "middle");
    x += measureTextWidth(ctx, label, layout.fonts.rankingTotalItem) + 16;
  }

  // pie
  const single = model.pie.slices.length === 1;
  for (const slice of model.pie.slices) {
    const color = style.pie[slice.colorIndex];
    ctx.beginPath();
    if (single) {
      ctx.arc(rk.pieCX, rk.pieCY, rk.pieR, 0, TAU);
    } else {
      ctx.moveTo(rk.pieCX, rk.pieCY);
      ctx.arc(rk.pieCX, rk.pieCY, rk.pieR, slice.startAngle - HALF_PI, slice.endAngle - HALF_PI, false);
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(rk.pieCX, rk.pieCY, rk.pieR * PIE_HOLE_RATIO, 0, TAU);
  ctx.fillStyle = style.paper;
  ctx.fill();
  drawText(
    ctx,
    model.pie.centerValue,
    rk.pieCX,
    rk.pieCY + PIE_IMAGE_CENTER_VALUE_OFFSET_Y,
    layout.fonts.pieCenterValue,
    style.ink,
    "center",
    "middle",
  );

  // legend
  const legendX = rankingContentX + PIE_D + PIE_LEGEND_GAP;
  const nameX = legendX + LEGEND_SWATCH + LEGEND_SWATCH_GAP;
  const pctX = nameX + rk.legendNameWidth + LEGEND_INLINE_GAP;
  const detailX = pctX + rk.legendPctWidth + LEGEND_INLINE_GAP;
  for (const item of rk.legend) {
    const color = style.pie[item.slice.colorIndex];
    fillRoundRect(ctx, legendX, item.nameCenterY - LEGEND_SWATCH / 2, LEGEND_SWATCH, LEGEND_SWATCH, 3, color);
    drawText(ctx, item.displayName, nameX, item.nameCenterY, layout.fonts.legendName, style.ink, "left", "middle");
    const pct = `${item.slice.displayPct}%`;
    drawText(
      ctx,
      pct,
      pctX + rk.legendPctWidth,
      item.nameCenterY,
      layout.fonts.legendPct,
      style.ink,
      "right",
      "middle",
    );
    const detailParts = [
      splitLegendDetail(item.slice.universalDetail),
      splitLegendDetail(item.slice.typeDetail),
    ].filter((part): part is NonNullable<typeof part> => part !== undefined);
    let groupX = detailX;
    for (const [index, part] of detailParts.entries()) {
      if (index > 0) groupX += LEGEND_DETAIL_GROUP_GAP;
      const chipWidth = measureTextWidth(ctx, part.label, layout.fonts.legendDetail)
        + LEGEND_DETAIL_CHIP_PAD_X * 2;
      fillRoundRect(
        ctx,
        groupX,
        item.nameCenterY - 11,
        chipWidth,
        22,
        6,
        style.highlightTint,
        0.11,
      );
      drawText(
        ctx,
        part.label,
        groupX + chipWidth / 2,
        item.nameCenterY,
        layout.fonts.legendDetail,
        style.muted,
        "center",
        "middle",
      );
      groupX += chipWidth;
      if (part.value) {
        groupX += LEGEND_DETAIL_VALUE_GAP;
        drawText(ctx, part.value, groupX, item.nameCenterY, layout.fonts.legendDetail, style.ink, "left", "middle");
        groupX += measureTextWidth(ctx, part.value, layout.fonts.legendDetail);
      }
    }
  }
}

/** 与えられた（既に scale 済みの）ctx に対しモデルを論理座標で描画する。 */
export function renderExportImage(
  ctx: Ctx,
  model: ExportImageModel,
  layout: ExportImageLayout,
  style: ExportImageStyle,
): void {
  ctx.fillStyle = style.paper;
  ctx.fillRect(0, 0, layout.logicalWidth, layout.logicalHeight);
  drawHeader(ctx, model, layout, style);
  drawResources(ctx, model, layout, style);
  drawTable(ctx, model, layout, style);
  drawRanking(ctx, model, layout, style);
}

/**
 * export sheet 要素からスタイルを読み、ExportImageModel を Canvas へ描画して返す。
 * ブラウザ専用。DOM は sheetEl の getComputedStyle 読取のみ。
 */
export function createExportImageCanvas(
  model: ExportImageModel,
  sheetEl: Element,
  doc: Document = document,
): HTMLCanvasElement {
  const style = readExportImageStyle(sheetEl);
  const canvas = doc.createElement("canvas");
  const measureCtx = canvas.getContext("2d");
  if (!measureCtx) throw new ExportImageError("no_context");

  const measure = (text: string, font: string): number => {
    return measureTextWidth(measureCtx, text, font);
  };

  const layout = computeExportImageLayout(model, style, measure);
  if (layout.oversize) throw new ExportImageError("image_too_large");

  if (
    !Number.isFinite(layout.pixelWidth) ||
    !Number.isFinite(layout.pixelHeight) ||
    layout.pixelWidth < 1 ||
    layout.pixelHeight < 1
  ) {
    throw new ExportImageError("zero_size");
  }

  canvas.width = layout.pixelWidth;
  canvas.height = layout.pixelHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ExportImageError("no_context");
  ctx.scale(layout.scale, layout.scale);

  renderExportImage(ctx, model, layout, style);
  return canvas;
}
