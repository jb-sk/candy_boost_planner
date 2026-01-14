<template>
  <section id="neo-calc" class="panel panel--calc">
    <div class="panel__head">
      <h2 class="panel__title">{{ t("calc.title") }}</h2>
    </div>
    <div class="calcTop">
      <div class="calcTop__row">
        <div class="calcTop__field">
          <span class="calcTop__label">{{ t("calc.boostRemainingLabel") }}</span>
          <input
            :value="calc.boostCandyRemainingText.value"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            class="field__input field__input--sm field__input--compact"
            :placeholder="t('calc.boostRemainingPlaceholder', { cap: calc.fmtNum(calc.boostCandyDefaultCap.value) })"
            :title="t('calc.boostRemainingHelp')"
            @input="calc.onBoostCandyRemainingInput(($event.target as HTMLInputElement).value)"
            :disabled="calc.boostKind.value === 'none'"
          />
        </div>
        <div class="calcTop__field">
          <span class="calcTop__label">{{ t("calc.maxShardsLabel") }}</span>
          <input
            :value="calc.totalShardsText.value"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            class="field__input field__input--sm field__input--compact"
            @input="calc.onTotalShardsInput(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="calcTop__field calcTop__field--candy">
          <span class="calcTop__label">{{ t("calc.candy.universalLabel") }}</span>
          <div class="candyInputs">
            <label class="candyInput candyInput--md">
              <span class="candyInput__label">{{ t("calc.candy.universalS") }}</span>
              <input
                type="number"
                min="0"
                class="field__input field__input--xs field__input--compact"
                :value="candyStore.universalCandy.value.s"
                @input="candyStore.updateUniversalCandy({ s: parseInt(($event.target as HTMLInputElement).value) || 0 })"
              />
            </label>
            <label class="candyInput candyInput--md">
              <span class="candyInput__label">{{ t("calc.candy.universalM") }}</span>
              <input
                type="number"
                min="0"
                class="field__input field__input--xs field__input--compact"
                :value="candyStore.universalCandy.value.m"
                @input="candyStore.updateUniversalCandy({ m: parseInt(($event.target as HTMLInputElement).value) || 0 })"
              />
            </label>
            <label class="candyInput candyInput--md">
              <span class="candyInput__label">{{ t("calc.candy.universalL") }}</span>
              <input
                type="number"
                min="0"
                class="field__input field__input--xs field__input--compact"
                :value="candyStore.universalCandy.value.l"
                @input="candyStore.updateUniversalCandy({ l: parseInt(($event.target as HTMLInputElement).value) || 0 })"
              />
            </label>
          </div>
        </div>
      </div>
      <details class="calcTop__typeCandy">
        <summary class="calcTop__typeCandyToggle">{{ t("calc.sleep.sectionToggle") }}</summary>
        <!-- 睡眠育成設定 -->
        <div class="calcTop__sleepRow">
          <label class="sleepField">
            <span class="sleepField__label">{{ t("calc.sleep.dailySleepLabel") }}</span>
            <input
              type="number"
              min="1"
              max="13"
              step="0.5"
              class="field__input field__input--xs field__input--compact"
              :value="calc.sleepSettings.value.dailySleepHours"
              @input="calc.updateSleepSettings({ dailySleepHours: parseFloat(($event.target as HTMLInputElement).value) || 8.5 })"
            />
            <span class="sleepField__unit">{{ t("calc.sleep.dailySleepUnit") }}</span>
          </label>
          <label class="sleepField">
            <span class="sleepField__label">{{ t("calc.sleep.sleepExpBonusLabel") }}</span>
            <select
              class="field__input field__input--compact"
              :value="calc.sleepSettings.value.sleepExpBonusCount"
              @change="calc.updateSleepSettings({ sleepExpBonusCount: parseInt(($event.target as HTMLSelectElement).value) || 0 })"
            >
              <option v-for="n in 6" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
            </select>
          </label>
          <label class="sleepField sleepField--checkbox" :title="t('calc.sleep.includeGSDTitle')">
            <input
              type="checkbox"
              :checked="calc.sleepSettings.value.includeGSD"
              @change="calc.updateSleepSettings({ includeGSD: ($event.target as HTMLInputElement).checked })"
            />
            <span class="sleepField__label">{{ t("calc.sleep.includeGSDLabel") }}</span>
          </label>
        </div>
        <div class="calcTop__typeCandyGrid">
          <div v-for="typeName in pokemonTypes" :key="typeName" class="typeRow">
            <span class="typeRow__name">{{ getTypeName(typeName, locale) }}</span>
            <label class="candyInput candyInput--sm">
              <span class="candyInput__label">{{ t("calc.candy.typeS") }}</span>
              <input
                type="number"
                min="0"
                class="field__input field__input--xs field__input--compact"
                :value="candyStore.getTypeCandyFor(typeName).s"
                @input="candyStore.updateTypeCandy(typeName, { s: parseInt(($event.target as HTMLInputElement).value) || 0 })"
              />
            </label>
            <label class="candyInput candyInput--sm">
              <span class="candyInput__label">{{ t("calc.candy.typeM") }}</span>
              <input
                type="number"
                min="0"
                class="field__input field__input--xs field__input--compact"
                :value="candyStore.getTypeCandyFor(typeName).m"
                @input="candyStore.updateTypeCandy(typeName, { m: parseInt(($event.target as HTMLInputElement).value) || 0 })"
              />
            </label>
          </div>
        </div>
      </details>
    </div>

    <div class="calcSticky">
      <div class="calcSticky__summary">
        <div class="calcSum calcSum--hi" v-if="calc.boostKind.value !== 'none'" :class="{ 'calcSum--danger': calc.boostCandyOver.value > 0 }">
          <div class="calcSum__k">{{ t("calc.export.sumBoostTotal") }}</div>
          <div class="calcSum__v">{{ calc.fmtNum(calc.totalBoostCandyUsed.value) }}</div>
        </div>
        <div class="calcSum calcSum--hi" :class="{ 'calcSum--danger': calc.shardsOver.value > 0 }">
          <div class="calcSum__k">{{ t("calc.shardsTotal") }}</div>
          <div class="calcSum__v">{{ calc.fmtNum(calc.totalShardsUsed.value) }}</div>
        </div>
        <div class="calcSum calcSum--candy" v-if="calc.planResult.value">
          <div class="calcSum__k">{{ t("calc.candy.usageLabel") }}</div>
          <div class="calcSum__v">
            <span :class="{ 'calcSum__v--over': calc.universalCandyUsagePct.value > 100 }">
              {{ calc.universalCandyUsagePct.value }}%
            </span>
            <span class="calcSum__candyDetails">
              S: {{ calc.universalCandyNeeded.value.s }}/{{ candyStore.universalCandy.value.s }},
              M: {{ calc.universalCandyNeeded.value.m }}/{{ candyStore.universalCandy.value.m }},
              L: {{ calc.universalCandyNeeded.value.l }}/{{ candyStore.universalCandy.value.l }}
            </span>
          </div>
        </div>
      </div>
      <div
        class="calcSum calcSum--bar calcSum--sparkle"
        :class="{
          'calcSum--danger': calc.shardsOver.value > 0 || calc.boostCandyOver.value > 0,
          'calcSum--muted': calc.shardsCap.value <= 0,
        }"
      >
        <div class="calcBarBlock calcBarBlock--candy" v-if="calc.boostKind.value !== 'none'" :class="{ 'calcBarBlock--danger': calc.boostCandyOver.value > 0 }">
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

        <div class="calcBarBlock">
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

    <div class="calcActions">
      <button class="btn btn--primary" type="button" @click="calc.openExport()" :disabled="!calc.rowsView.value.length">
        {{ t("calc.export.open") }}
      </button>
      <button class="btn btn--danger" type="button" @click="calc.clear()" :disabled="!calc.rowsView.value.length">
        {{ t("calc.clearPokemons") }}
      </button>
      <button class="btn btn--ghost" type="button" @click="calc.undo()" :disabled="!calc.canUndo.value">
        {{ t("common.undo") }}
      </button>
      <button class="btn btn--ghost" type="button" @click="calc.redo()" :disabled="!calc.canRedo.value">
        {{ t("common.redo") }}
      </button>
    </div>




    <div class="calcSlots">
      <div class="slotTabs">
        <template v-for="i in 3" :key="i">
          <!-- 選択中タブ: セレクター -->
          <div
            v-if="calc.activeSlotTab.value === i - 1"
            class="slotTab slotTab--active"
          >
            <select
              class="slotTab__select"
              :value="calc.boostKind.value"
              @change="calc.setSlotBoostKind(($event.target as HTMLSelectElement).value as any)"
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
            @click="calc.switchToSlot(i - 1)"
          >
            {{ getSlotBoostKindLabel(i - 1) }}
          </button>
        </template>
      </div>
    </div>

    <!-- コンテンツエリアのラッパー -->
    <div class="calcSlotContainer">
      <div class="calcRows" v-if="calc.rowsView.value.length">
      <div
        v-for="r in calc.rowsView.value"
        :key="r.id"
        class="calcRow"
        :class="{
          'calcRow--active': r.id === calc.activeRowId.value,
          'calcRow--dragOver': r.id === calc.dragOverRowId.value,
          'calcRow--dragging': r.id === calc.dragRowId.value,
        }"
        @click="calc.activeRowId.value = r.id"
        @dragover.prevent="calc.onRowDragOver(r.id)"
        @drop.prevent="calc.onRowDrop(r.id)"
        @dragleave="calc.onRowDragLeave(r.id)"
      >
        <div class="calcRow__head">
          <div class="calcRow__headLeft">
            <button
              class="btn btn--ghost btn--xs calcRow__dragHandle"
              type="button"
              :title="t('calc.row.dragReorder')"
              :aria-label="t('calc.row.dragReorder')"
              draggable="true"
              @dragstart="calc.onRowDragStart(r.id, $event)"
              @dragend="calc.onRowDragEnd"
              @click.stop
            >
              ⋮⋮
            </button>
            <span v-if="r.nature === 'up'" class="calcRow__natureIcon calcRow__natureIcon--up" title="EXP+20%">▲</span>
            <span v-else-if="r.nature === 'down'" class="calcRow__natureIcon calcRow__natureIcon--down" title="EXP-20%">▼</span>
            <div class="calcRow__title">{{ r.title }}</div>
          </div>
          <div class="calcRow__headRight">
            <button class="linkBtn" type="button" @click.stop="calc.moveRowUp(r.id)" :disabled="!calc.canMoveRowUp(r.id)">↑</button>
            <button class="linkBtn" type="button" @click.stop="calc.moveRowDown(r.id)" :disabled="!calc.canMoveRowDown(r.id)">↓</button>
            <button
              v-if="r.boxId"
              class="linkBtn"
              type="button"
              @click.stop="$emit('apply-to-box', r.id)"
              :title="t('calc.applyToBoxTitle')"
            >
              {{ t("calc.applyToBox") }}
            </button>
            <button class="linkBtn linkBtn--danger" type="button" @click.stop="calc.removeRowById(r.id)">{{ t("common.delete") }}</button>
          </div>
        </div>

        <div class="calcRow__grid" :class="{ 'calcRow__grid--normal': calc.boostKind.value === 'none' }">
          <label class="field field--sm">
            <span class="field__label">{{ t("calc.row.srcLevel") }}</span>
            <div class="levelPick">
              <button
                type="button"
                class="field__input field__input--button levelPick__button"
                @click.stop="calc.openSrcLevelPick(r.id)"
                aria-haspopup="dialog"
                :aria-expanded="calc.openLevelPickRowId.value === r.id && calc.openLevelPickKind.value === 'src'"
              >
                {{ r.srcLevel }}
              </button>

              <div
                v-if="calc.openLevelPickRowId.value === r.id && calc.openLevelPickKind.value === 'src'"
                class="levelPick__popover"
                role="dialog"
                :aria-label="t('calc.row.pickLevelAria', { label: t('calc.row.srcLevel') })"
              >
                <div class="levelPick__top">
                  <div class="levelPick__title">{{ t("calc.row.srcLevel") }}: Lv{{ r.srcLevel }}</div>
                  <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="calc.closeLevelPick()">
                    {{ t("common.close") }}
                  </button>
                </div>

                <div class="levelPick__sliderRow">
                  <button class="btn btn--ghost btn--xs" type="button" @click="calc.nudgeSrcLevel(r.id, -1)" :disabled="r.srcLevel <= 1">
                    ◀
                  </button>
                  <input
                    class="levelPick__range"
                    type="range"
                    min="1"
                    :max="r.dstLevel"
                    step="1"
                    :value="r.srcLevel"
                    @input="calc.setSrcLevel(r.id, ($event.target as HTMLInputElement).value)"
                  />
                  <button class="btn btn--ghost btn--xs" type="button" @click="calc.nudgeSrcLevel(r.id, 1)" :disabled="r.srcLevel >= r.dstLevel">
                    ▶
                  </button>
                </div>

                <div class="levelPick__chips">
                  <button
                    v-for="lv in levelPresets"
                    :key="`src_${lv}`"
                    type="button"
                    class="levelChip"
                    :class="{ 'levelChip--on': lv === r.srcLevel }"
                    @click="calc.setSrcLevel(r.id, lv)"
                    :disabled="lv < 1 || lv > r.dstLevel"
                  >
                    {{ lv }}
                  </button>
                </div>
              </div>
            </div>
          </label>

          <label class="field field--sm">
            <span class="field__label">{{ t("calc.row.expRemaining") }}</span>
            <input
              :value="r.expRemaining"
              type="number"
              min="0"
              class="field__input"
              @input="calc.onRowExpRemaining(r.id, ($event.target as HTMLInputElement).value)"
            />
          </label>

          <label class="field field--sm">
            <span class="field__label">
              {{ t("calc.row.dstLevel") }}
              <span v-if="r.expLeftNext > 0" style="font-weight:normal; margin-left:4px; opacity:0.8">
                {{ t("calc.row.expLeftNext", { exp: calc.fmtNum(r.expLeftNext) }) }}
              </span>
            </span>
            <div class="levelPick">
              <button
                type="button"
                class="field__input field__input--button levelPick__button"
                @click.stop="calc.openDstLevelPick(r.id)"
                aria-haspopup="dialog"
                :aria-expanded="calc.openLevelPickRowId.value === r.id && calc.openLevelPickKind.value === 'dst'"
              >
                {{ r.dstLevel }}
              </button>

              <div
                v-if="calc.openLevelPickRowId.value === r.id && calc.openLevelPickKind.value === 'dst'"
                class="levelPick__popover"
                role="dialog"
                :aria-label="t('calc.row.pickLevelAria', { label: t('calc.row.dstLevel') })"
              >
                <div class="levelPick__top">
                  <div class="levelPick__title">
                    Lv{{ r.srcLevel }} → Lv{{ r.dstLevel }}
                    <span v-if="isCandyShort(r)" title="アメ不足" style="font-size: 1.2em; vertical-align: middle; margin-left: 4px;">🍬</span>
                  </div>
                  <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="calc.closeLevelPick()">
                    {{ t("common.close") }}
                  </button>
                </div>

                <div class="levelPick__sliderRow">
                  <button
                    class="btn btn--ghost btn--xs"
                    type="button"
                    @click="calc.nudgeDstLevel(r.id, -1)"
                    :disabled="r.dstLevel <= r.srcLevel"
                  >
                    ◀
                  </button>
                  <input
                    class="levelPick__range"
                    type="range"
                    :min="r.srcLevel"
                    :max="MAX_LEVEL"
                    step="1"
                    :value="r.dstLevel"
                    @input="calc.setDstLevel(r.id, ($event.target as HTMLInputElement).value)"
                  />
                  <button class="btn btn--ghost btn--xs" type="button" @click="calc.nudgeDstLevel(r.id, 1)" :disabled="r.dstLevel >= MAX_LEVEL">
                    ▶
                  </button>
                </div>

                <div class="levelPick__chips">
                  <button
                    v-for="lv in levelPresets"
                    :key="lv"
                    type="button"
                    class="levelChip"
                    :class="{ 'levelChip--on': lv === r.dstLevel }"
                    @click="calc.setDstLevel(r.id, lv)"
                    :disabled="lv < r.srcLevel"
                  >
                    {{ lv }}
                  </button>
                </div>
              </div>
            </div>
          </label>
          <label class="field field--sm" v-if="getRowPokedexId(r)">
            <span class="field__label">{{ t("calc.row.speciesCandy") }}</span>
            <input
              type="number"
              min="0"
              class="field__input"
              :value="candyStore.getSpeciesCandyFor(getRowPokedexId(r)!)"
              @input="candyStore.updateSpeciesCandy(getRowPokedexId(r)!, parseInt(($event.target as HTMLInputElement).value) || 0)"
            />
          </label>

          <label class="field field--sm field--boost-control" :class="{ 'is-none': calc.boostKind.value === 'none' }">
            <span class="field__label">{{ calc.boostKind.value === 'none' ? t("calc.row.boostReachLevelNormal") : t("calc.row.boostReachLevel") }}</span>
            <div class="levelPick">
              <button
                type="button"
                class="field__input field__input--button levelPick__button"
                @click.stop="calc.openBoostLevelPick(r.id)"
                aria-haspopup="dialog"
                :aria-expanded="calc.openLevelPickRowId.value === r.id && calc.openLevelPickKind.value === 'boost'"
                :disabled="calc.boostKind.value === 'none'"
              >
                {{ r.ui.boostReachLevel }}
              </button>

              <div
                v-if="calc.openLevelPickRowId.value === r.id && calc.openLevelPickKind.value === 'boost'"
                class="levelPick__popover"
                role="dialog"
                :aria-label="t('calc.row.pickLevelAria', { label: t('calc.row.boostReachLevel') })"
              >
                <div class="levelPick__top">
                  <div class="levelPick__title">
                    Lv{{ r.srcLevel }} → Lv{{ r.ui.boostReachLevel }}
                    <span v-if="isCandyShort(r)" title="アメ不足" style="font-size: 1.2em; vertical-align: middle; margin-left: 4px;">🍬</span>
                  </div>
                  <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="calc.closeLevelPick()">
                    {{ t("common.close") }}
                  </button>
                </div>

                <div class="levelPick__sliderRow">
                  <button class="btn btn--ghost btn--xs" type="button" @click="calc.nudgeBoostLevel(r.id, -1)" :disabled="r.ui.boostReachLevel <= r.srcLevel">
                    ◀
                  </button>
                  <input
                    class="levelPick__range"
                    type="range"
                    :min="r.srcLevel"
                    :max="r.dstLevel"
                    step="1"
                    :value="r.ui.boostReachLevel"
                    @input="calc.setBoostLevel(r.id, ($event.target as HTMLInputElement).value)"
                  />
                  <button class="btn btn--ghost btn--xs" type="button" @click="calc.nudgeBoostLevel(r.id, 1)" :disabled="r.ui.boostReachLevel >= r.dstLevel">
                    ▶
                  </button>
                </div>

                <div class="levelPick__chips">
                  <button
                    v-for="lv in levelPresets"
                    :key="`boost_${lv}`"
                    type="button"
                    class="levelChip"
                    :class="{ 'levelChip--on': lv === r.ui.boostReachLevel }"
                    @click="calc.setBoostLevel(r.id, lv)"
                    :disabled="lv < r.srcLevel || lv > r.dstLevel"
                  >
                    {{ lv }}
                  </button>
                </div>
              </div>
            </div>
          </label>
          <label class="field field--sm field--boost-control" :class="{ 'is-none': calc.boostKind.value === 'none' }">
            <span class="field__label">{{ calc.boostKind.value === 'none' ? t("calc.row.boostRatioNormal") : t("calc.row.boostRatio") }}</span>
            <input
              :value="r.ui.boostRatioPct"
              type="range"
              min="0"
              max="100"
              step="1"
              class="field__range"
              @input="calc.onRowBoostRatio(r.id, ($event.target as HTMLInputElement).value)"
              :disabled="calc.boostKind.value === 'none'"
            />
            <span class="field__sub">{{ r.ui.boostRatioPct }}%</span>
          </label>
          <label class="field field--sm">
            <span class="field__label">
              {{ calc.boostKind.value === 'none' ? t("calc.row.boostCandyCountNormal") : t("calc.row.boostCandyCount") }}
              <button
                type="button"
                class="hintIcon"
                @click.stop="showHint($event, calc.boostKind.value === 'none' ? t('calc.row.boostCandyCountNormalHint') : t('calc.row.boostCandyCountHint'))"
              >?</button>
            </span>
            <input
              :value="r.ui.boostCandyInput"
              type="number"
              min="0"
              class="field__input"
              @input="calc.onRowBoostCandy(r.id, ($event.target as HTMLInputElement).value)"
              @blur="handleInputBlur"
            />
          </label>
          <div class="field field--sm field--sleepTarget">
            <div class="field__labelRow">
              <span class="field__label">{{ t("calc.row.candyTarget") }}</span>
            </div>
            <input
              type="number"
              min="0"
              class="field__input"
              :value="r.candyTarget ?? ''"
              :placeholder="t('calc.row.candyTargetNone')"
              @input="onCandyTargetInput(r.id, ($event.target as HTMLInputElement).value)"
            />
            <div class="sleepLinks">
              <button
                type="button"
                class="sleepChip"
                @click.stop="applySleepGrowth(r.id, 1000)"
                :title="t('calc.sleep.btn1000h')"
              >1000h</button>
              <button
                type="button"
                class="sleepChip"
                @click.stop="applySleepGrowth(r.id, 2000)"
                :title="t('calc.sleep.btn2000h')"
              >2000h</button>
              <button
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
            class="calcRow__resultRow calcRow__resultRow--required"
            :class="{ 'is-expanded': isExpanded(r.id) }"
            @click="toggleExpand(r.id)"
          >
            <span class="calcRow__expandIcon">{{ isExpanded(r.id) ? '▼' : '▶' }}</span>
            <span class="calcRow__resultLabel">{{ t("calc.row.required") }}</span>
            <span class="calcRow__resultItems">
              <span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'target', 'boost') }">{{ calc.fmtNum(getResult(r.id)?.targetBoost ?? 0) }}</span>
              </span>
              <span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'target', 'normal') }">{{ calc.fmtNum(getResult(r.id)?.targetNormal ?? 0) }}</span>
              </span>
              <span class="calcRow__res">
                <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'target', 'candy') }">{{ calc.fmtNum((getResult(r.id)?.targetBoost ?? 0) + (getResult(r.id)?.targetNormal ?? 0)) }}</span>
              </span>
              <span class="calcRow__res">
                <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'target', 'shards') }">{{ calc.fmtNum(getResult(r.id)?.targetShards ?? 0) }}</span>
              </span>
              <span class="calcRow__res" v-if="hasItemUsage(r)">
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
              v-if="isExpanded(r.id) && hasLimit(r) && getTheoreticalResources(r) && getResult(r.id)?.diagnosis.limitingFactor !== null"
              class="calcRow__resultRow calcRow__resultRow--used"
              style="margin-bottom: 0; padding-bottom: 4px; border-bottom-left-radius: 0; border-bottom-right-radius: 0;"
            >
              <span class="calcRow__expandIcon" style="visibility: hidden"></span>
              <span class="calcRow__resultLabel">{{ t("calc.row.candyTargetRow") }}</span>
              <span class="calcRow__resultItems">
                <span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'limit', 'boost') }">{{ calc.fmtNum(getTheoreticalResources(r)!.boostCandy) }}</span>
                </span>
                <span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'limit', 'normal') }">{{ calc.fmtNum(getTheoreticalResources(r)!.normalCandy) }}</span>
                </span>
                <span class="calcRow__res">
                  <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'limit', 'candy') }">{{ calc.fmtNum(getTheoreticalResources(r)!.candy) }}</span>
                </span>
                <span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'limit', 'shards') }">{{ calc.fmtNum(getTheoreticalResources(r)!.shards) }}</span>
                </span>
                <span class="calcRow__res" v-if="getLimitItemUsageItems(r).length > 0">
                  <span
                    class="calcRow__k calcRow__k--link"
                    @click.stop="toggleLimitItems(r.id)"
                    style="cursor: pointer; text-decoration: underline;"
                  >{{ t("calc.row.itemRequired") }}</span>
                </span>
                <span class="calcRow__res" v-if="isLimitItemsExpanded(r.id) && getLimitItemUsageItems(r).length > 0">
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
              v-if="isExpanded(r.id) && getResult(r.id)"
              class="calcRow__resultRow calcRow__resultRow--used"
              :style="hasLimit(r) && getTheoreticalResources(r) && getTheoreticalShortageType(r) !== null ? 'margin-top: 0; padding-top: 4px; border-top-left-radius: 0; border-top-right-radius: 0;' : ''"
            >
              <span class="calcRow__expandIcon" style="visibility: hidden"></span>
              <span class="calcRow__resultLabel">{{ t("calc.row.used") }}</span>
              <span class="calcRow__resultItems">
                <span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'reachable', 'boost') }">{{ calc.fmtNum(getResult(r.id)!.reachableItems.boostCount) }}</span>
                </span>
                <span class="calcRow__res" v-if="calc.boostKind.value !== 'none'">
                  <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'reachable', 'normal') }">{{ calc.fmtNum(getResult(r.id)!.reachableItems.normalCount) }}</span>
                </span>
                <span class="calcRow__res">
                  <span class="calcRow__k">{{ t(calc.boostKind.value === 'none' ? "calc.row.candy" : "calc.row.candyTotal") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'reachable', 'candy') }">{{ calc.fmtNum(getResult(r.id)!.reachableItems.boostCount + getResult(r.id)!.reachableItems.normalCount) }}</span>
                </span>
                <span class="calcRow__res">
                  <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': isDanger(r, 'reachable', 'shards') }">{{ calc.fmtNum(getResult(r.id)!.reachableItems.shardsCount) }}</span>
                </span>
                <span class="calcRow__res" v-if="getResultItemUsageItems(r).length > 0">
                  <span class="calcRow__k">{{ t("calc.row.itemUsage") }}</span>
                  <span class="calcRow__num calcRow__num--text">
                    <template v-for="(item, idx) in getResultItemUsageItems(r)" :key="idx">
                      <span :class="{ 'calcRow__num--danger': item.isDanger }">{{ item.label }} {{ item.value }}</span>
                      <span v-if="idx < getResultItemUsageItems(r).length - 1">, </span>
                    </template>
                  </span>
                </span>
                <!-- 主要な不足要因（到達Lvの前に表示） -->
                <span class="calcRow__res" v-if="getResult(r.id)!.diagnosis.limitingFactor === 'candy'">
                  <span class="calcRow__k calcRow__k--danger">{{ t("calc.row.candyShortage") }}</span>
                  <span class="calcRow__num calcRow__num--danger">{{ getResult(r.id)!.shortage.candy }}</span>
                </span>
                <span class="calcRow__res" v-if="getResult(r.id)!.diagnosis.limitingFactor === 'boost'">
                  <span class="calcRow__k calcRow__k--danger">{{ t("calc.row.boostCandyShortage") }}</span>
                  <span class="calcRow__num calcRow__num--danger">{{ getResult(r.id)!.shortage.boost }}</span>
                </span>
                <span class="calcRow__res" v-if="getResult(r.id)!.diagnosis.limitingFactor === 'shards'">
                  <span class="calcRow__k calcRow__k--danger">{{ t("calc.row.shardsShortage") }}</span>
                  <span class="calcRow__num calcRow__num--danger">{{ calc.fmtNum(getResult(r.id)!.shortage.shards) }}</span>
                </span>
                <span class="calcRow__res">
                  <span class="calcRow__k calcRow__k--info">{{ t("calc.row.reachedLv") }}</span>
                  <span class="calcRow__num calcRow__num--info">{{ getResult(r.id)!.reachedLevel }}</span>
                  <span class="calcRow__k calcRow__k--info" v-if="getResult(r.id)!.expToNextLevel > 0" style="margin-left: 4px;">({{ t("calc.row.expRemaining") }}</span>
                  <span class="calcRow__num calcRow__num--info" v-if="getResult(r.id)!.expToNextLevel > 0">{{ calc.fmtNum(getResult(r.id)!.expToNextLevel) }}</span><span class="calcRow__k calcRow__k--info" v-if="getResult(r.id)!.expToNextLevel > 0">)</span>
                </span>
                <span class="calcRow__res" v-if="getResult(r.id)!.expToTarget > 0">
                  <span class="calcRow__k calcRow__k--info">{{ t("calc.row.remainingExp") }}</span>
                  <span class="calcRow__num calcRow__num--info">{{ calc.fmtNum(getResult(r.id)!.expToTarget) }}</span>
                  <span class="calcRow__sleepTime" v-if="getSleepTimeText(r.id, getResult(r.id)!.expToTarget)">
                    {{ getSleepTimeText(r.id, getResult(r.id)!.expToTarget) }}
                  </span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="boxEmpty" v-else>
      <div class="boxEmpty__content">
        <div class="boxEmpty__title">{{ t("calc.empty").split('\n')[0] }}</div>
        <div class="boxEmpty__list">{{ t("calc.empty").split('\n').slice(1).join('\n') }}</div>
      </div>
      <div class="boxEmpty__link">
        {{ t("calc.emptyLinkPre") }}<button type="button" class="boxEmpty__linkBtn" @click="$emit('open-help')">{{ t("calc.emptyLinkText") }}</button>{{ t("calc.emptyLinkPost") }}
      </div>
    </div>
    </div>


    <div v-if="hintState.visible" class="hintOverlay" @click.stop="closeHint"></div>
    <div
      v-if="hintState.visible"
      class="hintPopover"
      :style="{ left: hintState.left + 'px', top: hintState.top + 'px' }"
      @click.stop
      v-html="hintState.message"
    ></div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { CalcStore, CalcRowView } from "../composables/useCalcStore";
