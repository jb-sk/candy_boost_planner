<template>
  <main :class="['shell', { 'shell--exportOpen': calcExportOpen }]" :data-locale="locale">
    <header class="hero">
      <div>
        <p class="kicker">{{ t("app.kicker") }}</p>
        <h1 class="title">{{ t("app.title") }}</h1>
        <p class="lede">
          {{ t("app.lede") }}
        </p>
        <div class="lang">
          <button class="lang__btn" type="button" :class="{ 'lang__btn--on': locale === 'ja' }" @click="setLocale('ja')">JP</button>
          <button class="lang__btn" type="button" :class="{ 'lang__btn--on': locale === 'en' }" @click="setLocale('en')">EN</button>
        </div>
      </div>
      <div class="support" v-if="supportLinks.length">
        <p class="support__label">{{ t("common.support") }}</p>
        <div class="support__links">
          <a
            v-for="l in supportLinks"
            :key="l.id"
            class="support__link"
            :href="l.href"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="l.ariaLabel"
          >
            {{ l.label }}
          </a>
        </div>
      </div>
    </header>

    <nav class="mobileNav">
      <a href="#neo-calc" class="mobileNav__item" @click.prevent="scrollToPanel('neo-calc')">
        {{ t("nav.calc") }}
      </a>
      <a href="#neo-box" class="mobileNav__item" @click.prevent="scrollToPanel('neo-box')">
        {{ t("nav.box") }}
      </a>
    </nav>

    <div class="dashboard">
    <section id="neo-calc" class="panel panel--calc">
      <div class="panel__head">
        <h2 class="panel__title">{{ t("calc.title") }}</h2>
      </div>
      <div class="calcTop">
        <div class="calcTop__grid">
          <label class="field">
            <span class="field__label">{{ t("calc.maxShardsLabel") }}</span>
            <input
              :value="totalShardsText"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              class="field__input"
              @input="onTotalShardsInput(($event.target as HTMLInputElement).value)"
            />
            <span class="field__sub">{{ t("calc.maxShardsHelp") }}</span>
          </label>
          <label class="field">
            <span class="field__label">{{ t("calc.boostKindLabel") }}</span>
            <select v-model="boostKind" class="field__input">
              <option value="full">{{ fullLabel }}</option>
              <option value="mini">{{ miniLabel }}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="calcSticky">
        <div class="calcSticky__summary">
          <div class="calcSum calcSum--hi" :class="{ 'calcSum--danger': calcBoostCandyOver > 0 }">
            <div class="calcSum__k">{{ t("calc.export.sumBoostTotal") }}</div>
            <div class="calcSum__v">{{ fmtNum(calcTotalBoostCandyUsed) }}</div>
          </div>
          <div class="calcSum calcSum--hi" :class="{ 'calcSum--danger': calcShardsOver > 0 }">
            <div class="calcSum__k">{{ t("calc.shardsTotal") }}</div>
            <div class="calcSum__v">{{ fmtNum(calcTotalShardsUsed) }}</div>
          </div>
        </div>
        <div
          class="calcSum calcSum--bar calcSum--sparkle"
          :class="{
            'calcSum--danger': calcShardsOver > 0 || calcBoostCandyOver > 0,
            'calcSum--muted': calcShardsCap <= 0,
          }"
        >
          <div class="calcBarBlock calcBarBlock--candy" :class="{ 'calcBarBlock--danger': calcBoostCandyOver > 0 }">
            <div class="calcSum__head">
              <div class="calcSum__k">
                {{ t("calc.boostCandyUsage", { pct: calcBoostCandyUsagePctRounded }) }}
                <span v-if="showBoostCandyFire" aria-hidden="true"> 🔥</span>
                <span v-if="calcBoostCandyOver > 0" class="calcSum__overVal"> (+{{ fmtNum(calcBoostCandyOver) }})</span>
              </div>
              <div class="calcSum__k calcSum__k--right">
                {{ t("calc.cap", { cap: fmtNum(calcBoostCandyCap) }) }}
              </div>
            </div>
            <div
              class="calcBar"
              role="progressbar"
              :aria-valuenow="Math.max(0, calcTotalBoostCandyUsed)"
              aria-valuemin="0"
              :aria-valuemax="Math.max(1, calcBoostCandyCap)"
              :aria-label="t('calc.boostCandyUsageAria', { pct: calcBoostCandyUsagePctRounded, cap: fmtNum(calcBoostCandyCap) })"
            >
              <div class="calcBar__track">
                <div class="calcBar__fill calcBar__fill--candy" :style="{ width: `${calcBoostCandyFillPctForBar}%` }"></div>
                <div
                  v-if="calcBoostCandyOver > 0 && calcBoostCandyCap > 0"
                  class="calcBar__over"
                  :style="{ width: `${calcBoostCandyOverPctForBar}%` }"
                ></div>
              </div>
            </div>
          </div>

          <div class="calcBarBlock">
            <div class="calcSum__head">
              <div class="calcSum__k">
                {{ calcShardsCap > 0 ? t("calc.shardsUsage", { pct: calcShardsUsagePctRounded }) : t("calc.shardsUsageDash") }}
                <span v-if="showShardsFire" aria-hidden="true"> 🔥</span>
                <span v-if="calcShardsOver > 0" class="calcSum__overVal"> (+{{ fmtNum(calcShardsOver) }})</span>
              </div>
              <div class="calcSum__k calcSum__k--right">
                {{ calcShardsCap > 0 ? t("calc.cap", { cap: fmtNum(calcShardsCap) }) : t("calc.capUnset") }}
              </div>
            </div>
            <div
              class="calcBar"
              role="progressbar"
              :aria-valuenow="Math.max(0, calcTotalShardsUsed)"
              aria-valuemin="0"
              :aria-valuemax="Math.max(1, calcShardsCap)"
              :aria-label="
                calcShardsCap > 0
                  ? t('calc.shardsUsageAria', { pct: calcShardsUsagePctRounded, cap: fmtNum(calcShardsCap) })
                  : t('calc.shardsCapUnsetAria')
              "
            >
              <div class="calcBar__track">
              <div class="calcBar__fill" :style="{ width: `${calcShardsFillPctForBar}%` }"></div>
                <div
                  v-if="calcShardsOver > 0 && calcShardsCap > 0"
                  class="calcBar__over"
                  :style="{ width: `${calcShardsOverPctForBar}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="calcActions">
        <button class="btn btn--primary" type="button" @click="openCalcExport" :disabled="!calcRowsView.length">
          {{ t("calc.export.open") }}
        </button>
        <button class="btn btn--danger" type="button" @click="onCalcClear" :disabled="!calcRowsView.length">
          {{ t("calc.clearPokemons") }}
        </button>
        <button class="btn btn--ghost" type="button" @click="onCalcUndo" :disabled="!canCalcUndo">
          {{ t("common.undo") }}
        </button>
        <button class="btn btn--ghost" type="button" @click="onCalcRedo" :disabled="!canCalcRedo">
          {{ t("common.redo") }}
        </button>
      </div>

      <div class="calcSlots">
        <div class="slotTabs">
          <button
            v-for="i in 3"
            :key="i"
            class="slotTab"
            :class="{ 'slotTab--active': activeCalcSlotTab === i - 1 }"
            @click="activeCalcSlotTab = i - 1"
          >
            {{ t("calc.slot", { n: i }) }}
            <span v-if="calcSlots[i - 1]" class="tab__count" title="保存済み">●</span>
            <span v-else class="tab__count" title="空">-</span>
          </button>
        </div>

        <div class="slotContent" :class="{ 'calcSlot--empty': !calcSlots[activeCalcSlotTab] }">
          <div class="calcSlot__actions">
            <button class="btn btn--ghost btn--xs calcSlot__btn" type="button" @click="onCalcSlotLoad(activeCalcSlotTab)" :disabled="!calcSlots[activeCalcSlotTab]">
              {{ t("common.load") }}
            </button>
            <button class="btn btn--xs calcSlot__btn" type="button" @click="onCalcSlotSave(activeCalcSlotTab)" :disabled="!calcRowsView.length">
              {{ t("common.save") }}
            </button>
            <button class="btn btn--ghost btn--xs calcSlot__btn" type="button" @click="onCalcSlotDelete(activeCalcSlotTab)" :disabled="!calcSlots[activeCalcSlotTab]">
              {{ t("common.delete") }}
            </button>
          </div>
          <div class="calcSlot__state">
            {{ calcSlots[activeCalcSlotTab] ? formatCalcSlotSavedAt(calcSlots[activeCalcSlotTab]?.savedAt) : t("calc.slotEmpty") }}
          </div>
        </div>
      </div>

      <p class="calcHint">
        {{ t("calc.addHint") }}
      </p>

      <div class="calcRows" v-if="calcRowsView.length">
        <div
          v-for="r in calcRowsView"
          :key="r.id"
          class="calcRow"
          :class="{
            'calcRow--active': r.id === activeCalcRowId,
            'calcRow--dragOver': r.id === dragOverRowId,
            'calcRow--dragging': r.id === dragRowId,
          }"
          @click="activeCalcRowId = r.id"
          @dragover.prevent="onCalcRowDragOver(r.id)"
          @drop.prevent="onCalcRowDrop(r.id)"
          @dragleave="onCalcRowDragLeave(r.id)"
        >
          <div class="calcRow__head">
            <div class="calcRow__headLeft">
              <button
                class="btn btn--ghost btn--xs calcRow__dragHandle"
                type="button"
                :title="t('calc.row.dragReorder')"
                :aria-label="t('calc.row.dragReorder')"
                draggable="true"
                @dragstart="onCalcRowDragStart(r.id, $event)"
                @dragend="onCalcRowDragEnd"
                @click.stop
              >
                ⋮⋮
              </button>
              <div class="calcRow__title">{{ r.title }}</div>
            </div>
            <div class="calcRow__headRight">
              <button class="linkBtn" type="button" @click.stop="moveCalcRowUp(r.id)" :disabled="!canMoveCalcRowUp(r.id)">
                ↑
              </button>
              <button class="linkBtn" type="button" @click.stop="moveCalcRowDown(r.id)" :disabled="!canMoveCalcRowDown(r.id)">
                ↓
              </button>
              <button
                v-if="r.boxId"
                class="linkBtn"
                type="button"
                @click.stop="applyCalculatorToBox(r.id)"
                :title="t('calc.applyToBoxTitle')"
              >
                {{ t("calc.applyToBox") }}
              </button>
              <button class="linkBtn linkBtn--danger" type="button" @click.stop="onCalcRemoveRow(r.id)">{{ t("common.delete") }}</button>
            </div>
          </div>

          <div class="calcRow__grid">
            <label class="field field--sm">
              <span class="field__label">{{ t("calc.row.srcLevel") }}</span>
              <div class="levelPick">
                <button
                  type="button"
                  class="field__input field__input--button levelPick__button"
                  @click.stop="openSrcLevelPick(r.id)"
                  aria-haspopup="dialog"
                  :aria-expanded="openLevelPickRowId === r.id && openLevelPickKind === 'src'"
                >
                  {{ r.srcLevel }}
                </button>

                <div
                  v-if="openLevelPickRowId === r.id && openLevelPickKind === 'src'"
                  class="levelPick__popover"
                  role="dialog"
                  :aria-label="t('calc.row.pickLevelAria', { label: t('calc.row.srcLevel') })"
                >
                  <div class="levelPick__top">
                    <div class="levelPick__title">{{ t("calc.row.srcLevel") }}</div>
                    <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="closeLevelPick()">
                      {{ t("common.close") }}
                    </button>
                  </div>

                  <div class="levelPick__sliderRow">
                    <button class="btn btn--ghost btn--xs" type="button" @click="nudgeSrcLevel(r.id, -1)" :disabled="r.srcLevel <= 1">
                      ◀
                    </button>
                    <input
                      class="levelPick__range"
                      type="range"
                      min="1"
                      :max="r.dstLevel"
                      step="1"
                      :value="r.srcLevel"
                      @input="setSrcLevel(r.id, ($event.target as HTMLInputElement).value)"
                    />
                    <button class="btn btn--ghost btn--xs" type="button" @click="nudgeSrcLevel(r.id, 1)" :disabled="r.srcLevel >= r.dstLevel">
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
                      @click="setSrcLevel(r.id, lv)"
                      :disabled="lv < 1 || lv > r.dstLevel"
                    >
                      {{ lv }}
                    </button>
                  </div>
                </div>
              </div>
            </label>
            <label class="field field--sm">
              <span class="field__label">{{ t("calc.row.dstLevel") }}</span>
              <div class="levelPick">
                <button
                  type="button"
                  class="field__input field__input--button levelPick__button"
                  @click.stop="openDstLevelPick(r.id)"
                  aria-haspopup="dialog"
                  :aria-expanded="openLevelPickRowId === r.id && openLevelPickKind === 'dst'"
                >
                  {{ r.dstLevel }}
                </button>

                <div
                  v-if="openLevelPickRowId === r.id && openLevelPickKind === 'dst'"
                  class="levelPick__popover"
                  role="dialog"
                  :aria-label="t('calc.row.pickLevelAria', { label: t('calc.row.dstLevel') })"
                >
                  <div class="levelPick__top">
                    <div class="levelPick__title">Lv{{ r.srcLevel }} → Lv{{ r.dstLevel }}</div>
                    <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="closeLevelPick()">
                      {{ t("common.close") }}
                    </button>
                  </div>

                  <div class="levelPick__sliderRow">
                    <button class="btn btn--ghost btn--xs" type="button" @click="nudgeDstLevel(r.id, -1)" :disabled="r.dstLevel <= r.srcLevel">
                      ◀
                    </button>
                    <input
                      class="levelPick__range"
                      type="range"
                      :min="r.srcLevel"
                      max="65"
                      step="1"
                      :value="r.dstLevel"
                      @input="setDstLevel(r.id, ($event.target as HTMLInputElement).value)"
                    />
                    <button class="btn btn--ghost btn--xs" type="button" @click="nudgeDstLevel(r.id, 1)" :disabled="r.dstLevel >= 65">
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
                      @click="setDstLevel(r.id, lv)"
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
                @input="onCalcRowExpRemaining(r.id, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="field field--sm">
              <span class="field__label">{{ t("calc.row.expType") }}</span>
              <div class="field__input field__input--static" :title="t('calc.row.expTypeFixedHint')">
                {{ r.expType }}
              </div>
            </label>
            <label class="field field--sm">
              <span class="field__label">{{ t("calc.row.nature") }}</span>
              <NatureSelect
                :model-value="r.nature"
                @update:model-value="(val) => onCalcRowNature(r.id, val)"
                :label="t('calc.row.nature')"
                :label-normal="t('calc.row.natureNormal')"
                :label-up="t('calc.row.natureUp')"
                :label-down="t('calc.row.natureDown')"
              />
            </label>

            <label class="field field--sm">
              <span class="field__label">{{ t("calc.row.boostReachLevel") }}</span>
              <input
                :value="r.ui.boostReachLevel"
                type="number"
                :min="r.srcLevel"
                :max="r.dstLevel"
                class="field__input"
                @input="onCalcRowBoostLevel(r.id, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="field field--sm">
              <span class="field__label">{{ t("calc.row.boostRatio") }}</span>
              <input
                :value="r.ui.boostRatioPct"
                type="range"
                min="0"
                max="100"
                step="1"
                class="field__range"
                @input="onCalcRowBoostRatio(r.id, ($event.target as HTMLInputElement).value)"
              />
              <span class="field__sub">{{ r.ui.boostRatioPct }}%</span>
            </label>
            <label class="field field--sm">
              <span class="field__label">{{ t("calc.row.boostCandyCount") }}</span>
              <input
                :value="r.ui.boostCandyInput"
                type="number"
                min="0"
                class="field__input"
                @input="onCalcRowBoostCandy(r.id, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <div class="calcRow__result">
            <div class="calcRow__res">
              <span class="calcRow__k">{{ t("calc.row.breakdownBoost") }}</span>
              <span class="calcRow__v"><span class="calcRow__num">{{ fmtNum(r.result.boostCandy) }}</span></span>
            </div>
            <div class="calcRow__res">
              <span class="calcRow__k">{{ t("calc.row.breakdownNormal") }}</span>
              <span class="calcRow__v"><span class="calcRow__num">{{ fmtNum(r.result.normalCandy) }}</span></span>
            </div>
            <div class="calcRow__res">
              <span class="calcRow__k">{{ t("calc.row.candyTotal") }}</span>
              <span class="calcRow__v"><span class="calcRow__num">{{ fmtNum(r.result.normalCandy + r.result.boostCandy) }}</span></span>
            </div>
            <div class="calcRow__res">
              <span class="calcRow__k">{{ t("calc.row.shards") }}</span>
              <span class="calcRow__v"><span class="calcRow__num">{{ fmtNum(r.result.shards) }}</span></span>
            </div>
          </div>
        </div>
      </div>
      <p class="boxEmpty" v-else>{{ t("calc.empty") }}</p>

    </section>

    <section id="neo-box" class="panel panel--box">
      <div class="panel__head">
        <h2 class="panel__title">{{ t("box.title") }}</h2>
        <div class="panel__side">
          <button class="btn btn--danger" type="button" @click="onClearBox" :disabled="!boxEntries.length">
            {{ t("box.clearAll") }}
          </button>
        </div>
      </div>

      <div class="boxGrid">
        <details class="boxDisclosure">
          <summary class="boxDisclosure__summary">
            <span class="boxDisclosure__title">{{ t("box.addNew") }}</span>
            <span class="boxDisclosure__hint">{{ t("box.addNewHint") }}</span>
          </summary>
          <div class="boxCard boxCard--inner">
            <p class="boxCard__desc">
              {{ t("box.addNewDesc") }}
            </p>
            <div class="boxAddGrid">
              <label class="field">
                <span class="field__label">{{ t("box.add.nameDex") }}</span>
                <div class="suggest">
                  <input
                    v-model="addName"
                    class="field__input"
                    :placeholder="t('box.add.nameDexPh')"
                    @focus="onAddNameFocus"
                    @blur="onAddNameBlur"
                    @input="onAddNameInput"
                    @keydown.esc.prevent="closeAddNameSuggest"
                    @compositionstart="isComposing = true"
                    @compositionend="isComposing = false"
                  />
                  <div v-if="showAddNameSuggest" class="suggest__panel" role="listbox">
                    <button
                      v-for="n in addNameSuggestList"
                      :key="n"
                      type="button"
                      class="suggest__item"
                      role="option"
                      @mousedown.prevent="pickAddName(n)"
                    >
                      {{ n }}
                    </button>
                  </div>
                </div>
                <span class="field__sub" v-if="addLookup">
                  {{
                    t("box.add.detected", {
                      name: getPokemonNameLocalized(addLookup.pokedexId, addLookup.form, locale as any),
                      id: addLookup.pokedexId,
                      expType: addLookup.expType,
                    })
                  }}
                </span>
                <span class="field__sub" v-else>{{ t("box.add.noMatch") }}</span>
              </label>
              <label class="field">
                <span class="field__label">{{ t("box.add.labelOpt") }}</span>
                <input v-model="addLabel" class="field__input" :placeholder="t('box.add.labelOptPh')" />
              </label>
              <label class="field">
                <span class="field__label">{{ t("box.add.level") }}</span>
                <input v-model.number="addLevel" type="number" min="1" max="65" class="field__input" />
              </label>
              <label class="field field--sm">
                <span class="field__label">{{ t("box.add.nature") }}</span>
                <NatureSelect
                  v-model="addNature"
                  :label="t('box.add.nature')"
                  :label-normal="t('calc.row.natureNormal')"
                  :label-up="t('calc.row.natureUp')"
                  :label-down="t('calc.row.natureDown')"
                />
              </label>
              <label class="field">
                <span class="field__label">{{ t("box.add.specialtyOpt") }}</span>
                <select v-model="addSpecialty" class="field__input" @change="onAddSpecialtyChanged">
                  <option value="">{{ t("box.add.specialtyUnknown") }}</option>
                  <option value="Berries">{{ gt("きのみ") }}</option>
                  <option value="Ingredients">{{ gt("食材") }}</option>
                  <option value="Skills">{{ gt("スキル") }}</option>
                  <option value="All">{{ gt("オール") }}</option>
                </select>
                <span class="field__sub">{{ t("box.add.specialtyAutoHint") }}</span>
              </label>
              <label class="field">
                <span class="field__label">{{ t("box.add.expType") }}</span>
                <select v-model.number="addExpType" class="field__input" :disabled="!!addLookup" @change="onAddExpTypeChanged">
                  <option :value="600">600</option>
                  <option :value="900">900</option>
                  <option :value="1080">1080</option>
                  <option :value="1320">1320</option>
                </select>
                <span class="field__sub">
                  {{ addLookup ? t("box.add.expTypeAuto") : t("box.add.expTypeManual") }}
                </span>
              </label>

              <label class="field">
                <span class="field__label">{{ t("box.add.ingredientType") }}</span>
                <input
                  v-model="addIngredientType"
                  class="field__input"
                  list="ingredientTypeOptions"
                  :placeholder="t('box.add.ingredientTypePh')"
                  @change="onAddIngredientTypeChanged"
                />
                <datalist id="ingredientTypeOptions">
                  <option v-for="x in ingredientTypeOptions" :key="x.type" :value="x.type">
                    {{ x.preview }}
                  </option>
                </datalist>
                <span class="field__sub" v-if="addLookup && addIngredientType">
                  {{ ingredientTypeOptions.find((x) => x.type === addIngredientType)?.preview }}
                </span>
                <span class="field__sub" v-else>{{ t("box.add.ingredientPreviewHint") }}</span>
              </label>

              <label class="field field--wide">
                <span class="field__label">{{ t("box.add.subSkills") }}</span>
                <div class="subGrid">
                  <label class="subField">
                    <span class="subField__k">Lv10</span>
                    <input
                      v-model="addSubLv10"
                      class="field__input"
                      :class="{ 'field__input--error': !!addSubErrors['10'] }"
                      list="subSkillOptions"
                      :placeholder="t('box.add.subSkillExample')"
                      @blur="onSubBlur(10)"
                    />
                    <span v-if="addSubErrors['10']" class="field__error">{{ addSubErrors["10"] }}</span>
                  </label>
                  <label class="subField">
                    <span class="subField__k">Lv25</span>
                    <input
                      v-model="addSubLv25"
                      class="field__input"
                      :class="{ 'field__input--error': !!addSubErrors['25'] }"
                      list="subSkillOptions"
                      :placeholder="t('box.add.subSkillLvPh')"
                      @blur="onSubBlur(25)"
                    />
                    <span v-if="addSubErrors['25']" class="field__error">{{ addSubErrors["25"] }}</span>
                  </label>
                  <label class="subField">
                    <span class="subField__k">Lv50</span>
                    <input
                      v-model="addSubLv50"
                      class="field__input"
                      :class="{ 'field__input--error': !!addSubErrors['50'] }"
                      list="subSkillOptions"
                      :placeholder="t('box.add.subSkillLvPh')"
                      @blur="onSubBlur(50)"
                    />
                    <span v-if="addSubErrors['50']" class="field__error">{{ addSubErrors["50"] }}</span>
                  </label>
                  <label class="subField">
                    <span class="subField__k">Lv75</span>
                    <input
                      v-model="addSubLv75"
                      class="field__input"
                      :class="{ 'field__input--error': !!addSubErrors['75'] }"
                      list="subSkillOptions"
                      :placeholder="t('box.add.subSkillLvPh')"
                      @blur="onSubBlur(75)"
                    />
                    <span v-if="addSubErrors['75']" class="field__error">{{ addSubErrors["75"] }}</span>
                  </label>
                  <label class="subField">
                    <span class="subField__k">Lv100</span>
                    <input
                      v-model="addSubLv100"
                      class="field__input"
                      :class="{ 'field__input--error': !!addSubErrors['100'] }"
                      list="subSkillOptions"
                      :placeholder="t('box.add.subSkillLvPh')"
                      @blur="onSubBlur(100)"
                    />
                    <span v-if="addSubErrors['100']" class="field__error">{{ addSubErrors["100"] }}</span>
                  </label>
                </div>
                <datalist id="subSkillOptions">
                  <option v-for="label in subSkillOptionLabels" :key="label" :value="label" />
                </datalist>
                <span class="field__sub">{{ t("box.add.subSkillNote") }}</span>
              </label>
              <div class="boxAddActions">
                <button class="btn btn--primary" type="button" @click="onCreateManual({ mode: 'toCalc' })">
                  {{ t("box.add.toCalc") }}
                </button>
                <button class="btn" type="button" @click="onCreateManual({ mode: 'toBox' })">
                  {{ t("box.add.toBox") }}
                </button>
              </div>
            </div>
          </div>
        </details>

        <details class="boxDisclosure">
          <summary class="boxDisclosure__summary">
            <span class="boxDisclosure__title">{{ t("box.import.title") }}</span>
            <span class="boxDisclosure__hint">{{ t("box.import.hint") }}</span>
          </summary>
          <div class="boxCard boxCard--inner">
            <p class="boxCard__desc">
              {{ t("box.import.desc") }}
            </p>
            <textarea v-model="importText" class="boxTextarea" rows="7" :placeholder="t('box.import.ph')" />
            <div class="boxCard__actions">
              <button class="btn btn--primary" type="button" @click="onImport">
                {{ t("box.import.run") }}
              </button>
              <button class="btn btn--ghost" type="button" @click="importText = ''">
                {{ t("common.clear") }}
              </button>
              <span class="boxCard__status" v-if="importStatus">{{ importStatus }}</span>
            </div>
          </div>
        </details>

        <div class="boxCard">
          <div class="boxCard__head">
            <h3 class="boxCard__title">{{ t("box.list.title") }}</h3>
            <div class="boxCard__tools">
              <input v-model="boxFilter" class="boxSearch" :placeholder="t('box.list.searchPh')" />
              <button class="btn btn--ghost" type="button" @click="boxFilter = ''" :disabled="!boxFilter.trim()">
                {{ t("box.list.clearSearch") }}
              </button>
            </div>
          </div>

          <p class="boxListHint">
            {{ t("box.list.hint") }}
          </p>

          <div class="boxFilters">
            <div class="boxFilters__row boxFilters__row--main">
              <div class="boxFilters__group">
                <span class="boxFilters__label">{{ t("box.list.join") }}</span>
                <select v-model="filterJoinMode" class="field__input boxFilters__select" :aria-label="t('box.list.join')">
                  <option value="and">{{ t("box.list.joinAnd") }}</option>
                  <option value="or">{{ t("box.list.joinOr") }}</option>
                </select>
              </div>

              <div class="boxFilters__group">
                <span class="boxFilters__label">{{ t("box.list.favorites") }}</span>
                <div class="boxFilters__chips">
                  <button
                    class="chipBtn chipBtn--iconOnly"
                    :class="{ 'chipBtn--on': favoritesOnly }"
                    type="button"
                    @click="favoritesOnly = !favoritesOnly"
                    :title="t('box.list.favoritesOnlyTitle')"
                    :aria-label="t('box.list.favoritesOnlyAria')"
                  >
                    <span class="chipBtn__icon" v-html="iconStarSvg" aria-hidden="true"></span>
                  </button>
                </div>
              </div>
            </div>

            <div class="boxFilters__row boxFilters__row--chips">
              <div class="boxFilters__group">
                <span class="boxFilters__label">{{ t("box.list.specialty") }}</span>
                <div class="boxFilters__chips">
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Berries') }"
                    type="button"
                    @click="toggleSpecialty('Berries')"
                    :aria-label="t('box.list.specialtyAria', { name: gt('きのみ') })"
                  >
                    <span class="chipBtn__icon" v-html="iconBerrySvg" aria-hidden="true"></span>
                    <span class="chipBtn__text">{{ gt("きのみ") }}</span>
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Ingredients') }"
                    type="button"
                    @click="toggleSpecialty('Ingredients')"
                    :aria-label="t('box.list.specialtyAria', { name: gt('食材') })"
                  >
                    <span class="chipBtn__icon" v-html="iconIngredientsSvg" aria-hidden="true"></span>
                    <span class="chipBtn__text">{{ gt("食材") }}</span>
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Skills') }"
                    type="button"
                    @click="toggleSpecialty('Skills')"
                    :aria-label="t('box.list.specialtyAria', { name: gt('スキル') })"
                  >
                    <span class="chipBtn__icon" v-html="iconSkillsSvg" aria-hidden="true"></span>
                    <span class="chipBtn__text">{{ gt("スキル") }}</span>
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('All') }"
                    type="button"
                    @click="toggleSpecialty('All')"
                    :aria-label="t('box.list.specialtyAria', { name: gt('オール') })"
                  >
                    <span class="chipBtn__icon" v-html="iconAllSvg" aria-hidden="true"></span>
                    <span class="chipBtn__text">{{ gt("オール") }}</span>
                  </button>
                </div>
              </div>
            </div>

            <details class="boxFilters__subskill">
              <summary class="boxFilters__summary">
                <span>{{ t("box.list.subskillFilter") }}</span>
                <span class="boxFilters__summaryCount" v-if="selectedSubSkillEns.length">（{{ selectedSubSkillEns.length }}）</span>
              </summary>
              <div class="boxFilters__row boxFilters__row--sub">
                <div class="boxFilters__group">
                  <span class="boxFilters__label">{{ t("box.list.subskillJoin") }}</span>
                  <select v-model="subSkillJoinMode" class="field__input boxFilters__select" :aria-label="t('box.list.subskillJoin')">
                    <option value="or">{{ t("box.list.subskillJoinOr") }}</option>
                    <option value="and">{{ t("box.list.subskillJoinAnd") }}</option>
                  </select>
                </div>
                <button class="btn btn--ghost" type="button" @click="selectedSubSkillEns = []" :disabled="!selectedSubSkillEns.length">
                  {{ t("box.list.subskillClear") }}
                </button>
              </div>
              <div class="boxFilters__list">
                <label v-for="s in availableSubSkills" :key="s.nameEn" class="boxFilters__item">
                  <input
                    type="checkbox"
                    class="boxFilters__check"
                    :value="s.nameEn"
                    v-model="selectedSubSkillEns"
                  />
                  <span class="boxFilters__itemLabel">{{ subSkillLabel(s) }}</span>
                </label>
              </div>
            </details>
          </div>

          <div class="boxSortRow">
            <div class="boxSortRow__left">
              <button class="btn btn--ghost" type="button" @click="onUndo" :disabled="!canUndo" :title="t('box.list.undoTitle')">
                {{ t("common.undo") }}
              </button>
            </div>
            <div class="boxSort">
              <select v-model="boxSortKey" class="field__input boxSort__select" :aria-label="t('box.list.sortKeyAria')">
                <option value="label">{{ t("box.list.sortLabel") }}</option>
                <option value="level">{{ t("box.list.sortLevel") }}</option>
              </select>
              <button class="btn btn--ghost" type="button" @click="boxSortDir = boxSortDir === 'asc' ? 'desc' : 'asc'">
                {{ boxSortDir === "asc" ? t("box.list.sortAsc") : t("box.list.sortDesc") }}
              </button>
            </div>
          </div>

          <div class="boxList" v-if="sortedBoxEntries.length">
            <template v-for="(e, idx) in sortedBoxEntries" :key="e.id">
              <button
                type="button"
                class="boxTile"
                :class="[boxTileTypeClass(e), { 'boxTile--active': e.id === selectedBoxId }]"
                :data-type="e.derived ? getPokemonType(e.derived.pokedexId, e.derived.form) : 'unknown'"
                @click="onSelectBox(e.id)"
              >
                <div class="boxTile__name">{{ displayBoxTitle(e) }}</div>
                <div class="boxTile__lv">
                  Lv{{ e.planner?.level ?? e.derived?.level ?? "-" }}
                  <span v-if="e.favorite" class="boxTile__fav" :aria-label="t('box.list.favorite')" :title="t('box.list.favorite')">★</span>
                </div>
              </button>

              <div
                v-if="idx === detailInsertAfterIndex && selectedBox && selectedDetail"
                class="boxDetail boxDetail--inline"
              >
                <div class="boxDetail__head">
                  <h4 class="boxDetail__title">{{ t("box.list.selected", { name: displayBoxTitle(selectedBox) }) }}</h4>
                  <div class="boxDetail__actions">
                    <button class="btn btn--primary" type="button" @click="applyBoxToCalculator">
                      {{ t("box.add.toCalc") }}
                    </button>
                    <button class="btn btn--danger" type="button" @click="onDeleteSelected">
                      {{ t("common.delete") }}
                    </button>
                  </div>
                </div>

                <div class="boxDetail__grid">
                  <div class="boxDetail__col">
                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("box.detail.nickname") }}</div>
                      <div class="boxDetail__v">
                        <input
                          class="field__input"
                          :value="selectedBox.label ?? ''"
                          :placeholder="displayPokemonName(selectedBox) ?? t('common.optional')"
                          @change="onEditSelectedLabel(($event.target as HTMLInputElement).value)"
                        />
                        <div class="boxDetail__minor">{{ t("box.detail.nicknameClearHint") }}</div>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("box.detail.speciesLink") }}</div>
                      <div class="boxDetail__v">
                        <div>
                          <span class="boxDetail__strong">{{ displayPokemonName(selectedBox) ?? t("box.detail.unlinked") }}</span>
                          <span class="boxDetail__minor" v-if="selectedBox.derived?.pokedexId">
                            {{ t("box.detail.dexNo", { id: selectedBox.derived.pokedexId }) }}
                          </span>
                          <span class="boxDetail__minor" v-else>{{ t("box.detail.relinkHint") }}</span>
                        </div>

                        <div class="relinkRow suggest">
                          <input
                            v-model="relinkName"
                            class="field__input"
                            :placeholder="t('box.detail.relinkPh')"
                            @focus="relinkOpen = true"
                            @blur="onRelinkBlur"
                            @input="onRelinkInput"
                          />
                          <button class="btn btn--ghost" type="button" @click="onRelinkApply" :disabled="!relinkName.trim()">
                            {{ t("box.detail.relinkButton") }}
                          </button>
                          <div class="boxDetail__minor" v-if="relinkFound">
                            {{
                              t("box.detail.relinkCandidate", {
                                name: getPokemonNameLocalized(relinkFound.pokedexId, relinkFound.form, locale as any),
                                id: relinkFound.pokedexId,
                                expType: relinkFound.expType,
                              })
                            }}
                          </div>
                          <div class="boxDetail__minor" v-else-if="relinkName.trim()">{{ t("box.detail.relinkNoCandidate") }}</div>
                          <div v-if="relinkOpen && relinkSuggestList.length" class="suggest__panel" role="listbox">
                            <button
                              v-for="n in relinkSuggestList"
                              :key="n"
                              type="button"
                              class="suggest__item"
                              role="option"
                              @mousedown.prevent="pickRelinkName(n)"
                            >
                              {{ n }}
                            </button>
                          </div>
                        </div>

                        <div class="boxDetail__minor" v-if="relinkStatus">{{ relinkStatus }}</div>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("box.detail.level") }}</div>
                      <div class="boxDetail__v">
                        <div class="levelPick">
                          <button
                            type="button"
                            class="field__input field__input--button levelPick__button"
                            @click.stop="toggleBoxLevelPick"
                            aria-haspopup="dialog"
                            :aria-expanded="openBoxLevelPick"
                          >
                            {{ selectedDetail?.level ?? 1 }}
                          </button>

                          <div
                            v-if="openBoxLevelPick"
                            class="levelPick__popover"
                            role="dialog"
                            :aria-label="t('calc.row.pickLevelAria', { label: t('box.detail.level') })"
                          >
                            <div class="levelPick__top">
                              <div class="levelPick__title">{{ t("box.detail.level") }}</div>
                              <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="closeBoxLevelPick()">
                                {{ t("common.close") }}
                              </button>
                            </div>

                            <div class="levelPick__sliderRow">
                              <button class="btn btn--ghost btn--xs" type="button" @click="nudgeBoxLevel(-1)" :disabled="(selectedDetail?.level ?? 1) <= 1">
                                ◀
                              </button>
                              <input
                                class="levelPick__range"
                                type="range"
                                min="1"
                                max="65"
                                step="1"
                                :value="selectedDetail?.level ?? 1"
                                @input="setBoxLevel(($event.target as HTMLInputElement).value)"
                              />
                              <button class="btn btn--ghost btn--xs" type="button" @click="nudgeBoxLevel(1)" :disabled="(selectedDetail?.level ?? 1) >= 65">
                                ▶
                              </button>
                            </div>

                            <div class="levelPick__chips">
                              <button
                                v-for="lv in levelPresets"
                                :key="`box_${lv}`"
                                type="button"
                                class="levelChip"
                                :class="{ 'levelChip--on': lv === (selectedDetail?.level ?? 1) }"
                                @click="setBoxLevel(lv)"
                                :disabled="lv < 1 || lv > 65"
                              >
                                {{ lv }}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("calc.row.expType") }}</div>
                      <div class="boxDetail__v">
                        <div
                          v-if="(selectedDetail?.pokedexId ?? 0) > 0"
                          class="field__input field__input--static"
                          :title="t('calc.row.expTypeFixedHint')"
                        >
                          {{ selectedDetail?.expType ?? 600 }}
                        </div>
                        <select
                          v-else
                          class="field__input"
                          :value="String(selectedDetail?.expType ?? 600)"
                          @change="onEditSelectedExpType(($event.target as HTMLSelectElement).value)"
                        >
                          <option value="600">600</option>
                          <option value="900">900</option>
                          <option value="1080">1080</option>
                          <option value="1320">1320</option>
                        </select>
                        <span class="boxDetail__minor" v-if="(selectedDetail?.pokedexId ?? 0) <= 0">
                          {{ t("box.detail.speciesUnknownHint") }}
                        </span>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("box.list.specialty") }}</div>
                      <div class="boxDetail__v">
                        <select
                          class="field__input"
                          :value="selectedSpecialtySelectValue"
                          @change="onEditSelectedSpecialty(($event.target as HTMLSelectElement).value)"
                        >
                          <option value="">{{ t("box.detail.unknownAuto") }}</option>
                          <option value="Berries">{{ gt("きのみ") }}</option>
                          <option value="Ingredients">{{ gt("食材") }}</option>
                          <option value="Skills">{{ gt("スキル") }}</option>
                          <option value="All">{{ gt("オール") }}</option>
                        </select>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("calc.row.nature") }}</div>
                      <div class="boxDetail__v">
                        <NatureSelect
                          v-model="selectedNature"
                          @update:model-value="onBoxItemNatureChange"
                          :label="t('calc.row.nature')"
                          :label-normal="t('calc.row.natureNormal')"
                          :label-up="t('calc.row.natureUp')"
                          :label-down="t('calc.row.natureDown')"
                        />
                        <span class="boxDetail__minor" v-if="selectedDetail?.decoded?.natureName">
                          （{{ localizeNature(selectedDetail.decoded.natureName, locale as any) }}）
                        </span>
                      </div>
                    </div>
                  </div>

                  <div class="boxDetail__col">
                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("box.detail.ingredients") }}</div>
                      <div class="boxDetail__v boxDetail__v--mono">
                        <div class="boxDetail__editRow">
                          <select
                            class="field__input"
                            :value="selectedDetail.ingredientType ?? ''"
                            @change="onEditSelectedIngredientType(($event.target as HTMLSelectElement).value)"
                          >
                            <option value="">{{ t("box.detail.unknownAuto") }}</option>
                            <option v-for="t in IngredientTypes" :key="t" :value="t">{{ t }}</option>
                          </select>
                        </div>
                        <div v-if="selectedDetail.ingredientSlots">
                          {{ selectedDetail.ingredientSlots.map(toIngredientLabel).join(" / ") }}
                        </div>
                        <div v-else>{{ t("box.detail.unknown") }}</div>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("box.detail.subSkills") }}</div>
                      <div class="boxDetail__v boxDetail__v--mono">
                        <div class="boxDetail__subEdit">
                          <div v-for="lv in [10, 25, 50, 75, 100]" :key="lv" class="subField">
                            <span class="subField__k">Lv{{ lv }}</span>
                            <input
                              :value="boxEditSubInputs[String(lv)] ?? ''"
                              class="field__input"
                              :class="{ 'field__input--error': !!boxEditSubErrors[String(lv)] }"
                              list="subSkillOptions"
                              :placeholder="t('box.add.subSkillLvPh')"
                              @input="onBoxEditSubInput(lv, ($event.target as HTMLInputElement).value)"
                              @blur="onBoxEditSubBlur(lv)"
                            />
                            <span v-if="boxEditSubErrors[String(lv)]" class="field__error">{{ boxEditSubErrors[String(lv)] }}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">{{ t("box.list.favorite") }}</div>
                      <div class="boxDetail__v">
                        <button
                          class="chipBtn chipBtn--iconOnly"
                          :class="{ 'chipBtn--on': !!selectedBox.favorite }"
                          type="button"
                          @click="toggleSelectedFavorite"
                        >
                          <span class="chipBtn__icon" v-html="iconStarSvg" aria-hidden="true"></span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <p class="boxEmpty" v-else>{{ t("box.empty") }}</p>
        </div>
      </div>

    </section>

    <!-- 1枚出力（スクショ用）: calc/boxタブに依存せず表示できるように main 直下へ -->
    <div v-if="calcExportOpen" class="exportOverlay" @click.self="closeCalcExport" role="dialog" :aria-label="t('calc.export.open')">
      <div class="exportSheetWrap">
        <div
          ref="exportSheetEl"
          class="exportSheet"
          :class="{ 'exportSheet--capture': exportBusy }"
          :style="{ transform: exportBusy ? 'none' : `scale(${calcExportScale})` }"
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
              <button class="linkBtn linkBtn--basic" type="button" @click="closeCalcExport" :disabled="exportBusy">{{ t("calc.export.close") }}</button>
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
                    <div class="statCard__value" :class="{ 'statCard__value--danger': calcBoostCandyOver > 0 }">
                      {{ fmtNum(calcTotalBoostCandyUsed) }}
                    </div>
                  </div>
                </div>
                <div class="statCard">
                  <div class="statCard__icon">⚪</div>
                  <div class="statCard__content">
                    <div class="statCard__label">{{ t("calc.export.sumNormalTotal") }}</div>
                    <div class="statCard__value">{{ fmtNum(calcExportTotals.normalCandy) }}</div>
                  </div>
                </div>
                <div class="statCard" :class="{ 'statCard--danger': calcBoostCandyOver > 0 }">
                  <div class="statCard__icon">⚠️</div>
                  <div class="statCard__content">
                    <div class="statCard__label">{{ t("calc.export.sumBoostUnused") }}</div>
                    <div class="statCard__value">{{ fmtNum(calcBoostCandyUnused) }}</div>
                  </div>
                </div>
                <div class="statCard statCard--primary">
                  <div class="statCard__icon">💎</div>
                  <div class="statCard__content">
                    <div class="statCard__label">{{ t("calc.export.sumShardsTotal") }}</div>
                    <div class="statCard__value" :class="{ 'statCard__value--danger': calcShardsCap > 0 && calcShardsOver > 0 }">
                      {{ fmtNum(calcTotalShardsUsed) }}
                    </div>
                  </div>
                </div>
              </div>

              <div
                class="calcSum calcSum--bar"
                :class="{
                  'calcSum--danger': calcShardsOver > 0 || calcBoostCandyOver > 0,
                  'calcSum--muted': calcShardsCap <= 0,
                }"
              >
                <div class="calcBarBlock calcBarBlock--candy" :class="{ 'calcBarBlock--danger': calcBoostCandyOver > 0 }">
                  <div class="calcSum__head">
                    <div class="calcSum__k">
                      {{ t("calc.boostCandyUsage", { pct: calcBoostCandyUsagePctRounded }) }}
                      <span v-if="showBoostCandyFire" aria-hidden="true"> 🔥</span>
                      <span v-if="calcBoostCandyOver > 0" class="calcSum__overVal"> (+{{ fmtNum(calcBoostCandyOver) }})</span>
                    </div>
                    <div class="calcSum__k calcSum__k--right">
                      {{ t("calc.cap", { cap: fmtNum(calcBoostCandyCap) }) }}
                    </div>
                  </div>
                  <div
                    class="calcBar"
                    role="progressbar"
                    :aria-valuenow="Math.max(0, calcTotalBoostCandyUsed)"
                    aria-valuemin="0"
                    :aria-valuemax="Math.max(1, calcBoostCandyCap)"
                    :aria-label="t('calc.boostCandyUsageAria', { pct: calcBoostCandyUsagePctRounded, cap: fmtNum(calcBoostCandyCap) })"
                  >
                    <div class="calcBar__track">
                      <div class="calcBar__fill calcBar__fill--candy" :style="{ width: `${calcBoostCandyFillPctForBar}%` }"></div>
                      <div
                        v-if="calcBoostCandyOver > 0 && calcBoostCandyCap > 0"
                        class="calcBar__over"
                        :style="{ width: `${calcBoostCandyOverPctForBar}%` }"
                      ></div>
                    </div>
                  </div>
                </div>

                <div class="calcBarBlock">
                  <div class="calcSum__head">
                    <div class="calcSum__k">
                      {{ calcShardsCap > 0 ? t("calc.shardsUsage", { pct: calcShardsUsagePctRounded }) : t("calc.shardsUsageDash") }}
                      <span v-if="showShardsFire" aria-hidden="true"> 🔥</span>
                      <span v-if="calcShardsOver > 0" class="calcSum__overVal"> (+{{ fmtNum(calcShardsOver) }})</span>
                    </div>
                    <div class="calcSum__k calcSum__k--right">
                      {{ calcShardsCap > 0 ? t("calc.cap", { cap: fmtNum(calcShardsCap) }) : t("calc.capUnset") }}
                    </div>
                  </div>
                  <div
                    class="calcBar"
                    role="progressbar"
                    :aria-valuenow="Math.max(0, calcTotalShardsUsed)"
                    aria-valuemin="0"
                    :aria-valuemax="Math.max(1, calcShardsCap)"
                    :aria-label="
                      calcShardsCap > 0
                        ? t('calc.shardsUsageAria', { pct: calcShardsUsagePctRounded, cap: fmtNum(calcShardsCap) })
                        : t('calc.shardsCapUnsetAria')
                    "
                  >
                    <div class="calcBar__track">
                      <div class="calcBar__fill" :style="{ width: `${calcShardsFillPctForBar}%` }"></div>
                      <div
                        v-if="calcShardsOver > 0 && calcShardsCap > 0"
                        class="calcBar__over"
                        :style="{ width: `${calcShardsOverPctForBar}%` }"
                      ></div>
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

              <div v-for="row in calcExportRows" :key="row.id" class="exportList__row">
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
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': calcBoostCandyOver > 0 }">{{ fmtNum(calcExportTotals.boostCandy) }}</span>
                </div>
                <div class="exportList__col u-align-right exportList__numCol">
                  <span class="u-mobile-label">{{ t("calc.export.colNormal") }}</span>
                  <span class="calcRow__num">{{ fmtNum(calcExportTotals.normalCandy) }}</span>
                </div>
                <div class="exportList__col u-align-right exportList__numCol">
                  <span class="u-mobile-label">{{ t("calc.export.colTotal") }}</span>
                  <span class="calcRow__num">{{ fmtNum(calcExportTotals.totalCandy) }}</span>
                </div>
                <div class="exportList__col u-align-right exportList__numCol">
                  <span class="u-mobile-label">{{ t("calc.export.colShards") }}</span>
                  <span class="calcRow__num" :class="{ 'calcRow__num--danger': calcShardsCap > 0 && calcShardsOver > 0 }">{{ fmtNum(calcExportTotals.shards) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, toRaw, watch } from "vue";
import { onMounted, onUnmounted } from "vue";
import { toPng } from "html-to-image";
import { useI18n } from "vue-i18n";
import { localizeGameTerm, localizeNature } from "./i18n/terms";
import type { BoostEvent, ExpGainNature, ExpType } from "./domain";
import { calcExp, calcExpAndCandy, calcExpAndCandyByBoostExpRatio, calcExpAndCandyMixed, calcLevelByCandy } from "./domain/pokesleep";
import { boostRules } from "./domain/pokesleep/boost-config";
import type { BoxSubSkillSlotV1, IngredientType, PokemonBoxEntryV1, PokemonSpecialty } from "./domain/types";
import { decodeNitoyonIvDetail, decodeNitoyonIvMinimal, parseNitoyonBoxLine } from "./domain/box/nitoyon";
import { cryptoRandomId, loadBox, saveBox } from "./persistence/box";
import type { CalcRowV1, CalcSaveSlotV1 } from "./persistence/calc";
import { loadCalcAutosave, loadCalcSlots, loadLegacyTotalShards, saveCalcAutosave, saveCalcSlots } from "./persistence/calc";
import NatureSelect from "./components/NatureSelect.vue";
import {
  findPokemonByNameJa,
  getPokemonExpType,
  getPokemonIngredients,
  getPokemonNameJa,
  getPokemonSpecialty,
  getPokemonType,
  pokemonIdFormsByNameJa,
} from "./domain/pokesleep/pokemon-names";
import { getPokemonNameLocalized } from "./domain/pokesleep/pokemon-name-localize";
import { IngredientTypes, SubSkillAllJaSorted, SubSkillAllNames, SubSkillNameJaByEn, subSkillEnFromJa } from "./domain/box/nitoyon";

import iconBerrySvg from "./assets/icons/berry.svg?raw";
import iconIngredientsSvg from "./assets/icons/ingredients.svg?raw";
import iconSkillsSvg from "./assets/icons/skills.svg?raw";
import iconAllSvg from "./assets/icons/all.svg?raw";
import iconStarSvg from "./assets/icons/star.svg?raw";

const { t, locale } = useI18n();
function setLocale(next: "ja" | "en") {
  locale.value = next;
  localStorage.setItem("candy-boost-planner:lang", next);
}

function gt(s: string): string {
  return localizeGameTerm(s, locale.value as any);
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat(locale.value as any).format(n);
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

type SupportLink = { id: "ofuse" | "bmac"; label: string; href: string; ariaLabel: string };
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

const activeTab = ref<"calc" | "box">("calc");

const boxEntries = ref<PokemonBoxEntryV1[]>(loadBox());
const selectedBoxId = ref<string | null>(null);
const importText = ref("");
const importStatus = ref("");
const boxFilter = ref("");
const boxSortKey = ref<"label" | "level">("label");
const boxSortDir = ref<"asc" | "desc">("asc");

type FilterJoinMode = "and" | "or";
const filterJoinMode = ref<FilterJoinMode>("and"); // とくい/サブスキル の結合
const subSkillJoinMode = ref<FilterJoinMode>("or"); // 複数サブスキル の結合
const selectedSpecialties = ref<Array<"Berries" | "Ingredients" | "Skills" | "All">>([]);
const selectedSubSkillEns = ref<string[]>([]);
const favoritesOnly = ref(false);

const addName = ref("");
const addNameHasFocus = ref(false);
const addNameSuggestOpen = ref(false);
const isComposing = ref(false);
const addLabel = ref("");
const addLevel = ref(30);
const addExpType = ref<ExpType>(600);
const addExpTypeTouched = ref(false);
const addNature = ref<ExpGainNature>("normal");
const addLookup = computed(() => findPokemonByNameJa(addName.value));
const addSpecialty = ref<PokemonSpecialty | "">("");
const addSpecialtyTouched = ref(false);

const addIngredientType = ref<IngredientType | "">("");
const addIngredientTypeTouched = ref(false);
const addSubLv10 = ref("");
const addSubLv25 = ref("");
const addSubLv50 = ref("");
const addSubLv75 = ref("");
const addSubLv100 = ref("");

const addSubErrors = ref<Record<"10" | "25" | "50" | "75" | "100", string | null>>({
  "10": null,
  "25": null,
  "50": null,
  "75": null,
  "100": null,
});

const subSkillOptionLabels = computed(() => {
  if (locale.value === "en") return [...SubSkillAllNames];
  return SubSkillAllJaSorted.map((s) => s.nameJa);
});

const ingredientTypeOptions = computed(() => {
  const found = addLookup.value;
  if (!found) return IngredientTypes.map((t) => ({ type: t, preview: "" }));
  const ing = getPokemonIngredients(found.pokedexId, found.form);
  const toL = (k: string | null) => toIngredientLabel(k);
  const a = toL(ing?.a ?? null);
  const b = toL(ing?.b ?? null);
  const c = toL(ing?.c ?? null);
  return IngredientTypes.map((t) => {
    const slots = t.split("").map((x) => (x === "A" ? a : x === "B" ? b : c));
    return { type: t, preview: slots.join(" / ") };
  });
});

function onAddIngredientTypeChanged() {
  addIngredientTypeTouched.value = true;
}

function onAddSpecialtyChanged() {
  addSpecialtyTouched.value = true;
}

const allPokemonNameJa = Object.freeze(Object.keys(pokemonIdFormsByNameJa));

const addNameSuggestList = computed(() => {
  if (isComposing.value) return [];
  const q = addName.value.trim();
  if (q.length === 0) return [];
  // 先頭一致を基本に、最大12件まで
  const out: string[] = [];
  for (const n of allPokemonNameJa) {
    if (n.startsWith(q)) out.push(n);
    if (out.length >= 12) break;
  }
  // 先頭一致が少なすぎるときは部分一致も少し補う（最大12件）
  if (out.length < 6 && q.length >= 2) {
    for (const n of allPokemonNameJa) {
      if (out.includes(n)) continue;
      if (n.includes(q)) out.push(n);
      if (out.length >= 12) break;
    }
  }
  return out;
});

const showAddNameSuggest = computed(
  () => addNameHasFocus.value && addNameSuggestOpen.value && !isComposing.value && addNameSuggestList.value.length > 0
);

const relinkName = ref("");
const relinkOpen = ref(false);
const relinkStatus = ref<string>("");
const relinkFound = computed(() => findPokemonByNameJa(relinkName.value.trim()) ?? null);
const relinkSuggestList = computed(() => {
  const q = relinkName.value.trim();
  if (q.length === 0) return [];
  const out: string[] = [];
  for (const n of allPokemonNameJa) {
    if (n.startsWith(q)) out.push(n);
    if (out.length >= 10) break;
  }
  if (out.length < 5 && q.length >= 2) {
    for (const n of allPokemonNameJa) {
      if (out.includes(n)) continue;
      if (n.includes(q)) out.push(n);
      if (out.length >= 10) break;
    }
  }
  return out;
});

function onRelinkInput() {
  relinkOpen.value = true;
}
function pickRelinkName(n: string) {
  relinkName.value = n;
  relinkOpen.value = false;
}
function onRelinkBlur() {
  setTimeout(() => {
    relinkOpen.value = false;
  }, 0);
}

function onRelinkApply() {
  const e = selectedBox.value;
  if (!e) return;
  const found = relinkFound.value;
  if (!found) {
    relinkStatus.value = t("status.relinkFailed");
    return;
  }
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    const nextDerived = {
      pokedexId: found.pokedexId,
      form: found.form,
      level: x.planner?.level ?? x.derived?.level ?? 1,
      expType: found.expType,
      expGainNature: x.planner?.expGainNature ?? x.derived?.expGainNature ?? "normal",
      natureName: x.derived?.natureName ?? "",
    };
    return {
      ...x,
      derived: nextDerived,
      planner: {
        ...(x.planner ?? {}),
        // expTypeは「上書きしていない場合」だけ追従
        expType: x.planner?.expType ?? found.expType,
      },
      updatedAt: now,
    };
  });
  relinkStatus.value = t("status.relinkUpdated", { id: found.pokedexId });
  relinkName.value = "";
  relinkOpen.value = false;
}

