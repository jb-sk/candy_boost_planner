<template>
  <main class="shell" :data-locale="locale">
    <div class="shell__scroll">
    <header class="hero">
      <div>
        <p class="kicker">{{ t("app.kicker") }}</p>
        <h1 class="title">{{ t("app.title") }}</h1>
        <p class="lede">
          {{ t("app.lede") }}
        </p>
        <div class="lang">
          <button class="lang__btn" type="button" :class="{ 'lang__btn--on': uiLocale === 'ja' }" :disabled="localeSwitching" @click="setLocale('ja')">JP</button>
          <button class="lang__btn" type="button" :class="{ 'lang__btn--on': uiLocale === 'en' }" :disabled="localeSwitching" @click="setLocale('en')">EN</button>
          <button class="lang__btn lang__btn--help" type="button" @click="showHelp = true">{{ t("common.help") }}</button>
          <button class="lang__btn lang__btn--help" type="button" data-testid="open-event-history" @click="showEventHistory = true">{{ t("common.eventHistory") }}</button>
        </div>
      </div>
      <div class="heroMeta">
        <div class="support" v-if="supportLinks.length">
          <p class="support__label">{{ t("common.support") }}</p>
          <div class="support__links">
            <a
              v-for="l in supportLinks"
              :key="l.id"
              class="support__link"
              :href="l.href"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="l.ariaLabel"
            >
              {{ l.label }}
            </a>
          </div>
        </div>
        <div class="themePicker" v-if="availableThemes.length">
          <p class="themePicker__label">{{ t("common.theme") }}</p>
          <select class="design-switch-select" :value="currentDesign" :disabled="themeSwitching" @change="onDesignChange($event)">
            <option v-for="th in availableThemes" :key="th.id" :value="th.id">{{ th.label }}</option>
          </select>
        </div>
      </div>
    </header>

    <MobileNav
      :active-panel="activePanel"
      @select-panel="selectPanel($event)"
      @open-settings="openSettings"
      @scroll-top="scrollToTop"
    />

    <div class="dashboard">
      <CalcPanel
        v-show="isDesktopLayout || activePanel === 'calc'"
        :calc="calc"
        :resolve-pokedex-id-by-box-id="resolvePokedexIdByBoxId"
        :role="isDesktopLayout ? undefined : 'tabpanel'"
        :aria-labelledby="isDesktopLayout ? undefined : 'mobile-panel-tab-calc'"
        :aria-hidden="!isDesktopLayout && activePanel !== 'calc' ? 'true' : undefined"
        :inert="!isDesktopLayout && activePanel !== 'calc'"
        @apply-to-box="applyCalculatorToBox($event)"
        @open-help="showHelp = true"
        @open-settings="openSettings"
        @open-add-modal="showAddModal = true"
      />

      <BoxPanel
        v-if="mountBoxPanel"
        v-show="isDesktopLayout || activePanel === 'box'"
        :box="box"
        :calc="calc"
        :gt="gt"
        :role="isDesktopLayout ? undefined : 'tabpanel'"
        :aria-labelledby="isDesktopLayout ? undefined : 'mobile-panel-tab-box'"
        :aria-hidden="!isDesktopLayout && activePanel !== 'box' ? 'true' : undefined"
        :inert="!isDesktopLayout && activePanel !== 'box'"
        @apply-to-calc="applyBoxToCalculator()"
        @toggle-calc="toggleBoxInCalculator($event)"
        @open-settings="showSettings = true"
      />
      <div
        v-else
        v-show="isDesktopLayout || activePanel === 'box'"
        id="neo-box"
        class="panel panel--box boxPanelDefer"
        aria-busy="true"
        aria-live="polite"
        :role="isDesktopLayout ? undefined : 'tabpanel'"
        :aria-labelledby="isDesktopLayout ? undefined : 'mobile-panel-tab-box'"
      >
        <div class="panel__head">
          <h2 class="panel__title">{{ t("box.title") }}</h2>
        </div>
        <div class="boxPanelDefer__body" />
      </div>
    </div>
    </div>

    <AppToast />
    <NumericKeypad />

    <ExportOverlay
      v-if="calc.exportOpen.value"
      :rows="calc.exportRows.value"
      :totals="calc.exportActualTotals.value"
      :boost-used="calc.totalBoostCandyUsed.value"
      :boost-unused="calc.boostCandyUnused.value"
      :shards-used="calc.totalShardsUsed.value"
      :shards-cap="calc.shardsCap.value"
      :boost-usage-pct="calc.boostCandyUsagePctRounded.value"
      :boost-cap="calc.boostCandyCap.value"
      :boost-fill-pct="calc.boostCandyFillPctForBar.value"
      :shards-usage-pct="calc.shardsUsagePctRounded.value"
      :shards-fill-pct="calc.shardsFillPctForBar.value"
      :universal-candy-ranking="calc.universalCandyRanking.value"
      :universal-candy-used-total="calc.universalCandyUsedTotal.value"
      :boost-kind="calc.boostKind.value"
      :has-candy-stock="candyStore.hasAnyStock.value"
      @close="calc.closeExport()"
      @open-settings="calc.closeExport(); openSettings()"
    />

    <HelpOverlay v-if="showHelp" @close="showHelp = false" />

    <EventHistoryOverlay v-if="showEventHistory" @close="showEventHistory = false" />

    <SettingsOverlay v-if="showSettings" :calc="calc" :box="box" @close="showSettings = false" />

    <AddPokemonModal v-if="showAddModal" :box="box" :calc="calc" @close="showAddModal = false" @added="onAddModalAdded($event)" />

    <OnboardingTour v-if="onboarding.isActive.value" :onboarding="onboarding" />
  </main>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import type { Component } from "vue";
