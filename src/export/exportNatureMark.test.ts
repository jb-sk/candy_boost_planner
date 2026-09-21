import { describe, expect, it } from "vitest";
import {
  EXPORT_NATURE_MARK_HEIGHT,
  EXPORT_NATURE_MARK_PATH,
  EXPORT_NATURE_MARK_TRIANGLES,
  EXPORT_NATURE_MARK_WIDTH,
  exportNatureTone,
} from "./exportNatureMark";

describe("exportNatureTone", () => {
  it.each([
    ["▲▲", "up"],
    ["EXP▲▲", "up"],
    ["▼▼", "down"],
    ["EXP▼▼", "down"],
    [undefined, undefined],
    ["-", undefined],
  ] as const)("%s を %s と判定する", (label, expected) => {
    expect(exportNatureTone(label)).toBe(expected);
  });
});

describe("EXP性格補正マークの共有ジオメトリ", () => {
  it("2個の三角形を2px離し、upとdownで頂点の向きを反転する", () => {
    const [upLeft, upRight] = EXPORT_NATURE_MARK_TRIANGLES.up;
    const [downLeft] = EXPORT_NATURE_MARK_TRIANGLES.down;

    expect(upRight[0].x - upLeft[2].x).toBe(2);
    expect(upLeft[1].y).toBeLessThan(upLeft[0].y);
    expect(downLeft[1].y).toBeGreaterThan(downLeft[0].y);
    expect(upRight[2].x).toBe(EXPORT_NATURE_MARK_WIDTH);
    expect(downLeft[1].y).toBe(EXPORT_NATURE_MARK_HEIGHT);
  });

  it("SVGパスを上昇・下降それぞれ生成する", () => {
    expect(EXPORT_NATURE_MARK_PATH.up).toBe("M0 7 4.5 0 9 7ZM11 7 15.5 0 20 7Z");
    expect(EXPORT_NATURE_MARK_PATH.down).toBe("M0 0 4.5 7 9 0ZM11 0 15.5 7 20 0Z");
  });
});
