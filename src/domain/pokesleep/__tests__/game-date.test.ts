import { describe, expect, it } from "vitest";
import {
  addGameDays,
  calendarDateInTimeZone,
  findNextGameDateChange,
  formatGameMonthDay,
  gameDateFromWallClock,
  isoWeekKey,
  normalizeTimeZone,
  resolveGameDate,
} from "../game-date";

describe("game-date", () => {
  it("AM4:00より前は前日、4:00以後は当日のゲーム内日になる", () => {
    expect(resolveGameDate(new Date("2026-05-01T18:59:59.999Z"), "Asia/Tokyo"))
      .toBe("2026-05-01");
    expect(resolveGameDate(new Date("2026-05-01T19:00:00.000Z"), "Asia/Tokyo"))
      .toBe("2026-05-02");
  });

  it("満月の暦日にはAM4補正を混ぜない", () => {
    const beforeFour = new Date("2026-05-01T17:23:00.000Z"); // JST 2026-05-02 02:23
    expect(calendarDateInTimeZone(beforeFour, "Asia/Tokyo")).toBe("2026-05-02");
    expect(resolveGameDate(beforeFour, "Asia/Tokyo")).toBe("2026-05-01");
  });

  it("IANA名を正規化し、固定オフセットと不正名を拒否する", () => {
    expect(normalizeTimeZone(" asia/tokyo ")).toBe("Asia/Tokyo");
    expect(normalizeTimeZone("UTC+09:00")).toBeNull();
    expect(normalizeTimeZone("GMT-0500")).toBeNull();
    expect(normalizeTimeZone("Not/A_Zone")).toBeNull();
  });

  it("DST開始日でも次の最初のゲーム内日変化を見つける", () => {
    const now = new Date("2026-03-08T06:30:00.000Z"); // New York 01:30、02時台が欠ける日
    expect(findNextGameDateChange(now, "America/New_York").toISOString())
      .toBe("2026-03-08T08:00:00.000Z");
  });

  it("壁時計表記のゲーム内日はAM4:00で切り替わり、タイムゾーンを見ない", () => {
    expect(gameDateFromWallClock("2026-08-28T03:59")).toBe("2026-08-27");
    expect(gameDateFromWallClock("2026-08-28T04:00")).toBe("2026-08-28");
    // 月をまたぐ前日補正。
    expect(gameDateFromWallClock("2026-03-01T00:00")).toBe("2026-02-28");
  });

  it("壁時計表記は実在しない日時を拒否する", () => {
    expect(gameDateFromWallClock("2026-02-29T12:00")).toBeNull(); // 2026年は平年
    expect(gameDateFromWallClock("2024-02-29T12:00")).toBe("2024-02-29");
    expect(gameDateFromWallClock("2026-08-28T24:00")).toBeNull();
    expect(gameDateFromWallClock("2026-08-28T12:60")).toBeNull();
    expect(gameDateFromWallClock("2026-08-28")).toBeNull();
    expect(gameDateFromWallClock("2026-08-28T12:00:00")).toBeNull();
    expect(gameDateFromWallClock("")).toBeNull();
  });

  it("暦日加算とISO週キーはホストのローカルタイムゾーンに依存しない", () => {
    expect(addGameDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addGameDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2027-01-04")).toBe("2027-W01");
  });

  it("短い月日表記は先頭ゼロと年を省く", () => {
    expect(formatGameMonthDay("2026-09-05")).toBe("9/5");
    expect(formatGameMonthDay("2027-01-01")).toBe("1/1");
  });
});
