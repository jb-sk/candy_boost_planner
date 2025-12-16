<template>
  <main class="shell">
    <header class="hero">
      <div>
        <p class="kicker">Holiday Candy Boost Planner</p>
        <h1 class="title">CandyBoost Planner</h1>
        <p class="lede">
          複数ポケモンのアメブースト配分を、総アメ・総かけら制約つきでリアルタイムに計画します。
        </p>
      </div>
      <div class="badge">
        <p class="badge__label">MVP</p>
        <p class="badge__value">v0.1</p>
      </div>
    </header>

    <nav class="tabs" aria-label="ページ">
      <button
        class="tab"
        :class="{ 'tab--active': activeTab === 'calc' }"
        type="button"
        @click="activeTab = 'calc'"
      >
        計算機
      </button>
      <button
        class="tab"
        :class="{ 'tab--active': activeTab === 'box' }"
        type="button"
        @click="activeTab = 'box'"
      >
        ポケモンボックス
        <span class="tab__count" v-if="boxEntries.length">{{ boxEntries.length }}</span>
      </button>
    </nav>

    <section class="panel" v-if="activeTab === 'calc'">
      <div class="panel__head">
        <h2 class="panel__title">計算機（MVP）: 入力 → 即時計算</h2>
        <div class="panel__side" v-if="selectedBox">
          <div class="chip">
            <span class="chip__k">選択中</span>
            <span class="chip__v">{{ displayBoxTitle(selectedBox) }}</span>
          </div>
          <button class="btn" type="button" @click="applyCalculatorToBox" title="現在の入力をボックスへ保存">
            計算機→ボックスへ反映
          </button>
        </div>
      </div>
      <div class="grid">
        <label class="field">
          <span class="field__label">現在Lv</span>
          <input v-model.number="srcLevel" type="number" min="1" max="65" class="field__input" />
        </label>
        <label class="field">
          <span class="field__label">目標Lv</span>
          <input v-model.number="dstLevel" type="number" min="1" max="65" class="field__input" />
        </label>
        <label class="field">
          <span class="field__label">あとEXP（次Lvまで）</span>
          <input
            v-model.number="expRemaining"
            type="number"
            min="0"
            class="field__input"
            @input="onExpRemainingInput"
          />
        </label>
        <label class="field">
          <span class="field__label">アメブだけで到達Lv（アメブLv）</span>
          <input
            v-model.number="boostReachLevel"
            type="number"
            :min="srcLevel"
            :max="dstLevel"
            class="field__input"
            @input="onBoostLevelInput"
          />
          <span class="field__sub">
            基本はここを決める（例：目標Lv60 / アメブLv50）。細かい調整は割合/個数で。
          </span>
        </label>
        <label class="field">
          <span class="field__label">アメブ割合（必要EXPに対して）</span>
          <input
            v-model.number="boostRatioPct"
            type="range"
            min="0"
            max="100"
            step="1"
            class="field__range"
            @input="onRatioInput"
          />
          <span class="field__sub">{{ boostRatioPct }}%</span>
        </label>
        <label class="field">
          <span class="field__label">EXPタイプ</span>
          <select v-model.number="expType" class="field__input">
            <option :value="600">600</option>
            <option :value="900">900</option>
            <option :value="1080">1080</option>
            <option :value="1320">1320</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">性格（EXP補正）</span>
          <select v-model="nature" class="field__input">
            <option value="normal">通常</option>
            <option value="up">EXP↑</option>
            <option value="down">EXP↓</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">アメブ種別</span>
          <select v-model="boostKind" class="field__input">
            <option value="full">{{ fullLabel }}</option>
            <option value="mini">{{ miniLabel }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">アメブ個数（表示・手入力）</span>
          <input
            v-model.number="boostCandyInput"
            type="number"
            min="0"
            class="field__input"
            @input="onCandyInput"
          />
          <span class="field__sub">スライダーは経験値割合。個数を直接入力すると割合も追従します。</span>
        </label>
      </div>

      <div class="result">
        <div class="result__row result__row--major">
          <span class="result__k">必要EXP</span>
          <span class="result__v">{{ requiredExp.exp.toLocaleString() }}</span>
        </div>
        <div class="result__row result__row--major">
          <span class="result__k">必要アメ（合計）</span>
          <span class="result__v">{{ (mixed.normalCandy + mixed.boostCandy).toLocaleString() }}</span>
        </div>
        <div class="result__row result__row--major">
          <span class="result__k">必要かけら</span>
          <span class="result__v">{{ mixed.shards.toLocaleString() }}</span>
        </div>
        <div class="result__divider" />
        <div class="result__row">
          <span class="result__k">通常アメ</span>
          <span class="result__v">{{ mixed.normalCandy.toLocaleString() }}</span>
        </div>
        <div class="result__row">
          <span class="result__k">アメブ（使用）</span>
          <span class="result__v">{{ mixed.boostCandy.toLocaleString() }}</span>
        </div>
        <div class="result__row">
          <span class="result__k">かけら内訳</span>
          <span class="result__v">
            通常 {{ mixed.shardsNormal.toLocaleString() }} / アメブ {{ mixed.shardsBoost.toLocaleString() }}
          </span>
        </div>
        <div class="result__row">
          <span class="result__k">アメブだけで到達Lv</span>
          <span class="result__v">{{ boostOnlyFromCandyInput.level }}（expGot {{ boostOnlyFromCandyInput.expGot.toLocaleString() }}）</span>
        </div>
        <div class="result__hint">
          ※ 「あとEXP」はゲーム画面の表示（次Lvまでの残り）を想定し、内部の expGot（獲得済みEXP）に換算しています。
          ※ 計算は nitoyon さんの最新仕様（レベル帯でアメEXPが変化）に合わせています。
          ※ 混在時は「低レベル側から優先的にアメブを使う」前提（MVP）です。
        </div>
      </div>
    </section>

    <section class="panel" v-else>
      <div class="panel__head">
        <h2 class="panel__title">ポケモンボックス</h2>
        <div class="panel__side">
          <button class="btn btn--danger" type="button" @click="onClearBox" :disabled="!boxEntries.length">
            ボックス全消去
          </button>
        </div>
      </div>

      <div class="boxGrid">
        <details class="boxDisclosure">
          <summary class="boxDisclosure__summary">
            <span class="boxDisclosure__title">新規追加</span>
            <span class="boxDisclosure__hint">（名前/レベル/性格EXP/EXPタイプ）</span>
          </summary>
          <div class="boxCard boxCard--inner">
            <p class="boxCard__desc">
              「ポケモン名」から図鑑番号（＋フォーム）を自動判定します。表記名は任意で上書きできます。
            </p>
            <div class="boxAddGrid">
              <label class="field">
                <span class="field__label">ポケモン名（図鑑）</span>
                <div class="suggest">
                  <input
                    v-model="addName"
                    class="field__input"
                    placeholder="例: ピカチュウ / ピカチュウ (ホリデー)"
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
                  判定: {{ getPokemonNameJa(addLookup.pokedexId, addLookup.form) }}（#{{ addLookup.pokedexId }} / EXP{{ addLookup.expType }}）
                </span>
                <span class="field__sub" v-else>一致なし（手入力扱い）</span>
              </label>
              <label class="field">
                <span class="field__label">表記名（任意）</span>
                <input v-model="addLabel" class="field__input" placeholder="例: ピカチュウA / 推し個体" />
              </label>
              <label class="field">
                <span class="field__label">現在Lv</span>
                <input v-model.number="addLevel" type="number" min="1" max="65" class="field__input" />
              </label>
              <label class="field">
                <span class="field__label">性格（EXP補正）</span>
                <select v-model="addNature" class="field__input">
                  <option value="normal">通常</option>
                  <option value="up">EXP↑</option>
                  <option value="down">EXP↓</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">とくい（任意）</span>
                <select v-model="addSpecialty" class="field__input" @change="onAddSpecialtyChanged">
                  <option value="">不明</option>
                  <option value="Berries">きのみ</option>
                  <option value="Ingredients">しょくざい</option>
                  <option value="Skills">スキル</option>
                  <option value="All">オール</option>
                </select>
                <span class="field__sub">名前一致時は自動で入ります（手動で上書き可）。</span>
              </label>
              <label class="field">
                <span class="field__label">EXPタイプ</span>
                <select v-model.number="addExpType" class="field__input" @change="onAddExpTypeChanged">
                  <option :value="600">600</option>
                  <option :value="900">900</option>
                  <option :value="1080">1080</option>
                  <option :value="1320">1320</option>
                </select>
                <span class="field__sub">自動判定される場合でも、ここで上書きできます。</span>
              </label>

              <label class="field">
                <span class="field__label">食材（タイプ）</span>
                <input
                  v-model="addIngredientType"
                  class="field__input"
                  list="ingredientTypeOptions"
                  placeholder="例: ABB"
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
                <span class="field__sub" v-else>ポケモン名が一致すると、候補A/B/Cからプレビューできます。</span>
              </label>

              <label class="field field--wide">
                <span class="field__label">サブスキル（手入力 / 補完）</span>
                <div class="subGrid">
                  <label class="subField">
                    <span class="subField__k">Lv10</span>
                    <input
                      v-model="addSubLv10"
                      class="field__input"
                      :class="{ 'field__input--error': !!addSubErrors['10'] }"
                      list="subSkillOptions"
                      placeholder="例: きのみの数S"
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
                      placeholder="（任意）"
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
                      placeholder="（任意）"
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
                      placeholder="（任意）"
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
                      placeholder="（任意）"
                      @blur="onSubBlur(100)"
                    />
                    <span v-if="addSubErrors['100']" class="field__error">{{ addSubErrors["100"] }}</span>
                  </label>
                </div>
                <datalist id="subSkillOptions">
                  <option v-for="s in SubSkillAllJaSorted" :key="s.nameEn" :value="s.nameJa" />
                </datalist>
                <span class="field__sub">入力は日本語名。保存時に内部英名へ変換します。</span>
              </label>
              <div class="boxAddActions">
                <button class="btn btn--primary" type="button" @click="onCreateManual({ mode: 'toCalc' })">
                  計算機に追加（反映）
                </button>
                <button class="btn" type="button" @click="onCreateManual({ mode: 'toBox' })">
                  ボックスに追加
                </button>
              </div>
            </div>
          </div>
        </details>

        <details class="boxDisclosure">
          <summary class="boxDisclosure__summary">
            <span class="boxDisclosure__title">インポート（にとよん非公式サポート）</span>
            <span class="boxDisclosure__hint">（複数行貼り付け）</span>
          </summary>
          <div class="boxCard boxCard--inner">
            <p class="boxCard__desc">
              1行=1匹（<code>iv</code> または <code>iv@nickname</code>）。食材/サブスキル等の不要データも含めて raw を保持します。
            </p>
            <textarea v-model="importText" class="boxTextarea" rows="7" placeholder="ここに貼り付け（複数行）" />
            <div class="boxCard__actions">
              <button class="btn btn--primary" type="button" @click="onImport">
                取り込み
              </button>
              <button class="btn btn--ghost" type="button" @click="importText = ''">
                クリア
              </button>
              <span class="boxCard__status" v-if="importStatus">{{ importStatus }}</span>
            </div>
          </div>
        </details>

        <div class="boxCard">
          <div class="boxCard__head">
            <h3 class="boxCard__title">一覧</h3>
            <div class="boxCard__tools">
              <input v-model="boxFilter" class="boxSearch" placeholder="検索（ラベル/ID）" />
              <button class="btn btn--ghost" type="button" @click="onClearSelection" :disabled="!selectedBoxId">
                選択解除
              </button>
            </div>
          </div>

          <p class="boxListHint">
            クリックで選択（表示は「名前/レベル」のみ）。選択すると、そのタイルの直下に詳細を表示します。
          </p>

          <div class="boxFilters">
            <div class="boxFilters__row">
              <div class="boxFilters__group">
                <span class="boxFilters__label">条件結合</span>
                <select v-model="filterJoinMode" class="field__input boxFilters__select" aria-label="条件結合">
                  <option value="and">AND（両方）</option>
                  <option value="or">OR（どちらか）</option>
                </select>
              </div>

              <div class="boxFilters__group">
                <span class="boxFilters__label">とくい</span>
                <div class="boxFilters__chips">
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Berries') }"
                    type="button"
                    @click="toggleSpecialty('Berries')"
                  >
                    きのみ
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Ingredients') }"
                    type="button"
                    @click="toggleSpecialty('Ingredients')"
                  >
                    しょくざい
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Skills') }"
                    type="button"
                    @click="toggleSpecialty('Skills')"
                  >
                    スキル
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('All') }"
                    type="button"
                    @click="toggleSpecialty('All')"
                  >
                    オール
                  </button>
                </div>
              </div>
            </div>

            <details class="boxFilters__subskill">
              <summary class="boxFilters__summary">
                <span>サブスキルで絞り込み</span>
                <span class="boxFilters__summaryCount" v-if="selectedSubSkillEns.length">（{{ selectedSubSkillEns.length }}）</span>
              </summary>
              <div class="boxFilters__row boxFilters__row--sub">
                <div class="boxFilters__group">
                  <span class="boxFilters__label">サブスキル結合</span>
                  <select v-model="subSkillJoinMode" class="field__input boxFilters__select" aria-label="サブスキル結合">
                    <option value="or">OR（いずれか）</option>
                    <option value="and">AND（すべて）</option>
                  </select>
                </div>
                <button class="btn btn--ghost" type="button" @click="selectedSubSkillEns = []" :disabled="!selectedSubSkillEns.length">
                  サブスキル選択クリア
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
                  <span class="boxFilters__itemLabel">{{ s.nameJa }}</span>
                </label>
              </div>
            </details>
          </div>

          <div class="boxSortRow">
            <div class="boxSort">
              <select v-model="boxSortKey" class="field__input boxSort__select" aria-label="ソート項目">
                <option value="label">表記名</option>
                <option value="level">レベル</option>
              </select>
              <button class="btn btn--ghost" type="button" @click="boxSortDir = boxSortDir === 'asc' ? 'desc' : 'asc'">
                {{ boxSortDir === 'asc' ? '昇順' : '降順' }}
              </button>
            </div>
          </div>

          <div class="boxList" v-if="sortedBoxEntries.length">
            <template v-for="(e, idx) in sortedBoxEntries" :key="e.id">
              <button
                type="button"
                class="boxTile"
                :class="{ 'boxTile--active': e.id === selectedBoxId }"
                @click="onSelectBox(e.id)"
              >
                <div class="boxTile__name">{{ displayBoxTitle(e) }}</div>
                <div class="boxTile__lv">Lv{{ e.planner?.level ?? e.derived?.level ?? "-" }}</div>
              </button>

              <div
                v-if="idx === detailInsertAfterIndex && selectedBox && selectedDetail"
                class="boxDetail boxDetail--inline"
              >
                <div class="boxDetail__head">
                  <h4 class="boxDetail__title">選択中: {{ displayBoxTitle(selectedBox) }}</h4>
                  <div class="boxDetail__actions">
                    <button class="btn btn--primary" type="button" @click="applyBoxToCalculator">
                      計算機に追加（反映）
                    </button>
                    <button class="btn btn--ghost" type="button" @click="onUndo" :disabled="!canUndo">
                      Undo
                    </button>
                    <button class="btn btn--danger" type="button" @click="onDeleteSelected">
                      削除
                    </button>
                  </div>
                </div>

                <div class="boxDetail__grid">
                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">種族</div>
                    <div class="boxDetail__v">{{ displayPokemonName(selectedBox) ?? selectedBox.label ?? "-" }}</div>
                  </div>
                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">種族リンク</div>
                    <div class="boxDetail__v">
                      <div v-if="selectedBox.derived?.pokedexId">
                        #{{ selectedBox.derived.pokedexId }} / form {{ selectedBox.derived.form }}
                        <span class="boxDetail__minor">（未一致の場合は下で再リンク）</span>
                      </div>
                      <div v-else class="boxDetail__minor">未リンク（pokedexId/formが未確定）</div>
                      <div class="relinkRow suggest">
                        <input
                          v-model="relinkName"
                          class="field__input"
                          placeholder="例: ピカチュウ / ピカチュウ (ホリデー)"
                          @focus="relinkOpen = true"
                          @blur="onRelinkBlur"
                          @input="onRelinkInput"
                        />
                        <button class="btn btn--ghost" type="button" @click="onRelinkApply" :disabled="!relinkName.trim()">
                          再リンク
                        </button>
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
                    </div>
                  </div>
                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">レベル</div>
                    <div class="boxDetail__v">{{ selectedDetail?.level ?? "-" }}</div>
                  </div>
                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">EXPタイプ</div>
                    <div class="boxDetail__v">{{ selectedDetail?.expType ?? "-" }}</div>
                  </div>
                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">性格（EXP補正）</div>
                    <div class="boxDetail__v">
                      {{
                        selectedDetail?.expGainNature === "up"
                          ? "EXP↑"
                          : selectedDetail?.expGainNature === "down"
                            ? "EXP↓"
                            : "通常"
                      }}
                      <span class="boxDetail__minor" v-if="selectedDetail?.decoded?.natureName">
                        （{{ selectedDetail.decoded.natureName }}）
                      </span>
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">とくい</div>
                    <div class="boxDetail__v">
                      <select
                        class="field__input"
                        :value="selectedSpecialtySelectValue"
                        @change="onEditSelectedSpecialty(($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">不明（自動）</option>
                        <option value="Berries">きのみ</option>
                        <option value="Ingredients">しょくざい</option>
                        <option value="Skills">スキル</option>
                        <option value="All">オール</option>
                      </select>
                      <div class="boxDetail__minor">表示: {{ specialtyJa(selectedDetail.specialty) }}</div>
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">食材</div>
                    <div class="boxDetail__v boxDetail__v--mono">
                      <div>タイプ: {{ selectedDetail.ingredientType ?? "-" }}</div>
                      <div v-if="selectedDetail.ingredientSlots">
                        {{ selectedDetail.ingredientSlots.map(toIngredientJa).join(" / ") }}
                      </div>
                      <div v-else>（不明）</div>
                    </div>
                  </div>

                  <div class="boxDetail__kv">
                    <div class="boxDetail__k">サブスキル</div>
                    <div class="boxDetail__v boxDetail__v--mono">
            <div v-if="selectedDetail?.subSkills?.length">
              <div v-for="s in selectedDetail.subSkills" :key="s.lv">
                          Lv{{ s.lv }}: {{ s.nameJa }}
                        </div>
                      </div>
                      <div v-else>（なし/不明）</div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <p class="boxEmpty" v-else>まだ1匹もありません。上でインポートするか、新規追加してください。</p>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, toRaw, watch } from "vue";
