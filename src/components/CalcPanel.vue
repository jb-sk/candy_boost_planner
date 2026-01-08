<template>
  <section id="neo-calc" class="panel panel--calc">
    <div class="panel__head">
      <h2 class="panel__title">{{ t("calc.title") }}</h2>
    </div>
    <div class="calcTop">
      <div class="calcTop__row">
        <div class="calcTop__field">
          <span class="calcTop__label">{{ t("calc.boostKindLabel") }}</span>
          <select v-model="calc.boostKind.value" class="field__input field__input--compact" style="width: auto;">
            <option value="full">{{ calc.fullLabel.value }}</option>
            <option value="mini">{{ calc.miniLabel.value }}</option>
            <option value="none">{{ calc.noneLabel.value }}</option>
          </select>
        </div>
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
        <summary class="calcTop__typeCandyToggle">{{ t("calc.candy.typeCandyToggle") }}</summary>
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
        <button
          v-for="i in 3"
          :key="i"
          class="slotTab"
          :class="{ 'slotTab--active': calc.activeSlotTab.value === i - 1 }"
          @click="calc.switchToSlot(i - 1)"
        >
          {{ t("calc.slot", { n: i }) }}
        </button>
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
          <div class="field field--sm">
            <span class="field__label">{{ t("calc.row.candyTarget") }}</span>
            <input
              type="number"
              min="0"
              class="field__input"
              :value="r.candyTarget ?? ''"
              :placeholder="t('calc.row.candyTargetNone')"
              @input="onCandyTargetInput(r.id, ($event.target as HTMLInputElement).value)"
            />
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
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p class="boxEmpty" v-else>{{ t("calc.empty") }}</p>
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

