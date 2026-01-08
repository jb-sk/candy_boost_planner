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
          <div class="exportHead__top">
            <div class="exportBrand">🍬 {{ boostKind === 'full' ? t("calc.export.brandBoost") : boostKind === 'mini' ? t("calc.export.brandMini") : t("calc.export.brand") }}</div>
          </div>

          <div class="exportMeta">
            <div class="exportMonth" aria-label="month">{{ exportMonthLabel }}</div>

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
        </div>

        <div v-if="exportStatus" class="exportStatus" role="status">{{ exportStatus }}</div>

        <div class="exportCalc">
          <div class="exportCalcTop">
            <div class="exportStats" :class="{ 'exportStats--hasShortage': totals.shortage > 0, 'exportStats--normal': !isBoostMode }">
              <div
                v-for="card in statCards"
                :key="card.key"
                class="statCard"
                :class="{
                  [`statCard--${card.variant}`]: card.variant,
                  'statCard--danger': card.variant === 'danger',
                }"
              >
                <div class="statCard__icon">{{ card.icon }}</div>
                <div class="statCard__content">
                  <div class="statCard__label">{{ card.label }}</div>
                  <div class="statCard__value" :class="{ 'statCard__value--danger': card.isDanger }">
                    {{ fmtNum(card.value) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="exportBars" :class="{ 'exportBars--muted': shardsCap <= 0, 'exportBars--danger': shardsOver > 0 || boostOver > 0 }">
              <div v-if="isBoostMode" class="exportBarBlock" :class="{ 'exportBarBlock--danger': boostOver > 0 }">
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
                    <div class="exportBar__fill" :style="{ width: `${boostFillPct}%` }"></div>
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

          <div class="exportList" :class="{ 'exportList--normal': !isBoostMode, 'exportList--hasShortage': totals.shortage > 0 }">
            <div class="exportList__head">
              <div class="exportList__col">{{ t("calc.export.colPokemon") }}</div>
              <div class="exportList__col u-align-center">{{ t("calc.row.srcLevel") }} → {{ t("calc.row.dstLevel") }}</div>
              <div v-if="isBoostMode" class="exportList__col u-align-right">{{ t("calc.export.colBoost") }}</div>
              <div v-if="isBoostMode" class="exportList__col u-align-right">{{ t("calc.export.colNormal") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colTotal") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colShards") }}</div>
              <div v-if="totals.shortage > 0" class="exportList__col u-align-right">{{ t("calc.export.colShortage") }}</div>
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
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colBoost") }}</span>
                <span class="calcRow__num">{{ fmtNum(row.boostCandy) }}</span>
              </div>
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
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
              <div v-if="totals.shortage > 0" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShortage") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': (row.shortage ?? 0) > 0 }">{{ (row.shortage ?? 0) > 0 ? fmtNum(row.shortage ?? 0) : '-' }}</span>
              </div>
            </div>

            <div class="exportList__row exportList__row--total" aria-label="total">
              <div class="exportList__col exportList__nameCol">
                <span class="exportList__name" aria-hidden="true"></span>
              </div>
              <div class="exportList__col u-align-center exportList__lvCol"></div>
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colBoost") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': totals.boostCandy > boostCap }">{{ fmtNum(totals.boostCandy) }}</span>
              </div>
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
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
              <div v-if="totals.shortage > 0" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShortage") }}</span>
                <span class="calcRow__num calcRow__num--danger">{{ fmtNum(totals.shortage) }}</span>
              </div>
            </div>
          </div>

          <!-- 万能アメ使用ランキング -->
          <div v-if="universalCandyRanking.length > 0" class="exportRanking">
            <div class="exportRanking__title">{{ t("calc.export.universalRankingTitle") }}</div>
            <div class="exportRanking__total">
              <span>{{ t("calc.export.rankingTotal") }}</span>
              <span v-if="universalCandyUsedTotal.s > 0">{{ t("calc.export.totalUniversalS") }} {{ fmtNum(universalCandyUsedTotal.s) }}</span>
              <span v-if="universalCandyUsedTotal.m > 0">{{ t("calc.export.totalUniversalM") }} {{ fmtNum(universalCandyUsedTotal.m) }}</span>
              <span v-if="universalCandyUsedTotal.l > 0">{{ t("calc.export.totalUniversalL") }} {{ fmtNum(universalCandyUsedTotal.l) }}</span>
            </div>
            <div class="exportRanking__list">
              <div v-for="item in universalCandyRanking" :key="item.id" class="exportRanking__item">
                <div class="exportRanking__name">{{ item.pokemonName }}</div>
                <div class="exportRanking__pct">{{ item.usagePct }}%</div>
                <div class="exportRanking__barWrap">
                  <div class="exportRanking__bar" :style="{ width: `${item.usagePct}%` }"></div>
                </div>
                <div class="exportRanking__items">
                  <span v-if="item.uniSUsed > 0 || item.uniMUsed > 0 || item.uniLUsed > 0" class="exportRanking__itemGroup">
                    <span class="exportRanking__itemLabel">{{ t("calc.export.labelUni") }}</span>
                    <span v-if="item.uniSUsed > 0">S{{ item.uniSUsed }}</span>
                    <span v-if="item.uniSUsed > 0 && (item.uniMUsed > 0 || item.uniLUsed > 0)"> / </span>
                    <span v-if="item.uniMUsed > 0">M{{ item.uniMUsed }}</span>
                    <span v-if="item.uniMUsed > 0 && item.uniLUsed > 0"> / </span>
                    <span v-if="item.uniLUsed > 0">L{{ item.uniLUsed }}</span>
                  </span>
                  <span v-if="item.typeSUsed > 0 || item.typeMUsed > 0" class="exportRanking__itemGroup">
                    <span class="exportRanking__itemLabel">{{ t("calc.export.labelType") }}</span>
                    <span v-if="item.typeSUsed > 0">S{{ item.typeSUsed }}</span>
                    <span v-if="item.typeSUsed > 0 && item.typeMUsed > 0"> / </span>
                    <span v-if="item.typeMUsed > 0">M{{ item.typeMUsed }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
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
  candySupply?: string; // アメ補填
  shortage?: number;
};

type ExportTotals = {
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
  shortage: number;
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

  universalCandyRanking: Array<{
    id: string;
    pokemonName: string;
    universalValue: number;
    usagePct: number;
    uniSUsed: number;
    uniMUsed: number;
    uniLUsed: number;
    typeSUsed: number;
    typeMUsed: number;
  }>;
  universalCandyUsedTotal: { s: number; m: number; l: number };
  boostKind: "full" | "mini" | "none";
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

const isBoostMode = computed(() => props.boostKind !== "none");

type StatCardDef = {
  key: string;
  icon: string;
  label: string;
  value: number;
  variant?: "accent" | "primary" | "danger";
  isDanger?: boolean;
  show: boolean;
};

const statCards = computed<StatCardDef[]>(() => {
  const cards: StatCardDef[] = [];

  if (isBoostMode.value) {
    cards.push({
      key: "boost",
      icon: "🍬",
      label: t("calc.export.sumBoostTotal"),
      value: props.totals.boostCandy,
      variant: "accent",
      // 個数指定を反映した合計がキャップを超えているか判定
      isDanger: props.totals.boostCandy > props.boostCap,
      show: true,
    });
  }

  cards.push({
    key: "normal",
    icon: "⚪",
    label: t("calc.export.sumNormalTotal"),
    value: props.totals.normalCandy,
    show: true,
  });

  if (isBoostMode.value) {
    cards.push({
      key: "unused",
      icon: "⚠️",
      label: t("calc.export.sumBoostUnused"),
      value: props.boostUnused,
      isDanger: props.boostOver > 0,
      show: true,
    });
  }

  cards.push({
    key: "shards",
    icon: "💎",
    label: t("calc.export.sumShardsTotal"),
    value: props.shardsUsed,
    variant: "primary",
    isDanger: props.shardsCap > 0 && props.shardsOver > 0,
    show: true,
  });

  if (props.totals.shortage > 0) {
    cards.push({
      key: "shortage",
      icon: "🔥",
      label: t("calc.export.sumShortage"),
      value: props.totals.shortage,
      variant: "danger",
      isDanger: true,
      show: true,
    });
  }

  return cards;
});

const exportMonthLabel = computed(() => {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  // 日は不要。要望通り「YYYY年M月」で固定。
  return `${y}年${m}月`;
});

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCalcExportCsv(): string {
  const isNormal = props.boostKind === "none";

  // 列順：Pokemon, EXP補正, 現在Lv, 目標Lv, (Boost, Normal), Total, Shards
  const headCols = [
    t("calc.export.colPokemon"),
    t("calc.export.colExpAdj"),
    t("calc.row.srcLevel"),
    t("calc.row.dstLevel"),
    ...(isNormal ? [] : [t("calc.export.colBoost"), t("calc.export.colNormal")]),
    t("calc.export.colTotal"),
    t("calc.export.colShards"),
  ];
  const head = headCols.map(csvCell).join(",");

  const body = props.rows.map((r) => {
    const cols = [
      r.title,
      r.natureLabel || "",
      r.srcLevel,
      r.dstLevel,
      ...(isNormal ? [] : [r.boostCandy, r.normalCandy]),
      r.totalCandy,
      r.shards,
    ];
    return cols.map(csvCell).join(",");
  });

  const totalCols = [
    "",
    "",
    "",
    "",
    ...(isNormal ? [] : [props.totals.boostCandy, props.totals.normalCandy]),
    props.totals.totalCandy,
    props.totals.shards,
  ];
  const total = totalCols.map(csvCell).join(",");

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
      backgroundColor: "#ffffff",
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
  border-radius: 4px; /* シャープに */
  background: #ffffff;
  /* Calc Panel Theme Match */
  --ink: #44403c;
  --muted: #a8a29e;
  --accent: #0ea5e9;   /* Sky 500: テキスト・ヘッダー用 */
  --bar-fill: #ec4899;  /* Pink 500: 使用量（ピンク） */
  --bar-track: #bae6fd; /* Sky 200: バー背景（水色） */
  --danger: #ef4444;    /* Red 500 */

  /* 深みのあるドロップシャドウでプロ感を出す */
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  padding: 40px; /* 余白を贅沢に */
  position: relative;
  font-family: var(--font-body);
  color: var(--ink);
}
.exportSheet--capture {
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: #ffffff;
}

/* Header: Report Style */
.exportHead {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border-bottom: 2px solid var(--ink); /* 強い区切り線 */
  padding-bottom: 16px;
  margin-bottom: 32px;
}

.exportHead__top {
  display: flex;
  text-align: left;
}
.exportMeta {
  position: relative;
  display: flex;
  align-items: baseline; /* ベースラインで揃える */
  gap: 16px;
  min-width: 0;
}
/* 年月表示: 右上に配置し、落ち着いた色味に */
.exportMonth {
  position: static;
  transform: none;
  font-family: var(--font-heading);
  font-weight: 700;
  letter-spacing: 0.05em;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.5;
  /* margin-bottom 削除 */
}
.exportBrand {
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -0.01em;
  font-size: 22px; /* タイトルを大きく */
  color: var(--ink);
  line-height: 1.1;
}
.exportActions {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.exportCsvMenuTrigger { position: relative; display: flex; align-items: center; }
.exportCsvMenu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 5;
  min-width: 180px;
  display: grid;
  gap: 4px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}
.exportCsvMenu__item {
  appearance: none;
  border: 0;
  width: 100%;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 4px;
  color: var(--ink);
  background: transparent;
}
.exportCsvMenu__item:hover { background: #f1f5f9; color: var(--accent); }
.exportStatus {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--muted);
  text-align: right;
}
.exportCalc { display: flex; flex-direction: column; }

/* Stats Area: Dashboard Style */
.exportStats {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  margin: 0 0 32px;
  gap: 24px;
  margin: 0 0 32px;
  padding: 20px 24px;
  background: #f8fafc; /* 薄いグレー背景 */
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.exportStats--hasShortage {
  /* Shortageがあるときもflexで並べる */
}
.statCard {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  background: transparent;
  box-shadow: none;
  padding: 0;
  border: none;
  border-radius: 0;
}
/* アイコンは控えめに、あるいは削除してもいいが残す */
.statCard__icon { font-size: 16px; opacity: 0.8; }
.statCard__content { min-width: 0; }
.statCard__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  font-weight: 600;
  margin-bottom: 2px;
}
.statCard__value {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 28px;
  line-height: 1;
  color: var(--ink);
  font-variant-numeric: tabular-nums; /* 数字の幅を揃える */
}
.statCard__value--danger { color: var(--danger); }
.statCard--danger .statCard__value { color: var(--danger); }

/* Bars: Clean & Minimal */
.exportBars {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  margin: 0 0 40px;
  display: grid;
  gap: 20px;
}
.exportBars--muted { opacity: 0.8; }
.exportBarHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
}
.exportBarK {
  font-size: 14px;
  color: var(--ink);
  font-weight: 700;
}
.exportBarK--right {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}
.exportBarOverVal { color: var(--danger); font-weight: 700; margin-left: 4px; }
.exportBar { margin-top: 0; }
.exportBar__track {
  position: relative;
  height: 8px; /* 少し細く */
  border-radius: 4px;
  background: var(--bar-track); /* 水色背景 */
  overflow: hidden;
}
.exportBar__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  border-radius: 4px;
  background: var(--bar-fill); /* ピンク */
}
.exportBars--danger .exportBar__fill {
   /* Shortage時は少し色を変える？今はそのままでOK */
}
.exportBarBlock--danger .exportBar__fill {
  background: linear-gradient(90deg, var(--danger) 0%, rgb(255, 100, 100) 100%);
}
/* Shards bar color: 同色（ピンク）にするため個別設定を削除 */
.exportBar__over {
  position: absolute;
  inset: 0 0 0 auto;
  width: 0%;
  background: repeating-linear-gradient(
    -45deg,
    rgba(239, 68, 68, 0.15) 0,
    rgba(239, 68, 68, 0.15) 6px,
    rgba(255,255,255,0.5) 6px,
    rgba(255,255,255,0.5) 12px
  );
}