import { useCandyStore } from "../composables/useCandyStore";
import { PokemonTypes, getTypeName } from "../domain/pokesleep/pokemon-types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { markForSleep, calcCandyTargetFromSleepExp, calcSleepTimeForExp } from "../domain/pokesleep/sleep-growth";
import { calcExp } from "../domain/pokesleep/exp";

defineEmits<{
  (e: "apply-to-box", rowId: string): void;
  (e: "open-help"): void;
}>();

const props = defineProps<{
  calc: CalcStore;
  resolvePokedexIdByBoxId?: (boxId: string) => number | undefined;
}>();

const calc = props.calc;
const { t, locale } = useI18n();
const candyStore = useCandyStore();

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
function handleInputBlur(event: FocusEvent) {
  // iOS Safari でキーボードを閉じた後にスクロール位置がずれる問題の対策
  // 少し待ってからスクロール位置を調整
  const target = event.target as HTMLElement;
  if (target) {
    setTimeout(() => {
      // 入力欄がstickyヘッダーに隠れていたら戻す
      const rect = target.getBoundingClientRect();
      // 320px = sticky header height (approx)
      if (rect.top < 320 || rect.bottom > window.innerHeight) {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }, 100);
  }
}

const levelPresets = [10, 25, 30, 40, 50, 55, 57, 60, MAX_LEVEL] as const;

// ポケモンタイプ一覧（英語名）
const pokemonTypes = PokemonTypes;

// 行から pokedexId を取得（保存済み or boxId から解決）
function getRowPokedexId(r: { pokedexId?: number; boxId?: string }): number | undefined {
  if (r.pokedexId) return r.pokedexId;
  if (r.boxId && props.resolvePokedexIdByBoxId) {
    return props.resolvePokedexIdByBoxId(r.boxId);
  }
  return undefined;
}

// PokemonLevelUpResult への直接アクセス
function getResult(rowId: string) {
  return calc.getPokemonResult(rowId);
}


// アイテム使用リストの項目型
type ItemUsageItem = { label: string; value: number; isDanger: boolean };

// アイテム使用リストの赤字判定モード
type ItemDangerMode = 'target' | 'limit' | 'reachable';

// 共通ヘルパー: アイテム使用リストを生成
function buildItemUsageList(
  r: CalcRowView,
  mode: ItemDangerMode
): ItemUsageItem[] {
  const p = getResult(r.id);
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
  const p = getResult(r.id);
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
  const p = getResult(r.id);
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
  const p = getResult(r.id);
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

  const p = getResult(r.id);
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

  const p = getResult(r.id);
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

function showHint(ev: MouseEvent, message: string) {
  const target = ev.target as HTMLElement;
  const rect = target.getBoundingClientRect();

  // 画面端の考慮
  const viewportWidth = window.innerWidth;
  const popoverWidth = 220; // CSS max-width(200) + padding/border margin

  let left = rect.left;
  if (left + popoverWidth > viewportWidth) {
    left = viewportWidth - popoverWidth - 8;
  }
  if (left < 8) left = 8;

  hintState.value = {
    visible: true,
    message,
    left: left,
    top: rect.bottom + 4
  };
}

function closeHint() {
  hintState.value.visible = false;
}
</script>

<style scoped src="./CalcPanel.css"></style>
