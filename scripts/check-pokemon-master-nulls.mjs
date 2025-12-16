import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const masterPath = path.join(__dirname, "../src/domain/pokesleep/pokemon-master.ts");
const src = fs.readFileSync(masterPath, "utf8");

function extractArrayLiteral(tsSource) {
  const m = tsSource.match(/export const pokemonMaster:[\s\S]*?=\s*(\[[\s\S]*?\])\s+as const;/);
  if (!m) throw new Error("Failed to extract pokemonMaster array literal");
  return m[1];
}

const arrLiteral = extractArrayLiteral(src);
/** @type {any[]} */
const pokemonMaster = vm.runInNewContext(arrLiteral, {}, { timeout: 2000 });

function push(map, key, item) {
  const list = map.get(key) ?? [];
  list.push(item);
  map.set(key, list);
}

const byField = new Map(); // field -> [{dexNo,nameJa,detail}]
for (const e of pokemonMaster) {
  const dexNo = e.dexNo;
  const nameJa = e.nameJa;
  if (e.formLabelJa === null) push(byField, "formLabelJa:null", { dexNo, nameJa });
  if (e.link === null) push(byField, "link:null", { dexNo, nameJa });
  if (e.ingredients === null) {
    push(byField, "ingredients:null", { dexNo, nameJa });
  } else if (e.ingredients && typeof e.ingredients === "object") {
    if (e.ingredients.c === null) push(byField, "ingredients.c:null", { dexNo, nameJa });
  }
}

const fields = [...byField.keys()].sort((a, b) => a.localeCompare(b));
for (const f of fields) {
  const list = byField.get(f) ?? [];
  list.sort((a, b) => (a.dexNo ?? 0) - (b.dexNo ?? 0));
  console.log(`\n## ${f} (${list.length})`);
  for (const it of list) {
    console.log(`- #${it.dexNo} ${it.nameJa}`);
  }
}
