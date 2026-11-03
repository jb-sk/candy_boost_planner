<template>
  <!-- 常に出す。何も選んでいないときは押せない刻みのボタンだけ（見出しは空のまま）。
       見出し・詳細・操作の2段の高さを決めてあり、どの欄を選んでも高さが変わらない（モーダルの高さも変わらない） -->
  <section
    class="fineTuneEditor"
    :class="{ 'fineTuneEditor--idle': row === null }"
    data-testid="fine-tune-editor"
    :data-field="row === null ? undefined : field ?? undefined"
    :data-row-id="row?.id"
    :aria-label="row?.title ?? t('calc.fineTune.hint')"
  >
    <div class="fineTuneEditor__head">
      <template v-if="row !== null">
        <span class="fineTuneEditor__name" data-testid="fine-tune-editor-name">{{ row.title }}</span>
        <!-- EXP補正（性格）。表の名前の横と同じ印 -->
        <span
          v-if="natureMark !== null"
          class="fineTuneEditor__nature fineTuneRow__nature"
          :class="`fineTuneRow__nature--${row.nature}`"
          data-testid="fine-tune-editor-nature"
        >{{ natureMark }}</span>
        <span v-if="fieldLabel !== null" class="fineTuneEditor__field">{{ fieldLabel }}</span>
        <span v-if="changeText !== null" class="fineTuneEditor__change" data-testid="fine-tune-editor-change">{{ changeText }}</span>
        <span class="fineTuneEditor__spacer"></span>
        <!-- この欄を押してからの変更を取り消して、押す前の値へ戻す（選んだまま続けて動かせる） -->
        <button
          class="fineTuneEditor__resetEdit"
          type="button"
          data-testid="fine-tune-editor-reset"
          :title="t('calc.fineTune.resetEditTitle')"
          :disabled="busy || !canReset"
          @click="emit('reset')"
        >
          <svg class="fineTuneEditor__resetIcon" aria-hidden="true" viewBox="0 0 16 16" width="13" height="13"><path d="M3.2 6.2A5 5 0 1 1 3 9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2.6 2.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>{{ t("calc.fineTune.resetEdit") }}</span>
        </button>
      </template>
    </div>

    <p class="fineTuneEditor__info" data-testid="fine-tune-editor-info">
      <span v-for="(item, i) in infoItems" :key="i" :class="`fineTuneEditor__info--${item.tone}`">{{ item.text }}</span>
    </p>

    <!-- 操作は2段。どの欄でも同じ高さの段に置く -->
    <div class="fineTuneEditor__body">
      <!-- 睡眠: 1段目に 200h〜2000h・全て・おひるね島、2段目にチケット・アメ在庫（全て・おひるね島のときだけ） -->
      <template v-if="sleepEditor !== null">
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__options" data-testid="fine-tune-editor-sleep" role="group" :aria-label="t('calc.fineTune.field.sleep')">
            <button
              v-for="option in sleepEditor.options"
              :key="option.key"
              class="fineTuneEditor__option"
              :class="{ 'fineTuneEditor__option--on': option.selected, 'fineTuneEditor__option--wide': option.key === 'nap' }"
              type="button"
              data-testid="fine-tune-editor-sleep-option"
              :data-option="option.key"
              :aria-pressed="option.selected"
              :disabled="busy"
              @click="chooseSleep(option.choice)"
            >
              <template v-if="option.short !== option.label">
                <span class="fineTuneEditor__optionLabel fineTuneEditor__optionLabel--full">{{ option.label }}</span>
                <span class="fineTuneEditor__optionLabel fineTuneEditor__optionLabel--short">{{ option.short }}</span>
              </template>
              <template v-else>{{ option.label }}</template>
            </button>
          </div>
        </div>
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__checks">
            <button
              class="fineTuneEditor__toggle"
              :class="{ 'fineTuneEditor__toggle--on': sleepEditor.ticket }"
              type="button"
              data-testid="fine-tune-editor-sleep-ticket"
              :aria-pressed="sleepEditor.ticket"
              :disabled="busy || !sleepEditor.canTicket"
              @click="toggleSleep('ticket')"
            ><span class="fineTuneEditor__toggleIcon" aria-hidden="true">{{ SLEEP_TICKET_EMOJI }}</span>{{ t("calc.fineTune.sleepOption.ticket") }}</button>
            <button
              class="fineTuneEditor__toggle"
              :class="{ 'fineTuneEditor__toggle--on': sleepEditor.stock }"
              type="button"
              data-testid="fine-tune-editor-sleep-stock"
              :aria-pressed="sleepEditor.stock"
              :disabled="busy || !sleepEditor.canStock"
              @click="toggleSleep('stock')"
            ><span class="fineTuneEditor__toggleIcon" aria-hidden="true">{{ SLEEP_STOCK_EMOJI }}</span>{{ t("calc.fineTune.sleepOption.stock") }}</button>
          </div>
        </div>
      </template>

      <!-- 目標Lv: Lvピッカーと同じ形。1段目に Lv の欄（直接打つ。タッチ端末はテンキー）と ◀ スライダー ▶、2段目に Lv の丸いボタン -->
      <template v-else-if="stepper !== null && field === 'target'">
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__levelRow" data-testid="fine-tune-editor-level">
            <label class="fineTuneEditor__levelInput">
              <span class="fineTuneEditor__levelPrefix" aria-hidden="true">Lv</span>
              <input
                ref="inputRef"
                v-keypad="{ label: stepper.inputLabel, maxLength: 2 }"
                class="field__input fineTuneEditor__input fineTuneEditor__input--level"
                data-testid="fine-tune-editor-input"
                type="text"
                inputmode="numeric"
                maxlength="2"
                autocomplete="off"
                :aria-label="stepper.inputLabel"
                :disabled="busy"
                :value="draft ?? String(stepper.value)"
                @focus="draft = String(stepper.value)"
                @input="onInput(($event.target as HTMLInputElement).value)"
                @blur="onBlur"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              />
            </label>
            <button
              class="fineTuneEditor__step fineTuneEditor__levelStep"
              type="button"
              data-testid="fine-tune-editor-step"
              data-delta="-1"
              :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: '−1' })"
              :disabled="busy || stepper.value <= stepper.min"
              @click="stepBy(-1)"
            >◀</button>
            <input
              class="levelPick__range fineTuneEditor__levelRange"
              type="range"
              data-testid="fine-tune-editor-level-range"
              :aria-label="stepper.inputLabel"
              :min="stepper.min"
              :max="stepper.max"
              step="1"
              :value="stepper.value"
              :disabled="busy"
              @input="setLevel(($event.target as HTMLInputElement).value)"
            />
            <button
              class="fineTuneEditor__step fineTuneEditor__levelStep"
              type="button"
              data-testid="fine-tune-editor-step"
              data-delta="1"
              :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: '+1' })"
              :disabled="busy || stepper.value >= stepper.max"
              @click="stepBy(1)"
            >▶</button>
          </div>
        </div>
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__levelChips">
            <button
              v-for="lv in LEVEL_PRESETS"
              :key="lv"
              type="button"
              class="levelChip fineTuneEditor__levelChip"
              :class="{ 'levelChip--on': lv === stepper.value }"
              data-testid="fine-tune-editor-level-chip"
              :data-level="lv"
              :disabled="busy || lv < stepper.min || lv > stepper.max"
              @click="setLevel(String(lv))"
            >{{ lv }}</button>
          </div>
        </div>
      </template>

      <!-- アメブ・アメ: 1段目に最小アメブ・再計算と「〇〇のLvを上げる」（アメブのとき）、2段目に刻みのボタンと個数欄 -->
      <template v-else-if="stepper !== null">
        <div class="fineTuneEditor__line">
          <div v-if="boostTools !== null" class="fineTuneEditor__tools">
            <!-- 最小アメブ（手持ちのアメから最小限のアメブを自動で決める）と再計算（計算機の ↺ と同じ。自動の値へ戻す） -->
            <button
              class="fineTuneEditor__tool"
              :class="{ 'fineTuneEditor__tool--on': boostTools.minimized }"
              type="button"
              data-testid="fine-tune-editor-minimize"
              :aria-pressed="boostTools.minimized"
              :title="boostTools.minimizeTitle"
              :disabled="busy || (!boostTools.minimized && !boostTools.canTurnOn)"
              @click="emit('op', { kind: 'boostMinimize', rowId: row!.id, on: !boostTools.minimized })"
            >{{ t("calc.fineTune.boostMinimize") }}</button>
            <button
              class="fineTuneEditor__tool"
              type="button"
              data-testid="fine-tune-editor-boost-reset"
              :title="t('calc.fineTune.boostResetTitle')"
              :disabled="busy || !boostTools.manual"
              @click="emit('op', { kind: 'boostReset', rowId: row!.id })"
            >{{ t("calc.fineTune.boostReset") }}</button>
            <button
              v-if="recommendation !== null"
              class="fineTuneEditor__recommend fineTuneEditor__recommend--inline"
              type="button"
              data-testid="fine-tune-editor-recommend"
              :title="recommendTitle"
              :disabled="pending || busy"
              @click="emit('op', { kind: 'set', rowId: row!.id, boost: recommendation.boost })"
            >
              <span class="fineTuneEditor__recommendLabel">{{ recommendLabel }}</span>
              <span class="fineTuneEditor__recommendDelta" data-testid="fine-tune-editor-recommend-delta">{{ t("calc.fineTune.field.boost") }}{{ recommendDelta }}</span>
            </button>
          </div>
        </div>
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__stepper" :class="`fineTuneEditor__stepper--${stepper.steps.length}`">
            <button
              v-for="amount in stepper.steps"
              :key="`down-${amount}`"
              class="fineTuneEditor__step"
              type="button"
              data-testid="fine-tune-editor-step"
              :data-delta="-amount"
              :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: `−${amount}` })"
              :disabled="busy || stepper.value <= stepper.min"
              @click="stepBy(-amount)"
            >−{{ amount }}</button>
            <input
              ref="inputRef"
              v-keypad="stepper.inputLabel"
              class="field__input fineTuneEditor__input"
              data-testid="fine-tune-editor-input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :aria-label="stepper.inputLabel"
              :disabled="busy"
              :value="draft ?? String(stepper.value)"
              @focus="draft = String(stepper.value)"
              @input="onInput(($event.target as HTMLInputElement).value)"
              @blur="onBlur"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
            <button
              v-for="amount in [...stepper.steps].reverse()"
              :key="`up-${amount}`"
              class="fineTuneEditor__step"
              type="button"
              data-testid="fine-tune-editor-step"
              :data-delta="amount"
              :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: `+${amount}` })"
              :disabled="busy || stepper.value >= stepper.max"
              @click="stepBy(amount)"
            >+{{ amount }}</button>
          </div>
        </div>
      </template>

      <!-- 行の詳細（名前を押したとき）: 1段目に現在Lv・あとEXP・アメ在庫の欄（直接打つ。タッチ端末はテンキー）、
           2段目に動かせない理由か「〇〇のLvを上げる」 -->
      <template v-else-if="rowProps !== null">
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__props">
            <label
              v-for="prop in rowProps"
              :key="prop.key"
              class="fineTuneEditor__prop"
              :class="{ 'fineTuneEditor__prop--changed': prop.value !== prop.base, 'fineTuneEditor__prop--disabled': prop.disabled }"
            >
              <span class="fineTuneEditor__propLabel">{{ prop.label }}</span>
              <input
                v-keypad="{ label: prop.inputLabel, maxLength: prop.maxLength }"
                class="fineTuneEditor__propInput"
                data-testid="fine-tune-editor-prop"
                :data-prop="prop.key"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                :maxlength="prop.maxLength"
                :aria-label="prop.inputLabel"
                :disabled="busy || prop.disabled"
                :value="propDraft?.key === prop.key ? propDraft.text : prop.value === null ? '' : String(prop.value)"
                @focus="propDraft = { key: prop.key, text: prop.value === null ? '' : String(prop.value) }"
                @input="onPropInput(prop.key, ($event.target as HTMLInputElement).value)"
                @blur="onPropBlur(prop.key, $event.target as HTMLInputElement)"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              />
            </label>
          </div>
        </div>
        <div class="fineTuneEditor__line">
          <p v-if="noteText !== null" class="fineTuneEditor__note" data-testid="fine-tune-editor-note">{{ noteText }}</p>
          <button
            v-else-if="recommendation !== null"
            class="fineTuneEditor__recommend"
            type="button"
            data-testid="fine-tune-editor-recommend"
            :title="recommendTitle"
            :disabled="pending || busy"
            @click="emit('op', { kind: 'set', rowId: row!.id, boost: recommendation.boost })"
          >
            <span class="fineTuneEditor__recommendLabel">{{ recommendLabel }}</span>
            <span class="fineTuneEditor__recommendDelta" data-testid="fine-tune-editor-recommend-delta">{{ t("calc.fineTune.field.boost") }}{{ recommendDelta }}</span>
            <span v-if="recommendation.insufficient" class="fineTuneEditor__recommendNote">{{ t("calc.fineTune.recommendInsufficient") }}</span>
          </button>
        </div>
      </template>

      <!-- 何も選んでいないとき（と、選んだ欄が動かせなくなったとき）: 2段目に同じ形の押せないボタン（操作の場所を見せたままにする） -->
      <template v-else>
        <div class="fineTuneEditor__line"></div>
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__stepper fineTuneEditor__stepper--3 fineTuneEditor__stepper--ghost" data-testid="fine-tune-editor-idle" aria-hidden="true">
            <button v-for="amount in IDLE_STEPS" :key="`down-${amount}`" class="fineTuneEditor__step" type="button" tabindex="-1" disabled>−{{ amount }}</button>
            <input class="field__input fineTuneEditor__input" type="text" tabindex="-1" disabled value="" />
            <button v-for="amount in [...IDLE_STEPS].reverse()" :key="`up-${amount}`" class="fineTuneEditor__step" type="button" tabindex="-1" disabled>+{{ amount }}</button>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp, RowExclusion } from "../domain/fine-tune/draft";
