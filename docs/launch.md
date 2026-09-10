# 起動と持ち運び

どの版にも96種類の生成映像と6種類の映像プリセットを内蔵しています。素材の取り込みは任意です。まず「再生」を押し、「映像プリセット」で曲の雰囲気に合う組み合わせを選べます。選択すると映像は即時に切り替わります。

## Windows

作業フォルダー直下の `Lumina-Live.exe` を起動します。このEXEと `assets` フォルダーを同じ場所に置くと、収集済み動画が自動的にライブラリに表示されます。Node.jsのインストールは不要です。

別のPCへ持ち運ぶときは、次の構成を丸ごとコピーしてください。

```text
Lumina/
  Lumina-Live.exe
  assets/
    catalog.json
    credits.txt
    media/...
  examples/Demo-Session.lumina.json
```

`release` フォルダーにある同内容のポータブルEXEを使用する場合も、EXEの隣に `assets` が必要です。`assets/catalog.json` のみをコピーしても動画は再生できません。

手元の動画はアプリの「取り込む」で追加できます。Windows版はファイルの参照を保存するため、読み込んだ後にファイルを移動した場合は再取り込みしてください。

## Chromebook / Chrome

`web/Lumina-Live.html` または `release/Lumina-Live-offline.html` をダウンロードし、Chromeで開きます。両方とも同内容で、アプリ本体と96種類の生成映像を含む単一HTMLです。

[ブラウザー版のURL](https://sakadosoutan-boop.github.io/lumina-live/)をChromeで開けば、そのまま使用できます。[GitHubのHTML](https://github.com/sakadosoutan-boop/lumina-live/blob/main/web/Lumina-Live.html)を保存する場合は、ファイル画面の「Download raw file」を使用してください。GitHubのコード表示画面ではアプリは動きません。

開発サーバーが動いている作業PCでは [ローカル操作画面](http://127.0.0.1:4173/) も利用できます。このアドレスは他のPCからは接続できません。操作画面は1つだけ開き、投影画面は「外部出力」から開いてください。

外部動画を使用する場合は「取り込む」で動画ファイルを選択してください。ブラウザー版では動画をブラウザー内にコピーして保存します。空き容量とサイトの保存容量制限の範囲内で利用できます。ブラウザーデータを消去すると再取り込みが必要になります。使用する曲と素材を本番前にオフラインで読み込めることを確認してください。

ブラウザー操作ツールのURLポリシーにより、開発時の `file://` 直接起動のUI検証は行えていません。単一HTMLのビルドと画面間のBlob受け渡しのテストは実施し、同じアプリのHTTP配信で映像・歌詞・暗転・音源同期を検証しています。管理されたChromebookのファイル起動・ポップアップ・保存権限は端末側で確認してください。

## HDMI出力

OS側を「拡張表示」、外部ディスプレイを1920×1080に設定します。Windows版は「接続・出力」で出力先画面を選べます。ブラウザー版は「外部出力」のウィンドウをプロジェクター側へ移動し、映像をダブルクリックして全画面にします。

Surface Pro 7+では内部1280×720／30 FPSから始めてください。出力自体はフルHDに拡大されます。FPSや映像エラーを確認し、必要に応じて960×540に下げます。コードのテスト結果は、特定のGPU・機器での長時間安定動作の保証ではありません。

## 開発用コマンド

```text
npm ci
npm run build
npm run serve
```

`npm run build:standalone` は `release` と `web` に単一HTMLを書き出します。`npm run package` はWindowsポータブルEXEを `release` に作成します。作成したEXEを作業フォルダー直下へコピーすれば、現在の `assets` をそのまま使えます。
