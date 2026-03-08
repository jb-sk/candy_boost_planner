<template>
  <Teleport to="body">
    <div v-if="step" class="onboarding-backdrop" @click.self="onboarding.next()">
      <!-- Spotlight cutout: GPU-composited via transform -->
      <div
        ref="spotlightRef"
        class="onboarding-spotlight"
      ></div>

      <!-- Tooltip bubble (steps 1 & 2 only; step 3 uses inline tooltip in CalcPanel) -->
      <div
        v-if="!isInlineStep"
        ref="tooltipRef"
        class="onboarding-tooltip"
        :class="'onboarding-tooltip--' + actualPlacement"
      >
        <div class="onboarding-tooltip__header">
          <span class="onboarding-tooltip__step">{{ onboarding.currentStep.value + 1 }} / {{ onboarding.totalSteps }}</span>
          <button class="onboarding-tooltip__skip" type="button" @click="onboarding.skip()">{{ t("onboarding.skip") }}</button>
        </div>
        <h3 v-if="step.titleKey" class="onboarding-tooltip__title">{{ t(step.titleKey) }}</h3>
        <p class="onboarding-tooltip__desc">{{ t(step.descKey, { action: actionLabel }) }}</p>
        <div class="onboarding-tooltip__footer">
          <button
            class="btn btn--primary onboarding-tooltip__next"
            type="button"
            @click="onboarding.next()"
          >
            {{ isLastStep ? t("onboarding.done") : t("onboarding.next") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import type { useOnboarding } from "../composables/useOnboarding";

const props = defineProps<{
  onboarding: ReturnType<typeof useOnboarding>;
}>();

const { t } = useI18n();
const onboarding = props.onboarding;
const tooltipRef = ref<HTMLElement | null>(null);
const spotlightRef = ref<HTMLElement | null>(null);

// Action label ("tap" / "click") — sourced from composable to avoid duplication
const actionLabel = computed(() => t(onboarding.actionI18nKey));

const step = computed(() => onboarding.step.value);
const isLastStep = computed(() => onboarding.currentStep.value === onboarding.totalSteps - 1);

/** Step 3 uses inline tooltip rendered by CalcPanel instead of fixed overlay */
const isInlineStep = computed(() => onboarding.currentStep.value === 2);

const actualPlacement = ref<"top" | "bottom">("bottom");

// ---------- Constants ----------
const SPOTLIGHT_PAD = 6;
const TOOLTIP_GAP = 12;
const TOOLTIP_WIDTH = 340;
const VIEWPORT_MARGIN = 16;
const MIN_TOOLTIP_SPACE = 120;

/** Cached target element — resolved once per step */
let cachedTargetEl: Element | null = null;

// ---------- Helpers ----------

/** Measure sticky header height from the DOM (returns 0 if not found). */
function getStickyHeaderHeight(): number {
  const stickyEl = document.querySelector(".calcSticky");
  return stickyEl ? stickyEl.getBoundingClientRect().height : 0;
}

/** Get current visual viewport dimensions. */
function getViewport() {
  return {
    w: window.visualViewport?.width ?? window.innerWidth,
    h: window.visualViewport?.height ?? window.innerHeight,
  };
}

// ---------- Positioning (placement + render only) ----------

/**
 * Position spotlight (+ tooltip for non-inline steps) based on current
 * viewport coordinates of the cached target element.
 * For inline steps (step 3), only the spotlight is positioned;
 * the tooltip is rendered by CalcPanel in normal DOM flow.
 */
function applyPositions() {
  const spotEl = spotlightRef.value;
  const tipEl = tooltipRef.value;
  if (!cachedTargetEl || !spotEl) {
    if (spotEl) spotEl.style.display = "none";
    if (tipEl) tipEl.style.display = "none";
    return;
  }

  const r = cachedTargetEl.getBoundingClientRect();
  const { w: viewW, h: viewH } = getViewport();

  // --- Spotlight ---
  spotEl.style.display = "";
  spotEl.style.width = `${r.width + SPOTLIGHT_PAD * 2}px`;
  spotEl.style.height = `${r.height + SPOTLIGHT_PAD * 2}px`;
  spotEl.style.transform = `translate(${r.left - SPOTLIGHT_PAD}px, ${r.top - SPOTLIGHT_PAD}px)`;

  // For inline steps, spotlight only — no fixed tooltip
  if (isInlineStep.value) {
    if (tipEl) tipEl.style.display = "none";
    return;
  }

  if (!tipEl) return;

  // --- Decide placement based on available space ---
  const stickyH = getStickyHeaderHeight();
  const spaceAbove = r.top - stickyH - SPOTLIGHT_PAD - TOOLTIP_GAP - VIEWPORT_MARGIN;
  const spaceBelow = viewH - r.bottom - SPOTLIGHT_PAD - TOOLTIP_GAP - VIEWPORT_MARGIN;
  const preferred = step.value?.placement ?? "bottom";

  let placement: "top" | "bottom";
  if (preferred === "bottom" && spaceBelow >= MIN_TOOLTIP_SPACE) {
    placement = "bottom";
  } else if (preferred === "top" && spaceAbove >= MIN_TOOLTIP_SPACE) {
    placement = "top";
  } else {
    placement = spaceBelow >= spaceAbove ? "bottom" : "top";
  }
  actualPlacement.value = placement;

  // --- Tooltip sizing ---
  const tooltipWidth = Math.min(TOOLTIP_WIDTH, viewW - VIEWPORT_MARGIN * 2);
  const maxH = Math.max(0, placement === "top" ? spaceAbove : spaceBelow);

  tipEl.style.display = "";
  tipEl.style.width = `${tooltipWidth}px`;
  tipEl.style.maxHeight = `${maxH}px`;

  // --- Tooltip left ---
  let left = r.left + r.width / 2 - tooltipWidth / 2;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewW - tooltipWidth - VIEWPORT_MARGIN));
  tipEl.style.left = `${left}px`;

  // --- Tooltip top ---
  const tipH = tipEl.offsetHeight;
  let tipTop: number;
  if (placement === "top") {
    tipTop = r.top - SPOTLIGHT_PAD - TOOLTIP_GAP - tipH;
  } else {
    tipTop = r.bottom + SPOTLIGHT_PAD + TOOLTIP_GAP;
  }
  tipTop = Math.max(VIEWPORT_MARGIN, Math.min(tipTop, viewH - tipH - VIEWPORT_MARGIN));

  tipEl.style.top = `${tipTop}px`;
  tipEl.style.bottom = "";
}

