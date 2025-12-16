import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(`[verify] ${message}`);
}

function extractConstArray(source, name) {
  const re = new RegExp(
    String.raw`export const ${name}\s*=\s*\[\s*([\s\S]*?)\s*\]\s*as const;`,
    "m"
  );
  const m = source.match(re);
  assert(m, `Failed to extract array: ${name}`);

  const body = m[1]
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  const nums = body
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));

  assert(nums.length > 0, `Empty array: ${name}`);
  assert(nums.every((n) => Number.isFinite(n)), `Non-numeric value in ${name}`);
  return nums;
}

const expTypeRate = {
  600: 1,
  900: 1.5,
  1080: 1.8,
  1320: 2.2,
};

function calcExp(totalExpToTheLevel, level1, level2, expType) {
  const ratio = expTypeRate[expType];
  if (!ratio) return 0;
  if (level1 < 0 || level2 < 0) return 0;
  if (level1 >= totalExpToTheLevel.length) return 0;
  if (level2 >= totalExpToTheLevel.length) return 0;
  return (
    Math.round(totalExpToTheLevel[level2] * ratio) -
    Math.round(totalExpToTheLevel[level1] * ratio)
  );
}

function calcExpPerCandy(level, nature, boost) {
  const boostFactor = boost !== "none" ? 2 : 1;
  const base =
    level < 25
      ? nature === "up"
        ? 41
        : nature === "down"
          ? 29
          : 35
      : level < 30
        ? nature === "up"
          ? 35
          : nature === "down"
            ? 25
            : 30
        : nature === "up"
          ? 30
          : nature === "down"
            ? 21
            : 25;

  return base * boostFactor;
}

function shardRateForBoost(boost) {
  return boost === "none" ? 1 : boost === "mini" ? 4 : 5;
}

function calcExpAndCandy({ totalExpToTheLevel, dreamShardsPerCandy, srcLevel, dstLevel, expType, nature, boost, expGot }) {
  const got = expGot ?? 0;
  if (srcLevel < 0 || dstLevel < 0 || srcLevel >= dstLevel) {
    return { exp: 0, candy: 0, shards: 0 };
  }

  const exp = calcExp(totalExpToTheLevel, srcLevel, dstLevel, expType) - got;
  const shardRate = shardRateForBoost(boost);

  let shards = 0;
  let candy = 0;
  let carry = got;

  for (let level = srcLevel; level < dstLevel; level++) {
    const requiredExp = calcExp(totalExpToTheLevel, level, level + 1, expType) - carry;
    const expPerCandy = calcExpPerCandy(level, nature, boost);
    const requiredCandy = Math.ceil(requiredExp / expPerCandy);

    shards += (dreamShardsPerCandy[level + 1] ?? 0) * requiredCandy * shardRate;
    candy += requiredCandy;
    carry = expPerCandy * requiredCandy - requiredExp;
  }

  return { exp, candy, shards };
}

function calcExpAndCandyByBoostExpRatio({
  totalExpToTheLevel,
  dreamShardsPerCandy,
  srcLevel,
  dstLevel,
  expType,
  nature,
  boost, // "mini" | "full"
  expGot,
  boostExpRatio, // 0..1
}) {
  const got = expGot ?? 0;
  if (srcLevel < 0 || dstLevel < 0 || srcLevel >= dstLevel) {
    return { exp: 0, normalCandy: 0, boostCandy: 0, shards: 0 };
  }

  const baseExp = calcExp(totalExpToTheLevel, srcLevel, dstLevel, expType) - got;
  const ratio = Math.max(0, Math.min(1, boostExpRatio));
  const targetBoostExp = baseExp * ratio;

  const boostShardRate = shardRateForBoost(boost);
  let carry = got;
  let boostExpApplied = 0;
  let boostCandy = 0;
  let normalCandy = 0;
  let shards = 0;

  for (let level = srcLevel; level < dstLevel; level++) {
    let requiredExp = calcExp(totalExpToTheLevel, level, level + 1, expType) - carry;
    if (requiredExp <= 0) {
      carry = -requiredExp;
      continue;
    }

    const expPerNormal = calcExpPerCandy(level, nature, "none");
    const expPerBoost = calcExpPerCandy(level, nature, boost);

    const maxBoostCandyThisLevel = Math.ceil(requiredExp / expPerBoost);
    const boostLeft = Math.max(0, targetBoostExp - boostExpApplied);
    const wantBoostCandy = boostLeft <= 0 ? 0 : Math.ceil(boostLeft / expPerBoost);
    const useBoost = Math.max(0, Math.min(maxBoostCandyThisLevel, wantBoostCandy));

    requiredExp -= expPerBoost * useBoost;
    boostExpApplied += expPerBoost * useBoost;

    let useNormal = 0;
    if (requiredExp <= 0) {
      carry = -requiredExp;
    } else {
      useNormal = Math.ceil(requiredExp / expPerNormal);
      carry = expPerNormal * useNormal - requiredExp;
    }

    const shardBase = dreamShardsPerCandy[level + 1] ?? 0;
    shards += shardBase * useNormal;
    shards += shardBase * useBoost * boostShardRate;
    boostCandy += useBoost;
    normalCandy += useNormal;
  }

  return { exp: baseExp, boostCandy, normalCandy, shards };
}

async function main() {
  const tablesPath = resolve(process.cwd(), "src/domain/pokesleep/tables.ts");
  const src = await readFile(tablesPath, "utf8");
  const totalExpToTheLevel = extractConstArray(src, "totalExpToTheLevel");
  const dreamShardsPerCandy = extractConstArray(src, "dreamShardsPerCandy");

  // User case (nitoyon screenshot):
  const params = {
    srcLevel: 31,
    dstLevel: 60,
    expType: 600,
    nature: "normal",
    boost: "full",
    expRemaining: 702, // 「あとEXP（次Lvまでの残り）」
  };

  const expToNext = calcExp(totalExpToTheLevel, params.srcLevel, params.srcLevel + 1, params.expType);
  const expGot = Math.max(0, Math.min(expToNext - params.expRemaining, expToNext));

  const r = calcExpAndCandy({
    totalExpToTheLevel,
    dreamShardsPerCandy,
    srcLevel: params.srcLevel,
    dstLevel: params.dstLevel,
    expType: params.expType,
    nature: params.nature,
    boost: params.boost,
    expGot,
  });

  console.log("[verify] case:", params);
  console.log("[verify] expToNext:", expToNext, "expGot:", expGot);
  console.log("[verify] result:", r);

  const r50 = calcExpAndCandyByBoostExpRatio({
    totalExpToTheLevel,
    dreamShardsPerCandy,
    srcLevel: params.srcLevel,
    dstLevel: params.dstLevel,
    expType: params.expType,
    nature: params.nature,
    boost: params.boost,
    expGot,
    boostExpRatio: 0.5,
  });
  console.log("[verify] 50% boost ratio result:", r50);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
