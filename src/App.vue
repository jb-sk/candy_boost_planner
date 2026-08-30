<template>
  <main :class="['shell', { 'shell--exportOpen': calc.exportOpen.value }]" :data-locale="locale">
    <div class="shell__scroll" ref="scrollContainerRef">
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

    <div class="dashboard">
      <CalcPanel :calc="calc" :resolve-pokedex-id-by-box-id="resolvePokedexIdByBoxId" @apply-to-box="applyCalculatorToBox($event)" @open-help="showHelp = true" @open-settings="openSettings" @open-add-modal="showAddModal = true" />

      <BoxPanel v-if="mountBoxPanel" :box="box" :calc="calc" :gt="gt" @apply-to-calc="applyBoxToCalculator(undefined, true)" @open-settings="showSettings = true" />
      <div v-else class="panel panel--box boxPanelDefer" aria-busy="true" aria-live="polite">
        <div class="panel__head">
          <h2 class="panel__title">{{ t("box.title") }}</h2>
        </div>
        <div class="boxPanelDefer__body" />
      </div>
    </div>
    </div>

    <MobileNav :scroll-to-panel="scrollToPanel" v-show="!calc.exportOpen.value" @open-settings="openSettings" @scroll-top="scrollToTop" />

    <AppToast />

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
import SettingsOverlay from "./components/SettingsOverlay.vue";
import { useBoxStore } from "./composables/useBoxStore";
import { useCalcStore } from "./composables/useCalcStore";
import { useCandyStore } from "./composables/useCandyStore";
import { useOnboarding } from "./composables/useOnboarding";
import { buildThemeList, DEFAULT_THEME_ID, DESIGN_STORAGE_KEY } from "./config/themes";

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

const onboarding = useOnboarding();

const scrollContainerRef = ref<HTMLElement | null>(null);
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
  const container = scrollContainerRef.value;
  if (!container) return;
  try {
    const containerTop = container.getBoundingClientRect().top;
    const anchors = Array.from(container.querySelectorAll<HTMLElement>("[data-scroll-anchor]"));
    const anchor = anchors
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= containerTop + 1 && rect.bottom > containerTop + 1;
      })
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
    const saved: SavedScrollPosition = { scrollTop: container.scrollTop };
    if (anchor) {
      saved.anchorKey = anchor.dataset.scrollAnchor;
      saved.anchorOffset = anchor.getBoundingClientRect().top - containerTop;
    }
    sessionStorage.setItem(SCROLL_POSITION_KEY, JSON.stringify(saved));
  } catch {
    // sessionStorage can be blocked (private mode / policy).
  }
}

function saveScrollPositionWhenHidden(): void {
  if (document.visibilityState === "hidden") saveScrollPosition();
}

// provide scroll container for child components that need programmatic scrolling
provide('scrollContainer', scrollContainerRef);
// provide onboarding state for CalcPanel (dummy result row + inline tooltip for step 3)
provide('onboardingActive', onboarding.isActive);
provide('onboarding', onboarding);
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function restoreReloadScrollPosition(saved: SavedScrollPosition): void {
  const container = scrollContainerRef.value;
  if (!container) return;
  container.scrollTop = saved.scrollTop;

  if (saved.anchorKey === undefined || saved.anchorOffset === undefined) return;
  const anchor = Array.from(container.querySelectorAll<HTMLElement>("[data-scroll-anchor]"))
    .find((element) => element.dataset.scrollAnchor === saved.anchorKey);
  if (!anchor) return;

  const previousOverflowAnchor = container.style.getPropertyValue("overflow-anchor");
  const previousPriority = container.style.getPropertyPriority("overflow-anchor");
  const calcPanel = document.getElementById("neo-calc");
  let finished = false;
  let stopPendingWatch: (() => void) | null = null;
  let resolvePendingWait: (() => void) | null = null;

  const adjust = () => {
    if (finished || !anchor.isConnected) return;
    const currentOffset = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const movedBy = currentOffset - saved.anchorOffset!;
    if (Math.abs(movedBy) >= 0.5) container.scrollTop += movedBy;
  };
  const restoreOverflowAnchor = () => {
    if (previousOverflowAnchor) {
      container.style.setProperty("overflow-anchor", previousOverflowAnchor, previousPriority);
    } else {
      container.style.removeProperty("overflow-anchor");
    }
  };
  const stop = () => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    stopPendingWatch?.();
    resolvePendingWait?.();
    resolvePendingWait = null;
    container.removeEventListener("pointerdown", stop);
    container.removeEventListener("wheel", stop);
    restoreOverflowAnchor();
  };
  const observer = typeof ResizeObserver !== "undefined" && calcPanel
    ? new ResizeObserver(adjust)
    : null;

  // 計算結果で上側の行高が変わっても、保存した表示位置を次のリロードへ累積させない。
  container.style.setProperty("overflow-anchor", "none");
  observer?.observe(calcPanel!);
  container.addEventListener("pointerdown", stop, { passive: true });
  container.addEventListener("wheel", stop, { passive: true });
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

