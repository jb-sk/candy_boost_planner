/**
 * Theme configuration — constants + auto-detection from CSS files.
 *
 * Gacha themes are auto-detected: just drop a CSS file into
 *   src/styles/<id>.css
 * and it appears in the theme picker automatically.
 *
 * "base" is excluded (gacha seed template, not user-selectable).
 */

export interface ThemeDef {
  /** Unique key — matches the CSS filename (without extension) */
  id: string;
  /** Display label shown in the design-switch combo-box */
  label: string;
}

/** localStorage key */
export const DESIGN_STORAGE_KEY = "candy-boost-planner:design";

/** Default when nothing is stored */
export const DEFAULT_THEME_ID = "blue";

/** Files that live in themes/ but are NOT selectable themes */
const EXCLUDED = new Set(["base"]);

/**
 * Build the theme list from Vite's glob result.
 *
 * Call with:
 *   buildThemeList(import.meta.glob("../styles/*.css"))
 *
 * Returns e.g. [{ id: "blue", label: "Blue" }, { id: "booklet", label: "Booklet" }, ...]
 */
export function buildThemeList(
  globResult: Record<string, () => Promise<unknown>>,
): ThemeDef[] {
  const ids: string[] = [];
  for (const path of Object.keys(globResult)) {
    // path looks like "../styles/base.css" or "./styles/blue.css"
    const match = path.match(/\/([^/]+)\.css$/);
    if (!match) continue;
    const id = match[1];
    if (EXCLUDED.has(id)) continue;
    ids.push(id);
  }

  // Sort alphabetically
  ids.sort((a, b) => a.localeCompare(b));

  return ids.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
  }));
}
