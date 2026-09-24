/**
 * exportImageStyle — 現在テーマの CSS custom property を Canvas 用の色・font へ変換する。
 *
 * `readExportImageStyle(el)` は getComputedStyle を 1 度だけ取得し、DOM の style/class は
 * 一切変更しない。各値に静的 fallback を持たせ、Canvas の fillStyle へ渡す前に
 * 不正な色を既知 fallback へ正規化する（`normalizeColor`）。
 */

export type ExportImageStyle = {
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  /** 線・淡い下地に使うアクセント（--accent-rgb）。文字用の --accent と分けるテーマがある。 */
  accentTint: string;
  /** テーマ固有の補助アクセント。未指定テーマでは accent と同色。 */
  highlight: string;
  /** highlight の淡い下地用（--export-highlight-rgb）。文字用の highlight と分けるテーマがある。 */
  highlightTint: string;
  danger: string;
  natureUp: string;
  natureDown: string;
  sectionBackground: string;
  statCardAccent: string;
  statCardPlain: string;
  statCardPrimary: string;
  statCardDanger: string;
  /** 合計カードの文字色。未指定テーマは muted / ink / danger と同じ。 */
  statCardLabel: string;
  statCardInk: string;
  statCardDangerInk: string;
  barFill: string;
  shardsBarFill: string;
  /** 横棒の背景。未指定（null）なら塗りの色を薄く重ねる。 */
  barTrack: string | null;
  shardsBarTrack: string | null;
  barFillAlpha: number;
  pie: [string, string, string, string, string, string, string, string];
  bodyFontFamily: string;
  headingFontFamily: string;
};

/** DOMのシステムフォントとは分離した、プレビュー画像・保存画像専用フォント。 */
export const EXPORT_IMAGE_FONT_FAMILY = '"M PLUS 2 Variable", sans-serif';

