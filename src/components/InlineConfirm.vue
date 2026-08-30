<template>
  <div
    v-if="isOpen"
    ref="containerRef"
    class="inlineConfirm"
    :class="containerClass"
    role="group"
    :aria-labelledby="questionId"
    :data-testid="testId"
  >
    <p :id="questionId" class="inlineConfirm__question">{{ question }}</p>
    <p :id="noteId" class="inlineConfirm__note">{{ note }}</p>
    <div class="inlineConfirm__actions">
      <button
        ref="confirmButtonRef"
        class="btn btn--danger btn--sm"
        type="button"
        :data-testid="confirmTestId"
        :aria-describedby="`${questionId} ${noteId}`"
        @click="confirm"
      >{{ confirmLabel }}</button>
      <button
        class="btn btn--neutral btn--sm"
        type="button"
        :data-testid="cancelTestId"
        @click="cancel"
      >{{ cancelLabel }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from "vue";

const props = withDefaults(defineProps<{
  question: string;
  note: string;
  confirmLabel: string;
  cancelLabel: string;
  testId: string;
  confirmTestId: string;
  cancelTestId: string;
  idPrefix?: string;
  containerClass?: string;
  disabled?: boolean;
  closeWhenDisabled?: boolean;
  confirmFocusTarget?: HTMLElement | null;
}>(), {
  idPrefix: "",
  containerClass: "",
  disabled: false,
  closeWhenDisabled: false,
  confirmFocusTarget: null,
});

const emit = defineEmits<{ (e: "confirm"): void }>();
const uid = useId();
const idBase = props.idPrefix || uid;
const questionId = `${idBase}-question`;
const noteId = `${idBase}-note`;
const isOpen = ref(false);
const containerRef = ref<HTMLElement | null>(null);
const confirmButtonRef = ref<HTMLButtonElement | null>(null);
let triggerElement: HTMLElement | null = null;

function open(trigger: EventTarget | null) {
  if (props.disabled) return;
  triggerElement = trigger instanceof HTMLElement ? trigger : null;
  isOpen.value = true;
}

function cancel() {
  isOpen.value = false;
  nextTick(() => triggerElement?.focus());
}

function confirm() {
  isOpen.value = false;
  emit("confirm");
  nextTick(() => props.confirmFocusTarget?.focus());
}

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  // ページ側の確認は、前面にモーダルがある間そのモーダルへ Escape を譲る。
  if (!containerRef.value?.closest(".modal-overlay") && document.querySelector(".modal-overlay")) return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
}

watch(isOpen, async (open) => {
  if (open) window.addEventListener("keydown", onWindowKeydown, true);
  else window.removeEventListener("keydown", onWindowKeydown, true);
  if (!open) return;
  await nextTick();
  confirmButtonRef.value?.focus();
});

watch(() => props.disabled, (disabled) => {
  if (disabled && props.closeWhenDisabled) isOpen.value = false;
});

onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKeydown, true));

defineExpose({ open, isOpen });
</script>
