import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  assertNoUnknownFormLabels,
  assertValidFormJaToNumberMap,
  collectUnknownFormLabels,
  splitPokemonNameAndForm,
} from "./pokemon-form-resolution.mjs";
import {
  MAX_DEX_NO,
  MAX_FORM_NO,
  encodeIdForm,
  isValidDexNo,
  isValidFormNo,
  parsePokemonMasterEntriesFromTs,
  sanitizeSingleLineComment,
  validatePokemonDbPayload,
} from "./pokemon-db-validation.mjs";
import {
  KNOWN_INGREDIENT_KEYS,
  assertNoIngredientMappingIssues,
  isIngredientsNullPokemon,
  loadIngredientsNullSet,
  resolveIngredientSlot,
} from "./pokemon-ingredient-resolution.mjs";
import { acquirePublishLocks } from "./publish-lock.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DB_JSON = path.join(__dirname, "../src/domain/pokesleep/_generated/pokemon-db.json");
const DEFAULT_OVERRIDES = path.join(__dirname, "./exp-type-overrides.json");
const DEFAULT_KNOWN = path.join(__dirname, "./exp-type-known.json");
const DEFAULT_ING_NULL_KNOWN = path.join(__dirname, "./ing-null-known.json");
const DEFAULT_ING_C_NULL_KNOWN = path.join(__dirname, "./ing-c-null-known.json");
const DEFAULT_FORM_JA_TO_NUMBER = path.join(__dirname, "./form-ja-to-number.json");
const DEFAULT_FORM_LABEL_JA_TO_EN = path.join(__dirname, "./form-label-ja-to-en.json");
const DEFAULT_FORM_ALIASES = path.join(__dirname, "./form-aliases.json");
const DEFAULT_OUT_FORM_LABEL_TS = path.join(__dirname, "../src/domain/pokesleep/_generated/form-label-ja-to-en.ts");
const DEFAULT_OUT_MASTER = path.join(__dirname, "../src/domain/pokesleep/pokemon-master.ts");
const DEFAULT_OUT_INDEX = path.join(__dirname, "../src/domain/pokesleep/pokemon-names.ts");
const DEFAULT_TEST_CONFIG = path.join(__dirname, "../tests/fixtures/test-config.json");


function parseArgs(argv) {
  const out = {
    dbJson: DEFAULT_DB_JSON,
    overrides: DEFAULT_OVERRIDES,
    known: DEFAULT_KNOWN,
    ingCNullKnown: DEFAULT_ING_C_NULL_KNOWN,
    formJaToNumber: DEFAULT_FORM_JA_TO_NUMBER,
    formLabelJaToEn: DEFAULT_FORM_LABEL_JA_TO_EN,
    formAliases: DEFAULT_FORM_ALIASES,
    outFormLabelTs: DEFAULT_OUT_FORM_LABEL_TS,
    outMaster: DEFAULT_OUT_MASTER,
    outIndex: DEFAULT_OUT_INDEX,
    testConfig: null,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db" && argv[i + 1]) {
      out.dbJson = argv[++i];
      continue;
    }
    if (a === "--overrides" && argv[i + 1]) {
      out.overrides = argv[++i];
      continue;
    }
    if (a === "--known" && argv[i + 1]) {
      out.known = argv[++i];
      continue;
    }
    if (a === "--ing-c-null-known" && argv[i + 1]) {
      out.ingCNullKnown = argv[++i];
      continue;
    }
    if (a === "--form-ja-to-number" && argv[i + 1]) {
      out.formJaToNumber = argv[++i];
      continue;
    }
    if (a === "--form-label-ja-to-en" && argv[i + 1]) {
      out.formLabelJaToEn = argv[++i];
      continue;
    }
    if (a === "--form-aliases" && argv[i + 1]) {
      out.formAliases = argv[++i];
      continue;
    }
    if (a === "--out-form-label-ts" && argv[i + 1]) {
      out.outFormLabelTs = argv[++i];
      continue;
    }
    if (a === "--out-master" && argv[i + 1]) {
      out.outMaster = argv[++i];
      continue;
    }
    if (a === "--out-index" && argv[i + 1]) {
      out.outIndex = argv[++i];
      continue;
    }
    if (a === "--test-config" && argv[i + 1]) {
      out.testConfig = argv[++i];
      continue;
    }
    if (a === "--interactive") {
      out.interactive = true;
      continue;
    }
    if (a === "--non-interactive") {
      out.interactive = false;
      continue;
    }
    if (a === "--dry-run") {
      out.dryRun = true;
      continue;
    }
  }
  return out;
}

const args = parseArgs(process.argv);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function hasFileContentChanged(p, content) {
  if (!fs.existsSync(p)) return true;
  const prev = fs.readFileSync(p, "utf8");
  // 改行コード（CRLF/LF）を正規化して比較
  const normalizedPrev = prev.replace(/\r\n/g, "\n");
  const normalizedContent = content.replace(/\r\n/g, "\n");
  return normalizedPrev !== normalizedContent;
}

function writeTextIfChanged(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!hasFileContentChanged(p, content)) return false;
  // dryRun モードでは書き込みをスキップ
  if (args.dryRun) {
    return true; // 変更があることは報告
  }
  fs.writeFileSync(p, content, "utf8");
  return true;
}


