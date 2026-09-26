/**
 * flex の gap（iOS 14.5・Chrome 84 から）が効かない古い端末で、gap の代わりに margin で間隔を付ける。
 *
 * - gap が効く端末では何もしない（起動時に実際に並べて測る）。効かない端末では <html> に `no-flexgap` を付ける。
 * - ブラウザが計算した向き・折り返し・gap から、子要素の margin を inline style で足す（元の margin に加える）。
 *   margin が auto の辺には足さない（`margin-left: auto` の右寄せなどを壊さないため）。
 *   計算後の値では auto を見分けられないので、CSS の規則と inline style から auto の辺を拾う。
 * - 折り返す並びは、どの子がどの行に入るかを本来の gap と同じ規則で計算し、行の2つ目以降と2行目以降にだけ付ける。
 *   親の大きさは変えない（子の幅が % のとき、親を広げると子も広がって折り返しが変わるため）。
 * - 付けた要素の gap は 0 にする。古い端末ではもともと効かないので見た目は変わらず、
 *   gap が効く端末で `?flexGapPolyfill=1` を付けて強制すると古い端末の見た目を再現できる（e2e で使う）。
 * - 画面の書き換え（子の増減・class の変化）、画面幅の変化、テーマの CSS の読み込みのたびに付け直す。
 *
 * iOS 11.x の Safari は gap 自体を解釈しない（grid-gap のみ）ため値を読めず、補正されない。
 */

export type Side = "top" | "right" | "bottom" | "left";
type Margins = Record<Side, number>;

export type FlexContainerInfo = {
  direction: string;
  wrap: string;
  rowGap: number;
  columnGap: number;
  /** 折り返す並びで使う、親の中身の主軸方向の大きさ（px）。 */
  mainSize?: number;
};

/** margin が auto の辺。 */
export type AutoSides = Partial<Record<Side, boolean>>;

/**
 * 並びに加わる子。要素のほか、地の文字（空白だけのものを除く）と ::before / ::after も1つの子として並ぶ。
 * これらには margin を付けられない（unpatchable）ので、隣の要素の側に付ける。
 * mainSize は折り返す並びで使う、伸びる前の主軸方向の大きさ（元の margin を含む）。
 */
export type FlexItem = { kind: "element"; auto: AutoSides; mainSize?: number } | { kind: "unpatchable" };

/** 足す margin の量（元の margin からの差分）。target は渡した子の添字。 */
export type MarginPatch = { target: number; side: Side; delta: number };

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** 並びの情報から、足す margin を決める。子は並びに加わるもの（非表示・絶対配置を除く）だけを並び順に渡す。 */
export function planFlexGapPatches(container: FlexContainerInfo, items: readonly FlexItem[]): MarginPatch[] {
  const row = container.direction.indexOf("row") === 0;
  const reverse = /-reverse$/.test(container.direction);
  const mainGap = row ? container.columnGap : container.rowGap;
  const crossGap = row ? container.rowGap : container.columnGap;
  const mainStart: Side = row ? (reverse ? "right" : "left") : (reverse ? "bottom" : "top");
  const mainEnd = OPPOSITE[mainStart];
  const patches: MarginPatch[] = [];

  // 2つの子の間に主軸の gap を付ける。後ろの子の前側が auto なら、前の子の後ろ側に付ける。
  const addBetween = (previousIndex: number, nextIndex: number) => {
    const previous = items[previousIndex];
    const next = items[nextIndex];
    if (next.kind === "element" && !next.auto[mainStart]) patches.push({ target: nextIndex, side: mainStart, delta: mainGap });
    else if (previous.kind === "element" && !previous.auto[mainEnd]) patches.push({ target: previousIndex, side: mainEnd, delta: mainGap });
  };

  // 地の文字や疑似要素は大きさを測れないので、それを含む並びは折り返さないものとして扱う
  // （文字を含むラベルなどは実際にはほぼ折り返さない）。
  const hasUnpatchable = items.some(item => item.kind === "unpatchable");
  if (container.wrap === "nowrap" || hasUnpatchable || container.mainSize === undefined) {
    if (mainGap <= 0) return patches;
    for (let index = 1; index < items.length; index++) addBetween(index - 1, index);
    return patches;
  }

  // 折り返す並び: 前から順に「子の大きさ + gap」を詰め、入らなければ次の行（本来の gap と同じ規則）。
  const crossStart: Side = row
    ? (container.wrap === "wrap-reverse" ? "bottom" : "top")
    : (container.wrap === "wrap-reverse" ? "right" : "left");
  const available = container.mainSize;
  let line = -1;
  let used = 0;
  items.forEach((item, index) => {
    if (item.kind !== "element") return;
    const size = item.mainSize || 0;
    // 小数の誤差で折り返しを取り違えないよう、わずかに余裕を持たせる。
    if (line < 0 || used + mainGap + size > available + 0.5) {
      // gap が無ければ前の行に入ってしまう子は、前の行の最後の子の後ろを埋めて次の行へ落とす。
      // 埋めるのは gap と行の残りの小さい方（残りを超えると前の行の最後の子まで押し出す）。
      // 前の行に伸びる子（flex-grow）があると、その子が埋めた分だけ細くなる。
      const previous = items[index - 1];
      if (line >= 0 && used + size <= available + 0.5 && previous && previous.kind === "element" && !previous.auto[mainEnd]) {
        const fill = Math.min(mainGap, available - used);
        if (fill > 0) patches.push({ target: index - 1, side: mainEnd, delta: fill });
      }
      line += 1;
      used = size;
    } else {
      used += mainGap + size;
      if (mainGap > 0) addBetween(index - 1, index);
    }
    if (line > 0 && crossGap > 0 && !item.auto[crossStart]) patches.push({ target: index, side: crossStart, delta: crossGap });
  });
  return patches;
}