function pickAddName(nameJa: string) {
  // 補完で選んだ場合は expType 自動同期を有効に戻す
  addExpTypeTouched.value = false;
  addName.value = nameJa;
  addNameSuggestOpen.value = false;
}

function onAddNameFocus() {
  addNameHasFocus.value = true;
  addNameSuggestOpen.value = true;
}

function closeAddNameSuggest() {
  addNameSuggestOpen.value = false;
}

function onAddNameInput() {
  if (!addNameHasFocus.value) return;
  if (isComposing.value) return;
  // 入力が変わったら（空→再入力含む）補完を復活させる
  addNameSuggestOpen.value = true;
}

function onAddNameBlur() {
  // クリック選択（mousedown）を優先するため、blurは少し遅らせて閉じる
  setTimeout(() => {
    addNameHasFocus.value = false;
    addNameSuggestOpen.value = false;
  }, 0);
}

function onAddExpTypeChanged() {
  addExpTypeTouched.value = true;
}

// 名前が一致したら expType を自動同期（手動で上書きした場合は維持）
watch(
  () => addLookup.value,
  (next) => {
    if (!next) return;
    if (addExpTypeTouched.value) return;
    addExpType.value = next.expType;
  }
);

watch(
  () => addLookup.value,
  (next) => {
    if (!next) return;
    if (addSpecialtyTouched.value) return;
    const sp = getPokemonSpecialty(next.pokedexId, next.form);
    addSpecialty.value = sp === "unknown" ? "" : (sp as any);
  }
);