function normalize(s) {
  return String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeBerryLabel(s) {
  const t0 = normalize(s);
  if (!t0) return null;
  // Wikiの表セルで「空」を表すプレースホルダ
  if (/^spacer(\.gif)?$/i.test(t0)) return null;
  // 画像ファイル名が混ざることがあるので拡張子は落とす
  const t = t0.replace(/\.(png|gif|jpg|jpeg|webp)$/i, "");
  return t || null;
}

// Wikiの「得意」表記（日本語）→ canonical
function normalizeSpecialtyJa(s) {
  const t = normalize(s);
  if (t.includes("きのみ")) return "Berries";
  if (t.includes("食材")) return "Ingredients";
  if (t.includes("スキル")) return "Skills";
  if (t.includes("オール")) return "All";
  return "unknown";
}

// Pokemon Sleep: 1ポケモン=単タイプ（複合タイプ無し）
// きのみ（ベリー）からタイプを逆引きする
// refs:
// - list: https://wikiwiki.jp/poke_sleep/%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3%E3%81%AE%E4%B8%80%E8%A6%A7
// - berries: https://wikiwiki.jp/poke_sleep/%E3%81%8D%E3%81%AE%E3%81%BF
const berryJaToType = {
  "キーのみ": "Normal",
  "ヒメリのみ": "Fire",
  "オレンのみ": "Water",
  "ウブのみ": "Electric",
  "ドリのみ": "Grass",
  "チーゴのみ": "Ice",
  "クラボのみ": "Fighting",
  "カゴのみ": "Poison",
  "フィラのみ": "Ground",
  "シーヤのみ": "Flying",
  "マゴのみ": "Psychic",
  "ラムのみ": "Bug",
  "オボンのみ": "Rock",
  "ブリーのみ": "Ghost",
  "ヤチェのみ": "Dragon",
  "ウイのみ": "Dark",
  "ベリブのみ": "Steel",
  "モモンのみ": "Fairy",
};

const typeToJa = {
  Normal: "ノーマル",
  Fire: "ほのお",
  Water: "みず",
  Electric: "でんき",
  Grass: "くさ",
  Ice: "こおり",
  Fighting: "かくとう",
  Poison: "どく",
  Ground: "じめん",
  Flying: "ひこう",
  Psychic: "エスパー",
  Bug: "むし",
  Rock: "いわ",
  Ghost: "ゴースト",
  Dragon: "ドラゴン",
  Dark: "あく",
  Steel: "はがね",
  Fairy: "フェアリー",
  unknown: "不明",
};

// Wikiの日本語名から form を推定（idForm互換の番号に寄せる）
function toIdForm(pokedexId, form) {
  return encodeIdForm(pokedexId, form);
}

function parseOverrides(obj) {
  const map = new Map();
  for (const [k, v] of Object.entries(obj ?? {})) {
    const n = Number(k);
    const t = Number(v);
    if (!Number.isFinite(n)) continue;
    if (t === 900 || t === 1080 || t === 1320) map.set(n, t);
  }
  return map;
}

function overridesToJson(map) {
  const obj = {};
  const keys = [...map.keys()].sort((a, b) => a - b);
  for (const k of keys) obj[String(k)] = map.get(k);
  return obj;
}

function createAsk() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    question: (q) => new Promise((resolve) => rl.question(q, resolve)),
    close: () => rl.close(),
  };
}

async function confirmOrAbort({ interactive, title, details }) {
  const canPrompt = !!(interactive && process.stdin.isTTY && process.stdout.isTTY);
  if (!canPrompt) {
    if (details) console.log(details);
    return true;
  }
  console.log(`\n[confirm] ${title}`);
  if (details) console.log(details);
  const ask = createAsk();
  try {
    const ans = normalize(
      await ask.question(
        `\nこの内容で MasterDB を更新しますか？ [y/N]\n> `
      )
    ).toLowerCase();
    if (ans === "y" || ans === "yes") return true;
    throw new Error("中断しました（確認でNo）");
  } finally {
    ask.close();
  }
}

async function resolveExpTypeForDexNo({ dexNo, nameJa, overrides, interactive, newlySeen }) {
  if (overrides.has(dexNo)) return overrides.get(dexNo);
  if (!newlySeen) return 600;
  const canPrompt = !!(interactive && process.stdin.isTTY && process.stdout.isTTY);
  if (!canPrompt) return 600;
  const ask = createAsk();
  try {
    // a/b/cショートカット（空入力は受け付けない）
    while (true) {
      const ans = normalize(
        await ask.question(
          `expType を入力してください: #${dexNo} ${nameJa}\n` +
          `  a=600 / b=900 / c=1080 / d=1320 / q=中断\n> `
        )
      ).toLowerCase();
      if (!ans) {
        console.log("入力が必要です。a/b/c/d または 600/900/1080/1320 を入力してください。");
        continue;
      }
      if (ans === "q") throw new Error("中断しました");
      if (ans === "a") return 600;
      if (ans === "b") return 900;
      if (ans === "c") return 1080;
      if (ans === "d") return 1320;
      const n = Number(ans);
      if (n === 600 || n === 900 || n === 1080 || n === 1320) return n;
      console.log("入力が不正です。a/b/c/d または 600/900/1080/1320 を入力してください。");
    }
  } finally {
    ask.close();
  }
}

function compareUsedFields(a, b) {
  const fields = [
    "nameJa",
    "baseNameJa",
    "formLabelJa",
    "specialty",
    "type",
    "typeJa",
    "expType",
    "ingredients",
  ];
  const diffs = [];
  for (const field of fields) {
    if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
      diffs.push(`${field}: ${JSON.stringify(a[field])} !== ${JSON.stringify(b[field])}`);
    }
  }
  return diffs;
}

// 通常実行時は、入力ソース（DB・対応表・エイリアス）と公開先ファイル群に対して
// 初回読み込み前から書き込み完了まで共通排他ロックを保持する（verify:forms 等との競合・巻き戻し防止）
const masterOutResolved = path.resolve(args.outMaster);
const testConfigResolved = args.testConfig
  ? path.resolve(args.testConfig)
  : path.resolve(DEFAULT_TEST_CONFIG);
const canUpdateTestConfig =
  Boolean(args.testConfig) || masterOutResolved === path.resolve(DEFAULT_OUT_MASTER);
const masterLockTargets = args.dryRun
  ? []
  : [
      path.resolve(args.dbJson),
      masterOutResolved,
      path.resolve(args.outIndex),
      path.resolve(args.outFormLabelTs),
      path.resolve(args.known),
      path.resolve(args.overrides),
      path.resolve(args.ingCNullKnown),
      path.resolve(args.formJaToNumber),
      path.resolve(args.formLabelJaToEn),
      path.resolve(args.formAliases),
      ...(canUpdateTestConfig ? [testConfigResolved] : []),
    ];
