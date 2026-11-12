<script lang="ts">
/**
 * 開いているピッカーは常に1つだけにする。
 *
 * chevron のクリックは `@click.stop` で伝播を止めているため、他のピッカーの
 * `onClickOutside` が発火しない。放っておくと3つ同時に開き、どれを操作しているのか
 * 分からなくなる。次を開くときに前を閉じる。
 *
 * **`<script setup>` ではなくこちらに置くこと。** setup 側の宣言はインスタンスごとに
 * 作られるため共有されない（実際にそれで排他が効かなかった）。
 */
let closeOpenPicker: (() => void) | null = null;

/** スライダーの1回のドラッグに振る通し番号。ピッカーをまたいで目印が重ならないよう、インスタンスで共有する */
let sliderGestureSeq = 0;

/**
 * 開いているピッカーがあれば閉じ、閉じたかを返す。モーダルの Escape で、選択を外したり閉じたりする前に
 * まずピッカーだけを閉じるのに使う（シンプル）。
 */
export function closeOpenLevelPicker(): boolean {
  if (closeOpenPicker === null) return false;
  closeOpenPicker();
  return true;
}
</script>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { vKeypad } from "../composables/useNumericKeypad";
import { useDismissOnScroll } from "../composables/useDismissOnScroll";
import type { HistoryRecordOptions } from "../composables/useHistory";

const props = defineProps<{
  /** 選んでいる Lv。`placeholder` を渡す欄だけ null（空欄。「目標Lvと同じ」など）を受け取る */
  modelValue: number | null;
  label?: string; // Title inside popover
  min?: number;
  max?: number;
  /**
   * 値を変更できない（表示のみ）。**ポップオーバーは開ける。**
   * 閉じてしまうと `note` の理由を読む手段がなくなる。
   */
  disabled?: boolean;
  /**
   * ポップオーバー内に出す案内。上限に当たっている理由と打ち手を書く。
   * **常に出るわけではない**（`showNote` を参照）。上限に届いていないうちは邪魔なだけなので、
   * 上限に張り付いているか、超えようとしたときに出す。
   */
  note?: string;
  /**
   * ポップオーバー内に出す警告。**`note` と違い、渡されていれば常に出す。**
   *
   * `note` は「この欄の上限に当たった理由」なので上限に届くまで出す必要がないが、
   * こちらは「いまの値が別の制約に違反している」という状態で、値が上限のどこにあっても成立する。
   * 出す条件を呼び出し側が持つため、ここでは出し分けない。
   */
  alert?: string;
  /**
   * タッチ端末で入力欄をテンキー入力にする（useNumericKeypad.ts）。
   * 共用の部品なので、使う画面だけが指定する。
   */
  keypad?: boolean;
  /**
   * 上限より上へ上げる操作（上限での ▶・上限超えの直接入力）を、値へ丸めずに `exceedMax` で親へ渡す。
   * 上限のLvでは表しきれない値を親が持っている欄で使う（計算機のアメブ目標Lv: `T'` の端数までアメブ）。
   */
  canExceedMax?: boolean;
  /**
   * 吹き出しを収める枠（`closest` で引く CSS セレクタ）。省略時は画面（viewport）。
   * はみ出しを切る枠（overflow: hidden のモーダルなど）の中で使うときに渡す。画面とその枠の重なりに収め、
   * 下に入らなければ上へ出す（シンプルの操作パネル: モーダルの下端で切れないようにする）。
   */
  boundary?: string;
  /**
   * 空欄を許す欄（シンプルの既定のアメブ目標Lv）。modelValue が null のときに入力欄へ薄く出す文言。
   * 空欄で確定すると `clear` を投げる（テンキーでは「デフォルト」の札と一緒に出す）。
   */
  placeholder?: string;
  /**
   * 吹き出しを body へ出し、画面に固定して置く（`position: fixed`）。スクロールする枠の中の欄で使う
   * （シンプルの表の目標Lv: 一覧の枠で吹き出しが切れないようにする）。
   * 画面に固定するので、スクロールしようとしたら閉じる（性格補正のドロップダウンと同じ）。
   */
  teleport?: boolean;
}>();