function preserveBoxDetailPosition(update: () => void): void {
  const container = scrollContainerRef.value;
  const anchor = document.querySelector<HTMLElement>('[data-testid="box-detail-panel"]');
  if (!container || !anchor || window.matchMedia('(min-width: 1400px)').matches) {
    update();
    return;
  }

  const anchorTop = anchor.getBoundingClientRect().top;
  const previousOverflowAnchor = container.style.getPropertyValue('overflow-anchor');
  const previousPriority = container.style.getPropertyPriority('overflow-anchor');
  const calcPanel = document.getElementById('neo-calc');
  let finished = false;
  let stopPendingWatch: (() => void) | null = null;
  let resolvePendingWait: (() => void) | null = null;

  const restoreOverflowAnchor = () => {
    if (previousOverflowAnchor) {
      container.style.setProperty('overflow-anchor', previousOverflowAnchor, previousPriority);
    } else {
      container.style.removeProperty('overflow-anchor');
    }
  };
  const stop = () => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    stopPendingWatch?.();
    resolvePendingWait?.();
    container.removeEventListener('pointerdown', stop);
    container.removeEventListener('wheel', stop);
    restoreOverflowAnchor();
  };
  const adjust = () => {
    if (finished || !anchor.isConnected) return;
    const movedBy = anchor.getBoundingClientRect().top - anchorTop;
    if (Math.abs(movedBy) >= 0.5) container.scrollTop += movedBy;
  };
  const observer = typeof ResizeObserver !== 'undefined' && calcPanel
    ? new ResizeObserver(() => adjust())
    : null;

  // Safari の自動補正との二重適用を避け、今回の追加だけ実測値で補正する。
  container.style.setProperty('overflow-anchor', 'none');
  observer?.observe(calcPanel!);
  // 計算中にユーザーが次の操作を始めた場合は、自動補正を打ち切る。
  container.addEventListener('pointerdown', stop, { passive: true });
  container.addEventListener('wheel', stop, { passive: true });
  update();

  void (async () => {
    try {
      await nextTick();
      await nextAnimationFrame();
      await nextAnimationFrame();
      adjust();

      if (!finished && calc.planResultPending.value) {
        await new Promise<void>((resolve) => {
          resolvePendingWait = resolve;
          const stopWatch = watch(calc.planResultPending, (pending) => {
            if (!pending) {
              stopWatch();
              stopPendingWatch = null;
              resolve();
            }
          });
          stopPendingWatch = stopWatch;
        });
        resolvePendingWait = null;
        stopPendingWatch = null;
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

function applyBoxToCalculator(dstLevelDefault?: number, preserveScrollPosition = false) {
  const e = box.selectedBox.value;
  if (!e) return;
  const lvl = e.planner?.level ?? e.derived?.level ?? 10;
  const expT = (e.planner?.expType ?? e.derived?.expType ?? 600) as ExpType;
  const nat = (e.planner?.expGainNature ?? e.derived?.expGainNature ?? "normal") as ExpGainNature;
  const pokedexId = e.derived?.pokedexId;
  const pokemonType = pokedexId ? getPokemonType(pokedexId) : undefined;

  const upsert = () => {
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
  };
  if (preserveScrollPosition) preserveBoxDetailPosition(upsert);
  else upsert();
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

function scrollToPanel(id: string) {
  const el = document.getElementById(id);
  const container = scrollContainerRef.value;
  if (!el) return;

  // Prefer container-based scrolling.
  // Container scroll prevents iOS Safari address bar toggling
  // from stealing tap events on the fixed bottom nav.
  // Fall back to window scroll if .shell__scroll has no overflow-y: auto.
  if (container && container.scrollHeight > container.clientHeight) {
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const y = elRect.top - containerRect.top + container.scrollTop - 8;
    container.scrollTo({ top: y, behavior: "instant" });
  } else {
    const y = el.getBoundingClientRect().top + window.scrollY - 60;
    window.scrollTo({ top: y, behavior: "instant" });
  }
}

function scrollToTop() {
  const container = scrollContainerRef.value;
  if (container && container.scrollHeight > container.clientHeight) {
    container.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

// Design Switcher Logic — auto-detects themes from CSS files in styles/
// eager+query=url: only collects paths for theme list, does NOT load CSS
const availableThemes = buildThemeList(
  import.meta.glob("./styles/*.css", { eager: true, query: "?url" }) as Record<string, () => Promise<unknown>>,
);
const themeStyleUrls = Object.fromEntries(
  Object.entries(import.meta.glob("./styles/*.css", { eager: true, query: "?url", import: "default" }) as Record<string, string>)
    .map(([path, href]) => [path.match(/\/([^/]+)\.css$/)?.[1] ?? "", href])
    .filter(([id]) => id && id !== "base"),
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
  window.addEventListener("pagehide", saveScrollPosition);
  document.addEventListener("visibilitychange", saveScrollPositionWhenHidden);

  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  mountBoxPanel.value = true;
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (reloadScrollPosition !== null && scrollContainerRef.value) {
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
  window.removeEventListener("pagehide", saveScrollPosition);
  document.removeEventListener("visibilitychange", saveScrollPositionWhenHidden);
});
</script>