import { useI18n } from "vue-i18n";
import { ensureLocaleMessagesLoaded } from "./i18n";
import { localizeGameTerm } from "./i18n/terms";
import type { ExpGainNature, ExpType, PokemonBoxEntryV1 } from "./domain/types";
import { getPokemonType } from "./domain/pokesleep/pokemon-names";

import CalcPanel from "./components/CalcPanel.vue";
import BoxPanel from "./components/BoxPanel.vue";
import MobileNav from "./components/MobileNav.vue";
import AppToast from "./components/AppToast.vue";
import NumericKeypad from "./components/NumericKeypad.vue";
import SettingsOverlay from "./components/SettingsOverlay.vue";
import { useBoxStore } from "./composables/useBoxStore";
import { useCalcStore } from "./composables/useCalcStore";
import { useCandyStore } from "./composables/useCandyStore";
import { useOnboarding } from "./composables/useOnboarding";
import { buildThemeList, DEFAULT_THEME_ID, DESIGN_STORAGE_KEY } from "./config/themes";
import { entriesToObject } from "./utils/entriesToObject";

const i18n = useI18n();
const { t, locale } = i18n;
const uiLocale = computed<"ja" | "en">(() => (locale.value === "en" ? "en" : "ja"));
const localeSwitching = ref(false);
let localeRequestId = 0;

async function setLocale(next: "ja" | "en") {
  if (next === uiLocale.value) return;

  const requestId = ++localeRequestId;
  localeSwitching.value = true;

  try {
    await ensureLocaleMessagesLoaded(i18n, next);
    if (requestId !== localeRequestId) return;
    locale.value = next;
    localStorage.setItem("candy-boost-planner:lang", next);
  } finally {
    if (requestId === localeRequestId) {
      localeSwitching.value = false;
    }
  }
}

/** 遅延オーバーレイ用チャンク（トップ描画後にプリロードして初回オープン時の待ちを避ける） */
const loadExportOverlay = () => import("./components/ExportOverlay.vue");
const loadHelpOverlay = () => import("./components/HelpOverlay.vue");
const loadEventHistoryOverlay = () => import("./components/EventHistoryOverlay.vue");
const loadAddPokemonModal = () => import("./components/AddPokemonModal.vue");
const loadOnboardingTour = () => import("./components/OnboardingTour.vue");

