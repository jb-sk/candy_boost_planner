#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TOOL_ROOT = path.resolve(__dirname, "../../External/pokesleep-tool");

export function parseUpdateAllArgs(
  argv,
  env = process.env,
  defaultToolRoot = DEFAULT_TOOL_ROOT,
) {
  let pokesleepTool = env.POKESLEEP_TOOL_PATH || defaultToolRoot;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--") {
      continue;
    }
    if (argv[i] === "--pokesleep-tool") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) {
        throw new Error("--pokesleep-tool にパスを指定してください");
      }
      pokesleepTool = argv[i + 1];
      i++;
      continue;
    }
    throw new Error("Unknown argument: " + argv[i]);
  }
  return { pokesleepTool: path.resolve(pokesleepTool) };
}

export function buildUpdateAllSteps(toolRoot, packageManagerCli) {
  return [
    {
      label: "マスターデータを対話更新",
      command: process.execPath,
      args: [
        path.join(__dirname, "generate-master.mjs"),
        "--interactive",
        "--pokesleep-tool",
        toolRoot,
      ],
    },
    {
      label: "フォーム番号を突合",
      command: process.execPath,
      args: [
        path.join(__dirname, "verify-form-mapping.mjs"),
        "--pokesleep-tool",
        toolRoot,
      ],
    },
    {
      label: "突合後の正規マッピングからマスターを再生成",
      command: process.execPath,
      // フォーム番号だけを再適用する。candy family はdexNoキーなので再生成不要。
      args: [
        path.join(__dirname, "generate-pokemon-master.mjs"),
        "--non-interactive",
      ],
    },
    {
      label: "英語名を更新",
      command: process.execPath,
      args: [path.join(__dirname, "generate-pokemon-en-names.mjs")],
    },
    {
      label: "食材表示名を検証",
      command: process.execPath,
      args: [
        path.join(__dirname, "check-ingredient-labels.mjs"),
        "--fail-on-gap",
      ],
    },
    {
      label: "ビルド",
      command: process.execPath,
      args: [packageManagerCli, "run", "build"],
    },
  ];
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

/**
 * @param {string} toolRoot
 * @param {{
 *   exists?: (target: string) => boolean,
 *   exec?: (command: string, args: string[], options: { encoding: "utf8" }) => string,
 * }} [dependencies]
 */
export function assertToolCheckout(toolRoot, dependencies = {}) {
  const exists = dependencies.exists ?? fs.existsSync;
  const exec = dependencies.exec ?? execFileSync;
  const required = [
    path.join(toolRoot, "src/data/pokemon.json"),
    path.join(toolRoot, "src/util/PokemonIv.ts"),
  ];
  for (const requiredPath of required) {
    if (!exists(requiredPath)) {
      throw new Error("pokesleep-tool の必須ファイルがありません: " + requiredPath);
    }
  }

  const status = exec(
    "git",
    ["-C", toolRoot, "status", "--porcelain"],
    { encoding: "utf8" },
  ).trim();
  if (status) {
    throw new Error(
      "pokesleep-tool に未コミット変更があります。更新前に解消してください:\n" + status,
    );
  }
}

function main() {
  const { pokesleepTool } = parseUpdateAllArgs(process.argv);
  const packageManagerCli = process.env.npm_execpath;
  const packageManagerUserAgent = process.env.npm_config_user_agent;
  if (
    !packageManagerCli ||
    !fs.existsSync(packageManagerCli) ||
    !packageManagerUserAgent?.startsWith("pnpm/")
  ) {
    throw new Error("pnpm 経由で実行してください: corepack pnpm run update:all");
  }

  console.log("[update:all] pokesleep-tool: " + pokesleepTool);
  assertToolCheckout(pokesleepTool);

  console.log("\n[update:all] にとよんツールを更新");
  run("git", ["-C", pokesleepTool, "pull", "--ff-only"]);

  for (const step of buildUpdateAllSteps(pokesleepTool, packageManagerCli)) {
    console.log("\n[update:all] " + step.label);
    run(step.command, step.args);
  }
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[update:all] " + message);
    process.exit(1);
  }
}
