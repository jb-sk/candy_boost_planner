/**
 * FineTuneModal Page Object
 * やりくりモーダルのセレクタと操作をまとめる
 * すべてのセレクタはdata-testidベースで統一（接頭辞は fine-tune-）
 */
import { type Page, type Locator, expect } from '@playwright/test';

export type FineTuneMode = 'raise' | 'yield';

export class FineTuneModalPage {
  readonly page: Page;

  // === 入口（計算機の補助ボタン） ===
  readonly openButton: Locator;

  // === モーダル本体 ===
  readonly overlay: Locator;
  readonly modal: Locator;
  readonly closeButton: Locator;
  readonly loading: Locator;
  readonly tabRaise: Locator;
  readonly tabYield: Locator;

  // === 上部 ===
  readonly summary: Locator;
  readonly summaryReached: Locator;
  readonly summaryBoost: Locator;
  readonly summaryShards: Locator;
  readonly summaryCandy: Locator;
  readonly calculating: Locator;
  readonly diagnosis: Locator;
  readonly receiver: Locator;
  readonly receiverName: Locator;
  readonly receiverClear: Locator;
  readonly receiverHint: Locator;
  readonly notices: Locator;
  readonly giveHint: Locator;

  // === 一覧 ===
  readonly list: Locator;
  readonly rows: Locator;

  // === フッター ===
  readonly undoButton: Locator;
  readonly redoButton: Locator;
  readonly resetButton: Locator;
  readonly cancelButton: Locator;
  readonly applyButton: Locator;
  readonly discardConfirm: Locator;
  readonly discardConfirmYes: Locator;
  readonly discardConfirmNo: Locator;

  constructor(page: Page) {
    this.page = page;

    this.openButton = page.getByTestId('fine-tune-open-button');

    this.overlay = page.getByTestId('fine-tune-overlay');
    this.modal = page.getByTestId('fine-tune-modal');
    this.closeButton = page.getByTestId('fine-tune-close');
    this.loading = page.getByTestId('fine-tune-loading');
    this.tabRaise = page.getByTestId('fine-tune-tab-raise');
    this.tabYield = page.getByTestId('fine-tune-tab-yield');

    this.summary = page.getByTestId('fine-tune-summary');
    this.summaryReached = page.getByTestId('fine-tune-summary-reached');
    this.summaryBoost = page.getByTestId('fine-tune-summary-boost');
    this.summaryShards = page.getByTestId('fine-tune-summary-shards');
    this.summaryCandy = page.getByTestId('fine-tune-summary-candy');
    this.calculating = page.getByTestId('fine-tune-calculating');
    this.diagnosis = page.getByTestId('fine-tune-diagnosis');
    this.receiver = page.getByTestId('fine-tune-receiver');
    this.receiverName = page.getByTestId('fine-tune-receiver-name');
    this.receiverClear = page.getByTestId('fine-tune-receiver-clear');
    this.receiverHint = page.getByTestId('fine-tune-receiver-hint');
    this.notices = page.getByTestId('fine-tune-notice');
    this.giveHint = page.getByTestId('fine-tune-give-hint');

    this.list = page.getByTestId('fine-tune-list');
    this.rows = page.getByTestId('fine-tune-row');

    // 計算機のボタン（history-undo-button）と取り違えないよう、モーダル専用の testid を使う
    this.undoButton = page.getByTestId('fine-tune-undo-button');
    this.redoButton = page.getByTestId('fine-tune-redo-button');
    this.resetButton = page.getByTestId('fine-tune-reset');
    this.cancelButton = page.getByTestId('fine-tune-cancel');
    this.applyButton = page.getByTestId('fine-tune-apply');
    this.discardConfirm = page.getByTestId('fine-tune-discard-confirm');
    this.discardConfirmYes = page.getByTestId('fine-tune-discard-confirm-yes');
    this.discardConfirmNo = page.getByTestId('fine-tune-discard-confirm-no');
  }

  // === 開閉 ===