import type { FineTuneRowView } from "../domain/fine-tune/rowView";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { vKeypad } from "../composables/useNumericKeypad";
import {
  FINE_TUNE_STEPS,
  LEVEL_PRESETS,
  SLEEP_STOCK_EMOJI,
  SLEEP_TICKET_EMOJI,
  sleepReachText,
  sleepTargetText,
  type FineTuneField,
} from "../utils/fineTuneView";
import { SLEEP_TARGET_HOURS_OPTIONS } from "../domain/types";
import { sleepTargetOfChoice, type SleepTargetChoice } from "../domain/sleep-target";

/**
 * かんたんの調整バー。表で押した欄（目標Lv・アメブ・アメ）を刻みのボタンと個数欄で、睡眠を選択肢で動かす。
 * 目標Lvは Lvピッカーと同じ形（Lv の欄・スライダー・◀ ▶・Lv の丸いボタン）。アメブには最小アメブ・再計算も置く。
 * 見出しのリセットは、この欄を押してからの変更を取り消す（戻すのは親。`canReset` と `reset`）。
 * 行の詳細（名前を押したとき）では、現在Lv・あとEXP（個体）とアメ在庫（その行の進化系）を直接打って変えられる。
 * 到達・睡眠のあと・足りないもの・動かせない理由と「〇〇のLvを上げる」もここに出す。見出しの名前の横に EXP補正（▲▲▼▼）を出す。
 * 見出し・詳細・操作の2段はどの欄でも同じ高さ（選ぶ欄を変えても、調整バーとモーダルの高さが変わらない）。
 * 値と範囲は `FineTuneRowView` に入っているものを使い、op を投げるだけ（範囲に収めるのは reducer）。
 */
