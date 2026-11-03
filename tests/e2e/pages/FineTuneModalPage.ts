/**
 * FineTuneModal Page Object（シンプル）
 * セレクタと操作をまとめる。すべてのセレクタは data-testid ベース（接頭辞は fine-tune-）
 */
import { type Page, type Locator, expect } from '@playwright/test';

/** 表で押せる欄。`row` は名前（行の詳細） */
export type FineTuneField = 'row' | 'target' | 'sleep' | 'boost' | 'candy';

/** 睡眠目標の選択肢（調整バーの data-option） */
export type FineTuneSleepOption = 'none' | 'h200' | 'h500' | 'h1000' | 'h2000' | 'sleep' | 'nap';

const CELL_TEST_ID: Record<Exclude<FineTuneField, 'row'> | 'reach' | 'shardsPerCandy', string> = {
  target: 'fine-tune-row-target',
  sleep: 'fine-tune-row-sleep',
  boost: 'fine-tune-row-boost',
  candy: 'fine-tune-row-candy',
  reach: 'fine-tune-row-reach',
  shardsPerCandy: 'fine-tune-row-shards-per-candy',
};

export class FineTuneModalPage {
  readonly page: Page;

  // === 入口（計算機の補助ボタン） ===
  readonly openButton: Locator;

  // === モーダル本体 ===
  readonly overlay: Locator;
  readonly modal: Locator;
  readonly closeButton: Locator;
  readonly loading: Locator;

  // === 上部 ===
  readonly summary: Locator;
  readonly summaryBoost: Locator;
  readonly summaryShards: Locator;
  readonly calculating: Locator;

  // === 一覧 ===
  readonly list: Locator;
  readonly rows: Locator;

  // === 調整バー ===
  readonly editor: Locator;
  readonly editorName: Locator;
  readonly editorChange: Locator;
  readonly editorInfo: Locator;
  readonly editorNote: Locator;
  readonly editorInput: Locator;
  readonly editorRecommend: Locator;
  /** 何も選んでいないときの押せない刻みのボタン */
  readonly editorIdle: Locator;

  // === フッター ===
  readonly raiseButton: Locator;
  readonly undoButton: Locator;
  readonly redoButton: Locator;
  readonly applyButton: Locator;
  /** 適用の隣のキャンセル（この画面での変更をすべて捨てて閉じる） */
  readonly cancelButton: Locator;
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

    this.summary = page.getByTestId('fine-tune-summary');
    this.summaryBoost = page.getByTestId('fine-tune-summary-boost');
    this.summaryShards = page.getByTestId('fine-tune-summary-shards');
    this.calculating = page.getByTestId('fine-tune-calculating');

    this.list = page.getByTestId('fine-tune-list');
    this.rows = page.getByTestId('fine-tune-row');

    this.editor = page.getByTestId('fine-tune-editor');
    this.editorName = page.getByTestId('fine-tune-editor-name');
    this.editorChange = page.getByTestId('fine-tune-editor-change');
    this.editorInfo = page.getByTestId('fine-tune-editor-info');
    this.editorNote = page.getByTestId('fine-tune-editor-note');
    this.editorInput = page.getByTestId('fine-tune-editor-input');
    this.editorRecommend = page.getByTestId('fine-tune-editor-recommend');
    this.editorIdle = page.getByTestId('fine-tune-editor-idle');

    this.raiseButton = page.getByTestId('fine-tune-raise');
    // 計算機のボタン（history-undo-button）と取り違えないよう、モーダル専用の testid を使う
    this.undoButton = page.getByTestId('fine-tune-undo-button');
    this.redoButton = page.getByTestId('fine-tune-redo-button');
    this.applyButton = page.getByTestId('fine-tune-apply');
    this.cancelButton = page.getByTestId('fine-tune-cancel');
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

  async apply(): Promise<void> {
    await this.applyButton.click();
    await expect(this.overlay).toHaveCount(0);
  }

