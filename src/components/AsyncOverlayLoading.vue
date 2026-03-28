<template>
  <div class="asyncOverlayLoading" :class="{ 'asyncOverlayLoading--dialog': dialog }" :role="dialog ? 'dialog' : undefined" :aria-busy="true" :aria-label="label">
    <div class="asyncOverlayLoading__card">
      <span class="asyncOverlayLoading__spinner" aria-hidden="true"></span>
      <p class="asyncOverlayLoading__label">{{ label }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  dialog?: boolean;
}>();
</script>
