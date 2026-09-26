/**
 * 入力欄やボタンの近くに出す浮き要素（計算機のヒント、テンキー）の位置決め。
 *
 * 浮き要素は body 直下へ Teleport し、`position: absolute` のページ座標で置く。
 * 画面に固定（fixed）すると、ページがスクロールしたとき対象から離れて取り残される。
 */

/** 画面の左右・上端から空ける距離。 */
const EDGE_GAP = 8;
/**
 * 画面下端から空ける距離。iOS Safari はツールバーが縮んでいるとき、下端付近のタップを
 * ボタンへ渡さずツールバーの展開に使う（確定ボタンなどが一度で押せない）。ホームインジケーターの
 * 領域（約 34px）とその上の展開用の帯をまとめて避ける。
 */
const BOTTOM_GAP = 64;
/** 対象と浮き要素の間隔。 */
const ANCHOR_GAP = 6;
/**
 * iOS が入力欄のフォーカスで出す入力補助バー（∧ ∨ 完了）の高さ。古い iOS は readonly の欄でも出す。
 * 見えている範囲を測れる端末（visualViewport、iOS 13 から）では使わず、測れない iOS 12 だけこの高さを見込んで空ける。
 */
const FORM_ACCESSORY_BAR = 44;

type ViewportBox = { left: number; top: number; right: number; bottom: number };

/**
 * 実際に見えている範囲（ビューポート座標）。入力補助バーやキーボードが出ると visualViewport は縮むが、
 * window.innerHeight は変わらない。visualViewport が無い端末は window の大きさを使う。
 */
function visibleViewport(): ViewportBox {
  const viewport = window.visualViewport;
  if (viewport) {
    return {
      left: viewport.offsetLeft,
      top: viewport.offsetTop,
      right: viewport.offsetLeft + viewport.width,
      bottom: viewport.offsetTop + viewport.height,
    };
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/**
 * 画面上部に張り付いている帯の下端（ビューポート座標）。上に出すときはこれより下に置く。
 *
 * - スマホのナビ（.mobileNav）: どのパネルでも上部に張り付く。PC 幅では非表示で矩形が無い。
 * - 計算機のサマリー（.calcSticky）: 計算機の欄とそのヒント内の欄のときだけ見る。
 *   タブレット横向きの2列表示では、ボックスの欄の隣の列にもサマリーがあるため。
 *   張り付く前（通常の位置）でも、サマリーは計算行より上にあるので下端を基準にしてよい。
 */
function stickyHeadersBottom(anchor: Element, viewportTop: number): number {
  const bands = [document.querySelector<HTMLElement>(".mobileNav")];
  if (anchor.closest("#neo-calc, .hintPopover--anchored")) bands.push(document.querySelector<HTMLElement>(".calcSticky"));
  let bottom = viewportTop + EDGE_GAP;
  for (const band of bands) {
    if (!band || band.getClientRects().length === 0) continue;
    bottom = Math.max(bottom, band.getBoundingClientRect().bottom);
  }
  return bottom;
}

/**
 * `floating` を `anchor` の下に出し、収まらなければ上、どちらにも収まらなければ
 * 画面下端（BOTTOM_GAP だけ空けた位置）に合わせる。左右は画面内に収める。
 *
 * `formAccessory`: 対象がフォーカス中の入力欄で、iOS の入力補助バーが下に出ることがある（テンキー）。
 *
 * 戻り値は body 基準の座標（`position: absolute` の left / top にそのまま使う）。
 * window.scrollY を足すだけだと、モーダル表示中（body を position: fixed にして
 * スクロールを止めている）にずれる。body の余白は 0 なので、body の矩形が基準になる。
 */
/**
 * 見えている範囲の下端から空ける距離。
 * 入力欄のフォーカス中（formAccessory）は、下に入力補助バーかキーボードがあり Safari のツールバーは無いので、
 * ツールバーの展開用の帯（BOTTOM_GAP）は要らない。見えている範囲が縮んでいればそれがバーの上端。
 * 測れない iOS 12 はバーの高さを見込む。
 */
function bottomGap(formAccessory: boolean): number {
  if (!formAccessory) return BOTTOM_GAP;
  const viewport = window.visualViewport;
  if (!viewport) return FORM_ACCESSORY_BAR + EDGE_GAP;
  return viewport.height < window.innerHeight - 1 ? EDGE_GAP : BOTTOM_GAP;
}

export function placeNearAnchor(
  anchor: Element,
  floating: HTMLElement,
  options: { formAccessory?: boolean } = {},
): { left: number; top: number } {
  const rect = anchor.getBoundingClientRect();
  const width = floating.offsetWidth;
  const height = floating.offsetHeight;
  const viewport = visibleViewport();

  const left = Math.max(viewport.left + EDGE_GAP, Math.min(rect.left, viewport.right - EDGE_GAP - width));

  const topBound = stickyHeadersBottom(anchor, viewport.top);
  const bottomBound = viewport.bottom - bottomGap(options.formAccessory === true);
  let top = rect.bottom + ANCHOR_GAP;
  if (top + height > bottomBound) {
    const above = rect.top - ANCHOR_GAP - height;
    // 上下どちらにも収まらないときは、押すボタンが画面外や下端の帯へ出ないよう持ち上げる。
    // 対象に少し被っても、ヒントやテンキーの中身が読めて押せる方を優先する。
    // テンキーは下端の確定ボタンが押せることを優先し、上部に張り付いた帯に重なってでも下端を収める
    // （iPhone 6 など画面の低い端末では、帯と入力補助バーの間にテンキーが収まらない）。
    // 上に出すときも、対象そのものが入力補助バーの裏に入っていると下端がはみ出すので、下端を超えないよう持ち上げる。
    const minTop = options.formAccessory ? viewport.top + EDGE_GAP : topBound;
    top = above >= topBound ? Math.min(above, bottomBound - height) : bottomBound - height;
    top = Math.max(minTop, top);
  }

  const base = document.body.getBoundingClientRect();
  return { left: left - base.left, top: top - base.top };
}