/* List: Table Style (High Contrast) */
.exportList {
  display: flex;
  flex-direction: column;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border: none;
  margin: 0;
  font-size: 13px;
}
.exportList__head {
  display: grid;
  grid-template-columns: 2fr 0.9fr 0.7fr 0.7fr 0.7fr 1.5fr;
  gap: 12px;
  padding: 12px 16px;
  background: color-mix(in oklab, var(--accent) 8%, white); /* 計算機と同じ水色背景 */
  color: var(--ink); /* 文字は黒ではっきり */
  border-bottom: 2px solid var(--accent); /* 青いライン */
  border-radius: 6px;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.05em;
  align-items: center; /* ヘッダーは中央揃えで見やすく */
}
.exportList__row {
  display: grid;
  grid-template-columns: 2fr 0.9fr 0.7fr 0.7fr 0.7fr 1.5fr;
  gap: 12px;
  padding: 12px 16px;
  align-items: center; /* 行内は中央揃えに戻す（罫線スタイルならずれてもOKだが、揃ってる方がプロっぽい） */
  border-bottom: 1px solid #e2e8f0;
}
.exportList__row:last-child { border-bottom: 2px solid var(--ink); } /* 最後の行（合計前）を区切る */

.exportList--hasShortage .exportList__head,
.exportList--hasShortage .exportList__row {
  grid-template-columns: 2fr 0.9fr 0.7fr 0.7fr 0.7fr 1.2fr 0.7fr;
}

