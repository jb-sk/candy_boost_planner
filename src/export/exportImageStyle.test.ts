import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeUnitInterval, readExportImageStyle } from "./exportImageStyle";

describe("normalizeUnitInterval", () => {
  it.each([
    ["0.76", 0.76],
    ["76%", 0.76],
    ["0", 0],
    ["100%", 1],
  ])("%s を %s に正規化する", (source, expected) => {
    expect(normalizeUnitInterval(source, 0.62)).toBe(expected);
  });

  it.each(["", "-1", "2", "101%", "abc"])("不正値 %s は fallback を返す", (source) => {
    expect(normalizeUnitInterval(source, 0.62)).toBe(0.62);
  });
});

describe("readExportImageStyle", () => {
  /** テーマの CSS 変数を持つ要素の代わり。getComputedStyle が返す値だけを差し替える。 */
  function readWith(props: Record<string, string>) {
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => props[name] ?? "" }));
    return readExportImageStyle({} as Element);
  }

  const base = {
    "--ink": "#111111",
    "--muted": "#666666",
    "--accent": "#d63d71",
    "--accent-rgb": "255, 125, 158",
    "--danger": "#d93636",
    "--export-highlight": "#d63d71",
    "--export-highlight-rgb": "255, 125, 158",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("テーマが指定しなければ、横棒の背景は null（塗りの色を薄く重ねる）、カードの文字は本文と同じ色", () => {
    const style = readWith(base);
    expect(style.barTrack).toBeNull();
    expect(style.shardsBarTrack).toBeNull();
    expect(style.statCardLabel).toBe("#666666");
    expect(style.statCardInk).toBe("#111111");
    expect(style.statCardDangerInk).toBe("#d93636");
  });

  it("文字用の色（--accent）と、線・淡い下地用の色（--accent-rgb）を分けて読む", () => {
    const style = readWith(base);
    expect(style.accent).toBe("#d63d71");
    expect(style.accentTint).toBe("rgba(255, 125, 158, 1)");
    expect(style.highlight).toBe("#d63d71");
    expect(style.highlightTint).toBe("rgba(255, 125, 158, 1)");
  });

  it("テーマの指定があれば、横棒の背景とカードの文字色に使う", () => {
    const style = readWith({
      ...base,
      "--export-bar-track": "#2a3356",
      "--export-shards-bar-track": "#3a3a3a",
      "--export-card-label": "rgba(0, 0, 0, 0.72)",
      "--export-card-ink": "#0f172a",
      "--export-card-danger-ink": "#ff8e7a",
    });
    expect(style.barTrack).toBe("#2a3356");
    expect(style.shardsBarTrack).toBe("#3a3a3a");
    expect(style.statCardLabel).toBe("rgba(0, 0, 0, 0.72)");
    expect(style.statCardInk).toBe("#0f172a");
    expect(style.statCardDangerInk).toBe("#ff8e7a");
  });

  it("不正な色の指定は無視する（横棒の背景は null、カードの文字は本文の色）", () => {
    const style = readWith({ ...base, "--export-bar-track": "not-a-color", "--export-card-ink": "oops" });
    expect(style.barTrack).toBeNull();
    expect(style.statCardInk).toBe("#111111");
  });
});
