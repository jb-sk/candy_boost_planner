<template>
  <div class="modal-overlay eventHistory-overlay" @click.self="$emit('close')">
    <div class="modal eventHistoryModal" role="dialog" aria-modal="true" :aria-label="t('eventHistory.title')">
      <header class="modal__header">
        <h2 class="modal__title">{{ t("eventHistory.title") }}</h2>
        <button class="modal__close" type="button" @click="$emit('close')" :aria-label="t('common.close')">×</button>
      </header>
      <div class="modal__body">
        <!-- 全期間と直近1年の2段。直近1年は仮イベントの写し元と同じ窓なので、
             「仮イベントが少ない」理由もここで読める -->
        <dl class="eventHistory__counts" data-testid="event-history-count">
          <div v-for="row in view.counts" :key="row.label" class="eventHistory__countRow">
            <dt>{{ row.label }}</dt>
            <dd>
              {{ row.text }}
              <span v-if="row.range" class="eventHistory__countRange">（{{ row.range }}）</span>
            </dd>
          </div>
        </dl>

        <div class="eventHistory__tableWrap">
          <table class="eventHistory__table" data-testid="event-history-table">
            <thead>
              <tr>
                <th>{{ t("eventHistory.colPeriod") }}</th>
                <th>{{ t("eventHistory.colEvent") }}</th>
                <th>{{ t("eventHistory.colSleepExp") }}</th>
                <th>{{ t("eventHistory.colBoost") }}</th>
              </tr>
            </thead>
            <!-- 年ごとに tbody を分け、先頭へその年の合計を出す -->
            <tbody v-for="group in view.groups" :key="group.year">
              <tr class="eventHistory__yearRow" data-testid="event-history-year">
                <th scope="rowgroup" class="eventHistory__year"><span class="eventHistory__yearBadge">{{ group.year }}</span></th>
                <!-- 列見出しが消える狭い画面のために列名を添える（表レイアウトではCSSで隠す） -->
                <td v-for="cell in group.summary" :key="cell.label" class="eventHistory__yearSummary">
                  <span class="eventHistory__yearLabel">{{ cell.label }}</span>{{ cell.value }}
                </td>
              </tr>
              <tr v-for="row in group.rows" :key="row.key" data-testid="event-history-row">
                <td class="eventHistory__period">{{ row.period }}</td>
                <td class="eventHistory__name">{{ row.name }}</td>
                <td class="eventHistory__exp">
                  <!-- 週の断りとチップの順は CSS が入れ替える（狭い画面は右寄せなので断り→チップ、
                       表では左寄せなのでチップ→断り）。DOMの順は狭い画面のほう -->
                  <div v-for="line in row.expLines" :key="line.tag" class="eventHistory__expLine">
                    <span class="eventHistory__weekTag">{{ line.tag }}</span>
                    <span class="eventHistory__chip" :class="line.flower ? 'eventHistory__chip--flower' : 'eventHistory__chip--exp'">
                      <span v-if="line.flower" aria-hidden="true">🌸</span> ×{{ line.multiplier }}
                    </span>
                  </div>
                </td>
                <td class="eventHistory__boost">
                  <span v-if="row.boost" class="eventHistory__chip" :class="`eventHistory__chip--${row.boost.kind}`">{{ row.boost.label }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="eventHistory__note">{{ t("eventHistory.noteGsd") }}</p>
        <p class="eventHistory__note">{{ t("eventHistory.noteAnniversary") }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { eventHistory, sleepExpEventFlowers, wikiKnownThrough } from "../domain/pokesleep/_generated/sleep-exp-events";
import type { GameDate } from "../domain/pokesleep/game-date";
import { normalizeLocale } from "../i18n";
import { buildEventHistoryView } from "../utils/eventHistoryView";

const { t, locale } = useI18n();

/** 表示モデルの組み立ては `eventHistoryView.ts`（純関数）。ここは生成物を渡して描くだけ */
const view = computed(() =>
  buildEventHistoryView({
    history: eventHistory,
    flowers: sleepExpEventFlowers,
    cutoffDate: wikiKnownThrough as GameDate,
    t,
    locale: normalizeLocale(locale.value),
  }),
);

// ESCキーで閉じる
const emit = defineEmits<{ (e: "close"): void }>();
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
</script>
