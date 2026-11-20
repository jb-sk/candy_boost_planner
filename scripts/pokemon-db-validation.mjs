import ts from "typescript";

export const MAX_DEX_NO = 0xfff; // 4095 (idForm の下位12ビット上限)
export const MAX_FORM_NO = 0x7ffff; // 524287 (32ビット符号付き整数で (form << 12) >> 12 が可逆な上限)

/**
 * idForm 符号化（下位12ビット = dexNo）に収まる有効な全国図鑑番号かを判定する。
 * @param {unknown} value
 * @returns {value is number}
 */
export function isValidDexNo(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_DEX_NO;
}

/**
 * idForm 符号化（上位ビット = form << 12）で可逆なフォーム番号かを判定する。
 * @param {unknown} value
 * @returns {value is number}
 */
export function isValidFormNo(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_FORM_NO;
}

/**
 * dexNo と form を可逆な idForm へ符号化する。範囲外の値は例外を送出する。
 * @param {number} dexNo
 * @param {number} form
 */
export function encodeIdForm(dexNo, form) {
  if (!isValidDexNo(dexNo)) {
    throw new Error(`dexNo は 1..${MAX_DEX_NO} の整数である必要があります (${String(dexNo)})`);
  }
  if (!isValidFormNo(form)) {
    throw new Error(`form は 0..${MAX_FORM_NO} の整数である必要があります (${String(form)})`);
  }
  return dexNo + (form << 12);
}

/**
 * TS 単一行コメント (`// ...`) へ安全に埋め込むため、全 JS 改行文字（CR/LF/LS/PS）を空白へ正規化する。
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function sanitizeSingleLineComment(value, fallback = "(unknown)") {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
  return cleaned || fallback;
}

function isStringArrayOrNullish(value) {
  if (value === null || value === undefined) return true;
  return Array.isArray(value) && value.every((el) => typeof el === "string");
}

function isStringOrNullish(value) {
  return value === null || value === undefined || typeof value === "string";
}

function isFiniteNumberOrNullish(value) {
  return value === null || value === undefined || (typeof value === "number" && Number.isFinite(value));
}

/**
 * pokemon-db.json の items 配列と各行の PokemonDbEntry 準拠フィールド型を検証する（共通入力境界バリデータ）。
 * @param {unknown} items
 * @param {string} [sourceLabel]
 * @param {{ allowEmpty?: boolean }} [options]
 */
export function validatePokemonDbItems(items, sourceLabel = "pokemon-db.json", options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  if (!Array.isArray(items)) {
    throw new Error(`${sourceLabel}: items が配列ではありません`);
  }
  if (!allowEmpty && items.length === 0) {
    throw new Error(`${sourceLabel}: items が空です`);
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${sourceLabel}: items[${i}] がオブジェクトではありません`);
    }
    const {
      dexNo,
      nameJa,
      specialtyJa,
      sleepTypeJa,
      berryJa,
      ingAJa,
      ingBJa,
      ingCJa,
      mainSkillJa,
      fp,
      helpSeconds,
      link,
    } = item;
    if (!isValidDexNo(dexNo)) {
      throw new Error(`${sourceLabel}: items[${i}].dexNo は 1..${MAX_DEX_NO} の整数である必要があります (${String(dexNo)})`);
    }
    if (typeof nameJa !== "string" || nameJa.trim().length === 0) {
      throw new Error(`${sourceLabel}: items[${i}].nameJa が空または文字列ではありません`);
    }
    for (const [field, val] of [
      ["specialtyJa", specialtyJa],
      ["sleepTypeJa", sleepTypeJa],
      ["mainSkillJa", mainSkillJa],
      ["link", link],
    ]) {
      if (!isStringOrNullish(val)) {
        throw new Error(`${sourceLabel}: items[${i}] (#${dexNo} ${nameJa}) の ${field} が文字列/null ではありません`);
      }
    }
    for (const [field, val] of [
      ["berryJa", berryJa],
      ["ingAJa", ingAJa],
      ["ingBJa", ingBJa],
      ["ingCJa", ingCJa],
    ]) {
      if (!isStringArrayOrNullish(val)) {
        throw new Error(`${sourceLabel}: items[${i}] (#${dexNo} ${nameJa}) の ${field} が文字列配列/null ではありません`);
      }
    }
    for (const [field, val] of [
      ["fp", fp],
      ["helpSeconds", helpSeconds],
    ]) {
      if (!isFiniteNumberOrNullish(val)) {
        throw new Error(`${sourceLabel}: items[${i}] (#${dexNo} ${nameJa}) の ${field} が有限数値/null ではありません`);
      }
    }
  }

  return items;
}

