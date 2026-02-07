<template>
  <section id="neo-box" class="panel panel--box">
    <div class="panel__head">
      <h2 class="panel__title">{{ t("box.title") }}</h2>
      <div class="panel__side">
        <button class="btn btn--danger" type="button" data-testid="box-clear-all" @click="box.onClearBox" :disabled="!boxEntries.length">
          {{ t("box.clearAll") }}
        </button>
      </div>
    </div>

    <div class="boxGrid">
      <details class="boxDisclosure" data-testid="box-add-panel">
        <summary class="boxDisclosure__head" data-testid="box-add-summary">
          <span class="boxDisclosure__title">{{ t("box.addNew") }}</span>
        </summary>
        <div class="boxCard boxDisclosure__inner">
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
                    name: getPokemonNameLocalized(addLookup.pokedexId, addLookup.form, locale as any),
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
              <LevelPicker v-model="addLevel" :label="t('box.detail.level')" :max="MAX_LEVEL" />
            </div>
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
              <button class="btn btn--primary" type="button" data-testid="box-add-submit" @click="onCreateToBox($event)">
                {{ t("box.add.toBox") }}
              </button>
            </div>
          </div>
        </div>
      </details>

      <details class="boxDisclosure" data-testid="box-import-panel">
        <summary class="boxDisclosure__head" data-testid="box-import-summary">
          <span class="boxDisclosure__title">{{ t("box.import.title") }}</span>
        </summary>
        <div class="boxCard boxDisclosure__inner">
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
            <button class="btn btn--primary" type="button" data-testid="box-import-submit" @click="box.onImport({ markFavorite: importFavorite })">
              {{ t("box.import.run") }}
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
          <input v-model="boxFilter" class="boxSearch" data-testid="box-search-input" :placeholder="t('box.list.searchPh')" />
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
        <details class="boxAdvanced" data-testid="box-advanced-panel">
          <summary class="boxAdvanced__summary" data-testid="box-advanced-summary">
            <span>{{ t("box.list.advancedSettings") }}</span>
          </summary>
          <div class="boxAdvanced__content">
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
                <button
                  class="btn btn--ghost btn--sm"
                  type="button"
                  data-testid="box-subskill-clear"
                  @click="selectedSubSkillEns = []"
                  :disabled="!selectedSubSkillEns.length"
                >
                  {{ t("box.list.subskillClear") }}
                </button>
              </div>
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
          <div class="boxSortRow__left">
            <button class="btn btn--ghost" type="button" data-testid="box-undo" @click="box.onUndo" :disabled="!canUndo" :title="t('box.list.undoTitle')">
              {{ t("common.undo") }}
            </button>
            <button class="btn btn--ghost" type="button" data-testid="box-redo" @click="box.onRedo" :disabled="!canRedo">
              {{ t("common.redo") }}
            </button>
          </div>
          <div class="boxSort">
            <select v-model="boxSortKey" class="field__input boxSort__select" :aria-label="t('box.list.sortKeyAria')">
              <option value="labelFav">{{ t("box.list.sortLabelFav") }}</option>
              <option value="levelFav">{{ t("box.list.sortLevelFav") }}</option>
              <option value="dexFav">{{ t("box.list.sortDexFav") }}</option>
              <option value="label">{{ t("box.list.sortLabel") }}</option>
              <option value="level">{{ t("box.list.sortLevel") }}</option>
              <option value="dex">{{ t("box.list.sortDex") }}</option>
            </select>
            <button
              class="btn btn--ghost"
              :class="{ 'btn--primary': boxSortDir === 'asc' }"
              type="button"
              @click="box.applySort('asc')"
            >
              {{ t("box.list.sortAsc") }}
            </button>
            <button
              class="btn btn--ghost"
              :class="{ 'btn--primary': boxSortDir === 'desc' }"
              type="button"
              @click="box.applySort('desc')"
            >
              {{ t("box.list.sortDesc") }}
            </button>
          </div>
        </div>

        <div class="boxList" v-if="sortedBoxEntries.length">
          <template v-for="(e, idx) in sortedBoxEntries" :key="e.id">
            <button
              type="button"
              class="boxTile"
              data-testid="box-tile"
              :class="[box.boxTileTypeClass(e), { 'boxTile--active': e.id === selectedBoxId }]"
              :data-type="e.derived ? getPokemonType(e.derived.pokedexId, e.derived.form) : 'unknown'"
              @click="box.onSelectBox(e.id)"
            >
              <div class="boxTile__name">{{ box.displayBoxTitle(e) }}</div>
              <div class="boxTile__lv">
                Lv{{ e.planner?.level ?? e.derived?.level ?? "-" }}
                <span v-if="e.favorite" class="boxTile__fav" :aria-label="t('box.list.favorite')" :title="t('box.list.favorite')" v-html="iconStarSvg"></span>
              </div>
            </button>

            <div v-if="idx === detailInsertAfterIndex && selectedBox && selectedDetail" class="boxDetail boxDetail--inline" data-testid="box-detail-panel">
              <div class="boxDetail__head">
                <h4 class="boxDetail__title">{{ t("box.list.selected", { name: box.displayBoxTitle(selectedBox) }) }}</h4>
                <div class="boxDetail__actions">
                  <button class="btn btn--primary" type="button" data-testid="box-detail-calc" @click="$emit('apply-to-calc', $event)">
                    {{ t("box.add.toCalc") }}
                  </button>
                  <button class="btn btn--danger" type="button" data-testid="box-detail-delete" @click="box.onDeleteSelected">
                    {{ t("box.deleteFromBox") }}
                  </button>
                </div>
              </div>

              <div class="boxDetail__grid">
                <div class="boxDetail__col">
                  <div class="boxDetail__kv">
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
                              name: getPokemonNameLocalized(relinkFound.pokedexId, relinkFound.form, locale as any),
                              id: relinkFound.pokedexId,
                              expType: relinkFound.expType,
                            })
                          }}
                        </div>
                        <div class="boxDetail__minor" v-else-if="relinkName.trim()">{{ t("box.detail.relinkNoCandidate") }}</div>
                        <div v-if="relinkOpen && relinkSuggestList.length" class="suggest__panel" data-testid="box-detail-relink-suggest-panel" role="listbox">
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

                  <div class="boxDetail__kv">
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
                  <div class="boxDetail__kv" v-if="selectedDetail?.pokedexId">
                    <div class="boxDetail__k">{{ t("calc.row.speciesCandy") }}</div>
                    <div class="boxDetail__v">
                      <input
                        type="number"
                        min="0"
                        class="field__input"
                        data-testid="box-detail-candy-input"
                        :value="candyStore.getSpeciesCandyFor(selectedDetail.pokedexId)"
                        @input="candyStore.updateSpeciesCandy(selectedDetail!.pokedexId, parseInt(($event.target as HTMLInputElement).value) || 0)"
                      />
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">{{ t("box.detail.level") }}</div>
                    <div class="boxDetail__v">
                      <div class="levelPick">
                        <LevelPicker
                          :model-value="selectedDetail?.level ?? 1"
                          @update:model-value="box.setBoxLevel($event)"
                          :label="t('box.detail.level')"
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
                  </div>
                </div>

                <div class="boxDetail__col">
                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">{{ t("box.detail.ingredients") }}</div>
                    <div class="boxDetail__v boxDetail__v--mono">
                      <div class="boxDetail__editRow">
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
                      <div v-if="selectedDetail.ingredientSlots" class="boxDetail__ingredientsList">
                        {{ selectedDetail.ingredientSlots.map(box.toIngredientLabel).join(" / ") }}
                      </div>
                      <div v-else class="boxDetail__ingredientsList">{{ t("box.detail.unknown") }}</div>
                    </div>
                  </div>

                  <div class="boxDetail__kv">
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
  </section>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { localizeNature } from "../i18n/terms";
import { IngredientTypes } from "../domain/box/nitoyon";
import { getPokemonType } from "../domain/pokesleep/pokemon-names";
import { getPokemonNameLocalized } from "../domain/pokesleep/pokemon-name-localize";
import { useCandyStore } from "../composables/useCandyStore";
import NatureSelect from "./NatureSelect.vue";

import type { BoxStore } from "../composables/useBoxStore";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";

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
const candyStore = useCandyStore();

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
const canRedo = box.canRedo;
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

import { ref } from "vue";
import LevelPicker from "./LevelPicker.vue";
const addToCalcChecked = ref(true);

function onCreateToBox(ev: MouseEvent) {
  if (addToCalcChecked.value) {
    // ボックスに追加して計算機にも反映
    box.onCreateManual({ mode: "toCalc" });
    emit("apply-to-calc", ev);
  } else {
    // ボックスにのみ追加
    box.onCreateManual({ mode: "toBox" });
  }
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav: any = navigator as any;
    if (nav?.clipboard?.readText) {
      const t0 = await nav.clipboard.readText();
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
</script>

<style src="./BoxPanel.css"></style>
