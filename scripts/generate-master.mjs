// Unified generator entry for MasterDB + indices.
//
// Goal:
// - Provide ONE operational entrypoint for "MasterDB creation".
// - Keep old scripts as aliases for backwards compatibility.
//
// What it does:
// - generate:pokemon-db  (wiki -> intermediate JSON)
// - generate-pokemon-master.mjs (master + indices; interactive or non-interactive)
//
// Usage:
// - npm run generate:master
// - npm run generate:master -- --non-interactive
// - npm run generate:master -- --interactive
//
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function hasArg(name) {
  return process.argv.includes(name);
}

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "inherit" });
  } catch (err) {
    process.exit(err.status ?? 1);
  }
}

function main() {
  const forceInteractive = hasArg("--interactive");
  const forceNonInteractive = hasArg("--non-interactive");
  const dryRun = hasArg("--dry-run");
  const pokesleepToolArgIndex = process.argv.indexOf("--pokesleep-tool");
  const pokesleepTool = pokesleepToolArgIndex >= 0 ? process.argv[pokesleepToolArgIndex + 1] : null;

  const interactive = forceNonInteractive ? false : forceInteractive ? true : Boolean(process.stdin.isTTY);
  const masterArgs = interactive ? ["scripts/generate-pokemon-master.mjs", "--interactive"] : ["scripts/generate-pokemon-master.mjs", "--non-interactive"];
  if (dryRun) masterArgs.push("--dry-run");

  // Step 1: wiki -> intermediate db json
  // dry-run 時は一時ディレクトリに中間JSONを書き、作業ツリーを汚さない
  let tmpJsonOut;
  if (dryRun) {
    const tmp = mkdtempSync(join(tmpdir(), "pokemon-db-"));
    tmpJsonOut = join(tmp, "pokemon-db.json");
  }

  if (process.platform === "win32") {
    let cmd = dryRun ? "npm run generate:pokemon-db -- --dry-run" : "npm run generate:pokemon-db";
    if (tmpJsonOut) cmd += ` --out-json "${tmpJsonOut}"`;
    run("cmd.exe", ["/d", "/s", "/c", cmd]);
  } else {
    const dbArgs = ["run", "generate:pokemon-db"];
    if (dryRun) dbArgs.push("--", "--dry-run");
    if (tmpJsonOut) dbArgs.push(`--out-json`, tmpJsonOut);
    run("npm", dbArgs);
  }

  // Step 2: intermediate -> master + indices
  if (tmpJsonOut) masterArgs.push("--db", tmpJsonOut);
  run(process.execPath, masterArgs);

  // Step 3: master -> candy family map. A dry-run master is written only to a
  // temporary DB, so current generated-family completeness is checked separately.
  const familyArgs = ["scripts/generate-candy-families.mjs"];
  if (dryRun) familyArgs.push("--verify");
  if (pokesleepTool) familyArgs.push("--pokesleep-tool", pokesleepTool);
  run(process.execPath, familyArgs);
}

main();