/**
 * pokemon-db.json のトップレベルペイロードを検証し、検証済みの items を返す。
 * @param {unknown} payload
 * @param {string} [sourceLabel]
 */
export function validatePokemonDbPayload(payload, sourceLabel = "pokemon-db.json") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${sourceLabel}: JSON ルートがオブジェクトではありません`);
  }
  const obj = /** @type {{ source?: unknown, headers?: unknown, items?: unknown, pickedTable?: unknown }} */ (payload);
  if (!isStringOrNullish(obj.source)) {
    throw new Error(`${sourceLabel}: source が文字列/null ではありません`);
  }
  if (obj.headers !== undefined && (!Array.isArray(obj.headers) || !obj.headers.every((h) => typeof h === "string"))) {
    throw new Error(`${sourceLabel}: headers が文字列配列ではありません`);
  }
  const items = validatePokemonDbItems(obj.items, sourceLabel, {
    allowEmpty: false,
  });
  return {
    source: typeof obj.source === "string" ? obj.source : null,
    headers: /** @type {string[]} */ (obj.headers ?? []),
    items,
  };
}

/**
 * 公開用 pokemon-db.ts / pokemon-db.json の単一ソースとなる正規化済みペイロードを返す。
 * 全12プロパティの型を PokemonDbEntry 準拠で検証し、省略された nullable フィールドを明示 null で補完する。
 * @param {unknown} payload
 * @param {string} [sourceLabel]
 */
export function normalizePokemonDbPayloadForPublish(payload, sourceLabel = "pokemon-db.json") {
  const validated = validatePokemonDbPayload(payload, sourceLabel);
  const obj = /** @type {{ pickedTable?: unknown }} */ (payload);
  if (
    obj.pickedTable !== undefined &&
    obj.pickedTable !== null &&
    (typeof obj.pickedTable !== "object" || Array.isArray(obj.pickedTable))
  ) {
    throw new Error(`${sourceLabel}: pickedTable がオブジェクトではありません`);
  }

  const normalizedItems = validated.items.map((item) => ({
    dexNo: item.dexNo,
    nameJa: item.nameJa,
    specialtyJa: item.specialtyJa ?? null,
    sleepTypeJa: item.sleepTypeJa ?? null,
    berryJa: item.berryJa ?? null,
    ingAJa: item.ingAJa ?? null,
    ingBJa: item.ingBJa ?? null,
    ingCJa: item.ingCJa ?? null,
    mainSkillJa: item.mainSkillJa ?? null,
    fp: item.fp ?? null,
    helpSeconds: item.helpSeconds ?? null,
    link: item.link ?? null,
  }));

  /** @type {{ source: string | null, headers: string[], items: typeof normalizedItems, pickedTable?: unknown }} */
  const out = {
    source: validated.source,
    headers: [...validated.headers],
    items: normalizedItems,
  };
  if (obj.pickedTable !== undefined) {
    out.pickedTable = obj.pickedTable;
  }
  return out;
}

function unwrapTsExpr(node) {
  let cur = node;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

/**
 * TypeScript ファイルからトップレベルの `export const <name> = { ... } as const;` オブジェクト群を AST 抽出する。
 * コメント内の擬似宣言を無視し、重複宣言や非オブジェクトは null として返す。
 * @param {string} tsContent
 * @param {string[]} constNames
 * @param {string} [sourceLabel]
 * @returns {Map<string, Record<string, unknown> | null>}
 */
export function parseExportedJsonObjectsFromTs(tsContent, constNames, sourceLabel = "generated.ts") {
  const sf = ts.createSourceFile(
    sourceLabel,
    tsContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const wanted = new Set(constNames);
  /** @type {Map<string, Record<string, unknown> | null>} */
  const found = new Map();

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExported = Boolean(
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    );
    if (!isExported) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !wanted.has(decl.name.text) || !decl.initializer) {
        continue;
      }
      const name = decl.name.text;
      if (found.has(name)) {
        found.set(name, null);
        continue;
      }
      const init = unwrapTsExpr(decl.initializer);
      if (!ts.isObjectLiteralExpression(init)) {
        found.set(name, null);
        continue;
      }
      try {
        const parsed = JSON.parse(init.getText(sf));
        found.set(
          name,
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null,
        );
      } catch {
        found.set(name, null);
      }
    }
  }
  return found;
}

/**
 * 既存の pokemon-master.ts から実際にエクスポートされた pokemonMaster 配列を TypeScript AST で厳密抽出する。
 * - コメント内の擬似宣言を無視し、トップレベルの `export const pokemonMaster` のみ対象にする。
 * - 構文エラー・宣言欠落・重複・空配列・不正型/不一致の dexNo/pokedexId/form はすべて例外を送出する。
 * @param {string} masterTsContent
 * @param {string} [sourceLabel]
 * @returns {Array<{ dexNo: number, form: number, idForm: number, row: Record<string, unknown> }>}
 */
export function parsePokemonMasterEntriesFromTs(masterTsContent, sourceLabel = "pokemon-master.ts") {
  const syntaxCheck = ts.transpileModule(masterTsContent, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  });
  const syntaxErrors = (syntaxCheck.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (syntaxErrors.length > 0) {
    const msg = syntaxErrors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
      .join("; ");
    throw new Error(`${sourceLabel}: TypeScript 構文エラーがあります (${msg})`);
  }

  const sf = ts.createSourceFile(
    sourceLabel,
    masterTsContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  /** @type {ts.VariableDeclaration[]} */
  const matches = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExported = Boolean(
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    );
    if (!isExported) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === "pokemonMaster" && decl.initializer) {
        matches.push(decl);
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`${sourceLabel}: export const pokemonMaster 宣言が見つかりません`);
  }
  if (matches.length > 1) {
    throw new Error(`${sourceLabel}: export const pokemonMaster 宣言が複数あります (${matches.length} 件)`);
  }

  const init = unwrapTsExpr(matches[0].initializer);
  if (!ts.isArrayLiteralExpression(init)) {
    throw new Error(`${sourceLabel}: pokemonMaster の初期化子が配列リテラルではありません`);
  }

  let data;
  try {
    data = JSON.parse(init.getText(sf));
  } catch (err) {
    throw new Error(
      `${sourceLabel}: pokemonMaster の JSON パースに失敗しました (${err instanceof Error ? err.message : String(err)})`,
      { cause: err },
    );
  }
  if (!Array.isArray(data)) {
    throw new Error(`${sourceLabel}: pokemonMaster が配列ではありません`);
  }
  if (data.length === 0) {
    throw new Error(`${sourceLabel}: pokemonMaster 配列が空です`);
  }

  /** @type {Array<{ dexNo: number, form: number, idForm: number, row: Record<string, unknown> }>} */
  const entries = [];
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    if (!x || typeof x !== "object" || Array.isArray(x)) {
      throw new Error(`${sourceLabel}: pokemonMaster[${i}] がオブジェクトではありません`);
    }
    const hasDexNo = x.dexNo !== undefined;
    const hasPokedexId = x.pokedexId !== undefined;
    if (!hasDexNo && !hasPokedexId) {
      throw new Error(`${sourceLabel}: pokemonMaster[${i}] に dexNo / pokedexId がありません`);
    }
    if (hasDexNo && !isValidDexNo(x.dexNo)) {
      throw new Error(
        `${sourceLabel}: pokemonMaster[${i}] の dexNo が不正です (${JSON.stringify(x.dexNo)})`,
      );
    }
    if (hasPokedexId && !isValidDexNo(x.pokedexId)) {
      throw new Error(
        `${sourceLabel}: pokemonMaster[${i}] の pokedexId が不正です (${JSON.stringify(x.pokedexId)})`,
      );
    }
    if (hasDexNo && hasPokedexId && x.dexNo !== x.pokedexId) {
      throw new Error(
        `${sourceLabel}: pokemonMaster[${i}] の dexNo (${x.dexNo}) と pokedexId (${x.pokedexId}) が一致しません`,
      );
    }
    const dexNo = /** @type {number} */ (hasDexNo ? x.dexNo : x.pokedexId);

    const form = x.form === undefined ? 0 : x.form;
    if (!isValidFormNo(form)) {
      throw new Error(
        `${sourceLabel}: pokemonMaster[${i}] の form が不正です (${JSON.stringify(x.form)})`,
      );
    }
    entries.push({ dexNo, form, idForm: encodeIdForm(dexNo, form), row: x });
  }
  return entries;
}