import { onMounted, onUnmounted } from "vue";
import type { BoostEvent, ExpGainNature, ExpType } from "./domain";
import { calcExp, calcExpAndCandy, calcExpAndCandyByBoostExpRatio, calcExpAndCandyMixed, calcLevelByCandy } from "./domain/pokesleep";
import { boostRules } from "./domain/pokesleep/boost-config";
import type { BoxSubSkillSlotV1, IngredientType, PokemonBoxEntryV1, PokemonSpecialty } from "./domain/types";
import { decodeNitoyonIvDetail, decodeNitoyonIvMinimal, parseNitoyonBoxLine } from "./domain/box/nitoyon";
import { cryptoRandomId, loadBox, saveBox } from "./persistence/box";
import {
  findPokemonByNameJa,
  getPokemonExpType,
  getPokemonIngredients,
  getPokemonNameJa,
  getPokemonSpecialty,
  pokemonIdFormsByNameJa,
} from "./domain/pokesleep/pokemon-names";
import { IngredientTypes, SubSkillAllJaSorted, SubSkillNameJaByEn, subSkillEnFromJa } from "./domain/box/nitoyon";

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

const ingredientTypeOptions = computed(() => {
  const found = addLookup.value;
  if (!found) return IngredientTypes.map((t) => ({ type: t, preview: "" }));
  const ing = getPokemonIngredients(found.pokedexId, found.form);
  const toJa = (k: string | null) => toIngredientJa(k);
  const a = toJa(ing?.a ?? null);
  const b = toJa(ing?.b ?? null);
  const c = toJa(ing?.c ?? null);
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
  const found = findPokemonByNameJa(relinkName.value);
  if (!found) {
    importStatus.value = "再リンク失敗：名前が一致しません";
    return;
  }
  beginUndoSnapshot();
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
  importStatus.value = "種族リンクを更新しました";
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

type UndoSnapshot = { entries: PokemonBoxEntryV1[]; selectedId: string | null };
const undoSnapshot = ref<UndoSnapshot | null>(null);
const canUndo = computed(() => !!undoSnapshot.value);

function cloneBoxEntries(entries: PokemonBoxEntryV1[]): PokemonBoxEntryV1[] {
  // Vueのreactive配列/オブジェクトはProxyなので、まずtoRawで剥がしてからコピーする
  // （structuredClone(entries) は DataCloneError になりうる）
  const raw = toRaw(entries) as any;
  return JSON.parse(JSON.stringify(raw));
}

function beginUndoSnapshot() {
  undoSnapshot.value = {
    entries: cloneBoxEntries(boxEntries.value),
    selectedId: selectedBoxId.value,
  };
}

function onUndo() {
  const snap = undoSnapshot.value;
  if (!snap) return;
  boxEntries.value = snap.entries;
  selectedBoxId.value = snap.selectedId;
  undoSnapshot.value = null;
  importStatus.value = "Undoしました";
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
  }
);

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

  const hasSpecialtyFilter = selectedSpecialties.value.length > 0;
  const hasSubSkillFilter = selectedSubSkillEns.value.length > 0;
  if (!hasSpecialtyFilter && !hasSubSkillFilter) return base;

  return base.filter((e) => {
    const decoded = getDecodedDetailForEntry(e);

    const pokedexId = e.derived?.pokedexId ?? decoded?.pokedexId ?? null;
    const form = e.derived?.form ?? decoded?.form ?? 0;
    const sp = (e.planner?.specialty ??
      (pokedexId ? getPokemonSpecialty(pokedexId, form) : "unknown")) as PokemonSpecialty;
    const specialtyOk = !hasSpecialtyFilter ? false : selectedSpecialties.value.includes(sp as any);

    const subEns = decoded?.subSkills?.map((s) => s.nameEn) ?? [];
    const subOk = !hasSubSkillFilter
      ? false
      : matchSubSkills(subEns, selectedSubSkillEns.value, subSkillJoinMode.value);

    if (hasSpecialtyFilter && hasSubSkillFilter) {
      return filterJoinMode.value === "and" ? specialtyOk && subOk : specialtyOk || subOk;
    }
    return hasSpecialtyFilter ? specialtyOk : subOk;
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

const sortedBoxEntries = computed(() => {
  const list = [...filteredBoxEntries.value];
  const dir = boxSortDir.value === "asc" ? 1 : -1;
  const key = boxSortKey.value;
  list.sort((a, b) => {
    if (key === "level") {
      const la = a.planner?.level ?? a.derived?.level ?? 0;
      const lb = b.planner?.level ?? b.derived?.level ?? 0;
      if (la !== lb) return (la - lb) * dir;
      return displayBoxTitle(a).localeCompare(displayBoxTitle(b), "ja") * dir;
    }
    return displayBoxTitle(a).localeCompare(displayBoxTitle(b), "ja") * dir;
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

function getIvFromRawText(rawText: string): string | null {
  const t = (rawText ?? "").trim();
  if (!t) return null;
  const at = t.indexOf("@");
  const iv = at === -1 ? t : t.slice(0, at);
  return iv || null;
}

function specialtyJa(sp: PokemonSpecialty | null | undefined): string {
  if (!sp || sp === "unknown") return "不明";
  if (sp === "Berries") return "きのみ";
  if (sp === "Ingredients") return "しょくざい";
  if (sp === "Skills") return "スキル";
  if (sp === "All") return "オール";
  return "不明";
}

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
  const ingredientType = decoded?.ingredientType ?? e.planner?.ingredientType ?? null;
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

const selectedSpecialtySelectValue = computed(() => {
  const manual = selectedBox.value?.planner?.specialty;
  if (manual && manual !== "unknown") return manual;
  const auto = selectedDetail.value?.specialty;
  if (auto && auto !== "unknown") return auto;
  return "";
});

const selectedBox = computed(() => boxEntries.value.find((x) => x.id === selectedBoxId.value) ?? null);

function displayPokemonName(e: PokemonBoxEntryV1): string | null {
  if (!e.derived) return null;
  return getPokemonNameJa(e.derived.pokedexId, e.derived.form);
}

function displayBoxTitle(e: PokemonBoxEntryV1): string {
  const name = displayPokemonName(e);
  const label = (e.label ?? "").trim();
  // labelが空、または "#123" だけのような暫定表示の場合は名前を優先
  if (!label) return name ?? "(no name)";
  if (name && /^#\d+$/.test(label)) return name;
  return label;
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
    importStatus.value = "入力が空です";
    return;
  }
  beginUndoSnapshot();

  const existing = new Set(boxEntries.value.map((e) => e.rawText));
  let added = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  const next: PokemonBoxEntryV1[] = [...boxEntries.value];

  for (const line of lines) {
    const parsed = parseNitoyonBoxLine(line);
    if (!parsed) continue;
    const rawText = parsed.nickname ? `${parsed.iv}@${parsed.nickname}` : parsed.iv;
    if (existing.has(rawText)) {
      skipped++;
      continue;
    }
    const derived0 = decodeNitoyonIvMinimal(parsed.iv);
    const name0 = derived0 ? getPokemonNameJa(derived0.pokedexId, derived0.form) : null;
    const expT0 = derived0 ? getPokemonExpType(derived0.pokedexId, derived0.form) : 600;
    const entry: PokemonBoxEntryV1 = {
      id: cryptoRandomId(),
      source: "nitoyon",
      rawText,
      label: parsed.nickname || name0 || (derived0 ? `#${derived0.pokedexId}` : "(imported)"),
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
    existing.add(rawText);
    added++;
    if (next.length >= 300) break;
  }

  boxEntries.value = next;
  importStatus.value = `取り込み: ${added}件 / スキップ: ${skipped}件`;
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
    const en = subSkillEnFromJa(ja);
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
  const en = subSkillEnFromJa(ja);
  addSubErrors.value[key] = en ? null : "未知のサブスキルです（補完から選ぶと確実です）";
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
  const label = (addLabel.value || addName.value).trim();
  if (!label) {
    importStatus.value = "名前が空です";
    return;
  }
  beginUndoSnapshot();
  const pokedexId = found?.pokedexId ?? 0;
  const form = found?.form ?? 0;
  const speciesName = found ? getPokemonNameJa(pokedexId, form) : null;
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
    label,
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

const srcLevel = ref(10);
const dstLevel = ref(25);
const expRemaining = ref(0);
const expRemainingTouched = ref(false);
const boostRatioPct = ref(0); // 0..100
const boostCandyInput = ref(0); // 表示・手入力用
const boostReachLevel = ref(25);

const expType = ref<ExpType>(600);
const nature = ref<ExpGainNature>("normal");
const boostKind = ref<Exclude<BoostEvent, "none">>("full");

const fullLabel = computed(
  () => `アメブ（かけら×${boostRules.full.shardMultiplier} / EXP×${boostRules.full.expMultiplier}）`
);
const miniLabel = computed(
  () => `ミニブ（かけら×${boostRules.mini.shardMultiplier} / EXP×${boostRules.mini.expMultiplier}）`
);

const expToNextLevel = computed(() => calcExp(srcLevel.value, srcLevel.value + 1, expType.value));

// ゲーム画面の「あとEXP（残り）」→ 現在レベル内で既に得ているEXP（expGot）へ換算
const expGot = computed(() => {
  const toNext = expToNextLevel.value;
  const remaining = Math.max(0, Math.floor(expRemaining.value));
  if (toNext <= 0) return 0;
  // remaining が toNext を超える入力（誤入力）でも破綻しないように 0..toNext へ丸める
  const got = toNext - Math.min(remaining, toNext);
  return Math.max(0, Math.min(got, toNext));
});

function onExpRemainingInput() {
  expRemainingTouched.value = true;
}

// 入力が 100%（次Lvまでの必要EXP）を超えたら、自動で100%に補正する
watch([expRemaining, expToNextLevel], () => {
  const toNext = expToNextLevel.value;
  if (toNext <= 0) return;
  const clamped = Math.max(0, Math.min(Math.floor(expRemaining.value), toNext));
  if (clamped !== expRemaining.value) expRemaining.value = clamped;
});

const isHydratingFromBox = ref(false);

// 初期値＆Lv/EXPタイプ変更時は「次Lvまでの必要EXP（100%）」をデフォルトにする（ただしボックス反映中は触らない）
watch(
  [srcLevel, expType],
  () => {
    if (isHydratingFromBox.value) return;
    expRemainingTouched.value = false;
    const toNext = calcExp(srcLevel.value, srcLevel.value + 1, expType.value);
    expRemaining.value = Math.max(0, toNext);
  },
  { immediate: true }
);

const requiredExp = computed(() =>
  calcExpAndCandy({
    srcLevel: srcLevel.value,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: "none",
    expGot: expGot.value,
  })
);

const boostRatio = computed(() => Math.max(0, Math.min(1, boostRatioPct.value / 100)));

// スライダー（割合）→ アメブ個数へ換算（割合指定の計算）
const byRatio = computed(() =>
  calcExpAndCandyByBoostExpRatio({
    srcLevel: srcLevel.value,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    boostExpRatio: boostRatio.value,
    expGot: expGot.value,
  })
);

// アメブ個数（手入力）で計算（個数指定の計算）
const byCandy = computed(() =>
  calcExpAndCandyMixed({
    srcLevel: srcLevel.value,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    boostCandy: boostCandyInput.value,
    expGot: expGot.value,
  })
);

// 入力は「最後に触った方」を優先して、表示が自然になるようにする
const lastEdited = ref<"ratio" | "candy">("ratio");
const mode = ref<"boostLevel" | "ratio" | "candy">("boostLevel");
function onRatioInput() {
  lastEdited.value = "ratio";
  mode.value = "ratio";
}
function onCandyInput() {
  lastEdited.value = "candy";
  mode.value = "candy";
}
function onBoostLevelInput() {
  mode.value = "boostLevel";
}

// 割合スライダーを動かしたら、アメブ到達Lvも連動して“主入力”にする
watch(
  () => boostRatioPct.value,
  () => {
    if (mode.value !== "ratio") return;
    // 先に個数へ同期（ratio→candy watch）が走る → その後 level を合わせる
    const lvl = boostOnlyFromCandyInput.value.level;
    boostReachLevel.value = Math.max(srcLevel.value, Math.min(dstLevel.value, lvl));
  }
);

const boostReachLevelClamped = computed(() => {
  const min = srcLevel.value;
  const max = dstLevel.value;
  const v = Math.floor(boostReachLevel.value);
  return Math.max(min, Math.min(max, v));
});

// 目標「アメブLv」までをアメブだけで上げ、残りを通常アメで埋める（基本モード）
const byBoostLevel = computed(() => {
  const mid = boostReachLevelClamped.value;

  if (mid <= srcLevel.value) {
    return calcExpAndCandyMixed({
      srcLevel: srcLevel.value,
      dstLevel: dstLevel.value,
      expType: expType.value,
      nature: nature.value,
      boost: "none",
      boostCandy: 0,
      expGot: expGot.value,
    });
  }

  const boostOnlyNeed = calcExpAndCandy({
    srcLevel: srcLevel.value,
    dstLevel: mid,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    expGot: expGot.value,
  });

  const boostSeg = calcExpAndCandyMixed({
    srcLevel: srcLevel.value,
    dstLevel: mid,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    boostCandy: boostOnlyNeed.candy,
    expGot: expGot.value,
  });

  const atMid = calcLevelByCandy({
    srcLevel: srcLevel.value,
    dstLevel: mid,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    candy: boostOnlyNeed.candy,
    expGot: expGot.value,
  });

  const normalSeg = calcExpAndCandyMixed({
    srcLevel: mid,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
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
});

const mixed = computed(() => {
  if (mode.value === "boostLevel") return byBoostLevel.value;
  return lastEdited.value === "ratio" ? byRatio.value : byCandy.value;
});

// 同期: ratio→candy（換算結果を表示に反映）
watch(
  () => byRatio.value.boostCandy,
  (next) => {
    if (mode.value !== "ratio") return;
    boostCandyInput.value = next;
  },
  { immediate: true }
);

// 同期: candy→ratio（実際にアメブで入った経験値を、必要EXPで割って割合に戻す）
watch(
  () => byCandy.value,
  (r) => {
    if (mode.value !== "candy") return;
    const base = requiredExp.value.exp;
    const pct = base > 0 ? Math.round((r.expBoostApplied / base) * 100) : 0;
    boostRatioPct.value = Math.max(0, Math.min(100, pct));
  }
);

// 基本モード（アメブLv指定）のときは、表示用のアメブ個数・割合を自動で合わせる
watch(
  () => byBoostLevel.value,
  (r) => {
    if (mode.value !== "boostLevel") return;
    boostCandyInput.value = r.boostCandy;
    const base = requiredExp.value.exp;
    const pct = base > 0 ? Math.round((r.expBoostApplied / base) * 100) : 0;
    boostRatioPct.value = Math.max(0, Math.min(100, pct));
  },
  { immediate: true }
);

// 現在の「アメブ個数（表示・手入力）」で、アメブだけでどこまで上げられるか
const boostOnlyFromCandyInput = computed(() =>
  calcLevelByCandy({
    srcLevel: srcLevel.value,
    dstLevel: dstLevel.value,
    expType: expType.value,
    nature: nature.value,
    boost: boostKind.value,
    candy: boostCandyInput.value,
    expGot: expGot.value,
  })
);

// 割合/個数を触ったときは、到達Lvも追従させる（＝3つ連動）
watch(
  () => boostOnlyFromCandyInput.value.level,
  (lvl) => {
    if (mode.value === "boostLevel") return;
    boostReachLevel.value = Math.max(srcLevel.value, Math.min(dstLevel.value, lvl));
  },
  { immediate: true }
);

function applyBoxToCalculator() {
  const e = selectedBox.value;
  if (!e) return;

  const lvl = e.planner?.level ?? e.derived?.level ?? 10;
  const expT = e.planner?.expType ?? e.derived?.expType ?? 600;
  const nat = e.planner?.expGainNature ?? e.derived?.expGainNature ?? "normal";

  isHydratingFromBox.value = true;
  srcLevel.value = Math.max(1, Math.min(65, Math.floor(lvl)));
  expType.value = expT as ExpType;
  nature.value = nat as ExpGainNature;

  // dst/boostは「そのまま維持」でもいいが、整合だけとる
  dstLevel.value = Math.max(srcLevel.value, Math.min(65, Math.floor(dstLevel.value)));
  boostReachLevel.value = Math.max(srcLevel.value, Math.min(dstLevel.value, Math.floor(boostReachLevel.value)));

  const toNext = calcExp(srcLevel.value, srcLevel.value + 1, expType.value);
  const remaining =
    e.planner?.expRemaining !== undefined && Number.isFinite(e.planner.expRemaining)
      ? Math.max(0, Math.min(Math.floor(e.planner.expRemaining), toNext))
      : toNext;
  expRemaining.value = remaining;
  expRemainingTouched.value = e.planner?.expRemaining !== undefined;

  mode.value = "boostLevel";
  nextTick(() => {
    isHydratingFromBox.value = false;
    activeTab.value = "calc";
  });
}

function applyCalculatorToBox() {
  const e = selectedBox.value;
  if (!e) return;
  beginUndoSnapshot();
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return {
      ...x,
      planner: {
        ...(x.planner ?? {}),
        level: srcLevel.value,
        expRemaining: expRemaining.value,
        expType: expType.value,
        expGainNature: nature.value,
      },
      updatedAt: now,
    };
  });
  importStatus.value = "計算機の値をボックスへ保存しました";
}

function onDeleteSelected() {
  const e = selectedBox.value;
  if (!e) return;
  const ok = confirm(`削除しますか？\n${e.label || e.rawText}`);
  if (!ok) return;
  beginUndoSnapshot();
  boxEntries.value = boxEntries.value.filter((x) => x.id !== e.id);
  selectedBoxId.value = null;
}

function onClearBox() {
  const n = boxEntries.value.length;
  if (n === 0) return;
  const ok = confirm(
    `ポケモンボックスを全消去しますか？\n` +
      `登録: ${n}匹\n\n` +
      `※ この操作は取り消せません。`
  );
  if (!ok) return;
  beginUndoSnapshot();
  boxEntries.value = [];
  selectedBoxId.value = null;
  boxFilter.value = "";
  selectedSpecialties.value = [];
  selectedSubSkillEns.value = [];
  importStatus.value = "ボックスを全消去しました";
}

function onEditSelectedSpecialty(v: string) {
  const e = selectedBox.value;
  if (!e) return;
  beginUndoSnapshot();
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
  importStatus.value = "とくいを更新しました";
}
</script>

<style scoped>
.shell {
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 18px 64px;
}
.hero {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 18px;
  align-items: start;
  margin-top: 16px;
  margin-bottom: 22px;
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
  max-width: 62ch;
}
.badge {
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 88%, var(--accent) 12%);
  border-radius: 16px;
  padding: 12px 14px;
  min-width: 96px;
}
.badge__label {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
  margin: 0 0 4px;
}
.badge__value {
  font-family: var(--font-heading);
  font-weight: 800;
  margin: 0;
}
.panel {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 96%, var(--ink) 4%);
  border-radius: 18px;
  padding: 18px 18px;
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
.field {
  display: grid;
  gap: 6px;
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
  background: color-mix(in oklab, var(--paper) 95%, var(--ink) 5%);
  margin: 10px 0 14px;
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
  background: color-mix(in oklab, var(--paper) 90%, var(--accent) 10%);
  color: var(--ink);
  box-shadow: 0 1px 0 color-mix(in oklab, var(--ink) 10%, transparent);
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

.btn {
  font: inherit;
  cursor: pointer;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  padding: 10px 12px;
  border-radius: 12px;
}
.btn:hover {
  border-color: color-mix(in oklab, var(--ink) 26%, transparent);
}
.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn--primary {
  border-color: color-mix(in oklab, var(--accent) 40%, transparent);
  background: color-mix(in oklab, var(--accent) 18%, var(--paper) 82%);
}
.btn--ghost {
  background: transparent;
}
.btn--danger {
  border-color: color-mix(in oklab, #b10 35%, transparent);
  background: color-mix(in oklab, #b10 10%, var(--paper) 90%);
}

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
}
.boxSort__select {
  padding: 10px 12px;
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
.boxAddActions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  align-items: end;
  gap: 10px;
  flex-wrap: wrap;
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
  flex-wrap: wrap;
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
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  outline: none;
  min-width: 220px;
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
.boxTile {
  width: 100%;
  text-align: left;
  cursor: pointer;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  border-radius: 14px;
  padding: 12px 12px;
  display: grid;
  gap: 8px;
  min-height: 76px;
}
.boxTile:hover {
  border-color: color-mix(in oklab, var(--ink) 26%, transparent);
}
.boxTile--active {
  border-color: color-mix(in oklab, var(--accent) 52%, transparent);
  background: color-mix(in oklab, var(--accent) 12%, var(--paper) 88%);
}
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
  justify-content: space-between;
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
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  padding: 8px 10px;
  border-radius: 999px;
}
.chipBtn:hover {
  border-color: color-mix(in oklab, var(--ink) 26%, transparent);
}
.chipBtn--on {
  border-color: color-mix(in oklab, var(--accent) 52%, transparent);
  background: color-mix(in oklab, var(--accent) 14%, var(--paper) 86%);
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
  justify-content: flex-end;
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
  }
}
.boxDetail__kv {
  border: 1px solid color-mix(in oklab, var(--ink) 12%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  border-radius: 14px;
  padding: 10px 12px;
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