const props = defineProps<{
  /** 選んだ行。何も選んでいなければ null（押せない刻みのボタンだけを出す） */
  row: FineTuneRowView | null;
  field: FineTuneField | null;
  /** 最新の結果が今の下書きの結果でない。結果に頼る操作（おすすめ）を押せなくする */
  pending: boolean;
  /** 「全体のLvを伸ばす」を求めている間。どの操作も押せなくする */
  busy: boolean;
  /** 設定で全員に最小アメブを使っている（行ごとの最小アメブは切り替えられない） */
  globalMinimize: boolean;
  /** この欄を押してから変えた（リセットで押す前へ戻せる） */
  canReset: boolean;
  fmt: (n: number) => string;
  titleOf: (rowId: string) => string;
}>();

const emit = defineEmits<{
  (e: "op", op: FineTuneOp): void;
  /** リセット（この欄を押す前の値へ戻す。選択はそのまま） */
  (e: "reset"): void;
}>();

/** 何も選んでいないときに並べる、押せない刻みのボタン */
const IDLE_STEPS = FINE_TUNE_STEPS.boost;

const { t } = useI18n();

const EXCLUSION_TEXT: Readonly<Record<RowExclusion, string>> = {
  candyTarget: "calc.fineTune.exclusion.candyTarget",
  noCandy: "calc.fineTune.exclusion.noCandy",
  sleepOnly: "calc.fineTune.exclusion.sleepOnly",
  maxLevel: "calc.fineTune.exclusion.maxLevel",
  unknownPokemon: "calc.fineTune.exclusion.unknownPokemon",
};