  /** × で閉じる。下書きがあれば確認で「破棄して閉じる」を押す。 */
  async discardAndClose(): Promise<void> {
    await this.closeButton.click();
    if (await this.discardConfirm.isVisible()) await this.discardConfirmYes.click();
    await expect(this.overlay).toHaveCount(0);
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

  cell(row: Locator, name: keyof typeof CELL_TEST_ID): Locator {
    return row.getByTestId(CELL_TEST_ID[name]);
  }

  /** 欄の数字（桁区切りを外す）。「-」は NaN。 */
  async cellNumber(row: Locator, name: keyof typeof CELL_TEST_ID): Promise<number> {
    const text = ((await this.cell(row, name).textContent()) ?? '').replace(/[,\s]/g, '');
    return Number(text);
  }

  async targetLevel(row: Locator): Promise<number> {
    return this.cellNumber(row, 'target');
  }

  async boostValue(row: Locator): Promise<number> {
    return this.cellNumber(row, 'boost');
  }

  async candyValue(row: Locator): Promise<number> {
    return this.cellNumber(row, 'candy');
  }

  /** アメで届く到達Lv（最新の結果）。 */
  async reachLevel(row: Locator): Promise<number> {
    return Number(await row.getAttribute('data-reach-level'));
  }

  /**
   * 到達点を比べられる数（到達Lv が上、同じ Lv なら次までのEXPが少ないほど大きい）。
   * 例: Lv26 あと483 と Lv26 あと100 なら後者が大きい。
   */
  async reachPoint(row: Locator): Promise<number> {
    const level = await this.reachLevel(row);
    const left = Number(await row.getAttribute('data-exp-left'));
    return level * 1e8 - left;
  }

  // === 選ぶ・調整バー ===

  /**
   * 欄を押して、調整バーをその欄にする。すでにその欄なら押さない（同じ欄を押すと選択が外れるため）。
   * 調整バーは常に出ているので、行と欄が切り替わるまで待つ。動かせない欄を押すと行の詳細（row）になる。
   */
  async select(row: Locator, field: FineTuneField): Promise<void> {
    const rowId = (await row.getAttribute('data-row-id'))!;
    const selected = await this.editor.getAttribute('data-row-id') === rowId
      && await this.editor.getAttribute('data-field') === field;
    if (!selected) {
      const target = field === 'row' ? row.getByTestId('fine-tune-row-name') : this.cell(row, field);
      await target.click();
    }
    await expect(this.editor).toHaveAttribute('data-row-id', rowId);
  }

  /** 何も選んでいない（調整バーが押せない刻みのボタンだけの）状態か */
  async expectIdle(): Promise<void> {
    await expect(this.editorIdle).toBeVisible();
    await expect(this.editor).not.toHaveAttribute('data-row-id', /./);
  }

  /** 調整バーの刻みのボタン（アメブ・アメは -100 / -10 / -1 / +1 / +10 / +100、目標Lvは ◀ ▶ の ±1）を押す。 */
  async step(delta: number): Promise<void> {
    await this.editor.locator(`[data-testid="fine-tune-editor-step"][data-delta="${delta}"]`).click();
  }

  stepButton(delta: number): Locator {
    return this.editor.locator(`[data-testid="fine-tune-editor-step"][data-delta="${delta}"]`);
  }

  /** 調整バーの個数欄（目標Lvは Lv の欄）に打って Enter で確定する（PC幅。スマホはテンキーの読み取り専用欄）。 */
  async typeValue(value: number): Promise<void> {
    await this.editorInput.fill(String(value));
    await this.editorInput.press('Enter');
  }

  /** 調整バーの見出しのリセット（この欄を押す前の値へ戻す。選択はそのまま） */
  get resetEditButton(): Locator {
    return this.editor.getByTestId('fine-tune-editor-reset');
  }

  /** 行の詳細（名前を押したとき）の欄: 現在Lv・あとEXP・アメ在庫 */
  rowProp(key: 'srcLevel' | 'exp' | 'stock'): Locator {
    return this.editor.locator(`[data-testid="fine-tune-editor-prop"][data-prop="${key}"]`);
  }

  /** 行の詳細の欄に打って Enter で確定する（PC幅） */
  async typeRowProp(key: 'srcLevel' | 'exp' | 'stock', value: number): Promise<void> {
    await this.rowProp(key).fill(String(value));
    await this.rowProp(key).press('Enter');
  }

  /** 目標Lv: スライダーで Lv を入れる */
  async setLevel(level: number): Promise<void> {
    await this.editor.getByTestId('fine-tune-editor-level-range').fill(String(level));
  }

  /** 目標Lv: Lv の丸いボタン */
  levelChip(level: number): Locator {
    return this.editor.locator(`[data-testid="fine-tune-editor-level-chip"][data-level="${level}"]`);
  }

  /** アメブの最小アメブ・リセット */
  get minimizeButton(): Locator {
    return this.editor.getByTestId('fine-tune-editor-minimize');
  }

  get boostResetButton(): Locator {
    return this.editor.getByTestId('fine-tune-editor-boost-reset');
  }

  /** 睡眠目標の選択肢・アメ在庫・チケット */
  sleepOption(option: FineTuneSleepOption): Locator {
    return this.editor.locator(`[data-testid="fine-tune-editor-sleep-option"][data-option="${option}"]`);
  }

  get sleepStockToggle(): Locator {
    return this.editor.getByTestId('fine-tune-editor-sleep-stock');
  }

  get sleepTicketToggle(): Locator {
    return this.editor.getByTestId('fine-tune-editor-sleep-ticket');
  }

  /** 行の睡眠の欄を押して、睡眠目標を選ぶ。 */
  async chooseSleep(row: Locator, option: FineTuneSleepOption): Promise<void> {
    await this.select(row, 'sleep');
    await this.sleepOption(option).click();
    await expect(this.sleepOption(option)).toHaveAttribute('aria-pressed', 'true');
  }

  /** 欄を選んで刻みを押す。 */
  async adjust(row: Locator, field: 'target' | 'boost' | 'candy', delta: number): Promise<void> {
    await this.select(row, field);
    await expect(this.editor).toHaveAttribute('data-field', field);
    await this.step(delta);
  }

  /** 欄を選んで値を打つ（目標Lvはスライダー）。 */
  async setValue(row: Locator, field: 'target' | 'boost' | 'candy', value: number): Promise<void> {
    if (field === 'target') {
      await this.select(row, 'target');
      await this.setLevel(value);
      return;
    }
    await this.select(row, field);
    await expect(this.editor).toHaveAttribute('data-field', field);
    await this.typeValue(value);
  }

  /** 届いた行の数（最新の結果） */
  async reachedCount(): Promise<number> {
    return this.rows.and(this.page.locator('[data-reached="true"]')).count();
  }

  /**
   * 「全体のLvを伸ばす」を押し、求め終わる（モーダルの計算中の印が外れ、計算中が消える）まで待つ。
   * 伸ばせないと分かっているときのボタンは押せない見た目（aria-disabled）だが、押すと理由のトーストが出るので押す。
   */
  async raise(): Promise<void> {
    const blocked = await this.raiseButton.getAttribute('aria-disabled') === 'true';
    await this.raiseButton.click({ force: blocked });
    await expect(this.modal).not.toHaveAttribute('aria-busy', 'true', { timeout: 20_000 });
    await this.waitForSettled();
  }

  // === 並べ替え ===

  /** 取っ手にフォーカスして ↑ キー（1つ上へ）。 */
  async moveUp(row: Locator): Promise<void> {
    await this.getHandle(row).press('ArrowUp');
  }

  /** 取っ手にフォーカスして ↓ キー（1つ下へ）。 */
  async moveDown(row: Locator): Promise<void> {
    await this.getHandle(row).press('ArrowDown');
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

  /** プレビュー計算が終わる（「計算中…」が消える）まで待つ。 */
  async waitForSettled(): Promise<void> {
    await expect(this.calculating).toHaveCount(0);
  }
}
