<template>
  <main :class="['shell', { 'shell--exportOpen': calc.exportOpen.value }]" :data-locale="locale">
    <HeroHeader :locale="uiLocale" :support-links="supportLinks" :set-locale="setLocale" :open-help="() => showHelp = true" />
    <MobileNav :scroll-to-panel="scrollToPanel" v-show="!calc.exportOpen.value" />

    <div class="dashboard">
      <CalcPanel :calc="calc" :resolve-pokedex-id-by-box-id="resolvePokedexIdByBoxId" @apply-to-box="applyCalculatorToBox($event)" @open-help="showHelp = true" />

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
import CalcPanel from "./components/CalcPanel.vue";
import BoxPanel from "./components/BoxPanel.vue";
import HeroHeader from "./components/HeroHeader.vue";
import type { SupportLink } from "./components/HeroHeader.vue";
import MobileNav from "./components/MobileNav.vue";
import { useBoxStore } from "./composables/useBoxStore";
import { useCalcStore } from "./composables/useCalcStore";

const { t, locale } = useI18n();
const uiLocale = computed<"ja" | "en">(() => (locale.value === "en" ? "en" : "ja"));
function setLocale(next: "ja" | "en") {
  locale.value = next;
  localStorage.setItem("candy-boost-planner:lang", next);
}
const showHelp = ref(false);

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
        expType: patch.expType,
        expGainNature: patch.expGainNature,
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

<style>
.shell {
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 18px 64px;
}
@media (max-width: 1023px) {
  .shell {
    padding-top: 0; /* sticky nav sits at top */
  }
}
@media (max-width: 560px) {
  .shell {
    padding-left: 8px !important;
    padding-right: 8px !important;
  }
}


.panel {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--paper) 98%, var(--ink) 2%),
    color-mix(in oklab, var(--paper) 92%, var(--ink) 8%)
  );
  border-radius: 18px;
  padding: 18px 18px;
  box-shadow: var(--shadow-1);
}
/* Prevent scroll anchoring jumps when calc content (above the box) changes */
.panel--calc {
  overflow-anchor: none;
}

