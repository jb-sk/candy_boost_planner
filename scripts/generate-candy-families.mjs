import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_MASTER = path.join(ROOT, "src/domain/pokesleep/pokemon-master.ts");
const DEFAULT_OUTPUT = path.join(ROOT, "src/domain/pokesleep/_generated/candy-family.ts");
const DEFAULT_OVERRIDES = path.join(__dirname, "candy-family-overrides.json");
const VERIFIED_INITIAL_COMMIT = "962105b3151cfbd3e1ca608faba0c79dc7cc39c3";

function parseArgs(argv) {
  const args = {
    master: DEFAULT_MASTER,
    output: DEFAULT_OUTPUT,
    overrides: DEFAULT_OVERRIDES,
    pokesleepTool: process.env.POKESLEEP_TOOL_PATH
      ? path.resolve(process.env.POKESLEEP_TOOL_PATH)
      : null,
    dryRun: false,
    verify: false,
    refresh: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    // pnpm run forwards the `--` separator verbatim; ignore it instead of failing.
    if (arg === "--") continue;
    if (arg === "--master" && argv[i + 1]) args.master = path.resolve(argv[++i]);
    else if (arg === "--output" && argv[i + 1]) args.output = path.resolve(argv[++i]);
    else if (arg === "--overrides" && argv[i + 1]) args.overrides = path.resolve(argv[++i]);
    else if (arg === "--pokesleep-tool" && argv[i + 1]) args.pokesleepTool = path.resolve(argv[++i]);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--verify") args.verify = true;
    else if (arg === "--refresh") args.refresh = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function extractJsonAssignment(source, exportName) {
  const marker = `export const ${exportName}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`${exportName} not found`);
  const start = source.indexOf("{", markerIndex);
  const endMarker = source.indexOf(" as const", start);
  if (start < 0 || endMarker < 0) throw new Error(`${exportName} is not a JSON object assignment`);
  return JSON.parse(source.slice(start, endMarker).trim());
}

function readMaster(masterPath) {
  const source = fs.readFileSync(masterPath, "utf8");
  const assignment = source.indexOf("] = [");
  if (assignment < 0) throw new Error(`pokemonMaster assignment not found: ${masterPath}`);
  const start = source.indexOf("[", assignment + 4);
  const end = source.indexOf("] as const", start);
  if (start < 0 || end < 0) throw new Error(`pokemonMaster JSON not found: ${masterPath}`);
  const rows = JSON.parse(source.slice(start, end + 1));
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row.pokedexId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid master pokedexId: ${row.pokedexId}`);
    const entries = byId.get(id) ?? [];
    entries.push(row);
    byId.set(id, entries);
  }
  return byId;
}

function readExisting(outputPath) {
  if (!fs.existsSync(outputPath)) return { family: {}, ancestor: {} };
  const source = fs.readFileSync(outputPath, "utf8");
  return {
    family: extractJsonAssignment(source, "candyFamilyByPokedexId"),
    ancestor: extractJsonAssignment(source, "candyFamilyAncestorByPokedexId"),
  };
}

function readOverrides(overridesPath) {
  const parsed = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
  const result = new Map();
  for (const [key, value] of Object.entries(parsed.ancestorByPokedexId ?? {})) {
    const id = Number(key);
    const ancestorId = Number(value?.ancestorId);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(ancestorId) || ancestorId <= 0) {
      throw new Error(`Invalid override: ${key}`);
    }
    if (!String(value?.reason ?? "").trim() || !String(value?.source ?? "").trim()) {
      throw new Error(`Override requires reason and source: ${key}`);
    }
    result.set(id, ancestorId);
  }
  return result;
}

function readNitoyonData(repoPath) {
  if (!repoPath) return null;
  const jsonPath = path.join(repoPath, "src/data/pokemon.json");
  if (!fs.existsSync(jsonPath)) return null;
  const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const ancestors = byId.get(id) ?? new Set();
    if (row.ancestor !== null && row.ancestor !== undefined) ancestors.add(Number(row.ancestor));
    byId.set(id, ancestors);
  }
  let commit = null;
  try {
    commit = execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // A JSON directory without git metadata is still valid as a cross-check source.
  }
  return { byId, commit };
}

function validateSingleAncestor(id, ancestors, sourceLabel) {
  const values = [...ancestors].filter(value => Number.isSafeInteger(value) && value > 0);
  if (values.length > 1) {
    throw new Error(`Conflicting ancestors for #${id} in ${sourceLabel}: ${values.join(", ")}`);
  }
  return values[0] ?? id;
}

