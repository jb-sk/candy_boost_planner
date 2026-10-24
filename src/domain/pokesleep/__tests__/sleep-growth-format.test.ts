import { describe, expect, it } from "vitest";
import { en } from "../../../i18n/en";
import { ja } from "../../../i18n/ja";
import { NAP_ISLAND_TICKET_MINUTES } from "../nap-island";
import { formatNapIslandDuration, formatNapTicketCount } from "../sleep-growth-format";

const jaTokens = { dayUnit: ja.calc.sleep.dayUnit, hourUnit: ja.calc.sleep.hourUnit, minuteUnit: ja.calc.sleep.minuteUnit };
const enTokens = { dayUnit: en.calc.sleep.dayUnit, hourUnit: en.calc.sleep.hourUnit, minuteUnit: en.calc.sleep.minuteUnit };

describe("formatNapIslandDuration", () => {
  it("full: 0 の単位も省かない", () => {
    expect(formatNapIslandDuration(0, jaTokens, "full")).toBe("0日0時間0分");
    expect(formatNapIslandDuration(3, jaTokens, "full")).toBe("0日0時間3分");
    expect(formatNapIslandDuration(20, jaTokens, "full")).toBe("0日0時間20分");
    expect(formatNapIslandDuration(240, jaTokens, "full")).toBe("0日4時間0分");
    expect(formatNapIslandDuration(2880, jaTokens, "full")).toBe("2日0時間0分");
    expect(formatNapIslandDuration(10080, jaTokens, "full")).toBe("7日0時間0分");
    expect(formatNapIslandDuration(120 * 1440, jaTokens, "full")).toBe("120日0時間0分");
  });

  it("compact: 先頭の 0 の単位だけ省く", () => {
    expect(formatNapIslandDuration(3, jaTokens, "compact")).toBe("3分");
    expect(formatNapIslandDuration(240, jaTokens, "compact")).toBe("4時間0分");
    expect(formatNapIslandDuration(2880, jaTokens, "compact")).toBe("2日0時間0分");
    expect(formatNapIslandDuration(3, enTokens, "compact")).toBe("3m");
  });
});

describe("formatNapTicketCount（アイテム欄の完成文字列）", () => {
  const jaTexts = {
    count: (count: number) => ja.calc.row.napTicketCount.replace("{count}", String(count)),
    countWithLast: (count: number, duration: string) => ja.calc.row.napTicketCountWithLast
      .split("{count}").join(String(count)).replace("{duration}", duration),
  };
  const enTexts = {
    count: (count: number) => en.calc.row.napTicketCount.replace("{count}", String(count)),
    countWithLast: (count: number, duration: string) => en.calc.row.napTicketCountWithLast
      .split("{count}").join(String(count)).replace("{duration}", duration),
  };
  const full = NAP_ISLAND_TICKET_MINUTES;

  it("1枚", () => {
    expect(formatNapTicketCount(1, 10080, full, jaTokens, jaTexts)).toBe("1枚");
    expect(formatNapTicketCount(1, 5000, full, enTokens, enTexts)).toBe("×1");
  });

  it("2枚・最後の1枚が3分", () => {
    expect(formatNapTicketCount(2, 3, full, jaTokens, jaTexts)).toBe("2枚（2枚目は3分）");
    expect(formatNapTicketCount(2, 3, full, enTokens, enTexts)).toBe("×2 (#2: 3m)");
  });

  it("14日ちょうど（最後の1枚も使い切る）", () => {
    expect(formatNapTicketCount(2, 10080, full, jaTokens, jaTexts)).toBe("2枚");
    expect(formatNapTicketCount(2, 10080, full, enTokens, enTexts)).toBe("×2");
  });

  it("5枚目が2日0時間0分", () => {
    expect(formatNapTicketCount(5, 2880, full, jaTokens, jaTexts)).toBe("5枚（5枚目は2日0時間0分）");
  });
});
