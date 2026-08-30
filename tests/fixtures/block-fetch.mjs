// `--import` で読み込み、プロセス内の HTTP アクセスを全て失敗させる。
// 「未解決チェックはネットワークを使わない」（設計書 §21.7）を、
// 実CLIを起動して確かめるために使う。
globalThis.fetch = () => {
  throw new Error("NETWORK_ACCESS_NOT_ALLOWED");
};