function ancestorMapFromNitoyon(masterById, nitoyon, overrides) {
  const result = {};
  for (const id of [...masterById.keys()].sort((a, b) => a - b)) {
    if (!nitoyon.byId.has(id)) throw new Error(`pokesleep-tool is missing master pokedexId #${id}`);
    const resolved = overrides.get(id) ?? validateSingleAncestor(id, nitoyon.byId.get(id), "pokesleep-tool");
    result[String(id)] = resolved;
  }
  return result;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
}

async function fetchHtml(url) {
  const retryable = new Set([408, 429, 500, 502, 503, 504]);
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": "candy-boost-planner (generate-candy-families)" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (attempt === 3) throw new Error(`Wiki fetch failed: ${url}: ${error.message}`);
      continue;
    }
    if (response.ok) return response.text();
    await response.body?.cancel();
    if (!retryable.has(response.status) || attempt === 3) {
      throw new Error(`Wiki fetch failed: ${url}: HTTP ${response.status}`);
    }
  }
  throw new Error(`Wiki fetch failed: ${url}`);
}

function masterNameToIds(masterById) {
  const byName = new Map();
  for (const [id, rows] of masterById) {
    for (const row of rows) {
      for (const name of [row.nameJa, row.baseNameJa]) {
        const normalized = normalizeText(name);
        if (!normalized) continue;
        const ids = byName.get(normalized) ?? new Set();
        ids.add(id);
        byName.set(normalized, ids);
      }
    }
  }
  return byName;
}

function parseWikiAncestor(html, url, nameToIds) {
  const $ = cheerio.load(html);
  const evolutionLink = $('h4 a[title="育成/進化"]').first();
  if (!evolutionLink.length) throw new Error(`育成/進化 section not found: ${url}`);
  const section = evolutionLink.parent().parent();
  const ancestorName = normalizeText(section.find("p > strong > a").first().text());
  if (!ancestorName) return null;
  const ids = nameToIds.get(ancestorName);
  if (!ids || ids.size !== 1) {
    throw new Error(`進化元名を一意に解決できません: ${ancestorName}: ${url}`);
  }
  return [...ids][0];
}

async function fetchAncestorsForId(id, rows, nameToIds, override) {
  if (override !== undefined) return override;
  const links = [...new Set(rows.map(row => row.link).filter(Boolean))];
  if (links.length === 0) throw new Error(`Wiki URLがありません: #${id}`);
  const ancestors = new Set();
  for (const link of links) {
    const html = await fetchHtml(link);
    const ancestor = parseWikiAncestor(html, link, nameToIds);
    if (ancestor !== null) ancestors.add(ancestor);
  }
  return validateSingleAncestor(id, ancestors, "Wiki");
}

function familyMapFromAncestors(masterById, ancestorById) {
  const membersByAncestor = new Map();
  for (const id of masterById.keys()) {
    const ancestor = Number(ancestorById[String(id)]);
    if (!Number.isSafeInteger(ancestor) || ancestor <= 0) throw new Error(`Unresolved ancestor for #${id}`);
    const members = membersByAncestor.get(ancestor) ?? [];
    members.push(id);
    membersByAncestor.set(ancestor, members);
  }
  const family = {};
  for (const members of membersByAncestor.values()) {
    const representative = Math.min(...members);
    for (const id of members) family[String(id)] = representative;
  }
  return Object.fromEntries(Object.entries(family).sort(([a], [b]) => Number(a) - Number(b)));
}

function assertComplete(masterById, family, ancestor) {
  const masterIds = [...masterById.keys()].sort((a, b) => a - b);
  const familyIds = Object.keys(family).map(Number).sort((a, b) => a - b);
  const ancestorIds = Object.keys(ancestor).map(Number).sort((a, b) => a - b);
  if (JSON.stringify(masterIds) !== JSON.stringify(familyIds)) throw new Error("family map does not exactly cover the current master");
  if (JSON.stringify(masterIds) !== JSON.stringify(ancestorIds)) throw new Error("ancestor map does not exactly cover the current master");
  for (const id of masterIds) {
    const representative = Number(family[String(id)]);
    if (!masterById.has(representative)) throw new Error(`Family representative is not in master: #${id} -> #${representative}`);
  }
}