function createAsyncOverlayComponent(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({
    loader,
    suspensible: false,
  });
}

const ExportOverlay = createAsyncOverlayComponent(loadExportOverlay);
const HelpOverlay = createAsyncOverlayComponent(loadHelpOverlay);
const EventHistoryOverlay = createAsyncOverlayComponent(loadEventHistoryOverlay);
const AddPokemonModal = createAsyncOverlayComponent(loadAddPokemonModal);
const OnboardingTour = createAsyncOverlayComponent(loadOnboardingTour);

function preloadOverlayChunks() {
  return Promise.all([
    loadExportOverlay(),
    loadHelpOverlay(),
    loadEventHistoryOverlay(),
    loadAddPokemonModal(),
    loadOnboardingTour(),
  ]);
}

type SupportLink = { id: "ofuse" | "bmac"; label: string; href: string; ariaLabel: string };

const showHelp = ref(false);
const showEventHistory = ref(false);
const showSettings = ref(false);
const showAddModal = ref(false);
/** 初回ペイント負荷分散: 計算機の直後に Box をマウントするとフレームが重いため、初回フレーム後にマウント */
const mountBoxPanel = ref(false);
const themeSwitching = ref(false);
type PanelId = 'calc' | 'box';
const activePanel = ref<PanelId>('calc');
const desktopMediaQuery = window.matchMedia('(min-width: 1400px)');
const isDesktopLayout = ref(desktopMediaQuery.matches);
const panelScrollOffsets: Record<PanelId, number> = { calc: 0, box: 0 };

const onboarding = useOnboarding();

const SCROLL_POSITION_KEY = "candy-boost-planner:ui:scrollTop:v1";

type SavedScrollPosition = {
  scrollTop: number;
  anchorKey?: string;
  anchorOffset?: number;
};

function readReloadScrollPosition(): SavedScrollPosition | null {
  try {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const raw = sessionStorage.getItem(SCROLL_POSITION_KEY);
    sessionStorage.removeItem(SCROLL_POSITION_KEY);
    if (navigation?.type !== "reload" || raw === null) return null;

    // v1 の数値だけの保存値も読み取り、既存セッションからのリロードを壊さない。
    if (!raw.startsWith("{")) {
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? { scrollTop: value } : null;
    }

    const saved = JSON.parse(raw) as Partial<SavedScrollPosition>;
    if (!Number.isFinite(saved.scrollTop) || Number(saved.scrollTop) < 0) return null;
    return {
      scrollTop: Number(saved.scrollTop),
      anchorKey: typeof saved.anchorKey === "string" ? saved.anchorKey : undefined,
      anchorOffset: Number.isFinite(saved.anchorOffset) ? Number(saved.anchorOffset) : undefined,
    };
  } catch {
    return null;
  }
}

const reloadScrollPosition = readReloadScrollPosition();

function saveScrollPosition(): void {
  try {
    const anchors = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-anchor]"));
    const anchor = anchors
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= 1 && rect.bottom > 1;
      })
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
    const saved: SavedScrollPosition = { scrollTop: currentDocumentScrollY() };
    if (anchor) {
      saved.anchorKey = anchor.dataset.scrollAnchor;
      saved.anchorOffset = anchor.getBoundingClientRect().top;
    }
    sessionStorage.setItem(SCROLL_POSITION_KEY, JSON.stringify(saved));
  } catch {
    // sessionStorage can be blocked (private mode / policy).
  }
}

function saveScrollPositionWhenHidden(): void {
  if (document.visibilityState === "hidden") saveScrollPosition();
}

// CalcPanel のダミー結果行。初回訪問ではツアー開始（600ms 後）を待たず最初の描画から出す。
// ツアー開始時に差し込むと、操作起点でないレイアウトシフトとして CLS に数えられるため。
provide('onboardingDemoVisible', computed(() => onboarding.isActive.value || !onboarding.isDone.value));
function openSettings() {
  showSettings.value = true;
}

