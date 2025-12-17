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
        <h2 class="panel__title">計算機: 複数ポケモン（目標Lvベース）</h2>
        <div class="panel__side" v-if="activeCalcRow && activeCalcRow.boxId">
          <div class="chip">
            <span class="chip__k">編集中</span>
            <span class="chip__v">{{ activeCalcRow.title }}</span>
          </div>
          <button class="btn" type="button" @click="applyCalculatorToBox" title="編集内容（現在Lv/あとEXP/EXPタイプ/性格補正）をボックスへ保存">
            ボックスへ反映
          </button>
        </div>
      </div>
      <div class="calcTop">
        <div class="calcTop__grid">
          <label class="field">
            <span class="field__label">最大かけら（上限チェック）</span>
            <input v-model.number="totalShards" type="number" min="0" class="field__input" />
            <span class="field__sub">超過しても計算は継続し、超過分を赤字で表示します。</span>
          </label>
          <label class="field">
            <span class="field__label">アメブ種別</span>
            <select v-model="boostKind" class="field__input">
              <option value="full">{{ fullLabel }}</option>
              <option value="mini">{{ miniLabel }}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="calcSticky">
        <div class="calcSticky__summary">
          <div class="calcSum calcSum--hi">
            <div class="calcSum__k">合計かけら</div>
            <div class="calcSum__v">{{ calcTotalShardsUsed.toLocaleString() }}</div>
          </div>
          <div class="calcSum calcSum--hi" :class="{ 'calcSum--danger': calcShardsOver > 0 }">
            <div class="calcSum__k">{{ calcShardsOver > 0 ? "超過" : "残り" }}</div>
            <div class="calcSum__v">{{ (calcShardsOver > 0 ? calcShardsOver : -calcShardsOver).toLocaleString() }}</div>
          </div>
        </div>
        <div
          class="calcSum calcSum--bar calcSum--sparkle"
          :class="{
            'calcSum--danger': calcShardsOver > 0,
            'calcSum--muted': calcShardsCap <= 0,
          }"
        >
          <div class="calcSum__head">
            <div class="calcSum__k">
              {{ calcShardsCap > 0 ? `かけら使用 ${calcShardsUsagePctRounded}%` : "かけら使用 -" }}
              <span v-if="showShardsFire" aria-hidden="true"> 🔥</span>
            </div>
            <div class="calcSum__k calcSum__k--right">
              {{ calcShardsCap > 0 ? `上限 ${calcShardsCap.toLocaleString()}` : "上限 未設定" }}
            </div>
          </div>
          <div
            class="calcBar"
            role="progressbar"
            :aria-valuenow="Math.max(0, calcTotalShardsUsed)"
            aria-valuemin="0"
            :aria-valuemax="Math.max(1, calcShardsCap)"
            :aria-label="calcShardsCap > 0 ? `かけら使用 ${calcShardsUsagePctRounded}% / 上限 ${calcShardsCap.toLocaleString()}` : 'かけら上限 未設定'"
          >
            <div class="calcBar__track">
              <div class="calcBar__fill" :style="{ width: `${calcShardsUsedPctForBar}%` }"></div>
              <div
                v-if="calcShardsOver > 0 && calcShardsCap > 0"
                class="calcBar__over"
                :style="{ width: `${calcShardsOverPctForBar}%` }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div class="calcActions">
        <button class="btn btn--danger" type="button" @click="onCalcClear" :disabled="!calcRowsView.length">
          ポケモンをクリア
        </button>
        <button class="btn btn--primary" type="button" @click="openCalcExport" :disabled="!calcRowsView.length">
          結果を1枚にまとめる
        </button>
        <button class="btn btn--ghost" type="button" @click="onCalcUndo" :disabled="!canCalcUndo">
          Undo
        </button>
        <button class="btn btn--ghost" type="button" @click="onCalcRedo" :disabled="!canCalcRedo">
          Redo
        </button>
      </div>

      <div class="calcSlots">
        <div v-for="i in 3" :key="i" class="calcSlot" :class="{ 'calcSlot--empty': !calcSlots[i - 1] }">
          <div class="calcSlot__head">
            <div class="calcSlot__label">スロット{{ i }}</div>
            <div class="calcSlot__state">{{ calcSlots[i - 1] ? formatCalcSlotSavedAt(calcSlots[i - 1]?.savedAt) : "空" }}</div>
          </div>
          <div class="calcSlot__actions">
            <button class="btn btn--ghost btn--xs" type="button" @click="onCalcSlotLoad(i - 1)" :disabled="!calcSlots[i - 1]">
              読み込む
            </button>
            <button class="btn btn--xs" type="button" @click="onCalcSlotSave(i - 1)" :disabled="!calcRowsView.length">
              保存
            </button>
            <button class="btn btn--ghost btn--xs" type="button" @click="onCalcSlotDelete(i - 1)" :disabled="!calcSlots[i - 1]">
              削除
            </button>
          </div>
        </div>
      </div>

      <p class="calcHint">
        追加方法: ポケモンボックスの詳細で <strong>「計算機に追加（反映）」</strong> を押すと、このリストに追加されます。
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
                title="ドラッグして並び替え"
                aria-label="ドラッグして並び替え"
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
              <button class="btn btn--ghost btn--xs" type="button" @click.stop="moveCalcRowUp(r.id)" :disabled="!canMoveCalcRowUp(r.id)">
                ↑
              </button>
              <button class="btn btn--ghost btn--xs" type="button" @click.stop="moveCalcRowDown(r.id)" :disabled="!canMoveCalcRowDown(r.id)">
                ↓
              </button>
              <button class="btn btn--danger btn--xs" type="button" @click.stop="onCalcRemoveRow(r.id)">削除</button>
            </div>
          </div>

          <div class="calcRow__grid">
            <label class="field field--sm">
              <span class="field__label">現在Lv</span>
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
                  aria-label="現在Lvの選択"
                >
                  <div class="levelPick__top">
                    <div class="levelPick__title">現在Lv</div>
                    <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="closeLevelPick()">
                      閉じる
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
              <span class="field__label">目標Lv</span>
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
                  aria-label="目標Lvの選択"
                >
                  <div class="levelPick__top">
                    <div class="levelPick__title">Lv{{ r.srcLevel }} → Lv{{ r.dstLevel }}</div>
                    <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="closeLevelPick()">
                      閉じる
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
              <span class="field__label">あとEXP（次Lvまで）</span>
              <input
                :value="r.expRemaining"
                type="number"
                min="0"
                class="field__input"
                @input="onCalcRowExpRemaining(r.id, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="field field--sm">
              <span class="field__label">EXPタイプ</span>
              <div class="field__input field__input--static" title="EXPタイプは種族固定のため編集できません。">
                {{ r.expType }}
              </div>
            </label>
            <label class="field field--sm">
              <span class="field__label">性格（EXP補正）</span>
              <select :value="r.nature" class="field__input" @change="onCalcRowNature(r.id, ($event.target as HTMLSelectElement).value)">
                <option value="normal">通常</option>
                <option value="up">EXP↑</option>
                <option value="down">EXP↓</option>
              </select>
            </label>

            <label class="field field--sm">
              <span class="field__label">アメブ目標Lv</span>
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
              <span class="field__label">経験値に対するアメブ割合</span>
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
              <span class="field__label">アメブ個数</span>
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
              <span class="calcRow__k">かけら</span>
              <span class="calcRow__v"><span class="calcRow__num">{{ r.result.shards.toLocaleString() }}</span></span>
            </div>
            <div class="calcRow__res">
              <span class="calcRow__k">アメ（合計）</span>
              <span class="calcRow__v"><span class="calcRow__num">{{ (r.result.normalCandy + r.result.boostCandy).toLocaleString() }}</span></span>
            </div>
            <div class="calcRow__res">
              <span class="calcRow__k">内訳</span>
              <span class="calcRow__v">
                アメブ<span class="calcRow__num">{{ r.result.boostCandy.toLocaleString() }}</span> /
                通常<span class="calcRow__num">{{ r.result.normalCandy.toLocaleString() }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <p class="boxEmpty" v-else>まだ計算対象がありません。ポケモンボックスから追加してください。</p>

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
                <select v-model.number="addExpType" class="field__input" :disabled="!!addLookup" @change="onAddExpTypeChanged">
                  <option :value="600">600</option>
                  <option :value="900">900</option>
                  <option :value="1080">1080</option>
                  <option :value="1320">1320</option>
                </select>
                <span class="field__sub">
                  {{ addLookup ? "名前一致時は自動設定（編集不可）" : "一致なしのときのみ手動設定できます" }}
                </span>
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
              <button class="btn btn--ghost" type="button" @click="boxFilter = ''" :disabled="!boxFilter.trim()">
                検索クリア
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
                <span class="boxFilters__label">お気に入り</span>
                <div class="boxFilters__chips">
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': favoritesOnly }"
                    type="button"
                    @click="favoritesOnly = !favoritesOnly"
                    title="★お気に入りのみ"
                    aria-label="お気に入りのみ"
                  >
                    <span class="chipBtn__icon" v-html="iconStarSvg" aria-hidden="true"></span>
                  </button>
                </div>
              </div>

              <div class="boxFilters__group">
                <span class="boxFilters__label">とくい</span>
                <div class="boxFilters__chips">
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Berries') }"
                    type="button"
                    @click="toggleSpecialty('Berries')"
                    aria-label="とくい: きのみ"
                  >
                    <span class="chipBtn__icon" v-html="iconBerrySvg" aria-hidden="true"></span>
                    <span class="chipBtn__text">きのみ</span>
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Ingredients') }"
                    type="button"
                    @click="toggleSpecialty('Ingredients')"
                    aria-label="とくい: しょくざい"
                  >
                    <span class="chipBtn__icon" v-html="iconIngredientsSvg" aria-hidden="true"></span>
                    <span class="chipBtn__text">しょくざい</span>
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('Skills') }"
                    type="button"
                    @click="toggleSpecialty('Skills')"
                    aria-label="とくい: スキル"
                  >
                    <span class="chipBtn__icon" v-html="iconSkillsSvg" aria-hidden="true"></span>
                    <span class="chipBtn__text">スキル</span>
                  </button>
                  <button
                    class="chipBtn"
                    :class="{ 'chipBtn--on': selectedSpecialties.includes('All') }"
                    type="button"
                    @click="toggleSpecialty('All')"
                    aria-label="とくい: オール"
                  >
                    <span class="chipBtn__icon" v-html="iconAllSvg" aria-hidden="true"></span>
                    <span class="chipBtn__text">オール</span>
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
            <div class="boxSortRow__left">
              <button class="btn btn--ghost" type="button" @click="onUndo" :disabled="!canUndo" title="直前の変更を取り消し">
                Undo
              </button>
            </div>
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
                :class="[boxTileTypeClass(e), { 'boxTile--active': e.id === selectedBoxId }]"
                :data-type="e.derived ? getPokemonType(e.derived.pokedexId, e.derived.form) : 'unknown'"
                @click="onSelectBox(e.id)"
              >
                <div class="boxTile__name">{{ displayBoxTitle(e) }}</div>
                <div class="boxTile__lv">
                  Lv{{ e.planner?.level ?? e.derived?.level ?? "-" }}
                  <span v-if="e.favorite" class="boxTile__fav" aria-label="お気に入り" title="お気に入り">★</span>
                </div>
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
                    <button class="btn btn--danger" type="button" @click="onDeleteSelected">
                      削除
                    </button>
                  </div>
                </div>

                <div class="boxDetail__grid">
                  <div class="boxDetail__col">
                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">ニックネーム</div>
                      <div class="boxDetail__v">
                        <input
                          class="field__input"
                          :value="selectedBox.label ?? ''"
                          :placeholder="displayPokemonName(selectedBox) ?? '（任意）'"
                          @change="onEditSelectedLabel(($event.target as HTMLInputElement).value)"
                        />
                        <div class="boxDetail__minor">空にすると種族名表示に戻ります</div>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">種族（リンク）</div>
                      <div class="boxDetail__v">
                        <div>
                          <span class="boxDetail__strong">{{ displayPokemonName(selectedBox) ?? "未リンク" }}</span>
                          <span class="boxDetail__minor" v-if="selectedBox.derived?.pokedexId">（図鑑No.{{ selectedBox.derived.pokedexId }}）</span>
                          <span class="boxDetail__minor" v-else>（必要なら下で再リンク）</span>
                        </div>

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
                          <div class="boxDetail__minor" v-if="relinkFound">
                            候補: {{ getPokemonNameJa(relinkFound.pokedexId, relinkFound.form) }}（#{{ relinkFound.pokedexId }} / EXP{{ relinkFound.expType }}）
                          </div>
                          <div class="boxDetail__minor" v-else-if="relinkName.trim()">候補なし</div>
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
                      <div class="boxDetail__k">レベル</div>
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

                          <div v-if="openBoxLevelPick" class="levelPick__popover" role="dialog" aria-label="現在Lvの選択">
                            <div class="levelPick__top">
                              <div class="levelPick__title">現在Lv</div>
                              <button class="btn btn--ghost btn--xs" type="button" @mousedown.stop.prevent @click.stop.prevent="closeBoxLevelPick()">
                                閉じる
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
                      <div class="boxDetail__k">EXPタイプ</div>
                      <div class="boxDetail__v">
                        <div
                          v-if="(selectedDetail?.pokedexId ?? 0) > 0"
                          class="field__input field__input--static"
                          title="EXPタイプは種族固定のため編集できません。"
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
                          （種族不明のため仮設定）
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
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">性格（EXP補正）</div>
                      <div class="boxDetail__v">
                        <select
                          class="field__input"
                          :value="selectedDetail?.expGainNature ?? 'normal'"
                          @change="onEditSelectedNature(($event.target as HTMLSelectElement).value)"
                        >
                          <option value="normal">通常</option>
                          <option value="up">EXP↑</option>
                          <option value="down">EXP↓</option>
                        </select>
                        <span class="boxDetail__minor" v-if="selectedDetail?.decoded?.natureName">
                          （{{ selectedDetail.decoded.natureName }}）
                        </span>
                      </div>
                    </div>
                  </div>

                  <div class="boxDetail__col">
                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">食材</div>
                      <div class="boxDetail__v boxDetail__v--mono">
                        <div class="boxDetail__editRow">
                          <select
                            class="field__input"
                            :value="selectedDetail.ingredientType ?? ''"
                            @change="onEditSelectedIngredientType(($event.target as HTMLSelectElement).value)"
                          >
                            <option value="">不明（自動）</option>
                            <option v-for="t in IngredientTypes" :key="t" :value="t">{{ t }}</option>
                          </select>
                        </div>
                        <div v-if="selectedDetail.ingredientSlots">
                          {{ selectedDetail.ingredientSlots.map(toIngredientJa).join(" / ") }}
                        </div>
                        <div v-else>（不明）</div>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">サブスキル</div>
                      <div class="boxDetail__v boxDetail__v--mono">
                        <div class="boxDetail__subEdit">
                          <div v-for="lv in [10, 25, 50, 75, 100]" :key="lv" class="subField">
                            <span class="subField__k">Lv{{ lv }}</span>
                            <input
                              :value="boxEditSubInputs[String(lv)] ?? ''"
                              class="field__input"
                              :class="{ 'field__input--error': !!boxEditSubErrors[String(lv)] }"
                              list="subSkillOptions"
                              placeholder="（任意）"
                              @input="onBoxEditSubInput(lv, ($event.target as HTMLInputElement).value)"
                              @blur="onBoxEditSubBlur(lv)"
                            />
                            <span v-if="boxEditSubErrors[String(lv)]" class="field__error">{{ boxEditSubErrors[String(lv)] }}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="boxDetail__kv">
                      <div class="boxDetail__k">お気に入り</div>
                      <div class="boxDetail__v">
                        <button class="chipBtn" :class="{ 'chipBtn--on': !!selectedBox.favorite }" type="button" @click="toggleSelectedFavorite">
                          <span class="chipBtn__icon" v-html="iconStarSvg" aria-hidden="true"></span>
                        </button>
                      </div>
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

    <!-- 1枚出力（スクショ用）: calc/boxタブに依存せず表示できるように main 直下へ -->
    <div v-if="calcExportOpen" class="exportOverlay" @click.self="closeCalcExport" role="dialog" aria-label="計算結果を1枚にまとめる">
      <div class="exportSheetWrap">
        <div
          ref="exportSheetEl"
          class="exportSheet"
          :class="{ 'exportSheet--capture': exportBusy }"
          :style="{ transform: exportBusy ? 'none' : `scale(${calcExportScale})` }"
        >
          <div class="exportHead">
            <div>
              <div class="exportBrand">CandyBoost Planner</div>
              <div class="exportTitle">ホリデーアメブ計画シート</div>
            </div>
            <div class="exportActions">
              <button class="btn btn--primary btn--xs" type="button" @click="downloadCalcExportPng" :disabled="exportBusy">
                画像で保存
              </button>
              <button class="btn btn--ghost btn--xs" type="button" @click="closeCalcExport" :disabled="exportBusy">閉じる</button>
            </div>
          </div>
          <div v-if="exportStatus" class="exportStatus" role="status">{{ exportStatus }}</div>

          <table class="exportTable">
            <colgroup>
              <col class="col-name" />
              <col class="col-exp" />
              <col class="col-lv" />
              <col class="col-lv" />
              <col class="col-num" />
              <col class="col-num" />
              <col class="col-num" />
              <col class="col-shards" />
            </colgroup>
            <thead>
              <tr>
                <th>ポケモン</th>
                <th class="ta-c">EXP補正</th>
                <th class="ta-r">現在</th>
                <th class="ta-r">目標</th>
                <th class="ta-r">アメブ</th>
                <th class="ta-r">通常</th>
                <th class="ta-r">合計</th>
                <th class="ta-r">かけら</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in calcExportRows" :key="row.id">
                <td class="exportName">{{ row.title }}</td>
                <td class="ta-c">{{ row.natureLabel }}</td>
                <td class="ta-r">{{ row.srcLevel }}</td>
                <td class="ta-r">{{ row.dstLevel }}</td>
                <td class="ta-r">{{ row.boostCandy.toLocaleString() }}</td>
                <td class="ta-r">{{ row.normalCandy.toLocaleString() }}</td>
                <td class="ta-r">{{ row.totalCandy.toLocaleString() }}</td>
                <td class="ta-r">{{ row.shards.toLocaleString() }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="exportTotalLabel" colspan="4">合計</td>
                <td class="ta-r exportTotal">{{ calcExportTotals.boostCandy.toLocaleString() }}</td>
                <td class="ta-r exportTotal">{{ calcExportTotals.normalCandy.toLocaleString() }}</td>
                <td class="ta-r exportTotal">{{ calcExportTotals.totalCandy.toLocaleString() }}</td>
                <td class="ta-r exportTotal">{{ calcExportTotals.shards.toLocaleString() }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, toRaw, watch } from "vue";
import { onMounted, onUnmounted } from "vue";
import { toPng } from "html-to-image";
import type { BoostEvent, ExpGainNature, ExpType } from "./domain";
import { calcExp, calcExpAndCandy, calcExpAndCandyByBoostExpRatio, calcExpAndCandyMixed, calcLevelByCandy } from "./domain/pokesleep";
import { boostRules } from "./domain/pokesleep/boost-config";
import type { BoxSubSkillSlotV1, IngredientType, PokemonBoxEntryV1, PokemonSpecialty } from "./domain/types";
import { decodeNitoyonIvDetail, decodeNitoyonIvMinimal, parseNitoyonBoxLine } from "./domain/box/nitoyon";
import { cryptoRandomId, loadBox, saveBox } from "./persistence/box";
import type { CalcRowV1, CalcSaveSlotV1 } from "./persistence/calc";
import { loadCalcAutosave, loadCalcSlots, loadLegacyTotalShards, saveCalcAutosave, saveCalcSlots } from "./persistence/calc";
import {
  findPokemonByNameJa,
  getPokemonExpType,
  getPokemonIngredients,
  getPokemonNameJa,
  getPokemonSpecialty,
  getPokemonType,
  pokemonIdFormsByNameJa,
} from "./domain/pokesleep/pokemon-names";
import { IngredientTypes, SubSkillAllJaSorted, SubSkillNameJaByEn, subSkillEnFromJa } from "./domain/box/nitoyon";

import iconBerrySvg from "./assets/icons/berry.svg?raw";
import iconIngredientsSvg from "./assets/icons/ingredients.svg?raw";
import iconSkillsSvg from "./assets/icons/skills.svg?raw";
import iconAllSvg from "./assets/icons/all.svg?raw";
import iconStarSvg from "./assets/icons/star.svg?raw";

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
    relinkStatus.value = "再リンク失敗：名前が一致しません";
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
  relinkStatus.value = `種族リンクを更新しました（図鑑No.${found.pokedexId}）`;
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
  importStatus.value = "Undoしました";
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

// NOTE: computed/ watch の参照順で TDZ (Cannot access 'X' before initialization) が起きるため、
// 依存元の computed を先に宣言すること。
const selectedBox = computed(() => boxEntries.value.find((x) => x.id === selectedBoxId.value) ?? null);

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
    if (s.lv === 10 || s.lv === 25 || s.lv === 50 || s.lv === 75 || s.lv === 100) next[String(s.lv)] = s.nameJa;
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

const selectedSpecialtySelectValue = computed(() => {
  const manual = selectedBox.value?.planner?.specialty;
  if (manual && manual !== "unknown") return manual;
  const auto = selectedDetail.value?.specialty;
  if (auto && auto !== "unknown") return auto;
  return "";
});

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
    importStatus.value = "入力が空です";
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
    addedIds.push(entry.id);
    existing.add(rawText);
    added++;
    if (next.length >= 300) break;
  }

  boxEntries.value = next;
  boxUndoAction.value = addedIds.length ? { kind: "import", addedIds, selectedId: undoSelectedId } : null;
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
  const undoSelectedId = selectedBoxId.value;
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
const calcRows = ref<CalcRow[]>(calcAutosave0?.rows ?? []);
const activeCalcRowId = ref<string | null>(calcAutosave0?.activeRowId ?? calcRows.value[0]?.id ?? null);

