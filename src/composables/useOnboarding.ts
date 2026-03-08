import { ref, computed } from "vue";

const STORAGE_KEY = "candy-boost-planner:onboarding-done";

/** Detect touch device safely (SSR / test-environment guard) */
const isTouchDevice =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

export interface OnboardingStep {
  /** CSS selector for the target element to highlight */
  target: string;
  /** i18n key for the title */
  titleKey: string;
  /** i18n key for the description */
  descKey: string;
  /** Preferred tooltip placement relative to target */
  placement: "top" | "bottom";
}

const STEPS: OnboardingStep[] = [
  {
    target: "[data-onboarding='add-pokemon']",
    titleKey: "",
    descKey: "onboarding.step1Desc",
    placement: "bottom",
  },
  {
    target: "[data-onboarding='settings']",
    titleKey: "",
    descKey: "onboarding.step2Desc",
    placement: "bottom",
  },
  {
    target: "[data-onboarding='result-row']",
    titleKey: "",
    descKey: "onboarding.step3Desc",
    placement: "top",
  },
];

export function useOnboarding() {
  const isDone = ref(localStorage.getItem(STORAGE_KEY) === "1");
  const isActive = ref(false);
  const currentStep = ref(0);

  const step = computed<OnboardingStep | null>(() =>
    isActive.value ? STEPS[currentStep.value] ?? null : null,
  );

  const totalSteps = STEPS.length;

  function start() {
    if (isDone.value) return;
    currentStep.value = 0;
    isActive.value = true;
  }

  function next() {
    if (currentStep.value < STEPS.length - 1) {
      currentStep.value++;
    } else {
      finish();
    }
  }

  function finish() {
    isActive.value = false;
    isDone.value = true;
    localStorage.setItem(STORAGE_KEY, "1");
  }

  function skip() {
    finish();
  }

  /** Reset for testing / re-show */
  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    isDone.value = false;
    isActive.value = false;
    currentStep.value = 0;
  }

  /** i18n key for the action verb — "onboarding.actionTap" or "onboarding.actionClick" */
  const actionI18nKey = isTouchDevice
    ? "onboarding.actionTap"
    : "onboarding.actionClick";

  return {
    isActive,
    isDone,
    currentStep,
    step,
    totalSteps,
    isTouchDevice,
    actionI18nKey,
    start,
    next,
    skip,
    finish,
    reset,
  };
}
