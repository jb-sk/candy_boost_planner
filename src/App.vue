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
          <button class="lang__btn" type="button" :class="{ 'lang__btn--on': uiLocale === 'ja' }" @click="setLocale('ja')">JP</button>
          <button class="lang__btn" type="button" :class="{ 'lang__btn--on': uiLocale === 'en' }" @click="setLocale('en')">EN</button>
          <button class="lang__btn lang__btn--help" type="button" @click="showHelp = true">{{ uiLocale === 'ja' ? '使い方' : 'Help' }}</button>
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
          <select class="design-switch-select" :value="currentDesign" @change="onDesignChange($event)">
            <option v-for="th in availableThemes" :key="th.id" :value="th.id">{{ th.label }}</option>
          </select>
        </div>
      </div>
    </header>

    <div class="dashboard">
      <CalcPanel ref="calcPanelRef" :calc="calc" :resolve-pokedex-id-by-box-id="resolvePokedexIdByBoxId" @apply-to-box="applyCalculatorToBox($event)" @open-help="showHelp = true" @open-settings="openSettings" @open-add-modal="showAddModal = true" />

    <BoxPanel :box="box" :gt="gt" @apply-to-calc="applyBoxToCalculator($event)" />
    </div>
    </div>

    <MobileNav :scroll-to-panel="scrollToPanel" v-show="!calc.exportOpen.value" @open-settings="openSettings" @scroll-top="scrollToTop" />

    <ExportOverlay
      v-if="calc.exportOpen.value"
      :scale="calc.exportScale.value"
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
      @close="calc.closeExport()"
      @open-settings="calc.closeExport(); openSettings()"
    />

    <HelpOverlay v-if="showHelp" @close="showHelp = false" />

    <SettingsOverlay v-if="showSettings" :calc="calc" @close="showSettings = false" />

    <AddPokemonModal v-if="showAddModal" :box="box" @close="showAddModal = false" @added="onAddModalAdded($event)" />
  </main>
</template>

<script setup lang="ts">
import { computed, ref, provide } from "vue";
import { useI18n } from "vue-i18n";
import { localizeGameTerm } from "./i18n/terms";
import type { ExpGainNature, ExpType } from "./domain/types";
import { getPokemonType } from "./domain/pokesleep/pokemon-names";

import ExportOverlay from "./components/ExportOverlay.vue";
import HelpOverlay from "./components/HelpOverlay.vue";
import SettingsOverlay from "./components/SettingsOverlay.vue";
import CalcPanel from "./components/CalcPanel.vue";
import BoxPanel from "./components/BoxPanel.vue";
import MobileNav from "./components/MobileNav.vue";
import AddPokemonModal from "./components/AddPokemonModal.vue";
import { useBoxStore } from "./composables/useBoxStore";
import { useCalcStore } from "./composables/useCalcStore";
import { buildThemeList, DEFAULT_THEME_ID, DESIGN_STORAGE_KEY } from "./config/themes";

const { t, locale } = useI18n();
const uiLocale = computed<"ja" | "en">(() => (locale.value === "en" ? "en" : "ja"));
function setLocale(next: "ja" | "en") {
  locale.value = next;
  localStorage.setItem("candy-boost-planner:lang", next);
}

type SupportLink = { id: "ofuse" | "bmac"; label: string; href: string; ariaLabel: string };

const showHelp = ref(false);
const showSettings = ref(false);
const showAddModal = ref(false);
const scrollContainerRef = ref<HTMLElement | null>(null);

// provide scroll container for child components that need programmatic scrolling
provide('scrollContainer', scrollContainerRef);
const calcPanelRef = ref<InstanceType<typeof CalcPanel> | null>(null);

function openSettings() {
  showSettings.value = true;
}

function onAddModalAdded(ev?: MouseEvent) {
  // AddPokemonModal → Box追加済み → selectedBox が新エントリを指している
  applyBoxToCalculator(ev);
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
      ariaLabel: locale.value === "en" ? "Open OFUSE in a new tab" : "OFUSEを新しいタブで開く",
    });
  }
  if (BMAC_URL) {
    out.push({
      id: "bmac",
      label: "Buy Me a Coffee",
      href: BMAC_URL,
      ariaLabel: locale.value === "en" ? "Open Buy Me a Coffee in a new tab" : "Buy Me a Coffeeを新しいタブで開く",
    });
  }
  return out;
});

const box = useBoxStore({ locale, t });

// boxId から pokedexId を解決する関数
function resolvePokedexIdByBoxId(boxId: string): number | undefined {
  const e = box.boxEntries.value.find((x) => x.id === boxId) ?? null;
  return e?.derived?.pokedexId;
}

const calc = useCalcStore({
  locale,
  t,
  resolveTitleByBoxId: (boxId) => {
    const e = box.boxEntries.value.find((x) => x.id === boxId) ?? null;
    return e ? box.displayBoxTitle(e) : null;
  },
  resolvePokedexIdByBoxId,
});

function applyBoxToCalculator(ev?: MouseEvent) {
  const e = box.selectedBox.value;
  if (!e) return;
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
    pokedexId,
    pokemonType,
    ev,
  });
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

  // CalcPanel の handleInputBlur による scrollIntoView を抑止する。
  // blur → 100ms setTimeout で元の入力欄に戻されてしまうため。
  calcPanelRef.value?.setNavScrolling();

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
const currentDesign = ref(localStorage.getItem(DESIGN_STORAGE_KEY) || DEFAULT_THEME_ID);
function onDesignChange(ev: Event) {
  const next = (ev.target as HTMLSelectElement).value;
  localStorage.setItem(DESIGN_STORAGE_KEY, next);
  currentDesign.value = next;
  window.location.reload();
}
</script>
