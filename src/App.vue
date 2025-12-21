<template>
  <main :class="['shell', { 'shell--exportOpen': calc.exportOpen.value }]" :data-locale="locale">
    <HeroHeader :locale="uiLocale" :support-links="supportLinks" :set-locale="setLocale" />
    <MobileNav :scroll-to-panel="scrollToPanel" />

    <div class="dashboard">
      <CalcPanel :calc="calc" @apply-to-box="applyCalculatorToBox($event)" />

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
      @close="calc.closeExport()"
    />
  </main>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { localizeGameTerm } from "./i18n/terms";
import type { ExpGainNature, ExpType } from "./domain/types";

import ExportOverlay from "./components/ExportOverlay.vue";
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

const calc = useCalcStore({
  locale,
  t,
  resolveTitleByBoxId: (boxId) => {
    const e = box.boxEntries.value.find((x) => x.id === boxId) ?? null;
    return e ? box.displayBoxTitle(e) : null;
  },
});

function applyBoxToCalculator(ev?: MouseEvent) {
  const e = box.selectedBox.value;
  if (!e) return;
  const lvl = e.planner?.level ?? e.derived?.level ?? 10;
  const expT = (e.planner?.expType ?? e.derived?.expType ?? 600) as ExpType;
  const nat = (e.planner?.expGainNature ?? e.derived?.expGainNature ?? "normal") as ExpGainNature;

  calc.upsertFromBox({
    boxId: e.id,
    title: box.displayBoxTitle(e),
    srcLevel: Number(lvl),
    expType: expT,
    nature: nat,
    expRemaining: e.planner?.expRemaining,
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
.mobileNav {
  display: none;
}
@media (max-width: 1023px) {
  .shell {
    padding-top: 0; /* sticky nav sits at top */
  }
  .shell--exportOpen .mobileNav {
    display: none !important;
  }
  .mobileNav {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 100;
    background: color-mix(in oklab, var(--paper) 95%, var(--ink) 5%);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
    margin: 0 -18px 16px; /* Negate shell padding */
    padding: 0 18px;
  }
  .mobileNav__item {
    flex: 1;
    text-align: center;
    padding: 10px 0;
    font-weight: 700;
    font-size: 14px;
    color: color-mix(in oklab, var(--ink) 50%, transparent);
    border-bottom: 3px solid transparent;
    cursor: pointer;
  }
  .mobileNav__item:hover {
    background: rgba(0,0,0,0.02);
    color: var(--ink);
  }
  .calcSticky {
    top: 45px; /* ナビゲーションにより近く */
  }
}

.hero {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 18px;
  align-items: start;
  margin-top: 16px;
  margin-bottom: 12px;
}
.kicker {
  font-family: var(--font-body);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 55%, transparent);
}
.title {
  font-family: var(--font-heading);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  font-size: clamp(34px, 5vw, 56px);
  margin: 10px 0 10px;
}
.lede {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.7;
  color: color-mix(in oklab, var(--ink) 72%, transparent);
  max-width: min(74ch, 100%);
}
.lang {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.lang__btn {
  appearance: none;
  font: inherit;
  cursor: pointer;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 94%, var(--ink) 6%);
  color: color-mix(in oklab, var(--ink) 70%, transparent);
  letter-spacing: 0.08em;
  font-size: 12px;
}
.lang__btn:hover {
  border-color: color-mix(in oklab, var(--ink) 22%, transparent);
}
.lang__btn--on {
  background: color-mix(in oklab, var(--accent-warm) 20%, var(--paper) 80%);
  color: color-mix(in oklab, var(--ink) 90%, transparent);
  box-shadow: 0 10px 22px color-mix(in oklab, var(--accent-warm) 12%, transparent);
}

.support {
  display: grid;
  justify-items: end;
  gap: 8px;
}
.support__label {
  margin: 0;
  font-family: var(--font-body);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 11px;
  color: color-mix(in oklab, var(--ink) 55%, transparent);
}
.support__links {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.support__link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  font: inherit;
  cursor: pointer;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 94%, var(--ink) 6%);
  color: color-mix(in oklab, var(--ink) 72%, transparent);
  font-size: 12px;
}
.support__link:hover {
  border-color: color-mix(in oklab, var(--ink) 22%, transparent);
  color: color-mix(in oklab, var(--ink) 86%, transparent);
}
.support__link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
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
@media (max-width: 560px) {
  .hero {
    grid-template-columns: 1fr; /* stack support under title */
    gap: 14px;
  }
  .support {
    justify-items: start;
  }
  .support__links {
    justify-content: flex-start;
    max-width: 100%;
  }
  .support__link {
    font-size: 11px;
    padding: 6px 9px;
    max-width: 100%;
    white-space: normal; /* allow wrap instead of overflowing */
  }

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

/* --- Calculator (multi) --- */
.calcTop {
  margin-top: 12px;
}
.calcTop__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 860px) {
  .calcTop__grid {
    grid-template-columns: 1.2fr 0.8fr;
    align-items: start;
  }
}
.calcSticky {
  position: sticky;
  top: 10px;
  z-index: 30;
  margin-top: 10px;
  padding: 8px;
  border-radius: 16px;
  background: var(--paper);
  border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
  box-shadow: 0 14px 36px color-mix(in oklab, var(--ink) 12%, transparent);
}
.calcSticky__summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.calcSticky__summary .calcSum {
  flex: 1 1 0; /* 均等幅で横並びに */
  min-width: 140px;
}
.calcSum__v {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 18px;
  margin-top: 2px;
}
.calcSum--hi .calcSum__v {
  background: transparent;
  box-shadow: none;
  padding: 0;
  color: var(--ink);
  font-size: 1.5rem; /* Slightly larger for emphasis */
}
.calcSum--danger .calcSum__v {
  color: color-mix(in oklab, hsl(6 78% 52%) 75%, var(--ink) 10%);
}
.calcSum__overVal {
  color: color-mix(in oklab, hsl(6 78% 52%) 75%, var(--ink) 10%);
  font-weight: 700;
  margin-left: 4px;
}
.calcSum--bar {
  flex: 2; /* バーは少し広めに */
  min-width: 220px;
}

/* Mobile: keep "Shards" and "Remaining" compact and side-by-side */
@media (max-width: 560px) {
  .calcSticky {
    top: 45px; /* ナビゲーションにより近く */
    padding: 6px;
    border-radius: 14px;
  }
  .calcSticky__summary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }



  /* Mobile: shrink header texts (calc title / editing / pokemon name / apply button) */
  .panel__title {
    font-size: 22px;
    line-height: 1.12;
    margin-bottom: 8px;
  }
  .panel__head {
    gap: 10px;
  }
  .panel__side {
    gap: 8px;
  }
  .chip {
    padding: 5px 8px;
    gap: 6px;
  }
  .chip__k {
    font-size: 11px;
  }
  .chip__v {
    font-size: 12px;
  }
  .panel__side > .btn {
    font-size: 12px;
    padding: 8px 10px;
    white-space: nowrap;
  }
  .calcRow__title {
    font-size: 15px;
  }

  /* Mobile: keep shards + candy(total) side-by-side under inputs (moved near base rules for correct cascade) */
}