const fullLabel = computed(
  () => `アメブ（かけら×${boostRules.full.shardMultiplier} / EXP×${boostRules.full.expMultiplier}）`
);
const miniLabel = computed(
  () => `ミニブ（かけら×${boostRules.mini.shardMultiplier} / EXP×${boostRules.mini.expMultiplier}）`
);

function cloneCalcRows(entries: CalcRow[]): CalcRow[] {
  const raw = toRaw(entries) as any;
  return JSON.parse(JSON.stringify(raw));
}

function saveCalcAutosaveNow() {
  saveCalcAutosave({
    schemaVersion: 1,
    totalShards: Math.max(0, Math.floor(Number(totalShards.value) || 0)),
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
    return {
      ...r,
      srcLevel: v.normalized.srcLevel,
      dstLevel: v.normalized.dstLevel,
      expRemaining: v.normalized.expRemaining,
      result: v.mixed,
      ui: v.ui,
    };
  })
);

const calcExportOpen = ref(false);
const exportSheetEl = ref<HTMLElement | null>(null);
const exportBusy = ref(false);
const exportStatus = ref<string>("");
function openCalcExport() {
  if (!calcRowsView.value.length) return;
  calcExportOpen.value = true;
}
function closeCalcExport() {
  calcExportOpen.value = false;
}

