# Local interaction performance runner

メインスレッド操作をChromiumで自動反復し、Event Timingを収集するローカル専用ランナーです。通常のE2EおよびCIからは実行されません。

計測は `?perf=1` のruntimeフラグで有効化します。公開済み環境でもURL末尾に `?perf=1` を付けると、同じperfログと検算TSVを確認できます。通常URLでは計測処理も検算TSVも無効です。

## `?perf=1` で有効になるもの

| 物 | 内容 |
|---|---|
| perfログ | `console.info('[perf] …')` |
| 検算TSV | 結果パネルの「検算TSV」ボタン |
| デバッグ用の現在日時 | 「ペースト」の右の「日時変更」ボタン（下記） |

### デバッグ用の現在日時

睡眠EXPのボーナスは日によって変わる（満月日・GSD前後日・イベント期間）ため、時計を進めて
内訳を確かめるための上書きです。満月は約29.5日周期なので実時刻を待てません。

```
?perf=1                       未設定（実時刻）
?perf=1&now=2026-08-28T13:19  上書き中。ボタンは「日時解除」になる
```

- 「日時変更」でネイティブのカレンダー＋時刻ピッカーが開き、選んだ値がURLへ入ります
- URLに入るので **F5・テーマ変更のリロードを跨いで復元**されます。「日時解除」で消えます
- 値は**ゲーム内タイムゾーンの壁時計**として読みます（端末ゾーンとの差で日付がずれません）。
  AM4:00 より前は前日のゲーム内日になります
- 実在しない日時（`2026-02-29T12:00` など）は無視し、URLからも取り除きます
- `?perf=1` が無ければ `?now=` は読まず、UIも出ません
- 入力した値は検算TSVの `SLEEP_EXP` → `settings` 行の `debugNow` 列と、
  `[perf] sleep.settings` のログに出ます。`currentGameDate` は AM4:00 前なら前日になるので、
  どの日時を入れたのかは `debugNow` 側で確認します

ゲーム内日を直接固定する `?gameDate=YYYY-MM-DD` は別物で、DEVビルドのみ有効です（e2eが使用）。
両方を指定した場合は `?now=` が優先されます。**`?gameDate=` を消さないこと**（e2e 5件が使用中）。

#### 実装上の注意（2026-08-29 に引き継ぎ資料 §1e / §1f から移設）

**日時ピッカーは「透明な入力欄を重ねてタップさせる」方式。API に依存させないこと。**

`HTMLInputElement.showPicker()` は **Safari（iOS を含む）に存在しない**。
ボタンから無条件に呼ぶ形にすると、input 自体はあるので `?.` を素通りし、
**iPhone だけ `showPicker is not a function` で死ぬ**（PC の Chrome / Edge / Firefox では一切再現しない）。

| 状態 | 前面 | タップの結果 |
|---|---|---|
| 未設定（「日時変更」） | **入力欄**（`inset:0` でボタン全面を覆う。`opacity:0`） | ネイティブピッカーが開く |
| 上書き中（「日時解除」） | **ボタン**（入力欄は `pointer-events:none`） | 上書きを解除する |

- `showPicker()` は**入力欄の `@click` の中**で、**存在するときだけ**呼ぶ。
  透明な `datetime-local` を素クリックしても Chrome はピッカーを開かないため、PC 側の体験を保つのに要る
- **主経路がタップで、`showPicker()` が上乗せ**。死んだフォールバックの復活ではなく、優先順位の逆転
- 回帰は `tests/e2e/08-perf-gate.spec.ts`。「未設定のあいだ、ボタン中心の最前面要素が入力欄であること」を
  `elementFromPoint` で固定してある。CSS の重なりが壊れれば落ちる
- **重ねた `datetime-local` を `pointer-events:none` にしない／幅を 1px に戻さない**（タップの受け口そのもの）

**入力は「瞬間」ではなく壁時計として読む。** `new Date("2026-08-28T04:30")` は端末のローカル時刻として
解釈されるので、端末ゾーンと設定ゾーンが違うと**ゲーム内日が1日ずれる**。
現行は `gameDateFromWallClock()`（`domain/pokesleep/game-date.ts`）が文字列をそのまま年月日＋時として読み、
AM4:00 規則だけを適用する。暦日の実在検証は `normalizeGameDate()` を再利用（**`2026-02-29` は null**）。

- **`new Date(文字列)` で読む形へ戻さないこと**
- **状態は URL だけに置く**（`history.replaceState`）。localStorage にすると**上書きしたまま忘れる**。
  URL ならアドレスバーに出たままになる
- **`debugNow` 列を「ゲーム内日と同じだから」と削らないこと**（AM4:00 前を入力したときに差が出る）

```powershell
pnpm run perf:interaction
```

既定では次の条件で各操作を20回測定します。

- 280→300件Box: AddPokemonModalの追加ボタンでBox・計算機へ追加
- 300件Box: お気に入り、3桁入力、削除、undo、redo
- 10行×3スロット: 残りEXP・種族アメの3桁入力、ミニブのアメブ個数3桁入力、スロット切替、削除、undo
- アメ在庫: 万能アメ、タイプアメの3桁入力

結果は `_local/fbl04-interaction-perf/<timestamp>/summary.tsv` と `detail.json` に保存されます。閾値超過でテストを失敗させず、変更前後の比較資料として使用します。

Boxの履歴操作はundo履歴上限の影響を避けるため、同一の300件fixtureを5回ごとに再構築します。合計標本数は各操作20件のままです。

ランナー自体の短縮確認だけを行う場合は、反復数を一時指定できます。

```powershell
$env:FBL04_PERF_REPEAT = '1'
pnpm run perf:interaction
Remove-Item Env:FBL04_PERF_REPEAT
```

`eventDurationP75UpperBoundMs` はEvent Timingのp75です。16ms未満で記録されなかった操作は、過小評価を避けて16msとして集計します。`automationWallMs` はPlaywrightとの通信と待機を含むため、INPとして扱いません。

## モバイル初期表示のCLS再現

Cloudflare Web Analyticsで外れ値が観測された、保存済み10行の初期表示と計算結果反映を、アメブ・ミニブ・通常モードと在庫あり・在庫なし・未使用0の条件で自動計測します。
360×780のviewportでLayout Instability APIを監視し、CLS、シフト元要素、計算ログ、計算機コンテナの寸法変化を同じ時系列で保存します。

```powershell
pnpm run perf:cls
```

結果は `_local/fbl04-cls-perf/<timestamp>/detail.json` に保存されます。通常のE2EおよびCIからは実行されません。
幅を変える場合は `FBL04_CLS_WIDTH`（280以上）を指定できます。