.calcSum__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.calcSum__head > .calcSum__k {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  white-space: nowrap; /* prevent wrap -> stable height on mobile */
}
.calcSum__kText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calcSum__k--right {
  white-space: nowrap;
  text-align: right;
}
.calcSum__overVal {
  flex: 0 0 auto;
  white-space: nowrap;
}
.calcBar {
  margin-top: 8px;
}
/* Default behavior for stacked bars */
.calcBarBlock + .calcBarBlock {
  margin-top: 12px;
}
/* When bars are inside .calcSum--bar (e.g. usage bars), remove separation border fully */
.calcSum--bar .calcBarBlock + .calcBarBlock {
  border-top: 0;
  padding-top: 0;
  margin-top: 12px;
}
.calcBarBlock--candy .calcBar {
  margin-top: 6px;
}
.calcBar__fill--candy {
  background: linear-gradient(
    90deg,
    color-mix(in oklab, var(--accent-cool) 58%, var(--paper) 42%),
    color-mix(in oklab, var(--accent) 64%, var(--paper) 36%)
  );
}
.calcBar__track {
  position: relative;
  height: 10px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--ink) 9%, transparent);
  overflow: hidden;
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ink) 12%, transparent);
}
.calcBar__fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    color-mix(in oklab, var(--accent) 74%, var(--paper) 26%),
    color-mix(in oklab, var(--accent-warm) 56%, var(--paper) 44%)
  );
  transition: width 240ms ease;
}
.calcSum--muted .calcBar__fill {
  opacity: 0.35;
}
.calcBar__over {
  position: absolute;
  inset: 0 0 0 auto;
  height: 100%;
  background: repeating-linear-gradient(
    135deg,
    color-mix(in oklab, hsl(6 78% 52%) 78%, var(--paper) 22%) 0 6px,
    color-mix(in oklab, hsl(6 78% 52%) 62%, var(--paper) 38%) 6px 12px
  );
  box-shadow: inset 0 0 0 1px color-mix(in oklab, hsl(6 78% 52%) 55%, transparent);
  transition: width 240ms ease;
}

