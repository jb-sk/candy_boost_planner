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

function hasArg(name) {
  return process.argv.includes(name);
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

function main() {
  const forceInteractive = hasArg("--interactive");
  const forceNonInteractive = hasArg("--non-interactive");

  const interactive = forceNonInteractive ? false : forceInteractive ? true : Boolean(process.stdin.isTTY);
  const masterArgs = interactive ? ["scripts/generate-pokemon-master.mjs", "--interactive"] : ["scripts/generate-pokemon-master.mjs", "--non-interactive"];

  // Step 1: wiki -> intermediate db json
  if (process.platform === "win32") {
    // On Windows, npm is a .cmd shim; invoke via cmd.exe to avoid spawn EINVAL without shell.
    run("cmd.exe", ["/d", "/s", "/c", "npm run generate:pokemon-db"]);
  } else {
    run("npm", ["run", "generate:pokemon-db"]);
  }

  // Step 2: intermediate -> master + indices
  run(process.execPath, masterArgs);
}

main();