const FORCE_QUERY_KEY = "flexGapPolyfill";
const NO_FLEX_GAP_CLASS = "no-flexgap";
const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

type InlineChange = { prop: string; value: string; previous: string };

/** 要素ごとに、この補正が書いた inline style と元の値。 */
const changes = new Map<HTMLElement, InlineChange[]>();
/** 補正した親ごとに、margin を書いた子。 */
const patchedChildren = new Map<HTMLElement, HTMLElement[]>();
/** 補正した親のうち折り返す並び。行分けは子孫の大きさで変わるので、子孫が変わったら付け直す。 */
const wrapContainers = new Set<HTMLElement>();

function supportsFlexGap(): boolean {
  const box = document.createElement("div");
  box.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden";
  box.appendChild(document.createElement("div"));
  box.appendChild(document.createElement("div"));
  document.body.appendChild(box);
  const supported = box.scrollHeight === 1;
  document.body.removeChild(box);
  return supported;
}

function isForced(): boolean {
  try {
    return new URLSearchParams(location.search).get(FORCE_QUERY_KEY) === "1";
  } catch {
    return false;
  }
}

function writeInline(element: HTMLElement, prop: string, value: string): void {
  let list = changes.get(element);
  if (!list) {
    list = [];
    changes.set(element, list);
  }
  const existing = list.filter(change => change.prop === prop)[0];
  if (existing) existing.value = value;
  else list.push({ prop, value, previous: element.style.getPropertyValue(prop) });
  element.style.setProperty(prop, value);
}

function restoreInline(element: HTMLElement): void {
  const list = changes.get(element);
  if (!list) return;
  changes.delete(element);
  for (const change of list) {
    // Vue などが後から書き換えた値は残す。
    if (element.style.getPropertyValue(change.prop) !== change.value) continue;
    if (change.previous) element.style.setProperty(change.prop, change.previous);
    else element.style.removeProperty(change.prop);
  }
}

function restoreElement(element: HTMLElement): void {
  restoreInline(element);
  const children = patchedChildren.get(element);
  if (children) children.forEach(restoreInline);
  patchedChildren.delete(element);
  wrapContainers.delete(element);
}

/**
 * margin を書き換える間は transition を止める。テーマによっては margin も動く（`transition: all` など）ため、
 * 止めないと、戻した直後の動いている途中の値を元の margin として読み、付け直すたびに間隔が膨らむ。
 */
const suppressedTransitions = new Map<HTMLElement, string>();

function suppressTransition(element: HTMLElement): void {
  if (suppressedTransitions.has(element)) return;
  suppressedTransitions.set(element, element.style.getPropertyValue("transition"));
  element.style.setProperty("transition", "none");
}

function releaseTransitions(): void {
  if (!suppressedTransitions.size) return;
  // 書いた margin を transition なしで確定させてから戻す。
  void document.body.offsetHeight;
  suppressedTransitions.forEach((previous, element) => {
    if (previous) element.style.setProperty("transition", previous);
    else element.style.removeProperty("transition");
  });
  suppressedTransitions.clear();
}

function px(value: string | null): number {
  const n = parseFloat(value || "");
  return isFinite(n) ? n : 0;
}

function readMargins(style: CSSStyleDeclaration): Margins {
  return { top: px(style.marginTop), right: px(style.marginRight), bottom: px(style.marginBottom), left: px(style.marginLeft) };
}

function isFlex(style: CSSStyleDeclaration): boolean {
  return /^(-webkit-)?(inline-)?flex$/.test(style.display);
}

/** margin が auto の規則のセレクタ（辺ごと）。テーマの差し替えや画面幅の変化（全体の付け直し）で作り直す。 */
let autoMarginSelectors: Record<Side, string[]> | null = null;

