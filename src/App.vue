<template>
  <main class="shell">
    <header class="hero">
      <div>
        <p class="kicker">Holiday Candy Boost Planner</p>
        <h1 class="title">CandyBoost Planner</h1>
        <p class="lede">
          複数ポケモンのアメブースト配分を、総アメ・総かけら制約つきでリアルタイムに計画します。
        </p>
      </div>
      <div class="badge">
        <p class="badge__label">MVP</p>
        <p class="badge__value">v0.1</p>
      </div>
    </header>

    <section class="panel">
      <h2 class="panel__title">MVP（1体）: 入力 → 即時計算</h2>
      <div class="grid">
        <label class="field">
          <span class="field__label">現在Lv</span>
          <input v-model.number="srcLevel" type="number" min="1" max="65" class="field__input" />
        </label>
        <label class="field">
          <span class="field__label">目標Lv</span>
          <input v-model.number="dstLevel" type="number" min="1" max="65" class="field__input" />
        </label>
        <label class="field">
          <span class="field__label">あとEXP（次Lvまで）</span>
          <input
            v-model.number="expRemaining"
            type="number"
            min="0"
            class="field__input"
            @input="onExpRemainingInput"
          />
        </label>
        <label class="field">
          <span class="field__label">アメブだけで到達Lv（アメブLv）</span>
          <input
            v-model.number="boostReachLevel"
            type="number"
            :min="srcLevel"
            :max="dstLevel"
            class="field__input"
            @input="onBoostLevelInput"
          />
          <span class="field__sub">
            基本はここを決める（例：目標Lv60 / アメブLv50）。細かい調整は割合/個数で。
          </span>
        </label>
        <label class="field">
          <span class="field__label">アメブ割合（必要EXPに対して）</span>
          <input
            v-model.number="boostRatioPct"
            type="range"
            min="0"
            max="100"
            step="1"
            class="field__range"
            @input="onRatioInput"
          />
          <span class="field__sub">{{ boostRatioPct }}%</span>
        </label>
        <label class="field">
          <span class="field__label">EXPタイプ</span>
          <select v-model.number="expType" class="field__input">
            <option :value="600">600</option>
            <option :value="900">900</option>
            <option :value="1080">1080</option>
            <option :value="1320">1320</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">性格（EXP補正）</span>
          <select v-model="nature" class="field__input">
            <option value="normal">通常</option>
            <option value="up">EXP↑</option>
            <option value="down">EXP↓</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">アメブ種別</span>
          <select v-model="boostKind" class="field__input">
            <option value="full">{{ fullLabel }}</option>
            <option value="mini">{{ miniLabel }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">アメブ個数（表示・手入力）</span>
          <input
            v-model.number="boostCandyInput"
            type="number"
            min="0"
            class="field__input"
            @input="onCandyInput"
          />
          <span class="field__sub">スライダーは経験値割合。個数を直接入力すると割合も追従します。</span>
        </label>
      </div>

      <div class="result">
        <div class="result__row result__row--major">
          <span class="result__k">必要EXP</span>
          <span class="result__v">{{ requiredExp.exp.toLocaleString() }}</span>
        </div>
        <div class="result__row result__row--major">
          <span class="result__k">必要アメ（合計）</span>
          <span class="result__v">{{ (mixed.normalCandy + mixed.boostCandy).toLocaleString() }}</span>
        </div>
        <div class="result__row result__row--major">
          <span class="result__k">必要かけら</span>
          <span class="result__v">{{ mixed.shards.toLocaleString() }}</span>
        </div>
        <div class="result__divider" />
        <div class="result__row">
          <span class="result__k">通常アメ</span>
          <span class="result__v">{{ mixed.normalCandy.toLocaleString() }}</span>
        </div>
        <div class="result__row">
          <span class="result__k">アメブ（使用）</span>
          <span class="result__v">{{ mixed.boostCandy.toLocaleString() }}</span>
        </div>
        <div class="result__row">
          <span class="result__k">かけら内訳</span>
          <span class="result__v">
            通常 {{ mixed.shardsNormal.toLocaleString() }} / アメブ {{ mixed.shardsBoost.toLocaleString() }}
          </span>
        </div>
        <div class="result__row">
          <span class="result__k">アメブだけで到達Lv</span>
          <span class="result__v">{{ boostOnlyFromCandyInput.level }}（expGot {{ boostOnlyFromCandyInput.expGot.toLocaleString() }}）</span>
        </div>
        <div class="result__hint">
          ※ 「あとEXP」はゲーム画面の表示（次Lvまでの残り）を想定し、内部の expGot（獲得済みEXP）に換算しています。
          ※ 計算は nitoyon さんの最新仕様（レベル帯でアメEXPが変化）に合わせています。
          ※ 混在時は「低レベル側から優先的にアメブを使う」前提（MVP）です。
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BoostEvent, ExpGainNature, ExpType } from "./domain";
import { calcExp, calcExpAndCandy, calcExpAndCandyByBoostExpRatio, calcExpAndCandyMixed, calcLevelByCandy } from "./domain/pokesleep";
import { boostRules } from "./domain/pokesleep/boost-config";