function onAddModalAdded(dstLevel: number) {
  // AddPokemonModal → Box追加済み → selectedBox が新エントリを指している
  applyBoxToCalculator(dstLevel);
  // モーダルは閉じない（連続追加を可能にする）
}

function gt(s: string): string {
  return localizeGameTerm(s, locale.value);
}

/**
 * Support links (donations)
 *
 * Set URLs via Vite env:
 * - VITE_OFUSE_URL=https://ofuse.me/xxxx
 * - VITE_BMAC_URL=https://buymeacoffee.com/xxxx
 */
const OFUSE_URL = (import.meta.env.VITE_OFUSE_URL ?? "").trim();
const BMAC_URL = (import.meta.env.VITE_BMAC_URL ?? "").trim();

const supportLinks = computed<SupportLink[]>(() => {
  const out: SupportLink[] = [];
  if (OFUSE_URL) {
    out.push({
      id: "ofuse",
      label: "OFUSE",
      href: OFUSE_URL,
      ariaLabel: t("common.ariaOfuse"),
    });
  }
  if (BMAC_URL) {
    out.push({
      id: "bmac",
      label: "Buy Me a Coffee",
      href: BMAC_URL,
      ariaLabel: t("common.ariaBmac"),
    });
  }
  return out;
});

const box = useBoxStore({ locale, t });
const candyStore = useCandyStore();

/**
 * ボックスが数百〜最大1000体のとき、計算機の rowsView / plan が毎回 boxId を線形探索すると重くなるため Map で O(1) 解決する。
 * boxEntries が変わったときだけ再構築（計算のみのフレームでは触れない）。
 */
const boxEntryById = computed(() => {
  const m = new Map<string, PokemonBoxEntryV1>();
  for (const e of box.boxEntries.value) {
    m.set(e.id, e);
  }
  return m;
});

function resolvePokedexIdByBoxId(boxId: string): number | undefined {
  return boxEntryById.value.get(boxId)?.derived?.pokedexId;
}

const calc = useCalcStore({
  locale,
  t,
  resolveTitleByBoxId: (boxId) => {
    const e = boxEntryById.value.get(boxId);
    return e ? box.displayBoxTitle(e) : null;
  },
  resolvePokedexIdByBoxId,
});

const overlayOpen = computed(() => (
  calc.exportOpen.value
  || showHelp.value
  || showEventHistory.value
  || showSettings.value
  || showAddModal.value
  || onboarding.isActive.value
));

type InlineStyleSnapshot = {
  value: string;
  priority: string;
};

let releaseDocumentScrollLock: (() => void) | null = null;
let lockedDocumentScrollY: number | null = null;

function currentDocumentScrollY(): number {
  return lockedDocumentScrollY ?? window.scrollY;
}

function snapshotInlineProperty(element: HTMLElement, property: string): InlineStyleSnapshot {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
}

function restoreInlineProperty(
  element: HTMLElement,
  property: string,
  snapshot: InlineStyleSnapshot,
): void {
  if (snapshot.value) {
    element.style.setProperty(property, snapshot.value, snapshot.priority);
  } else {
    element.style.removeProperty(property);
  }
}

function lockDocumentScroll(): () => void {
  const root = document.documentElement;
  const body = document.body;
  const rootOverflow = snapshotInlineProperty(root, "overflow");
  const bodyProperties = new Map<string, InlineStyleSnapshot>();
  for (const property of ["overflow", "position", "top", "left", "right", "width", "padding-right"]) {
    bodyProperties.set(property, snapshotInlineProperty(body, property));
  }
  const scrollY = window.scrollY;
  const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
  const bodyPaddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
  lockedDocumentScrollY = scrollY;

  root.style.setProperty("overflow", "hidden");
  body.style.setProperty("overflow", "hidden");
  body.style.setProperty("position", "fixed");
  body.style.setProperty("top", `${-scrollY}px`);
  body.style.setProperty("left", "0");
  body.style.setProperty("right", "0");
  body.style.setProperty("width", "100%");
  if (scrollbarWidth > 0) {
    body.style.setProperty("padding-right", `${bodyPaddingRight + scrollbarWidth}px`);
  }

  return () => {
    restoreInlineProperty(root, "overflow", rootOverflow);
    for (const [property, snapshot] of bodyProperties) {
      restoreInlineProperty(body, property, snapshot);
    }
    window.scrollTo(0, scrollY);
    lockedDocumentScrollY = null;
  };
}

