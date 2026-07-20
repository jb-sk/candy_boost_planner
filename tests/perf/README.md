# Local interaction performance runner

メインスレッド操作をChromiumで自動反復し、Event Timingを収集するローカル専用ランナーです。通常のE2EおよびCIからは実行されません。

計測は `?perf=1` のruntimeフラグで有効化します。公開済み環境でもURL末尾に `?perf=1` を付けると、同じperfログと検算TSVを確認できます。通常URLでは計測処理も検算TSVも無効です。

```powershell
pnpm run perf:interaction
```

既定では次の条件で各操作を20回測定します。

- 280→300件Box: AddPokemonModalの追加ボタンでBox・計算機へ追加
- 300件Box: お気に入り、3桁入力、削除、undo、redo
- 10行×3スロット: 3桁入力、種族アメ入力、スロット切替、削除、undo
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