type BoxUndoAction =
  | { kind: "delete"; entry: PokemonBoxEntryV1; index: number; selectedId: string | null }
  | { kind: "add"; addedIds: string[]; selectedId: string | null }
  | { kind: "import"; addedIds: string[]; selectedId: string | null }
  | { kind: "clear"; entries: PokemonBoxEntryV1[]; selectedId: string | null };
const boxUndoAction = ref<BoxUndoAction | null>(null);
const canUndo = computed(() => !!boxUndoAction.value);

function cloneBoxEntries(entries: PokemonBoxEntryV1[]): PokemonBoxEntryV1[] {
  // Vueのreactive配列/オブジェクトはProxyなので、まずtoRawで剥がしてからコピーする
  // （structuredClone(entries) は DataCloneError になりうる）
  const raw = toRaw(entries) as any;
  return JSON.parse(JSON.stringify(raw));
}

function cloneBoxEntry(e: PokemonBoxEntryV1): PokemonBoxEntryV1 {
  const raw = toRaw(e) as any;
  return JSON.parse(JSON.stringify(raw));
}

function onUndo() {
  const a = boxUndoAction.value;
  if (!a) return;
  if (a.kind === "delete") {
    const next = [...boxEntries.value];
    const idx = Math.max(0, Math.min(next.length, a.index));
    next.splice(idx, 0, a.entry);
    boxEntries.value = next.slice(0, 300);
    selectedBoxId.value = a.selectedId;
  } else if (a.kind === "add" || a.kind === "import") {
    const set = new Set(a.addedIds);
    boxEntries.value = boxEntries.value.filter((x) => !set.has(x.id));
    selectedBoxId.value = a.selectedId;
  } else if (a.kind === "clear") {
    boxEntries.value = a.entries;
    selectedBoxId.value = a.selectedId;
  }
  boxUndoAction.value = null;
  importStatus.value = t("status.undo");
  // selectedIdが変わらない場合でも編集UI（サブスキル等）を復元する
  nextTick(() => {
    syncBoxEditSubInputsFromSelected();
  });
}

