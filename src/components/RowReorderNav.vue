<template>
  <Teleport to="body">
    <div
      v-if="nav.visible"
      class="calcReorderNav"
      data-testid="calc-reorder-nav"
      role="status"
      aria-live="polite"
      :aria-label="t('calc.row.reorderNavLabel')"
      :style="{
        left: `${nav.left}px`,
        top: `${nav.top}px`,
        width: `${nav.width}px`,
        maxHeight: `${nav.maxHeight}px`,
      }"
    >
      <div class="calcReorderNav__head">
        <span>{{ t('calc.row.reorderNavLabel') }}</span>
        <span>{{ t('calc.row.reorderNavPosition', { current: nav.targetIndex + 1, total: nav.total }) }}</span>
      </div>
      <div :ref="setList" class="calcReorderNav__list">
        <div
          v-for="(item, index) in nav.previewItems"
          :key="item.id"
          class="calcReorderNav__item"
          :class="{ 'calcReorderNav__item--moving': item.id === nav.movingId }"
          :data-testid="item.id === nav.movingId ? 'calc-reorder-nav-moving' : 'calc-reorder-nav-item'"
        >
          <span class="calcReorderNav__index">{{ index + 1 }}</span>
          <span class="calcReorderNav__title">{{ item.title }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { RowReorderNavState } from "../composables/useRowReorderDrag";

/**
 * 行をつかんで動かしている間、画面の横に浮かぶ名前の一覧（状態は useRowReorderDrag の `nav`）。
 * 位置の計算と端での自動スクロールは composable が持つので、一覧の要素を `setList` で返す。
 */
defineProps<{
  nav: RowReorderNavState;
  setList: (el: unknown) => void;
}>();

const { t } = useI18n();
</script>