async function downloadCalcExportPng() {
  const el = exportSheetEl.value;
  if (!el) return;
  exportBusy.value = true;
  exportStatus.value = "";
  try {
    // 保存時は transform(scale) / sticky を外した状態で、全高を確実に取り込む
    // Webフォントが読み込まれる前にキャプチャすると崩れるので待つ
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fontsReady = (document as any)?.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === "function") await fontsReady;
    await nextTick();
    const w = Math.max(el.scrollWidth, el.clientWidth, 1);
    const h = Math.max(el.scrollHeight, el.clientHeight, 1);
    const dataUrl = await toPng(el, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: "#FFFBE6",
      width: w,
      height: h,
      style: {
        transform: "none",
        transformOrigin: "top left",
      },
    });
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `CandyBoost-Planner_${ts}.png`;
    a.href = dataUrl;
    a.click();
    exportStatus.value = "";
  } catch (e: any) {
    exportStatus.value = "ごめん、画像の作成に失敗しました（もう一度お試しください）";
  } finally {
    exportBusy.value = false;
  }
}

function natureLabel(n: ExpGainNature): string {
  if (n === "up") return "↑";
  if (n === "down") return "↓";
  return "→";
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
const showShardsFire = computed(() => calcShardsCap.value > 0 && calcShardsUsedPct.value >= 90);
const calcShardsUsedPctForBar = computed(() => (calcShardsCap.value > 0 ? Math.min(100, Math.max(0, calcShardsUsedPct.value)) : 0));
const calcShardsOverPct = computed(() =>
  calcShardsCap.value > 0 && calcShardsOver.value > 0 ? (calcShardsOver.value / calcShardsCap.value) * 100 : 0
);
const calcShardsOverPctForBar = computed(() => Math.min(35, Math.max(0, calcShardsOverPct.value)));

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

function applyCalculatorToBox() {
  const r = activeCalcRow.value;
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
  importStatus.value = "計算機の値をボックスへ保存しました";
}

function onDeleteSelected() {
  const e = selectedBox.value;
  if (!e) return;
  const ok = confirm(`削除しますか？\n${e.label || e.rawText}`);
  if (!ok) return;
  const idx = boxEntries.value.findIndex((x) => x.id === e.id);
  boxUndoAction.value = { kind: "delete", entry: cloneBoxEntry(e), index: Math.max(0, idx), selectedId: selectedBoxId.value };
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
  boxUndoAction.value = { kind: "clear", entries: cloneBoxEntries(boxEntries.value), selectedId: selectedBoxId.value };
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
  importStatus.value = "ニックネームを更新しました";
}

function toggleSelectedFavorite() {
  const e = selectedBox.value;
  if (!e) return;
  const now = new Date().toISOString();
  boxEntries.value = boxEntries.value.map((x) => {
    if (x.id !== e.id) return x;
    return { ...x, favorite: !x.favorite, updatedAt: now };
  });
  importStatus.value = "お気に入りを更新しました";
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
  importStatus.value = "レベルを更新しました";
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
  importStatus.value = "EXPタイプを更新しました";
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
  importStatus.value = "性格（EXP補正）を更新しました";
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
  importStatus.value = "食材タイプを更新しました";
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
  const en = ja ? subSkillEnFromJa(ja) : null;
  if (ja && !en) {
    boxEditSubErrors.value = { ...boxEditSubErrors.value, [String(lv)]: "未知のサブスキルです（保存時は無視されます）" };
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
  importStatus.value = "サブスキルを更新しました";
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
  max-width: 660px;
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
  max-width: 660px;
  position: sticky;
  top: 10px;
  z-index: 30;
  margin-top: 10px;
  padding: 8px;
  border-radius: 16px;
  background: color-mix(in oklab, var(--paper) 88%, transparent);
  border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
  box-shadow: 0 14px 36px color-mix(in oklab, var(--ink) 12%, transparent);
}
.calcSticky__summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.calcSum {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  border-radius: 14px;
  padding: 10px 12px;
  min-width: 160px;
  position: relative;
}
.calcSum__k {
  font-family: var(--font-body);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--ink) 60%, transparent);
}
.calcSum__v {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 18px;
  margin-top: 2px;
}
.calcSum--hi .calcSum__v {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 12px;
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--accent-warm) 34%, var(--paper) 66%),
    color-mix(in oklab, var(--accent-warm) 24%, var(--paper) 76%)
  );
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, var(--paper) 65%, transparent),
    0 10px 18px color-mix(in oklab, var(--accent-warm) 14%, transparent);
}
.calcSum--danger .calcSum__v {
  color: color-mix(in oklab, hsl(6 78% 52%) 75%, var(--ink) 10%);
}
.calcSum--bar {
  flex: 1;
  min-width: 220px;
}
.calcSum--sparkle::after {
  content: "";
  position: absolute;
  inset: -10px -10px -14px -10px;
  pointer-events: none;
  background:
    radial-gradient(10px 10px at 18% 22%, color-mix(in oklab, var(--accent-warm) 42%, transparent), transparent 65%),
    radial-gradient(8px 8px at 32% 68%, color-mix(in oklab, var(--accent) 32%, transparent), transparent 70%),
    radial-gradient(12px 12px at 78% 34%, color-mix(in oklab, var(--accent-warm) 38%, transparent), transparent 68%),
    radial-gradient(7px 7px at 86% 72%, color-mix(in oklab, var(--accent-cool) 26%, transparent), transparent 70%);
  filter: blur(0.2px);
  opacity: 0.65;
}
.calcSum--sparkle::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 14px;
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent-warm) 10%, transparent);
  opacity: 0.6;
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
  max-width: 660px;
}
@media (min-width: 860px) {
  .calcSlots {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
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
.calcSlot__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.calcSlot__label {
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -0.01em;
}
.calcSlot__state {
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 62%, transparent);
}
.calcSlot__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.calcHint {
  font-family: var(--font-body);
  margin: 14px 0 8px;
  color: color-mix(in oklab, var(--ink) 68%, transparent);
  font-size: 13px;
  line-height: 1.6;
}
.calcRows {
  display: grid;
  gap: 12px;
  margin-top: 10px;
}
.calcRow {
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 97%, var(--ink) 3%);
  border-radius: 16px;
  padding: 12px;
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
  gap: 10px;
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
  flex-wrap: wrap;
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
  gap: 8px;
  margin-top: 8px;
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
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed color-mix(in oklab, var(--ink) 14%, transparent);
}
.calcRow__res {
  display: grid;
  gap: 2px;
  min-width: 180px;
}
.calcRow__k {
  font-family: var(--font-body);
  font-size: 12px;
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
  display: inline-block;
  padding: 6px 10px;
  border-radius: 12px;
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--accent-warm) 34%, var(--paper) 66%),
    color-mix(in oklab, var(--accent-warm) 24%, var(--paper) 76%)
  );
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, var(--paper) 65%, transparent),
    0 10px 18px color-mix(in oklab, var(--accent-warm) 14%, transparent);
}

