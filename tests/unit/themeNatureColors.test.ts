import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * EXP性格補正の記号色を全テーマで「▲▲ = 赤系 / ▼▼ = 青系」に保つ（2026-07-29・ユーザー指定）。
 *
 * テーマは `src/styles/*.css` を Design Switcher が自動検出して増える。
 * 色味はテーマごとに変えてよいが、**赤／青の対応を入れ替えてはいけない。**
 *
 * **「変数が定義されているか」だけを見るテストにはしないこと。**
 * この変更の前は全テーマが `--nature-up` = 緑 / `--nature-down` = 赤で、
 * 存在チェックだけなら素通りする。色相まで見て初めて意味が固定される。
 */
const STYLES_DIR = fileURLToPath(new URL('../../src/styles', import.meta.url));

const themeFiles = readdirSync(STYLES_DIR).filter(name => name.endsWith('.css'));

type Rgb = { r: number; g: number; b: number };

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
      h < 120 ? [x, c, 0] :
        h < 180 ? [0, c, x] :
          h < 240 ? [0, x, c] :
            h < 300 ? [x, 0, c] : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function parseColor(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const hsl = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i.exec(value);
  if (hsl) {
    return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  }
  throw new Error(`未対応の色表記: ${value}（このテストに変換を足すこと）`);
}

/**
 * 同じ `:root` に複数回書かれた場合、CSS では**後勝ち**になる。
 * 実際にこの変更で、既存宣言に気づかず重複を足して無効化された事故があったので、
 * 最後の宣言を見る。コメントは先に落とす（コメントアウトした宣言を拾わないため）。
 */
function effectiveVar(css: string, name: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const matches = [...stripped.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, 'g'))];
  if (matches.length === 0) throw new Error(`--${name} が定義されていない`);
  return matches[matches.length - 1]![1]!.trim();
}

describe('テーマの性格記号カラー', () => {
  it('前提: テーマCSSを実際に列挙できている', () => {
    // 列挙に失敗すると it.each が0件になり、何も検証しないまま緑になるため先に固定する。
    expect(themeFiles.length).toBeGreaterThanOrEqual(8);
    expect(themeFiles).toContain('base.css');
  });

  it.each(themeFiles)('%s: ▲▲ が赤系 / ▼▼ が青系', name => {
    const css = readFileSync(join(STYLES_DIR, name), 'utf8');

    const up = parseColor(effectiveVar(css, 'nature-up'));
    const down = parseColor(effectiveVar(css, 'nature-down'));

    // 赤系 = 赤成分が最も強い。緑やオレンジ寄りに倒れたら落とす。
    expect(up.r).toBeGreaterThan(up.g);
    expect(up.r).toBeGreaterThan(up.b);

    // 青系 = 青成分が最も強い。
    expect(down.b).toBeGreaterThan(down.r);
    expect(down.b).toBeGreaterThan(down.g);
  });
});
