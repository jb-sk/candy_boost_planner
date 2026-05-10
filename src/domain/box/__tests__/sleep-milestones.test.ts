import { describe, expect, it } from "vitest";
import {
  calcSleepMilestones,
  normalizeDailySleepInput,
  normalizeSleepHoursInput,
  normalizeSleepHoursValue,
} from "../sleep-milestones";

describe("sleep milestones helpers", () => {
  describe("normalizeSleepHoursInput", () => {
    it("returns undefined for empty input", () => {
      expect(normalizeSleepHoursInput("")).toBeUndefined();
      expect(normalizeSleepHoursInput("   ")).toBeUndefined();
    });

    it("returns undefined for negative input", () => {
      expect(normalizeSleepHoursInput("-1")).toBeUndefined();
    });

    it("keeps zero as a valid value", () => {
      expect(normalizeSleepHoursInput("0")).toBe(0);
      expect(normalizeSleepHoursInput("0.9")).toBe(0);
    });

    it("floors decimal input", () => {
      expect(normalizeSleepHoursInput("12.9")).toBe(12);
    });
  });

  describe("normalizeDailySleepInput", () => {
    it("returns null when out of range", () => {
      expect(normalizeDailySleepInput(0.5)).toBeNull();
      expect(normalizeDailySleepInput(14)).toBeNull();
    });

    it("returns null for non-finite values", () => {
      expect(normalizeDailySleepInput(null)).toBeNull();
      expect(normalizeDailySleepInput(undefined)).toBeNull();
      expect(normalizeDailySleepInput(Number.NaN)).toBeNull();
    });

    it("accepts boundary values 1 and 13", () => {
      expect(normalizeDailySleepInput(1)).toBe(1);
      expect(normalizeDailySleepInput(13)).toBe(13);
    });
  });

  describe("normalizeSleepHoursValue", () => {
    it("falls back to 0 for invalid values", () => {
      expect(normalizeSleepHoursValue(undefined)).toBe(0);
      expect(normalizeSleepHoursValue(-10)).toBe(0);
    });
  });

  describe("calcSleepMilestones", () => {
    const now = new Date("2026-05-08T00:00:00.000Z");

    it("handles 0h boundary", () => {
      const out = calcSleepMilestones({
        currentSleepHours: 0,
        dailySleepHours: 8.5,

        now,
      });
      expect(out[0]).toMatchObject({ hours: 200, achieved: false, remainingDays: 24 });
      // estimatedDate = 2026/05/08 + 24日 = 2026/06/01
      expect(out[0].estimatedDate).toBe("2026/06/01");
    });

    it("handles 199h boundary", () => {
      const out = calcSleepMilestones({
        currentSleepHours: 199,
        dailySleepHours: 8.5,

        now,
      });
      expect(out[0]).toMatchObject({ hours: 200, achieved: false, remainingDays: 1 });
    });

    it("handles 200h boundary", () => {
      const out = calcSleepMilestones({
        currentSleepHours: 200,
        dailySleepHours: 8.5,

        now,
      });
      expect(out[0]).toMatchObject({ hours: 200, achieved: true });
      // achieved なら estimatedDate は付かない
      expect(out[0].estimatedDate).toBeUndefined();
    });

    it("handles over 2000h boundary", () => {
      const out = calcSleepMilestones({
        currentSleepHours: 2100,
        dailySleepHours: 8.5,

        now,
      });
      expect(out.every((x) => x.achieved)).toBe(true);
    });

    it("guards invalid dailySleepHours values", () => {
      const outZero = calcSleepMilestones({
        currentSleepHours: 0,
        dailySleepHours: 0,

        now,
      });
      const outNaN = calcSleepMilestones({
        currentSleepHours: 0,
        dailySleepHours: Number.NaN,

        now,
      });
      expect(outZero[0]).toMatchObject({ hours: 200, remainingDays: 24 });
      expect(outNaN[0]).toMatchObject({ hours: 200, remainingDays: 24 });
    });
  });
});
