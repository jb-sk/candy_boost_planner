<template>
  <!-- 常に出す。何も選んでいないときは設定欄（見出しは「設定」。詳細の段には「その他の設定はこちら」）。
       見出し・詳細・操作の2段の高さを決めてあり、どの欄を選んでも高さが変わらない（モーダルの高さも変わらない）。
       ツールチップ（title）は付けない（スマホで出ないため） -->
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
        <!-- 行の詳細（名前を押したとき）は、名前をニックネームの欄にする（ボックスのニックネーム欄と同じ。空にすると種族名の表示）。
             確定（Enter・欄を離れる）で下書きに入り、OK でボックスの個体へ書く。リンク切れの行は変えられないので名前だけ -->
        <input
          v-if="field === 'row' && row.nickname !== null"
          class="fineTuneEditor__nameInput"
          :class="{ 'fineTuneEditor__nameInput--changed': row.nickname.value !== row.nickname.base }"
          data-testid="fine-tune-editor-nickname"
          type="text"
          autocomplete="off"
          :aria-label="t('box.detail.nickname')"
          :placeholder="row.nickname.placeholder"
          :value="row.nickname.value"
          :disabled="busy"
          @change="emit('op', { kind: 'nicknameSet', rowId: row.id, nickname: ($event.target as HTMLInputElement).value })"
          @keydown.enter="onNicknameEnter"
        />
        <span v-else class="fineTuneEditor__name" data-testid="fine-tune-editor-name">{{ row.title }}</span>
        <!-- EXP補正（性格）。表の名前の横と同じ印 -->
        <span
          v-if="natureMark !== null"
          class="fineTuneEditor__nature fineTuneRow__nature"
          :class="`fineTuneRow__nature--${row.nature}`"
          data-testid="fine-tune-editor-nature"
        >{{ natureMark }}</span>
        <span v-if="fieldLabel !== null" class="fineTuneEditor__field">{{ fieldLabel }}</span>
        <!-- 開いた時点の値は薄く、今の値は色を付けて出す（文字は「882 → 926」のまま） -->
        <span v-if="change !== null" class="fineTuneEditor__change" data-testid="fine-tune-editor-change"><span class="fineTuneEditor__changeFrom">{{ change.from }}</span><span class="fineTuneEditor__changeArrow"> → </span><span class="fineTuneEditor__changeTo">{{ change.to }}</span></span>
      </template>
      <!-- 何も選んでいないとき: 設定欄。行を選んだときの名前と同じ形の見出しに、調整の印を添える -->
      <template v-else-if="settings !== null">
        <svg class="fineTuneEditor__settingsIcon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M2.5 4.5h11M2.5 11.5h11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="6" cy="4.5" r="2.2" fill="currentColor"/><circle cx="10.5" cy="11.5" r="2.2" fill="currentColor"/></svg>
        <span class="fineTuneEditor__name" data-testid="fine-tune-editor-settings-label">{{ t("calc.fineTune.field.settings") }}</span>
      </template>
      <template v-if="row !== null || settings !== null">
        <span class="fineTuneEditor__spacer"></span>
        <!-- 選んだポケモンを、開いた時点の状態へまるごと戻す（どの欄で押しても同じ。選んだまま続けて動かせる）。
             何も選んでいないときは、設定を開いた時点の値へ戻す -->
        <button
          class="fineTuneEditor__resetEdit"
          type="button"
          data-testid="fine-tune-editor-reset"
          :disabled="busy || !canReset"
          @click="emit('reset')"
        >
          <svg class="fineTuneEditor__resetIcon" aria-hidden="true" viewBox="0 0 16 16" width="13" height="13"><path d="M3.2 6.2A5 5 0 1 1 3 9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2.6 2.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>{{ t("calc.fineTune.resetEdit") }}</span>
        </button>
      </template>
    </div>

    <p class="fineTuneEditor__info" data-testid="fine-tune-editor-info">
      <!-- 設定欄: シンプルに無い設定は、計算機の設定（在庫・睡眠設定）で変える。開くとシンプルは閉じる（下書きがあれば確かめる） -->
      <i18n-t v-if="row === null && settings !== null" keypath="calc.fineTune.moreSettings" tag="span" class="fineTuneEditor__more" scope="global">
        <template #link>
          <button
            class="fineTuneEditor__link"
            type="button"
            data-testid="fine-tune-editor-more-settings"
            :disabled="busy"
            @click="emit('open-settings', $event.currentTarget as HTMLElement)"
          >{{ t("calc.fineTune.moreSettingsLink") }}</button>
        </template>
      </i18n-t>
      <span v-for="(item, i) in infoItems" :key="i" :class="`fineTuneEditor__info--${item.tone}`">{{ item.text }}</span>
    </p>

    <!-- 操作は2段。どの欄でも同じ高さの段に置く -->
    <div class="fineTuneEditor__body">
      <!-- 睡眠: 1段目に 200h〜2000h・睡眠・おひるね島、2段目にチケット・アメ在庫（睡眠・おひるね島のときだけ） -->
      <FineTuneSleepBody
        v-if="row !== null && field === 'sleep'"
        :row="row"
        :busy="busy"
        @op="relayOp"
      />

      <!-- アメブ・アメ: 1段目にアメブ目標Lv・最小限のアメブ・再割当（アメブのとき）、2段目に刻みのボタンと個数欄 -->
      <FineTuneStepperBody
        v-else-if="row !== null && stepper !== null"
        :row="row"
        :field="field"
        :stepper="stepper"
        :busy="busy"
        :fmt="fmt"
        @op="relayOp"
      />

      <!-- 行の詳細（名前を押したとき）: 現在Lv・あとEXP・アメ在庫の欄、動かせない理由と「計算機から削除」 -->
      <FineTuneRowDetailBody
        v-else-if="row !== null && field === 'row'"
        :row="row"
        :busy="busy"
        :can-remove="canRemove"
        :fmt="fmt"
        @op="relayOp"
        @remove="emit('remove')"
      />

      <!-- 何も選んでいないとき: 設定欄（下書き。OK で計算機の設定・在庫へ入る） -->
      <FineTuneSettingsBody
        v-else-if="row === null && settings !== null"
        :settings="settings"
        :has-boost="hasBoost"
        :busy="busy"
        :fmt="fmt"
        @op="relayOp"
      />

      <!-- 選んだ欄が動かせなくなったとき: 2段とも空ける（高さはそのまま） -->
      <template v-else>
        <div class="fineTuneEditor__line"></div>
        <div class="fineTuneEditor__line"></div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { CalcSettingsSnapshot } from "../composables/useCalcStore";