const releaseMasterLocks = masterLockTargets.length > 0 ? acquirePublishLocks(masterLockTargets) : () => {};
function exitWithUnlock(code) {
  releaseMasterLocks();
  process.exit(code);
}

try {
// 外部JSONから読み込み
const formJaToNumberPath = path.resolve(args.formJaToNumber);
const formJaToNumber = fs.existsSync(formJaToNumberPath) ? readJson(formJaToNumberPath) : {};
assertValidFormJaToNumberMap(formJaToNumber, formJaToNumberPath);
let formJaToNumberChanged = false;

// フォーム名の英訳（外部JSONから読み込み）
const formLabelJaToEnPath = path.resolve(args.formLabelJaToEn);
const formLabelJaToEn = fs.existsSync(formLabelJaToEnPath) ? readJson(formLabelJaToEnPath) : {};
let formLabelJaToEnChanged = false;

const dbPath = path.resolve(args.dbJson);
let db;
try {
  db = validatePokemonDbPayload(readJson(dbPath), dbPath);
} catch (err) {
  console.error(`\n[ERROR] 入力 DB が不正です: ${err instanceof Error ? err.message : String(err)}\n`);
  exitWithUnlock(1);
}
const items = db.items;

const overridesPath = path.resolve(args.overrides);
const overridesObj = fs.existsSync(overridesPath) ? readJson(overridesPath) : {};
const overrides = parseOverrides(overridesObj);
let overridesChanged = false;

// 既知Noリスト（前回までに処理したdexNo）: ここに無いdexNoだけ対話で確認する
const knownPath = path.resolve(args.known);
const knownArr = fs.existsSync(knownPath) ? readJson(knownPath) : [];
const knownDexNos = new Set(Array.isArray(knownArr) ? knownArr.map(Number).filter(Number.isFinite) : []);

// ---------------------------------------------------------------------------
// Pre-scan: メインループ前に未知フォーム名を検出し、対話で解決する
// ---------------------------------------------------------------------------
// メインループ内で未知フォームが form=0 にフォールバックされると、通常フォームの
// インデックスを上書きしてしまう。これを防ぐため、メインループの前にフォーム名を
// 走査し、未登録のものがあれば先に解決する。
const preUnknownFormLabels = collectUnknownFormLabels(items, formJaToNumber);
if (preUnknownFormLabels.size > 0 && !(args.interactive && process.stdin.isTTY && process.stdout.isTTY)) {
  // 非対話モード: 未知フォーム名があればエラー終了
  const unknownList = [...preUnknownFormLabels].sort();
  console.error(`\n[ERROR] 未知のフォーム名が ${unknownList.length} 件あります。`);
  console.error(`form-ja-to-number.json に登録されていないフォーム名が Wiki データに含まれています。`);
  console.error(`該当するフォーム名を form-ja-to-number.json と form-label-ja-to-en.json に追加してください。\n`);
  for (const label of unknownList) {
    // 該当ポケモンを特定
    const affected = items.filter(it => {
      const { formLabelJa } = splitPokemonNameAndForm(it.nameJa, formJaToNumber);
      return formLabelJa === label;
    });
    const examples = affected.slice(0, 3).map(x => `#${x.dexNo} ${normalize(x.nameJa)}`).join(", ");
    console.error(`  "${label}" → form=0 にフォールバック中 (例: ${examples})`);
  }
  console.error(``);
  exitWithUnlock(1);
}

if (preUnknownFormLabels.size > 0 && args.interactive && process.stdin.isTTY && process.stdout.isTTY) {
  const unknownList = [...preUnknownFormLabels].sort();

  console.log(`\n[未知のフォーム名] ${unknownList.length}件`);
  for (const label of unknownList) {
    console.log(`  ${label}`);
  }

  const ask = createAsk();
  try {
    while (true) {
      const ans = normalize(
        await ask.question(`\nこれらをフォームリスト (form-ja-to-number.json) に追加しますか？ [y/n]\n> `)
      ).toLowerCase();
      if (ans === "y" || ans === "yes") {
        for (const label of unknownList) {
          // フォーム番号を手動入力（にとよんツール側の番号に合わせる必要があるため自動採番しない）
          while (true) {
            const numAns = normalize(
              await ask.question(`  "${label}" のフォーム番号を入力してください (にとよんツール PokemonIv.ts の formMap 参照): `)
            );
            const num = Number(numAns);
            if (Number.isFinite(num) && num > 0 && Number.isInteger(num)) {
              formJaToNumber[label] = num;
              console.log(`[generate-pokemon-master] "${label}" を form=${num} で追加`);
              break;
            }
            console.log("  正の整数を入力してください。");
          }

          // 英訳も聞く（必須）
          while (true) {
            const enAns = normalize(
              await ask.question(`  "${label}" の英訳を入力してください: `)
            );
            if (enAns) {
              formLabelJaToEn[label] = enAns;
              formLabelJaToEnChanged = true;
              console.log(`[generate-pokemon-master] "${label}" → "${enAns}" を英訳リストに追加`);
              break;
            }
            console.log("  入力が必要です。英訳を入力してください。");
          }
        }
        formJaToNumberChanged = true;
        break;
      }
      if (ans === "n" || ans === "no") {
        // 未知フォームを未解決のまま生成すると form=0 の通常フォームと衝突するため、
        // 登録しない場合は生成処理自体を中断する。
        const confirm = normalize(
          await ask.question(`⚠️  未知フォームを登録せず、MasterDB の生成を中断しますか？ [y/n]\n> `)
        ).toLowerCase();
        if (confirm === "y" || confirm === "yes") {
          break;
        }
        // n なら最初の質問に戻る
        continue;
      }
      console.log("入力が必要です。y または n を入力してください。");
    }
  } finally {
    ask.close();
  }
}

// 対話で登録しなかった場合を含め、未知フォームを残したまま生成へ進ませない。
assertNoUnknownFormLabels(items, formJaToNumber);

// 食材 null（A/B 任意選択の幻ポケモン等）の許可リスト（単一情報源）
const ingNullKnownPath = path.resolve(DEFAULT_ING_NULL_KNOWN);
const ingNullKnownSet = loadIngredientsNullSet(ingNullKnownPath);

// 未知の食材名・複数候補・A/B 欠損があると ingredients=null に落ちてしまうため、生成前に中断する。
try {
  assertNoIngredientMappingIssues(items, formJaToNumber, ingNullKnownSet);
} catch (err) {
  console.error(`\n[ERROR] ${err instanceof Error ? err.message : String(err)}\n`);
  exitWithUnlock(1);
}

const master = [];
const nameJaByIdForm = {};
const expTypeByIdForm = {};
const specialtyByIdForm = {};
const ingredientsByIdForm = {};
const typeByIdForm = {};
const typeJaByIdForm = {};
const idFormsByNameJa = {};
const seenByIdForm = new Map();
const duplicateConflicts = [];
let deduplicatedCount = 0;

for (const it of items) {
  const dexNo = Number(it.dexNo);
  if (!Number.isFinite(dexNo)) continue;
  const nameJa = normalize(it.nameJa);
  if (!nameJa) continue;
  const { form, formLabelJa, baseNameJa } = splitPokemonNameAndForm(nameJa, formJaToNumber);
  if (form === null) {
    console.error(`\n[ERROR] 未知フォームが未解決です: #${dexNo} ${nameJa}\n`);
    exitWithUnlock(1);
  }
  const idForm = toIdForm(dexNo, form);

  const specialty = normalizeSpecialtyJa(it.specialtyJa);
  const newlySeen = !knownDexNos.has(dexNo);
  const expType = await resolveExpTypeForDexNo({
    dexNo,
    nameJa,
    overrides,
    interactive: args.interactive,
    newlySeen,
  });
  // 処理済みとして記録（600でも記録）
  knownDexNos.add(dexNo);

  // non-600だけ例外表に保持
  if (expType !== 600 && !overrides.has(dexNo)) {
    overrides.set(dexNo, expType);
    overridesChanged = true;
  }

  let ingAKey = resolveIngredientSlot(it.ingAJa).key;
  let ingBKey = resolveIngredientSlot(it.ingBJa).key;
  let ingCKey = resolveIngredientSlot(it.ingCJa).key;

  const berryJa0 = Array.isArray(it.berryJa) ? normalizeBerryLabel(it.berryJa[0]) : null;
  const type = berryJa0 ? (berryJaToType[berryJa0] ?? "unknown") : "unknown";
  const typeJa = typeToJa[type] ?? "不明";

  // 食材A/B/Cの割り当てをユーザーが自由に変更できる特殊仕様のポケモン（ing-null-known.json）
  // 人によってA/B/Cが異なるため、Wikiに食材データがあっても ingredients=null に固定する
  const isIngredientsNull = isIngredientsNullPokemon(dexNo, form, ingNullKnownSet);
  if (isIngredientsNull) {
    ingAKey = null;
    ingBKey = null;
    ingCKey = null;
  }

  const entry = {
    dexNo,
    pokedexId: dexNo,
    form,
    formLabelJa,
    nameJa,
    baseNameJa,
    specialty,
    type,
    typeJa,
    expType,
    ingredients: ingAKey && ingBKey ? { a: ingAKey, b: ingBKey, c: ingCKey } : null,
    link: it.link ? String(it.link) : null,
  };

  // 同一 idForm の重複行は利用フィールドが完全一致する場合のみ重複排除し、食い違えば停止する。
  // link は片方のみ有効 URL なら保持し、異なる有効 URL が複数ある場合は矛盾として停止する。
  const prevEntry = seenByIdForm.get(idForm);
  if (prevEntry) {
    const diffs = compareUsedFields(prevEntry, entry);
    if (prevEntry.link && entry.link && prevEntry.link !== entry.link) {
      diffs.push(`link: ${JSON.stringify(prevEntry.link)} !== ${JSON.stringify(entry.link)}`);
    } else if (!prevEntry.link && entry.link) {
      prevEntry.link = entry.link;
    }
    if (diffs.length > 0) {
      duplicateConflicts.push({ idForm, dexNo, nameJa, diffs });
    } else {
      deduplicatedCount++;
    }
    continue;
  }
  seenByIdForm.set(idForm, entry);

  master.push(entry);

  nameJaByIdForm[String(idForm)] = nameJa;
  expTypeByIdForm[String(idForm)] = expType;
  specialtyByIdForm[String(idForm)] = specialty;
  typeByIdForm[String(idForm)] = type;
  typeJaByIdForm[String(idForm)] = typeJa;
  if (ingAKey && ingBKey) {
    ingredientsByIdForm[String(idForm)] = { a: ingAKey, b: ingBKey, c: ingCKey ?? null };
  }

  if (!idFormsByNameJa[nameJa]) idFormsByNameJa[nameJa] = [];
  idFormsByNameJa[nameJa].push(idForm);
}

if (duplicateConflicts.length > 0) {
  console.error(`\n[ERROR] 同一 idForm の重複 Wiki 行でフィールドが食い違っています (${duplicateConflicts.length}件):`);
  for (const c of duplicateConflicts) {
    console.error(`  - idForm=${c.idForm} (#${c.dexNo} ${c.nameJa}): ${c.diffs.join(" / ")}`);
  }
  console.error("  Wiki の記載またはフォームマッピングを確認してください。\n");
  exitWithUnlock(1);
}

// --- フォームエイリアス：にとよんツール側のform番号とWiki/master側が異なるポケモンの補完 ---
// form-aliases.json: { "dexNo:nitoyonForm": masterForm, "_ingredientOverrides": { "25:6": { a, b, c } | null }, ... }
const formAliasesPath = path.resolve(args.formAliases);
const formAliasesRaw = fs.existsSync(formAliasesPath) ? readJson(formAliasesPath) : {};
const ingredientOverridesRaw =
  formAliasesRaw._ingredientOverrides &&
  typeof formAliasesRaw._ingredientOverrides === "object" &&
  !Array.isArray(formAliasesRaw._ingredientOverrides)
    ? formAliasesRaw._ingredientOverrides
    : {};
const knownIngredientKeySet = new Set(KNOWN_INGREDIENT_KEYS);
let formAliasCount = 0;

for (const [key, canonicalForm] of Object.entries(formAliasesRaw)) {
  if (key.startsWith("_")) continue; // _comment / _normalFallbackReasons / _ingredientOverrides 等をスキップ
  const parts = key.split(":");
  const dexNo = parts.length === 2 && /^\d+$/.test(parts[0]) ? Number(parts[0]) : NaN;
  const aliasForm = parts.length === 2 && /^\d+$/.test(parts[1]) ? Number(parts[1]) : NaN;
  const canonical = typeof canonicalForm === "number" ? canonicalForm : NaN;
  if (!isValidDexNo(dexNo) || !isValidFormNo(aliasForm) || !isValidFormNo(canonical)) {
    console.error(
      `\n[ERROR] form-aliases.json のエントリ "${key}": ${JSON.stringify(canonicalForm)} が不正です` +
      `（dexNo は 1..${MAX_DEX_NO}、form は 0..${MAX_FORM_NO} の整数である必要があります）。\n`,
    );
    exitWithUnlock(1);
  }
  if (aliasForm === canonical) continue; // 同じなら不要

  const canonicalIdForm = toIdForm(dexNo, canonical);
  const aliasIdForm = toIdForm(dexNo, aliasForm);
  const ck = String(canonicalIdForm);
  const ak = String(aliasIdForm);

  // 直接行がすでに存在する idForm に旧エイリアスが残っている場合は、
  // 上書きによる不整合を防ぐためエラー停止して整理を促す（verify-form-mapping と同一規則）。
  if (Object.hasOwn(nameJaByIdForm, ak)) {
    console.error(
      `\n[ERROR] 直接行が存在する idForm=${ak} (form-aliases.json の "${key}": ${canonical}) に旧エイリアスが残っています。\n` +
      `  scripts/form-aliases.json から "${key}" と付随する _ingredientOverrides / _normalFallbackReasons を削除してください。\n`,
    );
    exitWithUnlock(1);
  }

  // canonical側のデータが存在する場合のみエイリアスを登録
  if (nameJaByIdForm[ck]) {
    nameJaByIdForm[ak] = nameJaByIdForm[ck];
    expTypeByIdForm[ak] = expTypeByIdForm[ck];
    specialtyByIdForm[ak] = specialtyByIdForm[ck];
    typeByIdForm[ak] = typeByIdForm[ck];
    typeJaByIdForm[ak] = typeJaByIdForm[ck];

    if (Object.hasOwn(ingredientOverridesRaw, key)) {
      const overrideVal = ingredientOverridesRaw[key];
      if (overrideVal === null) {
        // 明示的に食材未解決扱いとする（ingredientsByIdForm[ak] を設定しない）
      } else if (
        overrideVal &&
        typeof overrideVal === "object" &&
        !Array.isArray(overrideVal) &&
        typeof overrideVal.a === "string" &&
        typeof overrideVal.b === "string" &&
        (overrideVal.c === null || overrideVal.c === undefined || typeof overrideVal.c === "string") &&
        knownIngredientKeySet.has(overrideVal.a) &&
        knownIngredientKeySet.has(overrideVal.b) &&
        (overrideVal.c === null || overrideVal.c === undefined || knownIngredientKeySet.has(overrideVal.c))
      ) {
        ingredientsByIdForm[ak] = {
          a: overrideVal.a,
          b: overrideVal.b,
          c: overrideVal.c ?? null,
        };
      } else {
        console.error(`\n[ERROR] form-aliases.json の _ingredientOverrides["${key}"] が不正です: ${JSON.stringify(overrideVal)}\n`);
        exitWithUnlock(1);
      }
    } else if (ingredientsByIdForm[ck]) {
      ingredientsByIdForm[ak] = ingredientsByIdForm[ck];
    }

    // idFormsByNameJa にもエイリアスのidFormを追加
    const name = nameJaByIdForm[ck];
    if (idFormsByNameJa[name] && !idFormsByNameJa[name].includes(aliasIdForm)) {
      idFormsByNameJa[name].push(aliasIdForm);
    }
    formAliasCount++;
  } else {
    console.warn(`[form-aliases] canonical not found: dexNo=${dexNo} form=${canonical} (alias form=${aliasForm})`);
  }
}
if (formAliasCount > 0) {
  console.log(`[generate-pokemon-master] form aliases applied: ${formAliasCount}`);
}

// --- 差分検出：既存のMasterDBと比較（verify-form-mapping と共通の AST 読み取りを使用） ---
const readExistingIdForms = () => {
  const masterPath = path.resolve(args.outMaster);
  if (!fs.existsSync(masterPath)) return new Set();
  const txt = fs.readFileSync(masterPath, "utf8");
  try {
    return new Set(parsePokemonMasterEntriesFromTs(txt, masterPath).map((e) => e.idForm));
  } catch (e) {
    console.error(`\n[ERROR] 既存の ${masterPath} の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}\n`);
    exitWithUnlock(1);
  }
};

const existingIdForms = readExistingIdForms();
const newIdForms = new Set(master.map(x => toIdForm(x.dexNo, x.form)));

const addedEntries = master.filter(x => !existingIdForms.has(toIdForm(x.dexNo, x.form)));
const removedIdForms = [...existingIdForms].filter(id => !newIdForms.has(id));

// 出力順序を確定してから生成予定コンテンツと現行ファイルの差分を判定する
master.sort((a, b) => (a.dexNo - b.dexNo) || (a.form - b.form) || a.nameJa.localeCompare(b.nameJa, "ja"));

for (const k of Object.keys(idFormsByNameJa)) {
  idFormsByNameJa[k] = [...new Set(idFormsByNameJa[k])].sort((a, b) => a - b);
}

const masterOut = path.resolve(args.outMaster);
const masterContent =
  `// This file is auto-generated by scripts/generate-pokemon-master.mjs\n` +
  `// Source: ${sanitizeSingleLineComment(db.source)}\n\n` +
  `export type PokemonSpecialty = "Berries" | "Ingredients" | "Skills" | "All" | "unknown";\n` +
  `export type PokemonType =\n` +
  `  | "Normal"\n` +
  `  | "Fire"\n` +
  `  | "Water"\n` +
  `  | "Electric"\n` +
  `  | "Grass"\n` +
  `  | "Ice"\n` +
  `  | "Fighting"\n` +
  `  | "Poison"\n` +
  `  | "Ground"\n` +
  `  | "Flying"\n` +
  `  | "Psychic"\n` +
  `  | "Bug"\n` +
  `  | "Rock"\n` +
  `  | "Ghost"\n` +
  `  | "Dragon"\n` +
  `  | "Dark"\n` +
  `  | "Steel"\n` +
  `  | "Fairy"\n` +
  `  | "unknown";\n` +
  `export type ExpType = 600 | 900 | 1080 | 1320;\n` +
  `export type PokemonIngredients = { a: string; b: string; c: string | null };\n` +
  `export type PokemonMasterEntry = {\n` +
  `  dexNo: number;\n` +
  `  pokedexId: number;\n` +
  `  form: number;\n` +
  `  formLabelJa: string | null;\n` +
  `  nameJa: string;\n` +
  `  baseNameJa: string;\n` +
  `  specialty: PokemonSpecialty;\n` +
  `  type: PokemonType;\n` +
  `  typeJa: string;\n` +
  `  expType: ExpType;\n` +
  `  ingredients: PokemonIngredients | null;\n` +
  `  link: string | null;\n` +
  `};\n\n` +
  `export const pokemonMaster: PokemonMasterEntry[] = ${JSON.stringify(master, null, 2)} as const;\n`;

const indexOut = path.resolve(args.outIndex);
const indexContent =
  `// This file is auto-generated by scripts/generate-pokemon-master.mjs\n\n` +
  `export type PokemonSpecialty = "Berries" | "Ingredients" | "Skills" | "All" | "unknown";\n\n` +
  `export type PokemonType =\n` +
  `  | "Normal"\n` +
  `  | "Fire"\n` +
  `  | "Water"\n` +
  `  | "Electric"\n` +
  `  | "Grass"\n` +
  `  | "Ice"\n` +
  `  | "Fighting"\n` +
  `  | "Poison"\n` +
  `  | "Ground"\n` +
  `  | "Flying"\n` +
  `  | "Psychic"\n` +
  `  | "Bug"\n` +
  `  | "Rock"\n` +
  `  | "Ghost"\n` +
  `  | "Dragon"\n` +
  `  | "Dark"\n` +
  `  | "Steel"\n` +
  `  | "Fairy"\n` +
  `  | "unknown";\n\n` +
  `export const pokemonNameJaByIdForm = ${JSON.stringify(nameJaByIdForm, null, 2)} as const;\n\n` +
  `export const pokemonExpTypeByIdForm = ${JSON.stringify(expTypeByIdForm, null, 2)} as const;\n\n` +
  `export const pokemonSpecialtyByIdForm = ${JSON.stringify(specialtyByIdForm, null, 2)} as const;\n\n` +
  `export const pokemonTypeByIdForm = ${JSON.stringify(typeByIdForm, null, 2)} as const;\n\n` +
  `export const pokemonTypeJaByIdForm = ${JSON.stringify(typeJaByIdForm, null, 2)} as const;\n\n` +
  `export const pokemonIngredientsByIdForm = ${JSON.stringify(ingredientsByIdForm, null, 2)} as const;\n\n` +
  `export const pokemonIdFormsByNameJa = ${JSON.stringify(idFormsByNameJa, null, 2)} as const;\n\n` +
  `export function toIdForm(pokedexId: number, form: number): number {\n` +
  `  return (pokedexId | 0) + ((form | 0) << 12);\n` +
  `}\n\n` +
  `export function getPokemonNameJa(pokedexId: number, form: number = 0): string | null {\n` +
  `  const k = String(toIdForm(pokedexId, form));\n` +
  `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n` +
  `  const v = (pokemonNameJaByIdForm as any)[k];\n` +
  `  return typeof v === "string" ? v : null;\n` +
  `}\n\n` +
  `export function getPokemonExpType(pokedexId: number, form: number = 0): 600 | 900 | 1080 | 1320 {\n` +
  `  const k = String(toIdForm(pokedexId, form));\n` +
  `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n` +
  `  const v = (pokemonExpTypeByIdForm as any)[k];\n` +
  `  return v === 600 || v === 900 || v === 1080 || v === 1320 ? v : 600;\n` +
  `}\n\n` +
  `export function getPokemonSpecialty(pokedexId: number, form: number = 0): PokemonSpecialty {\n` +
  `  const k = String(toIdForm(pokedexId, form));\n` +
  `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n` +
  `  const v = (pokemonSpecialtyByIdForm as any)[k];\n` +
  `  return v === "Berries" || v === "Ingredients" || v === "Skills" || v === "All" ? v : "unknown";\n` +
  `}\n\n` +
  `export function getPokemonType(pokedexId: number, form: number = 0): PokemonType {\n` +
  `  const k = String(toIdForm(pokedexId, form));\n` +
  `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n` +
  `  const v = (pokemonTypeByIdForm as any)[k];\n` +
  `  return typeof v === "string" ? (v as PokemonType) : "unknown";\n` +
  `}\n\n` +
  `export function getPokemonTypeJa(pokedexId: number, form: number = 0): string {\n` +
  `  const k = String(toIdForm(pokedexId, form));\n` +
  `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n` +
  `  const v = (pokemonTypeJaByIdForm as any)[k];\n` +
  `  return typeof v === "string" ? v : "不明";\n` +
  `}\n\n` +
  `export function getPokemonIngredients(pokedexId: number, form: number = 0): { a: string; b: string; c: string | null } | null {\n` +
  `  const k = String(toIdForm(pokedexId, form));\n` +
  `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n` +
  `  const v = (pokemonIngredientsByIdForm as any)[k];\n` +
  `  if (!v || typeof v !== "object") return null;\n` +
  `  const a = typeof v.a === "string" ? v.a : null;\n` +
  `  const b = typeof v.b === "string" ? v.b : null;\n` +
  `  const c = v.c === null || typeof v.c === "string" ? v.c : null;\n` +
  `  return a && b ? { a, b, c } : null;\n` +
  `}\n\n` +
  `export function findPokemonByNameJa(nameJa: string): { pokedexId: number; form: number; expType: 600 | 900 | 1080 | 1320 } | null {\n` +
  `  const key = String(nameJa ?? \"\").trim();\n` +
  `  if (!key) return null;\n` +
  `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n` +
  `  const list = (pokemonIdFormsByNameJa as any)[key];\n` +
  `  if (!Array.isArray(list) || list.length === 0) return null;\n` +
  `  const sorted = [...list].sort((a: number, b: number) => a - b);\n` +
  `  const idForm = Number(sorted[0]);\n` +
  `  const pokedexId = idForm & 0xfff;\n` +
  `  const form = idForm >> 12;\n` +
  `  const expType = getPokemonExpType(pokedexId, form);\n` +
  `  return { pokedexId, form, expType };\n` +
  `}\n`;

const formLabelTsOut = path.resolve(args.outFormLabelTs);
const formLabelTsContent =
  `// This file is auto-generated by scripts/generate-pokemon-master.mjs\n` +
  `// Source: scripts/form-label-ja-to-en.json\n\n` +
  `export const formLabelJaToEn: Record<string, string> = ${JSON.stringify(formLabelJaToEn, null, 2)};\n`;

const knownContent = JSON.stringify([...knownDexNos].sort((a, b) => a - b), null, 2) + "\n";
const overridesContent = JSON.stringify(overridesToJson(overrides), null, 2) + "\n";

const changedGeneratedFiles = [];
if (hasFileContentChanged(masterOut, masterContent)) changedGeneratedFiles.push(path.basename(masterOut));
if (hasFileContentChanged(indexOut, indexContent)) changedGeneratedFiles.push(path.basename(indexOut));
if (hasFileContentChanged(formLabelTsOut, formLabelTsContent)) changedGeneratedFiles.push(path.basename(formLabelTsOut));
if (hasFileContentChanged(knownPath, knownContent)) changedGeneratedFiles.push(path.basename(knownPath));
if (overridesChanged && hasFileContentChanged(overridesPath, overridesContent)) {
  changedGeneratedFiles.push(path.basename(overridesPath));
}

// --- preflight summary / confirm (write前に運用者確認) ---
// 食材C未実装の既知リストを読み込む
const ingCNullKnownPath = path.resolve(args.ingCNullKnown);
const ingCNullKnownArr = fs.existsSync(ingCNullKnownPath) ? readJson(ingCNullKnownPath) : [];
const ingCNullKnownSet = new Set(Array.isArray(ingCNullKnownArr) ? ingCNullKnownArr.map(Number).filter(Number.isFinite) : []);

const ingredientsNullKnown = master.filter((x) => x.ingredients === null);
const ingredientCNullAll = master.filter((x) => x.ingredients && x.ingredients.c === null);
const ingredientCNullKnown = ingredientCNullAll.filter((x) => ingCNullKnownSet.has(x.dexNo));
const ingredientCNullNew = ingredientCNullAll.filter((x) => !ingCNullKnownSet.has(x.dexNo));
const linkNullCount = master.filter((x) => x.link === null).length;

let details = "";
if (args.dryRun) {
  details += `[ドライランモード: ファイルは書き込まれません]\n\n`;
}
details += `- Wikiエントリ: ${items.length} (同一idForm重複排除: ${deduplicatedCount})\n`;
details += `- ユニーク種類: ${newIdForms.size} (既存: ${existingIdForms.size})\n`;
details += `- 追加: ${addedEntries.length}\n`;
details += `- 削除: ${removedIdForms.length}\n`;
details += `- 内容変更ファイル: ${changedGeneratedFiles.length}${changedGeneratedFiles.length ? " (" + changedGeneratedFiles.join(", ") + ")" : ""}\n`;
details += `- ingredients:null (既知): ${ingredientsNullKnown.length}${ingredientsNullKnown.length ? " (" + ingredientsNullKnown.map(x => `#${x.dexNo} ${x.nameJa}`).join(", ") + ")" : ""}\n`;
details += `- ingredients.c:null (既知): ${ingredientCNullKnown.length}\n`;
details += `- ingredients.c:null (新規): ${ingredientCNullNew.length}\n`;
details += `- link:null: ${linkNullCount}\n`;
details += `- unknown form labels (解決済み): ${preUnknownFormLabels.size}\n`;
if (formAliasCount > 0) {
  details += `- form aliases applied: ${formAliasCount}\n`;
}

// 追加されたポケモンを表示
if (addedEntries.length) {
  details += `\n[追加されるポケモン] ${addedEntries.length}件\n`;
  for (const x of addedEntries.slice(0, 15)) {
    details += `  + #${x.dexNo} ${x.nameJa}\n`;
  }
  if (addedEntries.length > 15) details += `  ... +${addedEntries.length - 15} more\n`;
}

// 削除されるポケモンを表示
if (removedIdForms.length) {
  details += `\n[削除されるポケモン] ${removedIdForms.length}件\n`;
  for (const idForm of removedIdForms.slice(0, 10)) {
    details += `  - idForm=${idForm}\n`;
  }
  if (removedIdForms.length > 10) details += `  ... +${removedIdForms.length - 10} more\n`;
}

if (changedGeneratedFiles.length && addedEntries.length === 0 && removedIdForms.length === 0) {
  details += `\n[内容変更されるファイル] ${changedGeneratedFiles.length}件\n`;
  for (const f of changedGeneratedFiles) {
    details += `  ~ ${f}\n`;
  }
}

if (ingredientCNullNew.length) {
  details += `\n[食材C未実装 (新規)]\n`;
  for (const x of ingredientCNullNew.slice(0, 10)) {
    details += `- #${x.dexNo} ${x.nameJa}\n`;
  }
  if (ingredientCNullNew.length > 10) details += `... +${ingredientCNullNew.length - 10} more\n`;
}

// ID増減だけでなく、既存ポケモンの食材・エイリアス・英訳等の内容差分も変更ありとして扱う
const hasChanges =
  changedGeneratedFiles.length > 0 ||
  addedEntries.length > 0 ||
  removedIdForms.length > 0 ||
  ingredientCNullNew.length > 0 ||
  formJaToNumberChanged ||
  formLabelJaToEnChanged;

// CI用の機械可読サマリー行
console.log(
  `[SUMMARY] has_changes=${hasChanges} 追加: ${addedEntries.length} 削除: ${removedIdForms.length} 内容変更: ${changedGeneratedFiles.length}`,
);

if (hasChanges) {
  await confirmOrAbort({
    interactive: args.interactive,
    title: "generate-pokemon-master",
    details,
  });
} else if (args.interactive && process.stdin.isTTY) {
  // 変更なし: サマリーだけ表示してスキップ
  console.log(`\n[confirm] generate-pokemon-master\n${details}`);
  console.log("変更なし: 確認をスキップして終了します。");
}

// 新規の食材C未実装を既知リストに追加するか確認
let ingCNullKnownChanged = false;
if (ingredientCNullNew.length > 0 && args.interactive && process.stdin.isTTY && process.stdout.isTTY) {
  const ask = createAsk();
  try {
    console.log(`\n[食材C未実装 (新規)] ${ingredientCNullNew.length}件`);
    for (const x of ingredientCNullNew) {
      console.log(`  #${x.dexNo} ${x.nameJa}`);
    }
    while (true) {
      const ans = normalize(
        await ask.question(`\nこれらを既知リスト (ing-c-null-known.json) に追加しますか？ [y/n]\n> `)
      ).toLowerCase();
      if (ans === "y" || ans === "yes") {
        for (const x of ingredientCNullNew) {
          ingCNullKnownSet.add(x.dexNo);
        }
        ingCNullKnownChanged = true;
        console.log(`[generate-pokemon-master] ${ingredientCNullNew.length}件を既知リストに追加します`);
        break;
      }
      if (ans === "n" || ans === "no") {
        // 確認警告
        const confirm = normalize(
          await ask.question(`⚠️  本当にスキップしますか？ 例外処理がある場合、後で scripts/ing-c-null-known.json の手動更新が必要です [y/n]\n> `)
        ).toLowerCase();
        if (confirm === "y" || confirm === "yes") {
          console.log(`[generate-pokemon-master] スキップしました`);
          break;
        }
        // n なら最初の質問に戻る
        continue;
      }
      console.log("入力が必要です。y または n を入力してください。");
    }
  } finally {
    ask.close();
  }
}

// E2Eテスト設定の最新ポケモン名を更新（明示指定または既定出力先の更新時のみ）
const testConfigPath = testConfigResolved;
const shouldUpdateTestConfig =
  addedEntries.length > 0 &&
  !args.dryRun &&
  canUpdateTestConfig;

const wroteMaster = writeTextIfChanged(masterOut, masterContent);
const wroteIndex = writeTextIfChanged(indexOut, indexContent);

if (overridesChanged) {
  const wroteOverrides = writeTextIfChanged(overridesPath, overridesContent);
  if (wroteOverrides) console.log(`[generate-pokemon-master] updated overrides: ${overridesPath}`);
}

// 既知dexNoリストを保存（昇順）
const wroteKnown = writeTextIfChanged(knownPath, knownContent);
if (wroteKnown) console.log(`[generate-pokemon-master] wrote known: ${knownPath}`);

// 食材C未実装の既知リストを保存（昇順）
if (ingCNullKnownChanged) {
  const wroteIngCNullKnown = writeTextIfChanged(ingCNullKnownPath, JSON.stringify([...ingCNullKnownSet].sort((a, b) => a - b), null, 2) + "\n");
  if (wroteIngCNullKnown) console.log(`[generate-pokemon-master] wrote ing-c-null-known: ${ingCNullKnownPath}`);
}

// フォーム名リストを保存
if (formJaToNumberChanged) {
  const wroteForm = writeTextIfChanged(formJaToNumberPath, JSON.stringify(formJaToNumber, null, 2) + "\n");
  if (wroteForm) console.log(`[generate-pokemon-master] wrote form-ja-to-number: ${formJaToNumberPath}`);
}

// フォーム英訳JSONを保存
if (formLabelJaToEnChanged) {
  const wroteFormEn = writeTextIfChanged(formLabelJaToEnPath, JSON.stringify(formLabelJaToEn, null, 2) + "\n");
  if (wroteFormEn) console.log(`[generate-pokemon-master] wrote form-label-ja-to-en: ${formLabelJaToEnPath}`);
}

// フォーム英訳TSファイルを生成（常に最新の状態を反映）
const wroteFormLabelTs = writeTextIfChanged(formLabelTsOut, formLabelTsContent);
if (wroteFormLabelTs) console.log(`[generate-pokemon-master] wrote form-label-ja-to-en.ts: ${formLabelTsOut}`);

if (wroteMaster) console.log(`[generate-pokemon-master] wrote master: ${masterOut}`);
if (wroteIndex) console.log(`[generate-pokemon-master] wrote index: ${indexOut}`);

if (shouldUpdateTestConfig) {
  // 追加されたポケモンの中から最後のもの（最新実装）を取得
  const latestAdded = addedEntries[addedEntries.length - 1];
  const latestPokemonName = latestAdded.nameJa;

  if (fs.existsSync(testConfigPath)) {
    try {
      const testConfig = JSON.parse(fs.readFileSync(testConfigPath, "utf8"));
      const previousName = testConfig.latestPokemon?.name;

      if (previousName !== latestPokemonName) {
        testConfig.latestPokemon = {
          ...testConfig.latestPokemon,
          name: latestPokemonName,
        };
        fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2) + "\n", "utf8");
        console.log(`[generate-pokemon-master] ✅ テスト設定更新: 最新ポケモン「${previousName}」→「${latestPokemonName}」`);
      }
    } catch (e) {
      console.warn(`[generate-pokemon-master] ⚠️ テスト設定更新失敗: ${e.message}`);
    }
  } else {
    console.log(`[generate-pokemon-master] ℹ️ テスト設定ファイルがありません: ${testConfigPath}`);
  }
}
} finally {
  releaseMasterLocks();
}
