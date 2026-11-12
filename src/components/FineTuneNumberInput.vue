<template>
  <input
    ref="inputRef"
    v-keypad="{ label: inputLabel, maxLength, grouping }"
    type="text"
    inputmode="numeric"
    autocomplete="off"
    :maxlength="maxLength"
    :aria-label="inputLabel"
    :disabled="disabled"
    :value="draft ?? text"
    @focus="onFocus"
    @input="draft = ($event.target as HTMLInputElement).value.replace(/[^0-9]/g, '')"
    @blur="onBlur"
    @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { vKeypad } from "../composables/useNumericKeypad";

/**
 * シンプルの調整バーの数字の欄（アメブ・アメの個数、あとEXP・アメ在庫、かけら・万能アメ）。直接打ち、確定は欄を離れたとき
 * （Enter も離れる）。テンキーは ui_spec §8。打っている間の文字は欄の中だけに持ち、確定で値が変わったときだけ `commit` を出す
 * （範囲に収めるのは reducer）。data-testid などはそのまま input に付く。
 */
const props = defineProps<{
  /** 今の値（種族不明の行の在庫など、値が無いときは null で空欄） */
  value: number | null;
  inputLabel: string;
  disabled: boolean;
  /** テンキーで打てる桁数（省くとテンキーの既定） */
  maxLength?: number;
  /** 3桁ごとに区切って出す（かけら） */
  grouping?: boolean;
  fmt: (n: number) => string;
}>();

const emit = defineEmits<{
  (e: "commit", value: number): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
/** 打ちかけの文字（フォーカスしている間だけ） */
const draft = ref<string | null>(null);

/** 打っていない間の文字。区切る欄は 3桁ごとに区切る */
const text = computed(() => {
  if (props.value === null) return "";
  return props.grouping === true ? props.fmt(props.value) : String(props.value);
});

/** 打ち始め。区切った表示（1,450,000）は、その場で数字だけに戻す（描き直しを待つと、打ち始めた文字の前に元の表示が残る） */
function onFocus(event: FocusEvent): void {
  const el = event.target as HTMLInputElement;
  const plain = props.value === null ? "" : String(props.value);
  draft.value = plain;
  if (el.value === plain) return;
  // 表示を変えるとカーソルが末尾へ移るので、全体を選び直す（打つと置き換わる）
  el.value = plain;
  el.select();
  void nextTick(() => {
    if (document.activeElement === el) el.select();
  });
}

function onBlur(): void {
  const typed = draft.value;
  draft.value = null;
  if (typed !== null && typed !== "" && Number(typed) !== props.value) emit("commit", Number(typed));
  // 範囲に収めた結果が元の値と同じときも、欄に打ちかけの文字を残さない
  void nextTick(() => {
    if (inputRef.value !== null) inputRef.value.value = text.value;
  });
}
</script>