function collectAutoMarginSelectors(): Record<Side, string[]> {
  const out: Record<Side, string[]> = { top: [], right: [], bottom: [], left: [] };
  const visit = (rules: CSSRuleList) => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof CSSStyleRule) {
        // 擬似要素のセレクタは要素に当たらない（matches が例外になる）。
        if (rule.selectorText.indexOf("::") >= 0) continue;
        for (const side of SIDES) {
          if (rule.style.getPropertyValue(`margin-${side}`) === "auto") out[side].push(rule.selectorText);
        }
      } else if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.media.mediaText).matches) visit(rule.cssRules);
      } else if ("cssRules" in rule) {
        // @supports など。条件は見ずに中身を拾う（auto の辺に足さないだけなので、多めに拾っても崩れにくい）。
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (let i = 0; i < document.styleSheets.length; i++) {
    try {
      visit((document.styleSheets[i] as CSSStyleSheet).cssRules);
    } catch {
      // 別オリジンの CSS は読めない。
    }
  }
  return out;
}

function readAutoSides(element: HTMLElement): AutoSides {
  if (!autoMarginSelectors) autoMarginSelectors = collectAutoMarginSelectors();
  const auto: AutoSides = {};
  for (const side of SIDES) {
    if (element.style.getPropertyValue(`margin-${side}`) === "auto") {
      auto[side] = true;
      continue;
    }
    auto[side] = autoMarginSelectors[side].some(selector => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    });
  }
  return auto;
}

function collectElements(roots: readonly Element[]): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const add = (element: Element | null) => {
    if (element instanceof HTMLElement) seen.add(element);
  };
  for (const root of roots) {
    add(root);
    // 子の増減は親の並び（先頭がどれか）を変える。見る要素の親は必ず見る要素に含まれる。
    add(root.parentElement);
    // 中身（文字・class）が変わると大きさが変わり、祖先の折り返す並びの行分けが変わる。
    for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (wrapContainers.has(ancestor as HTMLElement)) add(ancestor);
    }
    const all = root.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) add(all[i]);
  }
  return Array.from(seen);
}

/** children と childMargins は items と同じ添字。地の文字の添字は null。 */
type Plan = {
  container: HTMLElement;
  info: FlexContainerInfo;
  children: (HTMLElement | null)[];
  childMargins: (Margins | null)[];
  items: FlexItem[];
};

function run(roots: readonly Element[]): void {
  patchedChildren.forEach((_, container) => {
    if (!container.isConnected) restoreElement(container);
  });
  const elements = collectElements(roots);
  elements.forEach(element => { if (changes.has(element)) suppressTransition(element); });
  // 書き込みと読み取りを交互にするとそのたびに再計算が走るので、戻す→読む→書くの順にまとめる。
  elements.forEach(restoreElement);

  const plans: Plan[] = [];
  for (const element of elements) {
    const style = getComputedStyle(element);
    if (!isFlex(style)) continue;
    const rowGap = px(style.rowGap);
    const columnGap = px(style.columnGap);
    if (rowGap <= 0 && columnGap <= 0) continue;
    // 隠れている並びは大きさを測れない（折り返しを取り違える）。表示されたとき（style・class の変化）に付け直す。
    if (element.getClientRects().length === 0) continue;
    // 見た目の並び順は order で決まる（同じ order なら DOM の順）。::before は先頭、::after は末尾の DOM 位置。
    const entries: { order: number; position: number; child: HTMLElement | null; margins: Margins | null; item: FlexItem }[] = [];
    const addPseudo = (pseudo: "::before" | "::after", position: number) => {
      const pseudoStyle = getComputedStyle(element, pseudo);
      const content = pseudoStyle.content;
      if (!content || content === "none" || content === "normal") return;
      if (pseudoStyle.display === "none" || pseudoStyle.position === "absolute" || pseudoStyle.position === "fixed") return;
      entries.push({ order: px(pseudoStyle.order), position, child: null, margins: null, item: { kind: "unpatchable" } });
    };
    addPseudo("::before", -1);
    for (let i = 0; i < element.childNodes.length; i++) {
      const node = element.childNodes[i];
      if (node.nodeType === Node.TEXT_NODE) {
        if (!/\S/.test(node.nodeValue || "")) continue;
        entries.push({ order: 0, position: i, child: null, margins: null, item: { kind: "unpatchable" } });
        continue;
      }
      if (!(node instanceof HTMLElement)) continue;
      const childStyle = getComputedStyle(node);
      if (childStyle.display === "none" || childStyle.position === "absolute" || childStyle.position === "fixed") continue;
      entries.push({
        order: px(childStyle.order),
        position: i,
        child: node,
        margins: readMargins(childStyle),
        item: { kind: "element", auto: readAutoSides(node) },
      });
    }
    addPseudo("::after", element.childNodes.length);
    entries.sort((a, b) => a.order - b.order || a.position - b.position);
    plans.push({
      container: element,
      info: { direction: style.flexDirection, wrap: style.flexWrap, rowGap, columnGap },
      children: entries.map(entry => entry.child),
      childMargins: entries.map(entry => entry.margins),
      items: entries.map(entry => entry.item),
    });
  }

  measureWrapLines(plans);

  // 同じ要素の同じ辺に2つの差分が付くこともあるので、合計してから書く。
  const totals = new Map<HTMLElement, { base: Margins; delta: Partial<Margins> }>();
  for (const plan of plans) {
    writeInline(plan.container, "row-gap", "0px");
    writeInline(plan.container, "column-gap", "0px");
    const touched: HTMLElement[] = [];
    for (const patch of planFlexGapPatches(plan.info, plan.items)) {
      const child = plan.children[patch.target];
      const base = plan.childMargins[patch.target];
      if (!child || !base) continue;
      let entry = totals.get(child);
      if (!entry) {
        entry = { base, delta: {} };
        totals.set(child, entry);
      }
      entry.delta[patch.side] = (entry.delta[patch.side] || 0) + patch.delta;
      touched.push(child);
    }
    patchedChildren.set(plan.container, touched);
    if (plan.info.wrap !== "nowrap") wrapContainers.add(plan.container);
  }
  totals.forEach(({ base, delta }, element) => {
    suppressTransition(element);
    (Object.keys(delta) as Side[]).forEach(side => {
      writeInline(element, `margin-${side}`, `${base[side] + (delta[side] || 0)}px`);
    });
  });
  releaseTransitions();
}