const FACTOR_TEXT = {
  candy: "calc.fineTune.factor.candy",
  shards: "calc.fineTune.factor.shards",
  boost: "calc.fineTune.factor.boost",
} as const;

interface Stepper {
  label: string;
  inputLabel: string;
  value: number;
  base: number;
  min: number;
  max: number;
  steps: readonly number[];
  stepOp: (by: number) => FineTuneOp;
  setOp: (value: number) => FineTuneOp;
}

/** 選んだ欄の刻み・範囲・op。動かせない欄（行の詳細）は null */
const stepper = computed<Stepper | null>(() => {
  const { row, field } = props;
  if (row === null) return null;
  const rowId = row.id;
  const labelOf = (key: "target" | "boost" | "candy") => t(`calc.fineTune.field.${key}`);
  const inputLabelOf = (label: string) => t("calc.fineTune.inputAria", { field: label, name: row.title });
  if (field === "target" && row.levelAdjustable) {
    const label = labelOf("target");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.targetLevel.value,
      base: row.targetLevel.base,
      min: row.targetLevel.range.min,
      max: row.targetLevel.range.max,
      // 目標Lvは刻みのボタンでなく、Lvピッカーと同じ形（◀ ▶・スライダー・Lv の丸いボタン）で動かす
      steps: [],
      stepOp: (by) => ({ kind: "targetStep", rowId, by }),
      setOp: (level) => ({ kind: "targetSet", rowId, level }),
    };
  }
  if (field === "boost" && row.levelAdjustable && row.boost !== null) {
    const label = labelOf("boost");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.boost.value,
      base: row.boost.base,
      min: row.boost.range.min,
      max: row.boost.range.max,
      steps: FINE_TUNE_STEPS.boost,
      stepOp: (by) => ({ kind: "step", rowId, by }),
      setOp: (boost) => ({ kind: "set", rowId, boost }),
    };
  }
  if (field === "candy" && row.candyEdit !== null) {
    const label = labelOf("candy");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.candyEdit.value,
      base: row.candyEdit.base,
      min: row.candyEdit.min,
      max: row.candyEdit.max,
      steps: FINE_TUNE_STEPS.candy,
      stepOp: (by) => ({ kind: "candyStep", rowId, by }),
      setOp: (candy) => ({ kind: "candySet", rowId, candy }),
    };
  }
  return null;
});

