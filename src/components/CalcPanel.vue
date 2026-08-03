<template>
  <section id="neo-calc" class="panel panel--calc" data-scroll-anchor="panel:calc">
    <div class="panel__head">
      <h2 class="panel__title">{{ t("calc.title") }}</h2>
    </div>

    <div class="calcSticky">
      <div class="calcSticky__summary" data-testid="calc-sticky-summary" @click="stickyExpanded = !stickyExpanded">
        <span class="calcSticky__toggle">{{ stickyExpanded ? '▼' : '▶' }}</span>
        <div class="calcSticky__summaryBody" :aria-busy="calc.planResultPending.value ? 'true' : undefined">
          <button v-if="showNoStockWarning" type="button" class="calcSticky__noStock" @click.stop="$emit('open-settings')">{{ t("calc.export.noStockWarning") }}</button>
          <span
            v-if="calc.boostKind.value !== 'none'"
            class="calcSumInline calcSumInline--boostTotal"
            :class="{
              'calcSumInline--boostTotalMini': calc.boostKind.value === 'mini',
              'calcSumInline--danger': calc.boostCandyOver.value > 0,
            }"
          >
            <span class="calcSumInline__k">{{ t("calc.export.sumBoostTotal") }}</span>
            <span class="calcSumInline__v">{{ calc.planResult.value ? calc.fmtNum(calc.totalBoostCandyUsed.value) : '-' }}</span>
          </span>
          <span
            v-if="calc.boostKind.value !== 'none' && calc.rowsView.value.length > 0 && (!calc.planResult.value || calc.boostCandyUnused.value > 0)"
            class="calcSumInline calcSumInline--unused"
            :class="{ 'calcSumInline--danger': calc.planResult.value && calc.boostCandyUnused.value > 0 }"
          >
            <span class="calcSumInline__k">{{ t("calc.export.sumBoostUnused") }}</span>
            <span class="calcSumInline__v">{{ calc.planResult.value ? calc.fmtNum(calc.boostCandyUnused.value) : '-' }}</span>
          </span>
          <!--
            指定したのに枠が回らなかったアメブの合計（行ごとの不足の総和）。
            boostCandyOver は「実使用 − 上限」でソルバーが必ず上限内に収めるため常に0以下になり、
            全体で枠が足りない状態を表現できない。超過時だけ出す。
          -->
          <span
            v-if="calc.boostKind.value !== 'none' && calc.boostCandyShortageTotal.value > 0"
            class="calcSumInline calcSumInline--boostShortage calcSumInline--danger"
          >
            <span class="calcSumInline__k">{{ t("calc.export.sumBoostShortage") }}</span>
            <span class="calcSumInline__v">{{ calc.fmtNum(calc.boostCandyShortageTotal.value) }}</span>
          </span>
          <span class="calcSumInline calcSumInline--shards" :class="{ 'calcSumInline--danger': calc.shardsOver.value > 0 }">
            <span class="calcSumInline__k">{{ t("calc.shardsTotal") }}</span>
            <span class="calcSumInline__v">{{ calc.planResult.value ? calc.fmtNum(calc.totalShardsUsed.value) : '-' }}</span>
          </span>
          <template v-if="calc.rowsView.value.length > 0">
            <span class="calcSumInline calcSumInline--candy calcSumInline--candyS" :class="{ 'calcSumInline--danger': calc.planResult.value && calc.universalCandyNeeded.value.s > candyStore.universalCandy.value.s }">
              <span class="calcSumInline__k">{{ t("calc.candy.universalSummaryS") }}</span>
              <span class="calcSumInline__v">{{ calc.planResult.value ? calc.universalCandyNeeded.value.s : '-' }}/{{ candyStore.universalCandy.value.s }}</span>
            </span>
            <span class="calcSumInline calcSumInline--candy calcSumInline--candyM" :class="{ 'calcSumInline--danger': calc.planResult.value && calc.universalCandyNeeded.value.m > candyStore.universalCandy.value.m }">
              <span class="calcSumInline__k">M</span>
              <span class="calcSumInline__v">{{ calc.planResult.value ? calc.universalCandyNeeded.value.m : '-' }}/{{ candyStore.universalCandy.value.m }}</span>
            </span>
            <span class="calcSumInline calcSumInline--candy calcSumInline--candyL" :class="{ 'calcSumInline--danger': calc.planResult.value && calc.universalCandyNeeded.value.l > candyStore.universalCandy.value.l }">
              <span class="calcSumInline__k">L</span>
              <span class="calcSumInline__v">{{ calc.planResult.value ? calc.universalCandyNeeded.value.l : '-' }}/{{ candyStore.universalCandy.value.l }}</span>
            </span>
          </template>
        </div>
      </div>
      <div
        v-if="stickyExpanded"
        class="calcSum calcSum--bar calcSum--sparkle"
        :class="{
          'calcSum--danger': calc.shardsOver.value > 0 || calc.boostCandyOver.value > 0,
          'calcSum--muted': calc.shardsCap.value <= 0,
        }"
      >
        <div class="calcBarBlock calcBarBlock--candy" data-testid="calc-boost-candy-block" v-if="calc.boostKind.value !== 'none'" :class="{ 'calcBarBlock--danger': calc.boostCandyOver.value > 0 }">
          <div class="calcSum__head">
            <div class="calcSum__k">
              <span class="calcSum__kText">
                {{ t("calc.boostCandyUsage", { pct: calc.boostCandyUsagePctRounded.value }) }}
                <span v-if="calc.showBoostCandyFire.value" aria-hidden="true"> 🔥</span>
              </span>
              <span v-if="calc.boostCandyOver.value > 0" class="calcSum__overVal"> (+{{ calc.fmtNum(calc.boostCandyOver.value) }})</span>
            </div>
            <span v-if="calc.activeRowId.value && calc.activeRowBoostCandyUsed.value > 0" class="calcSum__selectedVal">{{ t("calc.selectedUsage", { pct: calc.activeRowBoostCandyUsagePct.value }) }}</span>
            <div class="calcSum__k calcSum__k--right">
              {{ t("calc.cap", { cap: calc.fmtNum(calc.boostCandyCap.value) }) }}
            </div>
          </div>
          <div
            class="calcBar"
            data-testid="calc-boost-candy-bar"
            role="progressbar"
            :aria-valuenow="Math.max(0, calc.totalBoostCandyUsed.value)"
            aria-valuemin="0"
            :aria-valuemax="Math.max(1, calc.boostCandyCap.value)"
            :aria-label="t('calc.boostCandyUsageAria', { pct: calc.boostCandyUsagePctRounded.value, cap: calc.fmtNum(calc.boostCandyCap.value) })"
          >
            <div class="calcBar__track">
              <!-- 選択中ポケモン分 -->
              <div class="calcBar__fill calcBar__fill--candy calcBar__fill--active" :style="{ width: `${calc.activeRowBoostCandyFillPct.value}%` }"></div>
              <!-- 他ポケモン分 -->
              <div class="calcBar__fill calcBar__fill--candy calcBar__fill--others" :style="{ width: `${calc.otherRowsBoostCandyFillPct.value}%` }"></div>
              <!-- 超過分 -->
              <div
                v-if="calc.boostCandyOver.value > 0 && calc.boostCandyCap.value > 0"
                class="calcBar__over"
                :style="{ width: `${calc.boostCandyOverPctForBar.value}%` }"
              ></div>
            </div>
          </div>
        </div>

        <div class="calcBarBlock" data-testid="calc-shards-block">
          <div class="calcSum__head">
            <div class="calcSum__k">
              <span class="calcSum__kText">
                {{
                  calc.shardsCap.value > 0
                    ? t("calc.shardsUsage", { pct: calc.shardsUsagePctRounded.value })
                    : t("calc.shardsUsageDash")
                }}
                <span v-if="calc.showShardsFire.value" aria-hidden="true"> 🔥</span>
              </span>
              <span v-if="calc.shardsOver.value > 0" class="calcSum__overVal"> (+{{ calc.fmtNum(calc.shardsOver.value) }})</span>
            </div>
            <span v-if="calc.activeRowId.value && calc.activeRowShardsUsed.value > 0" class="calcSum__selectedVal">{{ t("calc.selectedUsage", { pct: calc.activeRowShardsUsagePct.value }) }}</span>
            <div class="calcSum__k calcSum__k--right">
              {{ calc.shardsCap.value > 0 ? t("calc.cap", { cap: calc.fmtNum(calc.shardsCap.value) }) : t("calc.capUnset") }}
            </div>
          </div>
          <div
            class="calcBar"
            data-testid="calc-shards-bar"
            role="progressbar"
            :aria-valuenow="Math.max(0, calc.totalShardsUsed.value)"
            aria-valuemin="0"
            :aria-valuemax="Math.max(1, calc.shardsCap.value)"
            :aria-label="
              calc.shardsCap.value > 0
                ? t('calc.shardsUsageAria', { pct: calc.shardsUsagePctRounded.value, cap: calc.fmtNum(calc.shardsCap.value) })
                : t('calc.shardsCapUnsetAria')
            "
          >
            <div class="calcBar__track">
              <!-- 選択中ポケモン分 -->
              <div class="calcBar__fill calcBar__fill--active" :style="{ width: `${calc.activeRowShardsFillPct.value}%` }"></div>
              <!-- 他ポケモン分 -->
              <div class="calcBar__fill calcBar__fill--others" :style="{ width: `${calc.otherRowsShardsFillPct.value}%` }"></div>
              <!-- 超過分 -->
              <div
                v-if="calc.shardsOver.value > 0 && calc.shardsCap.value > 0"
                class="calcBar__over"
                :style="{ width: `${calc.shardsOverPctForBar.value}%` }"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="calcActions" data-testid="calc-actions">
      <div class="calcActions__group">
        <button class="btn btn--icon" :class="calc.canUndo.value ? 'btn--primary' : 'btn--ghost'" data-testid="calc-undo-button" type="button" @click="calc.undo()" :disabled="!calc.canUndo.value" :title="t('common.undo')" :aria-label="t('common.undo')">
          <span class="btn__icon" v-html="iconUndoSvg" aria-hidden="true"></span>
        </button>
        <button class="btn btn--icon" :class="calc.canRedo.value ? 'btn--primary' : 'btn--ghost'" data-testid="calc-redo-button" type="button" @click="calc.redo()" :disabled="!calc.canRedo.value" :title="t('common.redo')" :aria-label="t('common.redo')">
          <span class="btn__icon" v-html="iconRedoSvg" aria-hidden="true"></span>
        </button>
      </div>
      <button class="btn btn--primary calcActions__settings" data-testid="settings-open-button-desktop" data-onboarding="settings" type="button" @click="$emit('open-settings')" :title="t('common.settings')">
        {{ t("common.settingsShort") }}
      </button>
      <button class="btn btn--primary" data-testid="calc-export-button" type="button" @click="calc.openExport()" :disabled="!calc.rowsView.value.length || calc.planResultPending.value || !calc.planResult.value" :title="t('calc.export.open')">
        {{ t("calc.export.openShort") }}
      </button>
      <button v-if="calc.debugExportEnabled" class="btn btn--ghost" data-testid="calc-debug-export-button" type="button" @click="copyDebugExport()" :disabled="!calc.rowsView.value.length || calc.planResultPending.value || !calc.planResult.value" title="検算用TSVをコピー">
        検算TSV
      </button>
      <button v-if="calc.showManualExactVerification.value" class="btn btn--ghost" data-testid="calc-manual-exact-button" type="button" @click="calc.runManualExactVerification()" :disabled="calc.planResultPending.value || !calc.planResult.value" :title="t('calc.manualExactVerification')">
        {{ t("calc.manualExactVerification") }}
      </button>
      <span v-if="debugExportStatus" class="calcActions__status" data-testid="calc-debug-export-status">{{ debugExportStatus }}</span>
      <button class="btn btn--ghost" data-testid="calc-clear-button" type="button" @click="calc.clear()" :disabled="!calc.rowsView.value.length" :title="t('calc.clearPokemons')">
        {{ t("calc.clearPokemonsShort") }}
      </button>
      <!-- 並べ替え・上位削除のあと「最初から考え直す」ための入口。破壊的な全体操作なので
           クリアの隣に置く（コピー／ペーストのグループへは入れない）。
           アメブなしの種別では配るものが無いので出さない。 -->
      <button
        v-if="calc.boostKind.value !== 'none'"
        class="btn btn--ghost"
        data-testid="calc-reassign-boost-button"
        type="button"
        @click="calc.resetAllBoostCandy()"
        :disabled="!calc.rowsView.value.length"
        :title="t('calc.reassignBoostTitle')"
      >
        {{ t("calc.reassignBoost") }}
      </button>
      <div class="calcActions__group">
        <button class="btn btn--ghost" data-testid="calc-copy-slot-button" type="button" @click="calc.copySlot()" :disabled="!calc.canCopySlot.value" :title="t('calc.copySlotTitle')">
          {{ t("calc.copySlot") }}
        </button>
        <button class="btn btn--ghost" data-testid="calc-paste-slot-button" type="button" @click="calc.pasteSlot()" :disabled="!calc.canPasteSlot.value" :title="t('calc.pasteSlotTitle')">
          {{ t("calc.pasteSlot") }}
        </button>
      </div>
    </div>

    <div v-if="calc.showFastCalculation.value" class="calcPlanStatus" data-testid="calc-plan-status" role="status">
      <span>{{ t("calc.fastCalculation") }}</span>
      <span v-if="calc.showExactImprovementHint.value">{{ t("calc.fastCalculationHint") }}</span>
    </div>

    <div class="calcSlots">
      <div class="slotTabs" data-testid="calc-slot-tabs">
        <template v-for="i in 3" :key="i">
          <!-- 選択中タブ: セレクター -->
          <div
            v-if="calc.activeSlotTab.value === i - 1"
            class="slotTab slotTab--active"
            :class="tabDragClass(i - 1)"
            data-testid="calc-slot-tab-active"
            @pointerdown="onTabPointerDown(i - 1, $event)"
            @pointermove="onTabPointerMove($event)"
            @pointerup="onTabPointerUp($event)"
            @pointercancel="onTabPointerCancel($event)"
          >
            <select
              class="slotTab__select"
              data-testid="calc-boost-kind-select"
              :value="calc.boostKind.value"
              @change="calc.setSlotBoostKind(($event.target as HTMLSelectElement).value as BoostEvent)"
            >
              <option value="full">{{ calc.fullLabel.value }}</option>
              <option value="mini">{{ calc.miniLabel.value }}</option>
              <option value="none">{{ calc.noneLabel.value }}</option>
            </select>
          </div>
          <!-- 非選択タブ: テキスト表示 -->
          <button
            v-else
            class="slotTab"
            :class="tabDragClass(i - 1)"
            data-testid="calc-slot-tab"
            @click="!tabDragging && calc.switchToSlot(i - 1)"
            @pointerdown="onTabPointerDown(i - 1, $event)"
            @pointermove="onTabPointerMove($event)"
            @pointerup="onTabPointerUp($event)"
            @pointercancel="onTabPointerCancel($event)"
          >
            {{ getSlotBoostKindLabel(i - 1) }}
          </button>
        </template>
      </div>
    </div>

    <!-- コンテンツエリアのラッパー -->
    <div class="calcSlotContainer">
      <div class="calcRows" data-testid="calc-rows" v-if="calc.rowsView.value.length">
      <div
        v-for="(r, rowIdx) in calc.rowsView.value"
        :key="r.id"
        class="calcRow"
        data-testid="calc-row"
        :data-scroll-anchor="`calc-row:${r.id}`"
        :class="{
          'calcRow--active': r.id === calc.activeRowId.value,
          'calcRow--dragOver': r.id === calc.dragOverRowId.value,
          'calcRow--dragging': r.id === calc.dragRowId.value,
        }"
        @click="calc.activeRowId.value = r.id"
      >
        <div class="calcRow__head">
          <div class="calcRow__headLeft">
            <button
              data-testid="dragHandle"
              class="btn btn--ghost btn--xs calcRow__dragHandle"
              type="button"
              :title="t('calc.row.dragReorder')"
              :aria-label="t('calc.row.dragReorder')"
              @pointerdown="onRowPointerDown(r.id, $event)"
              @click.stop
            >
              <svg class="calcRow__dragIcon" aria-hidden="true" viewBox="0 0 16 17" width="14" height="15"><path d="M4.5 5.5L8 2 11.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 11.5L8 15 11.5 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <NatureSelect
              class="calcRow__natureSelect"
              compact
              :model-value="r.nature"
              :caption="t('calc.row.natureCaption')"
              :label="t('calc.row.nature')"
              :label-normal="t('calc.row.natureNormal')"
              :label-up="t('calc.row.natureUp')"
              :label-down="t('calc.row.natureDown')"
              @update:model-value="calc.setNature(r.id, $event)"
              @click.stop
            />
            <div class="calcRow__title">{{ r.title }}</div>
          </div>
          <div class="calcRow__headRight">
            <button data-testid="moveUpBtn" class="linkBtn" type="button" @click.stop="calc.moveRowUp(r.id)" :disabled="!calc.canMoveRowUp(r.id)">↑</button>
            <button data-testid="moveDownBtn" class="linkBtn" type="button" @click.stop="calc.moveRowDown(r.id)" :disabled="!calc.canMoveRowDown(r.id)">↓</button>
            <button
              v-if="r.boxId"
              data-testid="applyToBoxBtn"
              class="linkBtn"
              :class="{ 'linkBtn--done': applyFlashMap.has(r.id) }"
              type="button"
              @click.stop="onApplyToBoxWithFlash(r.id)"
              :title="t('calc.applyToBoxTitle')"
            >
              {{ applyFlashMap.has(r.id) ? `✓ ${t("status.reflected")}` : t("calc.applyToBox") }}
            </button>
            <button data-testid="deleteBtn" class="linkBtn linkBtn--danger" type="button" @click.stop="calc.removeRowById(r.id)">{{ t("common.delete") }}</button>
          </div>
        </div>

        <div class="calcRow__grid" :class="{ 'calcRow__grid--normal': calc.boostKind.value === 'none' }">
          <div class="field field--sm">
            <span class="field__label">{{ t("calc.row.srcLevel") }}</span>
            <LevelPicker
              data-testid="srcLevel"
              :model-value="r.srcLevel"
              @update:model-value="calc.setSrcLevel(r.id, $event)"
              :label="`${t('calc.row.srcLevel')}: Lv${r.srcLevel}`"
              :max="r.dstLevel"
            />
          </div>

          <label class="field field--sm">
            <span class="field__label">{{ t("calc.row.expRemaining") }}</span>
            <input
              data-testid="expRemaining"
              :value="expRemainingInputValue(r)"
              type="number"
              min="1"
              class="field__input"
              :placeholder="t('calc.row.expRemainingPh')"
              @focus="onExpRemainingFocus(r)"
              @blur="onExpRemainingBlur(r)"
              @input="onExpRemainingDraftInput(r.id, ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
          </label>

          <div class="field field--sm">
            <span class="field__label">
              {{ t("calc.row.dstLevel") }}
              <!-- あとEXPは行データから同期計算する（§10.10）。planner を待たないので段差が出ない -->
              <span v-if="r.targetExpToNextLevel > 0" style="font-weight:normal; margin-left:4px; opacity:0.8">
                {{ t("calc.row.expLeftNext", { exp: calc.fmtNum(r.targetExpToNextLevel) }) }}
              </span>
            </span>
            <LevelPicker
              data-testid="dstLevel"
              :model-value="r.dstLevel"
              @update:model-value="calc.setDstLevel(r.id, $event)"
              :label="`${t('calc.row.dstLevel')}: Lv${r.dstLevel}`"
              :min="r.srcLevel"
              :max="MAX_LEVEL"
            >
              <!-- ラベル名は現在Lvピッカー（スロット未使用＝既定の label 表示）と形式を揃える -->
              <template #title>
                {{ t("calc.row.dstLevel") }}: Lv{{ r.srcLevel }} → Lv{{ r.dstLevel }}
                <span v-if="rowShortage(r).targetPickerLabel" class="levelPick__shortage">{{ rowShortage(r).targetPickerLabel }}</span>
              </template>
            </LevelPicker>
          </div>
          <label class="field field--sm" v-if="getRowPokedexId(r)">
            <span class="field__label">{{ t("calc.row.speciesCandy") }}</span>
            <input
              data-testid="speciesCandy"
              type="number"
              min="0"
              class="field__input"
              :value="speciesCandyInputValue(getRowPokedexId(r)!)"
              @focus="onSpeciesCandyFocus(getRowPokedexId(r)!)"
              @input="onSpeciesCandyDraftInput(getRowPokedexId(r)!, ($event.target as HTMLInputElement).value)"
              @blur="onSpeciesCandyBlur(getRowPokedexId(r)!)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
          </label>

          <div class="field field--sm" v-if="calc.boostKind.value !== 'none'">
            <span class="field__label">{{ t("calc.row.boostReachLevel") }}</span>
            <LevelPicker
              data-testid="boostReachLevel"
              :model-value="r.ui.boostReachLevel"
              @update:model-value="calc.setBoostLevel(r.id, $event)"
              :label="`${t('calc.row.boostReachLevel')}: Lv${r.ui.boostReachLevel}`"
              :min="r.srcLevel"
              :max="r.ui.boostReachLevelMax"
              :disabled="r.ui.boostInputDisabled"
              :note="r.sleepTargetMode === 'all'
                ? t('calc.row.sleepTargetAllHint')
                : (r.ui.boostSleepCapActive ? t('calc.row.boostSleepCapHint', { level: r.ui.boostReachLevelMax }) : undefined)"
              :alert="r.ui.boostQuotaViolation === 'reach' ? boostQuotaHint(r) : undefined"
              :class="{
                'levelPick--sleepCapped': r.ui.boostSleepCapped,
                'levelPick--allSleep': r.sleepTargetMode === 'all',
                'levelPick--overQuota': r.ui.boostQuotaViolation === 'reach',
              }"
              :title="r.ui.boostSleepCapped
                ? t('calc.row.boostSleepCapHint', { level: r.ui.boostReachLevelMax })
                : (r.ui.boostQuotaViolation === 'reach' ? boostQuotaHint(r) : undefined)"
            >
              <template #title>
                {{ t("calc.row.boostReachLevel") }}: Lv{{ r.srcLevel }} → Lv{{ r.ui.boostReachLevel }}
                <!-- この欄にかかっている制限を、不足ラベルと同じ位置で先に知らせる。
                     詳しい打ち手は下の alert（常時）と note（上限に届いたときだけ）。
                     **マークは1つだけ出す。** 制限が2つ重なったときに ⚠️ が並ぶと誤字に見える。 -->
                <span
                  v-if="boostReachWarnings(r).length"
                  class="levelPick__capWarn"
                  data-testid="level-picker-warn"
                  :title="boostReachWarnings(r).join('\n')"
                >⚠️</span>
                <span v-if="rowShortage(r).boostPickerLabel" class="levelPick__shortage">{{ rowShortage(r).boostPickerLabel }}</span>
              </template>
            </LevelPicker>
          </div>
          <div class="field field--sm" v-if="calc.boostKind.value !== 'none'">
            <div class="field__labelRow">
              <span class="field__label">{{ t("calc.row.boostCandyCount") }}</span>
              <button
                data-testid="hintBtn"
                type="button"
                class="hintIcon"
                @click.stop.prevent="showHint($event, r)"
              >?</button>
              <button
                data-testid="boostCandyReset"
                type="button"
                class="hintIcon hintIcon--reset"
                style="margin-left: 4px;"
                :aria-label="t('calc.row.boostCandyCountReset')"
                :title="t('calc.row.boostCandyCountReset')"
                :disabled="r.sleepTargetMode === 'all'"
                @click.stop.prevent="calc.resetRowBoostCandy(r.id)"
              ><svg class="hintIcon__resetSvg" style="pointer-events: none;" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v4h4"/><path d="M3 7a5.5 5.5 0 1 1 1 4"/></svg></button>
            </div>
            <!--
              アメブ上限を超えた個数はそのまま残す（「目標まで」行を理論値として使うため）。
              使えない分は到達可能行で通常アメに置き換わるので、入力欄でも超過を示し、
              隣の ? から上限を変更できることへ誘導する。
            -->
            <!--
              睡眠EXPだけで目標に届く行は入力させない（アメブ目標Lvと同じ扱い）。
              上限0の欄を編集可能にすると、何を打っても「明示的に0個」が確定してしまう。
              上限が 1 以上ある行は、その範囲内なら今までどおり入力できる。
            -->
            <input
              data-testid="boostCandyCount"
              :value="boostCandyInputValue(r)"
              :placeholder="String(r.ui.boostCandyInput)"
              type="number"
              min="0"
              :max="r.ui.boostCandyInputMax"
              :disabled="r.ui.boostInputDisabled"
              class="field__input field__input--boostDerived"
              :class="{
                'field__input--overQuota': r.ui.boostQuotaViolation === 'count',
                'field__input--sleepCapped': r.ui.boostSleepCapped,
                'field__input--allSleep': r.sleepTargetMode === 'all',
              }"
              :title="r.ui.boostSleepCapped
                ? t('calc.row.boostSleepCapHint', { level: r.ui.boostReachLevelMax })
                : (r.ui.boostQuotaViolation === 'count' ? boostQuotaHint(r) : undefined)"
              :aria-invalid="r.ui.boostQuotaViolation === 'count' ? 'true' : undefined"
              @focus="onBoostCandyFocus(r)"
              @input="onBoostCandyDraftInput(r, $event)"
              @blur="onBoostCandyBlur(r)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
          </div>
          <div class="field field--sm">
            <!-- label ではなく div。ヒントボタンを label 内に置くと、押した時点で
                 入力欄へフォーカスが移ってしまう（アメブ個数欄と同じ構造にする）。 -->
            <div class="field__labelRow">
              <span class="field__label">{{ t("calc.row.candyTarget") }}</span>
              <button
                data-testid="candyTargetHintBtn"
                type="button"
                class="hintIcon"
                @click.stop.prevent="showHint($event, r, 'candyTarget')"
              >?</button>
            </div>
            <input
              data-testid="candyTarget"
              type="number"
              min="0"
              class="field__input"
              :class="{ 'field__input--allSleep': r.sleepTargetMode === 'all' }"
              :disabled="r.sleepTargetMode === 'all'"
              :value="candyTargetInputValue(r)"
              :placeholder="t('calc.row.candyTargetNone')"
              @focus="onCandyTargetFocus(r)"
              @blur="onCandyTargetBlur(r)"
              @input="onCandyTargetDraftInput(r.id, ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
          </div>
          <div class="field field--sm">
            <div class="field__labelRow">
              <span class="field__label">{{ t("calc.row.sleepTarget") }}</span>
              <button
                data-testid="sleepTargetCurrentHours"
                type="button"
                class="field__labelLink"
                :title="t('calc.sleep.currentSleepHours')"
                @click.stop="showSleepHint($event, r.id)"
              >{{ t("calc.row.sleepTargetCurrent", { hours: calc.fmtNum(r.sleepHours ?? 0) }) }}</button>
            </div>
            <select
              data-testid="sleepTargetHours"
              class="field__input"
              :value="r.sleepTargetMode ?? r.sleepTargetHours ?? ''"
              @change="onSleepTargetChange(r.id, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t("calc.row.sleepTargetNone") }}</option>
              <option v-for="h in SLEEP_TARGET_HOURS_OPTIONS" :key="h" :value="h">{{ sleepTargetOptionLabel(r, h) }}</option>
              <option value="all">{{ t("calc.row.sleepTargetAll") }}</option>
            </select>
          </div>
        </div>

        <!-- 必要/使用の折りたたみ表示 -->
        <div class="calcRow__resultCollapse">
          <!-- 必要行（クリックで展開） -->
          <div
            data-testid="resultRowRequired"
            :data-onboarding="rowIdx === 0 ? 'result-row' : undefined"
            class="calcRow__resultRow calcRow__resultRow--required"
            :class="{ 'is-expanded': isExpanded(r.id) }"
            @click="toggleExpand(r.id)"
          >
            <span class="calcRow__expandIcon">{{ isExpanded(r.id) ? '▼' : '▶' }}</span>
            <span class="calcRow__resultLabel">{{ t("calc.row.required") }}</span>
              <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'boost') }">{{ calc.fmtNum(rowP(r)?.targetLine.boostedCandyUnits ?? 0) }}</span>
              </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                <span class="calcRow__num">{{ calc.fmtNum(rowP(r)?.targetLine.nonBoostCandyUnits ?? 0) }}</span>
              </span>{{ ' ' }}<span class="calcRow__res">
                <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'candy') }">{{ calc.fmtNum(rowP(r)?.targetLine.totalCandyUnitsUsed ?? 0) }}</span>
              </span>{{ ' ' }}<span class="calcRow__res">
                <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'shards') }">{{ calc.fmtNum(rowP(r)?.targetLine.dreamShardsUsed ?? 0) }}</span>
              </span>{{ ' ' }}<span class="calcRow__res" v-if="hasItemUsage(r)">
                <span class="calcRow__k">{{ t("calc.row.itemRequired") }}</span>
                <span class="calcRow__num calcRow__num--text">
                  <template v-for="(item, idx) in (rowItemUsageMaps.target.get(r.id) ?? [])" :key="idx">
                    <span :class="{ 'calcRow__num--danger': item.isDanger }">{{ item.label }} {{ item.value }}</span>
                    <span v-if="idx < (rowItemUsageMaps.target.get(r.id) ?? []).length - 1">, </span>
                  </template>
                </span>
              </span>{{ ' ' }}<span class="calcRow__res" v-if="getSurplusValue(r, 'target') > 0">
                <span class="calcRow__k">{{ t("calc.candy.surplus") }}</span>
                <span class="calcRow__num">{{ getSurplusValue(r, 'target') }}</span>
              </span>
              <!--
                ★不足表示（アメ不足 / アメブ不足 / かけら不足）をこの「目標まで」行へ足さないこと。★

                「目標まで」は在庫を無視した理論値の行で、不足は在庫と突き合わせた結果である。
                置き場所は「到達可能」行だけ（下の resultRowReachable）。ここに複製すると
                同じ不足が2箇所に散り、片方だけ直る事故になる（設計書§10.10 に前例あり）。

                過去に「折りたたみ時だけ出す」（`!isExpanded(r.id) && …`）形で何度も復活している。
                折りたたむと不足が見えなくなるのが理由だが、その用途は
                レベルピッカーの不足ラベル（`rowLimitingShortageLabel`）とサマリーの「アメブ不足」、
                および折りたたみ時も残る「目標まで」行の赤字（律速要因の項目）が担当する。

                回帰テスト: tests/e2e/07-level-planner-inventory.spec.ts
                「目標まで行には不足を表示しない（折りたたみ・展開のどちらでも）」
              -->
            </span>
          </div>

          <!-- 到達可能行（個数指定行は目標まで行と同値になったため廃止。設計書§4.2） -->
          <div style="display: flex; flex-direction: column; gap: 0;">
            <!-- 使用行（展開時のみ表示） -->
            <div
              v-if="isExpanded(r.id) && rowP(r)"
              data-testid="resultRowReachable"
              class="calcRow__resultRow calcRow__resultRow--used"
            >
              <span class="calcRow__expandIcon" style="visibility: hidden"></span>
              <span class="calcRow__resultLabel">{{ t("calc.row.used") }}</span>
              <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'boost') }">{{ calc.fmtNum(rowP(r)!.reachableLine.boostedCandyUnits) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num">{{ calc.fmtNum(rowP(r)!.reachableLine.nonBoostCandyUnits) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'candy') }">{{ calc.fmtNum(rowP(r)!.reachableLine.totalCandyUnitsUsed) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'shards') }">{{ calc.fmtNum(rowP(r)!.reachableLine.dreamShardsUsed) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="(rowItemUsageMaps.reachable.get(r.id) ?? []).length > 0">
                  <span class="calcRow__k">{{ t("calc.row.itemUsage") }}</span>
                  <span class="calcRow__num calcRow__num--text">
                    <template v-for="(item, idx) in (rowItemUsageMaps.reachable.get(r.id) ?? [])" :key="idx">
                      <span :class="{ 'calcRow__num--danger': item.isDanger }">{{ item.label }} {{ item.value }}</span>
                      <span v-if="idx < (rowItemUsageMaps.reachable.get(r.id) ?? []).length - 1">, </span>
                    </template>
                  </span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="getSurplusValue(r, 'reachable') > 0">
                  <span class="calcRow__k">{{ t("calc.candy.surplus") }}</span>
                  <span class="calcRow__num">{{ getSurplusValue(r, 'reachable') }}</span>
                </span>
                <!-- 不足量（到達Lvの前に表示）。中身は rowShortage() が組み立てる。
                     「目標まで」行へ複製しないこと（RowShortageView の説明を参照） -->
                <template v-for="chip in rowShortage(r).chips" :key="chip.label">
                  {{ ' ' }}<span class="calcRow__res">
                    <span class="calcRow__k calcRow__k--danger">{{ chip.label }}</span>
                    <span class="calcRow__num calcRow__num--danger">{{ chip.value }}</span>
                  </span>
                </template>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k calcRow__k--info">{{ t(calc.rowSleepExpFor(r.id) > 0 ? "calc.row.candyReachedLv" : "calc.row.reachedLv") }}</span>
                  <span class="calcRow__num calcRow__num--info">{{ rowP(r)!.reachableLine.level }}</span>
                  <span class="calcRow__k calcRow__k--info" v-if="rowP(r)!.reachableLine.expToNextLevel > 0" style="margin-left: 4px;">({{ t("calc.row.expRemaining") }}</span>
                  <span class="calcRow__num calcRow__num--info" v-if="rowP(r)!.reachableLine.expToNextLevel > 0">{{ calc.fmtNum(rowP(r)!.reachableLine.expToNextLevel) }}</span><span class="calcRow__k calcRow__k--info" v-if="rowP(r)!.reachableLine.expToNextLevel > 0">)</span>
                </span>
                {{ ' ' }}<span class="calcRow__res" v-if="rowP(r)!.shortage.expToTarget > 0">
                  <span class="calcRow__k calcRow__k--info">{{ t("calc.row.remainingExp") }}</span>
                  <span class="calcRow__num calcRow__num--info">{{ calc.fmtNum(rowP(r)!.shortage.expToTarget) }}</span>
                  <span class="calcRow__sleepTime" v-if="getSleepTimeText(r.id, rowP(r)!.shortage.expToTarget)">
                    {{ getSleepTimeText(r.id, rowP(r)!.shortage.expToTarget) }}
                  </span>
                </span>
                <!--
                  睡眠込みの着地点。**残EXP の後ろに置く**（設計書『睡眠育成の拡張』§3.11）。
                  残EXP の「約96日（1248時間）」は目標Lvへ届く時間、こちらは睡眠目標を寝きった時点で、
                  時間軸が違う。**これから寝る時間を同じ単位で隣に並べて読み分けさせる。**
                  アメ到達Lv の直後へ戻さないこと（時間の対応が読めなくなる）。
                  「あとEXP」は添えない（小数がその役割。§3.8）。
                -->
                {{ ' ' }}<span class="calcRow__res" v-if="getSleepReachLevelText(r)">
                  <span class="calcRow__k calcRow__k--info">{{ t("calc.row.sleepReachedLv") }}</span>
                  <span class="calcRow__num calcRow__num--info">{{ getSleepReachLevelText(r) }}</span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <button class="btn btn--primary calcRows__addBtn" type="button" data-testid="calc-add-pokemon-btn" data-onboarding="add-pokemon" @click="$emit('open-add-modal')">
        + {{ t("addModal.title") }}
      </button>
    </div>
    <div class="calcEmpty" data-testid="calc-empty" v-else>
      <div class="calcEmpty__content">
        <div class="calcEmpty__title">{{ t("addModal.emptyState") }}</div>
        <button class="btn btn--primary btn--lg" type="button" data-testid="calc-empty-add-btn" data-onboarding="add-pokemon" @click="$emit('open-add-modal')">
          {{ t("addModal.emptyAdd") }}
        </button>

        <!-- Onboarding tour: show dummy result row preview so step 3 has a real target -->
        <!--
          ピカチュウ（expType 600, 性格normal）Lv.1→Lv.10、アメブ0個、かけら在庫872 のときの実測値。
          目標まで: 39個 / 1,384かけら（calcExpAndCandyMixed）
          到達可能: 28個 / 872かけら → Lv8 + あとEXP125、残り440EXP（≒5日）
          かけら不足 512 = 1,384 − 872。睡眠5日は onboardingSleepTimeText と一致する。
          結果行の項目・順序は上の実データ行（:426-530）に合わせること。
        -->
        <div v-if="onboardingActive" class="calcEmpty__demo" data-onboarding="result-row">
          <div class="calcRow__title calcEmpty__demoTitle">{{ t("onboarding.demoTitle") }}</div>
          <div class="calcRow__resultCollapse">
            <div class="calcRow__resultRow calcRow__resultRow--required is-expanded">
              <span class="calcRow__expandIcon">▼</span>
              <span class="calcRow__resultLabel">{{ t("calc.row.required") }}</span>
              <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num">0</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num">39</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                  <span class="calcRow__num">39</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num">1,384</span>
                </span>
              </span>
            </div>
            <div class="calcRow__resultRow calcRow__resultRow--used">
              <span class="calcRow__expandIcon" style="visibility: hidden"></span>
              <span class="calcRow__resultLabel">{{ t("calc.row.used") }}</span>
              <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num">0</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num">28</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                  <span class="calcRow__num">28</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num">872</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k calcRow__k--danger">{{ t("calc.row.shardsShortage") }}</span>
                  <span class="calcRow__num calcRow__num--danger">512</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                   <span class="calcRow__k calcRow__k--info">{{ t("calc.row.reachedLv") }}</span>
                   <span class="calcRow__num calcRow__num--info">8</span>
                   <span class="calcRow__k calcRow__k--info" style="margin-left: 4px;">({{ t("calc.row.expRemaining") }}</span>
                   <span class="calcRow__num calcRow__num--info">125</span><span class="calcRow__k calcRow__k--info">)</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                   <span class="calcRow__k calcRow__k--info">{{ t("calc.row.remainingExp") }}</span>
                   <span class="calcRow__num calcRow__num--info">440</span>
                   <span class="calcRow__sleepTime">{{ onboardingSleepTimeText }}</span>
                </span>
              </span>
            </div>
          </div>
          <!-- Inline tooltip for step 3: rendered in normal DOM flow, no fixed positioning -->
          <div v-if="onboardingStep3Active" class="calcEmpty__demoTip">
            <div class="onboarding-tooltip__header">
              <span class="onboarding-tooltip__step">3 / {{ onboardingRef?.totalSteps }}</span>
            </div>
            <h3 v-if="onboardingRef?.step.value?.titleKey" class="onboarding-tooltip__title">{{ t(onboardingRef.step.value.titleKey) }}</h3>
            <p class="onboarding-tooltip__desc">{{ t("onboarding.step3Desc", { action: onboardingActionLabel }) }}</p>
            <div class="onboarding-tooltip__footer">
              <button
                class="btn btn--primary onboarding-tooltip__next"
                type="button"
                @click="onboardingRef?.next()"
              >
                {{ t("onboarding.done") }}
              </button>
            </div>
          </div>
        </div>

        <!-- Normal empty state steps (hidden during onboarding) -->
        <div v-else class="calcEmpty__list">
          <div>{{ t("calc.emptySteps.step1") }}</div>
          <div>{{ t("calc.emptySteps.step2") }}</div>
          <i18n-t keypath="calc.emptySteps.step3" tag="div">
            <template #settingsLink>
              <button type="button" class="calcEmpty__linkBtn" data-testid="calc-empty-settings-link" @click="$emit('open-settings')">
                {{ t("common.settings") }}
              </button>
            </template>
          </i18n-t>
        </div>
      </div>
      <div class="calcEmpty__link">
        {{ t("calc.emptyLinkPre") }}<button type="button" class="calcEmpty__linkBtn" data-testid="calc-empty-help-link" @click="$emit('open-help')">{{ t("calc.emptyLinkText") }}</button>{{ t("calc.emptyLinkPost") }}
      </div>
    </div>
    </div>

    <Teleport to="body">
      <div v-if="hintState.visible" class="hintOverlay" data-testid="calc-hint-overlay" @click.stop="closeHint"></div>
      <div
        v-if="hintState.visible"
        ref="hintPopoverRef"
        class="hintPopover"
        data-testid="calc-hint-popover"
        :style="{ left: hintState.left + 'px', top: hintState.top + 'px' }"
        @click.stop
      ><!--
        本文は開始タグ直後から改行なしで書く。.hintPopover へ直接 white-space: pre-line を
        当てると、テンプレートのインデント由来の改行まで拾ってしまう。
        警告マークは文字列に混ぜず別要素にする（混ぜるとベースライン揃えで下がって見える）。
      --><p v-if="hintQuotaNote" class="hintPopover__warn hintPopover__warn--alert" data-testid="calc-hint-quota-warn"><span class="hintPopover__warnMark">⚠️</span><span>{{ hintQuotaNote }}</span></p>
        <p v-if="hintCapNote" class="hintPopover__warn"><span class="hintPopover__warnMark">⚠️</span><span>{{ hintCapNote }}</span></p>
        <p v-if="hintAllSleepNote" class="hintPopover__warn" data-testid="calc-hint-all-sleep-note"><span class="hintPopover__warnMark">⚠️</span><span>{{ hintAllSleepNote }}</span></p>
        <template v-if="hintState.kind === 'candyTarget'"
          ><p class="hintPopover__note">{{ t('calc.row.candyTargetHintNote') }}</p></template
        >
        <template v-else
          ><p class="hintPopover__heading">{{ t('calc.row.boostCandyCount') }}</p
          ><p class="hintPopover__note">{{ t('calc.row.boostCandyCountHintNote') }}</p
          ><p class="hintPopover__heading">{{ t('calc.boostRemainingLabel') }}</p
          ><p class="hintPopover__note">{{ t('calc.row.boostRemainingHintNote') }}</p>
        <!-- 設定モーダルを開かずここで直接変えられるようにする。値の正規化・全行再計算は
             ストアの onBoostCandyRemainingInput が担当する（SettingsOverlay と同じ入口）。
             空欄で既定の上限へ戻る。ラベルは直上の見出しが兼ねる。 -->
        <div class="hintPopover__field">
          <div class="hintPopover__inputRow">
            <input
              id="calc-hint-boost-remaining"
              data-testid="calc-hint-boost-remaining-input"
              :value="boostRemainingInputValue"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              class="field__input hintPopover__input"
              :placeholder="t('calc.boostRemainingPlaceholder', { cap: calc.fmtNum(calc.boostCandyDefaultCap.value) })"
              :title="t('calc.boostRemainingHelp')"
              @focus="onBoostRemainingFocus"
              @input="onBoostRemainingDraftInput(($event.target as HTMLInputElement).value)"
              @blur="onBoostRemainingBlur"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
          </div>
        </div>
        </template>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="sleepHintState.visible" class="hintOverlay" @click.stop="closeSleepHint"></div>
      <div
        v-if="sleepHintState.visible"
        ref="sleepHintPopoverRef"
        class="hintPopover sleepHintPopover"
        :style="{ left: sleepHintState.left + 'px', top: sleepHintState.top + 'px' }"
        @click.stop
      >
        <p class="sleepHintPopover__text">{{ t('calc.sleep.sleepBtnHintText') }}</p>
        <button type="button" class="hintLink" @click="openSleepSettings">
          {{ t('calc.sleep.openSettings') }}
        </button>
        <div class="hintPopover__field">
          <label class="hintPopover__label">{{ t('calc.sleep.currentSleepHours') }}</label>
          <div class="hintPopover__inputRow">
            <input
              type="number"
              min="0"
              step="1"
              class="field__input hintPopover__input"
              :value="sleepHintHoursInputValue"
              @focus="onSleepHintHoursFocus"
              @input="onSleepHintHoursInput"
              @change="onSleepHintChange"
            />
            <span class="hintPopover__unit">h</span>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, reactive, nextTick, onUnmounted, inject } from "vue";
import { useI18n } from "vue-i18n";
import LevelPicker from "./LevelPicker.vue";
import NatureSelect from "./NatureSelect.vue";
import type { CalcStore, CalcRowView } from "../composables/useCalcStore";
import type { CandySupplyBreakdown, PokemonPlanLine, PokemonPlanResult, ShortageType } from "../domain/level-planner/types";
import { CANDY_VALUES } from "../domain/level-planner/constants";
import { calcSleepReachLevel } from "../domain/level-planner/sleepReachLevel";
import { useCandyStore } from "../composables/useCandyStore";
import { useDraftField } from "../composables/useDraftField";
import { getPokemonType } from "../domain/pokesleep/pokemon-names";
import { getTypeName } from "../domain/pokesleep/pokemon-types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { calcSleepTimeForExp, sleepExpBonusMultiplier } from "../domain/pokesleep/sleep-growth";
import {
  formatSleepTimeResult,
  type SleepTimeFormatTokens,
} from "../domain/pokesleep/sleep-growth-format";
import { calcExp } from "../domain/pokesleep/exp";
import { SLEEP_TARGET_HOURS_OPTIONS } from "../persistence/calc";
import { normalizeSleepHoursInput } from "../domain/box/sleep-milestones";
import type { BoostEvent } from "../domain/types";

import iconUndoSvg from "../assets/icons/undo.svg?raw";
import iconRedoSvg from "../assets/icons/redo.svg?raw";

const emit = defineEmits<{
  (e: "apply-to-box", rowId: string): void;
  (e: "open-help"): void;
  (e: "open-settings"): void;
  (e: "open-add-modal"): void;
}>();

const props = defineProps<{
  calc: CalcStore;
  resolvePokedexIdByBoxId?: (boxId: string) => number | undefined;
}>();

const calc = props.calc;
const { t, locale } = useI18n();

/** 行ごとの計画結果（テンプレートで getPokemonResult を繰り返さず Map を O(1) 参照） */
function rowP(r: CalcRowView): PokemonPlanResult | null {
  return calc.pokemonResultByRowId.value.get(r.id) ?? null;
}
const candyStore = useCandyStore();
const debugExportStatus = ref("");
let debugExportStatusTimer: ReturnType<typeof setTimeout> | null = null;

async function copyDebugExport() {
  if (debugExportStatusTimer) clearTimeout(debugExportStatusTimer);
  debugExportStatus.value = "生成中...";
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const result = await calc.copyDebugExportTsv();
  debugExportStatus.value = result === "copied"
    ? "コピーしました"
    : result === "downloaded"
      ? "ファイル保存しました"
      : "出力失敗";
  debugExportStatusTimer = setTimeout(() => {
    debugExportStatus.value = "";
    debugExportStatusTimer = null;
  }, 2500);
}

/** Onboarding tour state (injected from App.vue) */
const _onboardingActive = inject<import("vue").Ref<boolean>>("onboardingActive");
const onboardingActive = computed(() => _onboardingActive?.value ?? false);

type OnboardingReturn = ReturnType<typeof import("../composables/useOnboarding").useOnboarding>;
const onboardingRef = inject<OnboardingReturn | null>("onboarding", null);
const onboardingStep3Active = computed(() =>
  onboardingRef?.isActive.value && onboardingRef?.currentStep.value === 2,
);
// Action label ("tap" / "click") — sourced from composable to avoid duplication
const onboardingActionLabel = computed(() =>
  t(onboardingRef?.actionI18nKey ?? "onboarding.actionClick"),
);
/** Sticky summary bar expand/collapse */
const stickyExpanded = ref(false);

/* ===== Button flash feedback ===== */
const applyFlashMap = reactive(new Map<string, boolean>());

function onApplyToBoxWithFlash(rowId: string) {
  emit("apply-to-box", rowId);
  applyFlashMap.set(rowId, true);
  setTimeout(() => { applyFlashMap.delete(rowId); }, 1500);
}

/** 在庫未設定警告: ポケモン登録済みだが実使用のアメ・かけらが両方0 */
/**
 * 「在庫を設定してください」の表示条件。
 *
 * アメ在庫が空のときだけ出す。実使用アメが 0 かどうかで判定してはいけない
 *（元Lv＝目標Lvの行や、睡眠だけで目標に届く行は在庫があっても 0 になる）。
 */
const showNoStockWarning = computed(() => calc.rowsView.value.length > 0 && !candyStore.hasAnyStock.value);

/**
 * expRemaining の表示値。計算機では常に実際の数値を表示する。
 * レベルアップ直後（expRemaining >= toNext or <= 0）のときは toNext を表示。
 */
function displayExpRemaining(r: CalcRowView): string {
  const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
  if (r.expRemaining >= toNext || r.expRemaining <= 0) return String(toNext);
  return String(r.expRemaining);
}

/** あとEXP: フォーカス中のみ編集中の文字列（空欄・途中入力を許し、blur でストアへ確定） */
const expRemainingDraftByRowId = reactive<Record<string, string>>({});

function expRemainingInputValue(r: CalcRowView): string {
  const d = expRemainingDraftByRowId[r.id];
  if (d !== undefined) return d;
  return displayExpRemaining(r);
}

function onExpRemainingFocus(r: CalcRowView) {
  expRemainingDraftByRowId[r.id] = displayExpRemaining(r);
}

function onExpRemainingDraftInput(rowId: string, v: string) {
  expRemainingDraftByRowId[rowId] = v;
}

function onExpRemainingBlur(r: CalcRowView) {
  const draft = expRemainingDraftByRowId[r.id];
  if (draft === undefined) return;
  delete expRemainingDraftByRowId[r.id];
  calc.onRowExpRemaining(r.id, draft);
}

/** 種族アメはフォーカスアウト／Enterで確定する。 */
const speciesCandyDraftByPokedexId = reactive<Record<number, string>>({});

function speciesCandyInputValue(pokedexId: number): string {
  return speciesCandyDraftByPokedexId[pokedexId]
    ?? String(candyStore.getSpeciesCandyFor(pokedexId));
}

function onSpeciesCandyFocus(pokedexId: number) {
  speciesCandyDraftByPokedexId[pokedexId] = String(candyStore.getSpeciesCandyFor(pokedexId));
}

function onSpeciesCandyDraftInput(pokedexId: number, value: string) {
  speciesCandyDraftByPokedexId[pokedexId] = value;
}

function onSpeciesCandyBlur(pokedexId: number) {
  const draft = speciesCandyDraftByPokedexId[pokedexId];
  if (draft === undefined) return;
  delete speciesCandyDraftByPokedexId[pokedexId];
  const value = Math.max(0, Math.floor(Number(draft) || 0));
  if (value !== candyStore.getSpeciesCandyFor(pokedexId)) {
    calc.updateSpeciesCandy(pokedexId, value);
  }
}

// 折りたたみ状態を管理（rowId => expanded）
const expandedRows = ref<Set<string>>(new Set());

function toggleExpand(rowId: string) {
  if (expandedRows.value.has(rowId)) {
    expandedRows.value.delete(rowId);
  } else {
    expandedRows.value.add(rowId);
  }
  // 強制的に再レンダリング
  expandedRows.value = new Set(expandedRows.value);
}

function isExpanded(rowId: string): boolean {
  return expandedRows.value.has(rowId);
}

/**
 * スロットごとのアメブ種別ラベルを取得（非選択タブ用）
 */
function getSlotBoostKindLabel(slotIndex: number): string {
  const slot = calc.slots.value[slotIndex];
  const boostKind = slot?.boostKind ?? 'mini';
  switch (boostKind) {
    case 'full': return t('calc.boostKindFullShort');
    case 'mini': return t('calc.boostKindMiniShort');
    case 'none': return t('calc.boostKindNoneShort');
    default: return t('calc.boostKindMiniShort');
  }
}

// ===== 行ドラッグ（Pointer Events — モバイル・PC共通） =====
// モバイル（〜679px）: 隣と1回だけ入れ替え → pointerup まで追加スワップ禁止
// PC（680px〜）: ドラッグ量に応じて移動先を決定（複数段移動可能）
// document レベルでイベントを処理（DOM 再構築で要素が消えても追跡可能）
let rowDragStartY = 0;
const ROW_DRAG_SWAP_THRESHOLD = 25; // px — この距離を超えたら入れ替え
/** ドラッグ中の行 ID */
let rowDragId: string | null = null;
/** 追跡中の pointerId */
let rowDragPointerId: number | null = null;
/** モバイル: 1回スワップ済みフラグ（pointerup までロック） */
let rowDragDone = false;

/** 680px 以上かどうか */
function isWideScreen(): boolean {
  return window.matchMedia("(min-width: 680px)").matches;
}

function onRowPointerDown(rowId: string, ev: PointerEvent) {
  if (rowDragId) return;
  ev.preventDefault();
  rowDragId = rowId;
  rowDragStartY = ev.clientY;
  rowDragPointerId = ev.pointerId;
  rowDragDone = false;
  calc.dragRowId.value = rowId;

  document.addEventListener("pointermove", onRowDocPointerMove);
  document.addEventListener("pointerup", onRowDocPointerUp);
  document.addEventListener("pointercancel", onRowDocPointerCancel);
}

function onRowDocPointerMove(ev: PointerEvent) {
  if (!rowDragId || ev.pointerId !== rowDragPointerId) return;

  const dy = ev.clientY - rowDragStartY;
  if (Math.abs(dy) < ROW_DRAG_SWAP_THRESHOLD) return;

  if (isWideScreen()) {
    // --- PC: 閾値ごとに隣と入れ替え（連続スワップ可能） ---
    if (dy > ROW_DRAG_SWAP_THRESHOLD && calc.canMoveRowDown(rowDragId)) {
      calc.moveRowDown(rowDragId);
      rowDragStartY = ev.clientY;
    } else if (dy < -ROW_DRAG_SWAP_THRESHOLD && calc.canMoveRowUp(rowDragId)) {
      calc.moveRowUp(rowDragId);
      rowDragStartY = ev.clientY;
    }
  } else {
    // --- モバイル: 隣と1回だけ入れ替え ---
    if (rowDragDone) return;

    if (dy > ROW_DRAG_SWAP_THRESHOLD && calc.canMoveRowDown(rowDragId)) {
      calc.moveRowDown(rowDragId);
      rowDragDone = true;
    } else if (dy < -ROW_DRAG_SWAP_THRESHOLD && calc.canMoveRowUp(rowDragId)) {
      calc.moveRowUp(rowDragId);
      rowDragDone = true;
    }
  }
}

function onRowDocPointerUp(ev: PointerEvent) {
  if (!rowDragId || ev.pointerId !== rowDragPointerId) return;
  releaseRowDrag();
}

function onRowDocPointerCancel(ev: PointerEvent) {
  if (!rowDragId || ev.pointerId !== rowDragPointerId) return;
  releaseRowDrag();
}

function releaseRowDrag() {
  rowDragId = null;
  rowDragPointerId = null;
  rowDragDone = false;
  calc.dragRowId.value = null;
  calc.dragOverRowId.value = null;
  document.removeEventListener("pointermove", onRowDocPointerMove);
  document.removeEventListener("pointerup", onRowDocPointerUp);
  document.removeEventListener("pointercancel", onRowDocPointerCancel);
}

onUnmounted(() => {
  if (rowDragId) releaseRowDrag();
  if (debugExportStatusTimer) clearTimeout(debugExportStatusTimer);
});

// ===== タブドラッグ（並べ替え） =====
const tabDragFrom = ref<number | null>(null);
const tabDragOver = ref<number | null>(null);
const tabDragging = ref(false);

// pointer座標（タッチ / マウス共通）
let tabDragStartX = 0;
let tabDragStartY = 0;
const TAB_DRAG_THRESHOLD = 8; // px: これ以上動いたらドラッグ開始

// ドラッグ開始元の <select> 要素を記憶（ドラッグ確定時に操作を抑止するため）
let tabDragSelectEl: HTMLSelectElement | null = null;

function onTabPointerDown(slotIndex: number, ev: PointerEvent) {
  tabDragFrom.value = slotIndex;
  tabDragging.value = false;
  tabDragStartX = ev.clientX;
  tabDragStartY = ev.clientY;

  // <select> 上で始まった場合を記憶
  const target = ev.target as HTMLElement;
  tabDragSelectEl = target.tagName === "SELECT" ? target as HTMLSelectElement
    : target.closest("select") as HTMLSelectElement | null;

  // ポインターキャプチャーでタッチ中も追跡
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
}

function onTabPointerMove(ev: PointerEvent) {
  if (tabDragFrom.value === null) return;

  // 閾値チェック
  if (!tabDragging.value) {
    const dx = Math.abs(ev.clientX - tabDragStartX);
    const dy = Math.abs(ev.clientY - tabDragStartY);
    if (dx < TAB_DRAG_THRESHOLD && dy < TAB_DRAG_THRESHOLD) return;
    // 縦方向のほうが大きければスクロール意図なのでキャンセル
    if (dy > dx) {
      tabDragFrom.value = null;
      tabDragSelectEl = null;
      return;
    }
    tabDragging.value = true;
    // ドラッグ確定: <select> のネイティブ操作を抑止
    if (tabDragSelectEl) {
      tabDragSelectEl.style.pointerEvents = "none";
    }
  }

  // ポインター位置からどのタブの上にいるか判定
  const tabsEl = (ev.currentTarget as HTMLElement).closest(".slotTabs");
  if (!tabsEl) return;
  const tabs = tabsEl.querySelectorAll<HTMLElement>(".slotTab");
  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i].getBoundingClientRect();
    if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
      tabDragOver.value = i;
      return;
    }
  }
}