watch(
  boxEntries,
  (v) => {
    saveBox(v);
  },
  { deep: true }
);

watch(
  () => selectedBoxId.value,
  () => {
    relinkName.value = "";
    relinkOpen.value = false;
    relinkStatus.value = "";
    openLevelPickRowId.value = null;
    openBoxLevelPick.value = false;
  }
);

const boxEditSubInputs = ref<Record<string, string>>({ "10": "", "25": "", "50": "", "75": "", "100": "" });
const boxEditSubErrors = ref<Record<string, string | null>>({ "10": null, "25": null, "50": null, "75": null, "100": null });

const openBoxLevelPick = ref(false);

function onGlobalPointerDown(ev: MouseEvent) {
  const t = ev.target as HTMLElement | null;
  if (!t) return;
  // レベルポップアップ内のクリックは閉じない
  if (t.closest(".levelPick")) return;
  openLevelPickRowId.value = null;
  openBoxLevelPick.value = false;
}

function onGlobalKeyDown(ev: KeyboardEvent) {
  if (ev.key === "Escape") {
    openLevelPickRowId.value = null;
    openBoxLevelPick.value = false;
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onGlobalPointerDown, true);
  document.addEventListener("keydown", onGlobalKeyDown);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onGlobalPointerDown, true);
  document.removeEventListener("keydown", onGlobalKeyDown);
});

const filteredBoxEntries = computed(() => {
  const q = boxFilter.value.trim().toLowerCase();
  const base = !q
    ? boxEntries.value
    : boxEntries.value.filter((e) => {
        const id = e.derived?.pokedexId ? String(e.derived.pokedexId) : "";
        return (
          (e.label || "").toLowerCase().includes(q) ||
          id.includes(q) ||
          e.rawText.toLowerCase().includes(q)
        );
      });

  const hasFavoriteFilter = favoritesOnly.value;
  const hasSpecialtyFilter = selectedSpecialties.value.length > 0;
  const hasSubSkillFilter = selectedSubSkillEns.value.length > 0;
  if (!hasFavoriteFilter && !hasSpecialtyFilter && !hasSubSkillFilter) return base;

  return base.filter((e) => {
    const decoded = getDecodedDetailForEntry(e);

    const pokedexId = e.derived?.pokedexId ?? decoded?.pokedexId ?? null;
    const form = e.derived?.form ?? decoded?.form ?? 0;
    const sp = (e.planner?.specialty ??
      (pokedexId ? getPokemonSpecialty(pokedexId, form) : "unknown")) as PokemonSpecialty;
    const favoriteOk = !!e.favorite;
    const specialtyOk = selectedSpecialties.value.includes(sp as any);

    const subEns = decoded?.subSkills?.map((s) => s.nameEn) ?? [];
    const subOk = matchSubSkills(subEns, selectedSubSkillEns.value, subSkillJoinMode.value);

    const oks: boolean[] = [];
    if (hasFavoriteFilter) oks.push(favoriteOk);
    if (hasSpecialtyFilter) oks.push(specialtyOk);
    if (hasSubSkillFilter) oks.push(subOk);
    // active filters are always at least 1 here
    return filterJoinMode.value === "and" ? oks.every(Boolean) : oks.some(Boolean);
  });
});

