/** 実行時バンドルへ astronomy-engine が戻っていないことを検証する。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "dist/assets");
if (!fs.existsSync(assets)) throw new Error("dist/assets does not exist; run the build first");

const javascriptAssets = fs.readdirSync(assets).filter(file => file.endsWith(".js"));
const astronomyFileNames = javascriptAssets.filter(file => /astronomy/i.test(file));
// Astronomy Engine固有のKM_PER_AU。Rollup/esbuildによる指数・十進表記の両方を検出する。
const astronomySignature = /(?:1\.4959787069098932[eE]\+?8|149597870\.69098932)/;
const astronomyContents = javascriptAssets.filter(file => (
  astronomySignature.test(fs.readFileSync(path.join(assets, file), "utf8"))
));
const detected = [...new Set([...astronomyFileNames, ...astronomyContents])];
if (detected.length > 0) {
  throw new Error(`astronomy-engine runtime code found: ${detected.join(", ")}`);
}
console.log(`[verify-runtime-bundle] scanned ${javascriptAssets.length} JavaScript assets; no astronomy-engine runtime code`);