function releaseTabDrag(ev: PointerEvent) {
  // <select> の pointer-events を復元
  if (tabDragSelectEl) {
    tabDragSelectEl.style.pointerEvents = "";
    tabDragSelectEl = null;
  }
  tabDragFrom.value = null;
  tabDragOver.value = null;
  tabDragging.value = false;
  try {
    (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
  } catch {
    // ignore
  }
}

function onTabPointerUp(ev: PointerEvent) {
  const from = tabDragFrom.value;
  const to = tabDragOver.value;

  if (tabDragging.value && from !== null && to !== null && from !== to) {
    calc.swapSlots(from, to);
  }

  releaseTabDrag(ev);
}

function onTabPointerCancel(ev: PointerEvent) {
  releaseTabDrag(ev);
}

function tabDragClass(slotIndex: number): Record<string, boolean> {
  return {
    "slotTab--dragSource": tabDragging.value && tabDragFrom.value === slotIndex,
    "slotTab--dragOver": tabDragging.value && tabDragOver.value === slotIndex && tabDragFrom.value !== slotIndex,
  };
}

// ─────────────────────────────────────────────────────────────
// アメ個数指定は Enter / フォーカスアウトで確定する。
//
// 1文字ごとに反映すると "158" が 1 → 15 → 158 と流れ、最初の "1" で
// アメブ個数が内数クランプされ（n := min(n, m)）、そのまま復元されない。
// あとEXP欄と同じドラフト方式（expRemainingDraftByRowId）に揃えている。
// ─────────────────────────────────────────────────────────────
const candyTargetDraftByRowId = reactive<Record<string, string>>({});

/** アメブ個数も個数指定と同じく、フォーカスアウト／Enterで確定する。 */
const boostCandyDraftByRowId = reactive<Record<string, string>>({});

function displayBoostCandy(r: CalcRowView): string {
  return r.boostOrExpAdjustment === undefined ? "" : String(r.boostOrExpAdjustment);
}

function boostCandyInputValue(r: CalcRowView): string {
  return boostCandyDraftByRowId[r.id] ?? displayBoostCandy(r);
}

function onBoostCandyFocus(r: CalcRowView) {
  boostCandyDraftByRowId[r.id] = displayBoostCandy(r);
}

/**
 * アメブ個数のドラフト更新。
 *
 * 未入力の欄で ▲▼（スピナー・矢印キー・ホイール）を押すと、ブラウザは `min`（0）や 1 から
 * 数え始める。画面には自動値がプレースホルダで出ているので、そこから飛んだ値が入ると
 * 「表示と1つ違う数を入れたつもりが、まったく別の数になる」。**自動値を起点に1つ動かす。**
 *
 * ▲▼ は `inputType` を持たない（文字入力は `insertText`）。これで打鍵と区別する。
 */
function onBoostCandyDraftInput(r: CalcRowView, ev: Event) {
  const value = (ev.target as HTMLInputElement).value;
  const previous = boostCandyDraftByRowId[r.id];
  const isStepper = !(ev as InputEvent).inputType;
  if (isStepper && (previous === "" || previous === undefined)) {
    const base = r.ui.boostCandyInput;
    const stepped = Number(value) >= 1 ? base + 1 : base - 1;
    boostCandyDraftByRowId[r.id] = String(
      Math.max(0, Math.min(stepped, r.ui.boostCandyInputMax)),
    );
    return;
  }
  boostCandyDraftByRowId[r.id] = value;
}

function onBoostCandyBlur(r: CalcRowView) {
  const draft = boostCandyDraftByRowId[r.id];
  if (draft !== undefined) {
    delete boostCandyDraftByRowId[r.id];
    if (draft !== displayBoostCandy(r)) calc.onRowBoostCandy(r.id, draft);
  }
}

function displayCandyTarget(r: CalcRowView): string {
  return r.candyTarget === undefined ? "" : String(r.candyTarget);
}

function candyTargetInputValue(r: CalcRowView): string {
  const d = candyTargetDraftByRowId[r.id];
  return d !== undefined ? d : displayCandyTarget(r);
}

function onCandyTargetFocus(r: CalcRowView) {
  candyTargetDraftByRowId[r.id] = displayCandyTarget(r);
}

function onCandyTargetDraftInput(rowId: string, value: string) {
  candyTargetDraftByRowId[rowId] = value;
}

function onCandyTargetBlur(r: CalcRowView) {
  const draft = candyTargetDraftByRowId[r.id];
  if (draft === undefined) return;
  delete candyTargetDraftByRowId[r.id];
  if (draft === displayCandyTarget(r)) return;

  calc.onRowCandyTarget(r.id, draft);
  // 値が設定されたら自動的に到達可能行を開く
  if (draft.trim() !== "") {
    expandedRows.value.add(r.id);
    expandedRows.value = new Set(expandedRows.value);
  }
}

/**
 * 睡眠目標の選択肢ラベル。累計睡眠時間が届いているものにチェックを付ける。
 *
 * **選択肢を隠さない。** 隠すと、選択中の目標を累計が追い越した瞬間にその項目だけが
 * リストから消え、`<select>` が空表示になる。累計2000h超のポケモンでは全滅して
 * 「未設定」しか出ない。達成済みは情報であって、選ばせない理由にはならない
 * （累計は手入力なので、打ち間違いを訂正する導線も要る）。
 *
 * チェックは**後ろ**に置く。前置すると数字の開始位置がずれて桁が揃わない。
 */
function sleepTargetOptionLabel(r: CalcRowView, hours: number): string {
  const label = `${hours}h`;
  return (r.sleepHours ?? 0) >= hours ? `${label} ✓` : label;
}

/**
 * 睡眠目標時間の選択（設計書§5.3, §5.5）。
 * 目標 T を固定したまま個数指定を再計算する処理はストア側に集約されている。
 */
function onSleepTargetChange(rowId: string, value: string) {
  const target = value === "" ? undefined : value === "all" ? "all" : Number(value);
  calc.setRowSleepTarget(rowId, target);
  if (target !== undefined) {
    expandedRows.value.add(rowId);
    expandedRows.value = new Set(expandedRows.value);
  }
}

/**
 * 残EXPから睡眠時間を計算してフォーマットされたテキストを返す
 */
function getSleepTimeText(rowId: string, expToTarget: number): string | null {
  if (expToTarget <= 0) return null;

  const row = calc.rowsView.value.find(r => r.id === rowId);
  if (!row) return null;

  const sleepSettings = calc.sleepSettings.value;
  const sleepExpBonus = sleepExpBonusMultiplier(sleepSettings.sleepExpBonusCount);

  const result = calcSleepTimeForExp({
    expToTarget,
    nature: row.nature,
    dailySleepHours: sleepSettings.dailySleepHours,
    sleepExpBonus,
    includeGSD: sleepSettings.includeGSD,
  });

  return formatSleepTimeResult(result, getSleepTimeFormatTokens());
}

/**
 * 「睡眠到達Lv」の表示文（設計書『睡眠育成の拡張』§3）。出さない行では null。
 *
 * 規則は `calcSleepReachLevel` が正本で、ここは書式だけを持つ。
 * **「約」は Lv70 でも付ける。** 小数を落とすのは分母が無いから（§3.4）で、
 * 推定値であること（§3.9）は変わらない。
 *
 * **「これから寝る時間」を括弧で添える。** 隣の残EXPが「目標Lvまで 約96日（1248時間）」で、
 * こちらは「睡眠目標を寝きった時点」という**別の時間軸**なので、
 * 同じ単位（これから寝る時間）を並べて読み分けられるようにする（§3.11）。
 */
function getSleepReachLevelText(r: CalcRowView): string | null {
  const p = rowP(r);
  if (!p) return null;

  const reach = calcSleepReachLevel({
    reachedLevel: p.reachableLine.level,
    reachedExpInLevel: p.reachableLine.expInLevel,
    sleepExp: calc.rowSleepExpFor(r.id),
    targetLevel: p.targetLevel,
    targetExpInLevel: p.targetExpInLevel,
    expType: r.expType,
  });
  if (!reach.shown) return null;

  const value = reach.tenths === null ? `${reach.level}` : `${reach.level}.${reach.tenths}`;
  const hours = calc.rowSleepRemainingHoursFor(r.id);
  return `${t("calc.sleep.approximatePrefix")}${value}`
    + `${t("calc.sleep.estimateOpen")}${hours}${t("calc.sleep.hourUnit")}${t("calc.sleep.estimateClose")}`;
}

function getSleepTimeFormatTokens(): SleepTimeFormatTokens {
  return {
    hourUnit: t("calc.sleep.hourUnit"),
    minuteUnit: t("calc.sleep.minuteUnit"),
    dayUnit: t("calc.sleep.dayUnit"),
    hourMinuteSeparator: t("calc.sleep.hourMinuteSeparator"),
    rangeSeparator: t("calc.sleep.rangeSeparator"),
    approximatePrefix: t("calc.sleep.approximatePrefix"),
    estimateOpen: t("calc.sleep.estimateOpen"),
    estimateClose: t("calc.sleep.estimateClose"),
  };
}

/**
 * オンボーディングのダミー結果行に出す睡眠時間。設定値に左右されないよう固定にしている。
 * 残り440EXP・1日8.5h・睡眠EXPボーナス0体・GSD込みで `calcSleepTimeForExp` が返す値と一致する。
 * ダミー行の数値（CalcPanel の calcEmpty__demo）を変えるときはここも合わせること。
 */
const onboardingSleepTimeText = computed(() =>
  formatSleepTimeResult(
    { kind: "long-term-estimate", requiredDays: 5, totalMinutes: 5 * 8.5 * 60 },
    getSleepTimeFormatTokens()
  )
);

// 行から pokedexId を取得（保存済み or boxId から解決）
function getRowPokedexId(r: { pokedexId?: number; boxId?: string }): number | undefined {
  if (r.pokedexId) return r.pokedexId;
  if (r.boxId && props.resolvePokedexIdByBoxId) {
    return props.resolvePokedexIdByBoxId(r.boxId);
  }
  return undefined;
}

// PokemonPlanResult への直接アクセス: calc.getPokemonResult(rowId) を使用

// アイテム使用リストの項目型
type ItemUsageItem = { label: string; value: number; isDanger: boolean };

// アイテム使用リストの赤字判定モード（個数指定行は目標まで行と同値になったため廃止。設計書§4.2）
type ItemDangerMode = 'target' | 'reachable';

function supplyValue(supply: CandySupplyBreakdown): number {
  return supply.species
    + supply.type.s * CANDY_VALUES.type.s
    + supply.type.m * CANDY_VALUES.type.m
    + supply.universal.s * CANDY_VALUES.universal.s
    + supply.universal.m * CANDY_VALUES.universal.m
    + supply.universal.l * CANDY_VALUES.universal.l;
}

function lineSurplus(line: PokemonPlanLine): number {
  return Math.max(0, line.surplusCandyValue, supplyValue(line.candySupply) - line.totalCandyUnitsUsed);
}

// 共通ヘルパー: アイテム使用リストを生成
function buildItemUsageList(
  r: CalcRowView,
  mode: ItemDangerMode,
  pCached?: PokemonPlanResult | null
): ItemUsageItem[] {
  const p = pCached !== undefined ? pCached : rowP(r);
  if (!p) return [];

  // モードに応じてアイテムソースを決定
  const sourceLine: PokemonPlanLine = mode === 'target' ? p.targetLine : p.reachableLine;
  const sourceItems = sourceLine.candySupply;

  const items: ItemUsageItem[] = [];
  const typeName = getTypeName(r.pokemonType || getPokemonType(p.pokedexId), locale.value);
  const uniLabel = t("calc.export.labelUni");

  // 赤字判定関数。
  // 目標まで行・到達可能行とも万能Sのみ、アメが律速のときに赤字（設計書§10.15）。
  // 個数指定＝目標になったため、個数指定ありでも抑止しない（設計書§4.9）。
  const getDanger = (itemType: 'typeS' | 'typeM' | 'uniS' | 'uniM' | 'uniL'): boolean => {
    if (itemType === 'uniS') return p.constraintDiagnosis.limitingFactor === 'candy';
    return false;
  };

  // タイプアメ
  if (sourceItems.type.s > 0) {
    items.push({ label: `${typeName}S`, value: sourceItems.type.s, isDanger: getDanger('typeS') });
  }
  if (sourceItems.type.m > 0) {
    items.push({ label: `${typeName}M`, value: sourceItems.type.m, isDanger: getDanger('typeM') });
  }

  // 万能アメ
  if (sourceItems.universal.s > 0) {
    items.push({ label: `${uniLabel}S`, value: sourceItems.universal.s, isDanger: getDanger('uniS') });
  }
  if (sourceItems.universal.m > 0) {
    items.push({ label: `${uniLabel}M`, value: sourceItems.universal.m, isDanger: getDanger('uniM') });
  }
  if (sourceItems.universal.l > 0) {
    items.push({ label: `${uniLabel}L`, value: sourceItems.universal.l, isDanger: getDanger('uniL') });
  }

  return items;
}

function getSurplusValue(r: CalcRowView, mode: ItemDangerMode): number {
  const p = rowP(r);
  if (!p) return 0;
  return lineSurplus(mode === 'target' ? p.targetLine : p.reachableLine);
}

/** 行ごとのアイテム内訳（1 computed にまとめ、行あたり rowP は1回だけ） */
const rowItemUsageMaps = computed(() => {
  const target = new Map<string, ItemUsageItem[]>();
  const reachable = new Map<string, ItemUsageItem[]>();
  for (const r of calc.rowsView.value) {
    const p = rowP(r);
    target.set(r.id, buildItemUsageList(r, "target", p));
    reachable.set(r.id, buildItemUsageList(r, "reachable", p));
  }
  return { target, reachable };
});

// アイテム使用があるか判定（目標まで行用 = targetLine）
// 種族アメのみで足りた場合はfalse、タイプアメまたは万能アメを使用した場合のみtrue
function hasItemUsage(r: CalcRowView): boolean {
  const p = rowP(r);
  if (!p) return false;
  const items = p.targetLine.candySupply;
  return (
    items.universal.s > 0 ||
    items.universal.m > 0 ||
    items.universal.l > 0 ||
    items.type.s > 0 ||
    items.type.m > 0
  );
}

// ============================================================
// 不足表示（赤字・不足チップ・レベルピッカーのラベル）
// ============================================================

const SHORTAGE_LABEL_KEYS = {
  candy: 'calc.row.candyShortage',
  boost: 'calc.row.boostCandyShortage',
  shards: 'calc.row.shardsShortage',
} as const;

/**
 * 行の不足表示のビューモデル。**画面に出る不足の表現はすべてここから引く。**
 *
 * ### 律速要因（`limiting`）で1つに絞る
 *
 * `shortage.candyToTarget` / `dreamShardShortage` は **他の制約を理論値に置いた独立仮定**の値
 * （`calcDiagnosis` が `byCandy` / `byShards` を別々に simulate している）。非0のものを全部出すと、
 * 必要量がたまたま残り在庫以下に収まった行だけアメ不足が消え、行ごとに1つ出たり2つ出たりして
 * 「どれが本質か」が読めない。そこで `limitingFactor` に一致するものだけを出す（設計書§10.12）。
 *
 * ### 赤の意味は「足りない」ではなく「今これが効いている」
 *
 * 資源ごとの充足で塗ると、律速がかけらへ移ったときに**アメ不足が悪化しているのにアメが黒へ戻る**
 * という逆転が起きる。「赤は1つだけ」と「一度赤くなったら戻らない」は論理的に両立しないため、
 * 赤の意味の方を変えた（設計書§10.15）。目標Lvピッカーのラベルも同じ基準。
 *
 * ### アメブ枠不足だけは別軸
 *
 * `boostCandyUnavailable` は**目標到達の可否と切り離した**指標で、到達している行にも出る
 * （`.agent/level-planner-allocation-policy-spec.md` §4）。`limitingFactor` は未到達の行でしか
 * 非nullにならないので、律速に混ぜると可視化が消える。ラベルはアメブ目標Lvピッカーが担当する。
 *
 * ### チップの置き場所
 *
 * `chips` を出してよいのは「到達可能」行（`resultRowReachable`）だけ。
 * 「目標まで」行は在庫を無視した理論値なので、在庫と突き合わせた結果である不足は持たない。
 * 折りたたみ時だけ「目標まで」行へ出す実装が過去に何度も復活しているが、追加しないこと。
 */
type RowShortageView = {
  /** 赤くする資源。`limitingFactor` そのもの（不足量が0でも赤くする） */
  limiting: ShortageType | null;
  /** アメブ枠が確保できなかったか */
  boostQuota: boolean;
  /** 「到達可能」行に出す不足チップ。律速 → アメブ枠 の順 */
  chips: { label: string; value: string }[];
  /** 目標Lvピッカーのラベル（アメ不足 / かけら不足） */
  targetPickerLabel: string | null;
  /** アメブ目標Lvピッカーのラベル（アメブ不足） */
  boostPickerLabel: string | null;
};

const EMPTY_ROW_SHORTAGE: RowShortageView = {
  limiting: null, boostQuota: false, chips: [], targetPickerLabel: null, boostPickerLabel: null,
};

function buildRowShortage(p: PokemonPlanResult | null): RowShortageView {
  if (!p) return EMPTY_ROW_SHORTAGE;

  // `limitingFactor === 'boost'` は実質発生しない。アメブ枠の不足は通常アメで補填されるため
  // 枠を取られた行も目標へ到達し、到達すれば limitingFactor は null になる。
  // 根拠は single-pipeline.test.ts「アメブ枠を取られた行は通常アメで補填されて到達し、
  // 律速要因にはならない」。来た場合もピッカーのラベルはアメブ側が担当する。
  const limiting = p.constraintDiagnosis.limitingFactor;
  const limitingAmount = limiting === 'candy'
    ? p.shortage.candyToTarget
    : limiting === 'shards' ? p.shortage.dreamShardShortage : 0;
  const boostQuota = Math.max(0, p.shortage.boostCandyUnavailable);

  const chips: { label: string; value: string }[] = [];
  // 律速 → アメブ枠 の順。原因として重い方を先に置く。
  if (limiting && Number.isFinite(limitingAmount) && limitingAmount > 0) {
    chips.push({ label: t(SHORTAGE_LABEL_KEYS[limiting]), value: calc.fmtNum(limitingAmount) });
  }
  if (boostQuota > 0) {
    chips.push({ label: t(SHORTAGE_LABEL_KEYS.boost), value: calc.fmtNum(boostQuota) });
  }

  return {
    limiting,
    boostQuota: boostQuota > 0,
    chips,
    // ピッカーは自分が操作する対象の不足だけを担当する。
    targetPickerLabel: limiting === 'candy' || limiting === 'shards'
      ? t(SHORTAGE_LABEL_KEYS[limiting])
      : null,
    boostPickerLabel: boostQuota > 0 ? t(SHORTAGE_LABEL_KEYS.boost) : null,
  };
}

const rowShortages = computed(() => {
  const map = new Map<string, RowShortageView>();
  for (const r of calc.rowsView.value) map.set(r.id, buildRowShortage(rowP(r)));
  return map;
});

function rowShortage(r: CalcRowView): RowShortageView {
  return rowShortages.value.get(r.id) ?? EMPTY_ROW_SHORTAGE;
}

/**
 * 赤字判定。`rowShortage()` の薄いラッパー（テンプレートを読みやすく保つため）。
 *
 * 内訳（アメブ／通常アメ）の「通常アメ」は塗らない。アメが律速なら「アメ合計」だけを赤くする。
 */
function isDanger(r: CalcRowView, field: 'boost' | 'candy' | 'shards'): boolean {
  const s = rowShortage(r);
  return field === 'boost' ? s.boostQuota : s.limiting === field;
}

const BOOST_QUOTA_HINT_KEYS = {
  count: 'calc.row.boostCandyOverQuota',
  reach: 'calc.row.boostReachOverQuota',
} as const;

/**
 * アメブ枠超過の警告文。減らす対象が欄によって違うので、持ち主（`ui.boostQuotaViolation`）から引く。
 *
 * 持ち主の判定はストア側が持つ。ここで `boostOrExpAdjustment` の有無を見て組み立て直すと、
 * 保存表現の都合が UI の分岐に漏れる。
 */
function boostQuotaHint(r: CalcRowView): string | undefined {
  const owner = r.ui.boostQuotaViolation;
  return owner ? t(BOOST_QUOTA_HINT_KEYS[owner]) : undefined;
}

/**
 * アメブ目標Lv欄にかかっている制限の一覧。マークの有無と tooltip の本文をここから引く。
 * 打ち手が要る順（枠超過 → 睡眠の頭打ち）に並べる。ポップオーバー内の alert / note と同じ順序。
 */
function boostReachWarnings(r: CalcRowView): string[] {
  const warnings: string[] = [];
  if (r.ui.boostQuotaViolation === 'reach') warnings.push(t('calc.row.boostReachOverQuota'));
  if (r.ui.boostSleepCapActive) warnings.push(t('calc.row.boostSleepCapHint', { level: r.ui.boostReachLevelMax }));
  return warnings;
}


// ヒントアイコン用
// ヒントポップオーバーの状態
type HintKind = 'boostCandy' | 'candyTarget';

/**
 * ヒントの状態は**どの行のどのヒントか**と位置だけを持つ。
 *
 * 案内文をここへ焼き付けてはいけない。このポップオーバーの中からアメブ上限を変えられるので、
 * 超過を解消しても警告が消えないまま残る（開き直すまで直らない）。文言は行から都度引く。
 */
const hintState = ref<{ visible: boolean; left: number; top: number; kind: HintKind; rowId?: string }>({
  visible: false,
  left: 0,
  top: 0,
  kind: 'boostCandy'
});

const hintRow = computed(() =>
  hintState.value.rowId ? calc.rowsView.value.find((r) => r.id === hintState.value.rowId) ?? null : null
);

// 睡眠の頭打ちはアメブ側の話なので、アメ個数指定のヒントには出さない。
const hintCapNote = computed(() => {
  const row = hintRow.value;
  return hintState.value.kind === 'boostCandy' && row?.ui.boostSleepCapActive
    ? t('calc.row.boostSleepCapHint', { level: row.ui.boostReachLevelMax })
    : undefined;
});

/**
 * 「すべて睡眠」でアメ関連の欄が無効化されている理由。**破線の理由はここだけで読める。**
 *
 * 頭打ち（`hintCapNote`）と違い、**両方のヒントに出す。** すべて睡眠ではアメ個数指定も
 * 無効化されるので、アメブ側の話では済まない。
 *
 * title には出さない（スマホでは表示されない）。アメブ目標Lvは disabled でピッカーが
 * 開かないため、あちらの `note` も読めない。残る経路がこのヒントだけ。
 */
const hintAllSleepNote = computed(() =>
  hintRow.value?.sleepTargetMode === 'all' ? t('calc.row.sleepTargetAllHint') : undefined
);

// アメブ枠の超過。このヒントの中から上限そのものを変えられるので、打ち手の1つとして併記する。
const hintQuotaNote = computed(() => {
  const row = hintRow.value;
  return hintState.value.kind === 'boostCandy' && row ? boostQuotaHint(row) : undefined;
});


const hintPopoverRef = ref<HTMLElement | null>(null);

const {
  text: boostRemainingInputValue,
  focus: onBoostRemainingFocus,
  input: onBoostRemainingDraftInput,
  blur: onBoostRemainingBlur,
} = useDraftField(() => calc.boostCandyRemainingText.value, (v) => calc.onBoostCandyRemainingInput(v));

async function showHint(ev: MouseEvent, row?: CalcRowView, kind: HintKind = 'boostCandy') {
  const target = ev.target as HTMLElement;
  const rect = target.getBoundingClientRect();
  const gap = 4;

  // 画面端の考慮（水平）
  const viewportWidth = window.innerWidth;
  const popoverWidth = 220; // CSS max-width(200) + padding/border margin

  let left = rect.left;
  if (left + popoverWidth > viewportWidth) {
    left = viewportWidth - popoverWidth - 8;
  }
  if (left < 8) left = 8;

  // まず下に仮配置して描画
  hintState.value = {
    visible: true,
    left,
    top: rect.bottom + gap,
    kind,
    rowId: row?.id,
  };

  // 描画後に実測して、下に収まらなければ上にフリップ
  await nextTick();
  if (hintPopoverRef.value) {
    const popH = hintPopoverRef.value.offsetHeight;
    const viewportHeight = window.innerHeight;
    if (rect.bottom + gap + popH > viewportHeight && rect.top - gap - popH > 0) {
      hintState.value.top = rect.top - gap - popH;
    }
  }
}

function closeHint() {
  hintState.value.visible = false;
}

// ── 睡眠ヒント専用ポップオーバー ──
const sleepHintState = ref<{ visible: boolean; rowId: string; left: number; top: number }>({
  visible: false, rowId: "", left: 0, top: 0,
});
const sleepHintPopoverRef = ref<HTMLElement | null>(null);

const sleepHintRowSleepHours = computed(() => {
  if (!sleepHintState.value.visible) return 0;
  const row = calc.rowsView.value.find(r => r.id === sleepHintState.value.rowId);
  return row?.sleepHours ?? 0;
});

/**
 * 累計睡眠時間の入力中の値（仕様書 §8.1）。
 *
 * **`:value` へ保存値を直結してはいけない。** 確定は `@change` なので、入力中は保存値が
 * 変わらない。そこへ別の理由（planner の debounce 完了、他行の更新など）で再描画が走ると、
 * 打っている途中の値が保存値へ巻き戻る。他の数値欄と同じくドラフトで保持する。
 */
const sleepHintHoursDraft = ref<string | null>(null);

const sleepHintHoursInputValue = computed(() =>
  sleepHintHoursDraft.value ?? String(sleepHintRowSleepHours.value)
);

function onSleepHintHoursFocus() {
  sleepHintHoursDraft.value = String(sleepHintRowSleepHours.value);
}

/** ドラフトを更新するだけ。計算へ反映するのは `@change`（確定時）のまま。 */
function onSleepHintHoursInput(ev: Event) {
  sleepHintHoursDraft.value = (ev.target as HTMLInputElement).value;
}

async function showSleepHint(ev: MouseEvent, rowId: string) {
  const target = ev.target as HTMLElement;
  const rect = target.getBoundingClientRect();
  const gap = 4;
  const viewportWidth = window.innerWidth;
  const popoverWidth = 240;
  let left = rect.left;
  if (left + popoverWidth > viewportWidth) left = viewportWidth - popoverWidth - 8;
  if (left < 8) left = 8;

  sleepHintHoursDraft.value = null;
  sleepHintState.value = { visible: true, rowId, left, top: rect.bottom + gap };

  await nextTick();
  if (sleepHintPopoverRef.value) {
    const popH = sleepHintPopoverRef.value.offsetHeight;
    const viewportHeight = window.innerHeight;
    if (rect.bottom + gap + popH > viewportHeight && rect.top - gap - popH > 0) {
      sleepHintState.value.top = rect.top - gap - popH;
    }
  }
}

function closeSleepHint() {
  sleepHintState.value.visible = false;
  sleepHintHoursDraft.value = null;
}

function openSleepSettings() {
  closeSleepHint();
  emit('open-settings');
}

function onSleepHintChange(ev: Event) {
  const val = (ev.target as HTMLInputElement).value;
  // 確定したらドラフトを捨て、正規化後の保存値を表示させる。
  sleepHintHoursDraft.value = null;
  const sleepHours = normalizeSleepHoursInput(val);
  calc.setRowSleepHours(sleepHintState.value.rowId, sleepHours);
}

</script>
