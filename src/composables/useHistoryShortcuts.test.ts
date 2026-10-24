import { describe, expect, it } from "vitest";
import { historyShortcutDirection } from "./useHistoryShortcuts";

function keydown(init: Omit<Partial<KeyboardEvent>, "target"> & { target?: object | null }): KeyboardEvent {
  return {
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    ...init,
  } as unknown as KeyboardEvent;
}

describe("historyShortcutDirection", () => {
  it("Ctrl+Z・⌘Z で元に戻す", () => {
    expect(historyShortcutDirection(keydown({ ctrlKey: true }))).toBe("undo");
    expect(historyShortcutDirection(keydown({ metaKey: true }))).toBe("undo");
  });

  it("Shift を足すか Ctrl+Y でやり直す。Shift 付きは key が大文字でも同じ", () => {
    expect(historyShortcutDirection(keydown({ ctrlKey: true, shiftKey: true, key: "Z" }))).toBe("redo");
    expect(historyShortcutDirection(keydown({ metaKey: true, shiftKey: true, key: "Z" }))).toBe("redo");
    expect(historyShortcutDirection(keydown({ ctrlKey: true, key: "y" }))).toBe("redo");
  });

  it("⌘Y（Safari の履歴）や修飾キー無し・Alt 付きは扱わない", () => {
    expect(historyShortcutDirection(keydown({ metaKey: true, key: "y" }))).toBeNull();
    expect(historyShortcutDirection(keydown({}))).toBeNull();
    expect(historyShortcutDirection(keydown({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(historyShortcutDirection(keydown({ ctrlKey: true, key: "x" }))).toBeNull();
  });

  it("文字の入力欄の中ではブラウザ本来の取り消しに任せる", () => {
    expect(historyShortcutDirection(keydown({ ctrlKey: true, target: { tagName: "INPUT", type: "text" } }))).toBeNull();
    expect(historyShortcutDirection(keydown({ ctrlKey: true, target: { tagName: "INPUT", type: "number" } }))).toBeNull();
    expect(historyShortcutDirection(keydown({ ctrlKey: true, target: { tagName: "TEXTAREA" } }))).toBeNull();
    expect(historyShortcutDirection(keydown({ ctrlKey: true, target: { tagName: "DIV", isContentEditable: true } }))).toBeNull();
  });

  it("文字を持たない入力欄やボタンにフォーカスがあるときは、アプリの元に戻すにする", () => {
    expect(historyShortcutDirection(keydown({ ctrlKey: true, target: { tagName: "INPUT", type: "checkbox" } }))).toBe("undo");
    expect(historyShortcutDirection(keydown({ ctrlKey: true, target: { tagName: "BUTTON", isContentEditable: false } }))).toBe("undo");
    expect(historyShortcutDirection(keydown({ ctrlKey: true, target: { tagName: "SELECT", isContentEditable: false } }))).toBe("undo");
  });

  it("日本語変換中や、ほかの処理が止めたキーは扱わない", () => {
    expect(historyShortcutDirection(keydown({ ctrlKey: true, isComposing: true }))).toBeNull();
    expect(historyShortcutDirection(keydown({ ctrlKey: true, defaultPrevented: true }))).toBeNull();
  });
});
