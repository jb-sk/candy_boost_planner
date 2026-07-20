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
  computeExportImageLayout,
  type ExportImageLayout,
  BAR_HEAD_H,
  BAR_TRACK_H,
  CARD_H,
  CELL_PAD,
  LEGEND_SWATCH,
  LEGEND_SWATCH_GAP,
  PIE_D,
  PIE_LEGEND_GAP,
  RANKING_TOTAL_H,
  ROW_H,
  TABLE_HEAD_H,
  TITLE_TEXT_H,
  TITLE_UNDERLINE_GAP,
  TOTAL_ROW_H,
  WARNING_H,
} from "./exportImageLayout";
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

const CARD_PAD_X = 12;
const CARD_LABEL_TOP = 12;
const CARD_VALUE_BASELINE_FROM_BOTTOM = 14;
const BADGE_H = 18;

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

function hLine(ctx: Ctx, x1: number, x2: number, y: number, color: string, width: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
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
  ctx.fillText(s, x, y);
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
  ctx.fillStyle = style.sectionBackground;
  ctx.fillRect(0, 0, layout.logicalWidth, layout.headerHeight);
  const midY = layout.headerHeight / 2;
  drawText(ctx, model.brandLabel, layout.contentX, midY, layout.fonts.brand, style.ink, "left", "middle");
  drawText(
    ctx,
    model.monthLabel,
    layout.logicalWidth - layout.contentX,
    midY,
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
  drawText(
    ctx,
    label,
    layout.contentX,
    titleTop + TITLE_TEXT_H / 2,
    layout.fonts.sectionTitle,
    style.accent,
    "left",
    "middle",
  );
  const underlineY = titleTop + TITLE_TEXT_H + TITLE_UNDERLINE_GAP;
  hLine(ctx, layout.contentX, layout.contentX + layout.contentWidth, underlineY, style.accent, 2, 0.25);
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
    fillRoundRect(ctx, rect.x, rect.top, rect.width, CARD_H, 8, isDanger ? style.danger : style.ink, isDanger ? 0.08 : 0.04);
    drawText(
      ctx,
      card.label,
      rect.x + CARD_PAD_X,
      rect.top + CARD_LABEL_TOP,
      layout.fonts.cardLabel,
      style.muted,
      "left",
      "top",
    );
    drawText(
      ctx,
      card.value,
      rect.x + CARD_PAD_X,
      rect.top + CARD_H - CARD_VALUE_BASELINE_FROM_BOTTOM,
      layout.fonts.cardValue,
      isDanger ? style.danger : style.ink,
      "left",
      "alphabetic",
    );
  });

  // bars
  model.bars.forEach((bar, i) => {
    const top = r.bars[i].top;
    const headMid = top + BAR_HEAD_H / 2;
    drawText(ctx, bar.usageLabel, layout.contentX, headMid, layout.fonts.barLabel, style.ink, "left", "middle");
    drawText(
      ctx,
      bar.capLabel,
      layout.contentX + layout.contentWidth,
      headMid,
      layout.fonts.barCap,
      style.muted,
      "right",
      "middle",
    );
    const trackY = top + BAR_HEAD_H + 4;
    fillRoundRect(ctx, layout.contentX, trackY, layout.contentWidth, BAR_TRACK_H, BAR_TRACK_H / 2, style.barTrack);
    const fillW = (layout.contentWidth * bar.fillPct) / 100;
    if (fillW > 0) {
      fillRoundRect(ctx, layout.contentX, trackY, fillW, BAR_TRACK_H, BAR_TRACK_H / 2, style.barFill);
    }
  });
}

function drawColumnLabelX(col: ExportImageLayout["columns"][number]): number {
  if (col.align === "left") return col.x + CELL_PAD;
  if (col.align === "right") return col.x + col.width - CELL_PAD;
  return col.x + col.width / 2;
}

