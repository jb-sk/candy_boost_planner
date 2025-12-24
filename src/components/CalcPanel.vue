<template>
  <section id="neo-calc" class="panel panel--calc">
    <div class="panel__head">
      <h2 class="panel__title">{{ t("calc.title") }}</h2>
    </div>
    <div class="calcTop">
      <div class="calcTop__row">
        <div class="calcTop__field">
          <span class="calcTop__label">{{ t("calc.boostKindLabel") }}</span>
          <select v-model="calc.boostKind.value" class="calcTop__input">
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
            class="calcTop__input calcTop__input--remaining"
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
            class="calcTop__input calcTop__input--shards"
            @input="calc.onTotalShardsInput(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="calcTop__field calcTop__field--candy">
          <span class="calcTop__label">{{ t("calc.candy.universalLabel") }}</span>
          <div class="calcTop__candyInputs">
            <label class="calcTop__candyInput">
              <span class="calcTop__candyLabel">{{ t("calc.candy.universalS") }}</span>
              <input
                type="number"
                min="0"
                class="calcTop__input calcTop__input--candy"
                :value="candyStore.universalCandy.value.s"
                @input="candyStore.updateUniversalCandy({ s: parseInt(($event.target as HTMLInputElement).value) || 0 })"
              />
            </label>
            <label class="calcTop__candyInput">
              <span class="calcTop__candyLabel">{{ t("calc.candy.universalM") }}</span>
              <input
                type="number"
                min="0"
                class="calcTop__input calcTop__input--candy"
                :value="candyStore.universalCandy.value.m"
                @input="candyStore.updateUniversalCandy({ m: parseInt(($event.target as HTMLInputElement).value) || 0 })"
              />
            </label>
            <label class="calcTop__candyInput">
              <span class="calcTop__candyLabel">{{ t("calc.candy.universalL") }}</span>
              <input
                type="number"
                min="0"
                class="calcTop__input calcTop__input--candy"
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
                class="field__input field__input--xs"
                :value="candyStore.getTypeCandyFor(typeName).s"
                @input="candyStore.updateTypeCandy(typeName, { s: parseInt(($event.target as HTMLInputElement).value) || 0 })"
              />
            </label>
            <label class="candyInput candyInput--sm">
              <span class="candyInput__label">{{ t("calc.candy.typeM") }}</span>
              <input
                type="number"
                min="0"
                class="field__input field__input--xs"
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
        <div class="calcSum calcSum--candy" v-if="calc.allocationResult.value">
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
              <span v-if="calc.activeRowId.value && calc.activeRowBoostCandyUsed.value > 0" class="calcSum__selectedVal">{{ t("calc.selectedUsage", { pct: calc.activeRowBoostCandyUsagePct.value }) }}</span>
            </div>
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
              <span v-if="calc.activeRowId.value && calc.activeRowShardsUsed.value > 0" class="calcSum__selectedVal">{{ t("calc.selectedUsage", { pct: calc.activeRowShardsUsagePct.value }) }}</span>
            </div>
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
          @click="calc.activeSlotTab.value = i - 1"
        >
          {{ t("calc.slot", { n: i }) }}
          <span v-if="calc.slots.value[i - 1]" class="tab__count" title="保存済み">●</span>
          <span v-else class="tab__count" title="空">-</span>
        </button>
      </div>

      <div class="slotContent" :class="{ 'calcSlot--empty': !calc.slots.value[calc.activeSlotTab.value] }">
        <div class="calcSlot__actions">
          <button
            class="btn btn--ghost btn--xs calcSlot__btn"
            type="button"
            @click="calc.onSlotLoad(calc.activeSlotTab.value)"
            :disabled="!calc.slots.value[calc.activeSlotTab.value]"
          >
            {{ t("common.load") }}
          </button>
          <button
            class="btn btn--xs calcSlot__btn"
            type="button"
            @click="calc.onSlotSave(calc.activeSlotTab.value)"
            :disabled="!calc.rowsView.value.length"
          >
            {{ t("common.save") }}
          </button>
          <button
            class="btn btn--ghost btn--xs calcSlot__btn"
            type="button"
            @click="calc.onSlotDelete(calc.activeSlotTab.value)"
            :disabled="!calc.slots.value[calc.activeSlotTab.value]"
          >
            {{ t("common.delete") }}
          </button>
        </div>
        <div class="calcSlot__state">
          {{
            calc.slots.value[calc.activeSlotTab.value]
              ? calc.formatSlotSavedAt(calc.slots.value[calc.activeSlotTab.value]?.savedAt)
              : t("calc.slotEmpty")
          }}
        </div>
      </div>
    </div>

    <p class="calcHint">{{ t("calc.addHint") }}</p>

    <details class="calcAllocInfo">
      <summary class="calcAllocInfo__title">{{ t("calc.candyAllocTitle") }}</summary>
      <pre class="calcAllocInfo__desc">{{ t("calc.candyAllocDesc") }}</pre>
    </details>

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
              <span v-if="r.result.expLeftNext > 0" style="font-weight:normal; margin-left:4px; opacity:0.8">
                {{ t("calc.row.expLeftNext", { exp: calc.fmtNum(r.result.expLeftNext) }) }}
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
                    max="65"
                    step="1"
                    :value="r.dstLevel"
                    @input="calc.setDstLevel(r.id, ($event.target as HTMLInputElement).value)"
                  />
                  <button class="btn btn--ghost btn--xs" type="button" @click="calc.nudgeDstLevel(r.id, 1)" :disabled="r.dstLevel >= 65">
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
          <label class="field field--sm">
            <span class="field__label">{{ t("calc.row.nature") }}</span>
            <NatureSelect
              :model-value="r.nature"
              @update:model-value="(val) => calc.onRowNature(r.id, val)"
              :label="t('calc.row.nature')"
              :label-normal="t('calc.row.natureNormal')"
              :label-up="t('calc.row.natureUp')"
              :label-down="t('calc.row.natureDown')"
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
        </div>

        <div class="calcRow__result calcRow__result--inline">
          <span class="calcRow__res">
            <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
            <span class="calcRow__num">{{ calc.fmtNum(r.result.boostCandy) }}</span>
          </span>
          <span class="calcRow__res">
            <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
            <span class="calcRow__num">{{ calc.fmtNum(r.result.normalCandy) }}</span>
          </span>
          <span class="calcRow__res">
            <span class="calcRow__k">{{ t("calc.row.candyTotal") }}</span>
            <span class="calcRow__num">{{ calc.fmtNum(r.result.boostCandy + r.result.normalCandy) }}</span>
          </span>
          <span class="calcRow__res">
            <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
            <span class="calcRow__num">{{ calc.fmtNum(r.result.shards) }}</span>
          </span>
          <span class="calcRow__res">
            <span class="calcRow__k">{{ t("calc.row.candySupply") }}</span>
            <span class="calcRow__num calcRow__num--text">{{ getCandySupplyText(r) }}</span>
          </span>
        </div>
      </div>
    </div>
    <p class="boxEmpty" v-else>{{ t("calc.empty") }}</p>

    <div v-if="hintState.visible" class="hintOverlay" @click.stop="closeHint"></div>
    <div
      v-if="hintState.visible"
      class="hintPopover"
      :style="{ left: hintState.left + 'px', top: hintState.top + 'px' }"
      @click.stop
    >
      {{ hintState.message }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { CalcStore, CalcRowView } from "../composables/useCalcStore";
import { useCandyStore } from "../composables/useCandyStore";
import NatureSelect from "./NatureSelect.vue";
import { PokemonTypes, getTypeNameJa, getTypeName } from "../domain/pokesleep/pokemon-types";
import type { PokemonAllocation } from "../domain/candy-allocator";

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

const levelPresets = [10, 25, 30, 40, 50, 55, 57, 60, 65] as const;

// ポケモンタイプ一覧（英語名）
const pokemonTypes = PokemonTypes;

// 万能アメ合計
const universalCandyTotal = computed(() => {
  const u = candyStore.universalCandy.value;
  return u.s + u.m + u.l;
});

// 行から pokedexId を取得（保存済み or boxId から解決）
function getRowPokedexId(r: { pokedexId?: number; boxId?: string }): number | undefined {
  if (r.pokedexId) return r.pokedexId;
  if (r.boxId && props.resolvePokedexIdByBoxId) {
    return props.resolvePokedexIdByBoxId(r.boxId);
  }
  return undefined;
}

// 特定の行のアメ配分結果を取得（calc.allocationResult から）
function getRowAllocation(rowId: string): PokemonAllocation | null {
  if (!calc.allocationResult.value) return null;
  return calc.allocationResult.value.pokemons.find(p => p.id === rowId) ?? null;
}

// アメ補填の表示テキストを生成
function getCandySupplyText(r: CalcRowView): string {
  const alloc = getRowAllocation(r.id);
  if (!alloc) return "-";

  const parts: string[] = [];

  // 種族アメは在庫使用なので補填に含めない

  // タイプアメ
  if (alloc.typeSUsed > 0) {
    const typeName = getTypeName(alloc.type, locale.value);
    parts.push(`${typeName}S ${alloc.typeSUsed}`);
  }
  if (alloc.typeMUsed > 0) {
    const typeName = getTypeName(alloc.type, locale.value);
    parts.push(`${typeName}M ${alloc.typeMUsed}`);
  }

  // 万能アメ
  if (alloc.uniSUsed > 0) {
    parts.push(`${t("calc.candy.universalLabel")} S ${alloc.uniSUsed}`);
  }
  if (alloc.uniMUsed > 0) {
    parts.push(`${t("calc.candy.universalLabel")} M ${alloc.uniMUsed}`);
  }
  if (alloc.uniLUsed > 0) {
    parts.push(`${t("calc.candy.universalLabel")} L ${alloc.uniLUsed}`);
  }

  // 不足
  if (alloc.remaining > 0) {
    parts.push(`${t("calc.candy.shortage")} ${alloc.remaining}`);
  }

  // 余り（surplus > 0 の場合のみ表示）
  if (alloc.surplus > 0) {
    parts.push(`${t("calc.candy.surplus")} ${alloc.surplus}`);
  }

  return parts.length > 0 ? parts.join(", ") : "-";
}

// アイテム（万能アメ・タイプアメ）使用またはアメ不足があるか判定
function isCandyShort(r: CalcRowView): boolean {
  const alloc = getRowAllocation(r.id);
  if (!alloc) return false;
  return (
    alloc.uniSUsed > 0 ||
    alloc.uniMUsed > 0 ||
    alloc.uniLUsed > 0 ||
    alloc.typeSUsed > 0 ||
    alloc.typeMUsed > 0 ||
    alloc.remaining > 0
  );
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
