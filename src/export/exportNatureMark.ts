/** SVG と Canvas で共有するEXP性格補正マークの判定・ジオメトリ。 */

export type ExportNatureTone = "up" | "down";

type ExportNatureMarkPoint = Readonly<{
  x: number;
  y: number;
}>;

type ExportNatureMarkTriangle = readonly [
  ExportNatureMarkPoint,
  ExportNatureMarkPoint,
  ExportNatureMarkPoint,
];

export const EXPORT_NATURE_MARK_WIDTH = 20;
export const EXPORT_NATURE_MARK_HEIGHT = 7;

const TRIANGLE_GAP = 2;
const TRIANGLE_WIDTH = (EXPORT_NATURE_MARK_WIDTH - TRIANGLE_GAP) / 2;

function triangle(tone: ExportNatureTone, left: number): ExportNatureMarkTriangle {
  const right = left + TRIANGLE_WIDTH;
  const center = left + TRIANGLE_WIDTH / 2;
  return tone === "up"
    ? [{ x: left, y: EXPORT_NATURE_MARK_HEIGHT }, { x: center, y: 0 }, { x: right, y: EXPORT_NATURE_MARK_HEIGHT }]
    : [{ x: left, y: 0 }, { x: center, y: EXPORT_NATURE_MARK_HEIGHT }, { x: right, y: 0 }];
}

function triangles(tone: ExportNatureTone): readonly ExportNatureMarkTriangle[] {
  return [triangle(tone, 0), triangle(tone, TRIANGLE_WIDTH + TRIANGLE_GAP)];
}

export const EXPORT_NATURE_MARK_TRIANGLES = {
  up: triangles("up"),
  down: triangles("down"),
} as const;

function svgPath(markTriangles: readonly ExportNatureMarkTriangle[]): string {
  return markTriangles
    .map(([first, second, third]) => (
      `M${first.x} ${first.y} ${second.x} ${second.y} ${third.x} ${third.y}Z`
    ))
    .join("");
}

export const EXPORT_NATURE_MARK_PATH = {
  up: svgPath(EXPORT_NATURE_MARK_TRIANGLES.up),
  down: svgPath(EXPORT_NATURE_MARK_TRIANGLES.down),
} as const;

/** 表示文言に含まれる記号から、EXP性格補正の意味だけを取り出す。 */
export function exportNatureTone(label: string | undefined): ExportNatureTone | undefined {
  if (label?.includes("▲")) return "up";
  if (label?.includes("▼")) return "down";
  return undefined;
}
