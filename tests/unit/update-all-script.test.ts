import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertToolCheckout,
  buildUpdateAllSteps,
  parseUpdateAllArgs,
} from "../../scripts/update-all.mjs";

describe("update:all operational workflow", () => {
  const toolPath = path.resolve("fixtures", "pokesleep-tool");

  it("prefers the explicit pokesleep-tool path over the environment", () => {
    const result = parseUpdateAllArgs(
      ["node", "update-all.mjs", "--pokesleep-tool", "./explicit-tool"],
      { POKESLEEP_TOOL_PATH: "./environment-tool" },
      "./default-tool",
    );

    expect(result.pokesleepTool).toBe(path.resolve("./explicit-tool"));
  });

  it("uses POKESLEEP_TOOL_PATH when no explicit path is supplied", () => {
    const result = parseUpdateAllArgs(
      ["node", "update-all.mjs"],
      { POKESLEEP_TOOL_PATH: "./environment-tool" },
      "./default-tool",
    );

    expect(result.pokesleepTool).toBe(path.resolve("./environment-tool"));
  });

  it("uses the documented default when neither an argument nor environment is supplied", () => {
    const result = parseUpdateAllArgs(
      ["node", "update-all.mjs"],
      {},
      "./default-tool",
    );

    expect(result.pokesleepTool).toBe(path.resolve("./default-tool"));
  });

  it("rejects unknown or incomplete arguments instead of updating another checkout", () => {
    expect(() =>
      parseUpdateAllArgs(["node", "update-all.mjs", "--pokesleep_tool"], {}, "./default-tool"),
    ).toThrow("Unknown argument: --pokesleep_tool");
    expect(() =>
      parseUpdateAllArgs(["node", "update-all.mjs", "--pokesleep-tool"], {}, "./default-tool"),
    ).toThrow("--pokesleep-tool にパスを指定してください");
    expect(() =>
      parseUpdateAllArgs(
        ["node", "update-all.mjs", "--pokesleep-tool", "--dry-run"],
        {},
        "./default-tool",
      ),
    ).toThrow("--pokesleep-tool にパスを指定してください");
  });

  it("verifies forms after the interactive update and regenerates from canonical mappings", () => {
    const steps = buildUpdateAllSteps(toolPath, "pnpm.cjs");
    const scripts = steps
      .flatMap(step => step.args)
      .filter(arg => typeof arg === "string" && arg.endsWith(".mjs"))
      .map(arg => path.basename(arg));

    expect(scripts).toEqual([
      "generate-master.mjs",
      "verify-form-mapping.mjs",
      "generate-pokemon-master.mjs",
      "generate-pokemon-en-names.mjs",
      "check-ingredient-labels.mjs",
    ]);
    expect(steps[0].args).toContain("--pokesleep-tool");
    expect(steps[1].args).toContain("--pokesleep-tool");
    expect(steps[2].args).not.toContain("--pokesleep-tool");
    expect(steps.at(-1)?.args).toEqual(["pnpm.cjs", "run", "build"]);
  });

  it("rejects a dirty external checkout before pulling", () => {
    expect(() =>
      assertToolCheckout(toolPath, {
        exists: () => true,
        exec: () => " M src/data/pokemon.json\n",
      }),
    ).toThrow("pokesleep-tool に未コミット変更があります");
  });
});
