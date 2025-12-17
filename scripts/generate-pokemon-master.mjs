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
const formJaToNumber = {
  "ハロウィン": 1,
  "ホリデー": 2,
  "アローラ": 3,
  "パルデア": 4,
  // トゲキッス等は通常
  // トキシトリシティ等
  "アンプ": 5,
  "アンプド": 5,
  "ローキー": 6,
  "ロウキー": 6,
  // バケッチャ/パンプジン size
  "スモール": 7,
  "ミディアム": 8,
  "ラージ": 9,
  "ジャンボ": 10,
};

function splitNameAndForm(nameJa) {
  const m = normalize(nameJa).match(/^(.+?)\s*[\(（]([^)）]+)[\)）]\s*$/);
  if (!m) return { baseNameJa: normalize(nameJa), form: 0, formLabelJa: null };
  const base = normalize(m[1]);
  const formLabelJa = normalize(m[2]);
  const form = formJaToNumber[formLabelJa] ?? 0;
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
    // a/b/cショートカット + Enter=600
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ans = normalize(
        await ask.question(
          `expType を入力してください: #${dexNo} ${nameJa}\n` +
          `  [Enter]=600 / a=900 / b=1080 / c=1320 / q=中断\n> `
        )
      ).toLowerCase();
      if (!ans) return 600;
      if (ans === "q") throw new Error("中断しました");
      if (ans === "a") return 900;
      if (ans === "b") return 1080;
      if (ans === "c") return 1320;
      const n = Number(ans);
      if (n === 600 || n === 900 || n === 1080 || n === 1320) return n;
      console.log("入力が不正です。a/b/c または 600/900/1080/1320 を入力してください。");
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

// --- preflight summary / confirm (write前に運用者確認) ---
const ingredientsNullCount = master.filter((x) => x.ingredients === null).length;
const ingredientCNullCount = master.filter((x) => x.ingredients && x.ingredients.c === null).length;
const linkNullCount = master.filter((x) => x.link === null).length;
const issuesAB = ingredientIssues.filter((x) => !x.ingAKey || !x.ingBKey);
const issuesC = ingredientIssues.filter((x) => x.ingAKey && x.ingBKey && x.ingCJa && !x.ingCKey);

let details = "";
details += `- entries: ${master.length}\n`;
details += `- ingredients:null: ${ingredientsNullCount}\n`;
details += `- ingredients.c:null: ${ingredientCNullCount}\n`;
details += `- link:null: ${linkNullCount}\n`;
details += `- ingredient mapping issues (A/B missing): ${issuesAB.length}\n`;
details += `- ingredient mapping issues (C unknown but present): ${issuesC.length}\n`;
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

// 安定化
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
if (wroteMaster) console.log(`[generate-pokemon-master] wrote master: ${masterOut}`);
if (wroteIndex) console.log(`[generate-pokemon-master] wrote index: ${indexOut}`);