/** 見出しの欄の名前（行の詳細・何も選んでいないときは出さない） */
const fieldLabel = computed(() => {
  if (props.row === null) return null;
  if (stepper.value !== null) return stepper.value.label;
  return props.field === "sleep" ? t("calc.fineTune.field.sleep") : null;
});

/** 基準からの変化（変わっていなければ null）。睡眠は目標の名前で出す */
const changeText = computed(() => {
  const { row, field } = props;
  if (row !== null && field === "sleep") {
    if (!row.sleepTarget.changed) return null;
    const label = (choice: SleepTargetChoice) => {
      const text = sleepTargetText(t, choice);
      return `${choice.base === "none" ? t("calc.fineTune.sleepOption.none") : text.name}${text.icons}`;
    };
    return `${label(row.sleepTarget.base)} → ${label(row.sleepTarget.choice)}`;
  }
  const s = stepper.value;
  if (s === null || s.value === s.base) return null;
  return `${props.fmt(s.base)} → ${props.fmt(s.value)}`;
});

/** EXP補正（性格）の印。補正なしは null */
const natureMark = computed(() => {
  const nature = props.row?.nature;
  if (nature === "up") return t("calc.row.natureUp");
  if (nature === "down") return t("calc.row.natureDown");
  return null;
});

// ===== 行の詳細 =====
/** 詳細の1つ。`danger` は足りないもの、`note` は睡眠の欄で出す動かせない理由 */
type InfoTone = "normal" | "danger" | "note";