  /** 入口のボタンから開く。スマホ幅では先に計算機のタブへ移る。一覧が出る（計算が終わる）まで待つ。 */
  async open(): Promise<void> {
    const mobileCalcTab = this.page.getByTestId('mobile-nav-calc');
    if (await mobileCalcTab.isVisible()) await mobileCalcTab.click();
    await this.openButton.click();
    await expect(this.modal).toBeVisible();
    await expect(this.rows.first()).toBeVisible();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.overlay).toHaveCount(0);
  }

  async apply(): Promise<void> {
    await this.applyButton.click();
    await expect(this.overlay).toHaveCount(0);
  }

  async selectMode(mode: FineTuneMode): Promise<void> {
    const tab = mode === 'raise' ? this.tabRaise : this.tabYield;
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }

  /** 1回に動かす量（1 / 10 / 100）を選ぶ。 */
  async selectStep(step: 1 | 10 | 100): Promise<void> {
    const choice = this.page.getByTestId(`fine-tune-step-${step}`);
    await choice.click();
    await expect(choice).toHaveAttribute('aria-checked', 'true');
  }

  // === 行へのアクセス ===

  /** 名前（部分一致）で行を引く。 */
  rowByName(name: string): Locator {
    return this.rows.filter({ has: this.page.getByTestId('fine-tune-row-title').filter({ hasText: name }) });
  }

  /** 一覧の行の名前を上から順に返す。 */
  async rowTitles(): Promise<string[]> {
    return (await this.page.getByTestId('fine-tune-row-title').allTextContents()).map((s) => s.trim());
  }

  // === 行内の値 ===

  /** 棒の塗り（%、四捨五入）。結果が無いときは null。 */
  async barPercent(row: Locator): Promise<number | null> {
    const value = await row.getByTestId('fine-tune-row-bar').getAttribute('data-percent');
    return value === null ? null : Number(value);
  }

  /** 到達Lvの表示（`Lv66 → Lv67` など）。 */
  async reachLevelText(row: Locator): Promise<string> {
    return ((await row.getByTestId('fine-tune-row-reach-level').textContent()) ?? '').trim();
  }

  /** 到達Lv（変更後。`Lv66 → Lv67` なら 67）。 */
  async reachLevel(row: Locator): Promise<number> {
    const text = await this.reachLevelText(row);
    const last = text.match(/Lv(\d+)\s*$/);
    if (last === null) throw new Error(`到達Lvを読めません: ${text}`);
    return Number(last[1]);
  }

  async targetLevel(row: Locator): Promise<number> {
    return Number((await row.getByTestId('fine-tune-row-target-level').textContent())?.trim());
  }

  /** アメブの個数（変更後）。アメブの列が無いスロットでは使わない。 */
  async boostValue(row: Locator): Promise<number> {
    const input = row.getByTestId('fine-tune-row-boost-input');
    return Number(await input.inputValue());
  }

  /** 使うアメ（変更後）の表示（`1,482 → 1,276` など）。 */
  async candyText(row: Locator): Promise<string> {
    return ((await row.getByTestId('fine-tune-row-candy').textContent()) ?? '').trim();
  }

  async statusText(row: Locator): Promise<string> {
    return ((await row.getByTestId('fine-tune-row-status').textContent()) ?? '').trim();
  }

  // === 行の操作 ===

  /** モード1のアメブ ▲（1回に動かす量ぶん）。 */
  async boostUp(row: Locator): Promise<void> {
    await row.getByTestId('fine-tune-row-boost-up').click();
  }

  async boostDown(row: Locator): Promise<void> {
    await row.getByTestId('fine-tune-row-boost-down').click();
  }

  async targetUp(row: Locator): Promise<void> {
    await row.getByTestId('fine-tune-row-target-up').click();
  }

  async targetDown(row: Locator): Promise<void> {
    await row.getByTestId('fine-tune-row-target-down').click();
  }

  async moveUp(row: Locator): Promise<void> {
    await row.getByTestId('fine-tune-row-up').click();
  }

  async moveDown(row: Locator): Promise<void> {
    await row.getByTestId('fine-tune-row-down').click();
  }

  getHandle(row: Locator): Locator {
    return row.getByTestId('fine-tune-row-handle');
  }

  /** つかんで動かす並べ替えで浮かぶ全行ナビ（計算機と同じ部品） */
  get reorderNav(): Locator {
    return this.page.getByTestId('calc-reorder-nav');
  }

  /**
   * 取っ手をつかんで、浮かぶ一覧の `toIndex` 番目（0 始まり）の位置へ落とす。
   * 計算機の並べ替えのテスト（04）と同じく、Pointer Events を直接送る。
   */
  async dragRowTo(row: Locator, toIndex: number): Promise<void> {
    const handle = this.getHandle(row);
    await handle.hover();
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const pointerId = 7;
    await handle.dispatchEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId,
      isPrimary: true,
      clientY: box!.y + box!.height / 2,
    });
    await expect(this.reorderNav).toBeVisible();
    const targetY = await this.reorderNav.locator('.calcReorderNav__item').nth(toIndex).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    await this.page.evaluate(({ id, clientY }) => {
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: id, clientY }));
    }, { id: pointerId, clientY: targetY });
    await expect(this.reorderNav.locator('.calcReorderNav__head')).toContainText(`${toIndex + 1} / `);
    await this.page.evaluate(({ id, clientY }) => {
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: id, clientY }));
    }, { id: pointerId, clientY: targetY });
    await expect(this.reorderNav).toBeHidden();
  }

  getGiveSlider(row: Locator): Locator {
    return row.getByTestId('fine-tune-row-give-slider');
  }

  /** 受け取る側に選ぶ（受け取る側が決まっていないときの `[受け取る]`）。 */
  async receive(row: Locator): Promise<void> {
    await row.getByTestId('fine-tune-row-receive').click();
  }

  /**
   * ゆずる側のスライダーを動かしている間の状態にする（input だけ。離していない）。
   * `fill` は離したとき（change）まで起こすので、値を直接入れて input だけを起こす。
   */
  async dragGiveSlider(row: Locator, value: number): Promise<void> {
    await this.getGiveSlider(row).evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }

  /** スライダーを離す（change）。直前に `dragGiveSlider` で入れた値で確定する。 */
  async releaseGiveSlider(row: Locator): Promise<void> {
    await this.getGiveSlider(row).evaluate((el) => {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /** スライダーを動かして離す。 */
  async setGiveSlider(row: Locator, value: number): Promise<void> {
    await this.dragGiveSlider(row, value);
    await this.releaseGiveSlider(row);
  }

  /** プレビュー計算が終わる（「計算中…」が消える）まで待つ。 */
  async waitForSettled(): Promise<void> {
    await expect(this.calculating).toHaveCount(0);
  }
}
