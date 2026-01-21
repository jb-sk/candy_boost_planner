<template>
  <main :class="['shell', { 'shell--exportOpen': calc.exportOpen.value }]" :data-locale="locale">
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
    </header>
    <MobileNav :scroll-to-panel="scrollToPanel" v-show="!calc.exportOpen.value" @open-settings="openSettings" />

    <div class="dashboard">
      <CalcPanel :calc="calc" :resolve-pokedex-id-by-box-id="resolvePokedexIdByBoxId" @apply-to-box="applyCalculatorToBox($event)" @open-help="showHelp = true" @open-settings="openSettings" />

    <BoxPanel :box="box" :gt="gt" @apply-to-calc="applyBoxToCalculator($event)" />
    </div>

    <ExportOverlay
      v-if="calc.exportOpen.value"
      :scale="calc.exportScale.value"
      :rows="calc.exportRows.value"
      :totals="calc.exportTotals.value"
      :boost-used="calc.totalBoostCandyUsed.value"
      :boost-unused="calc.boostCandyUnused.value"
      :shards-used="calc.totalShardsUsed.value"
      :boost-over="calc.boostCandyOver.value"
      :shards-over="calc.shardsOver.value"
      :shards-cap="calc.shardsCap.value"
      :boost-usage-pct="calc.boostCandyUsagePctRounded.value"
      :boost-cap="calc.boostCandyCap.value"
      :boost-fill-pct="calc.boostCandyFillPctForBar.value"
      :boost-over-pct="calc.boostCandyOverPctForBar.value"
      :shards-usage-pct="calc.shardsUsagePctRounded.value"
      :shards-fill-pct="calc.shardsFillPctForBar.value"
      :shards-over-pct="calc.shardsOverPctForBar.value"
      :show-boost-fire="calc.showBoostCandyFire.value"
      :show-shards-fire="calc.showShardsFire.value"
      :universal-candy-ranking="calc.universalCandyRanking.value"
      :universal-candy-used-total="calc.universalCandyUsedTotal.value"
      :boost-kind="calc.boostKind.value"
      @close="calc.closeExport()"
    />

    <HelpOverlay v-if="showHelp" @close="showHelp = false" />

    <SettingsOverlay v-if="showSettings" :calc="calc" @close="showSettings = false" />
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
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
import { useBoxStore } from "./composables/useBoxStore";
import { useCalcStore } from "./composables/useCalcStore";

const { t, locale } = useI18n();
const uiLocale = computed<"ja" | "en">(() => (locale.value === "en" ? "en" : "ja"));
function setLocale(next: "ja" | "en") {
  locale.value = next;
  localStorage.setItem("candy-boost-planner:lang", next);
}

type SupportLink = { id: "ofuse" | "bmac"; label: string; href: string; ariaLabel: string };

const showHelp = ref(false);
const showSettings = ref(false);

function openSettings() {
  showSettings.value = true;
}

function gt(s: string): string {
  return localizeGameTerm(s, locale.value as any);
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
  if (el) {
    // Offset for sticky nav
    const y = el.getBoundingClientRect().top + window.scrollY - 60;
    window.scrollTo({ top: y, behavior: "smooth" });
  }
}
</script>
