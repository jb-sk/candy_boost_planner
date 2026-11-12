<template>
  <!-- シンプルの上に重ねる小窓。外（暗くした部分）を押しても閉じる -->
  <div class="fineTuneReport" data-testid="fine-tune-raise-report-overlay" @click.self="emit('close')">
    <div
      ref="rootRef"
      class="fineTuneReport__card"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      data-testid="fine-tune-raise-report"
    >
      <!-- アメ節約・かけら節約で結果が違うときだけタブを出す。選ぶと下書きもその結果に替わる（元に戻すは1件のまま）。
           かけら節約を裏で求めている間は、押せない「計算中」のタブを出しておき、同じ結果なら消す -->
      <div
        v-if="tabbed"
        class="fineTuneReport__tabs"
        role="tablist"
        :aria-label="t('calc.fineTune.raiseReport.savingTabs')"
        data-testid="fine-tune-raise-report-tabs"
        @keydown="onTabKeydown"
      >
        <button
          v-for="(option, i) in options"
          :id="`${tabId}-${i}`"
          :key="option.savings.join('-')"
          class="fineTuneReport__tab"
          :class="{ 'fineTuneReport__tab--on': i === selected }"
          type="button"
          role="tab"
          data-testid="fine-tune-raise-report-tab"
          :data-saving="option.savings.join(' ')"
          :aria-selected="i === selected"
          :aria-controls="panelId"
          :tabindex="i === selected ? 0 : -1"
          @click="emit('select', i)"
        >{{ savingLabel(option) }}</button>
        <button
          v-if="pending"
          class="fineTuneReport__tab fineTuneReport__tab--pending"
          type="button"
          role="tab"
          data-testid="fine-tune-raise-report-tab"
          data-saving="shards"
          data-pending="true"
          aria-selected="false"
          aria-disabled="true"
          tabindex="-1"
        >{{ t("calc.fineTune.raiseReport.savingPending", { name: t("calc.fineTune.raiseReport.savingShards") }) }}</button>
      </div>
      <div
        :id="panelId"
        class="fineTuneReport__panel"
        :role="tabbed ? 'tabpanel' : undefined"
        :aria-labelledby="tabbed ? `${tabId}-${selected}` : undefined"
      >
        <p :id="titleId" class="fineTuneReport__title">
          <svg class="fineTuneReport__icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path :d="SPARKLE_PATH" fill="currentColor"/></svg>
          <span data-testid="fine-tune-raise-report-title">{{ title }}</span>
        </p>
        <!-- 列の見出しは1回だけ。どの行も同じ列に値を置き、縦に見比べられるようにする。スマホ幅は名前を1段目、値を2段目に置く -->
        <div class="fineTuneReport__table" role="table" :aria-labelledby="titleId">
          <div class="fineTuneReport__head" role="row">
            <span class="fineTuneReport__h fineTuneReport__h--name" role="columnheader">{{ t("calc.fineTune.col.pokemon") }}</span>
            <span v-for="col in columns" :key="col.key" class="fineTuneReport__h" role="columnheader">{{ col.label }}</span>
          </div>
          <div
            v-for="row in rows"
            :key="row.rowId"
            class="fineTuneReport__row"
            :class="{ 'fineTuneReport__row--raised': row.reach === 'better' }"
            role="row"
            data-testid="fine-tune-raise-report-row"
            :data-row-id="row.rowId"
            :data-level="row.level.dir"
            :data-reach="row.reach"
          >
            <span class="fineTuneReport__name" role="rowheader">{{ row.name }}</span>
            <span
              class="fineTuneReport__cell"
              role="cell"
              data-testid="fine-tune-raise-report-item"
              data-item="level"
              :data-changed="String(row.level.dir !== 'same')"
            >
              <template v-if="row.level.dir !== 'same'">
                <span class="fineTuneReport__before">{{ row.level.before }}</span><span class="fineTuneReport__arrow"> → </span><span class="fineTuneReport__after" :class="{ 'fineTuneReport__after--down': row.level.dir === 'down' }">{{ row.level.after }}</span>
              </template>
              <!-- 変わらない行も到達Lvを出す（下がっていないことが分かるように）。薄く出す -->
              <span v-else class="fineTuneReport__same">{{ row.level.after }}</span>
            </span>
            <!-- あとEXP（次のLvまで。操作パネルの「到達Lv 63（あとEXP 358）」と同じ）。後の値の色は到達点の向きで決める。
                 到達Lvが変わった行は後の値だけ（違うLvのあとEXPどうしは比べられない）。Lvが同じ行だけ「前 → 後」 -->
            <span
              class="fineTuneReport__cell"
              role="cell"
              data-testid="fine-tune-raise-report-item"
              data-item="expLeft"
              :data-changed="String(row.expLeft.changed)"
            >
              <template v-if="row.expLeft.changed">
                <template v-if="row.level.dir === 'same'"><span class="fineTuneReport__before">{{ row.expLeft.before }}</span><span class="fineTuneReport__arrow"> → </span></template><span class="fineTuneReport__after" :class="{ 'fineTuneReport__after--down': row.reach === 'worse', 'fineTuneReport__after--same': row.reach === 'same' }">{{ row.expLeft.after }}</span>
              </template>
              <span v-else-if="row.expLeft.after !== null" class="fineTuneReport__same">{{ row.expLeft.after }}</span>
              <template v-else><span class="fineTuneReport__none" aria-hidden="true">—</span><span class="fineTuneReport__srOnly">{{ t("calc.fineTune.raiseReport.unchanged") }}</span></template>
            </span>
            <span
              v-for="cell in row.deltas"
              :key="cell.key"
              class="fineTuneReport__cell"
              role="cell"
              data-testid="fine-tune-raise-report-item"
              :data-item="cell.key"
              :data-changed="String(cell.text !== null)"
            >
              <template v-if="cell.text !== null">{{ cell.text }}</template>
              <!-- 変わらなかった値は消さずに薄い「—」で残す（列の位置をそろえる）。読み上げは「変わらず」 -->
              <template v-else><span class="fineTuneReport__none" aria-hidden="true">—</span><span class="fineTuneReport__srOnly">{{ t("calc.fineTune.raiseReport.unchanged") }}</span></template>
            </span>
          </div>
        </div>
        <!-- 前の値・後の値・増減の札は、行をまたいで同じ幅の欄に右寄せし、→ と数字の桁を縦にそろえる（`remainingWidths`） -->
        <div v-if="remaining.length > 0" class="fineTuneReport__remaining" :style="remainingWidths" data-testid="fine-tune-raise-report-remaining">
          <p v-for="item in remaining" :key="item.key" class="fineTuneReport__rem" data-testid="fine-tune-raise-report-remaining-item" :data-item="item.key">
            <span class="fineTuneReport__remK">{{ item.label }}</span>
            <span class="fineTuneReport__remV">
              <span class="fineTuneReport__before fineTuneReport__remB">{{ item.before }}</span><span class="fineTuneReport__arrow"> → </span><span class="fineTuneReport__remAfter">{{ item.after }}</span><span class="fineTuneReport__remD">{{ item.delta }}</span>
            </span>
          </p>
        </div>
      </div>
      <!-- キャンセルは押す前の下書きへ戻して閉じる。OK・外を押す・Escape は伸ばした結果のまま閉じる -->
      <div class="fineTuneReport__actions">
        <button
          class="btn fineTuneReport__cancel"
          type="button"
          data-testid="fine-tune-raise-report-cancel"
          @click="emit('cancel')"
        >{{ t("calc.fineTune.raiseReport.cancel") }}</button>
        <button
          ref="okRef"
          class="btn btn--primary fineTuneReport__ok"
          type="button"
          data-testid="fine-tune-raise-report-ok"
          @click="emit('close')"
        >{{ t("calc.fineTune.raiseReport.ok") }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { raiseHeadline, type BeforeAfter, type RaiseOption } from "../domain/fine-tune/raise";
import type { UniversalCandyStock } from "../domain/level-planner/types";
import { useFocusTrap } from "../composables/useFocusTrap";
import { deltaText, SPARKLE_PATH } from "../utils/fineTuneView";

/**
 * 「全体のLvを伸ばす」で伸びたときの小窓。見出しは「〇〇の到達Lvが上がりました」（ほかにも上がった行があれば「〇〇など」）、
 * Lvの上がった行が無ければ「〇〇の経験値が増えました」（`raiseHeadline`）。
 * 変わった行ごとに、到達Lv・あとEXP（それぞれの列に前 → 後）と、伸ばす前からのアメブ・アメ合計・かけらの増減を
 * 表の形（列の見出しは1回、どの行も同じ列）で出し、最後にアメブ残り・かけら残り・万能アメ残りの前 → 後と増減を出す。
 * 減った行が出した側、増えた行が受け取った側（誰の分が誰へ回ったかは、ソルバーが上から順に配るので決まらない）。
 * 増減の数字に良し悪しの色は付けない（かけらの増は費用、アメブの減は出した側で、行によって良し悪しが逆になる）。
 * 色を付けるのは到達点（到達Lv・あとEXP）が変わったところだけで、到達点が良くなった行には下地を敷く。
 * アメ節約・かけら節約で結果が違うときは、上にタブを出す（`options` が2つ）。選ぶと親が下書きをその結果に替える。
 * かけら節約は親が裏で求める。その間（`pending`）は押せない「計算中」のタブを出す。
 * OK・外を押す・Escape（親）で、伸ばした結果のまま閉じる。キャンセルは押す前の下書きへ戻して閉じる（親）。
 */
const props = defineProps<{
  /** 伸ばした結果の通り（結果が同じなら1つ） */
  options: readonly RaiseOption[];
  /** 下書きに入っている通り */
  selected: number;
  /** 残りの節約するもの（かけら節約）を裏で求めている間 */
  pending: boolean;
  fmt: (n: number) => string;
}>();

const emit = defineEmits<{
  (e: "select", index: number): void;
  (e: "close"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const id = useId();
const titleId = `${id}-title`;
const tabId = `${id}-tab`;
const panelId = `${id}-panel`;
const rootRef = ref<HTMLElement | null>(null);
const okRef = ref<HTMLButtonElement | null>(null);
useFocusTrap(rootRef, { initialFocus: () => okRef.value });

/** タブを出すか（通りが2つ、またはかけら節約を求めている間） */
const tabbed = computed(() => props.options.length > 1 || props.pending);

const report = computed(() => (props.options[props.selected] ?? props.options[0]!).report);

function savingLabel(option: RaiseOption): string {
  return option.savings[0] === "shards" ? t("calc.fineTune.raiseReport.savingShards") : t("calc.fineTune.raiseReport.savingCandy");
}

/** タブの ← → で隣の通りを選び、フォーカスも移す（タブの並びの決まり） */
function onTabKeydown(event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const count = props.options.length;
  const next = (props.selected + (event.key === "ArrowRight" ? 1 : count - 1)) % count;
  emit("select", next);
  document.getElementById(`${tabId}-${next}`)?.focus();
}

const title = computed(() => {
  const headline = raiseHeadline(report.value);
  if (headline.kind === "levelUp") {
    return t(headline.others ? "calc.fineTune.raiseReport.levelUpMany" : "calc.fineTune.raiseReport.levelUp", { name: headline.title });
  }
  if (headline.kind === "expGained") return t("calc.fineTune.raiseReport.expGained", { name: headline.title });
  return t("calc.fineTune.raiseReport.adjusted");
});

type DeltaKey = "boost" | "candy" | "shards";

/** 到達Lv・あとEXP と、そのあとに並ぶ増減の列（見出しは本体の表と同じ呼び名） */
const columns = computed(() => [
  { key: "level", label: t("calc.fineTune.raiseReport.level") },
  { key: "expLeft", label: t("calc.fineTune.raiseReport.expLeft") },
  { key: "boost", label: t("calc.fineTune.col.boost") },
  { key: "candy", label: t("calc.fineTune.col.candyTotal") },
  { key: "shards", label: t("calc.fineTune.raiseReport.shards") },
]);

/** あとEXP の前 → 後。無い（Lv70）ときは「—」（前後とも無ければ after も null で、欄は「—」） */
function expLeftView(v: BeforeAfter<number | null>): { before: string; after: string | null; changed: boolean } {
  const text = (n: number | null) => (n === null ? "—" : props.fmt(n));
  return { before: text(v.before), after: v.after === null && v.before === null ? null : text(v.after), changed: v.before !== v.after };
}

/** 増減（変わっていなければ null） */
function delta(v: BeforeAfter<number>): string | null {
  return deltaText(v.before, v.after, props.fmt);
}

const rows = computed(() => report.value.rows.map((change) => {
  const { before, after } = change.level;
  const dir = after > before ? "up" : after < before ? "down" : "same";
  const deltas: { key: DeltaKey; text: string | null }[] = [
    { key: "boost", text: delta(change.boost) },
    { key: "candy", text: delta(change.candy) },
    { key: "shards", text: delta(change.shards) },
  ];
  return { rowId: change.rowId, name: change.title, level: { before, after, dir }, expLeft: expLeftView(change.expLeft), reach: change.reach, deltas };
}));

/** 万能アメの S・M・L の個数（在庫の欄と同じ並び） */
function universalText(v: UniversalCandyStock): string {
  return `S${props.fmt(v.s)} M${props.fmt(v.m)} L${props.fmt(v.l)}`;
}

/**
 * アメブ残り・かけら残り・万能アメ残り・全員のアメ合計（変わったものだけ）。上部のサマリーと同じ数字が出るよう、前 → 後も添える。
 * 万能アメは全員で分け合う在庫なので、行ごとではなく残りの合計で出す。S・M・L の3つを1つの増減にできないので、増減の札は付けない。
 * アメ合計は、アメ節約とかけら節約のタブを見比べるのに使う
 */
const remaining = computed(() => {
  const items: { key: string; label: string; before: string; after: string; delta: string }[] = [];
  const push = (key: string, label: string, value: BeforeAfter<number>) => {
    const delta = deltaText(value.before, value.after, props.fmt);
    if (delta !== null) items.push({ key, label, before: props.fmt(value.before), after: props.fmt(value.after), delta });
  };
  push("boostRemaining", t("calc.fineTune.summary.boostRemaining"), report.value.boostRemaining);
  push("shardsRemaining", t("calc.fineTune.summary.shardsRemaining"), report.value.shardsRemaining);
  const universal = report.value.universalRemaining;
  if (universal.before.s !== universal.after.s || universal.before.m !== universal.after.m || universal.before.l !== universal.after.l) {
    items.push({
      key: "universalRemaining",
      label: t("calc.fineTune.raiseReport.universalRemaining"),
      before: universalText(universal.before),
      after: universalText(universal.after),
      delta: "",
    });
  }
  push("candyUsed", t("calc.fineTune.raiseReport.candyUsed"), report.value.candyUsed);
  return items;
});

/**
 * 残りの段の欄の幅（文字数。CSS で `ch` に直す）。どの行も、前の値・後の値・増減の札をいちばん長い行の幅にそろえる。
 * 幅は CSS で最小幅でなく決まった幅にし、1文字ぶん余らせる。字体によっては数字が等幅（`tabular-nums`）にならず、
 * 符号（+ と −）の幅も `ch` とそろわないので、中身で欄が広がると行ごとに端がずれるため
 */
const remainingWidths = computed(() => {
  const longest = (pick: (item: (typeof remaining.value)[number]) => string) => Math.max(0, ...remaining.value.map((item) => pick(item).length));
  return {
    "--rem-before": String(longest((item) => item.before)),
    "--rem-after": String(longest((item) => item.after)),
    "--rem-delta": String(longest((item) => item.delta)),
  };
});
</script>
