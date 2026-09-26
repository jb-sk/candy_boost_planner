<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  cancelKeypad,
  confirmKeypad,
  keypadState,
  pressBackspace,
  pressClear,
  pressDecimalPoint,
  pressDigit,
  pressReset,
} from "../composables/useNumericKeypad";
import { placeNearAnchor } from "../utils/anchoredPlacement";

/**
 * タッチ端末用のテンキー（仕組みは useNumericKeypad.ts）。App に1つだけ置く。
 *
 * キーは pointerdown / mousedown を止めて、押しても入力欄からフォーカスを奪わない。
 * 奪うと blur で確定が走り、1桁打つたびに確定してしまう。touchstart は止めない
 * （iOS では click まで出なくなり、キーが反応しない）。
 * 位置は入力欄の近く（anchoredPlacement.ts）。
 */

const { t, locale } = useI18n();
const root = ref<HTMLElement | null>(null);
const position = ref<{ left: number; top: number }>({ left: 0, top: 0 });

const DIGIT_ROWS = [["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"]];

/** 表示欄の文字。桁区切りの欄（grouping）は区切りを付ける。 */
const displayValue = computed(() =>
  keypadState.grouping && keypadState.value !== ""
    ? new Intl.NumberFormat(locale.value).format(Number(keypadState.value))
    : keypadState.value,
);

/** 空欄のとき、自動計算の値を薄く出す（入力欄のプレースホルダと同じ。空欄で確定すると自動計算へ戻る）。 */
const showPlaceholder = computed(() => keypadState.value === "" && keypadState.placeholder !== "");

/** 規定値が数字でなく文言のとき（既定のアメブ目標Lv「目標Lvと同じ」）。数字の大きさでは英語が表示欄に収まらない。 */
const isTextPlaceholder = computed(() => !/^[\d,.\s]+$/.test(keypadState.placeholder));

function place(): void {
  const target = keypadState.target;
  if (target && root.value) position.value = placeNearAnchor(target, root.value, { formAccessory: true });
}

/**
 * 開いている間に見えている範囲が変わったら置き直す。iOS はフォーカスの後に入力補助バー（∧ ∨ 完了）を出して
 * 見えている範囲を縮めるので、開いた時点の位置のままだと確定ボタンがバーの裏に入る。
 */
function listenViewport(on: boolean): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  if (on) {
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
  } else {
    viewport.removeEventListener("resize", place);
    viewport.removeEventListener("scroll", place);
  }
}

watch(
  () => keypadState.target,
  async (target, previous) => {
    if (!previous && target) listenViewport(true);
    if (previous && !target) listenViewport(false);
    await nextTick();
    // 待つ間に別の欄へ移っていることがあるので、待った後の対象で置く
    place();
  },
);

onBeforeUnmount(() => listenViewport(false));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="keypadState.target"
      ref="root"
      class="numKeypad"
      role="dialog"
      :aria-label="keypadState.label || undefined"
      data-testid="numeric-keypad"
      :style="{ left: position.left + 'px', top: position.top + 'px' }"
      @pointerdown.prevent
      @mousedown.prevent
    >
      <div class="numKeypad__top">
        <span class="numKeypad__label">{{ keypadState.label }}</span>
        <button v-if="keypadState.decimal" type="button" class="btn btn--ghost btn--xs" data-testid="numeric-keypad-clear" @click="pressClear">
          {{ t("common.clear") }}
        </button>
        <button type="button" class="btn btn--ghost btn--xs" data-testid="numeric-keypad-close" @click="cancelKeypad">
          {{ t("common.close") }}
        </button>
      </div>
      <!-- 自動計算の値を出している間は、開いた直後（次の数字で置き換える）と同じ下地にする。
           リセット直後と、打ってから消したときで見た目を揃えるため -->
      <output
        class="numKeypad__display"
        :class="{ 'numKeypad__display--fresh': keypadState.fresh || showPlaceholder }"
        data-testid="numeric-keypad-display"
      >
        <span v-if="showPlaceholder" class="numKeypad__auto">
          <span class="numKeypad__autoChip" data-testid="numeric-keypad-auto-chip">{{ keypadState.placeholderChip || t("common.auto") }}</span>
          <span
            class="numKeypad__placeholder"
            :class="{ 'numKeypad__placeholder--text': isTextPlaceholder }"
            data-testid="numeric-keypad-placeholder"
          >{{ keypadState.placeholder }}</span>
        </span>
        <template v-else>{{ displayValue }}</template>
      </output>
      <div class="numKeypad__keys">
        <template v-for="digits in DIGIT_ROWS" :key="digits[0]">
          <button
            v-for="digit in digits"
            :key="digit"
            type="button"
            class="numKeypad__key"
            :data-testid="`numeric-keypad-key-${digit}`"
            @click="pressDigit(digit)"
          >{{ digit }}</button>
        </template>
        <!-- 小数を入れる欄では C の位置に小数点を置き、クリアは上部へ移す -->
        <button v-if="keypadState.decimal" type="button" class="numKeypad__key" data-testid="numeric-keypad-decimal" @click="pressDecimalPoint">.</button>
        <!-- 自動計算へ戻せる欄（アメブ個数）は、C の位置を1回で戻すリセットにする。
             印は欄の横のリセットボタンと同じ -->
        <button
          v-else-if="keypadState.resetLabel"
          type="button"
          class="numKeypad__key numKeypad__key--reset"
          data-testid="numeric-keypad-reset"
          :aria-label="keypadState.resetLabel"
          :title="keypadState.resetLabel"
          @click="pressReset"
        ><svg class="numKeypad__resetSvg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v4h4"/><path d="M3 7a5.5 5.5 0 1 1 1 4"/></svg></button>
        <button v-else type="button" class="numKeypad__key numKeypad__key--sub" data-testid="numeric-keypad-clear" :aria-label="t('common.clear')" @click="pressClear">C</button>
        <button type="button" class="numKeypad__key" data-testid="numeric-keypad-key-0" @click="pressDigit('0')">0</button>
        <button type="button" class="numKeypad__key numKeypad__key--sub" data-testid="numeric-keypad-backspace" :aria-label="t('common.backspace')" @click="pressBackspace">⌫</button>
      </div>
      <button type="button" class="btn btn--primary numKeypad__confirm" data-testid="numeric-keypad-confirm" @click="confirmKeypad">
        {{ t("common.confirm") }}
      </button>
    </div>
  </Teleport>
</template>