/**
 * 折り返す並びの、親の中身の大きさと子の大きさを測る。
 * 伸びる子（flex-grow）は行の余りで大きさが変わるので、伸びを止めて伸びる前の大きさを測る。
 */
function measureWrapLines(plans: readonly Plan[]): void {
  const wrapPlans = plans.filter(plan => plan.info.wrap !== "nowrap");
  if (!wrapPlans.length) return;
  const growStopped: HTMLElement[] = [];
  for (const plan of wrapPlans) {
    for (const child of plan.children) {
      if (child && px(getComputedStyle(child).flexGrow) > 0) growStopped.push(child);
    }
  }
  growStopped.forEach(child => writeInline(child, "flex-grow", "0"));

  for (const plan of wrapPlans) {
    const row = plan.info.direction.indexOf("row") === 0;
    const style = getComputedStyle(plan.container);
    plan.info.mainSize = row
      ? plan.container.clientWidth - px(style.paddingLeft) - px(style.paddingRight)
      : plan.container.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
    plan.items.forEach((item, index) => {
      const child = plan.children[index];
      const margins = plan.childMargins[index];
      if (item.kind !== "element" || !child || !margins) return;
      const rect = child.getBoundingClientRect();
      item.mainSize = row ? rect.width + margins.left + margins.right : rect.height + margins.top + margins.bottom;
    });
  }
  growStopped.forEach(restoreInline);
}

let started = false;

/** gap が効かない端末でだけ補正を始める。アプリを mount する前に呼ぶ。 */
export function installFlexGapPolyfill(): void {
  if (started || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  if (!isForced() && supportsFlexGap()) return;
  started = true;
  document.documentElement.classList.add(NO_FLEX_GAP_CLASS);

  const pending = new Set<Element>();
  let full = true;
  let frame = 0;
  function flush(): void {
    frame = 0;
    const roots = full ? [document.body] : Array.from(pending).filter(root => root.isConnected);
    if (full) autoMarginSelectors = null;
    full = false;
    pending.clear();
    if (!roots.length) return;
    run(roots);
    // 補正自身が書いた style の変化は付け直しのきっかけにしない（捨てないと毎フレーム付け直し続ける）。
    observer.takeRecords();
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const scheduleFull = () => {
    full = true;
    schedule();
  };

  // v-show などの表示の切り替えは style 属性の変化なので、class と合わせて見張る。
  // 文字だけの書き換え（件数の更新・言語の切り替え）は、その文字を持つ要素の変化として扱う。
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target) continue;
      // テーマの CSS の差し替えなど。読み込みの完了は下の load で拾う。
      if (target === document.head || document.head.contains(target)) scheduleFull();
      else pending.add(target);
    }
    schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });

  document.addEventListener("load", event => {
    if (event.target instanceof HTMLLinkElement) scheduleFull();
  }, true);
  window.addEventListener("resize", scheduleFull);
  window.addEventListener("orientationchange", scheduleFull);
  scheduleFull();
}