const infoItems = computed(() => {
  const { row } = props;
  const items: Array<{ text: string; tone: InfoTone }> = [];
  if (row === null) return items;
  const level = row.reachLevel.value;
  if (level !== null) {
    const exp = row.expToNext.value;
    // 計算機の行と同じ「到達Lv 63（あとEXP 358）」。あとEXP は次のLvまでのEXP
    const left = level < MAX_LEVEL && exp !== null && exp > 0 ? t("calc.fineTune.expLeft", { exp: props.fmt(exp) }) : "";
    items.push({ text: `${t("calc.fineTune.reach", { level })}${left}`, tone: "normal" });
  }
  if (row.sleepReach !== null) {
    const key = row.sleepReach.kind === "napIsland" ? "calc.fineTune.napReach" : "calc.fineTune.sleepReach";
    items.push({ text: t(key, { level: sleepReachText(row.sleepReach) }), tone: "normal" });
  }
  if (row.limitingFactor !== null) {
    items.push({ text: t("calc.fineTune.short", { factor: t(FACTOR_TEXT[row.limitingFactor]) }), tone: "danger" });
  }
  const cappedTo = row.boost?.cappedTo ?? null;
  if (props.field === "boost" && cappedTo !== null) {
    items.push({ text: t("calc.fineTune.boostCapped", { count: props.fmt(cappedTo) }), tone: "normal" });
  }
  // 睡眠の欄は操作の2段を選択肢で使うので、睡眠に関わる理由（アメを使わない・睡眠だけで届く など）はここに添える。
  // 個数指定（目標Lv・アメブを動かせない）は睡眠の操作に関わらないので出さない
  if (props.field === "sleep" && row.exclusion !== null && row.exclusion !== "candyTarget") {
    items.push({ text: t(EXCLUSION_TEXT[row.exclusion]), tone: "note" });
  }
  return items;
});

/** 目標Lv・アメブを動かせない理由（行の詳細で出す。睡眠の欄は詳細の行に添える） */
const noteText = computed(() => {
  const { row, field } = props;
  if (row === null || field !== "row") return null;
  if (row.candyEdited) return t("calc.fineTune.candyEdited");
  return row.exclusion === null ? null : t(EXCLUSION_TEXT[row.exclusion]);
});

// ===== 「〇〇のLvを上げる」（行の詳細とアメブで出す） =====
const recommendation = computed(() => {
  if (props.row === null || (props.field !== "row" && props.field !== "boost")) return null;
  if (!props.row.levelAdjustable) return null;
  return props.row.advice?.recommendation ?? null;
});

const recommendLabel = computed(() => {
  const rec = recommendation.value;
  if (rec === null) return "";
  return t(rec.andOthers ? "calc.fineTune.recommendMany" : "calc.fineTune.recommend", { name: props.titleOf(rec.targetRowId) });
});