/** base.css の既定値に一致させた静的 fallback。 */
export const FALLBACK_STYLE: ExportImageStyle = {
  paper: "#ffffff",
  ink: "#1e293b",
  muted: "#64748b",
  accent: "#10b981",
  accentTint: "rgb(16, 185, 129)",
  highlight: "#10b981",
  highlightTint: "rgb(16, 185, 129)",
  danger: "#ef4444",
  natureUp: "#dc2626",
  natureDown: "#2563eb",
  sectionBackground: "rgba(30, 41, 59, 0.05)",
  statCardAccent: "rgba(99, 102, 241, 0.075)",
  statCardPlain: "rgba(99, 102, 241, 0.075)",
  statCardPrimary: "rgba(99, 102, 241, 0.075)",
  statCardDanger: "rgba(239, 68, 68, 0.1)",
  statCardLabel: "#64748b",
  statCardInk: "#1e293b",
  statCardDangerInk: "#ef4444",
  barFill: "#ec4899",
  shardsBarFill: "#ec4899",
  barTrack: null,
  shardsBarTrack: null,
  barFillAlpha: 0.62,
  pie: ["#10b981", "#6366f1", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#f97316", "#64748b"],
  bodyFontFamily: EXPORT_IMAGE_FONT_FAMILY,
  headingFontFamily: EXPORT_IMAGE_FONT_FAMILY,
};

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;
const HSL_RE = /^hsla?\(\s*[\d.]+(?:deg|rad|grad|turn)?\s*[, ]\s*[\d.]+%\s*[, ]\s*[\d.]+%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;
const RGB_TRIPLE_RE = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/;

/**
 * Canvas の fillStyle が受け付ける色文字列だけを通し、それ以外は fallback を返す。
 * テーマ変数は hex / rgb(a) / hsl(a) のいずれかで返るため、これらを検証する。
 */
export function normalizeColor(value: string | null | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  if (!v) return fallback;
  if (HEX_RE.test(v) || RGB_RE.test(v) || HSL_RE.test(v)) return v;
  return fallback;
}

/** "--ink-rgb" 相当の "r, g, b" 文字列から rgba(...) を作る。不正なら fallback。 */
export function rgbaFromTriple(triple: string | null | undefined, alpha: number, fallback: string): string {
  const m = (triple ?? "").match(RGB_TRIPLE_RE);
  if (!m) return fallback;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if (r > 255 || g > 255 || b > 255) return fallback;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS の 0..1 または percentage を Canvas 用の 0..1 へ正規化する。 */
export function normalizeUnitInterval(
  value: string | null | undefined,
  fallback: number,
): number {
  const source = (value ?? "").trim();
  if (!source) return fallback;
  const isPercentage = source.endsWith("%");
  const parsed = Number(isPercentage ? source.slice(0, -1) : source);
  const normalized = isPercentage ? parsed / 100 : parsed;
  return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1
    ? normalized
    : fallback;
}

/**
 * export sheet 要素から現在テーマのスタイルを読む（読取専用）。
 * ブラウザ専用（getComputedStyle 依存）。
 */
export function readExportImageStyle(el: Element): ExportImageStyle {
  const cs = getComputedStyle(el);
  const prop = (name: string) => cs.getPropertyValue(name).trim();
  const color = (name: string, fallback: string) => normalizeColor(prop(name), fallback);
  const optionalColor = (name: string) => normalizeColor(prop(name), "") || null;

  const pie = Array.from({ length: 8 }, (_, i) =>
    color(`--pie-${i}`, FALLBACK_STYLE.pie[i]),
  ) as ExportImageStyle["pie"];

  const ink = color("--ink", FALLBACK_STYLE.ink);
  const muted = color("--muted", FALLBACK_STYLE.muted);
  const accent = color("--accent", FALLBACK_STYLE.accent);
  const highlight = color("--export-highlight", accent);
  const danger = color("--danger", FALLBACK_STYLE.danger);
  const barFill = color("--bar-fill", FALLBACK_STYLE.barFill);
  const accentCardFallback = rgbaFromTriple(prop("--accent-rgb"), 0.075, FALLBACK_STYLE.statCardAccent);
  const dangerCardFallback = rgbaFromTriple(prop("--danger-rgb"), 0.1, FALLBACK_STYLE.statCardDanger);

  return {
    paper: color("--paper", FALLBACK_STYLE.paper),
    ink,
    muted,
    accent,
    accentTint: rgbaFromTriple(prop("--accent-rgb"), 1, accent),
    highlight,
    highlightTint: rgbaFromTriple(prop("--export-highlight-rgb"), 1, highlight),
    danger,
    natureUp: color("--nature-up", FALLBACK_STYLE.natureUp),
    natureDown: color("--nature-down", FALLBACK_STYLE.natureDown),
    sectionBackground: rgbaFromTriple(prop("--ink-rgb"), 0.05, FALLBACK_STYLE.sectionBackground),
    statCardAccent: color("--export-card-accent-bg", accentCardFallback),
    statCardPlain: color("--export-card-plain-bg", accentCardFallback),
    statCardPrimary: color("--export-card-primary-bg", accentCardFallback),
    statCardDanger: color("--export-card-danger-bg", dangerCardFallback),
    statCardLabel: color("--export-card-label", muted),
    statCardInk: color("--export-card-ink", ink),
    statCardDangerInk: color("--export-card-danger-ink", color("--export-danger", danger)),
    barFill,
    shardsBarFill: color("--bar-shards-fill", barFill),
    barTrack: optionalColor("--export-bar-track"),
    shardsBarTrack: optionalColor("--export-shards-bar-track"),
    barFillAlpha: normalizeUnitInterval(
      prop("--export-bar-fill-opacity"),
      FALLBACK_STYLE.barFillAlpha,
    ),
    pie,
    bodyFontFamily: EXPORT_IMAGE_FONT_FAMILY,
    headingFontFamily: EXPORT_IMAGE_FONT_FAMILY,
  };
}