defineSlots<{
  /** 吹き出しの見出し。省略時は `label` */
  title?: () => unknown;
  /**
   * 入力欄と ▾ の代わりに置く、開閉のボタン（シンプルの表の目標Lv: 欄を押すと直接ピッカーを開く）。
   * これを渡すと直接打つ入力欄は出さない。`toggle` を click で呼ぶ
   */
  trigger?: (props: { open: boolean; toggle: () => void }) => unknown;
}>();

const emit = defineEmits<{
  /**
   * 選んだ Lv。スライダーのドラッグ中は `coalesce`（1回のドラッグで同じ目印、`coalesceWindowMs: Infinity`）を添える。
   * 親はこれを元に戻すの履歴へ渡し、ドラッグ1回を1件にまとめる（添えなければ1歩ずつ記録され、上限30件を使い切る）
   */
  (e: "update:modelValue", value: number, coalesce?: Required<HistoryRecordOptions>): void;
  /** `canExceedMax` のとき、上限より上へ上げようとした */
  (e: "exceedMax"): void;
  /** `placeholder` のある欄を空欄で確定した（null へ戻す） */
  (e: "clear"): void;
  /** 開閉。親が開いている間だけ重なり順を上げるのに使う（CSS の :has() は iOS 15.4・Chrome 105 からなので使わない） */
  (e: "update:open", open: boolean): void;
}>();

const { t } = useI18n();

const isOpen = ref(false);
watch(isOpen, (open) => emit("update:open", open));
const root = ref<HTMLElement | null>(null);
const popover = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});
const presets = [10, 25, 30, 40, 50, 55, 60, 65, MAX_LEVEL];

/** 空欄（null）は欄に何も出さない */
const textOf = (v: number | null) => (v === null ? "" : String(v));
/** スライダー・◀ ▶ が動き始める Lv。空欄（null）は上限から */
const currentLevel = computed(() => props.modelValue ?? (props.max ?? MAX_LEVEL));

const inputValue = ref(textOf(props.modelValue));
const isEditing = ref(false);

/** 上限を超える操作をした（＝理由を知りたがっている）。閉じるまで案内を出し続ける。 */
const bumpedAgainstMax = ref(false);

/**
 * 案内を出す条件。上限に張り付いているか、超えようとしたとき。
 * 上限にまだ余裕がある状態で出すと、ただの注意書きとして読み飛ばされる。
 *
 * **`disabled` では上限を見ずに出す。** 読み飛ばしを気にするのは操作できる欄の話で、
 * 動かせない欄のポップオーバーに書くことは「なぜ動かせないか」しかない。
 * 上限に余裕を残したまま丸ごと無効化される呼び出し（計算機の「すべて睡眠」）があり、
 * そこでは上限条件が永久に成立しないので、この分岐がないと理由を読む手段が無くなる。
 */
const showNote = computed(() =>
  Boolean(props.note)
  && (props.disabled || currentLevel.value >= (props.max ?? MAX_LEVEL) || bumpedAgainstMax.value)
);

/** 上限を超える要求だったかを記録する。スライダー・±・チップ・直接入力の全経路から呼ぶ。 */
function noteIfOverMax(requested: number) {
  if (requested > (props.max ?? MAX_LEVEL)) bumpedAgainstMax.value = true;
}

watch(() => props.modelValue, (v) => {
  if (!isEditing.value) inputValue.value = textOf(v);
});

const EDGE_GAP = 8; // px from viewport edge

