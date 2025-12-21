<template>
  <section id="neo-box" class="panel panel--box">
    <div class="panel__head">
      <h2 class="panel__title">{{ t("box.title") }}</h2>
      <div class="panel__side">
        <button class="btn btn--danger" type="button" @click="box.onClearBox" :disabled="!boxEntries.length">
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
                  @focus="box.onAddNameFocus"
                  @blur="box.onAddNameBlur"
                  @input="box.onAddNameInput"
                  @keydown.esc.prevent="box.closeAddNameSuggest"
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
                    @mousedown.prevent="box.pickAddName(n)"
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
              <select v-model="addSpecialty" class="field__input" @change="box.onAddSpecialtyChanged">
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
              <select v-model.number="addExpType" class="field__input" :disabled="!!addLookup" @change="box.onAddExpTypeChanged">
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
                @change="box.onAddIngredientTypeChanged"
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
                    @blur="box.onSubBlur(10)"
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
                    @blur="box.onSubBlur(25)"
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
                    @blur="box.onSubBlur(50)"
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
                    @blur="box.onSubBlur(75)"
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
                    @blur="box.onSubBlur(100)"
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
              <button class="btn btn--primary" type="button" @click="onCreateToCalc($event)">
                {{ t("box.add.toCalc") }}
              </button>
              <button class="btn" type="button" @click="box.onCreateManual({ mode: 'toBox' })">
                {{ t("box.add.toBox") }}
              </button>
            </div>
          </div>
        </div>
      </details>

      <BoxImportDisclosure v-model:importText="importText" v-model:importStatus="importStatus" @import="box.onImport" />

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
                  @click="box.toggleSpecialty('Berries')"
                  :aria-label="t('box.list.specialtyAria', { name: gt('きのみ') })"
                >
                  <span class="chipBtn__icon" v-html="iconBerrySvg" aria-hidden="true"></span>
                  <span class="chipBtn__text">{{ gt("きのみ") }}</span>
                </button>
                <button
                  class="chipBtn"
                  :class="{ 'chipBtn--on': selectedSpecialties.includes('Ingredients') }"
                  type="button"
                  @click="box.toggleSpecialty('Ingredients')"
                  :aria-label="t('box.list.specialtyAria', { name: gt('食材') })"
                >
                  <span class="chipBtn__icon" v-html="iconIngredientsSvg" aria-hidden="true"></span>
                  <span class="chipBtn__text">{{ gt("食材") }}</span>
                </button>
                <button
                  class="chipBtn"
                  :class="{ 'chipBtn--on': selectedSpecialties.includes('Skills') }"
                  type="button"
                  @click="box.toggleSpecialty('Skills')"
                  :aria-label="t('box.list.specialtyAria', { name: gt('スキル') })"
                >
                  <span class="chipBtn__icon" v-html="iconSkillsSvg" aria-hidden="true"></span>
                  <span class="chipBtn__text">{{ gt("スキル") }}</span>
                </button>
                <button
                  class="chipBtn"
                  :class="{ 'chipBtn--on': selectedSpecialties.includes('All') }"
                  type="button"
                  @click="box.toggleSpecialty('All')"
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
              <button
                class="btn btn--ghost"
                type="button"
                @click="selectedSubSkillEns = []"
                :disabled="!selectedSubSkillEns.length"
              >
                {{ t("box.list.subskillClear") }}
              </button>
            </div>
            <div class="boxFilters__list">
              <label v-for="s in availableSubSkills" :key="s.nameEn" class="boxFilters__item">
                <input type="checkbox" class="boxFilters__check" :value="s.nameEn" v-model="selectedSubSkillEns" />
                <span class="boxFilters__itemLabel">{{ box.subSkillLabel(s) }}</span>
              </label>
            </div>
          </details>
        </div>

        <div class="boxSortRow">
          <div class="boxSortRow__left">
            <button class="btn btn--ghost" type="button" @click="box.onUndo" :disabled="!canUndo" :title="t('box.list.undoTitle')">
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
              :class="[box.boxTileTypeClass(e), { 'boxTile--active': e.id === selectedBoxId }]"
              :data-type="e.derived ? getPokemonType(e.derived.pokedexId, e.derived.form) : 'unknown'"
              @click="box.onSelectBox(e.id)"
            >
              <div class="boxTile__name">{{ box.displayBoxTitle(e) }}</div>
              <div class="boxTile__lv">
                Lv{{ e.planner?.level ?? e.derived?.level ?? "-" }}
                <span v-if="e.favorite" class="boxTile__fav" :aria-label="t('box.list.favorite')" :title="t('box.list.favorite')">★</span>
              </div>
            </button>

            <div v-if="idx === detailInsertAfterIndex && selectedBox && selectedDetail" class="boxDetail boxDetail--inline">
              <div class="boxDetail__head">
                <h4 class="boxDetail__title">{{ t("box.list.selected", { name: box.displayBoxTitle(selectedBox) }) }}</h4>
                <div class="boxDetail__actions">
                  <button class="btn btn--primary" type="button" @click="$emit('apply-to-calc', $event)">
                    {{ t("box.add.toCalc") }}
                  </button>
                  <button class="btn btn--danger" type="button" @click="box.onDeleteSelected">
                    {{ t("box.deleteFromBox") }}
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
                        :placeholder="box.displayPokemonName(selectedBox) ?? t('common.optional')"
                        @change="box.onEditSelectedLabel(($event.target as HTMLInputElement).value)"
                      />
                      <div class="boxDetail__minor">{{ t("box.detail.nicknameClearHint") }}</div>
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">{{ t("box.detail.speciesLink") }}</div>
                    <div class="boxDetail__v">
                      <div>
                        <span class="boxDetail__strong">{{ box.displayPokemonName(selectedBox) ?? t("box.detail.unlinked") }}</span>
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
                          @blur="box.onRelinkBlur"
                          @input="box.onRelinkInput"
                        />
                        <button class="btn btn--ghost" type="button" @click="box.onRelinkApply" :disabled="!relinkName.trim()">
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
                            @mousedown.prevent="box.pickRelinkName(n)"
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
                          @click.stop="box.toggleBoxLevelPick"
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
                            <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="box.closeBoxLevelPick">
                              {{ t("common.close") }}
                            </button>
                          </div>

                          <div class="levelPick__sliderRow">
                            <button
                              class="btn btn--ghost btn--xs"
                              type="button"
                              @click="box.nudgeBoxLevel(-1)"
                              :disabled="(selectedDetail?.level ?? 1) <= 1"
                            >
                              ◀
                            </button>
                            <input
                              class="levelPick__range"
                              type="range"
                              min="1"
                              max="65"
                              step="1"
                              :value="selectedDetail?.level ?? 1"
                              @input="box.setBoxLevel(($event.target as HTMLInputElement).value)"
                            />
                            <button
                              class="btn btn--ghost btn--xs"
                              type="button"
                              @click="box.nudgeBoxLevel(1)"
                              :disabled="(selectedDetail?.level ?? 1) >= 65"
                            >
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
                              @click="box.setBoxLevel(lv)"
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
                        @change="box.onEditSelectedExpType(($event.target as HTMLSelectElement).value)"
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
                      <select class="field__input" :value="box.selectedSpecialtySelectValue" @change="box.onEditSelectedSpecialty(($event.target as HTMLSelectElement).value)">
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
                        @update:model-value="box.onBoxItemNatureChange"
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
                          @change="box.onEditSelectedIngredientType(($event.target as HTMLSelectElement).value)"
                        >
                          <option value="">{{ t("box.detail.unknownAuto") }}</option>
                          <option v-for="tt in IngredientTypes" :key="tt" :value="tt">{{ tt }}</option>
                        </select>
                      </div>
                      <div v-if="selectedDetail.ingredientSlots">
                        {{ selectedDetail.ingredientSlots.map(box.toIngredientLabel).join(" / ") }}
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
                            @input="box.onBoxEditSubInput(lv, ($event.target as HTMLInputElement).value)"
                            @blur="box.onBoxEditSubBlur(lv)"
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
                        @click="box.toggleSelectedFavorite"
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
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { localizeNature } from "../i18n/terms";
import { IngredientTypes } from "../domain/box/nitoyon";
import { getPokemonType } from "../domain/pokesleep/pokemon-names";
import { getPokemonNameLocalized } from "../domain/pokesleep/pokemon-name-localize";
import NatureSelect from "./NatureSelect.vue";
import BoxImportDisclosure from "./BoxImportDisclosure.vue";
import type { BoxStore } from "../composables/useBoxStore";

