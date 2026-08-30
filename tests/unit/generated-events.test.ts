import { describe, expect, it } from "vitest";

import {
  eventHistory,
  sleepExpEventSegments,
} from "../../src/domain/pokesleep/_generated/sleep-exp-events";
import { eventNameJaToEn, eventNameJaToEnByPeriod } from "../../src/i18n/_generated/event-name-en";
import { localizeEventName } from "../../src/i18n/eventNames";

describe("generated Sleep EXP event consistency", () => {
  it("keeps every generated Sleep EXP segment represented in eventHistory", () => {
    const historySleepExp = eventHistory.filter((entry): entry is typeof eventHistory[number] & {
      sleepExp: { multiplier: number; from: string; to: string };
    } => entry.sleepExp !== undefined);

    for (const entry of historySleepExp) {
      expect(sleepExpEventSegments).toContainEqual(expect.objectContaining({
        from: entry.sleepExp.from,
        to: entry.sleepExp.to,
        multiplier: entry.sleepExp.multiplier,
      }));
    }

    for (const segment of sleepExpEventSegments) {
      expect(historySleepExp).toContainEqual(expect.objectContaining({
        sleepExp: {
          multiplier: segment.multiplier,
          from: segment.from,
          to: segment.to,
        },
      }));
    }
  });

  it("keeps every English event-name key attached to generated event data", () => {
    const generatedNames = new Set([
      ...eventHistory.map(entry => entry.name),
      ...sleepExpEventSegments.map(segment => segment.name),
    ]);
    for (const japaneseName of Object.keys(eventNameJaToEn)) {
      expect(generatedNames.has(japaneseName), japaneseName).toBe(true);
    }
  });

  it("keeps every period-keyed English name attached to generated history or Sleep EXP data", () => {
    const generatedKeys = new Set([
      ...eventHistory.map(entry => `${entry.name}@${entry.from}`),
      ...sleepExpEventSegments.map(segment => `${segment.name}@${segment.from}`),
    ]);
    for (const periodKey of Object.keys(eventNameJaToEnByPeriod)) {
      expect(generatedKeys.has(periodKey), periodKey).toBe(true);
    }
  });

  it("localizes every generated Sleep EXP segment by its display name and start date", () => {
    for (const segment of sleepExpEventSegments) {
      expect(localizeEventName(segment.name, "en", segment.from), `${segment.name}@${segment.from}`)
        .not.toBe(segment.name);
    }
  });

  it("excludes name-only keys when English names differ across occurrences", () => {
    const englishNamesByJapaneseName = new Map<string, Set<string>>();
    for (const [periodKey, englishName] of Object.entries(eventNameJaToEnByPeriod)) {
      const japaneseName = periodKey.slice(0, periodKey.lastIndexOf("@"));
      const names = englishNamesByJapaneseName.get(japaneseName) ?? new Set<string>();
      names.add(englishName);
      englishNamesByJapaneseName.set(japaneseName, names);
    }

    for (const [japaneseName, englishNames] of englishNamesByJapaneseName) {
      if (englishNames.size > 1) expect(eventNameJaToEn).not.toHaveProperty(japaneseName);
    }

    for (const [japaneseName, englishName] of Object.entries(eventNameJaToEn)) {
      const perOccurrenceNames = englishNamesByJapaneseName.get(japaneseName);
      expect(perOccurrenceNames, japaneseName).toBeDefined();
      expect([...perOccurrenceNames ?? []], japaneseName).toEqual([englishName]);
    }
  });
});
