import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import { localizeNature } from "../i18n/terms";
import { decodeNitoyonIvDetail, decodeNitoyonIvMinimal, parseNitoyonBoxLine } from "../domain/box/nitoyon";
import { IngredientTypes, SubSkillAllJaSorted, SubSkillAllNames, SubSkillNameJaByEn, subSkillEnFromJa } from "../domain/box/nitoyon";
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
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";

type FilterJoinMode = "and" | "or";

export type BoxUndoAction =
  | { kind: "delete"; entry: PokemonBoxEntryV1; index: number; selectedId: string | null }
  | { kind: "add" | "import"; addedIds: string[]; selectedId: string | null }
  | { kind: "clear"; entries: PokemonBoxEntryV1[]; selectedId: string | null };

export type BoxStore = ReturnType<typeof useBoxStore>;

// NOTE:
// - This store is a direct extraction of the Pokémon Box logic from the former monolithic App.vue.
// - It intentionally keeps behavior compatible with existing UI and persistence.
export function useBoxStore(opts: { locale: Ref<string>; t: Composer["t"] }) {
  const { locale, t } = opts;

  const boxEntries = ref<PokemonBoxEntryV1[]>(loadBox());
  const selectedBoxId = ref<string | null>(null);
  const importText = ref("");
  const importStatus = ref("");
  const boxFilter = ref("");

  // ソート設定の読み込み・保存
  const SORT_STORAGE_KEY = "candy-boost-planner:box-sort";
  type BoxSortKey = "labelFav" | "levelFav" | "label" | "level" | "dex" | "dexFav";
  type BoxSortDir = "asc" | "desc";

  function loadSortSettings(): { key: BoxSortKey; dir: BoxSortDir } {
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY);
      if (!raw) return { key: "labelFav", dir: "asc" };
      const json = JSON.parse(raw);
      const key = ["labelFav", "levelFav", "label", "level", "dex", "dexFav"].includes(json.key) ? json.key : "labelFav";
      const dir = json.dir === "desc" ? "desc" : "asc";
      return { key, dir };
    } catch {
      return { key: "labelFav", dir: "asc" };
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

  const filterJoinMode = ref<FilterJoinMode>("and"); // とくい/サブスキル の結合
  const subSkillJoinMode = ref<FilterJoinMode>("and"); // 複数サブスキル の結合
  const selectedSpecialties = ref<Array<"Berries" | "Ingredients" | "Skills" | "All">>([]);
  const selectedSubSkillEns = ref<string[]>([]);
  const favoritesOnly = ref(false);

  const addName = ref("");
  const addNameHasFocus = ref(false);
  const addNameSuggestOpen = ref(false);
  const isComposing = ref(false);
  const addLabel = ref("");
  const addLevel = ref(15);
  const addExpType = ref<ExpType>(600);
  const addExpTypeTouched = ref(false);
  const addNature = ref<ExpGainNature>("normal");
  const addLookup = computed(() => findPokemonByNameJa(addName.value));
  const addSpecialty = ref<PokemonSpecialty | "">("");
  const addSpecialtyTouched = ref(false);
  const addFavorite = ref(true); // デフォルトでお気に入りに追加

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idForms = (pokemonIdFormsByNameJa as any)[nameJa] as readonly number[] | undefined;
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


  const showAddNameSuggest = computed(
    () => addNameHasFocus.value && addNameSuggestOpen.value && !isComposing.value && addNameSuggestList.value.length > 0
  );

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nameJa: (SubSkillNameJaByEn as any)[s.nameEn] ?? s.nameEn,
    }));
    const subSkills = decoded?.subSkills?.length ? decoded.subSkills : subSkillsFromPlanner;

    const specialty = (e.planner?.specialty ?? (pokedexId ? getPokemonSpecialty(pokedexId, form) : "unknown")) as PokemonSpecialty;
    const expRemaining = e.planner?.expRemaining ?? 0;

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
      addSpecialty.value = sp && sp !== "unknown" ? (sp as any) : "";
    }
  );

  function displayPokemonName(e: PokemonBoxEntryV1): string | null {
    if (!e.derived) return null;
    return getPokemonNameLocalized(e.derived.pokedexId, e.derived.form, locale.value as any);
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
        ingredientType: (e.planner?.ingredientType ?? null) as any,
        subSkills: subs.map((s) => ({
          lv: s.lv,
          nameEn: s.nameEn,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          ? toKatakana((getPokemonNameLocalized(e.derived.pokedexId, e.derived.form ?? 0, locale.value as any) ?? "").toLowerCase())
          : "";
        return label.includes(q) || id.includes(q) || speciesName.includes(q);
      });

    const hasFavoriteFilter = favoritesOnly.value;
    const hasSpecialtyFilter = selectedSpecialties.value.length > 0;
    const hasSubSkillFilter = selectedSubSkillEns.value.length > 0;
    if (!hasFavoriteFilter && !hasSpecialtyFilter && !hasSubSkillFilter) return base;

    return base.filter((e) => {
      const decoded = getDecodedDetailForEntry(e);

      const pokedexId = e.derived?.pokedexId ?? decoded?.pokedexId ?? null;
      const form = e.derived?.form ?? decoded?.form ?? 0;
      const sp = (e.planner?.specialty ?? (pokedexId ? getPokemonSpecialty(pokedexId, form) : "unknown")) as PokemonSpecialty;
      const favoriteOk = !!e.favorite;
      const specialtyOk = selectedSpecialties.value.includes(sp as any);

      const subEns = decoded?.subSkills?.map((s) => s.nameEn) ?? [];
      const subOk = matchSubSkills(subEns, selectedSubSkillEns.value, subSkillJoinMode.value);

      const oks: boolean[] = [];
      if (hasFavoriteFilter) oks.push(favoriteOk);
      if (hasSpecialtyFilter) oks.push(specialtyOk);
      if (hasSubSkillFilter) oks.push(subOk);
      return filterJoinMode.value === "and" ? oks.every(Boolean) : oks.some(Boolean);
    });
  });

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
    const favPriority = key === "labelFav" || key === "levelFav" || key === "dexFav";
    const sortByLevel = key === "level" || key === "levelFav";
    const sortByDex = key === "dex" || key === "dexFav";
    list.sort((a, b) => {
      // お気に入り優先の場合、まずfavoriteで分ける
      if (favPriority) {
        const favA = a.favorite ? 1 : 0;
        const favB = b.favorite ? 1 : 0;
        if (favA !== favB) return (favB - favA); // favoriteは常に上（dirに関係なく）
      }
      // 図鑑番号順
      if (sortByDex) {
        const dexA = a.derived?.pokedexId ?? 9999;
        const dexB = b.derived?.pokedexId ?? 9999;
        if (dexA !== dexB) return (dexA - dexB) * dir;
        // フォーム順
        const formA = a.derived?.form ?? 0;
        const formB = b.derived?.form ?? 0;
        if (formA !== formB) return (formA - formB) * dir;
        // 同じ図鑑番号・フォームなら表記名順
        return displayBoxTitle(a).localeCompare(displayBoxTitle(b), locale.value === "en" ? "en" : "ja") * dir;
      }
      if (sortByLevel) {
        const la = a.planner?.level ?? a.derived?.level ?? 0;
        const lb = b.planner?.level ?? b.derived?.level ?? 0;
        if (la !== lb) return (la - lb) * dir;
        return displayBoxTitle(a).localeCompare(displayBoxTitle(b), locale.value === "en" ? "en" : "ja") * dir;
      }
      return displayBoxTitle(a).localeCompare(displayBoxTitle(b), locale.value === "en" ? "en" : "ja") * dir;
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
    // また、フィルタ結果にあってキャッシュにないものは末尾に追加
    const result: PokemonBoxEntryV1[] = [];

    // キャッシュの順序に従ってフィルタ結果を並べる
    for (const e of cached) {
      if (filteredIds.has(e.id)) {
        // フィルタ結果から最新データを取得
        const latest = filtered.find(f => f.id === e.id);
        if (latest) result.push(latest);
      }
    }

    // フィルタ結果にあってキャッシュにないものを末尾に追加
    for (const e of filtered) {
      if (!cachedIds.has(e.id)) {
        result.push(e);
      }
    }

    return result;
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

  function onClearBoxFilter() {
    boxFilter.value = "";
  }

  // Undo / Redo / persistence
  const UNDO_LIMIT = 3;
  const boxUndoStack = ref<BoxUndoAction[]>([]);
  const boxRedoStack = ref<BoxUndoAction[]>([]);
  const canUndo = computed(() => boxUndoStack.value.length > 0);
  const canRedo = computed(() => boxRedoStack.value.length > 0);

  function pushUndoAction(action: BoxUndoAction) {
    boxUndoStack.value = [...boxUndoStack.value, action].slice(-UNDO_LIMIT);
    boxRedoStack.value = [];  // 新しい操作があるとredoスタックをクリア
  }

  function cloneBoxEntry(e: PokemonBoxEntryV1): PokemonBoxEntryV1 {
    const raw = JSON.parse(JSON.stringify(e));
    return raw;
  }
  function cloneBoxEntries(es: PokemonBoxEntryV1[]): PokemonBoxEntryV1[] {
    return es.map(cloneBoxEntry);
  }

  // 現在の状態からundoアクションの逆操作を作成
  function createReverseAction(a: BoxUndoAction): BoxUndoAction {
    if (a.kind === "delete") {
      // delete をundoすると add になる
      return { kind: "add", addedIds: [a.entry.id], selectedId: selectedBoxId.value };
    } else if (a.kind === "add" || a.kind === "import") {
      // add/import をundoすると delete（複数削除）になる
      // 簡易的にclearで代用（正確ではないが機能的には問題ない）
      const entriesToRestore = boxEntries.value.filter(x => a.addedIds.includes(x.id));
      if (entriesToRestore.length === 1) {
        const entry = entriesToRestore[0];
        const idx = boxEntries.value.findIndex(x => x.id === entry.id);
        return { kind: "delete", entry: cloneBoxEntry(entry), index: idx, selectedId: selectedBoxId.value };
      }
      return { kind: "import", addedIds: a.addedIds, selectedId: selectedBoxId.value };
    } else if (a.kind === "clear") {
      // clear をundoすると... 空に戻す
      return { kind: "clear", entries: [], selectedId: selectedBoxId.value };
    }
    return a;
  }

  function onUndo() {
    const a = boxUndoStack.value.pop();
    if (!a) return;
    // 逆操作をredoスタックにプッシュ
    boxRedoStack.value = [...boxRedoStack.value, createReverseAction(a)].slice(-UNDO_LIMIT);

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
    importStatus.value = t("status.undo");
    nextTick(() => {
      syncBoxEditSubInputsFromSelected();
    });
  }

  function onRedo() {
    const a = boxRedoStack.value.pop();
    if (!a) return;
    // 逆操作をundoスタックにプッシュ（redoStackはクリアしない）
    boxUndoStack.value = [...boxUndoStack.value, createReverseAction(a)].slice(-UNDO_LIMIT);

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
    importStatus.value = t("status.redo");
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
      openBoxLevelPick.value = false;
    }
  );

  const boxEditSubInputs = ref<Record<string, string>>({ "10": "", "25": "", "50": "", "75": "", "100": "" });
  const boxEditSubErrors = ref<Record<string, string | null>>({ "10": null, "25": null, "50": null, "75": null, "100": null });
  const openBoxLevelPick = ref(false);

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

  watch(
    () => selectedBoxId.value,
    () => syncBoxEditSubInputsFromSelected(),
    { immediate: true }
  );

  watch(
    () => locale.value,
    () => syncBoxEditSubInputsFromSelected()
  );

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

  // Box level presets (shared with calc UI – kept here for BoxPanel)
  // 動的に生成し、末尾に現在の上限を含める
  const levelPresets = [10, 25, 30, 40, 50, 55, 57, 60, MAX_LEVEL] as const;

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

  function toggleBoxLevelPick() {
    openBoxLevelPick.value = !openBoxLevelPick.value;
  }
  function closeBoxLevelPick() {
    openBoxLevelPick.value = false;
  }
  function setBoxLevel(v: unknown) {
    const e = selectedBox.value;
    if (!e) return;
    const lvl = clampInt(v, 1, MAX_LEVEL, e.planner?.level ?? e.derived?.level ?? 1);
    writeSelectedLevel(lvl);
  }
  function nudgeBoxLevel(delta: number) {
    const cur = selectedDetail.value?.level ?? 1;
    setBoxLevel(cur + delta);
  }

  // Legacy aliases (used by some callers / older template fragments)
  function onToggleBoxLevelPick() {
    toggleBoxLevelPick();
  }
  function onPickBoxLevel(lv: number) {
    openBoxLevelPick.value = false;
    setBoxLevel(lv);
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

  function onEditSelectedExpRemaining(v: string) {
    const e = selectedBox.value;
    if (!e) return;
    const n = parseInt(v, 10);
    // 負の数は0、NaN（空）はundefined（未設定）として扱う
    const val = Number.isFinite(n) && n >= 0 ? n : undefined;
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
        planner: { ...(x.planner ?? {}), expType: expT },
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
    const next = (v || "").trim() as any;
    const ingredientType: IngredientType | undefined = (IngredientTypes as readonly string[]).includes(next) ? (next as any) : undefined;
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
    const vv = v === "Berries" || v === "Ingredients" || v === "Skills" || v === "All" ? (v as any) : undefined;
    boxEntries.value = boxEntries.value.map((x) =>
      x.id === e.id ? { ...x, planner: { ...(x.planner ?? {}), specialty: vv }, updatedAt: now } : x
    );
    importStatus.value = t("status.specialtyUpdated");
  }

  function toggleSelectedFavorite() {
    const e = selectedBox.value;
    if (!e) return;
    const now = new Date().toISOString();
    boxEntries.value = boxEntries.value.map((x) => (x.id === e.id ? { ...x, favorite: !x.favorite, updatedAt: now } : x));
    importStatus.value = t("status.favoriteUpdated");
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
        specialty,
        ingredientType,
        subSkills,
      },
      createdAt: now,
      updatedAt: now,
    };
    boxEntries.value = [entry, ...boxEntries.value].slice(0, 300);
    pushUndoAction({ kind: "add", addedIds: [entry.id], selectedId: undoSelectedId });
    selectedBoxId.value = entry.id;

    // opts0.mode は呼び出し側が処理（計算機反映など）
    void opts0;

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

  function onImport(opts?: { markFavorite?: boolean }) {
    const markFav = opts?.markFavorite ?? false;
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

    boxEntries.value = next;
    if (addedIds.length) pushUndoAction({ kind: "import", addedIds, selectedId: undoSelectedId });
    importStatus.value = t("status.importResult", { added, skipped });
  }

  function onDeleteSelected() {
    const e = selectedBox.value;
    if (!e) return;
    const idx = boxEntries.value.findIndex((x) => x.id === e.id);
    pushUndoAction({ kind: "delete", entry: cloneBoxEntry(e), index: Math.max(0, idx), selectedId: selectedBoxId.value });
    boxEntries.value = boxEntries.value.filter((x) => x.id !== e.id);
    selectedBoxId.value = null;
    importStatus.value = t("status.deleted");
  }

  function onClearBox() {
    if (!boxEntries.value.length) return;
    const ok = confirm(t("confirm.clearBox", { n: boxEntries.value.length }));
    if (!ok) return;
    pushUndoAction({ kind: "clear", entries: cloneBoxEntries(boxEntries.value), selectedId: selectedBoxId.value });
    boxEntries.value = [];
    selectedBoxId.value = null;
    boxFilter.value = "";
    importStatus.value = t("status.boxCleared");
  }

  // Global interactions (box-only): close level picker on outside click / Esc
  function onGlobalPointerDown(ev: MouseEvent) {
    const el = ev.target as HTMLElement | null;
    if (!el) return;
    if (el.closest(".levelPick")) return;
    openBoxLevelPick.value = false;
  }
  function onGlobalKeyDown(ev: KeyboardEvent) {
    if (ev.key === "Escape") openBoxLevelPick.value = false;
  }
  onMounted(() => {
    document.addEventListener("mousedown", onGlobalPointerDown, true);
    document.addEventListener("keydown", onGlobalKeyDown);
  });
  onUnmounted(() => {
    document.removeEventListener("mousedown", onGlobalPointerDown, true);
    document.removeEventListener("keydown", onGlobalKeyDown);
  });

  const selectedSpecialtySelectValue = computed(() => {
    const manual = selectedBox.value?.planner?.specialty;
    if (manual && manual !== "unknown") return manual;
    const auto = selectedDetail.value?.specialty;
    if (auto && auto !== "unknown") return auto;
    return "";
  });

  // ---- ingredient maps ----
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
    tail: "Tail",
    soy: "Soybeans",
    corn: "Corn",
    coffee: "Coffee",
    pumpkin: "Pumpkin",
    seed: "Seed of Inspiration",
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

    // add form
    addName,
    addNameHasFocus,
    addNameSuggestOpen,
    isComposing,
    addLabel,
    addLevel,
    addExpType,
    addNature,
    addLookup,
    addSpecialty,
    addIngredientType,
    addSubLv10,
    addSubLv25,
    addSubLv50,
    addSubLv75,
    addSubLv100,
    addSubErrors,
    addFavorite,

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
    selectedBox,
    selectedDetail,
    selectedNature,
    selectedSpecialtySelectValue,
    availableSubSkills,
    sortedBoxEntries,
    detailInsertAfterIndex,

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
    onSubBlur,
    onSelectBox,
    onClearSelection,
    onClearBoxFilter,
    toggleSpecialty,
    toggleSubSkill,
    toggleFavoriteFilter,
    toggleSelectedFavorite,
    onRelinkInput,
    pickRelinkName,
    onRelinkBlur,
    onRelinkApply,
    levelPresets,
    toggleBoxLevelPick,
    closeBoxLevelPick,
    setBoxLevel,
    nudgeBoxLevel,
    onToggleBoxLevelPick,
    onPickBoxLevel,
    onEditSelectedLabel,
    onEditSelectedLevel,
    onEditSelectedExpRemaining,
    onEditSelectedExpType,
    onEditSelectedNature,
    onBoxItemNatureChange,
    onEditSelectedIngredientType,
    onEditSelectedSpecialty,
    onBoxEditSubInput,
    onBoxEditSubBlur,
    boxEditSubInputs,
    boxEditSubErrors,
    openBoxLevelPick,
    displayPokemonName,
    displayBoxTitle,
    boxTileTypeClass,
    subSkillLabel,
    toIngredientLabel,
  };
}