const srcLevel = ref(10);
const dstLevel = ref(25);
const expRemaining = ref(0);
const expRemainingTouched = ref(false);
const boostRatioPct = ref(0); // 0..100
const boostCandyInput = ref(0); // 表示・手入力用
const boostReachLevel = ref(25);

const expType = ref<ExpType>(600);
const nature = ref<ExpGainNature>("normal");
const boostKind = ref<Exclude<BoostEvent, "none">>("full");

const fullLabel = computed(
  () => `アメブ（かけら×${boostRules.full.shardMultiplier} / EXP×${boostRules.full.expMultiplier}）`
);
const miniLabel = computed(
  () => `ミニブ（かけら×${boostRules.mini.shardMultiplier} / EXP×${boostRules.mini.expMultiplier}）`
);

const expToNextLevel = computed(() => calcExp(srcLevel.value, srcLevel.value + 1, expType.value));

// ゲーム画面の「あとEXP（残り）」→ 現在レベル内で既に得ているEXP（expGot）へ換算
const expGot = computed(() => {
  const toNext = expToNextLevel.value;
  const remaining = Math.max(0, Math.floor(expRemaining.value));
  if (toNext <= 0) return 0;
  // remaining が toNext を超える入力（誤入力）でも破綻しないように 0..toNext へ丸める
  const got = toNext - Math.min(remaining, toNext);
  return Math.max(0, Math.min(got, toNext));
});

function onExpRemainingInput() {
  expRemainingTouched.value = true;
}

// 入力が 100%（次Lvまでの必要EXP）を超えたら、自動で100%に補正する
watch([expRemaining, expToNextLevel], () => {
  const toNext = expToNextLevel.value;
  if (toNext <= 0) return;
  const clamped = Math.max(0, Math.min(Math.floor(expRemaining.value), toNext));
  if (clamped !== expRemaining.value) expRemaining.value = clamped;
});

// 初期値＆Lv/EXPタイプ変更時は「次Lvまでの必要EXP（100%）」をデフォルトにする
watch(
  [srcLevel, expType],
  () => {
    expRemainingTouched.value = false;
    const toNext = calcExp(srcLevel.value, srcLevel.value + 1, expType.value);
    expRemaining.value = Math.max(0, toNext);
  },
  { immediate: true }
);

const requiredExp = computed(() =>
  calcExpAndCandy({
    srcLevel: srcLevel.value,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: "none",
    expGot: expGot.value,
  })
);

const boostRatio = computed(() => Math.max(0, Math.min(1, boostRatioPct.value / 100)));

