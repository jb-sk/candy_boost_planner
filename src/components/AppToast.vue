<template>
  <!--
    live region は常に DOM へ置く（v-if で丸ごと出し入れすると読み上げが拾われないことがある）。
    積み上げの向きと動きの有無は AppToast.css を参照。
  -->
  <div class="appToastStack" role="status" aria-live="polite">
    <TransitionGroup name="appToast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="appToast"
        :data-testid="toast.testId"
      >
        {{ toast.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useToast } from "../composables/useToast";

const { toasts } = useToast();
</script>