/* --- Mobile layout polish (avoid horizontal clipping) --- */
/* --- Mobile layout polish (avoid horizontal clipping) --- */
@media (max-width: 560px) {
  /* Mobile is narrow: remove outer "panel" frame so content can breathe */
  .panel.panel--calc,
  .panel.panel--box {
    border: 0;
    box-shadow: none;
    background: transparent;
    border-radius: 0;
    padding: 0;
  }
}
.panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.panel__side {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.panel__title {
  font-family: var(--font-heading);
  letter-spacing: -0.01em;
  margin: 0 0 10px;
}
.panel__list {
  margin: 0;
  padding-left: 18px;
  font-family: var(--font-body);
  line-height: 1.8;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}
@media (min-width: 860px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}




.field--sm {
  gap: 1px; /* ラベルと入力の距離を詰める */
}
.field--sm .field__label {
  font-size: 10px;
  letter-spacing: 0.04em;
  height: 14px; /* さらに圧縮 */
  display: flex;
  align-items: center;
  line-height: 1.1;
  padding-bottom: 0;
  margin-top: 3px; /* ラベルの上に余白を作り、上の入力欄から離す */
  width: 100%;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.field--sm .field__input {
  padding: 0 10px; /* Vertical centering via height/flex is safer for inputs, but for simple fix: */
  height: 32px;
  display: flex;
  align-items: center;
  border-radius: 10px;
}
/* Ensure select/input text is vertically centered */
input.field__input, select.field__input {
  line-height: normal;
  padding-top: 0;
  padding-bottom: 0;
}
.field--sm .field__sub {
  font-size: 10px;
}
.field--sm .field__range {
  /* margin は環境によって効きが弱いので、視覚的に確実に下げる */
  transform: translateY(4px);
  margin-bottom: -2px; /* サブ表示との距離を詰める */
}

.linkBtn {
  appearance: none;
  background: transparent;
  border: 0;
  box-shadow: none;
  font-family: var(--font-body);
  font-size: 12px; /* 小さめ */
  text-decoration: underline dotted;
  cursor: pointer;
  color: var(--muted);
  padding: 0;
}
.linkBtn:hover:not(:disabled) {
  color: var(--accent);
}
.linkBtn:disabled {
  opacity: 0.3;
  cursor: default;
  text-decoration: none;
}
.linkBtn--danger {
  color: var(--danger);
  opacity: 0.8;
}
.linkBtn--danger:hover:not(:disabled) {
  color: #b91c1c; /* darker red */
  opacity: 1;
}
.linkBtn--basic {
  text-decoration: underline dotted;
  color: var(--ink);
  opacity: 0.7;
}
.linkBtn--basic:hover {
  color: var(--accent);
  opacity: 1;
}

/* --- Level picker (nitoyon-like) --- */
.levelPick {
  position: relative;
}
.levelPick__button {
  width: 100%;
  text-align: left;
}
.field__input--button {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
}
.field__input--button::after {
  content: "▾";
  color: color-mix(in oklab, var(--ink) 55%, transparent);
  font-size: 12px;
}
.levelPick__popover {
  position: absolute;
  z-index: 40;
  left: 0;
  top: calc(100% + 8px);
  width: min(360px, 78vw);
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  border-radius: 16px;
  padding: 12px;
  box-shadow:
    0 16px 32px color-mix(in oklab, var(--ink) 18%, transparent),
    0 2px 0 color-mix(in oklab, var(--ink) 10%, transparent);
}
@media (max-width: 640px) {
  .levelPick__popover {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(300px, 90vw);
    box-shadow: 0 20px 50px rgba(0,0,0,0.4);
    border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
  }
}
.levelPick__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.levelPick__title {
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -0.01em;
}
.levelPick__sliderRow {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
}
.levelPick__range {
  width: 100%;
  accent-color: color-mix(in oklab, var(--accent) 72%, var(--ink) 20%);
}
.levelPick__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.boxSort {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  --boxSortH: 36px;
}
.boxSort .btn {
  white-space: nowrap;
  min-width: 56px; /* 「昇順/降順」が2行にならない程度 */
  height: var(--boxSortH);
  padding-top: 0;
  padding-bottom: 0;
  display: inline-flex; /* justify-content を効かせる */
  align-items: center;
  justify-content: center; /* 「昇順」を中央ぞろえ */
  text-align: center;
}
.boxSort__select {
  height: var(--boxSortH);
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
}

/* ENは文言が長めなので、ソートUIの幅を少しだけ広げて崩れを防ぐ（モバイルでは逆に溢れるので適用しない） */
@media (min-width: 561px) {
  .shell[data-locale="en"] .boxSort__select {
    min-width: 96px; /* "Label/Level" に合わせて少しコンパクトに */
  }
  .shell[data-locale="en"] .boxSort .btn {
    min-width: 64px; /* "ASC/DESC" に合わせて縮める */
  }
}

/* 日本語モバイル：ソート行を1行に収める */
@media (max-width: 560px) {
  .boxSortRow {
    flex-wrap: nowrap;
    gap: 6px;
  }
  .boxSortRow__left .btn {
    padding: 6px 10px;
    font-size: 12px;
  }
  .boxSort {
    gap: 4px;
  }
  .boxSort__select {
    padding: 0 8px;
    font-size: 12px;
    min-width: 0;
    max-width: 180px;
  }
  .boxSort .btn {
    min-width: 44px;
    padding: 6px 8px;
    font-size: 12px;
  }
}
.boxAddGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}
/* モバイル：ポケモン名と表記名は全幅 */
.boxAddGrid .field--name {
  grid-column: 1 / -1;
}
/* PC向け：6列グリッドで柔軟なレイアウト */
@media (min-width: 860px) {
  .boxAddGrid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  /* ポケモン名と表記名は各3列（50%）、高さも揃える */
  .boxAddGrid .field--name {
    grid-column: span 3;
    display: grid;
    grid-template-rows: 20px 40px 20px; /* ラベル・入力・サブテキスト固定 */
    align-content: start;
    gap: 4px;
  }
  /* 通常のフィールドは各2列（33%）*/
  .boxAddGrid .field:not(.field--wide):not(.field--name) {
    grid-column: span 2;
  }
  /* サブスキルは全幅 */
  .boxAddGrid .field--wide {
    grid-column: 1 / -1;
  }
}
/* 新規追加フォームの高さを統一 - field--wide, field--name以外に適用 */
.boxAddGrid .field:not(.field--wide):not(.field--name) {
  display: grid;
  grid-template-rows: 20px 40px min-content; /* ラベル・入力・サブテキスト */
  align-content: start;
  gap: 4px;
}
.boxAddGrid .field__label {
  height: 20px;
  min-height: 20px;
  max-height: 20px;
  display: flex;
  align-items: flex-end;
  line-height: 1;
  padding: 0;
  margin: 0;
  overflow: hidden;
}
.boxAddGrid .field__input,
.boxAddGrid select.field__input {
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  box-sizing: border-box;
}
/* field--sm も同様に */
.boxAddGrid .field--sm {
  grid-template-rows: 20px 40px min-content;
}
.boxAddGrid .field--sm .field__label {
  height: 20px;
  min-height: 20px;
  max-height: 20px;
}
.boxAddGrid .field--sm .field__input {
  height: 40px;
  min-height: 40px;
  max-height: 40px;
}
.boxAddActions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 16px;
  flex-wrap: nowrap;
  margin-top: 24px;
}
.boxAddCalcCheck {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  color: color-mix(in oklab, var(--ink) 80%, transparent);
  cursor: pointer;
  user-select: none;
}
.boxAddCalcCheck input {
  margin: 0;
}
.boxAddFav {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  font-size: 15px;
  color: color-mix(in oklab, var(--ink) 80%, transparent);
  cursor: pointer;
}
.boxAddFav input {
  margin: 0;
}
.boxAddActions .btn {
  white-space: nowrap;
}
@media (min-width: 860px) {
  .boxAddFav {
    grid-column: 1 / 4;
  }
  .boxAddActions {
    grid-column: 4 / -1;
  }
}

