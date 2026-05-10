<template>
  <section id="neo-box" class="panel panel--box">
    <div class="panel__head">
      <h2 class="panel__title">{{ t("box.title") }}</h2>
    </div>

    <div class="boxGrid">
      <details class="boxDisclosure" data-testid="box-add-panel" @toggle="onBoxAddToggle">
        <summary class="boxDisclosure__head" data-testid="box-add-summary">
          <span class="boxDisclosure__title">{{ t("box.addNew") }}</span>
        </summary>
        <div v-if="boxAddMounted" class="boxCard boxDisclosure__inner">
          <p class="boxDisclosure__note">
            {{ t("box.addNewDesc") }}
          </p>
          <div class="boxAddGrid">
            <label class="field field--name">
              <span class="field__label">
                {{ t("box.add.nameDex") }}
                <span style="color: var(--danger)">{{ t("common.required") }}</span>
              </span>
              <div class="suggest">
                <input
                  v-model="addName"
                  class="field__input"
                  data-testid="box-add-name-input"
                  :placeholder="t('box.add.nameDexPh')"
                  @focus="box.onAddNameFocus"
                  @blur="box.onAddNameBlur"
                  @input="box.onAddNameInput"
                  @keydown.esc.prevent="box.closeAddNameSuggest"
                  @compositionstart="isComposing = true"
                  @compositionend="isComposing = false"
                />
                <div v-if="showAddNameSuggest" class="suggest__panel" data-testid="box-add-suggest-panel" role="listbox">
                  <button
                    v-for="n in addNameSuggestList"
                    :key="n.nameJa"
                    type="button"
                    class="suggest__item"
                    data-testid="box-add-suggest-item"
                    role="option"
                    @mousedown.prevent="box.pickAddName(n.nameJa)"
                  >
                    {{ n.display }}
                  </button>
                </div>
              </div>
              <span class="field__sub" v-if="addLookup">
                {{
                  t("box.add.detected", {
                    name: getPokemonNameLocalized(addLookup.pokedexId, addLookup.form, locale),
                    id: addLookup.pokedexId,
                    expType: addLookup.expType,
                  })
                }}
              </span>
              <span class="field__sub" v-else>{{ t("box.add.noMatch") }}</span>
            </label>
            <label class="field field--name">
              <span class="field__label">{{ t("box.add.labelOpt") }}</span>
              <input v-model="addLabel" class="field__input" :placeholder="t('box.add.labelOptPh')" />
            </label>
            <div class="field" data-testid="box-add-level-field">
              <span class="field__label">{{ t("box.detail.level") }}</span>
              <LevelPicker v-model="addLevel" :label="`${t('box.add.level')}: Lv${addLevel}`" :max="MAX_LEVEL" />
            </div>
            <label class="field">
              <span class="field__label">{{ t("calc.row.expRemaining") }}</span>
              <input
                v-model="addExpRemaining"
                type="number"
                min="0"
                class="field__input"
                data-testid="box-add-exp-remaining-input"
                :placeholder="t('calc.row.expRemainingPh')"
              />
            </label>
            <label class="field" data-testid="box-add-nature-field">
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
              <span class="field__label">{{ t("calc.row.speciesCandy") }}</span>
              <input
                v-model="addSpeciesCandy"
                type="number"
                min="0"
                class="field__input"
                data-testid="box-add-species-candy"
              />
            </label>
            <label class="field">
              <span class="field__label">{{ t("box.add.specialtyOpt") }}</span>
              <select v-model="addSpecialty" class="field__input" data-testid="box-add-specialty-select" :disabled="!!addLookup" @change="box.onAddSpecialtyChanged">
                <option value="">{{ t("box.add.specialtyUnknown") }}</option>
                <option value="Berries">{{ gt("きのみ") }}</option>
                <option value="Ingredients">{{ gt("食材") }}</option>
                <option value="Skills">{{ gt("スキル") }}</option>
                <option value="All">{{ gt("オール") }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">{{ t("box.add.expType") }}</span>
              <select v-model.number="addExpType" class="field__input" data-testid="box-add-exptype-select" :disabled="!!addLookup" @change="box.onAddExpTypeChanged">
                <option :value="600">600{{ !addLookup ? t("box.add.expType600Hint") : '' }}</option>
                <option :value="900">900</option>
                <option :value="1080">1080</option>
                <option :value="1320">1320</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">{{ t("box.add.ingredientType") }}</span>
              <select
                v-model="addIngredientType"
                class="field__input"
                data-testid="box-add-ingredient-select"
                @change="box.onAddIngredientTypeChanged"
              >
                <option value="">{{ t("box.add.ingredientTypeNone") }}</option>
                <template v-if="addLookup">
                  <option v-for="x in ingredientTypeOptions" :key="x.type" :value="x.type">
                    {{ x.type }} - {{ x.preview }}
                  </option>
                </template>
                <template v-else>
                  <option value="AAA">AAA</option>
                  <option value="AAB">AAB</option>
                  <option value="AAC">AAC</option>
                  <option value="ABA">ABA</option>
                  <option value="ABB">ABB</option>
                  <option value="ABC">ABC</option>
                </template>
              </select>
            </label>

            <label class="field">
              <span class="field__label">{{ t("box.detail.sleepHours") }}</span>
              <input
                v-model="box.addSleepHours.value"
                type="number"
                min="0"
                step="1"
                class="field__input"
                data-testid="box-add-sleep-hours"
                placeholder=""
              />
            </label>

            <div class="field field--wide">
              <span class="field__label">{{ t("box.add.subSkills") }}</span>
              <div class="subGrid" data-testid="box-add-subskills">
                <label class="subField">
                  <span class="subField__k">Lv10</span>
                  <select
                    v-model="addSubLv10"
                    class="field__input"
                    :class="{ 'field__input--error': !!addSubErrors['10'] }"
                  >
                    <option value=""></option>
                    <option v-for="label in subSkillOptionLabels" :key="label" :value="label">{{ label }}</option>
                  </select>
                  <span v-if="addSubErrors['10']" class="field__error">{{ addSubErrors["10"] }}</span>
                </label>
                <label class="subField">
                  <span class="subField__k">Lv25</span>
                  <select
                    v-model="addSubLv25"
                    class="field__input"
                    :class="{ 'field__input--error': !!addSubErrors['25'] }"
                  >
                    <option value=""></option>
                    <option v-for="label in subSkillOptionLabels" :key="label" :value="label">{{ label }}</option>
                  </select>
                  <span v-if="addSubErrors['25']" class="field__error">{{ addSubErrors["25"] }}</span>
                </label>
                <label class="subField">
                  <span class="subField__k">Lv50</span>
                  <select
                    v-model="addSubLv50"
                    class="field__input"
                    :class="{ 'field__input--error': !!addSubErrors['50'] }"
                  >
                    <option value=""></option>
                    <option v-for="label in subSkillOptionLabels" :key="label" :value="label">{{ label }}</option>
                  </select>
                  <span v-if="addSubErrors['50']" class="field__error">{{ addSubErrors["50"] }}</span>
                </label>
                <label class="subField">
                  <span class="subField__k">Lv75</span>
                  <select
                    v-model="addSubLv75"
                    class="field__input"
                    :class="{ 'field__input--error': !!addSubErrors['75'] }"
                  >
                    <option value=""></option>
                    <option v-for="label in subSkillOptionLabels" :key="label" :value="label">{{ label }}</option>
                  </select>
                  <span v-if="addSubErrors['75']" class="field__error">{{ addSubErrors["75"] }}</span>
                </label>
                <label class="subField">
                  <span class="subField__k">Lv100</span>
                  <select
                    v-model="addSubLv100"
                    class="field__input"
                    :class="{ 'field__input--error': !!addSubErrors['100'] }"
                  >
                    <option value=""></option>
                    <option v-for="label in subSkillOptionLabels" :key="label" :value="label">{{ label }}</option>
                  </select>
                  <span v-if="addSubErrors['100']" class="field__error">{{ addSubErrors["100"] }}</span>
                </label>
              </div>
            </div>
            <label class="boxAddFav">
              <input type="checkbox" v-model="box.addFavorite.value" />
              {{ t("box.add.addFavorite") }}
            </label>
            <div class="boxAddActions">
              <label class="boxAddCalcCheck">
                <input type="checkbox" v-model="addToCalcChecked" data-testid="box-add-to-calc-checkbox" />
                {{ t("box.add.addToCalc") }}
              </label>
              <button class="btn btn--primary" type="button" data-testid="box-add-submit" @click="onCreateToBox()">
                {{ t("box.add.toBox") }}
              </button>
            </div>
          </div>
        </div>
      </details>

      <details class="boxDisclosure" data-testid="box-import-panel" @toggle="onBoxImportToggle">
        <summary class="boxDisclosure__head" data-testid="box-import-summary">
          <span class="boxDisclosure__title">{{ t("box.import.title") }}</span>
        </summary>
        <div v-if="boxImportMounted" class="boxCard boxDisclosure__inner">
          <p class="boxDisclosure__note">
            {{ t("box.import.desc") }}
          </p>
          <textarea
            ref="textareaRef"
            :value="importText"
            class="boxTextarea"
            data-testid="box-import-textarea"
            rows="7"
            :placeholder="t('box.import.ph')"
            @input="importText = ($event.target as HTMLTextAreaElement).value"
            @paste="onPasteEvent"
          ></textarea>
          <label class="boxImport__favCheck">
            <input type="checkbox" v-model="importFavorite" />
            {{ t("box.import.addAllFavorite") }}
          </label>
          <div class="boxCard__actions boxCard__actions--row">
            <button
              class="btn btn--primary"
              :class="{ 'btn--done': importBtnFlash }"
              type="button"
              data-testid="box-import-submit"
              @click="onImportWithFlash"
            >
              {{ importBtnFlash ? importBtnLabel : t("box.import.run") }}
            </button>
            <button class="btn btn--ghost" type="button" data-testid="box-import-paste" @click="onPasteImport">
              {{ t("box.import.paste") }}
            </button>
            <label class="btn btn--ghost boxImport__fileLabel">
              {{ t("box.import.fileSelect") }}
              <input
                type="file"
                accept=".txt,text/plain"
                class="boxImport__fileInput"
                data-testid="box-import-file-input"
                @change="onFileSelect"
              />
            </label>
            <button class="btn btn--ghost" type="button" data-testid="box-import-clear" @click="importText = ''">
              {{ t("common.clear") }}
            </button>
          </div>
          <div class="boxCard__hints">
            <span class="boxCard__status--hint" aria-hidden="true">{{ t("box.import.pasteHelp") }}</span>
          </div>
        </div>
      </details>

      <div class="boxCard">
        <div class="boxCard__head">
          <h3 class="boxCard__title">{{ t("box.list.title") }}</h3>
        </div>

        <!-- 検索 -->
        <div class="boxSearchRow">
          <input v-model="boxFilter" class="boxSearch field__input" data-testid="box-search-input" :placeholder="t('box.list.searchPh')" />
          <button class="btn btn--ghost btn--sm" type="button" data-testid="box-search-clear" @click="boxFilter = ''" :disabled="!boxFilter.trim()">
            {{ t("box.list.clearSearch") }}
          </button>
        </div>

        <!-- お気に入り＆とくいフィルタ -->
        <div class="boxFilterRow">
          <button
            class="chipBtn"
            :class="{ 'chipBtn--on': favoritesOnly }"
            type="button"
            data-testid="box-filter-favorite"
            @click="favoritesOnly = !favoritesOnly"
            :title="t('box.list.favoritesOnlyTitle')"
            :aria-label="t('box.list.favoritesOnlyAria')"
          >
            <span class="chipBtn__icon" v-html="iconStarSvg" aria-hidden="true"></span>
            <span class="chipBtn__text">{{ t("box.list.favorites") }}</span>
          </button>
          <button
            class="chipBtn"
            :class="{ 'chipBtn--on': selectedSpecialties.includes('Berries') }"
            type="button"
            data-testid="box-filter-berry"
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
            data-testid="box-filter-ingredient"
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
            data-testid="box-filter-skill"
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
            data-testid="box-filter-all"
            @click="box.toggleSpecialty('All')"
            :aria-label="t('box.list.specialtyAria', { name: gt('オール') })"
          >
            <span class="chipBtn__icon" v-html="iconAllSvg" aria-hidden="true"></span>
            <span class="chipBtn__text">{{ gt("オール") }}</span>
          </button>
        </div>

        <!-- 詳細設定 -->
        <details class="boxAdvanced" data-testid="box-advanced-panel" @toggle="onBoxAdvancedToggle">
          <summary class="boxAdvanced__summary" data-testid="box-advanced-summary">
            <span>{{ t("box.list.advancedSettings") }}</span>
          </summary>
          <div v-if="boxAdvancedMounted" class="boxAdvanced__content">
            <div class="boxAdvanced__row">
              <span class="boxAdvanced__label">{{ t("box.list.join") }}</span>
              <select v-model="filterJoinMode" class="field__input boxAdvanced__select" data-testid="box-filter-join-select" :aria-label="t('box.list.join')">
                <option value="and">{{ t("box.list.joinAnd") }}</option>
                <option value="or">{{ t("box.list.joinOr") }}</option>
              </select>
            </div>
            <div class="boxAdvanced__section">

              <div class="boxAdvanced__row">
                <span class="boxAdvanced__label">{{ t("box.list.subskillJoin") }}</span>
                <select v-model="subSkillJoinMode" class="field__input boxAdvanced__select" data-testid="box-subskill-join-select" :aria-label="t('box.list.subskillJoin')">
                  <option value="or">{{ t("box.list.subskillJoinOr") }}</option>
                  <option value="and">{{ t("box.list.subskillJoinAnd") }}</option>
                </select>
              </div>
              <button
                class="btn btn--ghost btn--sm"
                type="button"
                data-testid="box-subskill-clear"
                @click="selectedSubSkillEns = []"
                :disabled="!selectedSubSkillEns.length"
              >
                {{ t("box.list.subskillClear") }}
              </button>
              <div class="boxAdvanced__list" data-testid="box-subskill-filter-list">
                <label v-for="s in availableSubSkills" :key="s.nameEn" class="boxAdvanced__item">
                  <input type="checkbox" class="boxAdvanced__check" :data-testid="'box-subskill-filter-' + s.nameEn" :value="s.nameEn" v-model="selectedSubSkillEns" />
                  <span class="boxAdvanced__itemLabel">{{ box.subSkillLabel(s) }}</span>
                </label>
              </div>
            </div>
          </div>
        </details>

        <div class="boxSortRow">
          <div class="boxSort">
            <span class="boxSort__label">{{ t("box.list.sortTitle") }}</span>
            <select v-model="boxSortKey" class="field__input boxSort__select" :aria-label="t('box.list.sortKeyAria')">
              <option value="labelFav">{{ t("box.list.sortLabelFav") }}</option>
              <option value="levelFav">{{ t("box.list.sortLevelFav") }}</option>
              <option value="dexFav">{{ t("box.list.sortDexFav") }}</option>
              <option value="label">{{ t("box.list.sortLabel") }}</option>
              <option value="level">{{ t("box.list.sortLevel") }}</option>
              <option value="dex">{{ t("box.list.sortDex") }}</option>
            </select>
            <button
              class="btn"
              :class="boxSortDir === 'asc' ? 'btn--primary' : 'btn--ghost'"
              type="button"
              @click="box.applySort('asc')"
            >
              {{ t("box.list.sortAsc") }}
            </button>
            <button
              class="btn"
              :class="boxSortDir === 'desc' ? 'btn--primary' : 'btn--ghost'"
              type="button"
              @click="box.applySort('desc')"
            >
              {{ t("box.list.sortDesc") }}
            </button>
          </div>
          <div class="boxSortRow__undoRedo">
            <button class="btn btn--ghost btn--sm" type="button" data-testid="box-clear-all" @click="box.onClearBox" :disabled="!boxEntries.length">
              {{ t("box.clearAll") }}
            </button>
            <button class="btn" :class="canUndo ? 'btn--primary' : 'btn--ghost'" type="button" data-testid="box-undo" @click="box.onUndo" :disabled="!canUndo" :title="t('box.list.undoTitle')">
              {{ t("common.undo") }}
            </button>
            <button class="btn" :class="canRedo ? 'btn--primary' : 'btn--ghost'" type="button" data-testid="box-redo" @click="box.onRedo" :disabled="!canRedo">
              {{ t("common.redo") }}
            </button>
          </div>
        </div>

        <div class="boxList" ref="boxListRef" v-if="sortedBoxEntries.length">
          <template v-for="(e, idx) in sortedBoxEntries" :key="e.id">
            <button
              type="button"
              class="boxTile"
              data-testid="box-tile"
              :class="[boxTileClassById.get(e.id) ?? 'boxTile--type-unknown', { 'boxTile--active': e.id === selectedBoxId, 'boxTile--hover': hoveredTileId === e.id || e.id === selectedBoxId }]"
              :data-type="e.derived ? getPokemonType(e.derived.pokedexId, e.derived.form) : 'unknown'"
              @mouseenter="onTileMouseEnter(e.id)"
              @mouseleave="onTileMouseLeave"
              @touchstart="onTileTouchStart"
              @click="box.onSelectBox(e.id)"
            >
              <div class="boxTile__name">{{ boxDisplayTitleById.get(e.id) ?? box.displayBoxTitle(e) }}</div>
              <span v-if="e.favorite" class="boxTile__fav" :aria-label="t('box.list.favorite')" :title="t('box.list.favorite')" v-html="iconStarSvg"></span>
              <span class="boxTile__lv">Lv{{ e.planner?.level ?? e.derived?.level ?? "-" }}</span>
            </button>

            <div v-if="idx === detailInsertAfterIndex && selectedBox && selectedDetail" class="boxDetail boxDetail--inline" data-testid="box-detail-panel">
              <div class="boxDetail__head">
                <h4 class="boxDetail__title">{{ t("box.list.selected", { name: boxDisplayTitleById.get(selectedBox.id) ?? box.displayBoxTitle(selectedBox) }) }}</h4>
                <div class="boxDetail__actions">
                  <button
                    class="btn btn--primary"
                    :class="{ 'btn--done': calcBtnFlash }"
                    type="button"
                    data-testid="box-detail-calc"
                    @click="onApplyToCalcWithFlash()"
                  >
                    {{ calcBtnFlash ? calcBtnLabel : t("box.add.toCalc") }}
                  </button>
                  <button class="btn btn--danger" type="button" data-testid="box-detail-delete" @click="box.onDeleteSelected">
                    {{ t("box.deleteFromBox") }}
                  </button>
                </div>
              </div>

              <div class="boxDetail__grid">
                <div class="boxDetail__col">
                  <div class="boxDetail__kv boxDetail__kv--wide">
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
                          data-testid="box-detail-relink-input"
                          :placeholder="t('box.detail.relinkPh')"
                          @focus="relinkOpen = true"
                          @blur="box.onRelinkBlur"
                          @input="box.onRelinkInput"
                        />
                        <button class="btn btn--ghost" type="button" data-testid="box-detail-relink-button" @click="box.onRelinkApply" :disabled="!relinkName.trim()">
                          {{ t("box.detail.relinkButton") }}
                        </button>
                        <div class="boxDetail__minor" v-if="relinkFound">
                          {{
                            t("box.detail.relinkCandidate", {
                              name: getPokemonNameLocalized(relinkFound.pokedexId, relinkFound.form, locale),
                              id: relinkFound.pokedexId,
                              expType: relinkFound.expType,
                            })
                          }}
                        </div>
                        <div class="boxDetail__minor" v-else-if="relinkName.trim()">{{ t("box.detail.relinkNoCandidate") }}</div>
                        <div v-if="showRelinkSuggest" class="suggest__panel" data-testid="box-detail-relink-suggest-panel" role="listbox">
                          <button
                            v-for="n in relinkSuggestList"
                            :key="n.nameJa"
                            type="button"
                            class="suggest__item"
                            role="option"
                            @mousedown.prevent="box.pickRelinkName(n.nameJa)"
                          >
                            {{ n.display }}
                          </button>
                        </div>
                      </div>

                      <div class="boxDetail__minor" v-if="relinkStatus">{{ relinkStatus }}</div>
                    </div>
                  </div>

                  <div class="boxDetail__kv boxDetail__kv--wide">
                    <div class="boxDetail__k">{{ t("box.detail.nickname") }}</div>
                    <div class="boxDetail__v">
                      <div class="boxDetail__nickRow">
                        <div class="boxDetail__nickInput">
                          <input
                            class="field__input"
                            data-testid="box-detail-nickname-input"
                            :value="selectedBox.label ?? ''"
                            :placeholder="box.displayPokemonName(selectedBox) ?? t('common.optional')"
                            @change="box.onEditSelectedLabel(($event.target as HTMLInputElement).value)"
                          />
                          <div class="boxDetail__minor">{{ t("box.detail.nicknameClearHint") }}</div>
                        </div>
                        <button
                          class="chipBtn chipBtn--iconOnly"
                          :class="{ 'chipBtn--on': !!selectedBox.favorite }"
                          type="button"
                          data-testid="box-detail-favorite"
                          @click="box.toggleSelectedFavorite"
                          :title="t('box.list.favorite')"
                        >
                          <span class="chipBtn__icon" v-html="iconStarSvg" aria-hidden="true"></span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="boxDetail__specs">
                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">{{ t("box.detail.level") }}</div>
                    <div class="boxDetail__v">
                      <div class="levelPick">
                        <LevelPicker
                          :model-value="selectedDetail?.level ?? 1"
                          @update:model-value="box.setBoxLevel($event)"
                          :label="`${t('box.add.level')}: Lv${selectedDetail?.level ?? 1}`"
                          :max="MAX_LEVEL"
                        />
                      </div>
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">{{ t("calc.row.expRemaining") }}</div>
                    <div class="boxDetail__v">
                      <input
                        type="number"
                        min="0"
                        class="field__input"
                        data-testid="box-detail-exp-remaining-input"
                        :value="selectedDetail?.expRemaining"
                        @input="box.onEditSelectedExpRemaining(($event.target as HTMLInputElement).value)"
                        :placeholder="t('common.optional')"
                      />
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">
                      {{ t("calc.row.nature") }}
                      <button
                        v-if="selectedDetail?.decoded?.natureName"
                        type="button"
                        class="hintIcon hintIcon--pill"
                        @click.stop="showHint($event, localizeNature(selectedDetail.decoded.natureName, locale))"
                      ><svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor" fill-opacity="0.16"/><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                    </div>
                    <div class="boxDetail__v">
                      <NatureSelect
                        v-model="selectedNature"
                        @update:model-value="box.onBoxItemNatureChange"
                        :label="t('calc.row.nature')"
                        :label-normal="t('calc.row.natureNormal')"
                        :label-up="t('calc.row.natureUp')"
                        :label-down="t('calc.row.natureDown')"
                      />
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">{{ t("box.list.specialty") }}</div>
                    <div class="boxDetail__v">
                      <div
                        v-if="(selectedDetail?.pokedexId ?? 0) > 0"
                        class="field__input field__input--static"
                        data-testid="box-detail-specialty-display"
                        :title="t('calc.row.expTypeFixedHint')"
                      >
                        {{
                          selectedDetail?.specialty === 'Berries'
                            ? gt('きのみ')
                            : selectedDetail?.specialty === 'Ingredients'
                              ? gt('食材')
                              : selectedDetail?.specialty === 'Skills'
                                ? gt('スキル')
                                : selectedDetail?.specialty === 'All'
                                  ? gt('オール')
                                  : t('box.detail.unknown')
                        }}
                      </div>
                      <select
                        v-else
                        class="field__input"
                        :value="selectedSpecialtySelectValue"
                        @change="box.onEditSelectedSpecialty(($event.target as HTMLSelectElement).value)"
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
                    <div class="boxDetail__k">{{ t("calc.row.expType") }}</div>
                    <div class="boxDetail__v">
                      <div
                        v-if="(selectedDetail?.pokedexId ?? 0) > 0"
                        class="field__input field__input--static"
                        data-testid="box-detail-exptype-display"
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
                    <div class="boxDetail__k">
                      {{ t("box.detail.ingredients") }}
                      <button
                        v-if="selectedDetail.ingredientSlots"
                        type="button"
                        class="hintIcon hintIcon--pill"
                        @click.stop="showHint($event, selectedDetail.ingredientSlots.map(box.toIngredientLabel).join(' / '))"
                        v-html="iconIngredientsSvg"
                      ></button>
                    </div>
                    <div class="boxDetail__v">
                      <select
                        class="field__input"
                        data-testid="box-detail-ingredient-select"
                        :value="selectedDetail.ingredientType ?? ''"
                        @change="box.onEditSelectedIngredientType(($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t("box.detail.unknownAuto") }}</option>
                        <option v-for="tt in IngredientTypes" :key="tt" :value="tt">{{ tt }}</option>
                      </select>
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">{{ t("box.detail.sleepHours") }}</div>
                    <div class="boxDetail__v sleepHoursRow">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        class="field__input"
                        :value="sleepHoursInput"
                        placeholder=""
                        @input="onSleepHoursInput(($event.target as HTMLInputElement).value)"
                      />
                      <button
                        type="button"
                        class="btn btn--sleepCalc"
                        :class="{ 'btn--sleepCalc--open': showSleepCalc }"
                        :aria-expanded="showSleepCalc"
                        :aria-label="t('box.detail.sleepCalcButton')"
                        :title="t('box.detail.sleepCalcButton')"
                        @click="toggleSleepCalc"
                      >
                        <span v-if="showSleepCalc" class="btn--sleepCalc__chevron" aria-hidden="true">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
                            <path d="M18 15L12 9L6 15" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                        </span>
                        <span v-else v-html="iconCalculatorSvg" aria-hidden="true"></span>
                      </button>
                    </div>
                  </div>

                  <div v-if="showSleepCalc" class="sleepCalcPanel" :class="{ 'sleepCalcPanel--enter': sleepCalcAnimating }" data-testid="box-detail-sleep-calc" @animationend="onSleepCalcAnimEnd">
                    <div class="sleepCalcPanel__daily">
                      <label class="sleepCalcPanel__label">
                        {{ t("box.detail.sleepCalcDaily") }}
                        <span class="sleepCalcPanel__unit">{{ t("box.detail.sleepCalcDailyUnit") }}</span>
                        <button
                          type="button"
                          class="hintIcon"
                          style="margin-left: 4px;"
                          @click.stop="showHint($event, t('box.detail.sleepCalcDailyHint'))"
                        >?</button>
                      </label>
                      <input
                        v-model.number="tempDailySleepHours"
                        type="number"
                        min="1"
                        max="13"
                        step="0.5"
                        class="field__input sleepCalcPanel__input"
                        @blur="onDailySleepBlur"
                      />
                    </div>
                    <div class="sleepTimeline">
                      <div class="sleepTimeline__axis">
                        <div :ref="setSleepTrackRowRef" class="sleepTimeline__trackRow" :class="[`sleepTimeline__trackRow--${locale}`, { 'sleepTimeline__trackRow--hasOffset': should500hOffset }]">
                          <div class="sleepTimeline__track">
                            <div class="sleepTimeline__progress" :style="{ width: progressPct + '%' }"></div>
                          </div>
                          <div
                            v-for="ms in sleepMilestones"
                            :key="ms.hours"
                            class="sleepTimeline__milestone"
                            :class="[nodeClass(ms), { 'sleepTimeline__milestone--offset': ms.hours === 500 && should500hOffset }]"
                            :data-milestone="ms.hours"
                            :style="{ left: milestoneLeftPct(ms.hours) + '%' }"
                          >
                            <div class="sleepTimeline__dot">
                              <span v-if="ms.achieved" class="sleepTimeline__dotMark">✓</span>
                              <span v-else class="sleepTimeline__dotMark">{{ ms.index }}</span>
                            </div>
                            <div class="sleepTimeline__label">{{ ms.hours }}h</div>
                            <div class="sleepTimeline__status">
                              <template v-if="ms.achieved">{{ t("box.detail.sleepMilestoneAchieved") }}</template>
                              <template v-else>
                                <div class="sleepTimeline__days">
                                  {{ t("box.detail.sleepMilestoneDaysLeft", { days: ms.remainingDays }) }}
                                </div>
                                <div class="sleepTimeline__date">{{ ms.estimatedDate }}</div>
                              </template>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>

                <div class="boxDetail__col">
                  <div class="boxDetail__kv boxDetail__kv--wide">
                    <div class="boxDetail__k">{{ t("box.detail.subSkills") }}</div>
                    <div class="boxDetail__v">
                      <div class="boxDetail__subEdit" data-testid="box-detail-subskills">
                        <div v-for="lv in [10, 25, 50, 75, 100]" :key="lv" class="subField">
                          <span class="subField__k">Lv{{ lv }}</span>
                          <select
                            :value="boxEditSubInputs[String(lv)] ?? ''"
                            class="field__input"
                            :class="{ 'field__input--error': !!boxEditSubErrors[String(lv)] }"
                            @change="box.onBoxEditSubInput(lv, ($event.target as HTMLSelectElement).value)"
                          >
                            <option value=""></option>
                            <option v-for="label in subSkillOptionLabels" :key="label" :value="label">{{ label }}</option>
                          </select>
                          <span v-if="boxEditSubErrors[String(lv)]" class="field__error">{{ boxEditSubErrors[String(lv)] }}</span>
                        </div>
                      </div>
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

    <!-- ツールチップ（ヒント） -->
    <Teleport to="body">
      <div v-if="hintState.visible" class="hintOverlay" @click.stop="closeHint"></div>
      <div
        v-if="hintState.visible"
        ref="hintPopoverRef"
        class="hintPopover"
        :style="{ left: hintState.left + 'px', top: hintState.top + 'px' }"
        @click="handleHintClick"
        v-html="hintState.message"
      ></div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onBeforeUnmount } from "vue";