defineEmits<{
  (e: "apply-to-box", rowId: string): void;
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

// アメ使用制限入力時のラッパー（値が設定されたら折りたたみを開く）
function onCandyTargetInput(rowId: string, value: string) {
  calc.onRowCandyTarget(rowId, value);
  // 値が設定されたら自動的に到達可能行を開く
  if (value.trim() !== "") {
    expandedRows.value.add(rowId);
    expandedRows.value = new Set(expandedRows.value);
  }
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

<style scoped>
/* --- Calculator (multi) --- */
.calcTop {
  margin-top: 12px;
}
.calcTop__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 16px;
  column-gap: 16px;
  row-gap: 8px;
}

.calcTop__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.calcTop__label {
  font-size: 11px;
  font-weight: 600;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.calcTop__field--candy {
  flex-direction: column;
  align-items: flex-start;
}
.candyInputs {
  display: flex;
  gap: 6px;
}
.candyInput--md .candyInput__label {
  font-size: 13px;
  color: color-mix(in oklab, var(--ink) 70%, transparent);
}




.panel--calc {
  container-type: inline-size;
}

.calcTop__typeCandy {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in oklab, var(--ink) 4%, transparent);
}
.calcTop__typeCandyToggle {
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: color-mix(in oklab, var(--ink) 70%, transparent);
}
.calcTop__typeCandyToggle:hover {
  color: var(--ink);
}
.calcTop__typeCandyGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px 16px;
  margin-top: 10px;
}
.typeRow {
  display: grid;
  grid-template-columns: 55px 1fr 1fr;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.typeRow__name {
  font-size: 12px;
  font-weight: 500;
  color: color-mix(in oklab, var(--ink) 80%, transparent);
}
.candyInput {
  display: flex;
  align-items: center;
  gap: 4px;
}
.candyInput__label {
  font-size: 11px;
  font-weight: 600;
  min-width: 14px;
}
.candyInput--sm .candyInput__label {
  font-size: 11px;
}

.field--boost-control.is-none {
  display: none;
}


.calcSticky {
  position: sticky;
  top: 10px;
  z-index: 30;
  margin-top: 10px;
  padding: 12px;
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
  flex: 1 1 auto;
  min-width: 100px;
}
.calcSum__v {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 18px;
  margin-top: 2px;
  color: var(--ink);
}
.calcSum--hi .calcSum__v {
  background: transparent;
  box-shadow: none;
  padding: 0;
  color: var(--ink);
  font-size: 1.4rem;
}
@container (max-width: 560px) {
  .calcSum--hi .calcSum__v {
    font-size: 1.1rem;
  }
}
.calcSum--candy {
  flex: 2 1 auto;
  min-width: 180px;
}
.calcSum__v--over {
  color: color-mix(in oklab, hsl(6 78% 52%) 75%, var(--ink) 10%);
}
.calcSum__candyDetails {
  font-size: 14px;
  font-weight: 600;
  margin-left: 8px;
  color: var(--ink);
}
@container (max-width: 560px) {
  .calcSum__candyDetails {
    /* 改行しない */
    margin-left: 6px;
    font-size: 13px;
  }
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
.calcSticky__candy {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 14%, transparent);
  font-size: 13px;
  color: color-mix(in oklab, var(--ink) 70%, transparent);
}
.calcSticky__candyRow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.calcSticky__candyLabel {
  font-weight: 600;
}
.calcSticky__candyPct {
  font-weight: 700;
  font-size: 16px;
  color: var(--ink);
}
.calcSticky__candyPct--over {
  color: color-mix(in oklab, hsl(6 78% 52%) 75%, var(--ink) 10%);
}
.calcSticky__candyDetails {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.calcSticky__candyItem {
  font-variant-numeric: tabular-nums;
}

/* Mobile: keep "Shards" and "Remaining" compact and side-by-side */
@container (max-width: 560px) {
  .calcSticky {
    top: 42px;
    padding: 8px;
    border-radius: 12px;
  }
  .calcSticky__summary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  .calcSticky__summary .calcSum--candy {
    grid-column: 1 / -1;
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
    max-width: calc(100vw - 280px); /* More restrictive for English UI buttons */
  }
  .calcRow__headRight {
    gap: 4px; /* Tighter spacing on mobile */
  }
  .calcRow__headRight .linkBtn {
    font-size: 12px;
    padding: 2px 4px;
  }
  .calcRow {
    overflow: hidden; /* Prevent horizontal overflow */
    max-width: 100%;
  }
  .calcRow__head {
    max-width: 100%;
    overflow: hidden;
  }
  button.calcRow__dragHandle {
    padding: 4px 2px;
    font-size: 13px;
  }

  /* Mobile: keep shards + candy(total) side-by-side under inputs (moved near base rules for correct cascade) */
}


.calcSum__head {
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
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
  flex-shrink: 0;
  margin-left: auto;
}
.calcSum__overVal {
  flex: 0 0 auto;
  white-space: nowrap;
}
.calcSum__selectedVal {
  flex: 0 0 auto;
  white-space: nowrap;
  margin-left: 10px;
  font-size: 12px;
  font-weight: 600;
  color: color-mix(in oklab, var(--accent) 80%, var(--ink) 20%);
}
/* モバイルレイアウト: 1行目: Main, 2行目: Selected + Cap */
@container (max-width: 480px) {
  /* サマリー位置調整 */
  .calcSticky {
    margin-top: 10px;
    margin-bottom: 12px;
  }

  /* サマリーヘッダーの圧縮 */
  .calcSum__head {
    flex-wrap: nowrap; /* 折り返さない */
    white-space: nowrap;
    overflow: hidden;
    gap: 6px;
  }

  /* 合計値エリアを横並びにする */
  .calcSticky__summary {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  /* 合計ボックス（アメブ合計・かけら合計） */
  .calcSum--hi {
    flex: 1 1 45%;
    padding: 2px 10px 6px 10px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px;
    min-width: 0;
  }
  .calcSum--hi .calcSum__k {
    font-size: 11px;
    margin-bottom: 0;
  }
  .calcSum--hi .calcSum__v {
    font-size: 16px;
    font-weight: 800;
    line-height: 1;
  }

  /* 万能アメ欄 */
  .calcSum--candy {
    flex: 1 1 100%;
    padding: 3px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .calcSum--candy .calcSum__k {
    font-size: 11px;
    margin-bottom: 0;
  }
  .calcSum--candy .calcSum__v {
    font-size: 15.5px;
    font-weight: 800;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  /* 内訳（S: x M: y...）を大きく見やすく */
  .calcSum__candyDetails {
    font-size: 13px;
    opacity: 1;
    color: color-mix(in oklab, var(--ink) 80%, transparent);
  }

  /* バーエリアの圧縮 */
  .calcSum--bar {
    padding: 6px 10px;
    margin-top: 4px;
    gap: 4px;
    display: flex;
    flex-direction: column;
  }
  .calcBarBlock + .calcBarBlock {
    margin-top: 4px; /* 間隔を詰める */
  }

  /* バーのヘッダー */
   .calcSum--bar .calcSum__head {
    margin-bottom: 2px;
    justify-content: space-between;
  }
  .calcSum--bar .calcSum__k {
    font-size: 11px;
  }
  /* 「選択中のポケモン XX%」を非表示にしてスッキリさせる */
  .calcSum--bar .calcSum__selectedVal {
    display: none;
  }
  /* バー自体を細く */
  .calcBar {
    margin-top: 2px;
    height: 6px;
    border-radius: 3px;
  }
  .calcBar__track {
    height: 6px;
    border-radius: 3px;
  }
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
  display: flex; /* flexbox で複数セグメントを並べる */
}
.calcBar__fill {
  position: relative;
  height: 100%;
  background: var(--accent); /* フォールバック */
  transition: width 240ms ease;
}
/* 選択中ポケモン（楽しそうなピンク） */
.calcBar__fill--active {
  background: hsl(330, 85%, 60%);
  z-index: 2;
  /* 境界線をつけて区切りを明確に */
  box-shadow: 1px 0 0 0 var(--paper);
}
/* 他ポケモン（楽しそうな水色） */
.calcBar__fill--others {
  background: hsl(190, 80%, 65%);
  z-index: 1;
}
/* アメブ用も共通の色にする（区別しない） */
.calcBar__fill--candy.calcBar__fill--active {
  background: hsl(330, 85%, 60%);
}
.calcBar__fill--candy.calcBar__fill--others {
  background: hsl(190, 80%, 65%);
}
.calcSum--muted .calcBar__fill {
  opacity: 0.35;
}
.calcBar__over {
  position: relative;
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
  flex: 1 1 auto; /* allow title to shrink within the row */
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
  min-width: 0;
}
button.calcRow__dragHandle {
  padding: 6px 6px; /* Override .btn padding with higher specificity */
}
.calcRow__dragHandle:active {
  cursor: grabbing;
}
/* .calcRow__subHead removed */
.calcRow__title {
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -0.01em;
  flex: 1 1 auto;
  min-width: 0; /* critical: allow shrinking even for long unbroken EN nicknames */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calcRow__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 5px !important; /* 行間を少し狭める */
  margin-top: 1px;
  align-items: start; /* 要素が縦に引き伸ばされるのを防ぐ */
}
/* ラベルと入力欄の間隔を少し開ける */
.field--sm {
  gap: 2px !important;
}
.calcRow__grid > * {
  min-width: 0;
}
@media (min-width: 560px) {
  .calcRow__grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  /* 通常モード（アメブ種別=none）時は2行3列 */
  .calcRow__grid--normal {
    grid-template-columns: repeat(3, minmax(0, 1fr));
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
.calcRow__result--inline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.calcRow__result--inline .calcRow__res {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.calcRow__result--inline .calcRow__k {
  font-size: 12px;
}
.calcRow__result--inline .calcRow__num {
  font-size: 15px;
  font-weight: 700;
}
/* モバイルでは2列×2行に */
@media (max-width: 640px) {
  .calcRow__result:not(.calcRow__result--inline) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 16px;
  }
  /* Mobile EN: large numbers like "2,180,569" can force flex items to exceed width.
     Allow wrapping/break opportunities so the layout doesn't widen and clip the right side. */
  .shell[data-locale="en"] .calcRow__result .calcRow__v {
    min-width: 0;
  }
  .shell[data-locale="en"] .calcRow__result .calcRow__num {
    overflow-wrap: anywhere;
    word-break: break-word;
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
.calcRow__num--text {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink);
}
.calcRow__num--danger {
  color: color-mix(in oklab, hsl(6 78% 52%) 85%, var(--ink) 15%);
}
.calcRow__k--danger {
  color: color-mix(in oklab, hsl(6 78% 52%) 75%, var(--ink) 25%);
}
.calcRow__num--info {
  color: hsl(210 100% 35%);
}
.calcRow__k--info {
  color: hsl(210 100% 35%);
}

/* 必要/使用の折りたたみ表示 */
.calcRow__resultCollapse {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.calcRow__resultRow {
  display: flex;
  align-items: baseline; /* ラベルと内容のベースラインを揃える */
  gap: 6px;
  padding: 8px 4px 8px 8px; /* 左余白を少し戻す */
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.calcRow__resultRow--required {
  background: #e3f2fd;
}
.calcRow__resultRow--required:hover {
  background: #dbeafe; /* 少し濃い水色 */
}
.calcRow__resultRow--required.is-expanded {
  background: #dbeafe;
}
.calcRow__resultRow--used {
  background: #e0f7fa; /* Cyan 50: 青緑寄り */
  cursor: default;
  margin-left: 0;
}
.calcRow__expandIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: #ffffff;
  box-shadow: 0 1px 2px color-mix(in oklab, var(--ink) 10%, transparent);
  color: var(--ink);
  flex-shrink: 0;
  margin-right: 6px;
  padding-top: 1px;
}
.calcRow__resultLabel {
  font-size: 11px;
  font-weight: 700;
  color: color-mix(in oklab, var(--ink) 90%, transparent);
  min-width: 36px;
  flex-shrink: 0;
}

/* --- Improved Result Layout --- */

.calcRow__resultItems {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 16px; /* 余白で区切る */
  flex: 1;
  min-width: 0;
}

/* 各項目の区切り線削除 */
.calcRow__resultRow .calcRow__res {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.calcRow__resultItems .calcRow__res:not(:last-child) {
  padding-right: 0;
  border-right: none;
}
.calcRow__resultItems .calcRow__res + .calcRow__res {
  padding-left: 0;
}

/* フォント調整 */
.calcRow__resultItems .calcRow__k {
  font-size: 10px;
  font-weight: 600;
  color: color-mix(in oklab, var(--ink) 60%, transparent); /* 少し落ち着かせる */
  margin-right: 2px;
}
.calcRow__resultItems .calcRow__num {
  font-size: 14px;
}

/* 使用アイテムの強調削除（シンプル化） */
.calcRow__resultItems .calcRow__res:has(.calcRow__num--text) {
  background: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
  margin-left: 0;
  max-width: 100%;
}
.calcRow__num--text {
  font-size: 11px;
  font-weight: 600; /* 太字で区別 */
  color: var(--ink);

  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.4;
}
/* シンプルデザインのため、特別な隣接セレクタは不要 */
.calcRow__resultItems .calcRow__res:has(.calcRow__num--text) + .calcRow__res {
  padding-left: 0;
}

/* 万能アメ配分説明 */
.calcAllocInfo {
  margin: 12px 0;
  padding: 8px 12px;
  background: color-mix(in oklab, var(--ink) 5%, transparent);
  border-radius: 8px;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 70%, transparent);
}
.calcAllocInfo__title {
  cursor: pointer;
  font-weight: 600;
  color: color-mix(in oklab, var(--ink) 80%, transparent);
}

.field-checkbox-mini {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  color: var(--ink);
}
.field-checkbox-mini.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.field-checkbox-mini input {
  margin: 0;
  accent-color: var(--candy-type-normal);
}
/* Mobile Nav exists up to 1023px, so sticky header needs offset */
@media (max-width: 1023px) {
  .calcSticky {
    top: 42px;
  }
}

/* Nature indicator icons */
.calcRow__natureIcon {
  font-size: 12px;
  margin-right: 4px;
  font-weight: 700;
}
.calcRow__natureIcon--up {
  color: hsl(140, 60%, 45%);
}
.calcRow__natureIcon--down {
  color: hsl(350, 60%, 50%);
}

/* Mobile: 省スペース・インラインフロー（優先度確保のため最後に記述） */
@media (max-width: 560px) {
  .calcRow__resultRow {
    display: block;
    line-height: 1.5;
    padding: 6px 4px;
  }
  .calcRow__resultItems {
    display: inline;
    margin: 0;
  }
  /* 各項目（アメ、かけら等）もインライン化 */
  .calcRow__resultItems .calcRow__res {
    display: inline;
    margin-right: 6px;
    white-space: normal; /* nowrapだと英語などで突き抜けるためnormalに戻す */
  }
  /* 最後の項目の後ろはマージンなし */
  .calcRow__resultItems .calcRow__res:last-child {
    margin-right: 0;
  }

  .calcRow__resultItems .calcRow__res .calcRow__k {
    margin-right: 2px;
    font-size: 11px; /* 10px -> 11px */
  }
  .calcRow__resultItems .calcRow__res .calcRow__num {
    font-size: 15px; /* 13px -> 15px */
  }

  /* 必要アイテムなどの長いテキストは折り返し許可 */
  .calcRow__resultItems .calcRow__res:has(.calcRow__num--text) {
    white-space: normal;
  }

  .calcRow__expandIcon {
    display: inline-flex;
    vertical-align: middle;
    margin-right: 4px;
    transform: translateY(-1px);
  }
  .calcRow__resultLabel {
    display: inline;
    margin-right: 4px;
  }

  .calcRow__resultRow--used {
    margin-left: 0;
  }

  /* --- 縦圧縮 (Compact vertical layout) --- */
  .calcRow {
    padding: 4px 6px;
  }
  .calcRow__grid {
    gap: 6px 5px !important;
    margin-top: 0;
  }
  .field--sm {
    gap: 2px !important;
  }

  /* グローバルな .field--sm を上書き (App.vue由来) */
  .field--sm .field__label {
    margin-top: 1px;
    height: 13px;
    font-size: 9px;
    line-height: 13px;
  }
  .field--sm .field__input,
  .field--sm .field__input--button {
    height: 28px;
    font-size: 13px;
    border-radius: 8px;
  }
  .field--sm .field__range {
    transform: translateY(2px);
    margin-bottom: -4px;
  }

  .calcSlots {
    margin-top: 8px;
  }
}

/* --- タブと計算機の一体化スタイル --- */
.calcSlots {
  margin-top: 4px;
  padding: 0; /* 左右の余白を削除 */
  margin-bottom: 0;
  display: flex;
}

.slotTabs {
  display: flex;
  gap: 4px; /* タブ間の隙間 */
  width: 100%;
}

.slotTab {
  flex: 1;
  padding: 8px 0;
  text-align: center;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 14px; /* 自己主張 */
  color: color-mix(in oklab, var(--ink) 50%, transparent);
  background: #e4e6eb; /* 濃いめのグレー */
  border: 1px solid #c0c2c6;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  transition: all 0.1s;
  position: relative;
  top: 1px; /* 下のボーダーに重ねる */
}

.slotTab:hover {
  background: #d8dadf;
}

.slotTab--active {
  background: #ffffff;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-bottom: 1px solid #ffffff;
  padding-top: 8px;
  z-index: 3;
}

/* 計算機リスト全体を囲むコンテナ装飾 */



.calcSlotContainer {
  background: #ffffff;
  border: 1px solid var(--accent);
  border-radius: 8px;
  /* タブの形状に合わせて左上右上は丸めない方が自然かもしれないが、
     タブが全幅でない場合は丸めた方がいい。今回は全幅だが隙間4pxあるので丸めてもOK */

  position: relative;
  z-index: 1;
  padding: 8px 0; /* 左右の余白を削除 */
  min-height: 120px; /* 空の時の高さ確保 */
}
.calcActions {
  display: flex;
  align-items: center; /* 追加 */
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px; /* 24px -> 12px */
  margin-bottom: 12px; /* 4px -> 12px */
}
.boxEmpty {
  text-align: center;
  padding: 60px 20px;
  font-size: 15px;
  font-weight: 700;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
</style>