/** Calculate popover position so it never overflows viewport edges */
function adjustPopoverPosition() {
  if (!root.value || !popover.value) return;

  const triggerRect = root.value.getBoundingClientRect();
  const popW = popover.value.offsetWidth;
  const popH = popover.value.offsetHeight;
  // 収める枠。既定は画面。`boundary` があれば、その枠と画面の重なり
  const frame = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const boundaryEl = props.boundary ? root.value.closest(props.boundary) : null;
  if (boundaryEl) {
    const rect = boundaryEl.getBoundingClientRect();
    frame.left = Math.max(frame.left, rect.left);
    frame.top = Math.max(frame.top, rect.top);
    frame.right = Math.min(frame.right, rect.right);
    frame.bottom = Math.min(frame.bottom, rect.bottom);
  }

  // --- 水平位置 ---
  // Default: right-align to trigger (same as CSS right:0)
  let left = triggerRect.right - popW;

  // Clamp: don't overflow left edge
  if (left < frame.left + EDGE_GAP) {
    left = frame.left + EDGE_GAP;
  }
  // Clamp: don't overflow right edge
  if (left + popW > frame.right - EDGE_GAP) {
    left = frame.right - EDGE_GAP - popW;
  }

  // body へ出した吹き出しは画面に固定する。下に入らなければ上へ、どちらにも入らなければ枠の下端に寄せる
  // （トリガーに重なってもよい。枠の外へは出さない）
  if (props.teleport) {
    const gapPx = 6;
    let top = triggerRect.bottom + gapPx;
    if (top + popH > frame.bottom - EDGE_GAP) {
      const above = triggerRect.top - gapPx - popH;
      top = above >= frame.top + EDGE_GAP
        ? above
        : Math.max(frame.top + EDGE_GAP, frame.bottom - EDGE_GAP - popH);
    }
    popoverStyle.value = { left: `${left}px`, top: `${top}px` };
    return;
  }

  // Convert to offset from the trigger's left edge (since parent is position:relative)
  const offsetLeft = left - triggerRect.left;

  // --- 垂直位置 ---
  // デフォルトは下（CSS top: calc(100% + 6px)）。下に収まらない場合は上にフリップ。
  // ただし position: fixed（legacy <=560px のセンタリング）時はスキップ。
  const isFixed = getComputedStyle(popover.value).position === "fixed";
  const gapPx = 6;
  const overflowsBottom = triggerRect.bottom + gapPx + popH > frame.bottom - EDGE_GAP;
  const fitsAbove = triggerRect.top - gapPx - popH > frame.top + EDGE_GAP;

  if (!isFixed && overflowsBottom && fitsAbove) {
    popoverStyle.value = { left: `${offsetLeft}px`, right: "auto", top: "auto", bottom: `calc(100% + ${gapPx}px)` };
  } else {
    popoverStyle.value = { left: `${offsetLeft}px`, right: "auto" };
  }
}

async function toggle() {
  if (isEditing.value) {
    commitInput();
  }
  const willOpen = !isOpen.value;
  if (willOpen && closeOpenPicker && closeOpenPicker !== close) {
    closeOpenPicker();
  }
  isOpen.value = willOpen;
  if (willOpen) {
    closeOpenPicker = close;
    await nextTick();
    adjustPopoverPosition();
  } else if (closeOpenPicker === close) {
    closeOpenPicker = null;
  }
}

function close() {
  isOpen.value = false;
  bumpedAgainstMax.value = false;
  sliderCoalesce = null;
  if (closeOpenPicker === close) closeOpenPicker = null;
}

/**
 * 確定値が現在の modelValue と異なる場合だけ emit する。
 * 未変更でも emit すると、目標Lv欄を開いて閉じただけで個数指定・睡眠目標が解除され、
 * planner が再計算されてしまう（設計書§6.2）。
 */
function setValue(v: number, coalesce?: Required<HistoryRecordOptions>) {
  if (v === props.modelValue) return;
  emit("update:modelValue", v, coalesce);
}

/**
 * スライダーの1回のドラッグ（指・マウスを置いてから、離して change が来るまで）の目印。
 * ドラッグ中は動かすたびに値を親へ渡すので、同じ目印を添えて履歴を1件にまとめてもらう。
 * キーボードの矢印は1回ごとに input → change が来るので、1回押すごとに1件のまま。
 */
let sliderCoalesce: Required<HistoryRecordOptions> | null = null;

