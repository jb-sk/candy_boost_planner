/**
 * 実行時バンドルへ astronomy-engine が戻っていないことを検証する。
 * 混入を止める主役は ESLint の import 禁止（eslint.config.js）で、これは月齢の計算のような時刻を扱うコードが
 * 戻ったときの二重の守り。時刻を扱わない API（DeltaT_EspenakMeeus・Rotation_EQJ_GAL など）だけなら見つからない。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// AstroTime のコンストラクタの例外文。時刻を受け取る API のほぼすべてが通り、圧縮しても文字列のまま残る。
const ASTRO_TIME_ERROR = "Argument must be a Date object, an AstroTime object, or a numeric UTC Julian date.";
// Astronomy Engine 固有の KM_PER_AU。圧縮器ごとに表記が変わる（1.4959787069098932e+8・14959787069098932e-8 など）ので値で比べる。
// Oxc は KM_PER_AU を使う定数を畳み込むため、KM_PER_AU を直接使わないと残らない。
const KM_PER_AU = 1.4959787069098932e+8;
// 識別子の一部（日本語などの非 ASCII を含む）は数値リテラルとして読まない。
const NUMERIC_LITERAL = /(?<![\p{ID_Continue}$.])(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?![\p{ID_Continue}$])/gu;

/** @param {string} code */
export function containsAstronomyRuntime(code) {
  if (code.includes(ASTRO_TIME_ERROR)) return true;
  return (code.match(NUMERIC_LITERAL) ?? []).some(literal => Number(literal) === KM_PER_AU);
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const assets = path.join(root, "dist/assets");
  if (!fs.existsSync(assets)) throw new Error("dist/assets does not exist; run the build first");

  const javascriptAssets = fs.readdirSync(assets).filter(file => file.endsWith(".js"));
  const astronomyFileNames = javascriptAssets.filter(file => /astronomy/i.test(file));
  const astronomyContents = javascriptAssets.filter(file => (
    containsAstronomyRuntime(fs.readFileSync(path.join(assets, file), "utf8"))
  ));
  const detected = [...new Set([...astronomyFileNames, ...astronomyContents])];
  if (detected.length > 0) {
    throw new Error(`astronomy-engine runtime code found: ${detected.join(", ")}`);
  }
  console.log(`[verify-runtime-bundle] scanned ${javascriptAssets.length} JavaScript assets; no astronomy-engine runtime code`);
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) main();