// スライダー（割合）→ アメブ個数へ換算（割合指定の計算）
const byRatio = computed(() =>
  calcExpAndCandyByBoostExpRatio({
    srcLevel: srcLevel.value,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    boostExpRatio: boostRatio.value,
    expGot: expGot.value,
  })
);

// アメブ個数（手入力）で計算（個数指定の計算）
const byCandy = computed(() =>
  calcExpAndCandyMixed({
    srcLevel: srcLevel.value,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    boostCandy: boostCandyInput.value,
    expGot: expGot.value,
  })
);

// 入力は「最後に触った方」を優先して、表示が自然になるようにする
const lastEdited = ref<"ratio" | "candy">("ratio");
const mode = ref<"boostLevel" | "ratio" | "candy">("boostLevel");
function onRatioInput() {
  lastEdited.value = "ratio";
  mode.value = "ratio";
}
function onCandyInput() {
  lastEdited.value = "candy";
  mode.value = "candy";
}
function onBoostLevelInput() {
  mode.value = "boostLevel";
}

// 割合スライダーを動かしたら、アメブ到達Lvも連動して“主入力”にする
watch(
  () => boostRatioPct.value,
  () => {
    if (mode.value !== "ratio") return;
    // 先に個数へ同期（ratio→candy watch）が走る → その後 level を合わせる
    const lvl = boostOnlyFromCandyInput.value.level;
    boostReachLevel.value = Math.max(srcLevel.value, Math.min(dstLevel.value, lvl));
  }
);

const boostReachLevelClamped = computed(() => {
  const min = srcLevel.value;
  const max = dstLevel.value;
  const v = Math.floor(boostReachLevel.value);
  return Math.max(min, Math.min(max, v));
});

// 目標「アメブLv」までをアメブだけで上げ、残りを通常アメで埋める（基本モード）
const byBoostLevel = computed(() => {
  const mid = boostReachLevelClamped.value;

  if (mid <= srcLevel.value) {
    return calcExpAndCandyMixed({
      srcLevel: srcLevel.value,
      dstLevel: dstLevel.value,
      expType: expType.value,
      nature: nature.value,
      boost: "none",
      boostCandy: 0,
      expGot: expGot.value,
    });
  }

  const boostOnlyNeed = calcExpAndCandy({
    srcLevel: srcLevel.value,
    dstLevel: mid,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    expGot: expGot.value,
  });

  const boostSeg = calcExpAndCandyMixed({
    srcLevel: srcLevel.value,
    dstLevel: mid,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    boostCandy: boostOnlyNeed.candy,
    expGot: expGot.value,
  });

  const atMid = calcLevelByCandy({
    srcLevel: srcLevel.value,
    dstLevel: mid,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    candy: boostOnlyNeed.candy,
    expGot: expGot.value,
  });

  const normalSeg = calcExpAndCandyMixed({
    srcLevel: mid,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: "none",
    boostCandy: 0,
    expGot: atMid.expGot,
  });

  return {
    exp: boostSeg.exp + normalSeg.exp,
    expNormalApplied: normalSeg.expNormalApplied,
    expBoostApplied: boostSeg.expBoostApplied,
    normalCandy: normalSeg.normalCandy,
    boostCandy: boostSeg.boostCandy,
    shards: boostSeg.shardsBoost + normalSeg.shardsNormal,
    shardsNormal: normalSeg.shardsNormal,
    shardsBoost: boostSeg.shardsBoost,
    boostCandyLeft: 0,
  };
});

const mixed = computed(() => {
  if (mode.value === "boostLevel") return byBoostLevel.value;
  return lastEdited.value === "ratio" ? byRatio.value : byCandy.value;
});

// 同期: ratio→candy（換算結果を表示に反映）
watch(
  () => byRatio.value.boostCandy,
  (next) => {
    if (mode.value !== "ratio") return;
    boostCandyInput.value = next;
  },
  { immediate: true }
);