/**
 * オンボーディング用の背景固定。初回表示で操作なしに始まるため、
 * body を position: fixed にすると document のスクロール位置が 0 へ戻り、
 * 見た目は同じでも Chrome がページ全体のレイアウトシフト（CLS）として数える。
 * ここではスクロール位置を変えずに html の overflow だけを止める。
 * overflow を無視する古い iOS のタッチ操作は OnboardingTour の背景で止める。
 */
function lockDocumentScrollInPlace(): () => void {
  const root = document.documentElement;
  const body = document.body;
  const rootOverflow = snapshotInlineProperty(root, "overflow");
  const bodyPaddingRightSnapshot = snapshotInlineProperty(body, "padding-right");
  const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
  const bodyPaddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;

  root.style.setProperty("overflow", "hidden");
  if (scrollbarWidth > 0) {
    body.style.setProperty("padding-right", `${bodyPaddingRight + scrollbarWidth}px`);
  }

  return () => {
    restoreInlineProperty(root, "overflow", rootOverflow);
    restoreInlineProperty(body, "padding-right", bodyPaddingRightSnapshot);
  };
}

/**
 * オンボーディングでは上下にある操作と結果例を同時に見せるため、
 * 背景を固定する直前にスロットタブを画面中央へ置く。
 */
function centerOnboardingSlotTabs(): void {
  const slotTabs = document.querySelector<HTMLElement>('[data-testid="calc-slot-tabs"]');
  if (!slotTabs) return;

  const rect = slotTabs.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportCenter = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) / 2;
  window.scrollTo(0, Math.max(0, window.scrollY + rect.top + rect.height / 2 - viewportCenter));
}

