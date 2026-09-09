# 外部素材ライブラリ

動画本体・サムネイル・ローカル取得台帳はGitHubには含めません。

- `catalog.json`：アプリが読む、実在する再生用ファイルの一覧。
- `media/open`：CC0・パブリックドメイン等の配布元動画。
- `media/packs`：VJ用パックから展開した動画。配布元の利用許諾に従って使用します。
- `media/prepared`：再生負荷を抑えた720p／30fps H.264版。
- `media/thumbnails`：実際の動画から生成したサムネイル。
- `credits.txt`：収録動画のクレジットと出典。
- `prepared.json`：再生用動画のSHA256、派生元、簡易色・動き分析。

収集済みフォルダーをEXEの隣に置くと、Windows版が読み込みます。ブラウザー版では必要な動画を「取り込む」から読み込めます。

再収集は `node scripts/collect-open.mjs`、`node scripts/collect-packs.mjs`、再生用の統合は `node scripts/build-catalog.mjs` です。初回実行ではネットワーク・容量・処理時間を使います。各配布元の条件と `docs/material-sources.md` を確認してください。合計20GBの枠は開放素材8.5GB、パック8GB、再生用変換3.3GBと余裕分で分けています。