.exportList__col { min-width: 0; font-weight: 500; }
.exportList__col.u-align-right { text-align: right; }
.exportList__col.u-align-center { text-align: center; }

.exportList__nameCol { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.exportList__name { font-weight: 700; font-size: 14px; color: var(--ink); }
.exportList__badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  color: var(--muted);
  border: 1px solid #e2e8f0;
}
.exportList__lvWrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  background: transparent;
  padding: 0;
  color: var(--ink);
}
.exportList__arrow { color: var(--muted); font-size: 10px; }
.exportList__numCol .calcRow__num {
  font-size: 14px;
  font-family: var(--font-body);
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.exportList__numCol .calcRow__num--danger { color: var(--danger); font-weight: 700; }

/* モバイルラベルはデスクトップでは非表示 */
.u-mobile-label { display: none; }

.exportList__row--total {
  background: #f8fafc;
  border-bottom: none;
  font-weight: 700;
  border-radius: 0 0 6px 6px;
  margin-top: 4px;
}

/* Ranking */
.exportRanking {
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  border: 1px solid color-mix(in oklab, var(--ink) 6%, transparent);
  overflow: hidden;
  margin: 20px 10px 0;
  padding: 16px 18px;
}

.exportRanking__title {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 16px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.exportRanking__title::before {
  content: "";
  display: block;
  width: 6px;
  height: 20px;
  background: var(--accent);
  border-radius: 3px;
}
.exportRanking__total {
  font-size: 13px;
  background: color-mix(in oklab, var(--accent) 8%, transparent);
  margin-bottom: 16px;
  padding: 10px 14px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 16px;
  font-weight: 600;
}
.exportRanking__total span:first-child {
  color: color-mix(in oklab, var(--ink) 70%, transparent);
  font-weight: 700;
  font-size: 12px;
}
.exportRanking__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.exportRanking__item {
  display: grid;
  grid-template-columns: minmax(80px, 1.2fr) 40px 120px minmax(0, 3fr);
  gap: 0 12px;
  align-items: center;
  padding: 10px 6px;
  border-bottom: 1px solid color-mix(in oklab, var(--ink) 6%, transparent);
}
.exportRanking__item:last-child {
  border-bottom: none;
}
.exportRanking__name {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  grid-column: 1 / 2;
  grid-row: 1 / 2;
}
.exportRanking__pct {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 15px;
  text-align: right;
  grid-column: 2 / 3;
  grid-row: 1 / 2;
}
.exportRanking__barWrap {
  position: relative;
  height: 8px;
  background: color-mix(in oklab, var(--ink) 8%, transparent);
  border-radius: 4px;
  overflow: hidden;
  grid-column: 3 / 4;
  grid-row: 1 / 2;
}
.exportRanking__bar {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  background: color-mix(in oklab, var(--accent-warm) 85%, var(--ink) 5%);
  border-radius: 4px;
  transition: width 240ms ease;
}
.exportRanking__items {
  grid-column: 4 / 5;
  grid-row: 1 / 2;
  display: flex;
  gap: 8px;
  flex-wrap: nowrap;
  font-size: 13px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
  margin-top: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.exportRanking__itemGroup {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
}
.exportRanking__itemLabel {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  color: color-mix(in oklab, var(--ink) 70%, transparent);
  background-color: color-mix(in oklab, var(--ink) 6%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.4;
}

/* Mobile Responsive */
@media (max-width: 680px) {
  /* Full Screen Overlay */
  .exportOverlay {
    padding: 0;
    display: block; /* grid center 解除 */
    overflow: hidden; /* Wrapでスクロールさせる */
  }
  .exportSheetWrap {
    width: 100%;
    height: 100%;
    max-height: none;
    border-radius: 0;
  }
  .exportSheet {
    width: 100%;
    min-height: 100%;
    border-radius: 0;
    box-shadow: none;
    padding: 20px 16px;
  }

  .exportHead {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 24px;
    border-bottom: 1px solid #e2e8f0;
  }
  /* ブランド名は大きく */
  .exportBrand { font-size: 20px; }

  .exportMeta {
    width: 100%;
    justify-content: space-between;
    margin-top: 4px;
  }

  /* Stats: 2カラム折り返し */
  .exportStats, .exportStats--normal {
    flex-wrap: wrap;
    gap: 16px;
    justify-content: flex-start;
  }
  .statCard, .exportStats--normal > .statCard {
    flex: 0 0 calc(50% - 9px); /* 2列 */
    min-width: 0;
    align-items: flex-start;
    text-align: left;
  }
  .statCard__value { font-size: 22px; }

  /* List: Compact List View (No Tiles) */
  .exportList__head { display: none; }

  .exportList__row,
  .exportList--normal .exportList__row,
  .exportList--hasShortage .exportList__row,
  .exportList--normal.exportList--hasShortage .exportList__row {
    display: grid;
    /* 4カラム均等割で縦のラインを揃える */
    grid-template-columns: repeat(4, 1fr);
    gap: 4px 8px;
    padding: 10px 4px;
    border: none;
    border-bottom: 1px solid #e2e8f0;
    border-radius: 0;
    margin-bottom: 0;
    background: transparent;
    box-shadow: none;
  }

  .exportList__nameCol {
    grid-column: 1 / 4;
    border-bottom: none;
    padding-bottom: 0;
    margin-bottom: 0;
  }
  .exportList__name { font-size: 14px; }
  .exportList__badge { scale: 0.9; transform-origin: left center; }

  .exportList__lvCol {
    grid-column: 4 / -1;
    justify-content: flex-end;
    font-size: 12px;
  }

  /* 数値カラム: 2行目以降に自動配置 (span 1) */
  .exportList__col.u-align-right,
  .exportList__col.u-align-center {
    text-align: left;
    display: flex;
    flex-direction: column; /* 値とラベルを縦積み、あるいは横並び？横並びにして省スペース化 */
    align-items: flex-start;
    grid-column: span 1; /* 1行に4つ並ぶ */
  }

  /* ラベルと値をコンパクトに */
  .u-mobile-label {
    display: block;
    font-size: 9px;
    margin-bottom: 0px;
    background: transparent;
    border: none;
    padding: 0;
    color: var(--muted);
  }

  .calcRow__num { font-size: 13px; }

  /* Total Row: Grid Layout (Match Data Row) */
  .exportList__row--total {
    display: grid;
    grid-template-columns: repeat(4, 1fr); /* データ行と一致させる */
    gap: 4px 8px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    /* データ行と同じpaddingにする */
    padding: 10px 4px;
    margin-bottom: 0;
    border-radius: 0;
  }

  /* Total行の空カラム（名前・Lv）は非表示 */
  .exportList__row--total .exportList__nameCol,
  .exportList__row--total .exportList__lvCol {
    display: none;
  }

  /* 数値カラムのスタイル調整: コントラスト強化 */
  .exportList__row--total .exportList__numCol {
    width: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    grid-column: span 1;
  }
  .exportList__row--total .calcRow__num {
    /* 太字にはしない */
    color: #0f172a; /* Slate 900 */
  }
  .exportList__row--total .u-mobile-label {
    text-align: left;
    color: var(--ink); /* MutedではなくInk */
    /* 太字にはしない */
    opacity: 0.9; /* 視認性確保のため不透明度のみ上げる */
  }
}

@media (max-width: 530px) {
  .exportRanking__item {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto auto;
    gap: 6px 12px;
    padding: 12px 6px;
  }
  .exportRanking__name {
    grid-column: 1 / 2;
    grid-row: 1 / 2;
    font-size: 13px;
  }
  .exportRanking__pct {
    grid-column: 2 / 3;
    grid-row: 1 / 2;
  }
  .exportRanking__barWrap {
    display: block;
    grid-column: 1 / 3;
    grid-row: 2 / 3;
    height: 6px;
  }
  .exportRanking__items {
    grid-column: 1 / 3;
    grid-row: 3 / 4;
    flex-wrap: wrap;
    white-space: normal;
    font-size: 11px;
    gap: 8px;
  }
}

/* When capturing PNG, never include action links in the exported image */
/* --- Normal Mode Adjustments --- */
.exportStats--normal {
  display: flex;
  gap: 12px;
}
.exportStats--normal > .statCard {
  flex: 1;
  min-width: 0;
  justify-content: center;
  text-align: center;
}
.exportStats--normal .statCard__icon {
  display: none;
}

/* 通常モード（4列）: Pokemon, Lv, Total, Shards */
.exportList--normal .exportList__head,
.exportList--normal .exportList__row {
  grid-template-columns: 2fr 1fr 1fr 1.5fr;
  padding-left: 32px;
  padding-right: 32px;
}

/* 通常モード+アメ不足（5列）: Pokemon, Lv, Total, Shards, Shortage */
.exportList--normal.exportList--hasShortage .exportList__head,
.exportList--normal.exportList--hasShortage .exportList__row {
  grid-template-columns: 2fr 1fr 1fr 1.2fr 0.8fr;
}



.exportSheet--capture .exportActions {
  display: none !important;
}
</style>