import type { FineTuneRowView } from "../domain/fine-tune/rowView";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import type { HistoryRecordOptions } from "../composables/useHistory";
import FineTuneRowDetailBody from "./FineTuneRowDetailBody.vue";
import FineTuneSettingsBody from "./FineTuneSettingsBody.vue";
import FineTuneSleepBody from "./FineTuneSleepBody.vue";
import FineTuneStepperBody from "./FineTuneStepperBody.vue";
import {
  EXCLUSION_TEXT,
  FINE_TUNE_STEPS,
  natureMarkText,
  sleepReachText,
  sleepTargetText,
  type FineTuneField,
  type FineTuneStepper,
} from "../utils/fineTuneView";
import type { SleepTargetChoice } from "../domain/sleep-target";

/**
 * シンプルの調整バー。表で押した欄（アメブ・アメ）を刻みのボタンと個数欄で、睡眠を選択肢で動かす。
 * 目標Lvは調整バーを使わない（表の欄を押すとその場で Lvピッカーを開く。FineTuneRow）。
 * 現在Lv・アメブ目標Lvは同じ形の Lv の欄（`FineTuneLevelField`。直接打つか、計算機と同じ Lvピッカー）。
 * アメブにはアメブ目標Lv・最小限のアメブ・再割当も置く（2段に収める）。
 * 見出しのリセットは、選んだポケモンをモーダルを開いた時点の状態へまるごと戻す（戻すのは親。`canReset` と `reset`）。
 * 行の詳細（名前を押したとき）では、現在Lv・あとEXP（個体）とアメ在庫（その行の進化系）を直接打って変えられる。
 * 到達・睡眠のあと・足りないもの・動かせない理由もここに出す。見出しの名前の横に EXP補正（▲▲▼▼）を出す。
 * 見出し・詳細・操作の2段はどの欄でも同じ高さ（選ぶ欄を変えても、調整バーとモーダルの高さが変わらない）。
 * 値と範囲は `FineTuneRowView` に入っているものを使い、op を投げるだけ（範囲に収めるのは reducer）。
 */
const props = defineProps<{
  /** 選んだ行。何も選んでいなければ null（設定欄を出す） */
  row: FineTuneRowView | null;
  field: FineTuneField | null;
  /** 「全体のLvを伸ばす」を求めている間。どの操作も押せなくする */
  busy: boolean;
  /** 選んだポケモン（何も選んでいないときは設定）が開いた時点から変わっている（リセットで開いた時点へ戻せる） */
  canReset: boolean;
  /** 計算機から削除できる（下書きに2匹以上いる。最後の1匹は外せない） */
  canRemove: boolean;
  /** 設定欄（何も選んでいないときに出す）の、下書きで効いている値と開いた時点の値 */
  settings: { value: CalcSettingsSnapshot; base: CalcSettingsSnapshot } | null;
  /** アメブのあるスロット（設定欄に既定のアメブ目標Lv・最小限のアメブを出す） */
  hasBoost: boolean;
  fmt: (n: number) => string;
}>();

const emit = defineEmits<{
  /** `coalesce` は Lv の欄のスライダーの1回のドラッグの目印（元に戻すの1件にまとめる） */
  (e: "op", op: FineTuneOp, coalesce?: HistoryRecordOptions): void;
  /** リセット（選んだポケモンを開いた時点の状態へ戻す。何も選んでいないときは設定を戻す。選択はそのまま） */
  (e: "reset"): void;
  /** 行の詳細の「計算機から削除」（選んでいるポケモンを下書きから外す。選択は外れる） */
  (e: "remove"): void;
  /** 計算機の設定（在庫・睡眠設定）を開く。`trigger` は押したリンク（確認をやめたときにフォーカスを戻す） */
  (e: "open-settings", trigger: HTMLElement | null): void;
}>();

