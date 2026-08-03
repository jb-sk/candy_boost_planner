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
</script>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";

const props = defineProps<{
  modelValue: number;
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
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: number): void;
}>();

const { t } = useI18n();

const isOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});
const presets = [10, 25, 30, 40, 50, 55, 60, 65, MAX_LEVEL];

const inputValue = ref(String(props.modelValue));
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
  && (props.disabled || props.modelValue >= (props.max ?? MAX_LEVEL) || bumpedAgainstMax.value)
);

/** 上限を超える要求だったかを記録する。スライダー・±・チップ・直接入力の全経路から呼ぶ。 */
function noteIfOverMax(requested: number) {
  if (requested > (props.max ?? MAX_LEVEL)) bumpedAgainstMax.value = true;
}

watch(() => props.modelValue, (v) => {
  if (!isEditing.value) inputValue.value = String(v);
});

const EDGE_GAP = 8; // px from viewport edge

/** Calculate popover position so it never overflows viewport edges */
function adjustPopoverPosition() {
  if (!root.value) return;
  const popover = root.value.querySelector<HTMLElement>(".levelPick__popover");
  if (!popover) return;

  const triggerRect = root.value.getBoundingClientRect();
  const popW = popover.offsetWidth;
  const popH = popover.offsetHeight;
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;

  // --- 水平位置 ---
  // Default: right-align to trigger (same as CSS right:0)
  let left = triggerRect.right - popW;

  // Clamp: don't overflow left edge
  if (left < EDGE_GAP) {
    left = EDGE_GAP;
  }
  // Clamp: don't overflow right edge
  if (left + popW > vpW - EDGE_GAP) {
    left = vpW - EDGE_GAP - popW;
  }

  // Convert to offset from the trigger's left edge (since parent is position:relative)
  const offsetLeft = left - triggerRect.left;

  // --- 垂直位置 ---
  // デフォルトは下（CSS top: calc(100% + 6px)）。下に収まらない場合は上にフリップ。
  // ただし position: fixed（legacy <=560px のセンタリング）時はスキップ。
  const isFixed = getComputedStyle(popover).position === "fixed";
  const gapPx = 6;
  const overflowsBottom = triggerRect.bottom + gapPx + popH > vpH - EDGE_GAP;
  const fitsAbove = triggerRect.top - gapPx - popH > EDGE_GAP;

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
  if (closeOpenPicker === close) closeOpenPicker = null;
}

/**
 * 確定値が現在の modelValue と異なる場合だけ emit する。
 * 未変更でも emit すると、目標Lv欄を開いて閉じただけで個数指定・睡眠目標が解除され、
 * planner が再計算されてしまう（設計書§6.2）。
 */
function setValue(v: number) {
  if (v === props.modelValue) return;
  emit("update:modelValue", v);
}

function update(v: number) {
  if (isEditing.value) {
    commitInput();
  }
  const min = props.min ?? 1;
  const max = props.max ?? MAX_LEVEL;
  noteIfOverMax(v);
  if (v < min) v = min;
  if (v > max) v = max;
  inputValue.value = String(v);
  setValue(v);
}

function nudge(delta: number) {
  const base = isEditing.value ? commitInput() : props.modelValue;
  update(base + delta);
}

function effectiveInputNumber() {
  const n = parseInt(inputValue.value);
  return isNaN(n) ? props.modelValue : n;
}

function onInputFocus() {
  isEditing.value = true;
}

function commitInput(): number {
  isEditing.value = false;
  const n = parseInt(inputValue.value);
  if (isNaN(n) || inputValue.value.trim() === "") {
    inputValue.value = String(props.modelValue);
    return props.modelValue;
  }
  const lo = props.min ?? 1;
  const hi = props.max ?? MAX_LEVEL;
  noteIfOverMax(n);
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
  if (isOpen.value && root.value && !root.value.contains(event.target as Node)) {
    close();
  }
}

onMounted(() => {
  document.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
  // 開いたまま行が消えると、次に開くピッカーが「前を閉じる」で存在しない関数を呼ぶ。
  if (closeOpenPicker === close) closeOpenPicker = null;
});
</script>

<template>
  <div class="levelPick" ref="root">
    <input
      type="number"
      inputmode="numeric"
      pattern="[0-9]*"
      :min="min ?? 1"
      :max="max ?? MAX_LEVEL"
      step="1"
      class="field__input levelPick__input"
      data-testid="level-picker-trigger"
      :aria-label="label ?? 'Level'"
      :disabled="disabled"
      :value="inputValue"
      @focus="onInputFocus"
      @blur="onInputBlur"
      @keydown.enter.prevent="onInputEnter"
      @input="onInputTyping"
    />
    <button
      type="button"
      class="levelPick__chevron"
      data-testid="level-picker-chevron"
      :aria-label="label ? `${label} picker` : 'Level picker'"
      :title="label ? `${label} picker` : 'Level picker'"
      @click.stop="toggle"
    ></button>

    <div v-if="isOpen" class="levelPick__popover" data-testid="level-picker-popover" role="dialog" :style="popoverStyle">
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
          :value="modelValue"
          :disabled="disabled"
          @input="update(parseInt(($event.target as HTMLInputElement).value))"
          @click.stop
        />
        <button
          class="btn btn--ghost btn--xs levelPick__stepButton"
          type="button"
          data-testid="level-picker-increment"
          @click.stop="nudge(1)"
          :disabled="disabled || effectiveInputNumber() >= (max ?? MAX_LEVEL)"
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
  </div>
</template>