.calcActions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.calcSlots {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-top: 10px;
  margin-bottom: 6px;
}
.calcSlot {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  border-radius: 14px;
  padding: 10px 12px;
}
.calcSlot--empty {
  background: color-mix(in oklab, var(--paper) 96%, var(--ink) 4%);
  border-style: dashed;
}
/* Removed old exportCard styles */
.calcRows {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}
.calcRow {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 97%, var(--ink) 3%);
  border-radius: 16px;
  padding: 6px;
}
.calcRow--active {
  border-color: color-mix(in oklab, var(--accent-warm) 34%, var(--ink) 10%);
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--accent-warm) 12%, var(--paper) 88%),
    color-mix(in oklab, var(--paper) 94%, var(--ink) 6%)
  );
  box-shadow:
    0 0 0 4px color-mix(in oklab, var(--accent-warm) 12%, transparent),
    0 18px 40px color-mix(in oklab, var(--ink) 10%, transparent);
}
.calcRow--dragOver {
  border-color: color-mix(in oklab, var(--accent) 55%, var(--ink) 10%);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 14%, transparent);
}
.calcRow--dragging {
  opacity: 0.65;
}
.calcRow__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.calcRow__headLeft {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.calcRow__headRight {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto; /* 右寄せ */
}
.calcRow__dragHandle {
  cursor: grab;
  user-select: none;
  line-height: 1;
  letter-spacing: -2px;
  padding-left: 8px;
  padding-right: 8px;
}
.calcRow__dragHandle:active {
  cursor: grabbing;
}
/* .calcRow__subHead removed */
.calcRow__title {
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calcRow__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin-top: 1px;
}
.calcRow__grid > * {
  min-width: 0;
}
@media (min-width: 860px) {
  .calcRow__grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.calcRow__result {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)); /* 4列で一覧性向上 */
  gap: 4px 12px; /* コンパクトに */
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 14%, transparent);
}
/* モバイルでは2列×2行に */
@media (max-width: 640px) {
  .calcRow__result {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 16px;
  }
}
.calcRow__res {
  display: flex;
  justify-content: space-between; /* ラベル左、数字右 */
  align-items: baseline;
  min-width: 0;
}
.calcRow__k {
  font-family: var(--font-body);
  font-size: 11px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.calcRow__v {
  font-family: var(--font-heading);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.calcRow__result .calcRow__v {
  font-size: 16px;
}
.calcRow__num {
  font-weight: 700;
  font-size: 19px; /* 数字を大きく統一 */
  background: transparent;
  box-shadow: none;
  padding: 0;
  color: var(--ink);
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
.levelChip {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--ink) 18%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  font: inherit;
  cursor: pointer;
  font-family: var(--font-heading);
  font-weight: 800;
}
.levelChip:hover {
  border-color: color-mix(in oklab, var(--ink) 28%, transparent);
}
.levelChip--on {
  border-color: color-mix(in oklab, var(--accent) 55%, var(--ink) 16%);
  background: color-mix(in oklab, var(--accent) 14%, var(--paper) 86%);
}
.levelChip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.field {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.field--wide {
  grid-column: 1 / -1;
}
.field__label {
  font-family: var(--font-body);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--ink) 62%, transparent);
}
.field__input {
  font: inherit;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  outline: none;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.field__input--static {
  display: flex;
  align-items: center;
  cursor: default;
  user-select: text;
  color: color-mix(in oklab, var(--ink) 84%, transparent);
}
.field__range {
  width: 100%;
  accent-color: color-mix(in oklab, var(--accent) 72%, var(--ink) 20%);
}
.field__sub {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
.field__input:focus-visible {
  border-color: color-mix(in oklab, var(--accent) 60%, var(--ink) 20%);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
}
.field__input--error {
  border-color: color-mix(in oklab, hsl(6 78% 52%) 55%, var(--ink) 20%);
  box-shadow: 0 0 0 4px color-mix(in oklab, hsl(6 78% 52%) 18%, transparent);
}
.field__error {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, hsl(6 78% 52%) 70%, var(--ink) 10%);
}

.tabs {
  display: inline-flex;
  gap: 8px;
  padding: 6px;
  border-radius: 16px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 92%, var(--ink) 8%);
  margin: 6px 0 12px;
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--paper) 70%, transparent);
}
.tab {
  font: inherit;
  border: 0;
  cursor: pointer;
  padding: 10px 12px;
  border-radius: 12px;
  background: transparent;
  color: color-mix(in oklab, var(--ink) 68%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.tab--active {
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--paper) 94%, var(--accent-warm) 6%),
    color-mix(in oklab, var(--paper) 88%, var(--accent) 12%)
  );
  color: var(--ink);
  box-shadow:
    0 1px 0 color-mix(in oklab, var(--paper) 60%, transparent),
    0 10px 22px color-mix(in oklab, var(--ink) 10%, transparent);
}
.tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
}
.tab__count {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--ink) 10%, transparent);
}

