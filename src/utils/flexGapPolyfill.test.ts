import { describe, expect, it } from "vitest";
import { planFlexGapPatches, type AutoSides, type FlexItem } from "./flexGapPolyfill";

const el = (auto: AutoSides = {}, mainSize?: number): FlexItem => ({ kind: "element", auto, mainSize });
const sized = (mainSize: number, auto: AutoSides = {}): FlexItem => el(auto, mainSize);
const text: FlexItem = { kind: "unpatchable" };
const plain = () => el();

describe("planFlexGapPatches", () => {
  it("横並びは2つ目以降の左に column-gap を足す", () => {
    const patches = planFlexGapPatches({ direction: "row", wrap: "nowrap", rowGap: 4, columnGap: 8 }, [plain(), plain(), plain()]);
    expect(patches).toEqual([
      { target: 1, side: "left", delta: 8 },
      { target: 2, side: "left", delta: 8 },
    ]);
  });

  it("縦並びは2つ目以降の上に row-gap を足し、逆向きは反対側に足す", () => {
    expect(planFlexGapPatches({ direction: "column", wrap: "nowrap", rowGap: 6, columnGap: 0 }, [plain(), plain()]))
      .toEqual([{ target: 1, side: "top", delta: 6 }]);
    expect(planFlexGapPatches({ direction: "column-reverse", wrap: "nowrap", rowGap: 6, columnGap: 0 }, [plain(), plain()]))
      .toEqual([{ target: 1, side: "bottom", delta: 6 }]);
    expect(planFlexGapPatches({ direction: "row-reverse", wrap: "nowrap", rowGap: 0, columnGap: 6 }, [plain(), plain()]))
      .toEqual([{ target: 1, side: "right", delta: 6 }]);
  });

  it("margin が auto の辺には足さず、手前の子の後ろに足す（margin-left: auto の右寄せを壊さない）", () => {
    expect(planFlexGapPatches({ direction: "row", wrap: "nowrap", rowGap: 0, columnGap: 8 }, [plain(), plain(), el({ left: true })]))
      .toEqual([
        { target: 1, side: "left", delta: 8 },
        { target: 1, side: "right", delta: 8 },
      ]);
  });

  it("地の文字との間は、文字の隣の要素の側に付ける", () => {
    expect(planFlexGapPatches({ direction: "row", wrap: "nowrap", rowGap: 0, columnGap: 4 }, [text, plain()]))
      .toEqual([{ target: 1, side: "left", delta: 4 }]);
    expect(planFlexGapPatches({ direction: "row", wrap: "nowrap", rowGap: 0, columnGap: 4 }, [plain(), text]))
      .toEqual([{ target: 0, side: "right", delta: 4 }]);
    expect(planFlexGapPatches({ direction: "row", wrap: "nowrap", rowGap: 0, columnGap: 4 }, [text, text])).toEqual([]);
  });

  it("地の文字を含む折り返しの並びは、隣同士の間に付ける（折り返さない並びと同じ）", () => {
    expect(planFlexGapPatches({ direction: "row", wrap: "wrap", rowGap: 4, columnGap: 4, mainSize: 100 }, [text, sized(20)]))
      .toEqual([{ target: 1, side: "left", delta: 4 }]);
  });

  it("gap が 0 なら何もしない", () => {
    expect(planFlexGapPatches({ direction: "row", wrap: "nowrap", rowGap: 0, columnGap: 0 }, [plain(), plain()])).toEqual([]);
    expect(planFlexGapPatches({ direction: "row", wrap: "wrap", rowGap: 0, columnGap: 0, mainSize: 100 }, [sized(40), sized(40)])).toEqual([]);
  });

  it("折り返す並びは、子の大きさ + gap で行を分け、行の2つ目以降の左と2行目以降の上に足す", () => {
    // 幅 100 に 30 の子を gap 10 で並べると 30+10+30+10+30 = 110 で、3つ目は次の行。
    // gap 無しだと 90 で入ってしまうので、2つ目の後ろを埋めて落とす。
    const patches = planFlexGapPatches(
      { direction: "row", wrap: "wrap", rowGap: 4, columnGap: 10, mainSize: 100 },
      [sized(30), sized(30), sized(30), sized(30)],
    );
    expect(patches).toEqual([
      { target: 1, side: "left", delta: 10 },
      { target: 1, side: "right", delta: 10 },
      { target: 2, side: "top", delta: 4 },
      { target: 3, side: "left", delta: 10 },
      { target: 3, side: "top", delta: 4 },
    ]);
  });

  it("幅 50% - gap/2 のカードは2枚ずつ並ぶ（育成プランの合計カード）", () => {
    // 親 343、gap 10、カード calc(50% - 5px) = 166.5
    const cards = [sized(166.5), sized(166.5), sized(166.5), sized(166.5)];
    const patches = planFlexGapPatches({ direction: "row", wrap: "wrap", rowGap: 10, columnGap: 10, mainSize: 343 }, cards);
    expect(patches).toEqual([
      { target: 1, side: "left", delta: 10 },
      { target: 2, side: "top", delta: 10 },
      { target: 3, side: "left", delta: 10 },
      { target: 3, side: "top", delta: 10 },
    ]);
  });

  it("gap が無ければ前の行に入ってしまう子は、前の行の最後の子の後ろを埋めて次の行へ落とす", () => {
    // 名前（伸びる前は 0）と Lv（100%）: 0 + 4 + 100 > 100 なので本来は Lv が2行目。gap 無しだと 0 + 100 で入ってしまう。
    expect(planFlexGapPatches({ direction: "row", wrap: "wrap", rowGap: 1, columnGap: 4, mainSize: 100 }, [sized(0), sized(100)]))
      .toEqual([
        { target: 0, side: "right", delta: 4 },
        { target: 1, side: "top", delta: 1 },
      ]);
    // 行の残りが gap より小さいときは残りだけ埋める（前の行の最後の子まで押し出さない）。
    expect(planFlexGapPatches({ direction: "row", wrap: "wrap", rowGap: 1, columnGap: 4, mainSize: 100 }, [sized(98), sized(1)]))
      .toEqual([
        { target: 0, side: "right", delta: 2 },
        { target: 1, side: "top", delta: 1 },
      ]);
  });

  it("行に入りきらない大きな子は1つで1行になる", () => {
    const patches = planFlexGapPatches({ direction: "row", wrap: "wrap", rowGap: 4, columnGap: 10, mainSize: 100 }, [sized(150), sized(20)]);
    expect(patches).toEqual([{ target: 1, side: "top", delta: 4 }]);
  });

  it("折り返す縦並びは、行（列）の2つ目以降の上と2列目以降の左に足す", () => {
    const patches = planFlexGapPatches({ direction: "column", wrap: "wrap", rowGap: 5, columnGap: 8, mainSize: 50 }, [sized(30), sized(30)]);
    expect(patches).toEqual([{ target: 1, side: "left", delta: 8 }]);
  });
});