function onRangeInput(event: Event) {
  sliderCoalesce ??= { coalesceKey: `levelPicker:slider:${++sliderGestureSeq}`, coalesceWindowMs: Number.POSITIVE_INFINITY };
  update(parseInt((event.target as HTMLInputElement).value), sliderCoalesce);
}

/** 離した（change）・次のドラッグを始めた（pointerdown）ら、次は別の1件にする */
function endRangeGesture() {
  sliderCoalesce = null;
}

function update(v: number, coalesce?: Required<HistoryRecordOptions>) {
  if (isEditing.value) {
    commitInput();
  }
  const min = props.min ?? 1;
  const max = props.max ?? MAX_LEVEL;
  noteIfOverMax(v);
  if (v > max && props.canExceedMax) {
    inputValue.value = textOf(props.modelValue);
    emit("exceedMax");
    return;
  }
  if (v < min) v = min;
  if (v > max) v = max;
  inputValue.value = String(v);
  setValue(v, coalesce);
}

function nudge(delta: number) {
  const base = isEditing.value ? commitInput() : currentLevel.value;
  update(base + delta);
}

function effectiveInputNumber() {
  const n = parseInt(inputValue.value);
  return isNaN(n) ? currentLevel.value : n;
}

function onInputFocus() {
  isEditing.value = true;
}

function commitInput(): number {
  isEditing.value = false;
  const n = parseInt(inputValue.value);
  if (isNaN(n) || inputValue.value.trim() === "") {
    // 空欄を許す欄は、空欄で確定すると null へ戻す
    if (props.placeholder !== undefined && inputValue.value.trim() === "" && props.modelValue !== null) {
      emit("clear");
      return currentLevel.value;
    }
    inputValue.value = textOf(props.modelValue);
    return currentLevel.value;
  }
  const lo = props.min ?? 1;
  const hi = props.max ?? MAX_LEVEL;
  noteIfOverMax(n);
  if (n > hi && props.canExceedMax) {
    inputValue.value = textOf(props.modelValue);
    emit("exceedMax");
    return currentLevel.value;
  }
  const clamped = Math.max(lo, Math.min(hi, n));
  inputValue.value = String(clamped);
  setValue(clamped);
  return clamped;
}

function onInputBlur() {
  commitInput();
}

function onInputEnter(e: KeyboardEvent) {
  (e.target as HTMLInputElement).blur();
}

function onInputTyping(e: Event) {
  inputValue.value = (e.target as HTMLInputElement).value.replace(/[^0-9]/g, "");
}

function onClickOutside(event: MouseEvent) {
  const target = event.target as Node;
  if (isOpen.value && root.value && !root.value.contains(target) && !popover.value?.contains(target)) {
    close();
  }
}

// body へ出した吹き出しは画面に固定するので、スクロールすると欄から離れて残る。
// 指・ホイールはスクロールしようとした時点で閉じる（吹き出しの中で始まった動きは見ない）。
// スクロールバー・キーボードなどそれ以外の経路は、欄を含む枠が実際にスクロールしたら閉じる
const floatingOpen = () => isOpen.value && props.teleport === true;
useDismissOnScroll(
  floatingOpen,
  close,
  (target) => target instanceof Node && popover.value?.contains(target) === true,
);

function onAncestorScroll(event: Event): void {
  const target = event.target;
  if (target instanceof Node && root.value !== null && target.contains(root.value)) close();
}

watch(floatingOpen, (open) => {
  if (open) document.addEventListener("scroll", onAncestorScroll, true);
  else document.removeEventListener("scroll", onAncestorScroll, true);
});

onMounted(() => {
  document.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
  document.removeEventListener("scroll", onAncestorScroll, true);
  // 開いたまま行が消えると、次に開くピッカーが「前を閉じる」で存在しない関数を呼ぶ。
  if (closeOpenPicker === close) closeOpenPicker = null;
  // 開いたまま消えたら、親の「開いている」印も外す
  if (isOpen.value) emit("update:open", false);
});
</script>

