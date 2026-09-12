# 邦楽ロック向け・既存公開動画セレクション

選定日：2026-09-13。既存の `docs/assets/catalog.json` 125本から、静かなAメロ／疾走するサビ／暗い緊張感／余韻エンディングに各5本、計20本を選定した。対応する機械可読データは [jrock-selections.json](jrock-selections.json)。各要素は `{id, tags, use}` で、全件に `jrock` と主用途のタグを付けた。タグは追加候補であり、既存カタログのタグを置き換えるものではない。

対象は公開カタログに実在する動画のみ。内蔵96本の生成映像、カタログ内のハロウィーン生成オリジナル2本、親作業で制作中の新オリジナル4本は含めない。選定は曲・アーティスト・既存MVに依存しない、風景と抽象形状による汎用演出。

## 選び方と確認範囲

- カタログの色、`energy`、尺、出典、ライセンスを確認し、元の `docs/assets/library/<id>.jpg` を `view_image` で表示した。比較候補30本を目視し、最終20本は全件確認済み。
- Aメロは柔らかな色・水面・霧、サビは中心へ集まる奥行き・角張った構図・高い色の対比、緊張感は暗い余白・硬質／有機的な形、エンディングは雲状の色・月・星空を重視した。
- `energy` はカタログ記載の参考値で、音楽BPMや今回実測した動きの速さではない。静かな用途でも低輝度での使用を前提とする抽象素材がある。疾走感は主に構図から判断した。
- 今回確認したのは実サムネイルと既存資料。全尺再生、動きの速度、ループ境界、拍との同期は未検証。下記のフェードや切り替えは演出案であり、動画編集やアプリへの実装は行っていない。
- `open-noaa-jellyfish-ex2107` は説明文字、`open-hubble-pillars` はロゴ、`open-nps-summer-rainfall` はタイトルカードが実サムネイルに写るため今回は選外。全尺の内容を否定するものではなく、追加の区間指定なしで扱える汎用背景を優先した。

## 20本の使い分け

各表のIDはJSONと一致する。尺とenergyは公開カタログ記載値を丸めず参照すること。ライセンスは次節のグループと対応する。

### 静かなAメロ — `verse`（5本）

| ID | サムネイルで確認した見た目 | 用途・つなぎ方 |
| --- | --- | --- |
| `halloween-stock-vetla-fog` | 霧に覆われた森と集落の俯瞰 | 曲の入口。低めの明るさで長く見せ、歌の入りを支える。 |
| `halloween-stock-misty-river-47` | 水平な水面と霧の対岸 | ボーカル中心のAメロ。切り替えを増やさず、静けさを保つ。 |
| `open-mantissa-016` | 青い背景、光沢のある連結形状、小さな点 | クリーンギターの細かい音を抽象化。形が目立つので低輝度で使う。 |
| `open-mantissa-030` | 淡い桃・青・白の面と小さな球 | 柔らかい音色のAメロ。白い部分を抑えて背景として使う。 |
| `open-mantissa-073` | 紫の雲状の形と光点 | 内省的な場面。長めのフェードで風景素材から抽象へ移る。 |

### 疾走するサビ — `chorus`（5本）

| ID | サムネイルで確認した見た目 | 用途・つなぎ方 |
| --- | --- | --- |
| `open-mantissa-001` | 白い中心と多色の多角形トンネル | サビ頭で空間を開く。フレーズ単位の切り替えに向く構図。 |
| `open-mantissa-010` | 三角形の奥行き、赤とシアンの断片 | リフの鋭さを表すサビ。暗い周辺と明るい中心の対比を使う。 |
| `open-mantissa-058` | 黄緑・金の光と密な破片状の形 | サビのピーク。光量を上げる場面に絞って変化を作る。 |
| `open-mantissa-061` | シアンとマゼンタの格子 | 明るく開放的なサビ。暗い前節から色を大きく変える。 |
| `open-mantissa-095` | 赤・白・黒の放射状の筋 | 加速感のアクセント。強い白が出るため短いフレーズで扱う。 |

サビ候補は画面内の光量差が大きい。最初は追加ストロボを使わず、出力輝度と切り替えの間隔で盛り上げる。素材自体の点滅頻度は今回測定していない。

### 暗い緊張感 — `tension`（5本）

| ID | サムネイルで確認した見た目 | 用途・つなぎ方 |
| --- | --- | --- |
| `open-mantissa-014` | 暗い霧、柱状の影、斜めに走る暖色の光 | 低音のリフやサビ前の溜め。余白を残しつつ方向性を出す。 |
| `open-mantissa-048` | 黒地から枝分かれする金属的・有機的な形 | 歪んだ音や不穏なブレイク。中心の形を静かに見せる。 |
| `open-mantissa-050` | 暗い縦の形、シアンの光、中央の赤 | 明暗差による緊張。サビへ向けて出力の明るさを上げる案。 |
| `open-mantissa-104` | 白黒の尖った結晶状の面 | 重いリフやブリッジ。有彩色のサビとの対比を作る。 |
| `open-mantissa-052` | 黒い余白、中央のシアン光、伸びる面 | サビ直前の集中。`open-mantissa-001` へつなぐと中心構図が続く。 |

### 余韻エンディング — `ending`（5本）

