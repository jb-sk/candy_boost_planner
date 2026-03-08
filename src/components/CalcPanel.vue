<template>
  <section id="neo-calc" class="panel panel--calc">
    <div class="panel__head">
      <h2 class="panel__title">{{ t("calc.title") }}</h2>
    </div>

    <div class="calcSticky">
      <div class="calcSticky__summary" data-testid="calc-sticky-summary" @click="stickyExpanded = !stickyExpanded">
        <span class="calcSticky__toggle">{{ stickyExpanded ? '▼' : '▶' }}</span>
        <div class="calcSticky__summaryBody">
          <button v-if="showNoStockWarning" type="button" class="calcSticky__noStock" @click.stop="$emit('open-settings')">{{ t("calc.export.noStockWarning") }}</button>
          <span class="calcSumInline" v-if="calc.boostKind.value !== 'none'" :class="{ 'calcSumInline--danger': calc.boostCandyOver.value > 0 }">
            <span class="calcSumInline__k">{{ t("calc.export.sumBoostTotal") }}</span>
            <span class="calcSumInline__v">{{ calc.fmtNum(calc.totalBoostCandyUsed.value) }}</span>
          </span>
          <span class="calcSumInline calcSumInline--danger" v-if="calc.boostKind.value !== 'none' && calc.boostCandyUnused.value > 0 && calc.rowsView.value.length > 0">
            <span class="calcSumInline__k">{{ t("calc.export.sumBoostUnused") }}</span>
            <span class="calcSumInline__v">{{ calc.fmtNum(calc.boostCandyUnused.value) }}</span>
          </span>
          <span class="calcSumInline" :class="{ 'calcSumInline--danger': calc.shardsOver.value > 0 }">
            <span class="calcSumInline__k">{{ t("calc.shardsTotal") }}</span>
            <span class="calcSumInline__v">{{ calc.fmtNum(calc.totalShardsUsed.value) }}</span>
          </span>
          <template v-if="calc.planResult.value">
            <span class="calcSumInline calcSumInline--candy" :class="{ 'calcSumInline--danger': calc.universalCandyNeeded.value.s > candyStore.universalCandy.value.s }">
              <span class="calcSumInline__k">{{ t("calc.candy.universalSummaryS") }}</span>
              <span class="calcSumInline__v">{{ calc.universalCandyNeeded.value.s }}/{{ candyStore.universalCandy.value.s }}</span>
            </span>
            <span class="calcSumInline calcSumInline--candy" :class="{ 'calcSumInline--danger': calc.universalCandyNeeded.value.m > candyStore.universalCandy.value.m }">
              <span class="calcSumInline__k">M</span>
              <span class="calcSumInline__v">{{ calc.universalCandyNeeded.value.m }}/{{ candyStore.universalCandy.value.m }}</span>
            </span>
            <span class="calcSumInline calcSumInline--candy" :class="{ 'calcSumInline--danger': calc.universalCandyNeeded.value.l > candyStore.universalCandy.value.l }">
              <span class="calcSumInline__k">L</span>
              <span class="calcSumInline__v">{{ calc.universalCandyNeeded.value.l }}/{{ candyStore.universalCandy.value.l }}</span>
            </span>
          </template>
        </div>
      </div>
      <div
        v-show="stickyExpanded"
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
      <button class="btn btn--primary" data-testid="calc-export-button" type="button" @click="calc.openExport()" :disabled="!calc.rowsView.value.length" :title="t('calc.export.open')">
        {{ t("calc.export.openShort") }}
      </button>
      <button class="btn btn--ghost" data-testid="calc-clear-button" type="button" @click="calc.clear()" :disabled="!calc.rowsView.value.length" :title="t('calc.clearPokemons')">
        {{ t("calc.clearPokemonsShort") }}
      </button>
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
        v-for="r in calc.rowsView.value"
        :key="r.id"
        class="calcRow"
        data-testid="calc-row"
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
            <span v-if="r.nature === 'up'" class="calcRow__natureIcon calcRow__natureIcon--up" title="EXP+20%">▲</span>
            <span v-else-if="r.nature === 'down'" class="calcRow__natureIcon calcRow__natureIcon--down" title="EXP-20%">▼</span>
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
          <label class="field field--sm">
            <span class="field__label">{{ t("calc.row.srcLevel") }}</span>
            <div class="levelPick" data-testid="srcLevel">
              <LevelPicker
                :model-value="r.srcLevel"
                @update:model-value="calc.setSrcLevel(r.id, $event)"
                :label="`${t('calc.row.srcLevel')}: Lv${r.srcLevel}`"
                :max="r.dstLevel"
              />
            </div>
          </label>

          <label class="field field--sm">
            <span class="field__label">{{ t("calc.row.expRemaining") }}</span>
            <input
              data-testid="expRemaining"
              :value="displayExpRemaining(r)"
              type="number"
              min="1"
              class="field__input"
              :placeholder="t('calc.row.expRemainingPh')"
              @input="calc.onRowExpRemaining(r.id, ($event.target as HTMLInputElement).value)"
            />
          </label>

          <label class="field field--sm">
            <span class="field__label">
              {{ t("calc.row.dstLevel") }}
              <span v-if="(calc.getPokemonResult(r.id)?.targetExpToNextLevel ?? 0) > 0" style="font-weight:normal; margin-left:4px; opacity:0.8">
                {{ t("calc.row.expLeftNext", { exp: calc.fmtNum(calc.getPokemonResult(r.id)?.targetExpToNextLevel ?? 0) }) }}
              </span>
            </span>
            <div class="levelPick" data-testid="dstLevel">
              <LevelPicker
                :model-value="r.dstLevel"
                @update:model-value="calc.setDstLevel(r.id, $event)"
                :min="r.srcLevel"
                :max="MAX_LEVEL"
              >
                <template #title>
                  Lv{{ r.srcLevel }} → Lv{{ r.dstLevel }}
                  <span v-if="isCandyShort(r)" :title="t('calc.row.candyShortage')" style="font-size: 1.2em; vertical-align: middle; margin-left: 4px;">🍬</span>
                </template>
              </LevelPicker>
            </div>
          </label>
          <label class="field field--sm" v-if="getRowPokedexId(r)">
            <span class="field__label">{{ t("calc.row.speciesCandy") }}</span>
            <input
              data-testid="speciesCandy"
              type="number"
              min="0"
              class="field__input"
              :value="candyStore.getSpeciesCandyFor(getRowPokedexId(r)!)"
              @input="candyStore.updateSpeciesCandy(getRowPokedexId(r)!, parseInt(($event.target as HTMLInputElement).value) || 0)"
            />
          </label>

          <label class="field field--sm" v-if="calc.boostKind.value !== 'none'">
            <span class="field__label">{{ t("calc.row.boostReachLevel") }}</span>
            <div class="levelPick" data-testid="boostReachLevel">
              <LevelPicker
                :model-value="r.ui.boostReachLevel"
                @update:model-value="calc.setBoostLevel(r.id, $event)"
                :min="r.srcLevel"
                :max="r.dstLevel"
              >
                <template #title>
                  Lv{{ r.srcLevel }} → Lv{{ r.ui.boostReachLevel }}
                  <span v-if="isCandyShort(r)" :title="t('calc.row.candyShortage')" style="font-size: 1.2em; vertical-align: middle; margin-left: 4px;">🍬</span>
                </template>
              </LevelPicker>
            </div>
          </label>
          <label class="field field--sm" v-if="calc.boostKind.value !== 'none'">
            <span class="field__label">{{ t("calc.row.boostRatio") }}</span>
            <input
              data-testid="boostRatio"
              :value="r.ui.boostRatioPct"
              type="range"
              min="0"
              max="100"
              step="1"
              class="field__range"
              @input="calc.onRowBoostRatio(r.id, ($event.target as HTMLInputElement).value)"
            />
            <span class="field__sub">{{ r.ui.boostRatioPct }}%</span>
          </label>
          <label class="field field--sm">
            <span class="field__label">
              {{ calc.boostKind.value === 'none' ? t("calc.row.boostCandyCountNormal") : t("calc.row.boostCandyCount") }}
              <button
                data-testid="hintBtn"
                type="button"
                class="hintIcon"
                @click.stop="showHint($event, calc.boostKind.value === 'none' ? t('calc.row.boostCandyCountNormalHint') : t('calc.row.boostCandyCountHint'))"
              >?</button>
              <button
                data-testid="boostCandyReset"
                type="button"
                class="hintIcon hintIcon--reset"
                :aria-label="t('calc.row.boostCandyCountReset')"
                :title="t('calc.row.boostCandyCountReset')"
                @click.stop="calc.resetRowBoostCandy(r.id)"
              ><svg class="hintIcon__resetSvg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v4h4"/><path d="M3 7a5.5 5.5 0 1 1 1 4"/></svg></button>
            </span>
            <input
              data-testid="boostCandyCount"
              :value="r.ui.boostCandyInput"
              type="number"
              min="0"
              class="field__input"
              @input="calc.onRowBoostCandy(r.id, ($event.target as HTMLInputElement).value)"
              @blur="handleInputBlur"
            />
          </label>
          <div class="field field--sm field--sleepTarget">
            <span class="field__label">{{ t("calc.row.candyTarget") }}</span>
            <input
              data-testid="candyTarget"
              type="number"
              min="0"
              class="field__input"
              :value="r.candyTarget ?? ''"
              :placeholder="t('calc.row.candyTargetNone')"
              @input="onCandyTargetInput(r.id, ($event.target as HTMLInputElement).value)"
            />
            <div class="sleepLinks">
              <button
                data-testid="sleepBtn1000h"
                type="button"
                class="sleepChip"
                @click.stop="applySleepGrowth(r.id, 1000)"
                :title="t('calc.sleep.btn1000h')"
              >1000h</button>
              <button
                data-testid="sleepBtn2000h"
                type="button"
                class="sleepChip"
                @click.stop="applySleepGrowth(r.id, 2000)"
                :title="t('calc.sleep.btn2000h')"
              >2000h</button>
              <button
                data-testid="sleepHintBtn"
                type="button"
                class="hintIcon"
                @click.stop="showHint($event, t('calc.sleep.sleepBtnHint'))"
              >?</button>
            </div>
          </div>
        </div>

        <!-- 必要/使用の折りたたみ表示 -->
        <div class="calcRow__resultCollapse">
          <!-- 必要行（クリックで展開） -->
          <div
            data-testid="resultRowRequired"
            :data-onboarding="calc.rowsView.value.indexOf(r) === 0 ? 'result-row' : undefined"
            class="calcRow__resultRow calcRow__resultRow--required"
            :class="{ 'is-expanded': isExpanded(r.id) }"
            @click="toggleExpand(r.id)"
          >
            <span class="calcRow__expandIcon">{{ isExpanded(r.id) ? '▼' : '▶' }}</span>
            <span class="calcRow__resultLabel">{{ t("calc.row.required") }}</span>
            <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'target', 'boost') }">{{ calc.fmtNum(calc.getPokemonResult(r.id)?.targetBoost ?? 0) }}</span>
              </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'target', 'normal') }">{{ calc.fmtNum(calc.getPokemonResult(r.id)?.targetNormal ?? 0) }}</span>
              </span>{{ ' ' }}<span class="calcRow__res">
                <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'target', 'candy') }">{{ calc.fmtNum((calc.getPokemonResult(r.id)?.targetBoost ?? 0) + (calc.getPokemonResult(r.id)?.targetNormal ?? 0)) }}</span>
              </span>{{ ' ' }}<span class="calcRow__res">
                <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'target', 'shards') }">{{ calc.fmtNum(calc.getPokemonResult(r.id)?.targetShards ?? 0) }}</span>
              </span>{{ ' ' }}<span class="calcRow__res" v-if="hasItemUsage(r)">
                <span class="calcRow__k">{{ t("calc.row.itemRequired") }}</span>
                <span class="calcRow__num calcRow__num--text">
                  <template v-for="(item, idx) in getItemUsageItems(r)" :key="idx">
                    <span :class="{ 'calcRow__num--danger': item.isDanger }">{{ item.label }} {{ item.value }}</span>
                    <span v-if="idx < getItemUsageItems(r).length - 1">, </span>
                  </template>
                </span>
              </span>
            </span>
          </div>

          <!-- 個数指定行と到達可能行をグループ化して表示（隙間をなくすため） -->
          <div style="display: flex; flex-direction: column; gap: 0;">
            <!-- 個数指定行（個数指定ありかつ不足がある場合のみ表示） -->
            <div
              v-if="isExpanded(r.id) && hasLimit(r) && getTheoreticalResources(r) && calc.getPokemonResult(r.id)?.diagnosis.limitingFactor !== null"
              data-testid="resultRowCandyTarget"
              class="calcRow__resultRow calcRow__resultRow--used"
              style="margin-bottom: 0; padding-bottom: 4px; border-bottom-left-radius: 0; border-bottom-right-radius: 0;"
            >
              <span class="calcRow__expandIcon" style="visibility: hidden"></span>
              <span class="calcRow__resultLabel">{{ t("calc.row.candyTargetRow") }}</span>
              <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'limit', 'boost') }">{{ calc.fmtNum(getTheoreticalResources(r)!.boostCandy) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'limit', 'normal') }">{{ calc.fmtNum(getTheoreticalResources(r)!.normalCandy) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'limit', 'candy') }">{{ calc.fmtNum(getTheoreticalResources(r)!.candy) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'limit', 'shards') }">{{ calc.fmtNum(getTheoreticalResources(r)!.shards) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="getLimitItemUsageItems(r).length > 0">
                  <span
                    class="calcRow__k calcRow__k--link"
                    @click.stop="toggleLimitItems(r.id)"
                    style="cursor: pointer; text-decoration: underline;"
                  >{{ t("calc.row.itemRequired") }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="isLimitItemsExpanded(r.id) && getLimitItemUsageItems(r).length > 0">
                  <span class="calcRow__num calcRow__num--text">
                    <template v-for="(item, idx) in getLimitItemUsageItems(r)" :key="idx">
                      <span :class="{ 'calcRow__num--danger': item.isDanger }">{{ item.label }} {{ item.value }}</span>
                      <span v-if="idx < getLimitItemUsageItems(r).length - 1">, </span>
                    </template>
                  </span>
                </span>
              </span>
            </div>

            <!-- 使用行（展開時のみ表示） -->
            <div
              v-if="isExpanded(r.id) && calc.getPokemonResult(r.id)"
              data-testid="resultRowReachable"
              class="calcRow__resultRow calcRow__resultRow--used"
              :style="hasLimit(r) && getTheoreticalResources(r) && getTheoreticalShortageType(r) !== null ? 'margin-top: 0; padding-top: 4px; border-top-left-radius: 0; border-top-right-radius: 0;' : ''"
            >
              <span class="calcRow__expandIcon" style="visibility: hidden"></span>
              <span class="calcRow__resultLabel">{{ t("calc.row.used") }}</span>
              <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'reachable', 'boost') }">{{ calc.fmtNum(calc.getPokemonResult(r.id)!.reachableItems.boostCount) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'reachable', 'normal') }">{{ calc.fmtNum(calc.getPokemonResult(r.id)!.reachableItems.normalCount) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'reachable', 'candy') }">{{ calc.fmtNum(calc.getPokemonResult(r.id)!.reachableItems.boostCount + calc.getPokemonResult(r.id)!.reachableItems.normalCount) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'reachable', 'shards') }">{{ calc.fmtNum(calc.getPokemonResult(r.id)!.reachableItems.shardsCount) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="getResultItemUsageItems(r).length > 0">
                  <span class="calcRow__k">{{ t("calc.row.itemUsage") }}</span>
                  <span class="calcRow__num calcRow__num--text">
                    <template v-for="(item, idx) in getResultItemUsageItems(r)" :key="idx">
                      <span :class="{ 'calcRow__num--danger': item.isDanger }">{{ item.label }} {{ item.value }}</span>
                      <span v-if="idx < getResultItemUsageItems(r).length - 1">, </span>
                    </template>
                  </span>
                </span>
                <!-- 主要な不足要因（到達Lvの前に表示） -->
                {{ ' ' }}<span class="calcRow__res" v-if="calc.getPokemonResult(r.id)!.diagnosis.limitingFactor === 'candy'">
                  <span class="calcRow__k calcRow__k--danger">{{ t("calc.row.candyShortage") }}</span>
                  <span class="calcRow__num calcRow__num--danger">{{ calc.getPokemonResult(r.id)!.shortage.candy }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.getPokemonResult(r.id)!.diagnosis.limitingFactor === 'boost'">
                  <span class="calcRow__k calcRow__k--danger">{{ t("calc.row.boostCandyShortage") }}</span>
                  <span class="calcRow__num calcRow__num--danger">{{ calc.getPokemonResult(r.id)!.shortage.boost }}</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.getPokemonResult(r.id)!.diagnosis.limitingFactor === 'shards'">
                  <span class="calcRow__k calcRow__k--danger">{{ t("calc.row.shardsShortage") }}</span>
                  <span class="calcRow__num calcRow__num--danger">{{ calc.fmtNum(calc.getPokemonResult(r.id)!.shortage.shards) }}</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k calcRow__k--info">{{ t("calc.row.reachedLv") }}</span>
                  <span class="calcRow__num calcRow__num--info">{{ calc.getPokemonResult(r.id)!.reachedLevel }}</span>
                  <span class="calcRow__k calcRow__k--info" v-if="calc.getPokemonResult(r.id)!.expToNextLevel > 0" style="margin-left: 4px;">({{ t("calc.row.expRemaining") }}</span>
                  <span class="calcRow__num calcRow__num--info" v-if="calc.getPokemonResult(r.id)!.expToNextLevel > 0">{{ calc.fmtNum(calc.getPokemonResult(r.id)!.expToNextLevel) }}</span><span class="calcRow__k calcRow__k--info" v-if="calc.getPokemonResult(r.id)!.expToNextLevel > 0">)</span>
                </span>{{ ' ' }}<span class="calcRow__res" v-if="calc.getPokemonResult(r.id)!.expToTarget > 0">
                  <span class="calcRow__k calcRow__k--info">{{ t("calc.row.remainingExp") }}</span>
                  <span class="calcRow__num calcRow__num--info">{{ calc.fmtNum(calc.getPokemonResult(r.id)!.expToTarget) }}</span>
                  <span class="calcRow__sleepTime" v-if="getSleepTimeText(r.id, calc.getPokemonResult(r.id)!.expToTarget)">
                    {{ getSleepTimeText(r.id, calc.getPokemonResult(r.id)!.expToTarget) }}
                  </span>
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
        <!-- Values approximate Pikachu Lv.1→Lv.10 (mini boost, 0% ratio, no stock) -->
        <div v-if="onboardingActive" class="calcEmpty__demo" data-onboarding="result-row">
          <div class="calcRow__title calcEmpty__demoTitle">{{ t("onboarding.demoTitle") }}</div>
          <div class="calcRow__resultCollapse">
            <div class="calcRow__resultRow calcRow__resultRow--required is-expanded">
              <span class="calcRow__expandIcon">▼</span>
              <span class="calcRow__resultLabel">{{ t("calc.row.required") }}</span>
              <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num">0</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num">45</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.candyTotal") }}</span>
                  <span class="calcRow__num">45</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num">1,619</span>
                </span>
              </span>
            </div>
            <div class="calcRow__resultRow calcRow__resultRow--used">
              <span class="calcRow__expandIcon" style="visibility: hidden"></span>
              <span class="calcRow__resultLabel">{{ t("calc.row.used") }}</span>
              <span class="calcRow__resultItems">{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num">0</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num">31</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.candyTotal") }}</span>
                  <span class="calcRow__num">31</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num">967</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                  <span class="calcRow__k calcRow__k--danger">{{ t("calc.row.shardsShortage") }}</span>
                  <span class="calcRow__num calcRow__num--danger">619</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                   <span class="calcRow__k calcRow__k--info">{{ t("calc.row.reachedLv") }}</span>
                   <span class="calcRow__num calcRow__num--info">8</span>
                   <span class="calcRow__k calcRow__k--info" style="margin-left: 4px;">({{ t("calc.row.expRemaining") }}</span>
                   <span class="calcRow__num calcRow__num--info">160</span><span class="calcRow__k calcRow__k--info">)</span>
                </span>{{ ' ' }}<span class="calcRow__res">
                   <span class="calcRow__k calcRow__k--info">{{ t("calc.row.remainingExp") }}</span>
                   <span class="calcRow__num calcRow__num--info">475</span>
                   <span class="calcRow__sleepTime">{{ t("calc.sleep.remainingDays", { days: 5, hours: 42.5 }) }}</span>
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

    <div v-if="hintState.visible" class="hintOverlay" data-testid="calc-hint-overlay" @click.stop="closeHint"></div>
    <div
      v-if="hintState.visible"
      ref="hintPopoverRef"
      class="hintPopover"
      data-testid="calc-hint-popover"
      :style="{ left: hintState.left + 'px', top: hintState.top + 'px' }"
      @click.stop="handleHintClick"
      v-html="hintState.message"
    ></div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, reactive, nextTick, onUnmounted, inject } from "vue";
import { useI18n } from "vue-i18n";
import LevelPicker from "./LevelPicker.vue";
import type { CalcStore, CalcRowView } from "../composables/useCalcStore";
import { useCandyStore } from "../composables/useCandyStore";
import { getTypeName } from "../domain/pokesleep/pokemon-types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { markForSleep, calcCandyTargetFromSleepExp, calcSleepTimeForExp } from "../domain/pokesleep/sleep-growth";
import { calcExp } from "../domain/pokesleep/exp";
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
const candyStore = useCandyStore();

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
const showNoStockWarning = computed(() => {
  const t = calc.exportActualTotals.value;
  return calc.planResult.value != null && t.boostCandy + t.normalCandy === 0 && t.shards === 0;
});

/**
 * expRemaining の表示値。計算機では常に実際の数値を表示する。
 * レベルアップ直後（expRemaining >= toNext or <= 0）のときは toNext を表示。
 */
function displayExpRemaining(r: CalcRowView): string {
  const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
  if (r.expRemaining >= toNext || r.expRemaining <= 0) return String(toNext);
  return String(r.expRemaining);
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

// 個数指定行の「必要アイテム」展開状態
const expandedLimitItems = ref<Set<string>>(new Set());

function toggleLimitItems(rowId: string) {
  if (expandedLimitItems.value.has(rowId)) {
    expandedLimitItems.value.delete(rowId);
  } else {
    expandedLimitItems.value.add(rowId);
  }
  expandedLimitItems.value = new Set(expandedLimitItems.value);
}

function isLimitItemsExpanded(rowId: string): boolean {
  return expandedLimitItems.value.has(rowId);
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

// アメ使用制限入力時のラッパー（値が設定されたら折りたたみを開く）
function onCandyTargetInput(rowId: string, value: string) {
  calc.onRowCandyTarget(rowId, value);
  // 値が設定されたら自動的に到達可能行を開く
  if (value.trim() !== "") {
    expandedRows.value.add(rowId);
    expandedRows.value = new Set(expandedRows.value);
  }
}

/**
 * 睡眠育成ボタン（1000h/2000h）のハンドラー
 * markForSleep() で睡眠EXPを計算し、calcCandyTargetFromSleepExp() で個数指定値を算出
 */
function applySleepGrowth(rowId: string, targetHours: number) {
  calc.activeRowId.value = rowId;
  const p = calc.getPokemonResult(rowId);
  if (!p) return;

  const sleepSettings = calc.sleepSettings.value;
  const sleepExpBonus = 1.0 + 0.14 * sleepSettings.sleepExpBonusCount;

  // 行データから性格・レベル情報を取得
  const row = calc.rowsView.value.find(r => r.id === rowId);
  if (!row) return;

  // markForSleep で睡眠EXPを計算
  const result = markForSleep({
    targetSleepHours: targetHours,
    nature: row.nature,
    dailySleepHours: sleepSettings.dailySleepHours,
    sleepExpBonus,
    includeGSD: sleepSettings.includeGSD,
  });

  // 現在レベル内で獲得済みのEXPを計算
  // expGot = (srcLevel→srcLevel+1 の必要EXP) - expRemaining
  const toNextLevel = calcExp(row.srcLevel, row.srcLevel + 1, row.expType);
  const expGot = Math.max(0, toNextLevel - row.expRemaining);

  // calcCandyTargetFromSleepExp でアメ個数指定値を計算
  // p.dstLevel と p.dstExpInLevel を使用（動的計算された目標で一貫性を持たせる）
  const candyTarget = calcCandyTargetFromSleepExp({
    srcLevel: row.srcLevel,
    dstLevel: p.dstLevel,
    dstExpInLevel: p.dstExpInLevel ?? 0,
    expType: row.expType,
    nature: row.nature,
    boostKind: calc.boostKind.value,
    targetBoostCandy: p.targetBoost,
    targetNormalCandy: p.targetNormal,
    sleepExp: result.sleepExp,
    expGot,
  });

  // アメ個数指定値をセット
  calc.onRowCandyTarget(rowId, String(candyTarget));

  // 自動的に到達可能行を開く
  expandedRows.value.add(rowId);
  expandedRows.value = new Set(expandedRows.value);
}

/**
 * 残EXPから睡眠時間を計算してフォーマットされたテキストを返す
 */
function getSleepTimeText(rowId: string, expToTarget: number): string | null {
  if (expToTarget <= 0) return null;

  const row = calc.rowsView.value.find(r => r.id === rowId);
  if (!row) return null;

  const sleepSettings = calc.sleepSettings.value;
  const sleepExpBonus = 1.0 + 0.14 * sleepSettings.sleepExpBonusCount;

  const result = calcSleepTimeForExp({
    expToTarget,
    nature: row.nature,
    dailySleepHours: sleepSettings.dailySleepHours,
    sleepExpBonus,
    includeGSD: sleepSettings.includeGSD,
  });

  return t("calc.sleep.remainingDays", { days: result.requiredDays, hours: result.requiredHours });
}

// モバイルでのキーボード閉じた後のスクロール位置修正
// _navScrolling フラグ: MobileNav のスクロール直後は blur 補正を抑止するため
let _navScrolling = false;
function setNavScrolling() {
  _navScrolling = true;
  setTimeout(() => { _navScrolling = false; }, 300);
}
defineExpose({ setNavScrolling });

function handleInputBlur(event: FocusEvent) {
  // iOS Safari でキーボードを閉じた後にスクロール位置がずれる問題の対策
  // 少し待ってからスクロール位置を調整
  const target = event.target as HTMLElement;
  if (target) {
    setTimeout(() => {
      // MobileNav によるスクロール中は補正しない
      if (_navScrolling) return;
      // 入力欄がstickyヘッダーに隠れていたら戻す
      const rect = target.getBoundingClientRect();
      // 320px = sticky header height (approx)
      if (rect.top < 320 || rect.bottom > window.innerHeight) {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }, 100);
  }
}
// 行から pokedexId を取得（保存済み or boxId から解決）
function getRowPokedexId(r: { pokedexId?: number; boxId?: string }): number | undefined {
  if (r.pokedexId) return r.pokedexId;
  if (r.boxId && props.resolvePokedexIdByBoxId) {
    return props.resolvePokedexIdByBoxId(r.boxId);
  }
  return undefined;
}

// PokemonLevelUpResult への直接アクセス: calc.getPokemonResult(rowId) を使用

// アイテム使用リストの項目型
type ItemUsageItem = { label: string; value: number; isDanger: boolean };

// アイテム使用リストの赤字判定モード
type ItemDangerMode = 'target' | 'limit' | 'reachable';

// 共通ヘルパー: アイテム使用リストを生成
function buildItemUsageList(
  r: CalcRowView,
  mode: ItemDangerMode
): ItemUsageItem[] {
  const p = calc.getPokemonResult(r.id);
  if (!p) return [];

  // モードに応じてアイテムソースを決定
  let sourceItems: typeof p.targetItems;
  switch (mode) {
    case 'target':
      sourceItems = p.targetItems;
      break;
    case 'limit':
      if (!hasLimit(r)) return [];
      sourceItems = p.candyTargetItems ?? p.targetItems;
      break;
    case 'reachable':
      sourceItems = p.reachableItems;
      break;
  }

  const items: ItemUsageItem[] = [];
  const typeName = getTypeName(p.type, locale.value);
  const uniLabel = t("calc.export.labelUni");

  // 在庫を取得（limit モード用）
  const uniStock = candyStore.universalCandy.value;
  const typeStock = candyStore.getTypeCandyFor(p.type);

  // 赤字判定関数
  const getDanger = (itemType: 'typeS' | 'typeM' | 'uniS' | 'uniM' | 'uniL', value: number): boolean => {
    if (mode === 'limit') {
      // 個数指定行: 各在庫超過時に赤字
      switch (itemType) {
        case 'typeS': return value > typeStock.s;
        case 'typeM': return value > typeStock.m;
        case 'uniS': return value > uniStock.s;
        case 'uniM': return value > uniStock.m;
        case 'uniL': return value > uniStock.l;
      }
    } else if (mode === 'target') {
      // 目標まで行: 万能Sのみ、不足時かつ個数指定なしで赤字
      if (itemType === 'uniS') {
        const hasLimitValue = r.candyTarget != null && r.candyTarget >= 0;
        return p.shortage.candy > 0 && !hasLimitValue;
      }
      return false;
    } else {
      // 到達可能行: 万能Sのみ、不足時に赤字
      if (itemType === 'uniS') {
        return p.shortage.candy > 0;
      }
      return false;
    }
  };

  // タイプアメ
  if (sourceItems.typeS > 0) {
    items.push({ label: `${typeName}S`, value: sourceItems.typeS, isDanger: getDanger('typeS', sourceItems.typeS) });
  }
  if (sourceItems.typeM > 0) {
    items.push({ label: `${typeName}M`, value: sourceItems.typeM, isDanger: getDanger('typeM', sourceItems.typeM) });
  }

  // 万能アメ
  if (sourceItems.universalS > 0) {
    items.push({ label: `${uniLabel}S`, value: sourceItems.universalS, isDanger: getDanger('uniS', sourceItems.universalS) });
  }
  if (sourceItems.universalM > 0) {
    items.push({ label: `${uniLabel}M`, value: sourceItems.universalM, isDanger: getDanger('uniM', sourceItems.universalM) });
  }
  if (sourceItems.universalL > 0) {
    items.push({ label: `${uniLabel}L`, value: sourceItems.universalL, isDanger: getDanger('uniL', sourceItems.universalL) });
  }

  // 余り
  const usedTypeOrUniCandy = sourceItems.typeS > 0 || sourceItems.typeM > 0 ||
    sourceItems.universalS > 0 || sourceItems.universalM > 0 || sourceItems.universalL > 0;
  if (sourceItems.surplus > 0 && usedTypeOrUniCandy) {
    items.push({ label: t("calc.candy.surplus"), value: sourceItems.surplus, isDanger: false });
  }

  return items;
}

// 目標まで行用（後方互換ラッパー）
function getItemUsageItems(r: CalcRowView): ItemUsageItem[] {
  return buildItemUsageList(r, 'target');
}

// 個数指定行用（後方互換ラッパー）
function getLimitItemUsageItems(r: CalcRowView): ItemUsageItem[] {
  return buildItemUsageList(r, 'limit');
}

// 到達可能行用（後方互換ラッパー）
function getResultItemUsageItems(r: CalcRowView): ItemUsageItem[] {
  return buildItemUsageList(r, 'reachable');
}

// アイテム使用があるか判定（目標まで行用 = targetItems）
// 種族アメのみで足りた場合はfalse、タイプアメまたは万能アメを使用した場合のみtrue
function hasItemUsage(r: CalcRowView): boolean {
  const p = calc.getPokemonResult(r.id);
  if (!p) return false;
  const items = p.targetItems;
  return (
    items.universalS > 0 ||
    items.universalM > 0 ||
    items.universalL > 0 ||
    items.typeS > 0 ||
    items.typeM > 0
  );
}

// ============================================================
// 不足判定ヘルパー
// ============================================================

// 赤字判定
function isDanger(
  r: CalcRowView,
  row: 'target' | 'limit' | 'reachable',
  field: 'boost' | 'normal' | 'candy' | 'shards'
): boolean {
  const p = calc.getPokemonResult(r.id);
  if (!p) return false;

  if (field === 'normal' && calc.boostKind.value === 'none') return false;

  const hasLimitValue = r.candyTarget != null && r.candyTarget >= 0;
  if (row === 'target' && hasLimitValue) return false;

  switch (field) {
    case 'boost': return p.shortage.boost > 0;
    case 'normal': return p.shortage.normal > 0;
    case 'candy': return p.shortage.candy > 0;
    case 'shards': return p.shortage.shards > 0;
  }
}

// アメ不足判定（🍬アイコン用）
function isCandyShort(r: CalcRowView): boolean {
  const p = calc.getPokemonResult(r.id);
  if (!p) return false;
  return p.shortage.candy > 0;
}

// 個数指定があるか
function hasLimit(r: CalcRowView): boolean {
  return r.candyTarget != null && r.candyTarget >= 0;
}

// 個数指定がある場合の理論値ベースのリソースを取得
interface TheoreticalResources {
  candy: number;
  boostCandy: number;
  normalCandy: number;
  shards: number;
}
function getTheoreticalResources(r: CalcRowView): TheoreticalResources | null {
  if (!hasLimit(r)) return null;

  const p = calc.getPokemonResult(r.id);
  if (!p) return null;

  const boostCandy = p.candyTargetBoost ?? p.targetBoost;
  const normalCandy = p.candyTargetNormal ?? p.targetNormal;
  const shards = p.candyTargetShards ?? p.targetShards;

  return {
    candy: boostCandy + normalCandy,
    boostCandy,
    normalCandy,
    shards,
  };
}

// 個数指定がある場合、理論値ベースで最初に不足したリソース種類を判定
// 順序: アメブ → アメ → かけら
type ShortageType = "boost" | "candy" | "shards" | null;
function getTheoreticalShortageType(r: CalcRowView): ShortageType {
  if (!hasLimit(r)) return null;

  const p = calc.getPokemonResult(r.id);
  if (!p) return null;

  // diagnosis.limitingFactor を直接使用
  return p.diagnosis.limitingFactor;
}

// ヒントアイコン用
// ヒントポップオーバーの状態
const hintState = ref<{ visible: boolean; message: string; left: number; top: number }>({
  visible: false,
  message: "",
  left: 0,
  top: 0
});
const hintPopoverRef = ref<HTMLElement | null>(null);

async function showHint(ev: MouseEvent, message: string) {
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
    message,
    left,
    top: rect.bottom + gap,
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

/**
 * ツールチップ内のクリックを処理
 * data-action属性を持つボタンのアクションを実行
 */
function handleHintClick(ev: MouseEvent) {
  const target = ev.target as HTMLElement;
  const action = target.dataset?.action;

  if (action === 'open-settings') {
    closeHint();
    emit('open-settings');
  }
}

</script>