.field--sm {
  gap: 4px;
}
.field--sm .field__label {
  font-size: 10.5px;
  letter-spacing: 0.05em;
}
.field--sm .field__input {
  padding: 7px 10px;
  border-radius: 10px;
}
.field--sm .field__sub {
  font-size: 10.5px;
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
  width: min(860px, calc(100vw - 36px));
  max-height: calc(100vh - 36px);
  overflow: auto;
}
.exportSheet {
  transform-origin: top center;
  width: 100%;
  border-radius: 20px;
  border: 3px solid #F1C40F;
  background:
    radial-gradient(820px 520px at 15% 0%, rgba(241, 196, 15, 0.10), transparent 70%),
    radial-gradient(780px 520px at 85% 10%, rgba(22, 160, 133, 0.08), transparent 72%),
    #FFFBE6;
  box-shadow: 0 22px 56px rgba(44, 62, 80, 0.18);
  padding: 18px 18px 14px;
  position: relative;
}
.exportSheet--capture {
  /* 画像保存時は「カード枠」を消してスクショ向けに */
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.exportSheet::before,
.exportSheet::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  height: 14px;
  border-radius: 999px;
  pointer-events: none;
  opacity: 0.95;
  background:
    repeating-linear-gradient(
      135deg,
      rgba(22, 160, 133, 0.45) 0 8px,
      rgba(241, 196, 15, 0.40) 8px 16px
    );
}
.exportSheet::before {
  top: 10px;
}
.exportSheet::after {
  bottom: 10px;
}
.exportSheet--capture::before,
.exportSheet--capture::after {
  /* 保存時は外枠同様、上下のリボンも消す */
  display: none;
}
.exportHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  padding: 10px 10px 6px;
  border-radius: 16px;
  background:
    radial-gradient(560px 220px at 20% 0%, rgba(241, 196, 15, 0.16), transparent 70%),
    radial-gradient(520px 240px at 90% 0%, rgba(241, 196, 15, 0.10), transparent 72%),
    rgba(255, 255, 255, 0.35);
}
.exportBrand {
  font-family: var(--font-body);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--ink) 55%, transparent);
  margin-bottom: 2px;
}
.exportTitle {
  font-family: "M PLUS Rounded 1c", var(--font-body);
  font-weight: 900;
  letter-spacing: -0.01em;
  color: #F1C40F;
  text-shadow: 1px 1px 2px rgba(212, 172, 13, 0.5);
}
.exportMeta {
  margin-top: 2px;
  font-family: var(--font-body);
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 58%, transparent);
}
.exportActions {
  display: inline-flex;
  gap: 8px;
  align-items: center;
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
.exportTable {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-family: var(--font-body);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  border-radius: 12px;
  border: 0;
}
.exportTable .col-name { width: 34%; }
.exportTable .col-exp { width: 8%; }
.exportTable .col-lv { width: 8%; }
.exportTable .col-num { width: 10%; }
.exportTable .col-shards { width: 20%; }
.exportTable th,
.exportTable td {
  padding: 7px 8px;
  border-bottom: 0;
  background: rgba(255, 255, 255, 0.45);
}
.exportTable thead th {
  font-family: var(--font-heading);
  font-weight: 900;
  letter-spacing: 0.02em;
  background: linear-gradient(180deg, #F1C40F, #D4AC0D);
  color: #1F4D45;
}
.exportSheet:not(.exportSheet--capture) .exportTable thead th {
  position: sticky;
  top: 0;
  z-index: 1;
}
.exportTable tbody tr:nth-child(2n) td {
  background: rgba(22, 160, 133, 0.08);
}
.exportTable tfoot td {
  font-family: "M PLUS Rounded 1c", var(--font-body);
  font-weight: 900;
  border-bottom: 0;
  background: #16A085;
  color: #ffffff;
}
.exportName {
  font-family: var(--font-heading);
  font-weight: 900;
  white-space: normal;
  overflow-wrap: anywhere;
}
.exportTotalLabel {
  text-align: left;
}
.exportTotal {
  font-variant-numeric: tabular-nums;
}
.exportTable tfoot td.ta-r {
  box-shadow: inset 0 0 8px rgba(241, 196, 15, 0.3);
}
.ta-r {
  text-align: right;
}
.ta-c {
  text-align: center;
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
  margin: 10px 0 14px;
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

.btn {
  font: inherit;
  cursor: pointer;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--paper) 99%, var(--ink) 1%),
    color-mix(in oklab, var(--paper) 95%, var(--ink) 5%)
  );
  padding: 10px 12px;
  border-radius: 12px;
  box-shadow: 0 1px 0 color-mix(in oklab, var(--paper) 60%, transparent);
}
.btn:hover {
  border-color: color-mix(in oklab, var(--ink) 26%, transparent);
  box-shadow:
    0 1px 0 color-mix(in oklab, var(--paper) 60%, transparent),
    0 12px 26px color-mix(in oklab, var(--ink) 10%, transparent);
}
.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
}
.btn:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow: 0 1px 0 color-mix(in oklab, var(--paper) 60%, transparent);
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn--primary {
  border-color: color-mix(in oklab, var(--accent) 40%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--accent) 18%, var(--paper) 82%),
    color-mix(in oklab, var(--accent) 14%, var(--paper) 86%)
  );
}
.btn--ghost {
  background: transparent;
}
.btn--danger {
  border-color: color-mix(in oklab, var(--danger) 40%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--danger) 12%, var(--paper) 88%),
    color-mix(in oklab, var(--danger) 8%, var(--paper) 92%)
  );
}
.btn--xs {
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 12px;
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
.boxSort .btn {
  white-space: nowrap;
  min-width: 56px; /* 「昇順/降順」が2行にならない程度 */
  justify-content: center;
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
  --type-wash: transparent;
  background:
    radial-gradient(
      140% 160% at 12% 0%,
      color-mix(in oklab, var(--type-wash) 32%, transparent),
      transparent 58%
    ),
    linear-gradient(
      90deg,
      color-mix(in oklab, var(--box-tile-left, #f1dfc8) 84%, var(--type-wash) 16%),
      color-mix(in oklab, var(--box-tile-right, #f5f2ea) 86%, var(--type-wash) 14%)
    );
  border-radius: 14px;
  padding: 12px 12px;
  display: grid;
  gap: 8px;
  min-height: 76px;
}
.boxTile--type-Normal {
  --type-wash: #d7d7d7;
}
.boxTile--type-Fire {
  --type-wash: #f84c4cf0;
}
.boxTile--type-Water {
  --type-wash: #68aaf0;
}
.boxTile--type-Electric {
  --type-wash: #f8e130;
}
.boxTile--type-Grass {
  --type-wash: #78C850;
}
.boxTile--type-Ice {
  --type-wash: #98D8D8;
}
.boxTile--type-Fighting {
  --type-wash: #eb9131f4;
}
.boxTile--type-Poison {
  --type-wash: #a256b0;
}
.boxTile--type-Ground {
  --type-wash: #d29d41;
}
.boxTile--type-Flying {
  --type-wash: #6992f2;
}
.boxTile--type-Psychic {
  --type-wash: #ff6e9c;
}
.boxTile--type-Bug {
  --type-wash: #93b219;
}
.boxTile--type-Rock {
  --type-wash: #b88738;
}
.boxTile--type-Ghost {
  --type-wash: #705898;
}
.boxTile--type-Dragon {
  --type-wash: #633bf3;
}
.boxTile--type-Dark {
  --type-wash: #705848;
}
.boxTile--type-Steel {
  --type-wash: #959595;
}
.boxTile--type-Fairy {
  --type-wash: #ffa4cb;
}
.boxTile--type-unknown {
  --type-wash: transparent;
}
.boxTile:hover {
  border-color: color-mix(in oklab, var(--ink) 26%, transparent);
}
.boxTile--active {
  border-color: color-mix(in oklab, var(--accent-warm) 52%, transparent);
  background:
    radial-gradient(
      140% 160% at 12% 0%,
      color-mix(in oklab, var(--type-wash) 26%, transparent),
      transparent 60%
    ),
    linear-gradient(
      180deg,
      color-mix(in oklab, var(--accent-warm) 12%, var(--paper) 88%),
      color-mix(in oklab, var(--paper) 96%, var(--ink) 4%)
    );
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent-warm) 12%, transparent);
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
  }
}
.boxDetail__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
