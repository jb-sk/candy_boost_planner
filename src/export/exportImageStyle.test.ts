import { describe, expect, it } from "vitest";
import { normalizeUnitInterval } from "./exportImageStyle";

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