function printMapDiff(label, before, after) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => Number(a) - Number(b));
  for (const key of keys) {
    if (before[key] === undefined) console.log(`[${label} ADDED] #${key} -> #${after[key]}`);
    else if (after[key] === undefined) console.log(`[${label} REMOVED] #${key} (was #${before[key]})`);
    else if (before[key] !== after[key]) console.log(`[${label} CHANGED] #${key}: #${before[key]} -> #${after[key]}`);
  }
}

function generatedContent(family, ancestor, metadata) {
  return `// This file is auto-generated by scripts/generate-candy-families.mjs.\n`
    + `// Initial source: nitoyon/pokesleep-tool ${metadata.commit ?? VERIFIED_INITIAL_COMMIT} (${metadata.generatedOn}).\n`
    + `// Do not edit by hand; update the generator or scripts/candy-family-overrides.json.\n\n`
    + `export const candyFamilyByPokedexId = ${JSON.stringify(family, null, 2)} as const;\n\n`
    + `/** Generator-only evidence used to regroup families when the master gains new IDs. */\n`
    + `export const candyFamilyAncestorByPokedexId = ${JSON.stringify(ancestor, null, 2)} as const;\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const masterById = readMaster(args.master);
  const overrides = readOverrides(args.overrides);
  const existing = readExisting(args.output);
  const nitoyon = readNitoyonData(args.pokesleepTool);

  if (args.verify) {
    assertComplete(masterById, existing.family, existing.ancestor);
    const recomputed = familyMapFromAncestors(masterById, existing.ancestor);
    if (JSON.stringify(recomputed) !== JSON.stringify(existing.family)) {
      throw new Error("family representatives do not match the generated ancestor map");
    }
    console.log(`[SUMMARY] verified=true ids=${masterById.size} families=${new Set(Object.values(existing.family)).size}`);
    return;
  }

  let ancestor = {};
  if (args.refresh) {
    const nameToIds = masterNameToIds(masterById);
    for (const [id, rows] of masterById) {
      ancestor[String(id)] = await fetchAncestorsForId(id, rows, nameToIds, overrides.get(id));
    }
  } else {
    for (const id of masterById.keys()) {
      const existingAncestor = Number(existing.ancestor[String(id)]);
      if (Number.isSafeInteger(existingAncestor) && existingAncestor > 0) ancestor[String(id)] = existingAncestor;
    }
    if (Object.keys(ancestor).length === 0 && nitoyon) {
      ancestor = ancestorMapFromNitoyon(masterById, nitoyon, overrides);
    } else {
      const nameToIds = masterNameToIds(masterById);
      for (const [id, rows] of masterById) {
        if (ancestor[String(id)] !== undefined) continue;
        ancestor[String(id)] = await fetchAncestorsForId(id, rows, nameToIds, overrides.get(id));
      }
    }
  }

  ancestor = Object.fromEntries(Object.entries(ancestor).sort(([a], [b]) => Number(a) - Number(b)));
  const family = familyMapFromAncestors(masterById, ancestor);
  assertComplete(masterById, family, ancestor);

  if (nitoyon) {
    for (const id of masterById.keys()) {
      const external = nitoyon.byId.get(id);
      if (!external) continue;
      const expected = overrides.get(id) ?? validateSingleAncestor(id, external, "pokesleep-tool");
      if (Number(ancestor[String(id)]) !== expected) {
        throw new Error(`Wiki/generated ancestor disagrees with pokesleep-tool: #${id}: ${ancestor[String(id)]} != ${expected}`);
      }
    }
  }

  const semanticChanged = JSON.stringify(existing.family) !== JSON.stringify(family)
    || JSON.stringify(existing.ancestor) !== JSON.stringify(ancestor);
  console.log(`[SUMMARY] has_changes=${semanticChanged} ids=${masterById.size} families=${new Set(Object.values(family)).size}`);
  if (!semanticChanged) return;
  printMapDiff("FAMILY", existing.family, family);
  printMapDiff("ANCESTOR", existing.ancestor, ancestor);
  if (args.dryRun) return;

  const content = generatedContent(family, ancestor, {
    commit: nitoyon?.commit,
    generatedOn: new Date().toISOString().slice(0, 10),
  });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, content, "utf8");
  console.log(`[generate-candy-families] wrote ${args.output}`);
}

main().catch(error => {
  console.error(`[generate-candy-families] ${error.stack ?? error.message}`);
  process.exit(1);
});