watch(overlayOpen, (locked) => {
  if (locked) {
    if (releaseDocumentScrollLock) return;
    if (onboarding.isActive.value) {
      centerOnboardingSlotTabs();
      releaseDocumentScrollLock = lockDocumentScrollInPlace();
      return;
    }
    releaseDocumentScrollLock = lockDocumentScroll();
    return;
  }
  releaseDocumentScrollLock?.();
  releaseDocumentScrollLock = null;
}, { flush: "post" });

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function restoreReloadScrollPosition(saved: SavedScrollPosition): void {
  window.scrollTo(0, saved.scrollTop);

  if (saved.anchorKey === undefined || saved.anchorOffset === undefined) return;
  const anchor = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-anchor]"))
    .find((element) => element.dataset.scrollAnchor === saved.anchorKey);
  if (!anchor) return;

  const scrollRoot = document.documentElement;
  const previousOverflowAnchor = scrollRoot.style.getPropertyValue("overflow-anchor");
  const previousPriority = scrollRoot.style.getPropertyPriority("overflow-anchor");
  const calcPanel = document.getElementById("neo-calc");
  let finished = false;
  let stopPendingWatch: (() => void) | null = null;
  let resolvePendingWait: (() => void) | null = null;

  const adjust = () => {
    if (finished || !anchor.isConnected) return;
    const currentOffset = anchor.getBoundingClientRect().top;
    const movedBy = currentOffset - saved.anchorOffset!;
    if (Math.abs(movedBy) >= 0.5) window.scrollBy(0, movedBy);
  };
  const restoreOverflowAnchor = () => {
    if (previousOverflowAnchor) {
      scrollRoot.style.setProperty("overflow-anchor", previousOverflowAnchor, previousPriority);
    } else {
      scrollRoot.style.removeProperty("overflow-anchor");
    }
  };
  const stop = () => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    stopPendingWatch?.();
    resolvePendingWait?.();
    resolvePendingWait = null;
    window.removeEventListener("pointerdown", stop);
    window.removeEventListener("mousedown", stop);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("wheel", stop);
    restoreOverflowAnchor();
  };
  const observer = typeof ResizeObserver !== "undefined" && calcPanel
    ? new ResizeObserver(adjust)
    : null;

  // 計算結果で上側の行高が変わっても、保存した表示位置を次のリロードへ累積させない。
  scrollRoot.style.setProperty("overflow-anchor", "none");
  observer?.observe(calcPanel!);
  window.addEventListener("pointerdown", stop, { passive: true });
  window.addEventListener("mousedown", stop, { passive: true });
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("wheel", stop, { passive: true });
  adjust();

  void (async () => {
    try {
      // 初期化直後に計算がスケジュールされる場合も拾う。
      await nextAnimationFrame();
      await nextAnimationFrame();
      adjust();
      if (calc.planResultPending.value) {
        await new Promise<void>((resolve) => {
          resolvePendingWait = resolve;
          stopPendingWatch = watch(calc.planResultPending, (pending) => {
            if (!pending) {
              stopPendingWatch?.();
              stopPendingWatch = null;
              resolvePendingWait = null;
              resolve();
            }
          });
        });
      }
      await nextTick();
      await nextAnimationFrame();
      await nextAnimationFrame();
      adjust();
    } finally {
      stop();
    }
  })();
}

function applyBoxToCalculator(dstLevelDefault?: number) {
  const e = box.selectedBox.value;
  if (!e) return;
  // viewport変更直後はMediaQueryListのchange通知より先にクリックされる場合がある。
  // 画面区分では分岐せず、表示中の詳細パネルそのものをアンカーにする。
  const detailPanel = document.querySelector<HTMLElement>('[data-testid="box-detail-panel"]');
  const detailTop = detailPanel?.getBoundingClientRect().top;

  applyBoxEntryToCalculator(e, dstLevelDefault);

  if (!detailPanel || detailTop === undefined) return;
  void restoreElementViewportTop(detailPanel, detailTop);
}

let cancelElementViewportRestore: (() => void) | null = null;

/**
 * リアクティブ更新でアンカーより上の高さが変わっても、操作した要素を同じ位置に保つ。
 * Chromium / Safari の自動スクロールアンカーの有無に依存させない。
 */
async function restoreElementViewportTop(element: HTMLElement, top: number): Promise<void> {
  cancelElementViewportRestore?.();
  let frameId = 0;
  let cancelled = false;
  let resolveTracking: (() => void) | null = null;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(frameId);
    resolveTracking?.();
  };
  cancelElementViewportRestore = cancel;

  await nextTick();
  if (cancelled) return;

  const minTrackingMs = 750;
  const stableForMs = 250;
  const maxTrackingMs = 3000;
  const startedAt = performance.now();
  let lastMovementAt = startedAt;

  const stopForUserInput = () => cancel();
  window.addEventListener("pointerdown", stopForUserInput, { passive: true });
  window.addEventListener("touchstart", stopForUserInput, { passive: true });
  window.addEventListener("wheel", stopForUserInput, { passive: true });

  try {
    await new Promise<void>((resolve) => {
      resolveTracking = resolve;
      const track = (now: number) => {
        if (cancelled || !element.isConnected) {
          resolve();
          return;
        }

        const movedBy = element.getBoundingClientRect().top - top;
        if (Math.abs(movedBy) >= 0.5) {
          window.scrollBy(0, movedBy);
          lastMovementAt = now;
        }

        const elapsed = now - startedAt;
        const isStable = now - lastMovementAt >= stableForMs;
        const planningFinished = !calc.planResultPending.value;
        if (
          elapsed >= maxTrackingMs
          || (elapsed >= minTrackingMs && isStable && planningFinished)
        ) {
          resolve();
          return;
        }
        frameId = requestAnimationFrame(track);
      };
      frameId = requestAnimationFrame(track);
    });
  } finally {
    resolveTracking = null;
    window.removeEventListener("pointerdown", stopForUserInput);
    window.removeEventListener("touchstart", stopForUserInput);
    window.removeEventListener("wheel", stopForUserInput);
    if (cancelElementViewportRestore === cancel) cancelElementViewportRestore = null;
  }
}

