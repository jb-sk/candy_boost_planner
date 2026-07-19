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
  danger: string;
  sectionBackground: string;
  barFill: string;
  barTrack: string;
  pie: [string, string, string, string, string, string, string, string];
  bodyFontFamily: string;
  headingFontFamily: string;
};

const FALLBACK_FONT = "system-ui, -apple-system, sans-serif";

/** base.css の既定値に一致させた静的 fallback。 */
export const FALLBACK_STYLE: ExportImageStyle = {
  paper: "#ffffff",
  ink: "#1e293b",
  muted: "#64748b",
  accent: "#10b981",
  danger: "#ef4444",
  sectionBackground: "rgba(30, 41, 59, 0.05)",
  barFill: "#ec4899",
  barTrack: "#e2e8f0",
  pie: ["#10b981", "#6366f1", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#f97316", "#64748b"],
  bodyFontFamily: FALLBACK_FONT,
  headingFontFamily: FALLBACK_FONT,
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

/**
 * export sheet 要素から現在テーマのスタイルを読む（読取専用）。
 * ブラウザ専用（getComputedStyle 依存）。
 */
export function readExportImageStyle(el: Element): ExportImageStyle {
  const cs = getComputedStyle(el);
  const prop = (name: string) => cs.getPropertyValue(name).trim();
  const color = (name: string, fallback: string) => normalizeColor(prop(name), fallback);

  const pie = Array.from({ length: 8 }, (_, i) =>
    color(`--pie-${i}`, FALLBACK_STYLE.pie[i]),
  ) as ExportImageStyle["pie"];

  const bodyFontFamily =
    (cs.fontFamily && cs.fontFamily.trim()) || prop("--font-body") || FALLBACK_FONT;
  const headingFontFamily = prop("--font-heading") || bodyFontFamily || FALLBACK_FONT;

  return {
    paper: color("--paper", FALLBACK_STYLE.paper),
    ink: color("--ink", FALLBACK_STYLE.ink),
    muted: color("--muted", FALLBACK_STYLE.muted),
    accent: color("--accent", FALLBACK_STYLE.accent),
    danger: color("--danger", FALLBACK_STYLE.danger),
    sectionBackground: rgbaFromTriple(prop("--ink-rgb"), 0.05, FALLBACK_STYLE.sectionBackground),
    barFill: color("--bar-fill", FALLBACK_STYLE.barFill),
    barTrack: color("--bar-track", FALLBACK_STYLE.barTrack),
    pie,
    bodyFontFamily,
    headingFontFamily,
  };
}