function matchSubSkills(haveEns: string[], wantEns: string[], mode: FilterJoinMode): boolean {
  if (wantEns.length === 0) return true;
  const set = new Set(haveEns);
  if (mode === "and") return wantEns.every((x) => set.has(x));
  return wantEns.some((x) => set.has(x));
}

// IVデコードは重いのでキャッシュ（1200件でもサクサクに）
const ivDetailCache = new Map<string, ReturnType<typeof decodeNitoyonIvDetail> | null>();
function getDecodedDetailForEntry(e: PokemonBoxEntryV1) {
  const iv = getIvFromRawText(e.rawText);
  if (!iv) {
    // 手入力個体はplanner側のサブスキルをフィルタ用に使う
    const subs = e.planner?.subSkills;
    if (!subs?.length) return null;
    const pokedexId = e.derived?.pokedexId ?? 0;
    const form = e.derived?.form ?? 0;
    return {
      pokedexId,
      form,
      level: e.planner?.level ?? e.derived?.level ?? 1,
      natureName: "",
      expGainNature: e.planner?.expGainNature ?? e.derived?.expGainNature ?? "normal",
      expType: e.planner?.expType ?? e.derived?.expType ?? 600,
      ingredientType: (e.planner?.ingredientType ?? null) as any,
      subSkills: subs.map((s) => ({
        lv: s.lv,
        nameEn: s.nameEn,
        nameJa: (SubSkillNameJaByEn as any)[s.nameEn] ?? s.nameEn,
      })),
    };
  }
  const cached = ivDetailCache.get(iv);
  if (cached !== undefined) return cached;
  const decoded = decodeNitoyonIvDetail(iv);
  ivDetailCache.set(iv, decoded);
  return decoded;
}

// サブスキル候補（今のボックスに存在するものだけ）
const availableSubSkills = computed(() => {
  const m = new Map<string, string>(); // en -> ja
  for (const e of boxEntries.value) {
    const d = getDecodedDetailForEntry(e);
    for (const s of d?.subSkills ?? []) {
      if (!m.has(s.nameEn)) m.set(s.nameEn, s.nameJa);
    }
  }
  return [...m.entries()]
    .map(([nameEn, nameJa]) => ({ nameEn, nameJa }))
    .sort((a, b) => a.nameJa.localeCompare(b.nameJa, "ja"));
});

function subSkillLabel(s: { nameEn: string; nameJa: string }): string {
  if (locale.value === "en") return s.nameEn;
  return s.nameJa;
}

const sortedBoxEntries = computed(() => {
  const list = [...filteredBoxEntries.value];
  const dir = boxSortDir.value === "asc" ? 1 : -1;
  const key = boxSortKey.value;
  list.sort((a, b) => {
    if (key === "level") {
      const la = a.planner?.level ?? a.derived?.level ?? 0;
      const lb = b.planner?.level ?? b.derived?.level ?? 0;
      if (la !== lb) return (la - lb) * dir;
      return displayBoxTitle(a).localeCompare(displayBoxTitle(b), locale.value === "en" ? "en" : "ja") * dir;
    }
    return displayBoxTitle(a).localeCompare(displayBoxTitle(b), locale.value === "en" ? "en" : "ja") * dir;
  });
  return list;
});

// 画面幅に応じた「タイル列数」をCSSのbreakpointと揃える（2 / 3 / 4）
const viewportWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1024);
function onResize() {
  viewportWidth.value = window.innerWidth;
}
onMounted(() => window.addEventListener("resize", onResize));
onUnmounted(() => window.removeEventListener("resize", onResize));

const boxColumns = computed(() => {
  const w = viewportWidth.value;
  return w >= 860 ? 4 : w >= 560 ? 3 : 2;
});

const selectedIndex = computed(() => {
  const id = selectedBoxId.value;
  if (!id) return -1;
  return sortedBoxEntries.value.findIndex((x) => x.id === id);
});

const detailInsertAfterIndex = computed(() => {
  const idx = selectedIndex.value;
  if (idx < 0) return -1;
  const cols = boxColumns.value;
  const row = Math.floor(idx / cols);
  const end = (row + 1) * cols - 1;
  return Math.min(sortedBoxEntries.value.length - 1, end);
});

function toIngredientJa(key: string | null): string {
  if (!key) return "-";
  return ingredientJa[key] ?? key;
}

function toIngredientLabel(key: string | null): string {
  if (!key) return "-";
  if (locale.value === "en") return ingredientEn[key] ?? key;
  return ingredientJa[key] ?? key;
}

const ingredientJa: Record<string, string> = {
  leek: "ネギ",
  mushroom: "キノコ",
  egg: "タマゴ",
  potato: "ポテト",
  apple: "リンゴ",
  herb: "ハーブ",
  sausage: "マメミート",
  milk: "ミルク",
  honey: "ハチミツ",
  oil: "オイル",
  ginger: "ショウガ",
  tomato: "トマト",
  cacao: "カカオ",
  tail: "しっぽ",
  soy: "だいず",
  corn: "とうもろこし",
  coffee: "コーヒー",
  pumpkin: "かぼちゃ",
  seed: "ひらめきのたね",
  avocado: "アボカド",
};

const ingredientEn: Record<string, string> = {
  leek: "Leek",
  mushroom: "Mushroom",
  egg: "Egg",
  potato: "Potato",
  apple: "Apple",
  herb: "Herb",
  sausage: "Bean Sausage",
  milk: "Milk",
  honey: "Honey",
  oil: "Oil",
  ginger: "Ginger",
  tomato: "Tomato",
  cacao: "Cacao",
  tail: "Slowpoke Tail",
  soy: "Soybeans",
  corn: "Corn",
  coffee: "Coffee",
  pumpkin: "Pumpkin",
  seed: "Greengrass Soybeans Seed",
  avocado: "Avocado",
};

function getIvFromRawText(rawText: string): string | null {
  const t = (rawText ?? "").trim();
  if (!t) return null;
  const at = t.indexOf("@");
  const iv = at === -1 ? t : t.slice(0, at);
  return iv || null;
}

// NOTE: computed/ watch の参照順で TDZ (Cannot access 'X' before initialization) が起きるため、
// 依存元の computed を先に宣言すること。
const selectedBox = computed(() => boxEntries.value.find((x) => x.id === selectedBoxId.value) ?? null);

const selectedNature = computed({
  get: () => selectedDetail.value?.expGainNature ?? "normal",
  set: (val: ExpGainNature) => {
    onEditSelectedNature(val);
  },
});

const selectedDetail = computed(() => {
  const e = selectedBox.value;
  if (!e) return null;
  const iv = getIvFromRawText(e.rawText);
  const decoded = iv ? decodeNitoyonIvDetail(iv) : null;

  const expType = e.planner?.expType ?? e.derived?.expType ?? (decoded?.expType ?? 600);
  const expGainNature = e.planner?.expGainNature ?? e.derived?.expGainNature ?? (decoded?.expGainNature ?? "normal");
  const level = e.planner?.level ?? e.derived?.level ?? decoded?.level ?? null;

  const pokedexId = e.derived?.pokedexId ?? decoded?.pokedexId ?? null;
  const form = e.derived?.form ?? decoded?.form ?? 0;
  const ingredients = pokedexId ? getPokemonIngredients(pokedexId, form) : null;
  // ユーザーがボックス詳細で編集した値を優先する（Nitoyonのdecodedを上書きできるようにする）
  const ingredientType = e.planner?.ingredientType ?? decoded?.ingredientType ?? null;
  const ingredientSlots =
    ingredients && ingredientType
      ? ingredientType
          .split("")
          .map((x) => (x === "A" ? ingredients.a : x === "B" ? ingredients.b : ingredients.c))
      : null;

  const subSkillsFromPlanner = (e.planner?.subSkills ?? []).map((s) => ({
    lv: s.lv,
    nameEn: s.nameEn,
    nameJa: (SubSkillNameJaByEn as any)[s.nameEn] ?? s.nameEn,
  }));
  const subSkills = decoded?.subSkills?.length ? decoded.subSkills : subSkillsFromPlanner;

  const specialty = (e.planner?.specialty ??
    (pokedexId ? getPokemonSpecialty(pokedexId, form) : "unknown")) as PokemonSpecialty;

  return {
    decoded: decoded ? { ...decoded, subSkills } : { pokedexId: pokedexId ?? 0, form, level: level ?? 1, natureName: "", expGainNature, expType, ingredientType, subSkills },
    expType,
    expGainNature,
    level,
    pokedexId,
    form,
    ingredients,
    ingredientType,
    ingredientSlots,
    subSkills,
    specialty,
  };
});

function syncBoxEditSubInputsFromSelected() {
  const d = selectedDetail.value;
  const next: Record<string, string> = { "10": "", "25": "", "50": "", "75": "", "100": "" };
  for (const s of d?.subSkills ?? []) {
    if (s.lv === 10 || s.lv === 25 || s.lv === 50 || s.lv === 75 || s.lv === 100) {
      next[String(s.lv)] = locale.value === "en" ? s.nameEn : s.nameJa;
    }
  }
  boxEditSubInputs.value = next;
  boxEditSubErrors.value = { "10": null, "25": null, "50": null, "75": null, "100": null };
}

// selectedBox / selectedDetail の初期化後に watch を定義する（TDZ回避）
watch(
  () => selectedBoxId.value,
  () => {
    syncBoxEditSubInputsFromSelected();
  },
  { immediate: true }
);

watch(
  () => locale.value,
  () => {
    syncBoxEditSubInputsFromSelected();
  }
);

const selectedSpecialtySelectValue = computed(() => {
  const manual = selectedBox.value?.planner?.specialty;
  if (manual && manual !== "unknown") return manual;
  const auto = selectedDetail.value?.specialty;
  if (auto && auto !== "unknown") return auto;
  return "";
});

function displayPokemonName(e: PokemonBoxEntryV1): string | null {
  if (!e.derived) return null;
  return getPokemonNameLocalized(e.derived.pokedexId, e.derived.form, locale.value as any);
}

function displayBoxTitle(e: PokemonBoxEntryV1): string {
  const name = displayPokemonName(e);
  const label = (e.label ?? "").trim();
  // labelが空、または "#123" だけのような暫定表示の場合は名前を優先
  if (!label) return name ?? "(no name)";
  if (name && /^#\d+$/.test(label)) return name;
  // 既存データの互換: label が日本語種族名で固定されている場合、英語表示では種族名に置き換える
  if (locale.value === "en" && e.derived) {
    const ja = getPokemonNameJa(e.derived.pokedexId, e.derived.form);
    if (ja && label === ja) return name ?? label;
  }
  return label;
}

function boxTileTypeClass(e: PokemonBoxEntryV1): string {
  if (!e.derived) return "boxTile--type-unknown";
  const t = getPokemonType(e.derived.pokedexId, e.derived.form);
  return `boxTile--type-${t}`;
}

function onSelectBox(id: string) {
  selectedBoxId.value = selectedBoxId.value === id ? null : id;
}

function toggleSpecialty(v: "Berries" | "Ingredients" | "Skills" | "All") {
  const cur = selectedSpecialties.value;
  if (cur.includes(v)) {
    selectedSpecialties.value = cur.filter((x) => x !== v);
  } else {
    selectedSpecialties.value = [...cur, v];
  }
}
function onClearSelection() {
  selectedBoxId.value = null;
}

function onImport() {
  const text = importText.value;
  const lines = text
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!lines.length) {
    importStatus.value = t("status.inputEmpty");
    return;
  }
  const undoSelectedId = selectedBoxId.value;

  const existing = new Set(boxEntries.value.map((e) => e.rawText));
  let added = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  const next: PokemonBoxEntryV1[] = [...boxEntries.value];
  const addedIds: string[] = [];

  for (const line of lines) {
    const parsed = parseNitoyonBoxLine(line);
    if (!parsed) continue;
    const rawText = parsed.nickname ? `${parsed.iv}@${parsed.nickname}` : parsed.iv;
    if (existing.has(rawText)) {
      skipped++;
      continue;
    }
    const derived0 = decodeNitoyonIvMinimal(parsed.iv);
    const name0 = derived0 ? getPokemonNameLocalized(derived0.pokedexId, derived0.form, locale.value as any) : null;
    const expT0 = derived0 ? getPokemonExpType(derived0.pokedexId, derived0.form) : 600;
    const entry: PokemonBoxEntryV1 = {
      id: cryptoRandomId(),
      source: "nitoyon",
      rawText,
      // nickname がない場合は label を空にして「種族名表示」に任せる（locale で切り替え可能にする）
      label: parsed.nickname || (derived0 ? "" : name0 || "(imported)"),
      derived: derived0
        ? {
            pokedexId: derived0.pokedexId,
            form: derived0.form,
            level: derived0.level,
            expType: expT0,
            expGainNature: derived0.expGainNature,
            natureName: derived0.natureName,
          }
        : undefined,
      planner: undefined,
      createdAt: now,
      updatedAt: now,
    };
    next.push(entry);
    addedIds.push(entry.id);
    existing.add(rawText);
    added++;
    if (next.length >= 300) break;
  }

  boxEntries.value = next;
  boxUndoAction.value = addedIds.length ? { kind: "import", addedIds, selectedId: undoSelectedId } : null;
  importStatus.value = t("status.importResult", { added, skipped });
}

function subSkillEnFromLabel(label: string): string | null {
  const v = String(label ?? "").trim();
  if (!v) return null;
  // English label (nitoyon internal) -> itself
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((SubSkillNameJaByEn as any)[v]) return v;
  // Japanese label -> convert to internal English
  return subSkillEnFromJa(v);
}

function buildManualPlannerSubSkills(): BoxSubSkillSlotV1[] | undefined {
  const slots: Array<{ lv: 10 | 25 | 50 | 75 | 100; ja: string }> = [
    { lv: 10, ja: addSubLv10.value },
    { lv: 25, ja: addSubLv25.value },
    { lv: 50, ja: addSubLv50.value },
    { lv: 75, ja: addSubLv75.value },
    { lv: 100, ja: addSubLv100.value },
  ];
  const out: BoxSubSkillSlotV1[] = [];
  for (const s of slots) {
    const ja = String(s.ja ?? "").trim();
    if (!ja) continue;
    const en = subSkillEnFromLabel(ja);
    if (!en) continue;
    out.push({ lv: s.lv, nameEn: en });
  }
  return out.length ? out : undefined;
}

function validateSubSkillField(lv: 10 | 25 | 50 | 75 | 100, value: string) {
  const ja = String(value ?? "").trim();
  const key = String(lv) as "10" | "25" | "50" | "75" | "100";
  if (!ja) {
    addSubErrors.value[key] = null;
    return;
  }
  const en = subSkillEnFromLabel(ja);
  addSubErrors.value[key] = en ? null : t("status.subSkillUnknown");
}

