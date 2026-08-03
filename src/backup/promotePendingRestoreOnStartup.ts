import { promotePendingBackupRestoreOnStartup } from "./pendingRestore";

// main.ts の最初の依存として評価し、localStorage を読むストアより先に
// 未完了のバックアップ復元を前進復旧する。どの失敗もアプリ起動へ漏らさない。
try {
  promotePendingBackupRestoreOnStartup(localStorage);
} catch (cause) {
  // localStorage 自体への参照失敗など、復旧関数へ入る前の例外も白画面にしない。
  try {
    console.error("Unexpected pending backup restore startup failure", cause);
  } catch {
    // console の差し替えが壊れていても起動を続ける。
  }
}
