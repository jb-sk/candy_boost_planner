<template>
  <Teleport to="body">
    <div
      v-if="step"
      class="onboarding-backdrop"
      @click.self="onboarding.next()"
      @touchmove="preventBackgroundScroll"
      @wheel="preventBackgroundScroll"
    >
      <!-- Spotlight cutout: GPU-composited via transform -->
      <div
        ref="spotlightRef"
        class="onboarding-spotlight"
      ></div>

      <!-- Tooltip bubble -->
      <div
        ref="tooltipRef"
        class="onboarding-tooltip"
        :class="'onboarding-tooltip--' + actualPlacement"
      >
        <div class="onboarding-tooltip__header">
          <span class="onboarding-tooltip__step">{{ onboarding.currentStep.value + 1 }} / {{ onboarding.totalSteps }}</span>
          <button class="onboarding-tooltip__skip" type="button" @click="onboarding.skip()">{{ t("onboarding.skip") }}</button>
        </div>
        <h3 v-if="step.titleKey" class="onboarding-tooltip__title">{{ t(step.titleKey) }}</h3>
        <p class="onboarding-tooltip__desc">{{ t(step.descKey) }}</p>
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

const step = computed(() => onboarding.step.value);
const isLastStep = computed(() => onboarding.currentStep.value === onboarding.totalSteps - 1);

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

/**
 * Old iOS ignores overflow: hidden on html, so the backdrop cancels scroll gestures itself.
 * A tooltip taller than a short (landscape) viewport scrolls internally, so it is left alone.
 */
function preventBackgroundScroll(event: TouchEvent | WheelEvent) {
  const tipEl = tooltipRef.value;
  if (
    tipEl
    && event.target instanceof Node
    && tipEl.contains(event.target)
    && tipEl.scrollHeight > tipEl.clientHeight
  ) {
    return;
  }
  event.preventDefault();
}

// ---------- Step initialization ----------

/**
 * The document is locked during onboarding, so the initial slot-tab centering in App.vue
 * remains authoritative. Steps never scroll: the in-place lock still allows programmatic
 * scrolling, and moving the page per step would break the centered layout.
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
  // The lock keeps programmatic scrolling (e.g. focus moving behind the backdrop), so follow it.
  window.addEventListener("scroll", onResize, { passive: true });
  window.addEventListener("orientationchange", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("scroll", onResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  window.removeEventListener("scroll", onResize);
  window.removeEventListener("orientationchange", onResize);
  window.visualViewport?.removeEventListener("resize", onResize);
  window.visualViewport?.removeEventListener("scroll", onResize);
  cancelAnimationFrame(rafId);
  cachedTargetEl = null;
});
</script>