function onSubBlur(lv: 10 | 25 | 50 | 75 | 100) {
  const v =
    lv === 10
      ? addSubLv10.value
      : lv === 25
        ? addSubLv25.value
        : lv === 50
          ? addSubLv50.value
          : lv === 75
            ? addSubLv75.value
            : addSubLv100.value;
  validateSubSkillField(lv, v);
}

function onCreateManual(opts: { mode: "toCalc" | "toBox" }) {
  const found = addLookup.value;
  const now = new Date().toISOString();
  const lvl = Math.max(1, Math.min(65, Math.floor(Number(addLevel.value))));
  const nickname = String(addLabel.value || "").trim();
  // nickname が空でも、名前一致（図鑑リンク）できていればOK（表示名は locale で生成する）
  if (!nickname && !found) {
    importStatus.value = t("status.nameEmpty");
    return;
  }
  const undoSelectedId = selectedBoxId.value;
  const pokedexId = found?.pokedexId ?? 0;
  const form = found?.form ?? 0;
  const speciesName = found ? getPokemonNameLocalized(pokedexId, form, locale.value as any) : null;
  const expT = found ? found.expType : addExpType.value;
  const specialty = addSpecialty.value ? (addSpecialty.value as PokemonSpecialty) : undefined;
  const ingredientType =
    addIngredientType.value && IngredientTypes.includes(addIngredientType.value as any)
      ? (addIngredientType.value as IngredientType)
      : undefined;
  const subSkills = buildManualPlannerSubSkills();
  const entry: PokemonBoxEntryV1 = {
    id: cryptoRandomId(),
    source: "manual",
    rawText: "",
    label: nickname,
    derived: {
      pokedexId,
      form,
      level: lvl,
      expType: expT,
      expGainNature: addNature.value,
      natureName: "",
    },
    planner: {
      level: lvl,
      expType: addExpType.value,
      expGainNature: addNature.value,
      specialty,
      ingredientType,
      subSkills,
    },
    createdAt: now,
    updatedAt: now,
  };
  boxEntries.value = [entry, ...boxEntries.value].slice(0, 300);
  boxUndoAction.value = { kind: "add", addedIds: [entry.id], selectedId: undoSelectedId };
  selectedBoxId.value = entry.id;
  if (opts.mode === "toCalc") {
    activeTab.value = "calc";
    applyBoxToCalculator();
  } else {
    activeTab.value = "box";
  }

  // フォーム初期化（名前は残しても良いが、ここでは軽くリセット）
  addLabel.value = "";
  addLevel.value = lvl;
  if (speciesName) addName.value = speciesName;
  addIngredientType.value = "";
  addIngredientTypeTouched.value = false;
  addSpecialty.value = "";
  addSpecialtyTouched.value = false;
  addSubLv10.value = "";
  addSubLv25.value = "";
  addSubLv50.value = "";
  addSubLv75.value = "";
  addSubLv100.value = "";
  addSubErrors.value = { "10": null, "25": null, "50": null, "75": null, "100": null };
}

const calcAutosave0 = loadCalcAutosave();
const calcSlots = ref<Array<CalcSaveSlotV1 | null>>(loadCalcSlots());

type CalcRow = CalcRowV1;

const boostKind = ref<Exclude<BoostEvent, "none">>(calcAutosave0?.boostKind ?? "full");
const totalShards = ref<number>(calcAutosave0?.totalShards ?? loadLegacyTotalShards());
const totalShardsText = ref<string>("");
const calcRows = ref<CalcRow[]>(calcAutosave0?.rows ?? []);
const activeCalcRowId = ref<string | null>(calcAutosave0?.activeRowId ?? calcRows.value[0]?.id ?? null);