/** 「〇〇のLvを上げる」の全文（狭い幅では名前を省くので、ホバーで全文を出す） */
const recommendTitle = computed(() => {
  const rec = recommendation.value;
  if (rec === null) return undefined;
  const text = `${recommendLabel.value} ${t("calc.fineTune.field.boost")}${recommendDelta.value}`;
  return rec.insufficient ? `${text}（${t("calc.fineTune.recommendInsufficient")}）` : text;
});

const recommendDelta = computed(() => {
  const rec = recommendation.value;
  const current = props.row?.boost?.value;
  if (rec === null || current === undefined) return "";
  const delta = rec.boost - current;
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${props.fmt(Math.abs(delta))}`;
});

// ===== アメブの最小アメブ・リセット =====
const boostTools = computed(() => {
  const { row, field } = props;
  if (row === null || field !== "boost" || !row.levelAdjustable || row.boost === null) return null;
  const { minimized, canMinimize, shortCandy, manual } = row.boost;
  // アメが足りず最小アメブにしても届かない行は入れられない（入れても既定のアメブへ戻るだけ）。入っていれば外せる
  const canTurnOn = canMinimize && !shortCandy;
  const minimizeTitle = props.globalMinimize
    ? t("calc.fineTune.boostMinimizeGlobal")
    : !canMinimize && !minimized ? t("calc.fineTune.boostMinimizeUnavailable")
      : shortCandy ? t("calc.fineTune.boostMinimizeShortCandy")
        : t("calc.fineTune.boostMinimizeTitle");
  return { minimized, canTurnOn, manual, minimizeTitle };
});

// ===== 睡眠目標 =====
const sleepEditor = computed(() => {
  const { row, field } = props;
  if (row === null || field !== "sleep") return null;
  const current = row.sleepTarget.choice;
  const stock = (current.base === "sleep" || current.base === "napIsland") && current.stock;
  const ticket = current.base === "napIsland" && current.ticket;
  const none = t("calc.fineTune.sleepOption.none");
  const all = t("calc.fineTune.sleepOption.all");
  // おひるね島だけ、とても狭い幅では「島」と縮める（表の睡眠の欄と同じ）
  const options: Array<{ key: string; label: string; short: string; choice: SleepTargetChoice; selected: boolean }> = [
    { key: "none", label: none, short: none, choice: { base: "none" }, selected: current.base === "none" },
    ...SLEEP_TARGET_HOURS_OPTIONS.map((hours) => {
      const name = sleepTargetText(t, { base: "hours", hours }).name;
      return {
        key: `h${hours}`,
        label: name,
        short: name,
        choice: { base: "hours", hours } as SleepTargetChoice,
        selected: current.base === "hours" && current.hours === hours,
      };
    }),
    // 全て・おひるね島へ移るときは、アメ在庫の印を持ち越す（チケットはおひるね島どうしだけ）
    { key: "sleep", label: all, short: all, choice: { base: "sleep", stock }, selected: current.base === "sleep" },
    {
      key: "nap",
      label: t("calc.fineTune.sleepOption.nap"),
      short: t("calc.fineTune.sleepOption.napShort"),
      choice: { base: "napIsland", stock, ticket },
      selected: current.base === "napIsland",
    },
  ];
  return {
    options,
    stock,
    ticket,
    canStock: current.base === "sleep" || current.base === "napIsland",
    canTicket: current.base === "napIsland",
  };
});

function chooseSleep(choice: SleepTargetChoice): void {
  if (props.row === null) return;
  emit("op", { kind: "sleepSet", rowId: props.row.id, target: sleepTargetOfChoice(choice) });
}

function toggleSleep(which: "stock" | "ticket"): void {
  const current = props.row?.sleepTarget.choice;
  if (current === undefined) return;
  if (current.base === "sleep" && which === "stock") chooseSleep({ ...current, stock: !current.stock });
  if (current.base === "napIsland") chooseSleep({ ...current, [which]: !current[which] });
}

// ===== 行の詳細の欄: 現在Lv・あとEXP・アメ在庫（確定は blur。テンキーは ui_spec §8） =====
type RowPropKey = "srcLevel" | "exp" | "stock";

interface RowProp {
  key: RowPropKey;
  label: string;
  inputLabel: string;
  /** 今の値（種族不明の行の在庫は null） */
  value: number | null;
  base: number | null;
  disabled: boolean;
  /** テンキーで打てる桁数 */
  maxLength: number;
  op: (value: number) => FineTuneOp;
}

const rowProps = computed<RowProp[] | null>(() => {
  const { row, field } = props;
  if (row === null || field !== "row") return null;
  const rowId = row.id;
  const { srcLevel, expRemaining, editable } = row.individual;
  const inputLabelOf = (label: string) => t("calc.fineTune.inputAria", { field: label, name: row.title });
  const levelLabel = t("calc.row.srcLevel");
  const expLabel = t("calc.row.expRemaining");
  const stockLabel = t("calc.row.speciesCandy");
  return [
    {
      key: "srcLevel",
      label: levelLabel,
      inputLabel: inputLabelOf(levelLabel),
      value: srcLevel.value,
      base: srcLevel.base,
      disabled: !editable,
      maxLength: 2,
      op: (level) => ({ kind: "srcLevelSet", rowId, level }),
    },
    {
      key: "exp",
      label: expLabel,
      inputLabel: inputLabelOf(expLabel),
      value: expRemaining.value,
      base: expRemaining.base,
      // Lv70 は次のLvが無い
      disabled: !editable || expRemaining.max <= 0,
      maxLength: 6,
      op: (exp) => ({ kind: "expRemainingSet", rowId, exp }),
    },
    {
      key: "stock",
      label: stockLabel,
      inputLabel: inputLabelOf(stockLabel),
      value: row.stock?.value ?? null,
      base: row.stock?.base ?? null,
      disabled: row.stock === null,
      maxLength: 7,
      op: (count) => ({ kind: "stockSet", rowId, count }),
    },
  ];
});

/** 打ちかけの欄と文字（フォーカスしている間だけ） */
const propDraft = ref<{ key: RowPropKey; text: string } | null>(null);

function onPropInput(key: RowPropKey, raw: string): void {
  propDraft.value = { key, text: raw.replace(/[^0-9]/g, "") };
}

function onPropBlur(key: RowPropKey, el: HTMLInputElement): void {
  const draftText = propDraft.value?.key === key ? propDraft.value.text : null;
  propDraft.value = null;
  const prop = rowProps.value?.find((p) => p.key === key);
  if (prop !== undefined && draftText !== null && draftText !== "" && Number(draftText) !== prop.value) {
    emit("op", prop.op(Number(draftText)));
  }
  // 範囲に収めた結果が元の値と同じときも、欄に打ちかけの文字を残さない
  void nextTick(() => {
    const now = rowProps.value?.find((p) => p.key === key);
    if (now !== undefined) el.value = now.value === null ? "" : String(now.value);
  });
}

// ===== 刻みのボタンと個数欄・目標Lvの欄（確定は blur。テンキーは ui_spec §8） =====
function stepBy(by: number): void {
  const s = stepper.value;
  if (s !== null) emit("op", s.stepOp(by));
}

/** 目標Lvのスライダー・Lv の丸いボタン（欄に打った値は blur で setOp） */
function setLevel(raw: string): void {
  const s = stepper.value;
  const level = Number(raw);
  if (s !== null && Number.isFinite(level) && level !== s.value) emit("op", s.setOp(level));
}

const inputRef = ref<HTMLInputElement | null>(null);
const draft = ref<string | null>(null);

function onInput(raw: string): void {
  draft.value = raw.replace(/[^0-9]/g, "");
}

function onBlur(): void {
  const value = draft.value;
  draft.value = null;
  const s = stepper.value;
  if (s !== null && value !== null && value !== "" && Number(value) !== s.value) emit("op", s.setOp(Number(value)));
  // 範囲の端に合わせた結果が元の値と同じときも、欄に打ちかけの文字を残さない
  void nextTick(() => {
    const el = inputRef.value;
    if (el && stepper.value !== null) el.value = String(stepper.value.value);
  });
}
</script>
