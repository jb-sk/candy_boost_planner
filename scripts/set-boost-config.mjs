import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function usage() {
  console.log(`
Usage:
  node scripts/set-boost-config.mjs [options]

Options:
  --mini-exp N       ミニブのEXP倍率（例: 2）
  --mini-shards N    ミニブのかけら倍率（例: 4）
  --full-exp N       アメブのEXP倍率（例: 2）
  --full-shards N    アメブのかけら倍率（例: 5）
  --default-kind K   デフォルトのアメブ種別（none/mini/full）

Notes:
  - 省略した値は現状維持します
  - 倍率は 1 以上の数値（整数/小数どちらも可）
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

function replaceDefaultKind(source, kind) {
  if (kind == null) return source;
  const validKinds = ["none", "mini", "full"];
  assert(validKinds.includes(kind), `Invalid kind: ${kind}. Must be one of: ${validKinds.join(", ")}`);
  const pattern = /(export const defaultBoostKind:\s*BoostEvent\s*=\s*")([^"]+)(")/;
  const m = source.match(pattern);
  assert(m, "Pattern for defaultBoostKind not found");
  return source.replace(pattern, `$1${kind}$3`);
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
  const defaultKind = args["default-kind"];

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

  // default kind
  src = replaceDefaultKind(src, defaultKind);

  await writeFile(target, src, "utf8");
  console.log(`[set-boost-config] Updated: ${target}`);

  // 変更内容を表示
  if (miniExp != null) console.log(`  mini.expMultiplier: ${miniExp}`);
  if (miniShards != null) console.log(`  mini.shardMultiplier: ${miniShards}`);
  if (fullExp != null) console.log(`  full.expMultiplier: ${fullExp}`);
  if (fullShards != null) console.log(`  full.shardMultiplier: ${fullShards}`);
  if (defaultKind != null) console.log(`  defaultBoostKind: ${defaultKind}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