<template>
  <div class="levelPick" ref="root">
    <slot v-if="$slots.trigger" name="trigger" :open="isOpen" :toggle="toggle" />
    <template v-else>
      <input
        type="number"
        inputmode="numeric"
        pattern="[0-9]*"
        :min="min ?? 1"
        :max="max ?? MAX_LEVEL"
        step="1"
        class="field__input levelPick__input"
        data-testid="level-picker-trigger"
        :aria-label="label ?? t('common.level')"
        :disabled="disabled"
        v-keypad="keypad
          ? (placeholder !== undefined ? { label: label ?? '', placeholder, placeholderChip: t('common.default') } : (label ?? ''))
          : false"
        :placeholder="placeholder"
        :value="inputValue"
        @focus="onInputFocus"
        @blur="onInputBlur"
        @keydown.enter.prevent="onInputEnter"
        @input="onInputTyping"
      />
      <!-- ツールチップ（title）は付けない（スマホで出ないため）。読み上げの名前だけ -->
      <button
        type="button"
        class="levelPick__chevron"
        data-testid="level-picker-chevron"
        :aria-label="label ? t('common.levelPickerOpen', { label }) : t('common.levelPickerOpenNoLabel')"
        @click.stop="toggle"
      ></button>
    </template>

    <Teleport to="body" :disabled="!teleport">
      <div
        v-if="isOpen"
        ref="popover"
        class="levelPick__popover"
        :class="{ 'levelPick__popover--fixed': teleport }"
        data-testid="level-picker-popover"
        role="dialog"
        :aria-label="label"
        :style="popoverStyle"
      >
        <div class="levelPick__top">
          <div class="levelPick__title">
            <slot name="title">{{ label }}</slot>
          </div>
          <button
            class="btn btn--ghost btn--xs"
            type="button"
            @mousedown.stop.prevent
            @click.stop.prevent="close"
          >
            {{ t("common.close") }}
          </button>
        </div>

        <!-- 制約違反の警告。note より上に置く（いま直すべきはこちらなので先に読ませる）。 -->
        <p v-if="alert" class="levelPick__note levelPick__note--alert" data-testid="level-picker-alert"
          ><span class="levelPick__noteMark">⚠️</span><span>{{ alert }}</span></p
        >

        <!-- 上限に当たっている理由。title 属性だけだと、disabled の欄ではホバーしても出ない。
             警告マークは別要素にする（文字列に混ぜるとベースライン揃えで下がって見える）。 -->
        <p v-if="showNote" class="levelPick__note" data-testid="level-picker-note"
          ><span class="levelPick__noteMark">⚠️</span><span>{{ note }}</span></p
        >

        <div class="levelPick__sliderRow">
          <button
            class="btn btn--ghost btn--xs levelPick__stepButton"
            type="button"
            data-testid="level-picker-decrement"
            @click.stop="nudge(-1)"
            :disabled="disabled || effectiveInputNumber() <= (min ?? 1)"
          >
            ◀
          </button>
          <input
            class="levelPick__range"
            type="range"
            :min="min ?? 1"
            :max="max ?? MAX_LEVEL"
            step="1"
            :value="currentLevel"
            :disabled="disabled"
            @pointerdown="endRangeGesture"
            @input="onRangeInput"
            @change="endRangeGesture"
            @click.stop
          />
          <button
            class="btn btn--ghost btn--xs levelPick__stepButton"
            type="button"
            data-testid="level-picker-increment"
            @click.stop="nudge(1)"
            :disabled="disabled || (effectiveInputNumber() >= (max ?? MAX_LEVEL) && !canExceedMax)"
          >
            ▶
          </button>
        </div>

        <div class="levelPick__chips">
          <button
            v-for="lv in presets"
            :key="lv"
            type="button"
            class="levelChip"
            :class="{ 'levelChip--on': lv === modelValue }"
            @click.stop="update(lv)"
            :disabled="disabled || lv < (min ?? 1) || lv > (max ?? MAX_LEVEL)"
          >
            {{ lv }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