import type { ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import { localizeNature } from "../i18n/terms";
import { IngredientTypes } from "../domain/box/nitoyon";
import { getPokemonType } from "../domain/pokesleep/pokemon-names";
import { getPokemonNameLocalized } from "../domain/pokesleep/pokemon-name-localize";
import NatureSelect from "./NatureSelect.vue";

import type { BoxStore } from "../composables/useBoxStore";
import type { CalcStore } from "../composables/useCalcStore";
import { useCandyStore } from "../composables/useCandyStore";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";

import iconBerrySvg from "../assets/icons/berry.svg?raw";
import iconIngredientsSvg from "../assets/icons/ingredients.svg?raw";
import iconSkillsSvg from "../assets/icons/skills.svg?raw";
import iconAllSvg from "../assets/icons/all.svg?raw";
import iconStarSvg from "../assets/icons/star.svg?raw";
import iconCalculatorSvg from "../assets/icons/calculator.svg?raw";
import {
  calcSleepMilestones,
  normalizeDailySleepInput,
  normalizeSleepHoursValue,
  normalizeSleepHoursInput,
  type SleepMilestoneResult,
} from "../domain/box/sleep-milestones";

const props = defineProps<{
  box: BoxStore;
  calc: CalcStore;
  gt: (s: string) => string;
}>();
const emit = defineEmits<{
  (e: "apply-to-calc"): void;
  (e: "open-settings"): void;
}>();

const { t, locale } = useI18n();
const box = props.box;
const calc = props.calc;
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
const availableSubSkills = box.availableSubSkills;
const boxSortDir = box.boxSortDir;
const selectedSpecialties = box.selectedSpecialties;
const canUndo = box.canUndo;
const canRedo = box.canRedo;
const relinkFound = box.relinkFound;
const relinkSuggestList = box.relinkSuggestList;
const showRelinkSuggest = box.showRelinkSuggest;
const relinkStatus = box.relinkStatus;
const boxEditSubInputs = box.boxEditSubInputs;
const boxEditSubErrors = box.boxEditSubErrors;
/* ===== Sleep milestone calc (local state) ===== */
const showSleepCalc = ref(false);
const tempDailySleepHours = ref<number | null>(null);
const sleepHoursInput = ref("");

function onDailySleepBlur() {
  if (normalizeDailySleepInput(tempDailySleepHours.value) == null) {
    tempDailySleepHours.value = calc.sleepSettings.value.dailySleepHours;
  }
}

function syncSleepHoursInput() {
  const raw = selectedDetail.value?.sleepHours;
  sleepHoursInput.value = normalizeSleepHoursInput(String(raw ?? "")) != null ? String(Math.floor(raw!)) : "";
}

function onSleepHoursInput(v: string) {
  sleepHoursInput.value = v;
  box.setBoxSleepHours(v);
}

const effectiveDailySleep = computed(() =>
  normalizeDailySleepInput(tempDailySleepHours.value) ?? calc.sleepSettings.value.dailySleepHours
);

const currentSleepHours = computed(() => normalizeSleepHoursValue(selectedDetail.value?.sleepHours));
const progressPct = computed(() => Math.min(100, (currentSleepHours.value / 2000) * 100));

const sleepMilestones = computed<SleepMilestoneResult[]>(() =>
  calcSleepMilestones({
    currentSleepHours: currentSleepHours.value,
    dailySleepHours: effectiveDailySleep.value,
  })
);

const nextMilestoneHours = computed(() => {
  const next = sleepMilestones.value.find((x) => !x.achieved);
  return next?.hours ?? null;
});

const sleepCalcAnimating = ref(false);

function toggleSleepCalc() {
  const opening = !showSleepCalc.value;
  showSleepCalc.value = opening;
  if (opening) {
    sleepCalcAnimating.value = true;
  }
}

function onSleepCalcAnimEnd() {
  sleepCalcAnimating.value = false;
}

function milestoneLeftPct(hours: number) {
  return (hours / 2000) * 100;
}

function nodeClass(ms: SleepMilestoneResult) {
  if (ms.achieved) return "sleepTimeline__milestone--done";
  if (nextMilestoneHours.value === ms.hours) return "sleepTimeline__milestone--next";
  return "sleepTimeline__milestone--future";
}

/**
 * 200h/500h マイルストーンの水平干渉を検出し、500h を下方オフセットするか判定。
 * コンテナ幅 × パーセント位置 + offsetWidth で計算するため、オフセット状態に依存しない。
 * ResizeObserver でコンテナ幅の変化を追従し、sleepMilestones の変更でも再判定する。
 */
const sleepTrackRowRef = ref<HTMLElement | null>(null);
const should500hOffset = ref(false);
let _sleepTrackRO: ResizeObserver | null = null;

function checkMilestoneCollision() {
  const container = sleepTrackRowRef.value;
  if (!container) { should500hOffset.value = false; return; }

  // 両方達成済みならオフセット不要（短い「達成!」ラベルは干渉しない）
  const ms200 = sleepMilestones.value.find((x) => x.hours === 200);
  const ms500 = sleepMilestones.value.find((x) => x.hours === 500);
  if (ms200?.achieved && ms500?.achieved) { should500hOffset.value = false; return; }

  const el200 = container.querySelector('[data-milestone="200"]') as HTMLElement | null;
  const el500 = container.querySelector('[data-milestone="500"]') as HTMLElement | null;
  if (!el200 || !el500) { should500hOffset.value = false; return; }

  const w = container.clientWidth;
  const right200 = w * 0.10 + el200.offsetWidth / 2;
  const left500 = w * 0.25 - el500.offsetWidth / 2;
  should500hOffset.value = right200 > left500 - 4;
}

function disconnectSleepTrackObserver() {
  _sleepTrackRO?.disconnect();
  _sleepTrackRO = null;
}

function attachSleepTrackObserver(el: HTMLElement) {
  disconnectSleepTrackObserver();
  nextTick(() => {
    if (sleepTrackRowRef.value !== el) return;
    checkMilestoneCollision();
    const ro = new ResizeObserver(() => checkMilestoneCollision());
    ro.observe(el);
    _sleepTrackRO = ro;
  });
}

/** function ref: クラスのみの再パッチ（同一要素）では observer を維持する */
function setSleepTrackRowRef(el: Element | ComponentPublicInstance | null) {
  const nextEl = el instanceof HTMLElement ? el : null;
  if (nextEl && nextEl === sleepTrackRowRef.value) return;
  sleepTrackRowRef.value = nextEl;
  if (nextEl) { attachSleepTrackObserver(nextEl); } else { disconnectSleepTrackObserver(); }
}

onBeforeUnmount(disconnectSleepTrackObserver);

// マイルストーンデータ変更時にも再判定（ラベル幅が変わりうる）
watch(sleepMilestones, () => checkMilestoneCollision(), { deep: true, flush: "post" });

watch(
  () => [selectedBox.value?.id, selectedBox.value?.planner?.sleepHours] as const,
  () => {
    syncSleepHoursInput();
  },
  { immediate: true }
);

/** 展開時に 1日の睡眠時間へ設定のデフォルトを表示（空欄にしない）。閉じたらオフセットをリセット */
watch(showSleepCalc, (open) => {
  if (open) {
    tempDailySleepHours.value = calc.sleepSettings.value.dailySleepHours;
  } else {
    should500hOffset.value = false;
  }
});

/** タイル行ごとに1回だけ displayBoxTitle / boxTileTypeClass を評価（ソート済み一覧の再描画コスト削減） */
const boxTileClassById = computed(() => {
  const m = new Map<string, string>();
  for (const e of sortedBoxEntries.value) {
    m.set(e.id, box.boxTileTypeClass(e));
  }
  return m;
});
const boxDisplayTitleById = computed(() => {
  const m = new Map<string, string>();
  for (const e of sortedBoxEntries.value) {
    m.set(e.id, box.displayBoxTitle(e));
  }
  return m;
});

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
const addExpRemaining = box.addExpRemaining;
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
import LevelPicker from "./LevelPicker.vue";
const candyStore = useCandyStore();
const addSpeciesCandy = ref<string>("");
const addToCalcChecked = ref(true);
const boxAddMounted = ref(false);
const boxImportMounted = ref(false);
const boxAdvancedMounted = ref(false);

function mountDisclosureContent(event: Event, mounted: { value: boolean }) {
  const details = event.target as HTMLDetailsElement | null;
  if (details?.open) {
    mounted.value = true;
  }
}

function onBoxAddToggle(event: Event) {
  mountDisclosureContent(event, boxAddMounted);
}

function onBoxImportToggle(event: Event) {
  mountDisclosureContent(event, boxImportMounted);
}

function onBoxAdvancedToggle(event: Event) {
  mountDisclosureContent(event, boxAdvancedMounted);
}

// Pre-fill species candy stock when a Pokémon is identified
watch(addLookup, (lu) => {
  if (lu) {
    const current = candyStore.getSpeciesCandyFor(lu.pokedexId);
    addSpeciesCandy.value = current > 0 ? String(current) : "";
  } else {
    addSpeciesCandy.value = "";
  }
});

/* ===== Button flash feedback helper ===== */
const importBtnFlash = ref(false);
const importBtnLabel = ref("");
const calcBtnFlash = ref(false);
const calcBtnLabel = ref("");

function flashBtn(flashRef: { value: boolean }, labelRef: { value: string }, msg: string, ms = 1500) {
  flashRef.value = true;
  labelRef.value = msg;
  setTimeout(() => { flashRef.value = false; labelRef.value = ""; }, ms);
}

// hover class control (replaces CSS :hover to avoid iOS sticky hover)
// On touch devices, iOS fires synthetic mouseenter after touchstart.
// We suppress mouse hover entirely once a touch is detected.
const hoveredTileId = ref<string | null>(null);
let isTouchDevice = false;
function onTileMouseEnter(id: string) {
  if (!isTouchDevice) hoveredTileId.value = id;
}
function onTileMouseLeave() {
  if (!isTouchDevice) hoveredTileId.value = null;
}
function onTileTouchStart() {
  isTouchDevice = true;
  hoveredTileId.value = null;
}

// .boxList の DOM 要素を composable の ResizeObserver に渡す
const boxListRef = ref<HTMLElement | null>(null);
watch(boxListRef, (el) => { box.boxListEl.value = el; }, { immediate: true });

function onApplyToCalcWithFlash() {
  emit("apply-to-calc");
  flashBtn(calcBtnFlash, calcBtnLabel, `✓ ${t("status.reflected")}`, 1500);
}

function onImportWithFlash() {
  const added = box.onImport({ markFavorite: importFavorite.value });
  if (added > 0) {
    flashBtn(importBtnFlash, importBtnLabel, `✓ ${added}${t("box.import.addedUnit")}`, 1500);
  }
}

function onCreateToBox() {
  // Save species candy stock if a value was entered and species is known
  if (addLookup.value) {
    const rawCandy = String(addSpeciesCandy.value).trim();
    const parsedCandy = rawCandy === "" ? undefined : Math.max(0, Math.floor(Number(rawCandy) || 0));
    if (parsedCandy !== undefined) {
      candyStore.updateSpeciesCandy(addLookup.value.pokedexId, parsedCandy);
    }
  }

  if (addToCalcChecked.value) {
    // ボックスに追加して計算機にも反映
    box.onCreateManual({ mode: "toCalc" });
    emit("apply-to-calc");
  } else {
    // ボックスにのみ追加
    box.onCreateManual({ mode: "toBox" });
  }

  // Reset candy input for next add
  addSpeciesCandy.value = "";
}

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const importFavorite = ref(false);

function onFileSelect(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    if (typeof text === "string" && text.length) {
      importText.value = text;
      importStatus.value = t("status.fileLoaded", { name: file.name });
    } else {
      importStatus.value = t("status.fileEmpty");
    }
  };
  reader.onerror = () => {
    importStatus.value = t("status.fileReadError");
  };
  reader.readAsText(file, "UTF-8");
  // 同じファイルを再選択できるようにリセット
  input.value = "";
}