import iconBerrySvg from "../assets/icons/berry.svg?raw";
import iconIngredientsSvg from "../assets/icons/ingredients.svg?raw";
import iconSkillsSvg from "../assets/icons/skills.svg?raw";
import iconAllSvg from "../assets/icons/all.svg?raw";
import iconStarSvg from "../assets/icons/star.svg?raw";

const props = defineProps<{
  box: BoxStore;
  gt: (s: string) => string;
}>();
const emit = defineEmits<{
  (e: "apply-to-calc", ev?: MouseEvent): void;
}>();

const { t, locale } = useI18n();
const box = props.box;
const gt = props.gt;

// Aliases for v-model so the template compiler updates `.value` correctly.
const boxEntries = box.boxEntries;
const selectedBoxId = box.selectedBoxId;
const addLookup = box.addLookup;
const addNameSuggestList = box.addNameSuggestList;
const showAddNameSuggest = box.showAddNameSuggest;
const ingredientTypeOptions = box.ingredientTypeOptions;
const addSubErrors = box.addSubErrors;
const subSkillOptionLabels = box.subSkillOptionLabels;
const sortedBoxEntries = box.sortedBoxEntries;
const detailInsertAfterIndex = box.detailInsertAfterIndex;
const selectedBox = box.selectedBox;
const selectedDetail = box.selectedDetail;
const selectedSpecialtySelectValue = box.selectedSpecialtySelectValue;
const openBoxLevelPick = box.openBoxLevelPick;
const levelPresets = box.levelPresets;
const availableSubSkills = box.availableSubSkills;
const boxSortDir = box.boxSortDir;
const selectedSpecialties = box.selectedSpecialties;
const canUndo = box.canUndo;
const relinkFound = box.relinkFound;
const relinkSuggestList = box.relinkSuggestList;
const relinkStatus = box.relinkStatus;
const boxEditSubInputs = box.boxEditSubInputs;
const boxEditSubErrors = box.boxEditSubErrors;

const importText = box.importText;
const importStatus = box.importStatus;
const boxFilter = box.boxFilter;
const filterJoinMode = box.filterJoinMode;
const favoritesOnly = box.favoritesOnly;
const subSkillJoinMode = box.subSkillJoinMode;
const selectedSubSkillEns = box.selectedSubSkillEns;
const boxSortKey = box.boxSortKey;
const addName = box.addName;
const isComposing = box.isComposing;
const addLabel = box.addLabel;
const addLevel = box.addLevel;
const addNature = box.addNature;
const addSpecialty = box.addSpecialty;
const addExpType = box.addExpType;
const addIngredientType = box.addIngredientType;
const addSubLv10 = box.addSubLv10;
const addSubLv25 = box.addSubLv25;
const addSubLv50 = box.addSubLv50;
const addSubLv75 = box.addSubLv75;
const addSubLv100 = box.addSubLv100;
const relinkName = box.relinkName;
const relinkOpen = box.relinkOpen;
const selectedNature = box.selectedNature;

function onCreateToCalc(ev: MouseEvent) {
  box.onCreateManual({ mode: "toCalc" });
  emit("apply-to-calc", ev);
}
</script>