// 同期: candy→ratio（実際にアメブで入った経験値を、必要EXPで割って割合に戻す）
watch(
  () => byCandy.value,
  (r) => {
    if (mode.value !== "candy") return;
    const base = requiredExp.value.exp;
    const pct = base > 0 ? Math.round((r.expBoostApplied / base) * 100) : 0;
    boostRatioPct.value = Math.max(0, Math.min(100, pct));
  }
);

// 基本モード（アメブLv指定）のときは、表示用のアメブ個数・割合を自動で合わせる
watch(
  () => byBoostLevel.value,
  (r) => {
    if (mode.value !== "boostLevel") return;
    boostCandyInput.value = r.boostCandy;
    const base = requiredExp.value.exp;
    const pct = base > 0 ? Math.round((r.expBoostApplied / base) * 100) : 0;
    boostRatioPct.value = Math.max(0, Math.min(100, pct));
  },
  { immediate: true }
);

// 現在の「アメブ個数（表示・手入力）」で、アメブだけでどこまで上げられるか
const boostOnlyFromCandyInput = computed(() =>
  calcLevelByCandy({
    srcLevel: srcLevel.value,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    candy: boostCandyInput.value,
    expGot: expGot.value,
  })
);

// 割合/個数を触ったときは、到達Lvも追従させる（＝3つ連動）
watch(
  () => boostOnlyFromCandyInput.value.level,
  (lvl) => {
    if (mode.value === "boostLevel") return;
    boostReachLevel.value = Math.max(srcLevel.value, Math.min(dstLevel.value, lvl));
  },
  { immediate: true }
);
</script>

<style scoped>
.shell {
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 18px 64px;
}
.hero {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 18px;
  align-items: start;
  margin-top: 16px;
  margin-bottom: 22px;
}
.kicker {
  font-family: var(--font-body);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 55%, transparent);
}
.title {
  font-family: var(--font-heading);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  font-size: clamp(34px, 5vw, 56px);
  margin: 10px 0 10px;
}
.lede {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.7;
  color: color-mix(in oklab, var(--ink) 72%, transparent);
  max-width: 62ch;
}
.badge {
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 88%, var(--accent) 12%);
  border-radius: 16px;
  padding: 12px 14px;
  min-width: 96px;
}
.badge__label {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
  margin: 0 0 4px;
}
.badge__value {
  font-family: var(--font-heading);
  font-weight: 800;
  margin: 0;
}
.panel {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 96%, var(--ink) 4%);
  border-radius: 18px;
  padding: 18px 18px;
}
.panel__title {
  font-family: var(--font-heading);
  letter-spacing: -0.01em;
  margin: 0 0 10px;
}
.panel__list {
  margin: 0;
  padding-left: 18px;
  font-family: var(--font-body);
  line-height: 1.8;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}
@media (min-width: 860px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.field {
  display: grid;
  gap: 6px;
}
.field--wide {
  grid-column: 1 / -1;
}
.field__label {
  font-family: var(--font-body);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--ink) 62%, transparent);
}
.field__input {
  font: inherit;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  outline: none;
}
.field__range {
  width: 100%;
  accent-color: color-mix(in oklab, var(--accent) 72%, var(--ink) 20%);
}
.field__sub {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
.field__input:focus-visible {
  border-color: color-mix(in oklab, var(--accent) 60%, var(--ink) 20%);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
}
.result {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 18%, transparent);
}
.result__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  font-family: var(--font-body);
}
.result__row--major .result__v {
  font-weight: 800;
}
.result__divider {
  height: 1px;
  background: color-mix(in oklab, var(--ink) 14%, transparent);
  margin: 10px 0 6px;
}
.result__k {
  color: color-mix(in oklab, var(--ink) 62%, transparent);
}
.result__v {
  font-family: var(--font-heading);
  font-weight: 700;
}
.result__hint {
  margin-top: 10px;
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 1.6;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
</style>
