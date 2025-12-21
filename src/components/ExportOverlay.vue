<template>
  <div class="exportOverlay" @click.self="emit('close')" role="dialog" :aria-label="t('calc.export.open')">
    <div class="exportSheetWrap">
      <div
        ref="exportSheetEl"
        class="exportSheet"
        :class="{ 'exportSheet--capture': exportBusy }"
        :style="{ transform: exportBusy ? 'none' : `scale(${scale})` }"
        @click="exportCsvMenuOpen = false"
      >
        <div class="exportHead">
          <div>
            <div class="exportBrand">🍬 {{ t("calc.export.brand") }}</div>
          </div>
          <div class="exportActions" @click.stop>
            <button class="linkBtn" type="button" @click="downloadCalcExportPng" :disabled="exportBusy">
              {{ t("calc.export.saveImage") }}
            </button>
            <div class="exportCsvMenuTrigger">
              <button
                class="linkBtn"
                type="button"
                @click.stop="exportCsvMenuOpen = !exportCsvMenuOpen"
                :disabled="exportBusy"
                :aria-expanded="exportCsvMenuOpen"
                aria-haspopup="menu"
              >
                {{ t("calc.export.csv") }} ▾
              </button>
              <div v-if="exportCsvMenuOpen" class="exportCsvMenu" role="menu" :aria-label="t('calc.export.csv')">
                <button class="exportCsvMenu__item" type="button" @click="downloadCalcExportCsv" :disabled="exportBusy">
                  {{ t("calc.export.csvDownload") }}
                </button>
                <button class="exportCsvMenu__item" type="button" @click="copyCalcExportCsv" :disabled="exportBusy">
                  {{ t("calc.export.csvCopy") }}
                </button>
              </div>
            </div>
            <button class="linkBtn linkBtn--basic" type="button" @click="emit('close')" :disabled="exportBusy">{{ t("calc.export.close") }}</button>
          </div>
        </div>

        <div v-if="exportStatus" class="exportStatus" role="status">{{ exportStatus }}</div>

        <div class="exportCalc">
          <div class="exportCalcTop">
            <div class="exportStats">
              <div class="statCard statCard--accent">
                <div class="statCard__icon">🍬</div>
                <div class="statCard__content">
                  <div class="statCard__label">{{ t("calc.export.sumBoostTotal") }}</div>
                  <div class="statCard__value" :class="{ 'statCard__value--danger': boostOver > 0 }">
                    {{ fmtNum(boostUsed) }}
                  </div>
                </div>
              </div>
              <div class="statCard">
                <div class="statCard__icon">⚪</div>
                <div class="statCard__content">
                  <div class="statCard__label">{{ t("calc.export.sumNormalTotal") }}</div>
                  <div class="statCard__value">{{ fmtNum(totals.normalCandy) }}</div>
                </div>
              </div>
              <div class="statCard" :class="{ 'statCard--danger': boostOver > 0 }">
                <div class="statCard__icon">⚠️</div>
                <div class="statCard__content">
                  <div class="statCard__label">{{ t("calc.export.sumBoostUnused") }}</div>
                  <div class="statCard__value">{{ fmtNum(boostUnused) }}</div>
                </div>
              </div>
              <div class="statCard statCard--primary">
                <div class="statCard__icon">💎</div>
                <div class="statCard__content">
                  <div class="statCard__label">{{ t("calc.export.sumShardsTotal") }}</div>
                  <div class="statCard__value" :class="{ 'statCard__value--danger': shardsCap > 0 && shardsOver > 0 }">
                    {{ fmtNum(shardsUsed) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="exportBars" :class="{ 'exportBars--muted': shardsCap <= 0, 'exportBars--danger': shardsOver > 0 || boostOver > 0 }">
              <div class="exportBarBlock" :class="{ 'exportBarBlock--danger': boostOver > 0 }">
                <div class="exportBarHead">
                  <div class="exportBarK">
                    {{ t("calc.boostCandyUsage", { pct: boostUsagePct }) }}
                    <span v-if="showBoostFire" aria-hidden="true"> 🔥</span>
                    <span v-if="boostOver > 0" class="exportBarOverVal"> (+{{ fmtNum(boostOver) }})</span>
                  </div>
                  <div class="exportBarK exportBarK--right">{{ t("calc.cap", { cap: fmtNum(boostCap) }) }}</div>
                </div>
                <div
                  class="exportBar"
                  role="progressbar"
                  :aria-valuenow="Math.max(0, boostUsed)"
                  aria-valuemin="0"
                  :aria-valuemax="Math.max(1, boostCap)"
                  :aria-label="t('calc.boostCandyUsageAria', { pct: boostUsagePct, cap: fmtNum(boostCap) })"
                >
                  <div class="exportBar__track">
                    <div class="exportBar__fill exportBar__fill--candy" :style="{ width: `${boostFillPct}%` }"></div>
                    <div v-if="boostOver > 0 && boostCap > 0" class="exportBar__over" :style="{ width: `${boostOverPct}%` }"></div>
                  </div>
                </div>
              </div>

              <div class="exportBarBlock">
                <div class="exportBarHead">
                  <div class="exportBarK">
                    {{ shardsCap > 0 ? t("calc.shardsUsage", { pct: shardsUsagePct }) : t("calc.shardsUsageDash") }}
                    <span v-if="showShardsFire" aria-hidden="true"> 🔥</span>
                    <span v-if="shardsOver > 0" class="exportBarOverVal"> (+{{ fmtNum(shardsOver) }})</span>
                  </div>
                  <div class="exportBarK exportBarK--right">
                    {{ shardsCap > 0 ? t("calc.cap", { cap: fmtNum(shardsCap) }) : t("calc.capUnset") }}
                  </div>
                </div>
                <div
                  class="exportBar"
                  role="progressbar"
                  :aria-valuenow="Math.max(0, shardsUsed)"
                  aria-valuemin="0"
                  :aria-valuemax="Math.max(1, shardsCap)"
                  :aria-label="
                    shardsCap > 0
                      ? t('calc.shardsUsageAria', { pct: shardsUsagePct, cap: fmtNum(shardsCap) })
                      : t('calc.shardsCapUnsetAria')
                  "
                >
                  <div class="exportBar__track">
                    <div class="exportBar__fill" :style="{ width: `${shardsFillPct}%` }"></div>
                    <div v-if="shardsOver > 0 && shardsCap > 0" class="exportBar__over" :style="{ width: `${shardsOverPct}%` }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="exportList">
            <div class="exportList__head">
              <div class="exportList__col">{{ t("calc.export.colPokemon") }}</div>
              <div class="exportList__col u-align-center">{{ t("calc.row.srcLevel") }} → {{ t("calc.row.dstLevel") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colBoost") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colNormal") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colTotal") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colShards") }}</div>
            </div>

            <div v-for="row in rows" :key="row.id" class="exportList__row">
              <div class="exportList__col exportList__nameCol">
                <span class="exportList__name">{{ row.title }}</span>
                <span v-if="row.natureLabel" class="exportList__badge">{{ row.natureLabel }}</span>
              </div>
              <div class="exportList__col u-align-center exportList__lvCol">
                <div class="exportList__lvWrap">
                  <span class="exportList__lvVal">{{ row.srcLevel }}</span>
                  <span class="exportList__arrow">→</span>
                  <span class="exportList__lvVal">{{ row.dstLevel }}</span>
                </div>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colBoost") }}</span>
                <span class="calcRow__num">{{ fmtNum(row.boostCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colNormal") }}</span>
                <span class="calcRow__num">{{ fmtNum(row.normalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colTotal") }}</span>
                <span class="calcRow__num">{{ fmtNum(row.totalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShards") }}</span>
                <span class="calcRow__num">{{ fmtNum(row.shards) }}</span>
              </div>
            </div>

            <div class="exportList__row exportList__row--total" aria-label="total">
              <div class="exportList__col exportList__nameCol">
                <span class="exportList__name" aria-hidden="true"></span>
              </div>
              <div class="exportList__col u-align-center exportList__lvCol"></div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colBoost") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': boostOver > 0 }">{{ fmtNum(totals.boostCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colNormal") }}</span>
                <span class="calcRow__num">{{ fmtNum(totals.normalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colTotal") }}</span>
                <span class="calcRow__num">{{ fmtNum(totals.totalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShards") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': shardsCap > 0 && shardsOver > 0 }">{{ fmtNum(totals.shards) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import { toPng } from "html-to-image";
import { useI18n } from "vue-i18n";

type ExportRow = {
  id: string;
  title: string;
  natureLabel?: string;
  srcLevel: number;
  dstLevel: number;
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
};

type ExportTotals = {
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
};

const props = defineProps<{
  scale: number;
  rows: ExportRow[];
  totals: ExportTotals;

  boostUsed: number;
  boostUnused: number;
  shardsUsed: number;

  boostOver: number;
  shardsOver: number;
  shardsCap: number;

  boostUsagePct: number;
  boostCap: number;
  boostFillPct: number;
  boostOverPct: number;

  shardsUsagePct: number;
  shardsFillPct: number;
  shardsOverPct: number;

  showBoostFire: boolean;
  showShardsFire: boolean;
}>();

const emit = defineEmits<{ close: [] }>();
const { t, locale } = useI18n();

const exportSheetEl = ref<HTMLElement | null>(null);
const exportBusy = ref(false);
const exportStatus = ref("");
const exportCsvMenuOpen = ref(false);

function fmtNum(n: number): string {
  return new Intl.NumberFormat(locale.value as any).format(n);
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCalcExportCsv(): string {
  const head = [
    t("calc.export.colPokemon"),
    t("calc.row.srcLevel"),
    t("calc.row.dstLevel"),
    t("calc.export.colExpAdj"),
    t("calc.export.colBoost"),
    t("calc.export.colNormal"),
    t("calc.export.colTotal"),
    t("calc.export.colShards"),
  ]
    .map(csvCell)
    .join(",");

  const body = props.rows.map((r) =>
    [r.title, r.srcLevel, r.dstLevel, r.natureLabel || "", r.boostCandy, r.normalCandy, r.totalCandy, r.shards]
      .map(csvCell)
      .join(",")
  );

  const total = ["", "", "", "", props.totals.boostCandy, props.totals.normalCandy, props.totals.totalCandy, props.totals.shards]
    .map(csvCell)
    .join(",");

  return [head, ...body, total].join("\r\n") + "\r\n";
}

function downloadCalcExportCsv() {
  exportCsvMenuOpen.value = false;
  exportStatus.value = "";
  try {
    const csv = buildCalcExportCsv();
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `CandyBoost-Planner_${ts}.csv`;
    // Excel on Windows often expects BOM for UTF-8 CSV.
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = filename;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    exportStatus.value = t("status.csvDownloaded");
  } catch {
    exportStatus.value = t("status.csvDownloadFailed");
  }
}

async function copyCalcExportCsv() {
  exportCsvMenuOpen.value = false;
  exportStatus.value = "";
  const csv = buildCalcExportCsv();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav: any = navigator as any;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(csv);
      exportStatus.value = t("status.csvCopied");
      return;
    }
  } catch {
    // fall through to legacy copy
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = csv;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    exportStatus.value = ok ? t("status.csvCopied") : t("status.csvCopyFailed");
  } catch {
    exportStatus.value = t("status.csvCopyFailed");
  }
}

async function downloadCalcExportPng() {
  const el = exportSheetEl.value;
  if (!el) return;
  exportBusy.value = true;
  exportStatus.value = "";
  exportCsvMenuOpen.value = false;
  try {
    const ua = navigator.userAgent || "";
    // iPadOS sometimes reports MacIntel; treat it as iOS if it has touch.
    const isLikelyIOS =
      /iPad|iPhone|iPod/i.test(ua) ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((navigator as any).platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);

    // Webフォントが読み込まれる前にキャプチャすると崩れるので待つ
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fontsReady = (document as any)?.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === "function") await fontsReady;
    await nextTick();
    // layout確定をもう1拍待つ（モバイルでの「引きずり」/崩れ対策）
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const w = Math.max(el.scrollWidth, el.clientWidth, 1);
    const h = Math.max(el.scrollHeight, el.clientHeight, 1);
    // iOS / 大きいデータで pixelRatio を上げすぎると描画が乱れやすいので控えめに
    const area = w * h;
    const pixelRatio = isLikelyIOS ? 1.5 : h > 6500 || area > 11_000_000 ? 1.25 : h > 5000 || area > 8_000_000 ? 1.5 : 2;
    const dataUrl = await toPng(el, {
      cacheBust: true,
      pixelRatio,
      backgroundColor: "#f7f7f7",
      width: w,
      height: h,
      style: { transform: "none", transformOrigin: "top left" },
    });
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `CandyBoost-Planner_${ts}.png`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav: any = navigator as any;
    if (isLikelyIOS && nav?.share) {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], filename, { type: "image/png" });
        const canShareFiles = typeof nav.canShare !== "function" || nav.canShare({ files: [file] });
        if (canShareFiles) {
          await nav.share({ files: [file], title: t("app.title") });
          exportStatus.value = "";
          return;
        }
      } catch {
        // fall through to fallback
      }
      try {
        window.open(dataUrl, "_blank", "noopener,noreferrer");
        exportStatus.value = "";
        return;
      } catch {
        // fall through to download
      }
    }

    const a = document.createElement("a");
    a.download = filename;
    a.href = dataUrl;
    a.click();
    exportStatus.value = "";
  } catch {
    exportStatus.value = t("status.exportFailed");
  } finally {
    exportBusy.value = false;
  }
}
</script>

<style scoped>
.linkBtn {
  appearance: none;
  background: transparent;
  border: 0;
  box-shadow: none;
  font-family: var(--font-body);
  font-size: 12px;
  text-decoration: underline dotted;
  cursor: pointer;
  color: var(--muted);
  padding: 0;
}
.linkBtn:hover:not(:disabled) { color: var(--accent); }
.linkBtn:disabled { opacity: 0.3; cursor: default; text-decoration: none; }
.linkBtn--basic { text-decoration: underline dotted; color: var(--ink); opacity: 0.7; }
.linkBtn--basic:hover { color: var(--accent); opacity: 1; }

/* --- Export sheet (SNS screenshot) --- */
.exportOverlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  padding: 18px;
  background: color-mix(in oklab, var(--ink) 28%, transparent);
  display: grid;
  place-items: center;
}
.exportSheetWrap {
  width: min(820px, calc(100vw - 36px));
  max-height: calc(100vh - 36px);
  overflow: auto;
}
.exportSheet {
  transform-origin: top center;
  width: 100%;
  border-radius: 12px;
  border: 4px double #d4ac0d;
  background: #f7f7f7;
  box-shadow: 0 4px 12px rgba(74, 66, 56, 0.1);
  padding: 16px 22px 16px;
  position: relative;
}
.exportSheet--capture {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.exportHead {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 4px;
  padding: 0 2px 6px;
  background: transparent;
}
.exportHead::before { content: ""; }
.exportHead > :first-child { justify-self: center; text-align: center; }
.exportBrand {
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -0.01em;
  font-size: 17px;
  color: color-mix(in oklab, var(--ink) 88%, transparent);
  line-height: 1.15;
  margin-top: -2px;
}
.exportActions {
  display: flex;
  flex-wrap: nowrap;
  white-space: nowrap;
  gap: 16px;
  align-items: center;
  justify-self: end;
  position: relative;
}
.exportCsvMenuTrigger { position: relative; display: flex; align-items: center; }
.exportCsvMenu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 5;
  min-width: 180px;
  display: grid;
  gap: 6px;
  padding: 10px;
  border-radius: 14px;
  border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
  background: color-mix(in oklab, var(--paper) 92%, white);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
}
.exportCsvMenu__item {
  appearance: none;
  border: 0;
  width: 100%;
  text-align: left;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 12px;
  padding: 9px 10px;
  border-radius: 12px;
  color: var(--ink);
  background: color-mix(in oklab, var(--paper) 92%, white);
  border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
}
.exportCsvMenu__item:hover { background: color-mix(in oklab, var(--accent) 10%, var(--paper)); }
.exportStatus {
  margin: 0 0 10px;
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 62%, transparent);
}
.exportCalc { display: flex; flex-direction: column; }

.exportStats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 15px 10px 12px;
}
.statCard {
  display: flex;
  align-items: center;
  gap: 10px;
  background: white;
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04), 0 0 0 1px color-mix(in oklab, var(--ink) 6%, transparent);
}
.statCard--accent {
  background: linear-gradient(135deg, #fff5f7 0%, #fff0f0 100%);
  box-shadow: 0 2px 6px rgba(255, 100, 100, 0.1), 0 0 0 1px rgba(255, 100, 100, 0.15);
}
.statCard--primary {
  background: linear-gradient(135deg, #f0f7ff 0%, #e6f2ff 100%);
  box-shadow: 0 2px 6px rgba(50, 100, 255, 0.1), 0 0 0 1px rgba(50, 100, 255, 0.15);
}
.statCard--danger { background: #fff5f5; color: #d32f2f; }
.statCard__icon { font-size: 20px; line-height: 1; }
.statCard__content { min-width: 0; }
.statCard__label {
  font-size: 10px;
  color: color-mix(in oklab, var(--ink) 50%, transparent);
  line-height: 1;
  margin-bottom: 4px;
  white-space: nowrap;
}
.statCard__value {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 30px;
  line-height: 1;
  color: var(--ink);
}
.statCard__value--danger { color: var(--danger); }

/* Capture mode: keep card shape (outline) but drop heavy shadows to avoid "dragged" artifacts */
.exportSheet--capture .statCard {
  box-shadow: none !important;
  outline: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
  outline-offset: -1px;
}

/* Bars (export-local) */
.exportBars {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  border: 1px solid color-mix(in oklab, var(--ink) 6%, transparent);
  margin: 10px 10px 0;
  padding: 12px 14px;
  display: grid;
  gap: 12px;
}
.exportBars--muted { opacity: 0.85; }
.exportBarHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.exportBarK { font-family: var(--font-body); font-size: 12px; color: color-mix(in oklab, var(--ink) 68%, transparent); }
.exportBarK--right { white-space: nowrap; text-align: right; }
.exportBarOverVal { color: var(--danger); font-weight: 700; margin-left: 4px; }
.exportBar {
  margin-top: 8px;
}
.exportBar__track {
  position: relative;
  height: 10px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--ink) 8%, transparent);
  overflow: hidden;
}
.exportBar__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  background: color-mix(in oklab, var(--accent-cool) 70%, var(--ink) 10%);
}
.exportBar__fill--candy {
  background: color-mix(in oklab, var(--accent-warm) 72%, var(--ink) 10%);
}
.exportBar__over {
  position: absolute;
  inset: 0 0 0 auto;
  width: 0%;
  background: color-mix(in oklab, var(--danger) 70%, var(--ink) 10%);
}

/* --- Export List --- */
.exportList {
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  border: 1px solid color-mix(in oklab, var(--ink) 6%, transparent);
  overflow: hidden;
  margin: 20px 10px 0;
}
.exportList__head {
  display: grid;
  grid-template-columns: 2fr 1.2fr 1fr 1fr 1fr 1.3fr;
  gap: 10px;
  padding: 12px 16px;
  background: #f7f7f7;
  border-bottom: 2px solid #ebe6de;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 11px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
  align-items: center;
}
.exportList__row {
  display: grid;
  grid-template-columns: 2fr 1.2fr 1fr 1fr 1fr 1.3fr;
  gap: 10px;
  padding: 12px 16px;
  align-items: center;
  border-bottom: 1px solid #f0ebe5;
}
.exportList__row:last-child { border-bottom: 0; }
.exportList__row:nth-child(even) { background: #fafafa; }
.exportList__row--total { background: #f7f7f7; border-top: 2px solid #ebe6de; }
.exportList__col { min-width: 0; font-size: 13px; font-weight: 500; color: var(--ink); }
.exportList__col.u-align-right { text-align: right; }
.exportList__col.u-align-center { text-align: center; }
.exportList__nameCol { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.exportList__name { font-family: var(--font-heading); font-weight: 800; font-size: 14px; line-height: 1.2; }
.exportList__badge {
  font-size: 9.5px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f0ebe5;
  color: color-mix(in oklab, var(--ink) 65%, transparent);
  white-space: nowrap;
}
.exportList__lvWrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-weight: 800;
  font-family: var(--font-heading);
  background: #f5f2ef;
  padding: 4px 8px;
  border-radius: 6px;
  min-width: 60px;
}
.exportList__arrow { color: color-mix(in oklab, var(--ink) 30%, transparent); font-size: 10px; }
.exportList__numCol .calcRow__num { font-size: 15px; color: #333; }
.exportList__numCol .calcRow__num.calcRow__num--danger { color: var(--danger); }
.u-mobile-label { display: none; }

@media (max-width: 860px) {
  .exportStats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 12px 0 10px;
    gap: 10px;
  }
  .statCard__label { white-space: normal; line-height: 1.15; }
  .statCard__value { font-size: clamp(18px, 4.6vw, 26px); white-space: normal; overflow-wrap: anywhere; }
}

@media (max-width: 560px) {
  .exportOverlay { padding: 0; place-items: stretch; }
  .exportSheetWrap {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }
  .exportSheet { border-radius: 0; padding: 12px 14px 16px; border: 0; box-shadow: none; }
  .exportHead {
    position: sticky;
    top: 0;
    z-index: 2;
    background: #f7f7f7;
    padding: 10px 0 8px;
    margin: -12px 0 6px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .exportHead::before { display: none; }
  .exportHead > :first-child { justify-self: start; text-align: left; }
  .exportActions {
    justify-self: start;
    justify-content: flex-start;
    flex-wrap: wrap;
    white-space: normal;
    gap: 12px;
    max-width: 100%;
  }
  .linkBtn { line-height: 1.2; padding: 2px 0; }
  .exportBrand { font-size: 16px; margin-top: 0; }
  .exportStats { grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 12px 0 10px; gap: 10px; }
  .statCard { min-width: 0; padding: 9px 10px; gap: 8px; }
  .statCard__icon { display: none; }
  .statCard__value { font-size: clamp(18px, 6.2vw, 24px); letter-spacing: -0.02em; }
  .exportBars { margin: 6px 0 0; padding: 12px 12px; }
  .exportList { margin: 16px 0 0; }
  .exportList__head { display: none; }
  .exportList__row { grid-template-columns: repeat(5, 1fr); gap: 8px 6px; padding: 14px; }
  .exportList__nameCol {
    grid-column: 1 / -1;
    margin-bottom: 4px;
    border-bottom: 1px dashed #ebe6de;
    padding-bottom: 8px;
    width: 100%;
  }
  .exportList__lvWrap { background: transparent; padding: 0; gap: 4px; font-size: 12px; justify-content: flex-start; }
  .exportList__lvCol { display: flex; align-items: center; justify-content: flex-start; text-align: left; margin-top: auto; }
  .exportList__col.u-align-center { text-align: left; }
  .exportList__numCol { display: flex; flex-direction: column; align-items: flex-end; }
  .u-mobile-label {
    display: block;
    font-size: 9px;
    color: color-mix(in oklab, var(--ink) 45%, transparent);
    margin-bottom: 0px;
    white-space: nowrap;
  }
  .exportList__numCol .calcRow__num { font-size: 14px; }
}
</style>