function applyBoxEntryToCalculator(e: PokemonBoxEntryV1, dstLevelDefault?: number) {
  const lvl = e.planner?.level ?? e.derived?.level ?? 10;
  const expT = (e.planner?.expType ?? e.derived?.expType ?? 600) as ExpType;
  const nat = (e.planner?.expGainNature ?? e.derived?.expGainNature ?? "normal") as ExpGainNature;
  const pokedexId = e.derived?.pokedexId;
  const pokemonType = pokedexId ? getPokemonType(pokedexId) : undefined;

  calc.upsertFromBox({
    boxId: e.id,
    title: box.displayBoxTitle(e),
    srcLevel: Number(lvl),
    expType: expT,
    nature: nat,
    expRemaining: e.planner?.expRemaining,
    sleepHours: e.planner?.sleepHours,
    dstLevelDefault,
    pokedexId,
    pokemonType,
  });
}

function toggleBoxInCalculator(boxId: string) {
  const existing = calc.rows.value.find((row) => row.boxId === boxId);
  if (existing) {
    calc.removeRowById(existing.id);
    return;
  }
  const entry = box.boxEntries.value.find((candidate) => candidate.id === boxId);
  if (entry) applyBoxEntryToCalculator(entry);
}

function applyCalculatorToBox(rowId: string) {
  const patch = calc.buildPlannerPatchFromRow(rowId);
  if (!patch) return;
  const e = box.boxEntries.value.find((x) => x.id === patch.boxId) ?? null;
  if (!e) return;
  const now = new Date().toISOString();
  box.boxEntries.value = box.boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        level: patch.level,
        expRemaining: patch.expRemaining,
        sleepHours: patch.sleepHours,
      },
      updatedAt: now,
    };
  });
  box.selectedBoxId.value = e.id;
  box.importStatus.value = t("status.applyCalcToBox");
}

function captureActivePanelScroll(): void {
  if (isDesktopLayout.value) return;
  const element = document.getElementById(`neo-${activePanel.value}`);
  if (!element) return;
  const panelTop = element.getBoundingClientRect().top + window.scrollY;
  panelScrollOffsets[activePanel.value] = Math.max(
    0,
    window.scrollY + getPanelNavHeight() - panelTop,
  );
}

async function selectPanel(panel: PanelId): Promise<void> {
  const isDesktopNow = desktopMediaQuery.matches;
  if (isDesktopLayout.value !== isDesktopNow) {
    isDesktopLayout.value = isDesktopNow;
  }

  if (isDesktopNow) {
    scrollToPanel(`neo-${panel}`);
    return;
  }

  if (panel === activePanel.value) {
    scrollToPanel(`neo-${panel}`);
    return;
  }

  captureActivePanelScroll();
  activePanel.value = panel;
  await nextTick();

  const element = document.getElementById(`neo-${panel}`);
  if (!element) return;
  const panelTop = element.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(
    0,
    Math.max(0, panelTop + panelScrollOffsets[panel] - getPanelNavHeight()),
  );
}

function getPanelNavHeight(): number {
  if (isDesktopLayout.value) return 0;
  return document.querySelector<HTMLElement>('.mobileNav')?.offsetHeight ?? 0;
}