function clampNonNegInt(n: unknown): number {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function onTotalShardsInput(v: string) {
  const digits = String(v ?? "").replace(/[^\d]/g, "");
  const n = clampNonNegInt(digits);
  totalShards.value = n;
  totalShardsText.value = fmtNum(n);
}

watch(
  totalShards,
  (n) => {
    const nn = clampNonNegInt(n);
    const s = fmtNum(nn);
    if (totalShardsText.value !== s) totalShardsText.value = s;
  },
  { immediate: true }
);

const fullLabel = computed(() =>
  t("calc.boostKindFull", {
    shards: boostRules.full.shardMultiplier,
    exp: boostRules.full.expMultiplier,
  })
);
const miniLabel = computed(() =>
  t("calc.boostKindMini", {
    shards: boostRules.mini.shardMultiplier,
    exp: boostRules.mini.expMultiplier,
  })
);

function cloneCalcRows(entries: CalcRow[]): CalcRow[] {
  const raw = toRaw(entries) as any;
  return JSON.parse(JSON.stringify(raw));
}

function saveCalcAutosaveNow() {
  saveCalcAutosave({
    schemaVersion: 1,
    totalShards: clampNonNegInt(totalShards.value),
    boostKind: boostKind.value,
    rows: cloneCalcRows(calcRows.value),
    activeRowId: activeCalcRowId.value,
  });
}

watch(
  [calcRows, activeCalcRowId, boostKind, totalShards],
  () => {
    saveCalcAutosaveNow();
  },
  { deep: true }
);

watch(
  calcSlots,
  (v) => {
    saveCalcSlots(v);
  },
  { deep: true }
);

watch(
  calcRows,
  () => {
    const id = activeCalcRowId.value;
    if (!id) {
      activeCalcRowId.value = calcRows.value[0]?.id ?? null;
      return;
    }
    if (!calcRows.value.some((x) => x.id === id)) {
      activeCalcRowId.value = calcRows.value[0]?.id ?? null;
    }
  },
  { deep: true }
);
const activeCalcRow = computed(() => calcRows.value.find((x) => x.id === activeCalcRowId.value) ?? null);

type CalcUndoState = {
  rows: CalcRow[];
  activeRowId: string | null;
  slots: Array<CalcSaveSlotV1 | null>;
};
const calcUndoState = ref<CalcUndoState | null>(null);
const calcRedoState = ref<CalcUndoState | null>(null);
const canCalcUndo = computed(() => !!calcUndoState.value);
const canCalcRedo = computed(() => !!calcRedoState.value);

function cloneCalcSlots(v: Array<CalcSaveSlotV1 | null>): Array<CalcSaveSlotV1 | null> {
  const raw = toRaw(v) as any;
  return JSON.parse(JSON.stringify(raw));
}

function snapshotCalcUndoState(): CalcUndoState {
  return {
    rows: cloneCalcRows(calcRows.value),
    activeRowId: activeCalcRowId.value,
    slots: cloneCalcSlots(calcSlots.value),
  };
}

function restoreCalcUndoState(s: CalcUndoState) {
  calcRows.value = s.rows;
  activeCalcRowId.value = s.activeRowId;
  calcSlots.value = s.slots;
  // UI補助
  openLevelPickRowId.value = null;
}

function beginCalcUndo() {
  calcUndoState.value = snapshotCalcUndoState();
  calcRedoState.value = null;
}

function onCalcUndo() {
  const s = calcUndoState.value;
  if (!s) return;
  calcRedoState.value = snapshotCalcUndoState();
  restoreCalcUndoState(s);
  calcUndoState.value = null;
}

function onCalcRedo() {
  const s = calcRedoState.value;
  if (!s) return;
  calcUndoState.value = snapshotCalcUndoState();
  restoreCalcUndoState(s);
  calcRedoState.value = null;
}

function onCalcClear() {
  if (!calcRows.value.length) return;
  beginCalcUndo();
  calcRows.value = [];
  activeCalcRowId.value = null;
  openLevelPickRowId.value = null;
}

function onCalcRemoveRow(id: string) {
  const exists = calcRows.value.some((x) => x.id === id);
  if (!exists) return;
  beginCalcUndo();
  removeCalcRow(id);
}

function onCalcSlotSave(slotIndex: number) {
  if (!calcRows.value.length) return;
  const i = Math.max(0, Math.min(2, Math.floor(Number(slotIndex) || 0)));
  beginCalcUndo();
  const now = new Date().toISOString();
  const slot: CalcSaveSlotV1 = { savedAt: now, rows: cloneCalcRows(calcRows.value), activeRowId: activeCalcRowId.value };
  calcSlots.value = calcSlots.value.map((x, idx) => (idx === i ? slot : x));
}

function onCalcSlotLoad(slotIndex: number) {
  const i = Math.max(0, Math.min(2, Math.floor(Number(slotIndex) || 0)));
  const slot = calcSlots.value[i];
  if (!slot) return;
  beginCalcUndo();
  calcRows.value = cloneCalcRows(slot.rows);
  activeCalcRowId.value = slot.activeRowId ?? calcRows.value[0]?.id ?? null;
  openLevelPickRowId.value = null;
}

function onCalcSlotDelete(slotIndex: number) {
  const i = Math.max(0, Math.min(2, Math.floor(Number(slotIndex) || 0)));
  if (!calcSlots.value[i]) return;
  beginCalcUndo();
  calcSlots.value = calcSlots.value.map((x, idx) => (idx === i ? null : x));
}

function formatCalcSlotSavedAt(iso: string | undefined | null): string {
  const s = String(iso ?? "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "";
  // 例: 2025/12/17 10:31
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const openLevelPickRowId = ref<string | null>(null);
const openLevelPickKind = ref<"src" | "dst">("dst");
const levelPresets = [10, 25, 30, 40, 50, 55, 57, 60, 65] as const;

const dragRowId = ref<string | null>(null);
const dragOverRowId = ref<string | null>(null);

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function openDstLevelPick(id: string) {
  openLevelPickKind.value = "dst";
  openLevelPickRowId.value = openLevelPickRowId.value === id ? null : id;
}
function openSrcLevelPick(id: string) {
  openLevelPickKind.value = "src";
  openLevelPickRowId.value = openLevelPickRowId.value === id ? null : id;
}
function closeLevelPick() {
  openLevelPickRowId.value = null;
}
function setDstLevel(id: string, v: unknown) {
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  const dst = clampInt(v, r.srcLevel, 65, r.dstLevel);
  updateCalcRow(id, { dstLevel: dst });
}
function nudgeDstLevel(id: string, delta: number) {
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  setDstLevel(id, r.dstLevel + delta);
}

function setSrcLevel(id: string, v: unknown) {
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  const src = clampInt(v, 1, r.dstLevel, r.srcLevel);
  const dst = r.dstLevel < src ? src : r.dstLevel;
  const toNext = Math.max(0, calcExp(src, src + 1, r.expType));
  const nextBoostReach = clampInt(r.boostReachLevel, src, dst, src);
  updateCalcRow(id, { srcLevel: src, dstLevel: dst, expRemaining: toNext, boostReachLevel: nextBoostReach });
}
function nudgeSrcLevel(id: string, delta: number) {
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  setSrcLevel(id, r.srcLevel + delta);
}

function calcRowExpGot(r: CalcRow): { toNext: number; expGot: number; expRemaining: number } {
  const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
  const remaining = clampInt(r.expRemaining, 0, toNext, toNext);
  if (toNext <= 0) return { toNext: 0, expGot: 0, expRemaining: remaining };
  const got = toNext - remaining;
  return { toNext, expGot: Math.max(0, Math.min(got, toNext)), expRemaining: remaining };
}

function calcRowMixedByBoostLevel(r: CalcRow, expGot: number) {
  const src = r.srcLevel;
  const dst = r.dstLevel;
  const mid = clampInt(r.boostReachLevel, src, dst, src);
  if (mid <= src) {
    return calcExpAndCandyMixed({
      srcLevel: src,
      dstLevel: dst,
      expType: r.expType,
      nature: r.nature,
      boost: "none",
      boostCandy: 0,
      expGot,
    });
  }

  const boostOnlyNeed = calcExpAndCandy({
    srcLevel: src,
    dstLevel: mid,
    expType: r.expType,
    nature: r.nature,
    boost: boostKind.value,
    expGot,
  });

  const boostSeg = calcExpAndCandyMixed({
    srcLevel: src,
    dstLevel: mid,
    expType: r.expType,
    nature: r.nature,
    boost: boostKind.value,
    boostCandy: boostOnlyNeed.candy,
    expGot,
  });

  const atMid = calcLevelByCandy({
    srcLevel: src,
    dstLevel: mid,
    expType: r.expType,
    nature: r.nature,
    boost: boostKind.value,
    candy: boostOnlyNeed.candy,
    expGot,
  });

  const normalSeg = calcExpAndCandyMixed({
    srcLevel: mid,
    dstLevel: dst,
    expType: r.expType,
    nature: r.nature,
    boost: "none",
    boostCandy: 0,
    expGot: atMid.expGot,
  });

  return {
    exp: boostSeg.exp + normalSeg.exp,
    expNormalApplied: normalSeg.expNormalApplied,
    expBoostApplied: boostSeg.expBoostApplied,
    normalCandy: normalSeg.normalCandy,
    boostCandy: boostSeg.boostCandy,
    shards: boostSeg.shardsBoost + normalSeg.shardsNormal,
    shardsNormal: normalSeg.shardsNormal,
    shardsBoost: boostSeg.shardsBoost,
    boostCandyLeft: 0,
  };
}

function calcRowView(r: CalcRow) {
  const src = clampInt(r.srcLevel, 1, 65, 1);
  const dstFromText =
    typeof r.dstLevelText === "string" && r.dstLevelText.trim() !== "" ? clampInt(r.dstLevelText, 1, 65, r.dstLevel) : null;
  const dst = clampInt(dstFromText ?? r.dstLevel, src, 65, src);
  const expT = r.expType;
  const nat = r.nature;

  const expInfo = calcRowExpGot({ ...r, srcLevel: src, dstLevel: dst, expType: expT, nature: nat });
  const expGot = expInfo.expGot;

  const requiredExp = calcExpAndCandy({
    srcLevel: src,
    dstLevel: dst,
    expType: expT,
    nature: nat,
    boost: "none",
    expGot,
  });

  const ratio = Math.max(0, Math.min(1, (Number(r.boostRatioPct) || 0) / 100));
  const byRatio = calcExpAndCandyByBoostExpRatio({
    srcLevel: src,
    dstLevel: dst,
    expType: expT,
    nature: nat,
    boost: boostKind.value,
    boostExpRatio: ratio,
    expGot,
  });

  const byCandy = calcExpAndCandyMixed({
    srcLevel: src,
    dstLevel: dst,
    expType: expT,
    nature: nat,
    boost: boostKind.value,
    boostCandy: Math.max(0, Math.floor(Number(r.boostCandyInput) || 0)),
    expGot,
  });

  const byBoostLevel = calcRowMixedByBoostLevel({ ...r, srcLevel: src, dstLevel: dst, expType: expT, nature: nat }, expGot);

  const mixed = r.mode === "boostLevel" ? byBoostLevel : r.mode === "ratio" ? byRatio : byCandy;

  const uiCandy = r.mode === "ratio" ? byRatio.boostCandy : r.mode === "boostLevel" ? byBoostLevel.boostCandy : Math.max(0, Math.floor(Number(r.boostCandyInput) || 0));
  const base = requiredExp.exp;
  const uiRatioPct = r.mode === "ratio"
    ? clampInt(r.boostRatioPct, 0, 100, 0)
    : clampInt(base > 0 ? Math.round((mixed.expBoostApplied / base) * 100) : 0, 0, 100, 0);

  const boostOnly = calcLevelByCandy({
    srcLevel: src,
    dstLevel: dst,
    expType: expT,
    nature: nat,
    boost: boostKind.value,
    candy: uiCandy,
    expGot,
  });
  const uiBoostReachLevel = r.mode === "boostLevel" ? clampInt(r.boostReachLevel, src, dst, src) : clampInt(boostOnly.level, src, dst, src);

  return {
    normalized: { srcLevel: src, dstLevel: dst, expRemaining: expInfo.expRemaining },
    requiredExp,
    mixed,
    ui: { boostCandyInput: uiCandy, boostRatioPct: uiRatioPct, boostReachLevel: uiBoostReachLevel },
  };
}

const calcRowsView = computed(() =>
  calcRows.value.map((r) => {
    const v = calcRowView(r);
    const boxEntry = r.boxId ? boxEntries.value.find((x) => x.id === r.boxId) ?? null : null;
    const title = boxEntry ? displayBoxTitle(boxEntry) : r.title;
    return {
      ...r,
      title,
      srcLevel: v.normalized.srcLevel,
      dstLevel: v.normalized.dstLevel,
      expRemaining: v.normalized.expRemaining,
      result: v.mixed,
      ui: v.ui,
    };
  })
);

const activeCalcSlotTab = ref(0);
const calcExportOpen = ref(false);
const exportSheetEl = ref<HTMLElement | null>(null);
const exportBusy = ref(false);
const exportStatus = ref<string>("");
const exportCsvMenuOpen = ref(false);
function openCalcExport() {
  if (!calcRowsView.value.length) return;
  calcExportOpen.value = true;
}
function closeCalcExport() {
  calcExportOpen.value = false;
  exportCsvMenuOpen.value = false;
}

function toggleCalcExportCsvMenu() {
  exportCsvMenuOpen.value = !exportCsvMenuOpen.value;
  exportStatus.value = "";
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

  const rows = calcExportRows.value.map((r) =>
    [
      r.title,
      r.srcLevel,
      r.dstLevel,
      r.natureLabel || "",
      r.boostCandy,
      r.normalCandy,
      r.totalCandy,
      r.shards,
    ]
      .map(csvCell)
      .join(",")
  );

  const total = [
    "",
    "",
    "",
    "",
    calcExportTotals.value.boostCandy,
    calcExportTotals.value.normalCandy,
    calcExportTotals.value.totalCandy,
    calcExportTotals.value.shards,
  ]
    .map(csvCell)
    .join(",");

  return [head, ...rows, total].join("\r\n") + "\r\n";
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

    // 保存時は transform(scale) / sticky を外した状態で、全高を確実に取り込む
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
    // 基準: 面積（w*h）と高さで段階的に下げる
    const area = w * h;
    const pixelRatio =
      isLikelyIOS ? 1.5 : h > 6500 || area > 11_000_000 ? 1.25 : h > 5000 || area > 8_000_000 ? 1.5 : 2;
    const dataUrl = await toPng(el, {
      cacheBust: true,
      pixelRatio,
      // Export sheet has its own gradient background; keep fallback close to --paper.
      backgroundColor: "#f7f7f7",
      width: w,
      height: h,
      style: {
        transform: "none",
        transformOrigin: "top left",
      },
    });
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `CandyBoost-Planner_${ts}.png`;

    // iOS Safari: prefer Share Sheet so users can "Save Image" to Photos.
    // (Direct download typically goes to Files on iPhone.)
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
      // As a fallback on iOS, open the image in a new tab so the user can long-press and save to Photos.
      try {
        window.open(dataUrl, "_blank", "noopener,noreferrer");
        exportStatus.value = "";
        return;
      } catch {
        // fall through to download
      }
    }

    // Default: download (desktop / Android / non-share iOS)
    const a = document.createElement("a");
    a.download = filename;
    a.href = dataUrl;
    a.click();
    exportStatus.value = "";
  } catch (e: any) {
    exportStatus.value = t("status.exportFailed");
  } finally {
    exportBusy.value = false;
  }
}

function natureLabel(n: ExpGainNature): string {
  // Export/summary badge uses symbols; keep "normal" hidden via empty string.
  if (n === "up") return "▲";
  if (n === "down") return "▼";
  return "";
}

const calcExportRows = computed(() =>
  calcRowsView.value.map((r) => {
    const boostCandy = Math.max(0, Math.floor(r.result.boostCandy || 0));
    const normalCandy = Math.max(0, Math.floor(r.result.normalCandy || 0));
    const shards = Math.max(0, Math.floor(r.result.shards || 0));
    return {
      id: r.id,
      title: String(r.title ?? "").trim() || "(no name)",
      natureLabel: natureLabel(r.nature),
      srcLevel: r.srcLevel,
      dstLevel: r.dstLevel,
      boostCandy,
      normalCandy,
      totalCandy: boostCandy + normalCandy,
      shards,
    };
  })
);

const calcExportTotals = computed(() => {
  let boostCandy = 0;
  let normalCandy = 0;
  let shards = 0;
  for (const r of calcExportRows.value) {
    boostCandy += r.boostCandy;
    normalCandy += r.normalCandy;
    shards += r.shards;
  }
  return { boostCandy, normalCandy, totalCandy: boostCandy + normalCandy, shards };
});

const calcExportScale = computed(() => {
  const n = calcExportRows.value.length;
  // できるだけ「1枚」に収めるための軽い縮小（多すぎる場合は最小0.76）
  if (n <= 6) return 1;
  if (n <= 9) return 0.94;
  if (n <= 12) return 0.88;
  if (n <= 16) return 0.82;
  return 0.76;
});

const calcTotalShardsUsed = computed(() => calcRowsView.value.reduce((a, r) => a + (r.result.shards || 0), 0));
const calcShardsCap = computed(() => Math.max(0, Math.floor(Number(totalShards.value) || 0)));
const calcShardsOver = computed(() => calcTotalShardsUsed.value - calcShardsCap.value);
const calcShardsUsedPct = computed(() => (calcShardsCap.value > 0 ? (calcTotalShardsUsed.value / calcShardsCap.value) * 100 : 0));
const calcShardsUsagePctRounded = computed(() => (calcShardsCap.value > 0 ? Math.round(calcShardsUsedPct.value) : 0));
const showShardsFire = computed(() => calcShardsCap.value > 0 && calcTotalShardsUsed.value > calcShardsCap.value);
// Bar rendering:
// - under cap: fill = used/cap
// - over cap:  fill = cap/used, over = (used-cap)/used (so green+red = 100%)
const calcShardsFillPctForBar = computed(() => {
  const cap = calcShardsCap.value;
  const used = Math.max(0, calcTotalShardsUsed.value);
  if (cap <= 0) return 0;
  if (used <= cap) return Math.min(100, Math.max(0, (used / cap) * 100));
  return Math.min(100, Math.max(0, (cap / Math.max(1, used)) * 100));
});
const calcShardsOverPctForBar = computed(() => {
  const cap = calcShardsCap.value;
  const used = Math.max(0, calcTotalShardsUsed.value);
  if (cap <= 0 || used <= cap) return 0;
  return Math.min(100, Math.max(0, 100 - calcShardsFillPctForBar.value));
});

// Candy Boost count cap (full=3500, mini=350)
const calcTotalBoostCandyUsed = computed(() => calcRowsView.value.reduce((a, r) => a + (r.result.boostCandy || 0), 0));
const calcBoostCandyCap = computed(() => (boostKind.value === "mini" ? 350 : 3500));
const calcBoostCandyOver = computed(() => calcTotalBoostCandyUsed.value - calcBoostCandyCap.value);
const calcBoostCandyUnused = computed(() => Math.max(0, calcBoostCandyCap.value - calcTotalBoostCandyUsed.value));
const calcBoostCandyUsedPct = computed(() => (calcBoostCandyCap.value > 0 ? (calcTotalBoostCandyUsed.value / calcBoostCandyCap.value) * 100 : 0));
const calcBoostCandyUsagePctRounded = computed(() => (calcBoostCandyCap.value > 0 ? Math.round(calcBoostCandyUsedPct.value) : 0));
const showBoostCandyFire = computed(() => calcBoostCandyCap.value > 0 && calcTotalBoostCandyUsed.value > calcBoostCandyCap.value);
const calcBoostCandyFillPctForBar = computed(() => {
  const cap = calcBoostCandyCap.value;
  const used = Math.max(0, calcTotalBoostCandyUsed.value);
  if (cap <= 0) return 0;
  if (used <= cap) return Math.min(100, Math.max(0, (used / cap) * 100));
  return Math.min(100, Math.max(0, (cap / Math.max(1, used)) * 100));
});
const calcBoostCandyOverPctForBar = computed(() => {
  const cap = calcBoostCandyCap.value;
  const used = Math.max(0, calcTotalBoostCandyUsed.value);
  if (cap <= 0 || used <= cap) return 0;
  return Math.min(100, Math.max(0, 100 - calcBoostCandyFillPctForBar.value));
});

function removeCalcRow(id: string) {
  calcRows.value = calcRows.value.filter((x) => x.id !== id);
  if (activeCalcRowId.value === id) activeCalcRowId.value = calcRows.value[0]?.id ?? null;
}

function indexOfCalcRow(id: string): number {
  return calcRows.value.findIndex((x) => x.id === id);
}

function moveCalcRow(fromId: string, toIndex: number) {
  const from = indexOfCalcRow(fromId);
  if (from < 0) return;
  const next = [...calcRows.value];
  const [item] = next.splice(from, 1);
  const idx = Math.max(0, Math.min(next.length, toIndex));
  next.splice(idx, 0, item);
  calcRows.value = next;
}

function canMoveCalcRowUp(id: string): boolean {
  const i = indexOfCalcRow(id);
  return i > 0;
}
function canMoveCalcRowDown(id: string): boolean {
  const i = indexOfCalcRow(id);
  return i >= 0 && i < calcRows.value.length - 1;
}
function moveCalcRowUp(id: string) {
  const i = indexOfCalcRow(id);
  if (i <= 0) return;
  moveCalcRow(id, i - 1);
}
function moveCalcRowDown(id: string) {
  const i = indexOfCalcRow(id);
  if (i < 0 || i >= calcRows.value.length - 1) return;
  moveCalcRow(id, i + 1);
}

function onCalcRowDragStart(id: string, ev: DragEvent) {
  dragRowId.value = id;
  dragOverRowId.value = null;
  try {
    ev.dataTransfer?.setData("text/plain", id);
    ev.dataTransfer?.setDragImage?.((ev.target as HTMLElement) ?? new Image(), 0, 0);
  } catch {
    // ignore
  }
}
function onCalcRowDragEnd() {
  dragRowId.value = null;
  dragOverRowId.value = null;
}
function onCalcRowDragOver(overId: string) {
  if (!dragRowId.value) return;
  if (overId === dragOverRowId.value) return;
  dragOverRowId.value = overId;
}
function onCalcRowDragLeave(overId: string) {
  if (dragOverRowId.value === overId) dragOverRowId.value = null;
}
function onCalcRowDrop(overId: string) {
  const fromId = dragRowId.value;
  if (!fromId) return;
  if (fromId === overId) return onCalcRowDragEnd();
  const to = indexOfCalcRow(overId);
  if (to < 0) return onCalcRowDragEnd();
  moveCalcRow(fromId, to);
  onCalcRowDragEnd();
}

function updateCalcRow(id: string, patch: Partial<CalcRow>) {
  calcRows.value = calcRows.value.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

function onCalcRowDstLevel(id: string, v: string) {
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  // 入力中はテキストとして保持（datalist候補表示を安定させる）
  updateCalcRow(id, { dstLevelText: v });
}

function onCalcRowDstLevelBlur(id: string) {
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  const raw = (r.dstLevelText ?? "").trim();
  const parsed = raw === "" ? r.dstLevel : clampInt(raw, 1, 65, r.dstLevel);
  const dst = clampInt(parsed, r.srcLevel, 65, r.srcLevel);
  updateCalcRow(id, { dstLevel: dst, dstLevelText: undefined });
}
function onCalcRowExpRemaining(id: string, v: string) {
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
  const rem = clampInt(v, 0, toNext, toNext);
  updateCalcRow(id, { expRemaining: rem });
}
function onCalcRowExpType(id: string, v: string) {
  const n = Number(v);
  const expT: ExpType = n === 600 || n === 900 || n === 1080 || n === 1320 ? (n as any) : 600;
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, expT));
  updateCalcRow(id, { expType: expT, expRemaining: toNext });
}
function onCalcRowNature(id: string, v: string) {
  const nat: ExpGainNature = v === "up" || v === "down" || v === "normal" ? (v as any) : "normal";
  updateCalcRow(id, { nature: nat });
}
function onCalcRowBoostLevel(id: string, v: string) {
  const r = calcRows.value.find((x) => x.id === id);
  if (!r) return;
  const mid = clampInt(v, r.srcLevel, r.dstLevel, r.srcLevel);
  updateCalcRow(id, { boostReachLevel: mid, mode: "boostLevel" });
}
function onCalcRowBoostRatio(id: string, v: string) {
  const pct = clampInt(v, 0, 100, 0);
  updateCalcRow(id, { boostRatioPct: pct, mode: "ratio" });
}
function onCalcRowBoostCandy(id: string, v: string) {
  const n = Math.max(0, Math.floor(Number(v) || 0));
  updateCalcRow(id, { boostCandyInput: n, mode: "candy" });
}

function applyBoxToCalculator() {
  const e = selectedBox.value;
  if (!e) return;

  const lvl = e.planner?.level ?? e.derived?.level ?? 10;
  const expT = (e.planner?.expType ?? e.derived?.expType ?? 600) as ExpType;
  const nat = (e.planner?.expGainNature ?? e.derived?.expGainNature ?? "normal") as ExpGainNature;
  const srcLevel = clampInt(lvl, 1, 65, 10);
  const dstLevel = clampInt(50, srcLevel, 65, srcLevel); // 目標Lvのデフォルトは50（典型値）
  const toNext = Math.max(0, calcExp(srcLevel, srcLevel + 1, expT));
  const remaining =
    e.planner?.expRemaining !== undefined && Number.isFinite(e.planner.expRemaining)
      ? clampInt(e.planner.expRemaining, 0, toNext, toNext)
      : toNext;

  const existing = calcRows.value.find((x) => x.boxId === e.id) ?? null;
  const basePatch: Partial<CalcRow> = {
    title: displayBoxTitle(e),
    boxId: e.id,
    srcLevel,
    expType: expT,
    nature: nat,
    expRemaining: remaining,
  };

  if (existing) {
    // 既存行があれば「ボックス由来の基礎値」だけ更新して、目標Lv/調整は維持
    updateCalcRow(existing.id, basePatch);
    activeCalcRowId.value = existing.id;
  } else {
    const row: CalcRow = {
      id: cryptoRandomId(),
      title: displayBoxTitle(e),
      boxId: e.id,
      srcLevel,
      dstLevel,
      expRemaining: remaining,
      expType: expT,
      nature: nat,
      boostReachLevel: dstLevel, // ratio=100 のとき UI 表示は dst に揃う想定
      boostRatioPct: 100, // デフォルトは「目標Lvまでアメブで上げる」
      boostCandyInput: 0,
      mode: "ratio",
    };
    calcRows.value = [row, ...calcRows.value];
    activeCalcRowId.value = row.id;
  }

  nextTick(() => {
    activeTab.value = "calc";
  });
}

function applyCalculatorToBox(rowId?: string) {
  const r = rowId ? (calcRows.value.find((x) => x.id === rowId) ?? null) : activeCalcRow.value;
  if (!r || !r.boxId) return;
  const e = boxEntries.value.find((x) => x.id === r.boxId) ?? null;
  if (!e) return;
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        level: r.srcLevel,
        expRemaining: r.expRemaining,
        expType: r.expType,
        expGainNature: r.nature,
      },
      updatedAt: now,
    };
  });
  selectedBoxId.value = e.id;
  importStatus.value = t("status.applyCalcToBox");
}