| ID | サムネイルで確認した見た目 | 用途・つなぎ方 |
| --- | --- | --- |
| `open-mantissa-029` | 暖色の細い柱とシアンの光点 | 音の残響を光点で受け、明るさを少しずつ落とす。 |
| `open-mantissa-072` | 淡い青・紫・桃の雲状の広がり | 最後のコードに長めのフェードを合わせる。 |
| `halloween-stock-moon-360` | 黒地に単独の月 | 視覚的な着地点。残響が消えるまで保ってから暗転する。 |
| `open-eso-milky-way` | 低い地平線、星空、天の川 | 開放感を残す終わり方。尺7.6秒なので終端前にフェードする案。既存クレジットは保持する。 |
| `halloween-stock-misty-river` | 右手前の枝、対岸が隠れる霧の水面 | Aメロの水辺へ戻る終わり方。`misty-river-47` と同系統だが、前景の枝がある別構図。 |

実写の霧・月・星空はシームレスなループと断定しない。曲の区切りで別素材に移るか、終端前にフェードする。自然風景には長いクロスフェード、サビにはフレーズ頭の切り替えを出発点にすると4場面を使い分けやすい。

## ライセンスと出典

**19本がCC0-1.0、1本がCC-BY-4.0。** 以下は公開カタログと既存のローカル調査資料から転記・整理した情報であり、今回ネット上のライセンスを再調査したものではない。

### Mantissa：15本、CC0-1.0

対象ID末尾：`001`, `010`, `014`, `016`, `029`, `030`, `048`, `050`, `052`, `058`, `061`, `072`, `073`, `095`, `104`（すべて接頭辞 `open-mantissa-`）。

- カタログのクレジット：`Midge “Mantissa” Sinnaeve — mantissa.xyz (optional)`。
- 出典：[Mantissa VJ loops](https://mantissa.xyz/vj.html)。ライセンス：[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。
- 既存調査では複製・改変・商用利用・再配布を含むCC0素材として整理済み。クレジットは任意だが、作者・出典・ライセンス情報を引き継ぐ。
- 根拠：[公開ライブラリ権利調査](web-library-rights-2026.md)のMantissa項。

### 霧・月：4本、CC0-1.0

| ID | 作者（カタログ記載） | 個別出典 |
| --- | --- | --- |
| `halloween-stock-vetla-fog` | Sillerkiil | [Drone video of foggy Vetla village in Estonia](https://commons.wikimedia.org/wiki/File:Drone_video_of_foggy_Vetla_village_in_Estonia.ogv) |
| `halloween-stock-misty-river-47` | Digitura | [Misty river 47 seconds](https://commons.wikimedia.org/wiki/File:Misty_river_47_seconds.webm) |
| `halloween-stock-misty-river` | Digitura | [Misty river](https://commons.wikimedia.org/wiki/File:Misty_river.webm) |
| `halloween-stock-moon-360` | Wikideas1 | [Moon 360 animation](https://commons.wikimedia.org/wiki/File:Moon_360_animation.webm) |

ライセンスは4本とも [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。カタログのクレジットは各作者名とCC0リンクに `credit retained for provenance` を付したもの。クレジット任意の分類を維持しつつ、この来歴情報を残す。`halloween-stock-` は既存IDであり、今回の用途は季節を問わない霧・水辺・月の演出。

根拠：[既存素材調査](halloween-sources-2026.md)、[取得後の納品記録](halloween-delivery.md)、公開カタログの該当4件。調査時点の取得未確認記述より、取得後の納品記録を優先して参照した。

### 星空：1本、CC-BY-4.0

- ID：`open-eso-milky-way`。タイトル：`Milky Way Revealed — Paranal`。
- クレジット：`ESO/B. Tafreshi`。
- 出典：[Milky Way revealed](https://www.eso.org/public/videos/uhd_yb_paranal_01/)。作者リンク：[The World at Night](https://twanight.org/)。ライセンス：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。
- 既存調査で要求された、可視の完全なクレジット、オンラインでの出典・作者・ライセンスのリンク、実際の変更内容の明示を引き継ぐ。クレジットを切り落とすクロップや、隠す合成はしない。再編集・再配布時は尺変更、色変更、変換など実施した変更だけを追記する。
- [取得後の納品記録](halloween-delivery.md)では公開動画に可視の出典・CC BY 4.0クレジットを組み込み済み。今回のサムネイルは星空を確認するために使い、クレジット表示の全尺検査はしていない。
- 根拠：[公開ライブラリ権利調査](web-library-rights-2026.md)のESO項。素材のライセンスをアプリのコードのライセンスと混同しない。

既存の納品記録は公開125本を無音H.264配信用動画としている。今回の参照先は公開カタログが指定する `docs/assets/library` の動画であり、取得元の原本や音声へ差し替えない。今回追加したのは選定と演出案だけで、映像そのものに変更はない。

## 引き継ぎ

JSONの20件をIDで公開カタログに照合し、用途の検索やプリセット候補に使える。内蔵生成映像とは分けた既存公開動画の選定であり、新オリジナル4本を含む最終的な配置は親作業側で決める。

この作業で作成したファイルは `research/jrock-selections.json` と `research/jrock-selection-guide.md` の2件のみ。App、公開カタログ、その他のscripts、Siteの変更、新規取得、ブラウザ操作、ネット検索は行っていない。