const { t } = useI18n();

const FACTOR_TEXT = {
  candy: "calc.fineTune.factor.candy",
  shards: "calc.fineTune.factor.shards",
  boost: "calc.fineTune.factor.boost",
} as const;

/** 選んだ欄の刻み・範囲・op。動かせない欄（行の詳細）は null */
const stepper = computed<FineTuneStepper | null>(() => {
  const { row, field } = props;
  if (row === null) return null;
  const rowId = row.id;
  // アメブのあるスロットのアメはアメブを含む合計なので「アメ合計」（計算機と同じ）。t() に組み立てたキーは渡さない
  const labelOf = (key: "boost" | "candy") =>
    key === "boost" ? t("calc.fineTune.field.boost")
    : props.hasBoost ? t("calc.fineTune.field.candyTotal")
    : t("calc.fineTune.field.candy");
  const inputLabelOf = (label: string) => t("calc.fineTune.inputAria", { field: label, name: row.title });
  // 目標Lvは調整バーを使わない（表の欄を押すとその場で Lvピッカーを開く。FineTuneRow）。
  // 個数指定の行（アメの数を変えた行を含む）は、計算機と同じくアメブも動かせる（アメブはアメの数の内訳）
  if (field === "boost" && row.exclusion === null && row.boost !== null) {
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

/** 基準からの変化（変わっていなければ null）。睡眠は目標の名前で出す。見出しには「from → to」の形で並べる */
const change = computed<{ from: string; to: string } | null>(() => {
  const { row, field } = props;
  if (row !== null && field === "sleep") {
    if (!row.sleepTarget.changed) return null;
    const label = (choice: SleepTargetChoice) => {
      const text = sleepTargetText(t, choice);
      return `${choice.base === "none" ? t("calc.fineTune.sleepOption.none") : text.name}${text.icons}`;
    };
    return { from: label(row.sleepTarget.base), to: label(row.sleepTarget.choice) };
  }
  const s = stepper.value;
  if (s === null || s.value === s.base) return null;
  return { from: props.fmt(s.base), to: props.fmt(s.value) };
});

/** EXP補正（性格）の印。補正なしは null */
const natureMark = computed(() => (props.row === null ? null : natureMarkText(t, props.row.nature)));

// ===== 行の詳細 =====
/** 詳細の1つ。`danger` は足りないもの、`note` は睡眠の欄で出す動かせない理由 */
type InfoTone = "normal" | "danger" | "note";

const infoItems = computed(() => {
  const { row } = props;
  const items: Array<{ text: string; tone: InfoTone }> = [];
  // 設定欄（何も選んでいないとき）は詳細を出さない。空いた段は見出しが使う（CSS の .fineTuneEditor--idle）
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
  if (props.field === "boost" && row.boost !== null) {
    // 最小限のアメブが入っているのに、アメが足りず目標に届かない（既定のアメブ目標Lvを使っている）。計算機の警告と同じ
    if (row.boost.minimizeFallback) items.push({ text: shortCandyText(row.boost.neededCandy), tone: "danger" });
    // アメ在庫の睡眠目標の行で、保存した個数のうち在庫の分だけを使う
    const capped = row.boost.capped;
    if (capped !== null) {
      items.push({ text: t("calc.fineTune.boostCapped", { saved: props.fmt(capped.saved), count: props.fmt(capped.used) }), tone: "normal" });
    }
  }
  // 睡眠の欄は操作の2段を選択肢で使うので、睡眠に関わる理由（睡眠だけで届く など）はここに添える
  const exclusionKey = row.exclusion === null ? null : EXCLUSION_TEXT[row.exclusion];
  if (props.field === "sleep" && exclusionKey !== null) {
    items.push({ text: t(exclusionKey), tone: "note" });
  }
  return items;
});


/** 「〇個以上のアメが必要です」（計算機の個数指定の最小アメブ計算と同じ言い方）。数が分からなければ「アメが足りません」 */
function shortCandyText(neededCandy: number | null): string {
  return neededCandy === null
    ? t("calc.fineTune.short", { factor: t(FACTOR_TEXT.candy) })
    : t("calc.fineTune.boostMinimizeShortCandy", { count: props.fmt(neededCandy) });
}


// ===== ニックネームの欄 =====
/**
 * Enter で確定する（欄を離れて change を出す）。日本語の変換を確定する Enter（変換中。古い Safari は keyCode 229 だけで分かる）では
 * 何もしない（変換を確定して、続けて打てるように）
 */
function onNicknameEnter(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  (event.target as HTMLInputElement).blur();
}


/** 子の body の op をそのまま親の `op` として流す（引数の数も変えない） */
function relayOp(...args: [op: FineTuneOp, coalesce?: HistoryRecordOptions]): void {
  emit("op", ...args);
}
</script>
