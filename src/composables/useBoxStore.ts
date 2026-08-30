import { computed, nextTick, ref, watch, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import type { AppLocale } from "../i18n";

import { decodeNitoyonIvDetail, decodeNitoyonIvMinimal, parseNitoyonBoxLine } from "../domain/box/nitoyon";
import { IngredientTypes, SubSkillAllJaSorted, SubSkillAllNames, SubSkillNameJaByEn, subSkillEnFromJa } from "../domain/box/nitoyon";
import { calcExp } from "../domain/pokesleep/exp";
import { getPokemonNameLocalized } from "../domain/pokesleep/pokemon-name-localize";
import {
  findPokemonByNameJa,
  getPokemonExpType,
  getPokemonIngredients,
  getPokemonNameJa,
  getPokemonSpecialty,
  getPokemonType,
  pokemonIdFormsByNameJa,
} from "../domain/pokesleep/pokemon-names";
import type { ExpGainNature, ExpType } from "../domain";
import type { BoxSubSkillSlotV1, IngredientType, PokemonBoxEntryV1, PokemonSpecialty } from "../domain/types";
import { cryptoRandomId, loadBox, saveBox } from "../persistence/box";
import { schedulePersist } from "../persistence/deferredPersist";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { normalizeSleepHoursInput } from "../domain/box/sleep-milestones";
type FilterJoinMode = "and" | "or";

type BoxSnapshot = {
  entries: PokemonBoxEntryV1[];
  selectedId: string | null;
};

export type BoxStore = ReturnType<typeof useBoxStore>;

/**
 * ボックス一覧のソート。`〜Fav` はお気に入りを常に先頭へ寄せる派生キー。
 * 主比較が同値のときは、どのキーでも表記名でタイブレークする。
 */
type BoxSortBase = "label" | "level" | "dex" | "sleep";
type BoxSortKey = BoxSortBase | `${BoxSortBase}Fav`;

const BOX_SORT_BASES = ["label", "level", "dex", "sleep"] as const;
const DEFAULT_SORT_KEY: BoxSortKey = "labelFav";

function isBoxSortKey(v: unknown): v is BoxSortKey {
  return typeof v === "string"
    && (BOX_SORT_BASES as readonly string[]).includes(v.replace(/Fav$/, ""));
}

/** ソートキーごとの主比較（常に昇順基準。降順は呼び出し側で符号を反転する） */
const BOX_SORT_COMPARATORS: Record<BoxSortBase, (a: PokemonBoxEntryV1, b: PokemonBoxEntryV1) => number> = {
  label: () => 0,
  level: (a, b) => entryLevel(a) - entryLevel(b),
  // 累計睡眠時間。未設定はアプリ全体と同じく 0h 扱い
  sleep: (a, b) => (a.planner?.sleepHours ?? 0) - (b.planner?.sleepHours ?? 0),
  // 図鑑番号 → フォーム順。種族不明は末尾へ
  dex: (a, b) =>
    (a.derived?.pokedexId ?? 9999) - (b.derived?.pokedexId ?? 9999)
    || (a.derived?.form ?? 0) - (b.derived?.form ?? 0),
};

function entryLevel(e: PokemonBoxEntryV1): number {
  return e.planner?.level ?? e.derived?.level ?? 0;
}

/**
 * あとEXPの上限（＝現在Lvから次Lvまでに必要なEXP）。
 * Lvが未確定で上限を出せないときは null。最大Lvでは次のLvがないので 0。
 */
function expToNextLevel(level: number | null | undefined, expType: ExpType): number | null {
  const lv = Number(level);
  if (!Number.isFinite(lv) || lv < 1) return null;
  return Math.max(0, calcExp(lv, lv + 1, expType));
}

/**
 * あとEXPを 0〜次Lvまでの必要EXP にクランプする。
 *
 * 0 は「Lvが上がった直後で次Lvまでの全EXPが残っている」を表す正当な値として扱う
 * （読み出し側の `calcRowExpGot` も 0 を上限として解釈する）。この点で下限が 1 の
 * 計算パネルとは異なる。上限が出せない（Lv未確定）ときはクランプしない。
 */
function clampExpRemaining(raw: number, level: number | null | undefined, expType: ExpType): number {
  const n = Math.max(0, Math.floor(raw));
  const toNext = expToNextLevel(level, expType);
  return toNext === null ? n : Math.min(n, toNext);
}

// NOTE:
// - This store is a direct extraction of the Pokémon Box logic from the former monolithic App.vue.
// - It intentionally keeps behavior compatible with existing UI and persistence.
export function useBoxStore(opts: { locale: Ref<AppLocale>; t: Composer["t"] }) {
  const { locale, t } = opts;

  const boxEntries = ref<PokemonBoxEntryV1[]>(loadBox());
  const selectedBoxId = ref<string | null>(null);
  const importText = ref("");
  const importStatus = ref("");
  const boxFilter = ref("");

  // ソート設定の読み込み・保存
  const SORT_STORAGE_KEY = "candy-boost-planner:box-sort";
  type BoxSortDir = "asc" | "desc";

  function loadSortSettings(): { key: BoxSortKey; dir: BoxSortDir } {
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY);
      if (!raw) return { key: DEFAULT_SORT_KEY, dir: "asc" };
      const json = JSON.parse(raw);
      const key = isBoxSortKey(json.key) ? json.key : DEFAULT_SORT_KEY;
      const dir = json.dir === "desc" ? "desc" : "asc";
      return { key, dir };
    } catch {
      return { key: DEFAULT_SORT_KEY, dir: "asc" };
    }
  }

  function saveSortSettings(key: BoxSortKey, dir: BoxSortDir) {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key, dir }));
    } catch {
      // localStorage can throw
    }
  }

  const savedSort = loadSortSettings();
  const boxSortKey = ref<BoxSortKey>(savedSort.key);
  const boxSortDir = ref<BoxSortDir>(savedSort.dir);

  // ソート設定が変わったら保存
  watch([boxSortKey, boxSortDir], ([key, dir]) => {
    saveSortSettings(key, dir);
  });

  // ソートキー変更時に即座にソートを再実行
  watch(boxSortKey, () => {
    if (boxEntries.value.length > 0) {
      applySort(boxSortDir.value);
    }
  });

  const filterJoinMode = ref<FilterJoinMode>("and"); // とくい/サブスキル の結合
  const subSkillJoinMode = ref<FilterJoinMode>("and"); // 複数サブスキル の結合
  const selectedSpecialties = ref<Array<"Berries" | "Ingredients" | "Skills" | "All">>([]);
  const selectedSubSkillEns = ref<string[]>([]);
  const favoritesOnly = ref(false);
  const inCalculatorOnly = ref(false);
  const calculatorBoxIds = ref<ReadonlySet<string>>(new Set());

  const addName = ref("");
  const addNameHasFocus = ref(false);
  const addNameSuggestOpen = ref(false);
  const isComposing = ref(false);
  const addLabel = ref("");
  const addLevel = ref(15);
  const addExpRemaining = ref<string>("");
  const addExpType = ref<ExpType>(600);
  const addExpTypeTouched = ref(false);
  const addNature = ref<ExpGainNature>("normal");
  const addLookup = computed(() => findPokemonByNameJa(addName.value));
  const addSpecialty = ref<PokemonSpecialty | "">("");
  const addSpecialtyTouched = ref(false);
  const addFavorite = ref(true); // デフォルトでお気に入りに追加
  const addSleepHours = ref<string>("");

  const addIngredientType = ref<IngredientType | "">("");
  const addIngredientTypeTouched = ref(false);
  const addSubLv10 = ref("");
  const addSubLv25 = ref("");
  const addSubLv50 = ref("");
  const addSubLv70 = ref("");
  const addSubLv80 = ref("");

  const addSubErrors = ref<Record<"10" | "25" | "50" | "70" | "80", string | null>>({
    "10": null,
    "25": null,
    "50": null,
    "70": null,
    "80": null,
  });

  const subSkillOptionLabels = computed(() => {
    if (locale.value === "en") return [...SubSkillAllNames];
    return SubSkillAllJaSorted.map((s) => s.nameJa);
  });

  function toIngredientLabel(key: string | null): string {
    if (!key) return "-";
    if (locale.value === "en") return ingredientEn[key] ?? key;
    return ingredientJa[key] ?? key;
  }

  const ingredientTypeOptions = computed(() => {
    const found = addLookup.value;
    if (!found) return IngredientTypes.map((tt) => ({ type: tt, preview: "" }));
    const ing = getPokemonIngredients(found.pokedexId, found.form);
    const toL = (k: string | null) => toIngredientLabel(k);
    const a = toL(ing?.a ?? null);
    const b = toL(ing?.b ?? null);
    const c = toL(ing?.c ?? null);
    return IngredientTypes.map((tt) => {
      const slots = tt.split("").map((x) => (x === "A" ? a : x === "B" ? b : c));
      return { type: tt, preview: slots.join(" / ") };
    });
  });

  function onAddIngredientTypeChanged() {
    addIngredientTypeTouched.value = true;
  }

  function onAddSpecialtyChanged() {
    addSpecialtyTouched.value = true;
  }

  const allPokemonNameJa = Object.freeze(Object.keys(pokemonIdFormsByNameJa));

  // 日本語名→英語名のマッピングを事前構築
  const pokemonNameJaToEn = computed(() => {
    const map: Record<string, string> = {};
    for (const nameJa of allPokemonNameJa) {
      const idForms = (pokemonIdFormsByNameJa as Record<string, readonly number[]>)[nameJa] as readonly number[] | undefined;
      if (!idForms || idForms.length === 0) continue;
      const idForm = idForms[0];
      const dexNo = idForm & 0xfff;
      const form = idForm >> 12;
      const nameEn = getPokemonNameLocalized(dexNo, form, "en");
      if (nameEn) map[nameJa] = nameEn;
    }
    return map;
  });

  const addNameSuggestList = computed(() => {
    if (isComposing.value) return [];
    const q = addName.value.trim().toLowerCase();
    if (q.length === 0) return [];

    const isEn = locale.value === "en";
    const out: { nameJa: string; display: string }[] = [];

    // 先頭一致を基本に、最大12件まで
    for (const nameJa of allPokemonNameJa) {
      const nameEn = pokemonNameJaToEn.value[nameJa] ?? nameJa;
      const display = isEn ? nameEn : nameJa;
      const searchTarget = display.toLowerCase();
      if (searchTarget.startsWith(q)) {
        out.push({ nameJa, display });
      }
      if (out.length >= 12) break;
    }

    // 先頭一致が少なすぎるときは部分一致も少し補う（最大12件）
    if (out.length < 6 && q.length >= 2) {
      for (const nameJa of allPokemonNameJa) {
        if (out.some(x => x.nameJa === nameJa)) continue;
        const nameEn = pokemonNameJaToEn.value[nameJa] ?? nameJa;
        const display = isEn ? nameEn : nameJa;
        const searchTarget = display.toLowerCase();
        if (searchTarget.includes(q)) {
          out.push({ nameJa, display });
        }
        if (out.length >= 12) break;
      }
    }
    return out;
  });


  const showAddNameSuggest = computed(() => {
    if (!addNameHasFocus.value || !addNameSuggestOpen.value || isComposing.value) return false;
    const list = addNameSuggestList.value;
    if (list.length === 0) return false;
    // 候補が1件だけ & 入力値と完全一致 → 既に確定しているので閉じる
    if (list.length === 1 && list[0].nameJa === addName.value.trim()) return false;
    return true;
  });

  const relinkName = ref("");
  const relinkOpen = ref(false);
  const relinkStatus = ref<string>("");
  const relinkFound = computed(() => findPokemonByNameJa(relinkName.value.trim()) ?? null);
  const relinkSuggestList = computed(() => {
    const q = relinkName.value.trim().toLowerCase();
    if (q.length === 0) return [];

    const isEn = locale.value === "en";
    const out: { nameJa: string; display: string }[] = [];

    for (const nameJa of allPokemonNameJa) {
      const nameEn = pokemonNameJaToEn.value[nameJa] ?? nameJa;
      const display = isEn ? nameEn : nameJa;
      const searchTarget = display.toLowerCase();
      if (searchTarget.startsWith(q)) {
        out.push({ nameJa, display });
      }
      if (out.length >= 10) break;
    }
    if (out.length < 5 && q.length >= 2) {
      for (const nameJa of allPokemonNameJa) {
        if (out.some(x => x.nameJa === nameJa)) continue;
        const nameEn = pokemonNameJaToEn.value[nameJa] ?? nameJa;
        const display = isEn ? nameEn : nameJa;
        const searchTarget = display.toLowerCase();
        if (searchTarget.includes(q)) {
          out.push({ nameJa, display });
        }
        if (out.length >= 10) break;
      }
    }
    return out;
  });


  const showRelinkSuggest = computed(() => {
    if (!relinkOpen.value) return false;
    const list = relinkSuggestList.value;
    if (list.length === 0) return false;
    if (list.length === 1 && list[0].nameJa === relinkName.value.trim()) return false;
    return true;
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
      nameJa: (SubSkillNameJaByEn as Record<string, string>)[s.nameEn] ?? s.nameEn,
    }));
    const subSkills = decoded?.subSkills?.length ? decoded.subSkills : subSkillsFromPlanner;

    const specialty = (e.planner?.specialty ?? (pokedexId ? getPokemonSpecialty(pokedexId, form) : "unknown")) as PokemonSpecialty;
    // Lv・EXPタイプを後から変えると上限も変わるため、保存値が新しい上限を超えていても
    // 表示は常に有効範囲へ丸める（保存値そのものは次の確定時に正規化される）。
    const expRemaining = clampExpRemaining(e.planner?.expRemaining ?? 0, level, expType);
    const sleepHours = e.planner?.sleepHours ?? 0;

    return {
      decoded: decoded
        ? { ...decoded, subSkills }
        : {
          pokedexId: pokedexId ?? 0,
          form,
          level: level ?? 1,
          natureName: "",
          expGainNature,
          expType,
          ingredientType,
          subSkills,
        },
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
      expRemaining,
      sleepHours,
    };
  });

  const selectedNature = computed({
    get: () => selectedDetail.value?.expGainNature ?? "normal",
    set: (val: ExpGainNature) => {
      onEditSelectedNature(val);
    },
  });

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
          // → 種族変更に伴い、種族依存のフィールド（EXPタイプ、とくい、食材構成）はリセットして自動判定に戻す
          expType: undefined,
          specialty: undefined,
          ingredientType: undefined,
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
      addSpecialty.value = sp && sp !== "unknown" ? sp : "";
    }
  );

  function displayPokemonName(e: PokemonBoxEntryV1): string | null {
    if (!e.derived) return null;
    return getPokemonNameLocalized(e.derived.pokedexId, e.derived.form, locale.value);
  }

  function displayBoxTitle(e: PokemonBoxEntryV1): string {
    const name = displayPokemonName(e);
    const label = (e.label ?? "").trim();
    if (!label) return name ?? "(no name)";
    // labelが #123 のような疑似IDの場合は「名前表示」を優先
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
    const tt = getPokemonType(e.derived.pokedexId, e.derived.form);
    return `boxTile--type-${tt}`;
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

  function matchSubSkills(haveEns: string[], wantEns: string[], mode: FilterJoinMode): boolean {
    if (wantEns.length === 0) return true;
    const set = new Set(haveEns);
    if (mode === "and") return wantEns.every((x) => set.has(x));
    return wantEns.some((x) => set.has(x));
  }

  function getIvFromRawText(rawText: string): string | null {
    const raw = String(rawText ?? "").trim();
    if (!raw) return null;
    const iv = raw.split("@")[0]?.trim() ?? "";
    return iv || null;
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
        ingredientType: (e.planner?.ingredientType ?? null) as IngredientType | null,
        subSkills: subs.map((s) => ({
          lv: s.lv,
          nameEn: s.nameEn,
          nameJa: (SubSkillNameJaByEn as Record<string, string>)[s.nameEn] ?? s.nameEn,
        })),
      };
    }
    const cached = ivDetailCache.get(iv);
    if (cached !== undefined) return cached;
    const decoded = decodeNitoyonIvDetail(iv);
    ivDetailCache.set(iv, decoded);
    return decoded;
  }

  // ひらがな→カタカナ変換（検索用）
  function toKatakana(str: string): string {
    return str.replace(/[\u3041-\u3096]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) + 0x60)
    );
  }

  const filteredBoxEntries = computed(() => {
    const q = toKatakana(boxFilter.value.trim().toLowerCase());
    const base = !q
      ? boxEntries.value
      : boxEntries.value.filter((e) => {
        const id = e.derived?.pokedexId ? String(e.derived.pokedexId) : "";
        const label = toKatakana((e.label || "").toLowerCase());
        const speciesName = e.derived?.pokedexId
          ? toKatakana((getPokemonNameLocalized(e.derived.pokedexId, e.derived.form ?? 0, locale.value) ?? "").toLowerCase())
          : "";
        return label.includes(q) || id.includes(q) || speciesName.includes(q);
      });

    const hasFavoriteFilter = favoritesOnly.value;
    const hasSpecialtyFilter = selectedSpecialties.value.length > 0;
    const hasSubSkillFilter = selectedSubSkillEns.value.length > 0;
    const hasInCalculatorFilter = inCalculatorOnly.value;
    if (!hasFavoriteFilter && !hasSpecialtyFilter && !hasSubSkillFilter && !hasInCalculatorFilter) return base;

    return base.filter((e) => {
      const decoded = getDecodedDetailForEntry(e);

      const pokedexId = e.derived?.pokedexId ?? decoded?.pokedexId ?? null;
      const form = e.derived?.form ?? decoded?.form ?? 0;
      const sp = (e.planner?.specialty ?? (pokedexId ? getPokemonSpecialty(pokedexId, form) : "unknown")) as PokemonSpecialty;
      const favoriteOk = !!e.favorite;
      const specialtyOk = (selectedSpecialties.value as readonly string[]).includes(sp);
      const inCalculatorOk = calculatorBoxIds.value.has(e.id);

      const subEns = decoded?.subSkills?.map((s) => s.nameEn) ?? [];
      const subOk = matchSubSkills(subEns, selectedSubSkillEns.value, subSkillJoinMode.value);

      const oks: boolean[] = [];
      if (hasFavoriteFilter) oks.push(favoriteOk);
      if (hasSpecialtyFilter) oks.push(specialtyOk);
      if (hasSubSkillFilter) oks.push(subOk);
      if (hasInCalculatorFilter) oks.push(inCalculatorOk);
      return filterJoinMode.value === "and" ? oks.every(Boolean) : oks.some(Boolean);
    });
  });

  function setCalculatorBoxIds(boxIds: Iterable<string>) {
    calculatorBoxIds.value = new Set(boxIds);
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

  function toggleSubSkill(nameEn: string, checked: boolean) {
    const cur = new Set(selectedSubSkillEns.value);
    if (checked) cur.add(nameEn);
    else cur.delete(nameEn);
    selectedSubSkillEns.value = [...cur];
  }

  // 手動ソート用のキャッシュ（自動ソートではなくボタンクリック時のみソート）
  const sortedBoxEntriesCache = ref<PokemonBoxEntryV1[]>([]);

  // ソートを実行する関数
  function applySort(direction: "asc" | "desc") {
    boxSortDir.value = direction;
    const list = [...filteredBoxEntries.value];
    const dir = direction === "asc" ? 1 : -1;
    const key = boxSortKey.value;
    const favPriority = key.endsWith("Fav");
    const comparePrimary = BOX_SORT_COMPARATORS[key.replace(/Fav$/, "") as BoxSortBase];
    const collation = locale.value === "en" ? "en" : "ja";
    const compareTitle = (a: PokemonBoxEntryV1, b: PokemonBoxEntryV1) =>
      displayBoxTitle(a).localeCompare(displayBoxTitle(b), collation);

    list.sort((a, b) => {
      // お気に入りは昇順/降順に関係なく常に上
      if (favPriority && !!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return (comparePrimary(a, b) || compareTitle(a, b)) * dir;
    });
    sortedBoxEntriesCache.value = list;
    importStatus.value = t("status.sorted");
  }

  // 初期化時にソートを実行（リロード時にソート順を維持）
  nextTick(() => {
    if (boxEntries.value.length > 0) {
      applySort(boxSortDir.value);
      importStatus.value = ""; // 初期化時はステータスをクリア
    }
  });

  // フィルタ変更時やデータ変更時はソート順を維持しつつリストを更新
  const sortedBoxEntries = computed(() => {
    const filtered = filteredBoxEntries.value;
    const cached = sortedBoxEntriesCache.value;

    // キャッシュが空の場合はフィルタ結果をそのまま返す
    if (cached.length === 0) {
      return filtered;
    }

    // キャッシュのIDセットを作成
    const cachedIds = new Set(cached.map(e => e.id));
    const filteredIds = new Set(filtered.map(e => e.id));

    // キャッシュの順序を維持しつつ、フィルタ結果に含まれるもののみ返す
    // また、フィルタ結果にあってキャッシュにないものは先頭に追加（新規追加エントリを先頭表示するため）
    const newEntries: PokemonBoxEntryV1[] = [];
    const cachedEntries: PokemonBoxEntryV1[] = [];

    // フィルタ結果を id→行 にしておき、キャッシュ走査を O(1) 参照に（ボックスが大きいと find が二乗に近づくのを防ぐ）
    const filteredById = new Map<string, PokemonBoxEntryV1>();
    for (const f of filtered) {
      filteredById.set(f.id, f);
    }

    // キャッシュの順序に従ってフィルタ結果を並べる
    for (const e of cached) {
      if (filteredIds.has(e.id)) {
        const latest = filteredById.get(e.id);
        if (latest) cachedEntries.push(latest);
      }
    }

    // フィルタ結果にあってキャッシュにないものを先頭に追加（filtered の順序 = boxEntries の順序を維持）
    for (const e of filtered) {
      if (!cachedIds.has(e.id)) {
        newEntries.push(e);
      }
    }

    return [...newEntries, ...cachedEntries];
  });

  // .boxList コンテナの実幅から列数を算出（CSS auto-fill と同期）
  const TILE_MIN_WIDTH = 140; // CSS minmax(140px, 1fr) と一致させる
  const boxListEl = ref<HTMLElement | null>(null);
  const boxListWidth = ref(0);
  let _boxListRO: ResizeObserver | null = null;

  watch(boxListEl, (el, _old, onCleanup) => {
    if (_boxListRO) { _boxListRO.disconnect(); _boxListRO = null; }
    if (!el) return;
    boxListWidth.value = el.clientWidth;
    _boxListRO = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) boxListWidth.value = w;
    });
    _boxListRO.observe(el);
    onCleanup(() => { _boxListRO?.disconnect(); _boxListRO = null; });
  }, { flush: "post" });

  const boxColumns = computed(() => {
    const w = boxListWidth.value;
    if (w <= 0) return 2; // SSR / 初期値フォールバック
    const gap = 10; // CSS gap と一致
    return Math.max(1, Math.floor((w + gap) / (TILE_MIN_WIDTH + gap)));
  });

  /** 一覧が長いとき findIndex を毎回かけない */
  const sortedEntryIndexById = computed(() => {
    const m = new Map<string, number>();
    const list = sortedBoxEntries.value;
    for (let i = 0; i < list.length; i++) {
      m.set(list[i]!.id, i);
    }
    return m;
  });

  const selectedIndex = computed(() => {
    const id = selectedBoxId.value;
    if (!id) return -1;
    return sortedEntryIndexById.value.get(id) ?? -1;
  });

  const detailInsertAfterIndex = computed(() => {
    const idx = selectedIndex.value;
    if (idx < 0) return -1;
    const cols = boxColumns.value;
    const row = Math.floor(idx / cols);
    const end = (row + 1) * cols - 1;
    return Math.min(sortedBoxEntries.value.length - 1, end);
  });

  function onClearBoxFilter() {
    boxFilter.value = "";
  }

  // Undo / Redo / persistence
  const UNDO_LIMIT = 3;
  const boxUndoStack = ref<BoxSnapshot[]>([]);
  const boxRedoStack = ref<BoxSnapshot[]>([]);
  const canUndo = computed(() => boxUndoStack.value.length > 0);
  const canRedo = computed(() => boxRedoStack.value.length > 0);

  function captureBoxSnapshot(): BoxSnapshot {
    return {
      entries: cloneBoxEntries(boxEntries.value),
      selectedId: selectedBoxId.value,
    };
  }

  function pushUndoSnapshot() {
    boxUndoStack.value = [...boxUndoStack.value, captureBoxSnapshot()].slice(-UNDO_LIMIT);
    boxRedoStack.value = [];  // 新しい操作があるとredoスタックをクリア
  }

  function cloneBoxEntry(e: PokemonBoxEntryV1): PokemonBoxEntryV1 {
    const raw = JSON.parse(JSON.stringify(e));
    return raw;
  }
  function cloneBoxEntries(es: PokemonBoxEntryV1[]): PokemonBoxEntryV1[] {
    return es.map(cloneBoxEntry);
  }

  function applyBoxSnapshot(snapshot: BoxSnapshot) {
    boxEntries.value = cloneBoxEntries(snapshot.entries);
    selectedBoxId.value = snapshot.selectedId;
  }

  function onUndo() {
    const snapshot = boxUndoStack.value.pop();
    if (!snapshot) return;
    boxRedoStack.value = [...boxRedoStack.value, captureBoxSnapshot()].slice(-UNDO_LIMIT);
    applyBoxSnapshot(snapshot);
    importStatus.value = t("status.undo");
    nextTick(() => {
      syncBoxEditSubInputsFromSelected();
    });
  }

  function onRedo() {
    const snapshot = boxRedoStack.value.pop();
    if (!snapshot) return;
    boxUndoStack.value = [...boxUndoStack.value, captureBoxSnapshot()].slice(-UNDO_LIMIT);
    applyBoxSnapshot(snapshot);
    importStatus.value = t("status.redo");
    nextTick(() => {
      syncBoxEditSubInputsFromSelected();
    });
  }

  // Store actions and App.vue replace the array and changed entry objects;
  // persistence therefore observes only the canonical array replacement.
  watch(
    boxEntries,
    () => {
      schedulePersist("box", () => saveBox(boxEntries.value));
    }
  );

  watch(
    () => selectedBoxId.value,
    () => {
      relinkName.value = "";
      relinkOpen.value = false;
      relinkStatus.value = "";
    }
  );

  const boxEditSubInputs = ref<Record<string, string>>({ "10": "", "25": "", "50": "", "70": "", "80": "" });
  const boxEditSubErrors = ref<Record<string, string | null>>({ "10": null, "25": null, "50": null, "70": null, "80": null });

  function syncBoxEditSubInputsFromSelected() {
    const d = selectedDetail.value;
    const next: Record<string, string> = { "10": "", "25": "", "50": "", "70": "", "80": "" };
    for (const s of d?.subSkills ?? []) {
      if (s.lv === 10 || s.lv === 25 || s.lv === 50 || s.lv === 70 || s.lv === 80) {
        next[String(s.lv)] = locale.value === "en" ? s.nameEn : s.nameJa;
      }
    }
    boxEditSubInputs.value = next;
    boxEditSubErrors.value = { "10": null, "25": null, "50": null, "70": null, "80": null };
  }

  watch(
    () => selectedBoxId.value,
    () => syncBoxEditSubInputsFromSelected(),
    { immediate: true }
  );

  watch(
    () => locale.value,
    () => syncBoxEditSubInputsFromSelected()
  );

  function toSubSkillLevel(v: unknown): 10 | 25 | 50 | 70 | 80 | null {
    const n = typeof v === "number" ? v : Number(v);
    if (n === 10 || n === 25 || n === 50 || n === 70 || n === 80) return n;
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
        planner: { ...(x.planner ?? {}), subSkills: nextSubs.length ? nextSubs : undefined },
        updatedAt: now,
      };
    });
    importStatus.value = t("status.subSkillsUpdated");
  }

  function clampInt(v: unknown, min: number, max: number, fallback: number): number {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function writeSelectedLevel(lvl: number) {
    const e = selectedBox.value;
    if (!e) return;
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => {
      if (x.id !== e.id) return x;
      return {
        ...x,
        planner: { ...(x.planner ?? {}), level: lvl },
        updatedAt: now,
      };
    });
    importStatus.value = t("status.levelUpdated");
  }

  function setBoxLevel(v: unknown) {
    const e = selectedBox.value;
    if (!e) return;
    const lvl = clampInt(v, 1, MAX_LEVEL, e.planner?.level ?? e.derived?.level ?? 1);
    writeSelectedLevel(lvl);
  }
  function onEditSelectedLabel(v: string) {
    const e = selectedBox.value;
    if (!e) return;
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => (x.id === e.id ? { ...x, label: String(v || ""), updatedAt: now } : x));
    importStatus.value = t("status.nicknameUpdated");
  }
  function onEditSelectedLevel(v: string) {
    const e = selectedBox.value;
    if (!e) return;
    const lvl = clampInt(v, 1, MAX_LEVEL, e.planner?.level ?? e.derived?.level ?? 1);
    writeSelectedLevel(lvl);
  }

  /**
   * あとEXPの確定（フォーカスアウト／Enter）。
   *
   * 1文字ごとに走らせると "1500" の途中の "1" で上限クランプが効いてしまい、
   * 元の入力へ戻せなくなる。計算パネルの各入力欄と同じく確定時にだけ反映する。
   */
  function onEditSelectedExpRemaining(v: string) {
    const e = selectedBox.value;
    if (!e) return;
    const d = selectedDetail.value;
    const n = parseInt(v, 10);
    // 負の数は0、NaN（空）はundefined（未設定）として扱う
    const val = Number.isFinite(n) && n >= 0 ? clampExpRemaining(n, d?.level, d?.expType ?? 600) : undefined;
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => {
      if (x.id !== e.id) return x;
      return {
        ...x,
        planner: { ...(x.planner ?? {}), expRemaining: val },
        updatedAt: now,
      };
    });
    // 専用の文言がないので汎用の更新メッセージ、または既存の近いものを使用
    importStatus.value = t("status.updated");
  }

  function setBoxSleepHours(v: string) {
    const e = selectedBox.value;
    if (!e) return;
    const sleepHours = normalizeSleepHoursInput(v);
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => {
      if (x.id !== e.id) return x;
      return {
        ...x,
        planner: { ...(x.planner ?? {}), sleepHours },
        updatedAt: now,
      };
    });
    importStatus.value = t("status.updated");
  }

  function onEditSelectedExpType(v: string) {
    const e = selectedBox.value;
    if (!e) return;
    const n = Number(v);
    const expT: ExpType = n === 600 || n === 900 || n === 1080 || n === 1320 ? n : 600;
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => {
      if (x.id !== e.id) return x;
      return {
        ...x,
        planner: { ...(x.planner ?? {}), expType: expT },
        updatedAt: now,
      };
    });
    importStatus.value = t("status.expTypeUpdated");
  }

  function onEditSelectedNature(v: string) {
    const e = selectedBox.value;
    if (!e) return;
    const nat: ExpGainNature = v === "up" || v === "down" || v === "normal" ? v : "normal";
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => {
      if (x.id !== e.id) return x;
      return {
        ...x,
        planner: { ...(x.planner ?? {}), expGainNature: nat },
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
    const next = (v || "").trim();
    const ingredientType: IngredientType | undefined = (IngredientTypes as readonly string[]).includes(next) ? (next as IngredientType) : undefined;
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => {
      if (x.id !== e.id) return x;
      return {
        ...x,
        planner: { ...(x.planner ?? {}), ingredientType },
        updatedAt: now,
      };
    });
    importStatus.value = t("status.ingredientTypeUpdated");
  }
  function onEditSelectedSpecialty(v: string) {
    const e = selectedBox.value;
    if (!e) return;
    const now = new Date().toISOString();
    const vv: PokemonSpecialty | undefined = v === "Berries" || v === "Ingredients" || v === "Skills" || v === "All" ? v : undefined;
    boxEntries.value = boxEntries.value.map((x) =>
      x.id === e.id ? { ...x, planner: { ...(x.planner ?? {}), specialty: vv }, updatedAt: now } : x
    );
    importStatus.value = t("status.specialtyUpdated");
  }

  function toggleFavoriteById(id: string) {
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => (x.id === id ? { ...x, favorite: !x.favorite, updatedAt: now } : x));
    importStatus.value = t("status.favoriteUpdated");
  }

  function toggleSelectedFavorite() {
    const e = selectedBox.value;
    if (!e) return;
    toggleFavoriteById(e.id);
  }

  function subSkillEnFromLabel(label: string): string | null {
    const v = String(label ?? "").trim();
    if (!v) return null;
    // English label (nitoyon internal) -> itself
    if ((SubSkillNameJaByEn as Record<string, string>)[v]) return v;
    // Japanese label -> convert to internal English
    return subSkillEnFromJa(v);
  }

  function buildManualPlannerSubSkills(): BoxSubSkillSlotV1[] | undefined {
    const slots: Array<{ lv: 10 | 25 | 50 | 70 | 80; ja: string }> = [
      { lv: 10, ja: addSubLv10.value },
      { lv: 25, ja: addSubLv25.value },
      { lv: 50, ja: addSubLv50.value },
      { lv: 70, ja: addSubLv70.value },
      { lv: 80, ja: addSubLv80.value },
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

  function validateSubSkillField(lv: 10 | 25 | 50 | 70 | 80, value: string) {
    const ja = String(value ?? "").trim();
    const key = String(lv) as "10" | "25" | "50" | "70" | "80";
    if (!ja) {
      addSubErrors.value[key] = null;
      return;
    }
    const en = subSkillEnFromLabel(ja);
    addSubErrors.value[key] = en ? null : t("status.subSkillUnknown");
  }

  function onSubBlur(lv: 10 | 25 | 50 | 70 | 80) {
    const v =
      lv === 10
        ? addSubLv10.value
        : lv === 25
          ? addSubLv25.value
          : lv === 50
            ? addSubLv50.value
            : lv === 70
              ? addSubLv70.value
              : addSubLv80.value;
    validateSubSkillField(lv, v);
  }

  /**
   * 追加フォームのあとEXPの確定（フォーカスアウト／Enter）。
   * 入力途中の値でクランプしないよう、ここでだけ有効範囲へ丸める。
   */
  function onAddExpRemainingCommit() {
    const raw = String(addExpRemaining.value ?? "").trim();
    if (raw === "") return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
      addExpRemaining.value = "";
      return;
    }
    const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(addLevel.value))));
    addExpRemaining.value = String(clampExpRemaining(n, lvl, addExpType.value));
  }

  function onCreateManual(opts0: { mode: "toCalc" | "toBox" }) {
    const found = addLookup.value;
    const now = new Date().toISOString();
    const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(addLevel.value))));
    const nickname = String(addLabel.value || "").trim();
    // nickname が空でも、名前一致（図鑑リンク）できていればOK（表示名は locale で生成する）
    if (!nickname && !found) {
      importStatus.value = t("status.nameEmpty");
      return;
    }
    const pokedexId = found?.pokedexId ?? 0;
    const form = found?.form ?? 0;
    const speciesName = found ? getPokemonNameLocalized(pokedexId, form, locale.value) : null;
    const expT = found ? found.expType : addExpType.value;
    const specialty = addSpecialty.value ? (addSpecialty.value as PokemonSpecialty) : undefined;
    const ingredientType =
      addIngredientType.value && (IngredientTypes as readonly string[]).includes(addIngredientType.value)
        ? (addIngredientType.value as IngredientType)
        : undefined;
    const subSkills = buildManualPlannerSubSkills();
    const rawExpRem = parseInt(addExpRemaining.value, 10);
    // フォーカスを外さずに作成された場合もここで丸める（planner.expType は addExpType）。
    const expRem = Number.isFinite(rawExpRem) && rawExpRem > 0 ? clampExpRemaining(rawExpRem, lvl, addExpType.value) : undefined;
    const sleepHoursVal = normalizeSleepHoursInput(addSleepHours.value);
    const entry: PokemonBoxEntryV1 = {
      id: cryptoRandomId(),
      source: "manual",
      rawText: "",
      label: nickname,
      favorite: addFavorite.value,
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
        expRemaining: expRem,
        specialty,
        ingredientType,
        subSkills,
        sleepHours: sleepHoursVal,
      },
      createdAt: now,
      updatedAt: now,
    };
    pushUndoSnapshot();
    boxEntries.value = [entry, ...boxEntries.value].slice(0, 300);
    selectedBoxId.value = entry.id;

    // opts0.mode は呼び出し側が処理（計算機反映など）
    void opts0;

    // フォーム初期化（名前は残しても良いが、ここでは軽くリセット）
    addLabel.value = "";
    addLevel.value = lvl;
    addExpRemaining.value = "";
    addSleepHours.value = "";
    if (speciesName) addName.value = speciesName;
    addIngredientType.value = "";
    addIngredientTypeTouched.value = false;
    addSpecialty.value = "";
    addSpecialtyTouched.value = false;
    addSubLv10.value = "";
    addSubLv25.value = "";
    addSubLv50.value = "";
    addSubLv70.value = "";
    addSubLv80.value = "";
    addSubErrors.value = { "10": null, "25": null, "50": null, "70": null, "80": null };
  }

  /** @returns number of entries actually added (0 = nothing imported) */
  function onImport(opts?: { markFavorite?: boolean }): number {
    const markFav = opts?.markFavorite ?? false;
    const text = importText.value;
    const lines = text
      .split(/\r?\n/g)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!lines.length) {
      importStatus.value = t("status.inputEmpty");
      return 0;
    }
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
      const name0 = derived0 ? getPokemonNameLocalized(derived0.pokedexId, derived0.form, locale.value) : null;
      const expT0 = derived0 ? getPokemonExpType(derived0.pokedexId, derived0.form) : 600;
      const entry: PokemonBoxEntryV1 = {
        id: cryptoRandomId(),
        source: "nitoyon",
        rawText,
        // nickname がない場合は label を空にして「種族名表示」に任せる（locale で切り替え可能にする）
        label: parsed.nickname || (derived0 ? "" : name0 || "(imported)"),
        favorite: markFav,
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

    if (addedIds.length) pushUndoSnapshot();
    boxEntries.value = next;
    importStatus.value = t("status.importResult", { added, skipped });
    return added;
  }

  function onDeleteSelected() {
    const e = selectedBox.value;
    if (!e) return;
    pushUndoSnapshot();
    boxEntries.value = boxEntries.value.filter((x) => x.id !== e.id);
    selectedBoxId.value = null;
    importStatus.value = t("status.deleted");
  }

  /** 確認は呼び出し側（押した場所に出すインライン確認）の担当。ここでは確認しない。 */
  function onClearBox() {
    if (!boxEntries.value.length) return;
    pushUndoSnapshot();
    boxEntries.value = [];
    selectedBoxId.value = null;
    boxFilter.value = "";
    importStatus.value = t("status.boxCleared");
  }

  const selectedSpecialtySelectValue = computed(() => {
    const manual = selectedBox.value?.planner?.specialty;
    if (manual && manual !== "unknown") return manual;
    const auto = selectedDetail.value?.specialty;
    if (auto && auto !== "unknown") return auto;
    return "";
  });

  // ---- ingredient maps ----
  const ingredientJa: Record<string, string> = {
    leek: "ねぎ",
    mushroom: "キノコ",
    egg: "エッグ",
    potato: "ポテト",
    apple: "リンゴ",
    herb: "ハーブ",
    sausage: "マメミート",
    milk: "ミルク",
    honey: "ミツ",
    oil: "オイル",
    ginger: "ジンジャー",
    tomato: "トマト",
    cacao: "カカオ",
    tail: "シッポ",
    soy: "大豆",
    corn: "コーン",
    coffee: "コーヒー",
    pumpkin: "カボチャ",
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
    tail: "Tail",
    soy: "Soybeans",
    corn: "Corn",
    coffee: "Coffee",
    pumpkin: "Pumpkin",
    avocado: "Avocado",
  };

  // The template uses the "favorite-only" chip and tile stars; keep this as a helper.
  function toggleFavoriteFilter() {
    favoritesOnly.value = !favoritesOnly.value;
  }

  return {
    // list/state
    boxEntries,
    selectedBoxId,
    importText,
    importStatus,
    boxFilter,
    boxSortKey,
    boxSortDir,
    filterJoinMode,
    subSkillJoinMode,
    selectedSpecialties,
    selectedSubSkillEns,
    favoritesOnly,
    inCalculatorOnly,

    // add form
    addName,
    addNameHasFocus,
    addNameSuggestOpen,
    isComposing,
    addLabel,
    addLevel,
    addExpRemaining,
    addExpType,
    addNature,
    addLookup,
    addSpecialty,
    addIngredientType,
    addSubLv10,
    addSubLv25,
    addSubLv50,
    addSubLv70,
    addSubLv80,
    addSubErrors,
    addFavorite,
    addSleepHours,

    // computed
    subSkillOptionLabels,
    ingredientTypeOptions,
    addNameSuggestList,
    showAddNameSuggest,
    relinkName,
    relinkOpen,
    relinkStatus,
    relinkFound,
    relinkSuggestList,
    showRelinkSuggest,
    selectedBox,
    selectedDetail,
    selectedNature,
    selectedSpecialtySelectValue,
    availableSubSkills,
    sortedBoxEntries,
    detailInsertAfterIndex,
    boxListEl,

    // actions
    onImport,
    onCreateManual,
    onDeleteSelected,
    onClearBox,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    applySort,


    // handlers / helpers
    pickAddName,
    onAddNameFocus,
    onAddNameBlur,
    onAddNameInput,
    closeAddNameSuggest,
    onAddExpTypeChanged,
    onAddSpecialtyChanged,
    onAddIngredientTypeChanged,
    onAddExpRemainingCommit,
    onSubBlur,
    onSelectBox,
    onClearSelection,
    onClearBoxFilter,
    toggleSpecialty,
    toggleSubSkill,
    toggleFavoriteFilter,
    setCalculatorBoxIds,
    toggleSelectedFavorite,
    toggleFavoriteById,
    onRelinkInput,
    pickRelinkName,
    onRelinkBlur,
    onRelinkApply,
    setBoxLevel,
    onEditSelectedLabel,
    onEditSelectedLevel,
    onEditSelectedExpRemaining,
    setBoxSleepHours,
    onEditSelectedExpType,
    onEditSelectedNature,
    onBoxItemNatureChange,
    onEditSelectedIngredientType,
    onEditSelectedSpecialty,
    onBoxEditSubInput,
    onBoxEditSubBlur,
    boxEditSubInputs,
    boxEditSubErrors,
    displayPokemonName,
    displayBoxTitle,
    boxTileTypeClass,
    subSkillLabel,
    toIngredientLabel,
  };
}