.subGrid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.subField {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.subField__k {
  font-size: 12px;
  opacity: 0.8;
}
@media (max-width: 860px) {
  .subGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.boxCard__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.boxCard__tools {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: nowrap; /* 「検索」と「検索クリア」を1行に固定 */
  min-width: 0;
}
.boxCard__title {
  font-family: var(--font-heading);
  margin: 0 0 8px;
}
.boxCard__desc {
  font-family: var(--font-body);
  margin: 0 0 10px;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.boxTextarea {
  width: 100%;
  font: inherit;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  outline: none;
  resize: vertical;
  /* iOS Safari: explicitly allow native selection/callout + scrolling while focused */
  -webkit-user-select: text;
  user-select: text;
  -webkit-touch-callout: default;
  touch-action: pan-y;
}
.boxTextarea:focus-visible {
  border-color: color-mix(in oklab, var(--accent) 60%, var(--ink) 20%);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
}
.boxCard__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.boxCard__actions--row {
  flex-wrap: wrap;
  justify-content: flex-start;
}
.boxCard__actions--footer {
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 18%, transparent);
}
.boxCard__hints {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.boxImport__favCheck {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: color-mix(in oklab, var(--ink) 75%, transparent);
  cursor: pointer;
  margin-top: 10px;
}
.boxImport__favCheck input {
  margin: 0;
}
.boxCard__status {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.boxSearch {
  font: inherit;
  font-size: 0.875rem; /* btn と同じサイズ感に寄せて高さを揃える */
  padding: 8px 12px; /* btn の縦paddingに合わせる */
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  outline: none;
  min-width: 0; /* flexで縮められるように */
  flex: 1 1 auto;
  width: auto;
}
.boxCard__tools .btn {
  white-space: nowrap; /* 「検索クリア」を折り返さない */
  flex: 0 0 auto;
}

/* Mobile: make search row more compact to avoid widening/clipping */
@media (max-width: 560px) {
  /* Place search row under the "List" title to avoid squeezing the title (JP can look vertical) */
  .boxCard__head {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .boxCard__tools { gap: 6px; }
  .boxSearch {
    padding: 7px 10px;
    font-size: 12px;
    flex: 0 1 220px; /* keep compact but left-aligned under the title */
    max-width: 260px;
  }
  .boxCard__tools .btn {
    padding: 7px 8px;
    font-size: 12px;
  }
  /* Now that it's under the title, align left and allow wrap if needed */
  .boxCard__tools {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
.boxSearch:focus-visible {
  border-color: color-mix(in oklab, var(--accent) 60%, var(--ink) 20%);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
}
.boxList {
  display: grid;
  gap: 10px;
  margin-top: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (min-width: 560px) {
  .boxList {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (min-width: 860px) {
  .boxList {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
/* .boxTile styles moved to main.css */
.boxTile__name {
  font-family: var(--font-heading);
  font-weight: 800;
  line-height: 1.2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.boxTile__lv {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 62%, transparent);
}
.calcSlots {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 14px; /* 「結果を1枚にまとめる」下の余白を少し広げる */
}

/* --- Slot Tabs --- */
.slotTabs {
  display: flex;
  align-items: flex-end;
  padding: 0 4px;
}
.slotTab {
  appearance: none;
  font: inherit;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: color-mix(in oklab, var(--paper) 92%, var(--ink) 8%);
  color: color-mix(in oklab, var(--ink) 60%, transparent);
  padding: 8px 16px;
  cursor: pointer;
  margin-right: -1px;
  position: relative;
  font-weight: 700;
  font-size: 13px;
  flex: 1;
  /* Prevent mobile wrap: keep "スロットN" + badge in one line */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  white-space: nowrap;
  transition: background 0.2s, color 0.2s;
}
.slotTab:first-child {
  border-top-left-radius: 12px;
}
.slotTab:last-child {
  border-top-right-radius: 12px;
  margin-right: 0;
}
.slotTab--active {
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%); /* Match content bg */
  color: var(--ink);
  z-index: 2;
  padding-top: 10px; /* Pop up slightly */
  margin-top: -2px;
  border-bottom: 1px solid transparent; /* Hide border */
  margin-bottom: -1px; /* Overlap content border */
}

/* Mobile: remove excess padding so tabs don't wrap */
@media (max-width: 560px) {
  .slotTabs { padding: 0 2px; }
  .slotTab {
    padding: 7px 10px;
    font-size: 12px;
    gap: 8px;
  }
  .slotTab--active {
    padding-top: 8px;
    margin-top: -1px;
  }
  .tab__count {
    padding: 2px 6px;
    font-size: 11px;
  }
}

.slotContent {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  border-radius: 0;

  padding: 10px 12px;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  flex-wrap: wrap; /* 画面が狭い時は自然に折り返し */
}
.calcSlot__actions {
  display: inline-flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.calcSlot__state {
  margin-left: 8px; /* ボタンの右隣に寄せつつ、少しだけ間を空ける */
  white-space: nowrap;
}
.calcSlot__btn {
  white-space: nowrap;
  padding: 4px 10px; /* 少し押しやすく */
}
/* If first tab is active, fix top-left corner */
.slotTabs:has(.slotTab--active:first-child) + .slotContent {
  border-top-left-radius: 0;
}
/* Fallback for no :has support (though modern browsers have it) or just keep 0 radius for top corners generally?
   Let's keep top-left 0 as implied by the design where tabs are usually left-aligned. */


.boxTile__fav {
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 78%, var(--accent-warm) 22%);
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, var(--paper) 70%, transparent),
    0 10px 20px color-mix(in oklab, var(--ink) 14%, transparent);
  color: color-mix(in oklab, var(--ink) 88%, transparent);
  font-family: var(--font-heading);
  font-weight: 900;
  font-size: 14px;
  line-height: 1;
}
/* 検索行 */
.boxSearchRow {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.boxSearchRow .boxSearch {
  flex: 1;
}

/* フィルタ行（お気に入り＆とくい） */
.boxFilterRow {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

/* 詳細設定 */
.boxAdvanced {
  margin-top: 10px;
}
.boxAdvanced__summary {
  list-style: none;
  cursor: pointer;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 13px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.boxAdvanced__summary::-webkit-details-marker {
  display: none;
}
.boxAdvanced__summary::before {
  content: "▶";
  font-size: 10px;
  transition: transform 0.2s;
}
.boxAdvanced[open] .boxAdvanced__summary::before {
  transform: rotate(90deg);
}
.boxAdvanced__content {
  margin-top: 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 12%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
}
.boxAdvanced__row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.boxAdvanced__row + .boxAdvanced__row {
  margin-top: 8px;
}
.boxAdvanced__section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 16%, transparent);
}
.boxAdvanced__label {
  font-family: var(--font-body);
  font-size: 13px;
  color: color-mix(in oklab, var(--ink) 70%, transparent);
}
.boxAdvanced__count {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.boxAdvanced__row .boxAdvanced__select {
  width: 180px;
}
.boxAdvanced__list {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  max-height: 200px;
  overflow: auto;
  padding-right: 6px;
}
@media (min-width: 561px) {
  .boxAdvanced__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.boxAdvanced__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
  background: color-mix(in oklab, var(--paper) 99%, var(--ink) 1%);
  cursor: pointer;
}
.boxAdvanced__item:hover {
  background: color-mix(in oklab, var(--paper) 96%, var(--ink) 4%);
}
.boxAdvanced__check {
  width: 16px;
  height: 16px;
}
.boxAdvanced__itemLabel {
  font-family: var(--font-body);
  font-size: 13px;
}

.chipBtn {
  font: inherit;
  cursor: pointer;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--paper) 99%, var(--ink) 1%),
    color-mix(in oklab, var(--paper) 96%, var(--ink) 4%)
  );
  padding: 8px 10px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 1px 0 color-mix(in oklab, var(--paper) 60%, transparent);
}
.chipBtn--iconOnly {
  width: 34px;
  height: 34px;
  padding: 0;
  gap: 0;
  justify-content: center;
}
.chipBtn:hover {
  border-color: color-mix(in oklab, var(--ink) 26%, transparent);
  box-shadow:
    0 1px 0 color-mix(in oklab, var(--paper) 60%, transparent),
    0 14px 28px color-mix(in oklab, var(--ink) 10%, transparent);
}
.chipBtn--on {
  border-color: color-mix(in oklab, var(--accent) 55%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--accent) 16%, var(--paper) 84%),
    color-mix(in oklab, var(--accent-warm) 10%, var(--paper) 90%)
  );
  box-shadow:
    0 1px 0 color-mix(in oklab, var(--paper) 60%, transparent),
    0 16px 34px color-mix(in oklab, var(--accent) 14%, transparent);
}
.chipBtn__icon {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: color-mix(in oklab, var(--ink) 70%, transparent);
}
.chipBtn--on .chipBtn__icon {
  color: color-mix(in oklab, var(--accent) 78%, var(--ink) 18%);
  filter: drop-shadow(0 0 10px color-mix(in oklab, var(--accent) 18%, transparent));
}
.chipBtn__icon :deep(svg) {
  width: 18px;
  height: 18px;
  display: block;
}
.chipBtn__text {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 72%, transparent);
}

/* モバイルでフィルタチップを1行に収める */
@media (max-width: 480px) {
  .boxCard {
    padding: 10px;
  }
  .boxFilterRow {
    gap: 4px;
  }
  .boxFilterRow > .chipBtn {
    padding: 5px 6px;
    gap: 4px;
  }
  .boxFilterRow > .chipBtn .chipBtn__icon {
    width: 14px;
    height: 14px;
  }
  .boxFilterRow > .chipBtn .chipBtn__icon svg {
    width: 14px;
    height: 14px;
  }
  .boxFilterRow > .chipBtn .chipBtn__text {
    font-size: 10px;
  }
}

.suggest {
  position: relative;
}
.suggest__panel {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 20;
  border-radius: 14px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 99%, var(--ink) 1%);
  box-shadow: 0 12px 28px color-mix(in oklab, var(--ink) 12%, transparent);
  max-height: 240px;
  overflow: auto;
  padding: 6px;
}
.suggest__item {
  width: 100%;
  text-align: left;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  padding: 10px 10px;
  border-radius: 12px;
  font-family: var(--font-body);
}
.suggest__item:hover {
  border-color: color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--accent) 10%, var(--paper) 90%);
}

.relinkRow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: stretch;
  margin-top: 8px;
}
.relinkRow .field__input,
.boxDetail .relinkRow .field__input {
  height: 40px;
  min-height: 40px;
  max-height: none;
}
.relinkRow .btn,
.boxDetail .relinkRow .btn {
  height: 40px;
  min-height: 40px;
}
.boxSortRow {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.boxSortRow__left {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.boxDetail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 18%, transparent);
}
.boxDetail--inline {
  grid-column: 1 / -1;
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  border-radius: 16px;
  padding: 12px 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 97%, var(--ink) 3%);
}
.boxDetail__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.boxDetail__title {
  margin: 0;
  font-family: var(--font-heading);
}
.boxDetail__actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.boxDetail__grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
@media (min-width: 860px) {
  .boxDetail__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 18px; /* 左右列の間を少し広げる */
  }
}
.boxDetail__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.boxDetail__kv {
  /* 多重の囲いに見えやすいので、項目カードの枠/面は消して入力欄を主役にする */
  border: 0;
  background: transparent;
  border-radius: 0;
  padding: 8px 0;
}
.boxDetail__nickRow {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.boxDetail__nickInput {
  flex: 1;
  min-width: 0;
}
.boxDetail__specs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}
@media (min-width: 860px) {
  .boxDetail__specs {
    gap: 0 18px;
  }
}
.boxDetail__col > .boxDetail__kv {
  border-bottom: 0;
}
.boxDetail__col > .boxDetail__kv:last-child {
  border-bottom: 0;
}
.boxDetail__k {
  font-family: var(--font-body);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
.boxDetail__v {
  margin-top: 6px;
  font-family: var(--font-heading);
  font-weight: 800;
}
.boxDetail {
  --boxFieldH: 30px;
}
/* Box詳細の入力高さを統一（ニックネーム基準で揃える） */
.boxDetail .field__input,
.boxDetail select.field__input,
.boxDetail .field__input--button {
  height: var(--boxFieldH);
  min-height: var(--boxFieldH);
  max-height: var(--boxFieldH);
  padding-top: 0;
  padding-bottom: 0;
  line-height: normal;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}
/* monospace領域でも入力は同じ高さ・同じ縦センターに */
.boxDetail__v--mono .field__input,
.boxDetail__v--mono select.field__input,
.boxDetail__v--mono .field__input--button {
  height: var(--boxFieldH);
  min-height: var(--boxFieldH);
  max-height: var(--boxFieldH);
  padding-top: 0;
  padding-bottom: 0;
  line-height: normal;
}
.boxDetail__minor {
  margin-left: 8px;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
.boxDetail__v--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-weight: 600;
  font-size: 12px;
  line-height: 1.6;
}
.boxDetail__editRow {
  margin-bottom: 8px;
}
.boxDetail__subEdit {
  display: grid;
  gap: 10px;
}
.boxDetail__raw {
  width: 100%;
  margin-top: 8px;
  font: inherit;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 99%, var(--ink) 1%);
  outline: none;
  resize: vertical;
}
.boxEmpty {
  font-family: var(--font-body);
  font-size: 13px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
  margin: 12px 0 0;
}
.result {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 18%, transparent);
}
.result__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  font-family: var(--font-body);
}
.result__row--major .result__v {
  font-weight: 800;
}
.result__divider {
  height: 1px;
  background: color-mix(in oklab, var(--ink) 14%, transparent);
  margin: 10px 0 6px;
}
.result__k {
  color: color-mix(in oklab, var(--ink) 62%, transparent);
}
.result__v {
  font-family: var(--font-heading);
  font-weight: 700;
}
.result__hint {
  margin-top: 10px;
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 1.6;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
</style>


<style>
/* モバイル: スクロール時にstickyヘッダーの高さを考慮 */
@media (max-width: 560px) {
  html {
    scroll-padding-top: 320px; /* calcStickyの高さ分 */
  }
}
</style>
