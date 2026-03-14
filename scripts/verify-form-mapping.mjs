#!/usr/bin/env node
/**
 * verify-form-mapping.mjs — フォーム番号3ソース突合 & 自動修正スクリプト
 *
 * 3つのデータソースを突合し、不整合を検出して自動修正する:
 *   A) Wiki pokemon-db.json（日本語フォーム名の正）
 *   B) pokesleep-tool PokemonIv.ts formMap + pokemon.json（英名・番号の正）
 *   C) candy_boost_planner のマッピングテーブル (form-ja-to-number.json 等)
 *
 * 自動修正対象:
 *   - form-ja-to-number.json: 新フォーム名→番号を追加
 *   - form-label-ja-to-en.json: 新フォーム名→英訳を追加
 *   - form-aliases.json: Wiki/にとよん間のフォーム番号ずれのエイリアスを追加
 *   - generate-pokemon-names.mjs: formNameToNumber への新エントリ追加
 *
 * Usage:
 *   node scripts/verify-form-mapping.mjs [--pokesleep-tool <path>] [--dry-run]
 *
 * Exit codes:
 *   0 = 不整合なし or 自動修正完了
 *   1 = 自動修正できない不整合あり
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {
    pokesleepTool: path.resolve("D:/Dev/Projects/External/pokesleep-tool"),
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pokesleep-tool" && argv[i + 1]) {
      out.pokesleepTool = argv[i + 1];
      i++;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const toolRoot = path.resolve(args.pokesleepTool);

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function normalize(s) {
  return String(s ?? "").normalize("NFKC").trim();
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Load: pokesleep-tool のデータ
// ---------------------------------------------------------------------------
const pokemonJsonPath = path.join(toolRoot, "src/data/pokemon.json");
const pokemonIvTsPath = path.join(toolRoot, "src/util/PokemonIv.ts");

if (!fs.existsSync(pokemonJsonPath)) {
  console.error(`[ERROR] pokemon.json not found: ${pokemonJsonPath}`);
  console.error(`  --pokesleep-tool オプションでにとよんツールのパスを指定してください`);
  process.exit(1);
}
if (!fs.existsSync(pokemonIvTsPath)) {
  console.error(`[ERROR] PokemonIv.ts not found: ${pokemonIvTsPath}`);
  process.exit(1);
}

const pokemonList = readJson(pokemonJsonPath);
const pokemonIvTs = fs.readFileSync(pokemonIvTsPath, "utf8");

// ---------------------------------------------------------------------------
// Load: candy_boost_planner のマッピングテーブル（ミュータブル — 修正対象）
// ---------------------------------------------------------------------------
const formJaToNumberPath = path.join(__dirname, "form-ja-to-number.json");
const formLabelJaToEnPath = path.join(__dirname, "form-label-ja-to-en.json");
const formAliasesPath = path.join(__dirname, "form-aliases.json");
const genPokemonNamesPath = path.join(__dirname, "generate-pokemon-names.mjs");

const formJaToNumber = fs.existsSync(formJaToNumberPath) ? readJson(formJaToNumberPath) : {};
const formLabelJaToEn = fs.existsSync(formLabelJaToEnPath) ? readJson(formLabelJaToEnPath) : {};
const formAliases = fs.existsSync(formAliasesPath) ? readJson(formAliasesPath) : {};

// ---------------------------------------------------------------------------
// Parse: PokemonIv.ts から formMap を抽出
// ---------------------------------------------------------------------------
function parseFormMapFromTs(source) {
  const mapMatch = source.match(/const\s+formMap\s*:\s*Record<[^>]+>\s*=\s*\{([^}]+)\}/s);
  if (!mapMatch) return null;
  const entries = {};
  const lineRe = /['"]([^'"]+)['"]\s*:\s*(\d+)/g;
  let m;
  while ((m = lineRe.exec(mapMatch[1])) !== null) {
    entries[m[1]] = Number(m[2]);
  }
  return entries;
}

function parseFormNamesArrayFromTs(source) {
  const arrMatch = source.match(/formNames\s*:\s*\([^)]*\)\[\]\s*=\s*\[([^\]]+)\]/s);
  if (!arrMatch) return null;
  const names = [];
  const strRe = /['"]([^'"]*)['"]/g;
  let m;
  while ((m = strRe.exec(arrMatch[1])) !== null) {
    names.push(m[1]);
  }
  return names;
}

const nitoyonFormMap = parseFormMapFromTs(pokemonIvTs);
const nitoyonFormNames = parseFormNamesArrayFromTs(pokemonIvTs);

if (!nitoyonFormMap) {
  console.error("[ERROR] PokemonIv.ts から formMap を抽出できませんでした");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load: Wiki pokemon-db.json
// ---------------------------------------------------------------------------
const pokemonDbPath = path.join(__dirname, "../src/domain/pokesleep/_generated/pokemon-db.json");
const hasPokemonDb = fs.existsSync(pokemonDbPath);
const wikiItems = hasPokemonDb ? (readJson(pokemonDbPath).items || []) : [];

// ---------------------------------------------------------------------------
// Wiki: splitNameAndForm (generate-pokemon-master.mjs 互換)
// ---------------------------------------------------------------------------
function wikiSplitNameAndForm(nameJa) {
  const n = normalize(nameJa);
  const m = n.match(/^(.+?)\s*[\(（]([^)）]+)[\)）]\s*$/);
  if (!m) return { baseNameJa: n, form: 0, formLabelJa: null };
  const formLabelJa = normalize(m[2]);
  const form = formJaToNumber[formLabelJa] ?? 0;
  return { baseNameJa: normalize(m[1]), form, formLabelJa };
}

// ---------------------------------------------------------------------------
// Collect data structures
// ---------------------------------------------------------------------------

// pokesleep-tool のフォーム付きポケモン
const nitoyonFormedPokemon = [];
for (const p of pokemonList) {
  if (!p || typeof p !== "object") continue;
  if (p.form) {
    nitoyonFormedPokemon.push({ id: Number(p.id), name: String(p.name), form: String(p.form) });
  }
}

// Wiki: dexNo → [{ nameJa, baseNameJa, form, formLabelJa }]
const wikiByDex = new Map();
for (const item of wikiItems) {
  const dexNo = Number(item.dexNo);
  const parsed = wikiSplitNameAndForm(item.nameJa);
  if (!wikiByDex.has(dexNo)) wikiByDex.set(dexNo, []);
  wikiByDex.get(dexNo).push({ nameJa: normalize(item.nameJa), ...parsed });
}

// pokesleep-tool: dexNo → [{ name, form(string), formNum }]
const nitoyonByDex = new Map();
for (const p of pokemonList) {
  if (!p || typeof p !== "object") continue;
  const id = Number(p.id);
  if (!Number.isFinite(id) || id <= 0) continue;
  const formStr = p.form || null;
  const formNum = formStr ? (nitoyonFormMap[formStr] ?? 0) : 0;
  if (!nitoyonByDex.has(id)) nitoyonByDex.set(id, []);
  nitoyonByDex.get(id).push({ name: String(p.name), form: formStr, formNum });
}

// En→Ja 逆引き
function buildEnToJaMap() {
  const m = {};
  for (const [ja, en] of Object.entries(formLabelJaToEn)) {
    if (!m[en]) m[en] = [];
    m[en].push(ja);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Pre-check: 新規フォームの有無を確認（全て既知ならスキップ）
// ---------------------------------------------------------------------------
function checkNeedsWork() {
  // Phase 1 check: formMap の全エントリがマッピング済みか
  const enToJa0 = buildEnToJaMap();
  for (const [enName, nitoyonNum] of Object.entries(nitoyonFormMap)) {
    const jaNames = enToJa0[enName] || [];
    if (jaNames.length === 0) return true;
    const nums = jaNames.map(ja => formJaToNumber[ja]).filter(n => n !== undefined);
    if (!nums.includes(nitoyonNum)) return true;
  }
  // Phase 2 check: alias が必要なのに未登録のエントリがないか
  if (hasPokemonDb) {
    const wfbd = new Map();
    for (const item of wikiItems) {
      const dexNo = Number(item.dexNo);
      const { form } = wikiSplitNameAndForm(item.nameJa);
      if (!wfbd.has(dexNo)) wfbd.set(dexNo, new Set());
      wfbd.get(dexNo).add(form);
    }
    for (const [dexNo, nitoyonEntries] of nitoyonByDex) {
      const wikiForms = wfbd.get(dexNo);
      if (!wikiForms) continue;
      for (const ne of nitoyonEntries) {
        if (wikiForms.has(ne.formNum)) continue;
        const aliasKey = `${dexNo}:${ne.formNum}`;
        if (formAliases[aliasKey] !== undefined) {
          if (wikiForms.has(formAliases[aliasKey])) continue;
          return true;
        }
        return true;
      }
    }
  }
  // Phase 3 check: formNameToNumber が最新か
  if (fs.existsSync(genPokemonNamesPath)) {
    const genContent = fs.readFileSync(genPokemonNamesPath, "utf8");
    const blockMatch = genContent.match(/(const\s+formNameToNumber\s*=\s*\{)([\s\S]*?)(\};)/);
    if (blockMatch) {
      const cur = {};
      const re = /(?:["']([^"']+)["']|(\w+))\s*:\s*(\d+)/g;
      let m;
      while ((m = re.exec(blockMatch[2])) !== null) cur[m[1] || m[2]] = Number(m[3]);
      for (const [enName, num] of Object.entries(nitoyonFormMap)) {
        if (cur[enName] !== num) return true;
      }
    }
  }
  return false;
}

if (!checkNeedsWork()) {
  console.log("[SUMMARY] fixes=0 unfixable=0 errors=0 skipped=true");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Auto-fix tracking
// ---------------------------------------------------------------------------
const fixes = [];      // { file, action, detail }
const unfixable = [];  // { message }

function addFix(file, action, detail) {
  fixes.push({ file, action, detail });
  console.log(`  [AUTO-FIX] ${file}: ${action} — ${detail}`);
}

// ---------------------------------------------------------------------------
// Phase 1: formMap の新フォーム名を form-ja-to-number.json / form-label-ja-to-en.json に追加
// ---------------------------------------------------------------------------
console.log("=== フォーム番号 3ソース突合 & 自動修正 ===\n");
console.log("データソース:");
console.log(`  A) Wiki pokemon-db.json:   ${wikiItems.length} ポケモン${hasPokemonDb ? "" : " (未生成)"}`);
console.log(`  B) PokemonIv.ts formMap:   ${Object.keys(nitoyonFormMap).length} エントリ`);
console.log(`  C) pokemon.json:           ${nitoyonFormedPokemon.length} フォーム付きレコード`);
console.log(`  *) form-aliases.json:      ${Object.keys(formAliases).filter(k => !k.startsWith("_")).length} エイリアス`);
console.log();

console.log("--- Phase 1: PokemonIv.ts formMap → マッピングテーブル同期 ---");

// にとよん formMap のフォーム名ごとに、Wiki から対応する日本語名を見つける
// 方法: 同じ dexNo のフォーム付きエントリの「数と順序」を Wiki/にとよんで突合

// まず、にとよん英名 → Wiki 日本語フォーム名 の対応を構築
// dexNo ごとに、にとよんのフォーム一覧と Wiki のフォーム一覧を突合
const enFormToWikiJa = new Map(); // "Halloween" → Set<"ハロウィン">

for (const [dexNo, nitoyonEntries] of nitoyonByDex) {
  const formedNitoyon = nitoyonEntries.filter((e) => e.form !== null);
  if (formedNitoyon.length === 0) continue;

  const wikiEntries = wikiByDex.get(dexNo);
  if (!wikiEntries) continue;

  const formedWiki = wikiEntries.filter((e) => e.formLabelJa !== null);

  // にとよんのフォーム英名 → にとよんの formNum でソート
  const nitoyonSorted = [...formedNitoyon].sort((a, b) => a.formNum - b.formNum);
  // Wiki のフォーム → form 番号でソート（form-ja-to-number で解決済みのものは番号順、未解決は 0）
  const wikiSorted = [...formedWiki].sort((a, b) => a.form - b.form);

  // 同じ数のフォームがあれば、formNum の順序で対応づける
  if (nitoyonSorted.length === wikiSorted.length) {
    for (let i = 0; i < nitoyonSorted.length; i++) {
      const enName = nitoyonSorted[i].form;
      const jaName = wikiSorted[i].formLabelJa;
      if (enName && jaName) {
        if (!enFormToWikiJa.has(enName)) enFormToWikiJa.set(enName, new Set());
        enFormToWikiJa.get(enName).add(jaName);
      }
    }
  }
}

// formMap のすべてのエントリについて、マッピングテーブルに登録があるか確認
let phase1Changed = false;
let enToJa = buildEnToJaMap();
for (const [enName, nitoyonNum] of Object.entries(nitoyonFormMap)) {
  const existingJaNames = enToJa[enName] || [];

  // form-label-ja-to-en.json に少なくとも1つの日本語名があるか
  if (existingJaNames.length > 0) {
    // 日本語名があるが、番号が合っているか
    const registeredNums = existingJaNames.map((ja) => formJaToNumber[ja]).filter((n) => n !== undefined);
    if (registeredNums.includes(nitoyonNum)) {
      continue;
    }
    // 番号が違う → 修正
    for (const ja of existingJaNames) {
      if (formJaToNumber[ja] !== undefined && formJaToNumber[ja] !== nitoyonNum) {
        const oldNum = formJaToNumber[ja];
        formJaToNumber[ja] = nitoyonNum;
        addFix("form-ja-to-number.json", "番号修正", `"${ja}": ${nitoyonNum} (was ${oldNum})`);
        phase1Changed = true;
      }
    }
    continue;
  }

  // form-label-ja-to-en.json に未登録 → Wiki から日本語名を探す
  const wikiJaNames = enFormToWikiJa.get(enName);
  if (wikiJaNames && wikiJaNames.size > 0) {
    // Wiki から見つかった日本語名で登録
    for (const jaName of wikiJaNames) {
      if (!Object.hasOwn(formJaToNumber, jaName)) {
        formJaToNumber[jaName] = nitoyonNum;
        addFix("form-ja-to-number.json", "追加", `"${jaName}": ${nitoyonNum}`);
        phase1Changed = true;
      }
      if (!Object.hasOwn(formLabelJaToEn, jaName)) {
        formLabelJaToEn[jaName] = enName;
        enToJa = buildEnToJaMap();
        addFix("form-label-ja-to-en.json", "追加", `"${jaName}": "${enName}"`);
        phase1Changed = true;
      }
    }
  } else {
    // Wiki にもフォーム括弧がない → 日本語名を自動取得できない
    unfixable.push({
      message: `"${enName}" (=${nitoyonNum}): Wiki にフォーム括弧がなく、日本語名を自動取得できない。手動で form-ja-to-number.json と form-label-ja-to-en.json に追加してください`,
    });
    console.log(`  [UNFIXABLE] "${enName}" (=${nitoyonNum}) → Wiki にフォーム括弧がなく日本語名不明`);
  }
}
if (!phase1Changed && unfixable.length === 0) {
  console.log("  → すべて登録済み");
}
console.log();

const unfixableAfterPhase1 = unfixable.length;

// ---------------------------------------------------------------------------
// Phase 2: Wiki vs にとよんのフォーム番号ずれ → form-aliases.json 自動追加
// ---------------------------------------------------------------------------
console.log("--- Phase 2: Wiki/pokesleep-tool フォーム番号ずれ → alias 自動追加 ---");
let phase2Changed = false;

if (hasPokemonDb) {
  // Wiki 側: dexNo → Set<form>（form-ja-to-number の最新値で再計算）
  const wikiFormsByDex = new Map();
  for (const item of wikiItems) {
    const dexNo = Number(item.dexNo);
    const { form } = wikiSplitNameAndForm(item.nameJa);
    if (!wikiFormsByDex.has(dexNo)) wikiFormsByDex.set(dexNo, new Set());
    wikiFormsByDex.get(dexNo).add(form);
  }

  for (const [dexNo, nitoyonEntries] of nitoyonByDex) {
    const wikiForms = wikiFormsByDex.get(dexNo);
    if (!wikiForms) continue;

    for (const ne of nitoyonEntries) {
      if (wikiForms.has(ne.formNum)) continue; // Wiki 側にも同じ form がある

      const aliasKey = `${dexNo}:${ne.formNum}`;
      if (formAliases[aliasKey] !== undefined) {
        // 既登録エイリアス
        const target = formAliases[aliasKey];
        if (wikiForms.has(target)) {
          // alias OK — ログ省略（既知エントリ）
        } else {
          unfixable.push({
            message: `#${dexNo}: alias "${aliasKey}":${target} の target form=${target} が Wiki 側に存在しない。手動で form-aliases.json を確認してください`,
          });
          console.log(`  [ALIAS BAD] #${dexNo} alias target form=${target} が Wiki に存在しない`);
        }
        continue;
      }

      // alias 未登録 → Wiki 側の form=0 にフォールバックできるか？
      if (wikiForms.has(0) && ne.formNum !== 0) {
        // Wiki では括弧なし(form=0)だが、にとよんでは form!=0
        // → form=0 へのエイリアスを自動追加
        formAliases[aliasKey] = 0;
        addFix("form-aliases.json", "追加", `"${aliasKey}": 0 (Wiki は括弧なし)`);
        phase2Changed = true;
      } else {
        unfixable.push({
          message: `#${dexNo}: にとよん form=${ne.formNum} が Wiki 側に存在しない。自動でエイリアス先を決定できません`,
        });
        console.log(`  [UNFIXABLE] #${dexNo} pokesleep-tool form=${ne.formNum} → alias 先を自動決定できない`);
      }
    }
  }
} else {
  console.log("  [SKIP] pokemon-db.json が未生成");
}
if (!phase2Changed && unfixable.length === unfixableAfterPhase1) {
  console.log("  → alias の追加なし");
}
console.log();

// ---------------------------------------------------------------------------
// Phase 3: generate-pokemon-names.mjs の formNameToNumber 自動同期
// ---------------------------------------------------------------------------
console.log("--- Phase 3: generate-pokemon-names.mjs formNameToNumber 同期 ---");  // Phase 3 は formMap → スクリプト同期
let phase3Changed = false;

if (fs.existsSync(genPokemonNamesPath)) {
  let genContent = fs.readFileSync(genPokemonNamesPath, "utf8");

  // 現在の formNameToNumber ブロックを抽出
  const blockMatch = genContent.match(
    /(const\s+formNameToNumber\s*=\s*\{)([\s\S]*?)(\};)/
  );
  if (blockMatch) {
    // 現在のエントリをパース（クォートあり/なし両対応）
    const currentEntries = {};
    const entryRe = /(?:["']([^"']+)["']|(\w+))\s*:\s*(\d+)/g;
    let em;
    while ((em = entryRe.exec(blockMatch[2])) !== null) {
      const key = em[1] || em[2];
      currentEntries[key] = Number(em[3]);
    }

    // にとよん formMap にあるが generate-pokemon-names.mjs にないエントリを追加
    const toAdd = [];
    for (const [enName, num] of Object.entries(nitoyonFormMap)) {
      if (currentEntries[enName] === undefined) {
        toAdd.push({ enName, num });
      } else if (currentEntries[enName] !== num) {
        // 番号が違う（これは重大な問題だが自動修正する）
        toAdd.push({ enName, num });
      }
    }

    if (toAdd.length > 0) {
      // 新しいエントリを追加してブロックを再構築
      for (const { enName, num } of toAdd) {
        currentEntries[enName] = num;
      }

      // ソート順を維持（番号順）
      const sorted = Object.entries(currentEntries).sort((a, b) => a[1] - b[1]);
      const lines = sorted.map(([k, v]) => {
        const key = k.includes(" ") ? `"${k}"` : k;
        return `  ${key}: ${v},`;
      });
      const newBlock = `${blockMatch[1]}\n${lines.join("\n")}\n${blockMatch[3]}`;
      genContent = genContent.replace(blockMatch[0], newBlock);

      if (!args.dryRun) {
        fs.writeFileSync(genPokemonNamesPath, genContent, "utf8");
      }
      for (const { enName, num } of toAdd) {
        addFix("generate-pokemon-names.mjs", "追加/更新", `"${enName}": ${num}`);
      }
      phase3Changed = true;
    }
  } else {
    console.log("  [WARN] formNameToNumber ブロックを抽出できなかった");
  }
} else {
  console.log("  [SKIP] generate-pokemon-names.mjs が存在しない");
}
if (!phase3Changed) {
  console.log("  → 同期済み");
}
console.log();

// ---------------------------------------------------------------------------
// Phase 4: 検証（自動修正後の最終チェック）
// ---------------------------------------------------------------------------
console.log("--- Phase 4: 最終検証 ---");
let finalErrors = 0;

// 4a: formMap の全エントリが form-ja-to-number.json 経由で解決可能か
const enToJaFinal = buildEnToJaMap();
for (const [enName, nitoyonNum] of Object.entries(nitoyonFormMap)) {
  const jaNames = enToJaFinal[enName] || [];
  const nums = jaNames.map((ja) => formJaToNumber[ja]).filter((n) => n !== undefined);
  if (!nums.includes(nitoyonNum)) {
    console.log(`  [ERROR] "${enName}" (=${nitoyonNum}) がマッピングテーブルで解決できない`);
    finalErrors++;
  }
}

// 4b: formMap vs formToString 配列の一貫性
if (nitoyonFormNames) {
  for (const [enName, num] of Object.entries(nitoyonFormMap)) {
    if (nitoyonFormNames[num] !== enName) {
      console.log(`  [WARN] PokemonIv.ts 内部不整合: formMap["${enName}"]=${num}, formNames[${num}]="${nitoyonFormNames[num] ?? "(undefined)"}"`);
    }
  }
}

// 4c: pokemon-names.ts での名前解決（生成済みファイルが存在する場合）
const pokemonNamesTsPath = path.join(__dirname, "../src/domain/pokesleep/pokemon-names.ts");
if (fs.existsSync(pokemonNamesTsPath)) {
  const namesTsContent = fs.readFileSync(pokemonNamesTsPath, "utf8");
  const nameMapMatch = namesTsContent.match(/pokemonNameJaByIdForm\s*=\s*(\{[\s\S]*?\})\s*as\s+const/);
  if (nameMapMatch) {
    let parsedNameMap;
    try { parsedNameMap = JSON.parse(nameMapMatch[1]); } catch { parsedNameMap = null; }
    if (parsedNameMap) {
      let missingCount = 0;
      for (const p of pokemonList) {
        if (!p || typeof p !== "object") continue;
        const id = Number(p.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const formStr = p.form;
        const formNum = formStr ? (nitoyonFormMap[formStr] ?? 0) : 0;
        const idForm = id + (formNum << 12);

        const aliasKey = `${id}:${formNum}`;
        const aliasedForm = formAliases[aliasKey];
        const aliasedIdForm = aliasedForm !== undefined ? id + (Number(aliasedForm) << 12) : null;

        const directHit = parsedNameMap[String(idForm)] !== undefined;
        const aliasHit = aliasedIdForm !== null && parsedNameMap[String(aliasedIdForm)] !== undefined;

        if (!directHit && !aliasHit) {
          if (missingCount < 10) {
            const name = typeof p.name === "string" ? p.name : `#${id}`;
            const formInfo = formStr ? ` form="${formStr}"(=${formNum})` : "";
            console.log(`  [WARN] #${id} ${name}${formInfo}: pokemon-names.ts に未登録 (generate:master の再実行が必要)`);
          }
          missingCount++;
        }
      }
      if (missingCount > 10) {
        console.log(`  ... 他 ${missingCount - 10} 件`);
      }
      if (missingCount > 0) {
        console.log(`  → pokemon-names.ts に ${missingCount} 件の未登録あり。npm run generate:master で再生成してください`);
      }
    }
  }
}

if (finalErrors === 0 && unfixable.length === 0) {
  console.log("  → 最終検証OK");
}
console.log();

// ---------------------------------------------------------------------------
// Write files (unless --dry-run)
// ---------------------------------------------------------------------------
if (fixes.length > 0 && !args.dryRun) {
  writeJson(formJaToNumberPath, formJaToNumber);
  writeJson(formLabelJaToEnPath, formLabelJaToEn);
  writeJson(formAliasesPath, formAliases);
  console.log("[WRITE] マッピングファイルを更新しました");
  console.log();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("=== サマリー ===");
console.log(`  自動修正:   ${fixes.length} 件${args.dryRun && fixes.length > 0 ? " (dry-run: 未書き込み)" : ""}`);
console.log(`  修正不可:   ${unfixable.length} 件`);
console.log(`  検証エラー: ${finalErrors} 件`);

if (fixes.length > 0) {
  console.log("\n[AUTO-FIX 一覧]");
  for (const f of fixes) {
    console.log(`  - ${f.file}: ${f.action} — ${f.detail}`);
  }
}
if (unfixable.length > 0) {
  console.log("\n[UNFIXABLE 一覧]");
  for (const u of unfixable) {
    console.log(`  - ${u.message}`);
  }
}

// Machine-readable summary line for CI parsing
const skipped = fixes.length === 0 && unfixable.length === 0 && finalErrors === 0;
console.log(`\n[SUMMARY] fixes=${fixes.length} unfixable=${unfixable.length} errors=${finalErrors}${skipped ? ' skipped=true' : ''}`);

if (unfixable.length > 0 || finalErrors > 0) {
  process.exit(1);
}
