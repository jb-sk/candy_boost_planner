<template>
  <!-- 部分は途中で折らない。間（.fineTuneEditor__stackSep）は 680px 未満では出さずに部分ごと改行し、680px 以上は空白・<wbr> で並べる -->
  <template v-for="(part, i) in parts" :key="i"><span v-if="i > 0" class="fineTuneEditor__stackSep">{{ part.sep }}<wbr></span><span class="fineTuneEditor__stackPart">{{ part.text }}</span></template>
</template>

<script setup lang="ts">
import { computed } from "vue";

/**
 * 改行入りの長い名前（「目標Lvに届く\n最小限のアメブ個数」）を、改行の位置で分けた部分として出す。
 * スマホ幅は部分ごとに必ず2行、PC・タブレット幅は1行に並べ、入らないときだけ部分の間で折り返す（CSS は FineTuneModal.css）。
 * 部分の間の文字は、英字どうしなら空白（「Fewest Boost to reach…」）、日本語は詰める。
 */
const props = defineProps<{ text: string }>();

const parts = computed(() => {
  const texts = props.text.split("\n");
  return texts.map((text, i) => {
    const latin = i > 0 && /[A-Za-z0-9]$/.test(texts[i - 1]!) && /^[A-Za-z0-9]/.test(text);
    return { text, sep: latin ? " " : "" };
  });
});
</script>
