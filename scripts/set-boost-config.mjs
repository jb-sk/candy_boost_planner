import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function usage() {
  console.log(`
Usage:
  node scripts/set-boost-config.mjs --mini-exp 2 --mini-shards 4 --full-exp 2 --full-shards 5

Notes:
  - 省略した値は現状維持します
  - 値は 1 以上の数値（整数/小数どちらも可）
`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val == null || val.startsWith("--")) continue;
    i++;
    out[key] = val;
  }
  return out;
}

function toNumberOrUndef(x) {
  if (x == null) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`[set-boost-config] ${msg}`);
}

function replaceNumber(source, pattern, nextNumber) {
  if (nextNumber == null) return source;
  assert(nextNumber >= 1, `Value must be >= 1: ${nextNumber}`);
  const m = source.match(pattern);
  assert(m, `Pattern not found: ${pattern}`);
  return source.replace(pattern, `$1${nextNumber}$2`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const miniExp = toNumberOrUndef(args["mini-exp"]);
  const miniShards = toNumberOrUndef(args["mini-shards"]);
  const fullExp = toNumberOrUndef(args["full-exp"]);
  const fullShards = toNumberOrUndef(args["full-shards"]);

  const target = resolve(process.cwd(), "src/domain/pokesleep/boost-config.ts");
  let src = await readFile(target, "utf8");

  // mini
  src = replaceNumber(
    src,
    /(mini:\s*\{\s*expMultiplier:\s*)([0-9]+(?:\.[0-9]+)?)(\s*,)/,
    miniExp
  );
  src = replaceNumber(
    src,
    /(mini:\s*\{\s*expMultiplier:\s*[0-9]+(?:\.[0-9]+)?\s*,\s*shardMultiplier:\s*)([0-9]+(?:\.[0-9]+)?)(\s*\})/,
    miniShards
  );

  // full
  src = replaceNumber(
    src,
    /(full:\s*\{\s*expMultiplier:\s*)([0-9]+(?:\.[0-9]+)?)(\s*,)/,
    fullExp
  );
  src = replaceNumber(
    src,
    /(full:\s*\{\s*expMultiplier:\s*[0-9]+(?:\.[0-9]+)?\s*,\s*shardMultiplier:\s*)([0-9]+(?:\.[0-9]+)?)(\s*\})/,
    fullShards
  );

  await writeFile(target, src, "utf8");
  console.log(`[set-boost-config] Updated: ${target}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