function onDeleteSelected() {
  const e = selectedBox.value;
  if (!e) return;
  const ok = confirm(t("confirm.deleteOne", { label: e.label || e.rawText }));
  if (!ok) return;
  const idx = boxEntries.value.findIndex((x) => x.id === e.id);
  boxUndoAction.value = { kind: "delete", entry: cloneBoxEntry(e), index: Math.max(0, idx), selectedId: selectedBoxId.value };
  boxEntries.value = boxEntries.value.filter((x) => x.id !== e.id);
  selectedBoxId.value = null;
}

function onClearBox() {
  const n = boxEntries.value.length;
  if (n === 0) return;
  const ok = confirm(t("confirm.clearBox", { n }));
  if (!ok) return;
  boxUndoAction.value = { kind: "clear", entries: cloneBoxEntries(boxEntries.value), selectedId: selectedBoxId.value };
  boxEntries.value = [];
  selectedBoxId.value = null;
  boxFilter.value = "";
  selectedSpecialties.value = [];
  selectedSubSkillEns.value = [];
  importStatus.value = t("status.boxCleared");
}

function onEditSelectedSpecialty(v: string) {
  const e = selectedBox.value;
  if (!e) return;
  const next = (v || "").trim() as any;
  const specialty: PokemonSpecialty | undefined =
    next === "Berries" || next === "Ingredients" || next === "Skills" || next === "All" ? next : undefined;
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        specialty,
      },
      updatedAt: now,
    };
  });
  importStatus.value = t("status.specialtyUpdated");
}

function onEditSelectedLevel(v: string) {
  const e = selectedBox.value;
  if (!e) return;
  const lvl = clampInt(v, 1, 65, e.planner?.level ?? e.derived?.level ?? 1);
  writeSelectedLevel(lvl);
}

function onEditSelectedLabel(v: string) {
  const e = selectedBox.value;
  if (!e) return;
  const label = String(v ?? "").trim(); // 空文字は「種族名表示に戻す」扱い
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      label,
      updatedAt: now,
    };
  });
  importStatus.value = t("status.nicknameUpdated");
}

function toggleSelectedFavorite() {
  const e = selectedBox.value;
  if (!e) return;
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return { ...x, favorite: !x.favorite, updatedAt: now };
  });
  importStatus.value = t("status.favoriteUpdated");
}

function writeSelectedLevel(lvl: number) {
  const e = selectedBox.value;
  if (!e) return;
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        level: lvl,
      },
      updatedAt: now,
    };
  });
  importStatus.value = t("status.levelUpdated");
}

function toggleBoxLevelPick() {
  openBoxLevelPick.value = !openBoxLevelPick.value;
}
function closeBoxLevelPick() {
  openBoxLevelPick.value = false;
}
function setBoxLevel(v: unknown) {
  const e = selectedBox.value;
  if (!e) return;
  const lvl = clampInt(v, 1, 65, e.planner?.level ?? e.derived?.level ?? 1);
  writeSelectedLevel(lvl);
}
function nudgeBoxLevel(delta: number) {
  const cur = selectedDetail.value?.level ?? 1;
  setBoxLevel(cur + delta);
}

function onEditSelectedExpType(v: string) {
  const e = selectedBox.value;
  if (!e) return;
  const n = Number(v);
  const expT: ExpType = n === 600 || n === 900 || n === 1080 || n === 1320 ? (n as any) : 600;
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        expType: expT,
      },
      updatedAt: now,
    };
  });
  importStatus.value = t("status.expTypeUpdated");
}

function onEditSelectedNature(v: string) {
  const e = selectedBox.value;
  if (!e) return;
  const nat: ExpGainNature = v === "up" || v === "down" || v === "normal" ? (v as any) : "normal";
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        expGainNature: nat,
      },
      updatedAt: now,
    };
  });
  importStatus.value = t("status.natureUpdated");
}

function onBoxItemNatureChange() {
  // This function is called by v-model's @update:model-value listener
  // The actual update is handled by the selectedNature computed setter
}

function onEditSelectedIngredientType(v: string) {
  const e = selectedBox.value;
  if (!e) return;
  const next = (v || "").trim() as any;
  const ingredientType: IngredientType | undefined = (IngredientTypes as readonly string[]).includes(next) ? (next as any) : undefined;
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        ingredientType,
      },
      updatedAt: now,
    };
  });
  importStatus.value = t("status.ingredientTypeUpdated");
}

function toSubSkillLevel(v: unknown): 10 | 25 | 50 | 75 | 100 | null {
  const n = typeof v === "number" ? v : Number(v);
  if (n === 10 || n === 25 || n === 50 || n === 75 || n === 100) return n;
  return null;
}

function onBoxEditSubInput(lvLike: unknown, v: string) {
  const lv = toSubSkillLevel(lvLike);
  if (!lv) return;
  boxEditSubInputs.value = { ...boxEditSubInputs.value, [String(lv)]: v };
  if (boxEditSubErrors.value[String(lv)]) {
    boxEditSubErrors.value = { ...boxEditSubErrors.value, [String(lv)]: null };
  }
}

function onBoxEditSubBlur(lvLike: unknown) {
  const e = selectedBox.value;
  if (!e) return;
  const lv = toSubSkillLevel(lvLike);
  if (!lv) return;
  const ja = (boxEditSubInputs.value[String(lv)] ?? "").trim();
  const en = ja ? subSkillEnFromLabel(ja) : null;
  if (ja && !en) {
    boxEditSubErrors.value = { ...boxEditSubErrors.value, [String(lv)]: t("status.subSkillUnknownIgnored") };
    return;
  }

  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    const base = (x.planner?.subSkills ?? []).filter((s) => s.lv !== lv);
    const nextSubs = en ? [...base, { lv, nameEn: en }] : base;
    nextSubs.sort((a, b) => a.lv - b.lv);
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        subSkills: nextSubs.length ? nextSubs : undefined,
      },
      updatedAt: now,
    };
  });
  importStatus.value = t("status.subSkillsUpdated");
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

<style scoped>
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
.calcSum__k--right {
  white-space: nowrap;
  text-align: right;
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
  /* 横長になりすぎない（縦3:横4 目安） */
  width: min(820px, calc(100vw - 36px));
  max-height: calc(100vh - 36px);
  overflow: auto;
}
.exportSheet {
  transform-origin: top center;
  width: 100%;
  border-radius: 12px;
  border: 4px double #D4AC0D;
  background: #f7f7f7; /* 計算機の背景と同じグレー */
  box-shadow: 0 4px 12px rgba(74, 66, 56, 0.1);
  padding: 16px 22px 16px;
  position: relative;
  --xmas-gold: #D4AC0D;
}
.exportSheet--capture {
  /* 画像保存時は「カード枠」を消してスクショ向けに */
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.exportSheet--capture .statCard {
  /* html-to-image で「引きずり」になりやすい影/グラデを軽量化 */
  box-shadow: none !important;
  background: #fff !important;
}
.exportSheet--capture .statCard--accent,
.exportSheet--capture .statCard--primary,
.exportSheet--capture .statCard--danger {
  background: #fff !important;
}
.exportSheet--capture .statCard__value {
  text-shadow: none !important;
}
.exportCalc {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  flex: 1;
}
.exportHead {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 4px;
  padding: 0 2px 6px;
  border-radius: 0;
  background: transparent;
  border-bottom: 0;
}
.exportHead::before {
  content: "";
}
.exportHead > :first-child {
  justify-self: center;
  text-align: center;
}
.exportBrand {
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -0.01em;
  font-size: 17px;
  color: color-mix(in oklab, var(--ink) 88%, transparent);
  line-height: 1.15;
  margin-top: -2px;
}
.exportMeta {
  margin-top: 2px;
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
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
.exportCsvMenuTrigger {
  position: relative;
  display: flex;
  align-items: center;
}
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
.exportCsvMenu__item:hover {
  background: color-mix(in oklab, var(--accent) 10%, var(--paper));
}
.exportCsvMenu__item:active {
  transform: translateY(0.5px);
}
.exportCsvMenu__item:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.exportSheet--capture .exportActions {
  display: none;
}
.exportSheet--capture .exportStatus {
  display: none;
}
.exportStatus {
  margin: 0 0 10px;
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 62%, transparent);
}

/* Export styles moved to main.css */
/* --- Export List (New) --- */
.exportList {
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  border: 1px solid color-mix(in oklab, var(--ink) 6%, transparent);
  overflow: hidden; /* for rounded corners */
  margin: 20px 10px 0;
}
.exportList__head {
  display: grid;
  grid-template-columns: 2fr 1.2fr 1fr 1fr 1fr 1.3fr;
  gap: 10px;
  padding: 12px 16px;
  background: #f7f7f7; /* match export sheet bg */
  border-bottom: 2px solid #EBE6DE;
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
  border-bottom: 1px solid #F0EBE5;
}
.exportList__row:last-child {
  border-bottom: 0;
}
.exportList__row:nth-child(even) {
  background: #FAFAFA;
}
.exportList__row--total {
  background: #f7f7f7;
  border-top: 2px solid #EBE6DE;
}
.exportList__row--total .exportList__col {
  font-weight: 800;
}
.exportList__row--total .exportList__name {
  font-weight: 900;
}
.exportList__col {
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
}
.exportList__col.u-align-right { text-align: right; }
.exportList__col.u-align-center { text-align: center; }

.exportList__nameCol {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.exportList__name {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 14px;
  line-height: 1.2;
  color: var(--ink);
}
.exportList__badge {
  font-size: 9.5px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  background: #F0EBE5;
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
  background: #F5F2EF;
  padding: 4px 8px;
  border-radius: 6px;
  min-width: 60px;
}
.exportList__arrow {
  color: color-mix(in oklab, var(--ink) 30%, transparent);
  font-size: 10px;
}
.exportList__numCol .calcRow__num {
  font-size: 15px;
  color: #333;
}
.exportList__numCol .calcRow__num.calcRow__num--danger {
  color: var(--danger);
}
.u-mobile-label { display: none; }

@media (max-width: 560px) {
  .exportOverlay {
    padding: 0;
    place-items: stretch;
  }
  .exportSheetWrap {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }
  .exportSheet {
    border-radius: 0;
    padding: 12px 14px 16px;
    border: 0;
    box-shadow: none;
  }
  /* スクロール中も操作リンクが隠れないように（キャプチャ時は無効） */
  .exportHead {
    position: sticky;
    top: 0;
    z-index: 2;
    background: #f7f7f7;
    padding: 10px 0 8px;
    margin: -12px 0 6px; /* exportSheetの上paddingと相殺して全幅っぽく */
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .exportHead::before { display: none; }
  .exportHead > :first-child {
    justify-self: start;
    text-align: left;
  }
  .exportActions {
    justify-self: start;
    justify-content: flex-start;
    flex-wrap: wrap;
    white-space: normal;
    gap: 12px;
    max-width: 100%;
  }
  .linkBtn {
    line-height: 1.2;
    padding: 2px 0; /* タップしやすく＆見切れ防止 */
  }
  .exportBrand {
    font-size: 16px;
    margin-top: 0;
  }
  .exportStats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 12px 0 10px;
    gap: 10px;
  }
  .statCard { min-width: 0; }
  /* モバイルは横幅が厳しいので、合計カードのアイコンを省略して詰める */
  .statCard__icon { display: none; }
  .statCard {
    padding: 9px 10px;
    gap: 8px;
  }
  /* ラベルを折り返し可能にして、右側にはみ出さないように */
  .statCard__label {
    white-space: normal;
    line-height: 1.15;
  }
  .statCard__value {
    font-size: clamp(18px, 6.2vw, 24px);
    letter-spacing: -0.02em;
  }
  .exportList {
    margin: 16px 0 0;
  }
  .exportSheet--capture .exportHead {
    position: static;
    margin: 0 0 4px;
    padding: 0 2px 6px;
    background: transparent;
  }
  .exportList__head { display: none; }
  .exportList__row {
    grid-template-columns: repeat(5, 1fr);
    gap: 8px 6px;
    padding: 14px;
  }
  .exportList__nameCol {
    grid-column: 1 / -1;
    margin-bottom: 4px;
    border-bottom: 1px dashed #EBE6DE;
    padding-bottom: 8px;
    width: 100%;
  }
  .exportList__lvWrap {
    background: transparent;
    padding: 0;
    gap: 4px;
    font-size: 12px;
    justify-content: flex-start;
  }
  .exportList__lvCol {
    display: flex; /* Align left on mobile? Or keep center? Let's align left/start for 1st col */
    align-items: center;
    justify-content: flex-start;
    text-align: left;
    margin-top: auto; /* Push to bottom align with numbers */
  }
  .exportList__col.u-align-center { text-align: left; }

  .exportList__numCol {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .u-mobile-label {
    display: block;
    font-size: 9px;
    color: color-mix(in oklab, var(--ink) 45%, transparent);
    margin-bottom: 0px;
    white-space: nowrap;
  }
  .exportList__numCol .calcRow__num {
    font-size: 14px;
  }
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
}
.boxDisclosure__summary::-webkit-details-marker {
  display: none;
}
.boxDisclosure__title {
  letter-spacing: -0.01em;
}
.boxDisclosure__hint {
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.boxDisclosure[open] .boxDisclosure__summary {
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

/* ENは文言が長めなので、ソートUIの幅を少しだけ広げて崩れを防ぐ */
.shell[data-locale="en"] .boxSort__select {
  min-width: 120px;
}
.shell[data-locale="en"] .boxSort .btn {
  min-width: 120px;
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
.exportStats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 15px 10px 12px;
}

/* Tablet/mobile: 4枚は幅が足りずはみ出しやすいので 2列へ */
@media (max-width: 860px) {
  .exportStats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 12px 0 10px;
    gap: 10px;
  }
  .statCard__label {
    white-space: normal;
    line-height: 1.15;
  }
  .statCard__value {
    font-size: clamp(18px, 4.6vw, 26px);
    white-space: normal;
    overflow-wrap: anywhere; /* 948,735 のような数値を安全に折り返す */
  }
}

.statCard {
  display: flex;
  align-items: center;
  gap: 10px;
  background: white;
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.04),
    0 0 0 1px color-mix(in oklab, var(--ink) 6%, transparent);
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
  text-align: center;
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


.statCard--accent {
  background: linear-gradient(135deg, #FFF5F7 0%, #FFF0F0 100%);
  box-shadow:
    0 2px 6px rgba(255, 100, 100, 0.1),
    0 0 0 1px rgba(255, 100, 100, 0.15);
}
.statCard--primary {
  background: linear-gradient(135deg, #F0F7FF 0%, #E6F2FF 100%);
  box-shadow:
    0 2px 6px rgba(50, 100, 255, 0.1),
    0 0 0 1px rgba(50, 100, 255, 0.15);
}
.statCard--danger {
  background: #FFF5F5;
  color: #D32F2F;
}

.statCard__icon {
  font-size: 20px;
  line-height: 1;
}
.statCard__content {
  min-width: 0;
}
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
.statCard__value--danger {
  color: var(--danger);
}
.calcRow__num--danger {
  color: var(--danger);
}
.statCard--danger .statCard__value {
  color: #D32F2F;
}
.exportCalcTop__nums {
  margin-left: 20px;
}

.exportCalc .calcBarBlock + .calcBarBlock {
  border-top: 0;
}

.exportCalc .calcSum--bar {
  margin: 0 20px;
}
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
