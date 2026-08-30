import { describe, expect, it } from "vitest";

import { localizeEventName } from "../../src/i18n/eventNames";

describe("localizeEventName", () => {
  it("returns the Japanese name unchanged for the Japanese locale", () => {
    expect(localizeEventName("3周年記念フェスティバル", "ja", "2026-07-13")).toBe("3周年記念フェスティバル");
  });

  it("returns the period-specific English name before the name-only fallback", () => {
    expect(localizeEventName("ポケモンすくすくウィーク", "en", "2024-07-01")).toBe("Pokémon Growth Week");
    expect(localizeEventName("ポケモンすくすくウィーク", "en", "2025-05-19")).toBe("Pokémon Growth Week Vol. 5");
  });

  it("returns the name-only English name when it is unambiguous", () => {
    expect(localizeEventName("3周年記念フェスティバル", "en")).toBe("Third Anniversary Fest");
  });

  it("keeps an ambiguous name Japanese when no start date is supplied", () => {
    expect(localizeEventName("ポケモンすくすくウィーク", "en")).toBe("ポケモンすくすくウィーク");
  });

  it("falls back to the Japanese name when the dictionary has no entry", () => {
    expect(localizeEventName("未登録イベント", "en")).toBe("未登録イベント");
  });
});