/* .btn styles moved to main.css */

.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  border-radius: 999px;
  padding: 6px 10px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 96%, var(--ink) 4%);
}
.chip__k {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.chip__v {
  font-family: var(--font-heading);
  font-weight: 800;
}

.boxGrid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 10px;
}
.boxCard {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 97%, var(--ink) 3%);
  border-radius: 16px;
  padding: 14px;
}
.boxCard--inner {
  padding: 12px;
  border-radius: 14px;
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
}
.boxDisclosure {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 97%, var(--ink) 3%);
  border-radius: 16px;
  padding: 10px 12px;
}
.boxDisclosure__summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  font-family: var(--font-heading);
  font-weight: 800;
  width: 100%;
  text-align: left;
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
}
.boxDisclosure__summary::-webkit-details-marker { display: none; }
.boxDisclosure__title {
  letter-spacing: -0.01em;
}
.boxDisclosure__hint {
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.boxDisclosure[open] .boxDisclosure__summary,
.boxDisclosure--open .boxDisclosure__summary {
  margin-bottom: 10px;
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
@media (min-width: 640px) {
  .shell[data-locale="en"] .boxSort__select {
    min-width: 120px;
  }
  .shell[data-locale="en"] .boxSort .btn {
    min-width: 120px;
  }
}

/* Mobile EN: prevent horizontal clipping caused by "nowrap" filter/search rows */
@media (max-width: 560px) {
  /* Filters row is forced to 1-line; shrink controls slightly for EN */
  .shell[data-locale="en"] .boxFilters__row--main {
    gap: 8px;
  }
  .shell[data-locale="en"] .boxFilters__row--main > .boxFilters__group:last-child {
    margin-left: 0.5em;
  }
  .shell[data-locale="en"] .boxFilters__row--main .boxFilters__group {
    gap: 6px;
  }
  .shell[data-locale="en"] .boxFilters__row--main .boxFilters__label {
    font-size: 11px;
    letter-spacing: 0.04em;
  }
  .shell[data-locale="en"] .boxFilters__row--main .boxFilters__select {
    width: 96px;
  }
  /* Make the star/favorite chips a bit tighter */
  .shell[data-locale="en"] .boxFilters__row--main .chipBtn {
    padding: 6px 8px;
  }

  /* Search row is forced to 1-line; tighten the "Clear search" button */
  .shell[data-locale="en"] .boxCard__tools .btn {
    padding: 7px 8px;
    font-size: 12px;
  }
}
.boxAddGrid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 10px;
}
@media (min-width: 860px) {
  .boxAddGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
/* 新規追加フォームの高さを統一 - グリッド行の固定化で親の伸縮を防止 */
.boxAddGrid .field:not(.field--wide) {
  display: grid !important;
  grid-template-rows: 20px 40px min-content !important; /* ラベル・入力・サブテキスト */
  align-content: start !important;
  gap: 6px !important;
}
.boxAddGrid .field__label {
  height: 20px !important;
  min-height: 20px !important;
  max-height: 20px !important;
  display: flex !important;
  align-items: flex-end !important;
  line-height: 1 !important;
  padding: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
}
.boxAddGrid .field__input,
.boxAddGrid select.field__input {
  height: 40px !important;
  min-height: 40px !important;
  max-height: 40px !important;
  box-sizing: border-box !important;
}
/* field--sm も同様に */
.boxAddGrid .field--sm {
  grid-template-rows: 20px 40px min-content !important;
}
.boxAddGrid .field--sm .field__label {
  height: 20px !important;
  min-height: 20px !important;
  max-height: 20px !important;
}
.boxAddGrid .field--sm .field__input {
  height: 40px !important;
  min-height: 40px !important;
  max-height: 40px !important;
}
.boxAddActions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  align-items: end;
  gap: 10px;
  flex-wrap: nowrap;
}
.boxAddActions .btn {
  white-space: nowrap;
}
@media (min-width: 860px) {
  .boxAddActions {
    grid-column: 2 / 3;
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
.boxCard__actions--footer {
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 18%, transparent);
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
@media (max-width: 520px) {
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
.boxListHint {
  margin: 6px 0 0;
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
.boxFilters {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in oklab, var(--ink) 12%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
}
.boxFilters__row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-start;
  min-width: 0;
}
.boxFilters__row--main {
  flex-wrap: nowrap; /* 「条件結合 + AND/OR + お気に入り + ★」を1行固定 */
}
.boxFilters__row--main > .boxFilters__group:last-child {
  margin-left: 0.9em; /* 「お気に入り」の左に1文字分くらいの余白 */
}
.boxFilters__row--chips {
  margin-top: 8px;
}
.boxFilters__row--main .boxFilters__group {
  flex-wrap: nowrap;
}
.boxFilters__row--main .boxFilters__select {
  min-width: 0;
  width: 140px;
  flex: 0 1 auto;
}
@media (max-width: 420px) {
  .boxFilters__row--main .boxFilters__select {
    width: 120px;
  }
}
.boxFilters__row--sub {
  margin-top: 10px;
  justify-content: flex-start;
}
.boxFilters__group {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.boxFilters__label {
  font-family: var(--font-body);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
.boxFilters__select {
  min-width: 160px;
}
.boxFilters__chips {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
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
.boxFilters__subskill {
  margin-top: 10px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 16%, transparent);
  padding-top: 10px;
}
.boxFilters__summary {
  list-style: none;
  cursor: pointer;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--font-heading);
  font-weight: 800;
}
.boxFilters__summary::-webkit-details-marker {
  display: none;
}
.boxFilters__summaryCount {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.boxFilters__list {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  max-height: 240px;
  overflow: auto;
  padding-right: 6px;
}
@media (min-width: 860px) {
  .boxFilters__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.boxFilters__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
  background: color-mix(in oklab, var(--paper) 99%, var(--ink) 1%);
}
.boxFilters__check {
  width: 16px;
  height: 16px;
}
.boxFilters__itemLabel {
  font-family: var(--font-body);
  font-size: 13px;
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
  align-items: center;
  margin-top: 8px;
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
.boxDetail__col > .boxDetail__kv {
  border-bottom: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
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