function onPasteEvent(ev: ClipboardEvent) {
  const text = ev.clipboardData?.getData("text/plain");
  if (typeof text === "string" && text.length) {
    ev.preventDefault();
    importText.value = text;
    importStatus.value = t("status.pasted");
  }
}

async function onPasteImport() {
  try {
    if (navigator.clipboard?.readText) {
      const t0 = await navigator.clipboard.readText();
      if (typeof t0 === "string" && t0.length) {
        importText.value = t0;
        importStatus.value = t("status.pasted");
        return;
      }
    }
    importStatus.value = t("status.pasteNotAvailable");
  } catch {
    importStatus.value = t("status.pasteNotAvailable");
  }
}

/* ===== Hint tooltip ===== */
const hintState = ref<{ visible: boolean; message: string; left: number; top: number }>({
  visible: false, message: "", left: 0, top: 0,
});
const hintPopoverRef = ref<HTMLElement | null>(null);

async function showHint(ev: MouseEvent, message: string) {
  const target = ev.target as HTMLElement;
  const rect = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const popoverWidth = 220;
  const gap = 4;

  let left = rect.left;
  if (left + popoverWidth > viewportWidth) left = viewportWidth - popoverWidth - 8;
  if (left < 8) left = 8;

  // まず下に仮配置して描画
  hintState.value = { visible: true, message, left, top: rect.bottom + gap };

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

function handleHintClick(ev: MouseEvent) {
  const target = ev.target as HTMLElement;
  if (target.matches('.link-settings')) {
    ev.preventDefault();
    emit("open-settings");
    closeHint();
  }
}

</script>