// ---------- Step initialization ----------

/**
 * Trial 17: For steps 1 & 2, scrollIntoView(center) + fixed overlay (Trial 1 baseline).
 * For step 3, scrollIntoView(center) the data-onboarding="result-row" container
 * which now includes the inline tooltip as part of the DOM flow.
 * No fixed tooltip/spotlight needed for step 3 — CalcPanel renders everything inline.
 */
function initStep() {
  cachedTargetEl = null;

  const spotEl = spotlightRef.value;
  const tipEl = tooltipRef.value;

  if (spotEl) spotEl.style.display = "none";
  if (tipEl) tipEl.style.display = "none";

  if (!step.value) return;
  const el = document.querySelector(step.value.target);
  if (!el) return;
  cachedTargetEl = el;

  // Scroll the target (or target+inline-tooltip container) to center
  (el as HTMLElement).scrollIntoView({ block: "center", behavior: "auto" });

  // Position fixed overlay after scroll (only for non-inline steps)
  requestAnimationFrame(() => {
    applyPositions();
  });
}

// ---------- Lifecycle ----------

watch(step, () => {
  nextTick(() => initStep());
});

let rafId = 0;
function onResize() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => applyPositions());
}

onMounted(() => {
  initStep();
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("scroll", onResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  window.removeEventListener("orientationchange", onResize);
  window.visualViewport?.removeEventListener("resize", onResize);
  window.visualViewport?.removeEventListener("scroll", onResize);
  cancelAnimationFrame(rafId);
  cachedTargetEl = null;
});
</script>
