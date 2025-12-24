import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DB_JSON = path.join(__dirname, "../src/domain/pokesleep/_generated/pokemon-db.json");
const DEFAULT_OVERRIDES = path.join(__dirname, "./exp-type-overrides.json");
const DEFAULT_KNOWN = path.join(__dirname, "./exp-type-known.json");
const DEFAULT_ING_C_NULL_KNOWN = path.join(__dirname, "./ing-c-null-known.json");
const DEFAULT_FORM_JA_TO_NUMBER = path.join(__dirname, "./form-ja-to-number.json");
const DEFAULT_FORM_LABEL_JA_TO_EN = path.join(__dirname, "./form-label-ja-to-en.json");
const DEFAULT_OUT_FORM_LABEL_TS = path.join(__dirname, "../src/domain/pokesleep/_generated/form-label-ja-to-en.ts");
const DEFAULT_OUT_MASTER = path.join(__dirname, "../src/domain/pokesleep/pokemon-master.ts");
const DEFAULT_OUT_INDEX = path.join(__dirname, "../src/domain/pokesleep/pokemon-names.ts");


function parseArgs(argv) {
  const out = {
    dbJson: DEFAULT_DB_JSON,
    overrides: DEFAULT_OVERRIDES,
    known: DEFAULT_KNOWN,
    outMaster: DEFAULT_OUT_MASTER,
    outIndex: DEFAULT_OUT_INDEX,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db" && argv[i + 1]) {
      out.dbJson = argv[i + 1];
      i++;
      continue;
    }
    if (a === "--overrides" && argv[i + 1]) {
      out.overrides = argv[i + 1];
      i++;
      continue;
    }
    if (a === "--known" && argv[i + 1]) {
      out.known = argv[i + 1];
      i++;
      continue;
    }
    if (a === "--out-master" && argv[i + 1]) {
      out.outMaster = argv[i + 1];
      i++;
      continue;
    }
    if (a === "--out-index" && argv[i + 1]) {
      out.outIndex = argv[i + 1];
      i++;
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

function writeText(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

function writeTextIfChanged(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p)) {
    const prev = fs.readFileSync(p, "utf8");
    if (prev === content) return false;
  }
  // dryRun モードでは書き込みをスキップ
  if (args.dryRun) {
    return true; // 変更があることは報告
  }
  fs.writeFileSync(p, content, "utf8");
  return true;
}


function normalize(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function normalizeIngredientLabel(s) {
  const t0 = normalize(s);
  if (!t0) return null;
  // Wikiの表セルで「空」を表すプレースホルダ
  if (/^spacer(\.gif)?$/i.test(t0)) return null;
  // 画像ファイル名が混ざることがあるので拡張子は落とす
  const t = t0.replace(/\.(png|gif|jpg|jpeg|webp)$/i, "");
  return t || null;
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
// 外部JSONから読み込み
const formJaToNumberPath = path.resolve(DEFAULT_FORM_JA_TO_NUMBER);
const formJaToNumber = fs.existsSync(formJaToNumberPath) ? readJson(formJaToNumberPath) : {};
let formJaToNumberChanged = false;

// フォーム名の英訳（外部JSONから読み込み）
const formLabelJaToEnPath = path.resolve(DEFAULT_FORM_LABEL_JA_TO_EN);
const formLabelJaToEn = fs.existsSync(formLabelJaToEnPath) ? readJson(formLabelJaToEnPath) : {};
let formLabelJaToEnChanged = false;

const unknownFormLabels = new Set(); // 未知のフォーム名を記録


function splitNameAndForm(nameJa) {
  const m = normalize(nameJa).match(/^(.+?)\s*[\(（]([^)）]+)[\)）]\s*$/);
  if (!m) return { baseNameJa: normalize(nameJa), form: 0, formLabelJa: null };
  const base = normalize(m[1]);
  const formLabelJa = normalize(m[2]);
  const form = formJaToNumber[formLabelJa] ?? 0;
  // 未知のフォーム名を記録
  if (formLabelJa && form === 0 && !formJaToNumber.hasOwnProperty(formLabelJa)) {
    unknownFormLabels.add(formLabelJa);
  }
  return { baseNameJa: base, form, formLabelJa };
}


function toIdForm(pokedexId, form) {
  return (pokedexId | 0) + ((form | 0) << 12);
}

// 食材名（Wiki日本語）→ ingredient key
function ingredientKeyFromWikiJa(s) {
  const t = normalize(s);
  if (!t) return null;
  // ねぎ表記ゆれ（例: ふといながねぎ）
  if (t.includes("ネギ") || t.includes("ねぎ")) return "leek";
  if (t.includes("キノコ")) return "mushroom";
  if (t.includes("タマゴ") || t.includes("エッグ")) return "egg";
  if (t.includes("ポテト")) return "potato";
  if (t.includes("リンゴ")) return "apple";
  if (t.includes("ハーブ")) return "herb";
  // Wiki表記「マメミート」= 内部キー sausage
  if (t.includes("マメミート")) return "sausage";
  if (t.includes("ソーセージ")) return "sausage";
  if (t.includes("ミルク")) return "milk";
  if (t.includes("ミツ") || t.includes("ハチミツ")) return "honey";
  if (t.includes("オイル")) return "oil";
  if (t.includes("ショウガ") || t.includes("ジンジャー")) return "ginger";
  if (t.includes("トマト")) return "tomato";
  if (t.includes("カカオ")) return "cacao";
  // しっぽ表記ゆれ（例: おいしいシッポ）
  if (t.includes("しっぽ") || t.includes("シッポ")) return "tail";
  if (t.includes("大豆")) return "soy";
  if (t.includes("コーン") || t.includes("とうもろこし")) return "corn";
  if (t.includes("コーヒー")) return "coffee";
  // かぼちゃ表記ゆれ（例: ずっしりカボチャ）
  if (t.includes("かぼちゃ") || t.includes("カボチャ")) return "pumpkin";
  if (t.includes("アボカド")) return "avocado";
  // ダークライ等（Wiki側で画像表記になっているケース）
  if (t.includes("ひらめきのたね")) return "seed";
  return null;
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
  if (!canPrompt) return true;
  const ask = createAsk();
  try {
    const ans = normalize(
      await ask.question(
        `\n[confirm] ${title}\n` +
        (details ? `${details}\n` : "") +
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
    // eslint-disable-next-line no-constant-condition
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

const db = readJson(path.resolve(args.dbJson));
const items = Array.isArray(db.items) ? db.items : [];

const overridesPath = path.resolve(args.overrides);
const overridesObj = fs.existsSync(overridesPath) ? readJson(overridesPath) : {};
const overrides = parseOverrides(overridesObj);
let overridesChanged = false;

// 既知Noリスト（前回までに処理したdexNo）: ここに無いdexNoだけ対話で確認する
const knownPath = path.resolve(args.known);
const knownArr = fs.existsSync(knownPath) ? readJson(knownPath) : [];
const knownDexNos = new Set(Array.isArray(knownArr) ? knownArr.map(Number).filter(Number.isFinite) : []);

const master = [];
const nameJaByIdForm = {};
const expTypeByIdForm = {};
const specialtyByIdForm = {};
const ingredientsByIdForm = {};
const typeByIdForm = {};
const typeJaByIdForm = {};
const idFormsByNameJa = {};
const ingredientIssues = []; // {dexNo,nameJa,ingAJa,ingBJa,ingCJa,ingAKey,ingBKey,ingCKey}

for (const it of items) {
  const dexNo = Number(it.dexNo);
  if (!Number.isFinite(dexNo)) continue;
  const nameJa = normalize(it.nameJa);
  if (!nameJa) continue;
  const { form, formLabelJa, baseNameJa } = splitNameAndForm(nameJa);
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

  const ingAJa0 = Array.isArray(it.ingAJa) ? normalizeIngredientLabel(it.ingAJa[0]) : null;
  const ingBJa0 = Array.isArray(it.ingBJa) ? normalizeIngredientLabel(it.ingBJa[0]) : null;
  const ingCJa0 = Array.isArray(it.ingCJa) ? normalizeIngredientLabel(it.ingCJa[0]) : null;
  let ingAKey = ingAJa0 ? ingredientKeyFromWikiJa(ingAJa0) : null;
  let ingBKey = ingBJa0 ? ingredientKeyFromWikiJa(ingBJa0) : null;
  let ingCKey = ingCJa0 ? ingredientKeyFromWikiJa(ingCJa0) : null;

  const berryJa0 = Array.isArray(it.berryJa) ? normalizeBerryLabel(it.berryJa[0]) : null;
  const type = berryJa0 ? (berryJaToType[berryJa0] ?? "unknown") : "unknown";
  const typeJa = typeToJa[type] ?? "不明";

  // Darkrai (491): 食材が確定しない特殊仕様。Aは保持できるが、B/Cは「未確定」扱いに寄せる。
  // （現状の型では Aのみ保持ができないため、ingredients自体はnullにする）
  const isDarkrai = dexNo === 491 && form === 0;
  if (isDarkrai) {
    ingBKey = null;
    ingCKey = null;
  }

  if (!isDarkrai && (!ingAKey || !ingBKey || (ingCJa0 && !ingCKey))) {
    ingredientIssues.push({
      dexNo,
      nameJa,
      ingAJa: ingAJa0,
      ingBJa: ingBJa0,
      ingCJa: ingCJa0,
      ingAKey,
      ingBKey,
      ingCKey,
    });
  }

  master.push({
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
  });

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

// --- 差分検出：既存のMasterDBと比較 ---
function readExistingIdForms() {
  const masterPath = path.resolve(args.outMaster);
  if (!fs.existsSync(masterPath)) return new Set();
  const txt = fs.readFileSync(masterPath, "utf8");
  const re = /"idForm"\s*:\s*(\d+)/g;
  const set = new Set();
  for (; ;) {
    const m = re.exec(txt);
    if (!m) break;
    set.add(Number(m[1]));
  }
  return set;
}

const existingIdForms = readExistingIdForms();
const newIdForms = new Set(master.map(x => toIdForm(x.dexNo, x.form)));

const addedEntries = master.filter(x => !existingIdForms.has(toIdForm(x.dexNo, x.form)));
const removedIdForms = [...existingIdForms].filter(id => !newIdForms.has(id));

// --- preflight summary / confirm (write前に運用者確認) ---
// 食材C未実装の既知リストを読み込む
const ingCNullKnownPath = path.resolve(DEFAULT_ING_C_NULL_KNOWN);
const ingCNullKnownArr = fs.existsSync(ingCNullKnownPath) ? readJson(ingCNullKnownPath) : [];
const ingCNullKnownSet = new Set(Array.isArray(ingCNullKnownArr) ? ingCNullKnownArr.map(Number).filter(Number.isFinite) : []);

const ingredientsNullCount = master.filter((x) => x.ingredients === null).length;
const ingredientCNullAll = master.filter((x) => x.ingredients && x.ingredients.c === null);
const ingredientCNullKnown = ingredientCNullAll.filter((x) => ingCNullKnownSet.has(x.dexNo));
const ingredientCNullNew = ingredientCNullAll.filter((x) => !ingCNullKnownSet.has(x.dexNo));
const linkNullCount = master.filter((x) => x.link === null).length;
const issuesAB = ingredientIssues.filter((x) => !x.ingAKey || !x.ingBKey);
const issuesC = ingredientIssues.filter((x) => x.ingAKey && x.ingBKey && x.ingCJa && !x.ingCKey);

let details = "";
if (args.dryRun) {
  details += `[ドライランモード: ファイルは書き込まれません]\n\n`;
}
details += `- entries: ${master.length} (既存: ${existingIdForms.size})\n`;
details += `- 追加: ${addedEntries.length}\n`;
details += `- 削除: ${removedIdForms.length}\n`;
details += `- ingredients:null: ${ingredientsNullCount}\n`;
details += `- ingredients.c:null (既知): ${ingredientCNullKnown.length}\n`;
details += `- ingredients.c:null (新規): ${ingredientCNullNew.length}\n`;
details += `- link:null: ${linkNullCount}\n`;
details += `- ingredient mapping issues (A/B missing): ${issuesAB.length}\n`;
details += `- ingredient mapping issues (C unknown but present): ${issuesC.length}\n`;

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

if (ingredientCNullNew.length) {
  details += `\n[食材C未実装 (新規)]\n`;
  for (const x of ingredientCNullNew.slice(0, 10)) {
    details += `- #${x.dexNo} ${x.nameJa}\n`;
  }
  if (ingredientCNullNew.length > 10) details += `... +${ingredientCNullNew.length - 10} more\n`;
}
if (issuesAB.length) {
  details += `\n[A/B missing examples]\n`;
  for (const x of issuesAB.slice(0, 12)) {
    details += `- #${x.dexNo} ${x.nameJa}: A=${x.ingAJa ?? "-"} (${x.ingAKey ?? "?"}) / B=${x.ingBJa ?? "-"} (${x.ingBKey ?? "?"}) / C=${x.ingCJa ?? "-"} (${x.ingCKey ?? "?"})\n`;
  }
  if (issuesAB.length > 12) details += `... +${issuesAB.length - 12} more\n`;
}
if (issuesC.length) {
  details += `\n[C unknown examples]\n`;
  for (const x of issuesC.slice(0, 8)) {
    details += `- #${x.dexNo} ${x.nameJa}: C=${x.ingCJa ?? "-"} (key: ?)\n`;
  }
  if (issuesC.length > 8) details += `... +${issuesC.length - 8} more\n`;
}

await confirmOrAbort({
  interactive: args.interactive,
  title: "generate-pokemon-master",
  details,
});

// 新規の食材C未実装を既知リストに追加するか確認
let ingCNullKnownChanged = false;
if (ingredientCNullNew.length > 0 && args.interactive && process.stdin.isTTY && process.stdout.isTTY) {
  const ask = createAsk();
  try {
    console.log(`\n[食材C未実装 (新規)] ${ingredientCNullNew.length}件`);
    for (const x of ingredientCNullNew) {
      console.log(`  #${x.dexNo} ${x.nameJa}`);
    }
    // eslint-disable-next-line no-constant-condition
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

// 未知のフォーム名を既知リストに追加するか確認
if (unknownFormLabels.size > 0 && args.interactive && process.stdin.isTTY && process.stdout.isTTY) {
  const unknownList = [...unknownFormLabels].sort();
  const maxFormNumber = Math.max(0, ...Object.values(formJaToNumber).filter(Number.isFinite));

  console.log(`\n[未知のフォーム名] ${unknownList.length}件`);
  for (const label of unknownList) {
    console.log(`  ${label}`);
  }

  const ask = createAsk();
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ans = normalize(
        await ask.question(`\nこれらをフォームリスト (form-ja-to-number.json) に追加しますか？ [y/n]\n> `)
      ).toLowerCase();
      if (ans === "y" || ans === "yes") {
        let nextNumber = maxFormNumber + 1;
        for (const label of unknownList) {
          formJaToNumber[label] = nextNumber;
          console.log(`[generate-pokemon-master] "${label}" を form=${nextNumber} で追加`);

          // 英訳も聞く（必須）
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const enAns = normalize(
              await ask.question(`  英訳を入力してください: `)
            );
            if (enAns) {
              formLabelJaToEn[label] = enAns;
              formLabelJaToEnChanged = true;
              console.log(`[generate-pokemon-master] "${label}" → "${enAns}" を英訳リストに追加`);
              break;
            }
            console.log("  入力が必要です。英訳を入力してください。");
          }

          nextNumber++;
        }
        formJaToNumberChanged = true;
        break;
      }
      if (ans === "n" || ans === "no") {
        // 確認警告
        const confirm = normalize(
          await ask.question(`⚠️  本当にスキップしますか？ 例外処理がある場合、後で scripts/form-ja-to-number.json と form-label-ja-to-en.json の手動更新が必要です [y/n]\n> `)
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


master.sort((a, b) => (a.dexNo - b.dexNo) || (a.form - b.form) || a.nameJa.localeCompare(b.nameJa, "ja"));

for (const k of Object.keys(idFormsByNameJa)) {
  idFormsByNameJa[k] = [...new Set(idFormsByNameJa[k])].sort((a, b) => a - b);
}

// Master DB
const masterOut = path.resolve(args.outMaster);
const masterContent =
  `// This file is auto-generated by scripts/generate-pokemon-master.mjs\n` +
  `// Source: ${db.source ?? "(unknown)"}\n\n` +
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
const wroteMaster = writeTextIfChanged(masterOut, masterContent);

// Fast index (existing API surface)
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
  `}\n`
  ;
const wroteIndex = writeTextIfChanged(indexOut, indexContent);

if (overridesChanged) {
  const wroteOverrides = writeTextIfChanged(overridesPath, JSON.stringify(overridesToJson(overrides), null, 2) + "\n");
  if (wroteOverrides) console.log(`[generate-pokemon-master] updated overrides: ${overridesPath}`);
}

// 既知dexNoリストを保存（昇順）
const wroteKnown = writeTextIfChanged(knownPath, JSON.stringify([...knownDexNos].sort((a, b) => a - b), null, 2) + "\n");
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
const formLabelTsOut = path.resolve(DEFAULT_OUT_FORM_LABEL_TS);
const formLabelTsContent =
  `// This file is auto-generated by scripts/generate-pokemon-master.mjs\n` +
  `// Source: scripts/form-label-ja-to-en.json\n\n` +
  `export const formLabelJaToEn: Record<string, string> = ${JSON.stringify(formLabelJaToEn, null, 2)};\n`;
const wroteFormLabelTs = writeTextIfChanged(formLabelTsOut, formLabelTsContent);
if (wroteFormLabelTs) console.log(`[generate-pokemon-master] wrote form-label-ja-to-en.ts: ${formLabelTsOut}`);

if (wroteMaster) console.log(`[generate-pokemon-master] wrote master: ${masterOut}`);
if (wroteIndex) console.log(`[generate-pokemon-master] wrote index: ${indexOut}`);
