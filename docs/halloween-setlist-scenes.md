# ハロウィンライブ・曲別シーン制作状況

更新：2026-10-29。基本11本は分割・全フレームのデコード検査を終え、非公開のブラウザ版へ配信済み。各曲のA/B/Cメロ用33本もCanvaで選定し、720p・9分16秒のMP4（176,454,779 bytes）を取得済み。追加33本も分割・検査済み。全44本を非公開ブラウザ版へ配信する。曲別・メロ別の絞り込みを実装済み。

方針：Canvaの素材動画を主に使用。自然風景を中心に、ときどき人物を遠景・後ろ姿で入れる。MVそのものの映像、歌詞本文、アーティストの肖像は素材として使わない。公式MVの参照先は調査済みですが、前回の調査は公開ページの情報確認であり、全MVを映像として視聴したわけではありません。下記の演出は独自の提案です。

各曲は最初に背景となる1本を仕上げ、その後Aメロ向けの静かな映像・サビ向けの開放的な映像を追加する。1080p・16:9・無音・10〜20秒を基本にし、下側の歌詞エリアの見やすさとループの切れ目を確認する。映像自体が動く動画を選び、静止画の拡大移動だけで代用しない。

| 曲／MV参照先 | 基本シーン案 | Canva動画検索語 | 人物・サビの展開 |
| --- | --- | --- | --- |
| サカナクション／[ミュージック](https://www.youtube.com/watch?v=ZD4QeVlqHNM) | 夜の水面、静かな波、霧。紺・銀の低彩度 | night ocean waves / moonlight lake / mist water | 浜辺の遠い後ろ姿→夜明けの広い海 |
| スピッツ／[空も飛べるはず](https://www.youtube.com/watch?v=h-kQw4JqCHE) | 青空と風で揺れる草原。明るく柔らかな自然光 | blue sky meadow / wind grass / clouds landscape | 草原を歩く人物の引き画→空が大きく広がる画 |
| Vaundy／[踊り子](https://www.youtube.com/watch?v=7HgJIAUtICU) | 夕陽のススキ、揺れる影。琥珀色と淡い紫 | sunset pampas grass / dancing silhouette / golden hour field | 小さな人物が自由に体を揺らす映像→夕陽の草原 |
| Michael Jackson／[Beat It](https://www.youtube.com/watch?v=oRdxUFDoQe0) | 荒い岩肌、砂塵、赤褐色の地形。強い陰影 | desert dust / volcanic rocks / canyon sunset | 足元や歩行のシルエット→風の強い砂漠・岩山 |
| Backstreet Boys／[I Want It That Way](https://www.youtube.com/watch?v=4fndeDfaWCg) | 広い空、干潟、水平線。青と淡い金 | tidal flats / ocean horizon / sky journey | 遠くを見つめる人物→開放的な海・雲 |
| 乃紫／[メガネを外して](https://www.youtube.com/watch?v=XOKQluw_YLU) | 雨粒越しの緑、花、光のぼけ。ミント・桃色 | rain window garden / flower bokeh / sunlight leaves | 視線・横顔を控えめに→ピントが合う花畑 |
| ザ・クロマニヨンズ／[エイトビート](https://www.sonymusic.co.jp/artist/cromagnons/discography/BVCR-19122) | 土、一本道、風に飛ぶ砂。素朴で力強い動き | dirt road forward / dust wind / rocky landscape | 道を進む足元→オレンジ色の地平線。参照は公式作品ページ |
| Mrs. GREEN APPLE／[lovin’](https://www.youtube.com/watch?v=Ff7kdaIQvQM) | 木漏れ日、明るい森、風に揺れる葉 | sunny forest / golden leaves / friends nature | 遠景の友人たち→暖かい光が差す森 |
| ヨルシカ／[忘れてください](https://www.youtube.com/watch?v=J_DE2d1F9wU) | 霧の池、葉の影、人気のない小道。淡い緑と白 | misty pond / leaf shadows / empty forest path | 去っていく後ろ姿を短く→光と影だけの風景 |
| RADWIMPS／[前前前世](https://www.youtube.com/watch?v=PDSkFeMVNFs) | 山稜、朝焼け、草原を前進する映像 | mountain sunrise / running field / aerial grassland | 遠くを走る人物→広い山岳・雲。映画・アニメ映像は使用しない |
| マカロニえんぴつ／[恋人ごっこ](https://www.youtube.com/watch?v=323j5BRFi7s) | 夕暮れの川、浮かぶ葉、揺れる反射。桃色と青灰色 | river leaves / dusk water reflection / lonely walk | 離れて歩く人物→水面に残る光 |

## 書き出し前に残す情報

- Canva素材の表示名・作者・素材情報で確認できる識別子、使用したデザインURL。
- アカウントのプランと素材の使用条件。完成映像のライブ利用可否を確認し、Canva素材そのものを公開GitHubへ配布しない。
- 完成MP4の保存先、長さ、解像度、サイズ、サムネイル、対応曲、ループの接続方法。
- 実際に動くか・文字が読めるか・点滅が強すぎないかをプレビュー確認。

## 再開地点

2026-10-29：ログイン確認済み。基本11本は新規デザイン `DAHZQHDlhIQ` に保存・MP4取得済み。追加A/B/C用は `DAHZTxjKrIE` に33本を保存し、720p MP4の取得・分割・検査を完了。既存デザイン `DAHUkLu0GjM` は変更していません。

補助として先に依頼したAI動画は2件。追加生成はCanva中心という指定に合わせて停止中。草原の動画 `67d8d6a2af59479bb978b9163d62a4e1` は生成完了を確認済みですが、内容の目視確認・アプリ反映は未完了。夜の海の動画 `21597ac196614f6da29be7659133297e` は、この記録では完了未確認です。



## 取得・検査済みの追加33シーン

Canvaデザイン： https://www.canva.com/design/DAHZTxjKrIE/gK62YruOLY3g4og3YNapXw/edit

720p、30fps、H.264、無音、5〜14秒。各動画は10MB未満。全フレームをデコードし、停止フレームと動きを検査。静かな森は風で葉が動く冒頭7秒を採用。セクション名はオペレーター向けの用途ラベルで、原曲の構成・演奏時刻を確定するものではありません。

| 曲 | Aメロ | Bメロ | Cメロ |
| --- | --- | --- | --- |
| ミュージック | 月光の水面 | 月と流れる雲 | 月夜の街と山 |
| 空も飛べるはず | 風に揺れる草 | 流れる白い雲 | 夕暮れの草原 |
| 踊り子 | 夕暮れの川 | 桃色の夕空 | 夕暮れのタイムラプス |
| Beat It | 峡谷へ向かう道 | 赤い峡谷の空撮 | 峡谷を歩く人物 |
| I Want It That Way | 朝の波打ち際 | 青い海と白波 | 朝焼けの海 |
| メガネを外して | 花と木漏れ日のぼけ | ピンクの花 | 金色の光粒 |
| エイトビート | 野原の一本道 | 夕陽へ進む道 | 緑の道を走るバイク |
| lovin’ | 森の光と影 | 緑の川と流れ | 木漏れ日の小川 |
| 忘れてください | 静かな林 | 秋の森と霧 | 山を流れる白い霧 |
| 前前前世 | 朝の山と湖 | 広い山岳の展望 | 雲海を眺める人物 |
| 恋人ごっこ | 浜辺の後ろ姿 | 夕暮れの人物シルエット | 海辺で空を見る人物 |