function scrollToPanel(id: string) {
  const el = document.getElementById(id);
  if (!el) return;

  const panelNavHeight = getPanelNavHeight();
  const desktopGutter = panelNavHeight === 0 ? 8 : 0;
  const y = el.getBoundingClientRect().top + window.scrollY - panelNavHeight - desktopGutter;
  window.scrollTo(0, Math.max(0, y));
}

function scrollToTop() {
  window.scrollTo(0, 0);
}

function onDesktopLayoutChange(event: MediaQueryListEvent): void {
  isDesktopLayout.value = event.matches;
}

// Design Switcher Logic — auto-detects themes from CSS files in styles/
// eager+query=url: only collects paths for theme list, does NOT load CSS
const availableThemes = buildThemeList(
  import.meta.glob("./styles/*.css", { eager: true, query: "?url" }) as Record<string, () => Promise<unknown>>,
);
const themeStyleUrls = entriesToObject(
  Object.entries(import.meta.glob("./styles/*.css", { eager: true, query: "?url", import: "default" }) as Record<string, string>)
    .map(([path, href]) => [path.match(/\/([^/]+)\.css$/)?.[1] ?? "", href])
    .filter(([id]) => id && id !== "base") as [string, string][],
) as Record<string, string>;
const currentDesign = ref(localStorage.getItem(DESIGN_STORAGE_KEY) || DEFAULT_THEME_ID);
async function onDesignChange(ev: Event) {
  const next = (ev.target as HTMLSelectElement).value;
  if (next === currentDesign.value || themeSwitching.value) return;

  localStorage.setItem(DESIGN_STORAGE_KEY, next);

  const currentLink = document.getElementById("theme-css") as HTMLLinkElement | null;
  const nextHref = themeStyleUrls[next];

  if (!currentLink || !nextHref) {
    currentDesign.value = next;
    window.location.reload();
    return;
  }

  themeSwitching.value = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const nextLink = currentLink.cloneNode() as HTMLLinkElement;
      nextLink.id = "theme-css-next";
      nextLink.href = nextHref;
      nextLink.addEventListener("load", () => {
        currentLink.remove();
        nextLink.id = "theme-css";
        resolve();
      }, { once: true });
      nextLink.addEventListener("error", () => reject(new Error(`Failed to load theme: ${next}`)), { once: true });
      currentLink.insertAdjacentElement("afterend", nextLink);
    });

    currentDesign.value = next;
  } catch {
    currentDesign.value = next;
    window.location.reload();
  } finally {
    themeSwitching.value = false;
  }
}

onMounted(async () => {
  if (typeof desktopMediaQuery.addEventListener === 'function') {
    desktopMediaQuery.addEventListener('change', onDesktopLayoutChange);
  } else {
    desktopMediaQuery.addListener(onDesktopLayoutChange);
  }
  window.addEventListener("pagehide", saveScrollPosition);
  document.addEventListener("visibilitychange", saveScrollPositionWhenHidden);

  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  mountBoxPanel.value = true;
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (reloadScrollPosition !== null) {
    restoreReloadScrollPosition(reloadScrollPosition);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  const scheduleIdle =
    typeof requestIdleCallback !== "undefined"
      ? (cb: () => void) => requestIdleCallback(cb)
      : (cb: () => void) => setTimeout(cb, 0);
  scheduleIdle(() => {
    void preloadOverlayChunks();
  });

  if (!onboarding.isDone.value) {
    setTimeout(() => onboarding.start(), 600);
  }
});

onBeforeUnmount(() => {
  cancelElementViewportRestore?.();
  cancelElementViewportRestore = null;
  if (typeof desktopMediaQuery.removeEventListener === 'function') {
    desktopMediaQuery.removeEventListener('change', onDesktopLayoutChange);
  } else {
    desktopMediaQuery.removeListener(onDesktopLayoutChange);
  }
  releaseDocumentScrollLock?.();
  releaseDocumentScrollLock = null;
  window.removeEventListener("pagehide", saveScrollPosition);
  document.removeEventListener("visibilitychange", saveScrollPositionWhenHidden);
});
</script>