function drawTable(ctx: Ctx, model: ExportImageModel, layout: ExportImageLayout, style: ExportImageStyle): void {
  const tb = layout.table;
  drawSectionTitle(ctx, layout, style, tb.titleTop, model.sectionLabels.list);

  // header
  const headMid = tb.headTop + TABLE_HEAD_H / 2;
  layout.columns.forEach((col) => {
    drawText(
      ctx,
      col.displayLabel,
      drawColumnLabelX(col),
      headMid,
      layout.fonts.tableHead,
      style.muted,
      col.align,
      "middle",
    );
  });
  hLine(ctx, layout.contentX, layout.contentX + layout.contentWidth, tb.headTop + TABLE_HEAD_H, style.ink, 2);

  const nameCol = layout.columns.find((c) => c.key === "name")!;
  const lvCol = layout.columns.find((c) => c.key === "lv")!;

  // data rows
  model.rows.forEach((row, i) => {
    const top = tb.firstRowTop + i * ROW_H;
    const midY = top + ROW_H / 2;
    const meta = layout.rows[i];

    // name + nature badge
    const nameX = nameCol.x + CELL_PAD;
    drawText(ctx, meta.displayName, nameX, midY, layout.fonts.cellName, style.ink, "left", "middle");
    if (meta.natureLabel && meta.natureBadgeWidth > 0) {
      ctx.font = layout.fonts.cellName;
      const nameW = ctx.measureText(meta.displayName).width;
      const badgeX = nameX + nameW + 8;
      fillRoundRect(ctx, badgeX, midY - BADGE_H / 2, meta.natureBadgeWidth, BADGE_H, 4, style.ink, 0.06);
      drawText(
        ctx,
        meta.natureLabel,
        badgeX + meta.natureBadgeWidth / 2,
        midY,
        layout.fonts.cellNature,
        style.muted,
        "center",
        "middle",
      );
    }

    // lv
    drawText(
      ctx,
      `${row.srcLevel} → ${row.dstLevel}`,
      lvCol.x + lvCol.width / 2,
      midY,
      layout.fonts.cellLv,
      style.ink,
      "center",
      "middle",
    );

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

    hLine(ctx, layout.contentX, layout.contentX + layout.contentWidth, top + ROW_H, style.ink, 1, 0.08);
  });

  // total row
  const tTop = tb.totalRowTop;
  fillRoundRect(ctx, layout.contentX, tTop, layout.contentWidth, TOTAL_ROW_H, 0, style.ink, 0.04);
  hLine(ctx, layout.contentX, layout.contentX + layout.contentWidth, tTop, style.ink, 2);
  const tMid = tTop + TOTAL_ROW_H / 2;
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
}

function drawRanking(ctx: Ctx, model: ExportImageModel, layout: ExportImageLayout, style: ExportImageStyle): void {
  if (!model.pie || !layout.ranking) return;
  const rk = layout.ranking;
  drawSectionTitle(ctx, layout, style, rk.titleTop, model.sectionLabels.ranking);

  // total line: "合計" + 万能アメS/M/L
  const totalMid = rk.totalTop + RANKING_TOTAL_H / 2;
  drawText(ctx, model.pie.title, layout.contentX, totalMid, layout.fonts.rankingTotalLabel, style.muted, "left", "middle");
  ctx.font = layout.fonts.rankingTotalLabel;
  let x = layout.contentX + ctx.measureText(model.pie.title).width + 16;
  ctx.font = layout.fonts.rankingTotalItem;
  for (const label of model.pie.totalLabels) {
    drawText(ctx, label, x, totalMid, layout.fonts.rankingTotalItem, style.ink, "left", "middle");
    x += ctx.measureText(label).width + 16;
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
    ctx.strokeStyle = style.paper;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // legend
  const legendX = layout.contentX + PIE_D + PIE_LEGEND_GAP;
  const nameX = legendX + LEGEND_SWATCH + LEGEND_SWATCH_GAP;
  const pctRightX = layout.contentX + layout.contentWidth;
  for (const item of rk.legend) {
    const color = style.pie[item.slice.colorIndex];
    fillRoundRect(ctx, legendX, item.nameCenterY - LEGEND_SWATCH / 2, LEGEND_SWATCH, LEGEND_SWATCH, 3, color);
    drawText(ctx, item.displayName, nameX, item.nameCenterY, layout.fonts.legendName, style.ink, "left", "middle");
    drawText(
      ctx,
      `${item.slice.displayPct}%`,
      pctRightX,
      item.nameCenterY,
      layout.fonts.legendPct,
      style.ink,
      "right",
      "middle",
    );
    if (item.detailCenterY !== undefined) {
      const details = [item.slice.universalDetail, item.slice.typeDetail].filter(Boolean).join("    ");
      if (details) {
        drawText(ctx, details, nameX, item.detailCenterY, layout.fonts.legendDetail, style.ink, "left", "middle");
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
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
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
