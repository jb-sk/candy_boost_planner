import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "../../../src/i18n/en";
import { ja } from "../../../src/i18n/ja";

const htmlTag = /<[a-z][^>]*>/i;

describe("hint rendering security", () => {
  it("does not render hint messages through v-html", () => {
    const calcPanel = readFileSync(new URL("../../../src/components/CalcPanel.vue", import.meta.url), "utf8");
    const boxPanel = readFileSync(new URL("../../../src/components/BoxPanel.vue", import.meta.url), "utf8");

    expect(calcPanel).not.toContain('v-html="hintState.message"');
    expect(boxPanel).not.toContain('v-html="hintState.message"');
  });

  it.each([ja, en])("keeps interactive hint translations as plain text", (messages) => {
    const hintParts = [
      messages.calc.row.boostCandyCountHintNote,
      messages.box.detail.sleepCalcDailyHintPrefix,
      messages.box.detail.sleepCalcDailyHintSettings,
      messages.box.detail.sleepCalcDailyHintSuffix,
    ];

    for (const part of hintParts) expect(part).not.toMatch(htmlTag);
  });
});
