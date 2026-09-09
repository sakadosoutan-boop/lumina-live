# LUMINA LIVE — 素材とライブ運用の調査報告

日本の非営利バンドライブでLumina Liveを使う人に向けて、現在の素材、同期の仕組み、利用条件の根拠、未確認事項をまとめます。対象はSurface Pro 7+などのWindows端末、またはChromebookからのHDMI・1920×1080出力と、プロジェクター1台です。素材保持の上限は **20,000,000,000 byte（20 GB、約18.63 GiB）**。追加購入・生成用クレジットの消費は行わない方針です。

操作方法は[ライブガイド](../docs/live-guide.md)、素材の選び方は[素材ガイド](../docs/material-sources.md)、本番までに残る確認は[PLAN](../PLAN.md)を参照してください。

## 現在分かっていること

**2026年9月9日更新。** 外部動画251本を取得し、243本をアプリのカタログに登録しました。内蔵96種類と合わせ、選択できる映像は339種類です。

| 区分 | 本数 | 内訳 |
| --- | ---: | --- |
| 内蔵映像 | 96種類 | 12系統×8変種のオリジナルGPU映像。動画ファイルの取得数には含みません。 |
| open素材 | 118本 | Mantissa 92本、NASA SVS 20本、NOAA 2本、USGS・NPS・ESO・ESA/Hubble 各1本。 |
| Beepleのパック | 93本 | MANIFEST 66本、four.color.process 10本、Brainfader 8本、Resolume 9本。 |
| Neb Motionのパック | 40本 | Abstract Tunnels 1・2、Retro Sunsets 1、Abstract Geometry 1を各10本。 |
| アプリで選べる外部動画 | 243本 | 取得原本251本から、個別レビュー前の8本を除いた数。 |
| 登録から除外した動画 | 8本 | MANIFESTの名前にORGYを含む素材。原本は保持。内容を名前だけで断定したものではありません。 |

取得原本と軽量な再生用ファイルは同じ映像なので、取得本数へ重複して加算しません。配布ページの予定数と実際のZIP内の本数が異なる場合も、実ファイルで数えています。CanvaとVideoZeroのプロジェクトはローカルMP4未取得のため、この本数には含めません。

[最終集計・ファイル検証](library-audit.json)に、容量と検証日時を記録しています。

### LIVEとAUDIOの違い

LIVEは、生演奏に合わせて操作する人がテンポや歌詞の位置を補正するモードです。現在BPMと基準BPM（timelineBpm）の比で進行速度を変えます。AUDIOは、再生する伴奏音源の時刻を基準にします。AUDIOで歌詞の次／前へ移動すると音源もその位置へ移り、BPMを変えても音源自体の速さは変わりません。

歌詞・曲の長さ・BPMだけでは実際の歌唱位置は確定しません。自動配置は文字量と小節に基づく目安なので、リハーサルでタイミングを記録するか、時刻付き歌詞のLRC／SRTで補正します。AIが歌声を認識して自動で追いかける機能や、単語単位の時刻合わせは未実装です。[同期処理](../src/sync.ts)、[ライブ時計](../src/live-clock.ts)、[操作実装](../src/App.tsx)

## 記録から確認できる範囲

[最終集計](library-audit.json)は原本251本と再生用243本の実在、サイズ、SHA256を照合し、カタログ全243本の全編デコードを検証しています。キャッシュを利用する検査でも、サイズ・更新時刻・再計算したハッシュ・デコーダーの同一性が一致することを確認しています。

原本取得数、投影用カタログ数、内蔵生成映像数、除外数を分けて記録しています。保存容量の対象は `assets` 全体と `research` の台帳・出典資料等です。集計JSONと検査キャッシュ、アプリ本体、開発用ライブラリ、別保存先のコピーは別枠です。指定された素材20 GBの上限内で取得を終えています。

カタログ登録待ちは0本です。未取得の候補は、取得・展開中も容量枠を超えないために保留したもので、取得済みとして加算していません。配布ページの本数を実ファイルの本数へ置き換えていません。

利用条件は下の既存の一次資料調査に基づきます。技術的な検査は、映像の内容レビュー・規約変更の確認・会場の性能試験を代行しません。ローカル台帳・動画・出典HTMLはGitHubに含めず、この報告と最終集計を保存しています。

### 保存された出典資料

以下は既存報告に載せていた6ファイルの現在の保存状態です。21:16 JSTの確認時にSHA256を再計算しました。その他の出典ファイルは上記台帳のevidence／sourceRightsからたどれます。open検証記録には権利根拠ファイル13件の検証が記録されています。これは下の一次資料27URL全ての保存・再閲覧を意味しません。

| 保存資料 | 取得記録の時刻（UTC） | SHA256 |
| --- | --- | --- |
| [Mantissa](source-snapshots/open-mantissa.html) | 2026-09-08 00:31:25.579 | d961a72d913a218dad2bccd12b84962e89dc5166e38b138d48019d6521e2b3dd |
| [NASA 20249](source-snapshots/open-nasa-20249.html) | 2026-09-08 01:13:15.303 | 09a6bd30ced99d066466f06b0a179a230736c23e1132c60fa6ab5460165d3eed |
| [Beeple配布元・MANIFEST時](pack-snapshots/beeple-manifest-source.html) | 2026-09-07 22:27:25.939 | 190b56d2542b5f1c141f12e0cf4972b495f8ba92fb8f4ecf3bc61a5db392539a |
| [Beeple配布元・four.color.process時](pack-snapshots/beeple-four-color-process-source.html) | 2026-09-08 00:30:17.688 | 190b56d2542b5f1c141f12e0cf4972b495f8ba92fb8f4ecf3bc61a5db392539a |
| [MANIFESTのホストページ](pack-snapshots/beeple-manifest-host.html) | 2026-09-09 01:25:57.716 | 4d05b6fa029762ee03bf4aaafe76a625467de38a3006ca4e1153e36433625440 |
| [four.color.processのホストページ](pack-snapshots/beeple-four-color-process-host.html) | 2026-09-08 00:30:18.074 | 25600c60ae50f4d834e737f9cbeb38c53d9ebd26b5965c108f2d0a66902679c9 |

ホストページは配布先の証拠であり、追加の権利許諾の根拠ではありません。MANIFESTのホストページは再取得されており、表は現在の保存ファイルと取得記録に合わせています。動画の再ハッシュと全編デコードの結果は最終集計を参照してください。

## ライブ利用を決める条件

**Canvaの通常のFree素材は、条件を満たしてライブ映像に利用できる。** 規約§5の動画・舞台プレゼンテーションへの許諾を、今回のバンド投影へ適用した判断である。§2で素材情報の出典と区分を確認し、§4で書き出し時のライセンス発行、§6でFree素材の追加許諾を確認する。Freeの単体ダウンロードまで一律禁止と説明しない。再配布や素材ライブラリ化は別の条件があり、今回の用途は会場での投影に限定して評価する。[Canva規約](https://www.canva.com/policies/content-license-agreement/)、[公式解説](https://www.canva.com/licensing-explained/)

Canva for Educationで提供されるPro素材は、**教育目的かつ非商用**という制限がある。非営利バンドであることだけでは教育目的を満たさない。通常Free、Pro、Education Content、Branded Contentを混同せず、音楽にも映像素材の許諾を流用しない。「Pixabay」という提供元・ブランド名の表示だけから、規約上の明示的なBranded Content区分であると断定しない。[Canva規約§2・§5B・§5C・§8](https://www.canva.com/policies/content-license-agreement/)

PexelsとPixabayは、明示許可のない大量・大規模・系統的コピーを禁止し、Mixkitはスクリプト／ボットによる大量取得を禁止している。無料利用の許諾は一括収集の許諾を意味しない。これらを自動収集の対象に追加しない。Mixkitでは動画のFreeとRestrictedを各素材で確認する。[Pexels規約§8](https://www.pexels.com/terms-of-service/)、[Pixabay規約](https://pixabay.com/service/terms/)、[Mixkit規約§9.10](https://mixkit.co/terms/)、[Mixkitライセンス区分](https://mixkit.co/license/)

Mantissaは配布元がCC0を明記し、商用・非商用に利用する根拠が明確である。BeepleとNeb Motionは広い商用・非商用利用を案内しているが、確認ページの「Creative Commons」だけから正確なCCバージョンや再配布条件を推定しない。Beepleのデモ音楽は別権利である。[Mantissa](https://mantissa.xyz/vj.html)、[CC0](https://creativecommons.org/publicdomain/zero/1.0/)、[Beeple](https://www.beeple-crap.com/vjloops)、[Neb Motion](https://nebmotion.co.uk/vj-loops/free/)

NASA SVSの原則的なpublic domainは例外表示と音楽を確認して適用し、米国著作権上の説明を世界中の全権利の保証に置き換えない。ESO／ESA/Hubbleでは個別の全文クレジットを見える形で付け、CC BY 4.0へのリンクと変更表示を保持する。ESOの規約には音楽について一般説明と除外・Music Archive例外が併記されているため、映像の許諾を全音楽へ拡張しない。[NASA SVS](https://svs.gsfc.nasa.gov/help/)、[NASA指針](https://www.nasa.gov/nasa-brand-center/images-and-media/)、[ESO](https://eso.org/public/outreach/copyright/)、[ESA/Hubble](https://esahubble.org/copyright/)、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## 主張と一次資料の台帳（27URL）

既存調査に記録されたアクセス日は、全行2026-09-09 JSTです。今回の文書整理ではウェブへ再アクセスしていません。「日付不明」「日付未採録」は既存調査で公開・更新日を確定または記録できなかったことを示します。S番号と27URL、利用条件の根拠を維持し、ローカル保存・取得状況は同日の最終集計へ更新しました。27URLは資料の数であり、動画本数ではありません。

| ID | 資料名・発行者／著者・URL | 公開／更新日 | 支持する主張・アクセス上の限界 |
| --- | --- | --- | --- |
| S01 | [Content License Agreement — Canva](https://www.canva.com/policies/content-license-agreement/) | 日付不明 | Freeの舞台利用・出典区分・教育Pro制限。本文§2・4・5・6・8・9を閲覧。 |
| S02 | [Licensing Explained — Canva](https://www.canva.com/licensing-explained/) | 日付不明 | Free／Proの見分け方、EducationのPro用途。解説より契約本文を優先。 |
| S03 | [Free Stock Photo & Video License — Pexels](https://www.pexels.com/license/) | 日付不明 | 無料利用・編集、帰属表示不要、未加工販売等の制限。規約と併読。 |
| S04 | [Terms of Service — Pexels](https://www.pexels.com/terms-of-service/) | 2024-11-15更新 | §8で無許可の大量・系統的コピー禁止。プラグイン・APIにも適用。 |
| S05 | [Content License Summary — Pixabay](https://pixabay.com/service/license-summary/) | 日付不明 | 利用・編集と単体配布等の制限の要約。正式規約と併読。 |
| S06 | [Terms of Service — Pixabay／Canva Germany GmbH](https://pixabay.com/service/terms/) | 2024-11-18更新 | 無許可の大量・系統的コピー禁止。全素材がCC0とはいえない。 |
| S07 | [Mixkit License — Mixkit／Envato](https://mixkit.co/license/) | 日付不明 | 動画Free／Restrictedの区分を確認。取得テキストでは展開式の全文は取得できず、個別条件を未確認のまま上映可にしない。 |
| S08 | [User Terms — Mixkit／Envato](https://mixkit.co/terms/) | 2025-10-02改定 | §9.10でスクリプト／ボットの大量ダウンロードを禁止。 |
| S09 | [Free VJ Loops — Midge “Mantissa” Sinnaeve](https://mantissa.xyz/vj.html) | 日付不明 | 既存調査でCC0宣言を本文と保存HTMLから確認。127は探索候補数で、取得済みは92本。 |
| S10 | [CC0 1.0 Universal — Creative Commons](https://creativecommons.org/publicdomain/zero/1.0/) | バージョン1.0、日付不明 | 著作権等の放棄の説明。商標・肖像等を含む全権利保証ではない。 |
| S11 | [VJ LOOPS — Beeple／Mike Winkelmann](https://www.beeple-crap.com/vjloops) | 日付不明 | 商用・非商用利用、音楽別権利、配布パック案内。CC種別は特定できず。 |
| S12 | [Free VJ Loops — Neb Motion](https://nebmotion.co.uk/vj-loops/free/) | 日付不明 | 商用・非商用利用、任意クレジット、公式パックリンク。ローカル取得の証拠ではない。 |
| S13 | [Tutorials, Links, and Other Helpful Information — NASA SVS](https://svs.gsfc.nasa.gov/help/) | 2024-03-27更新 | 原則public domain、個別例外・別ライセンス音楽の除外。規約の保存HTMLは現在ローカルに存在。 |
| S14 | [Images and Media Guidelines — NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) | 日付不明 | 第三者素材、人物、ロゴ、推薦・関係の誤認への条件。 |
| S15 | [Solar System Animation — NASA SVS／Adriana Manrique Gutierrez](https://svs.gsfc.nasa.gov/20249/) | 2016-09-20公開、2023-05-03更新 | ID 20249、1080p／4Kの配布とクレジット。保存HTMLあり。対応動画1本は現在のopen台帳に取得済みとして記録され、実在・サイズ一致を確認。 |
| S16 | [Copyright Notice — ESO](https://eso.org/public/outreach/copyright/) | 日付不明 | 映像のCC BY 4.0、見える全文クレジットと例外。音楽は一括許諾と扱わない。 |
| S17 | [Milky Way revealed — ESO／B. Tafreshi](https://www.eso.org/public/videos/uhd_yb_paranal_01/) | 2014-05-09公開 | 個別クレジットと動画の配布形式。対応動画1本は取得済みで、実在・サイズ一致を確認。 |
| S18 | [Copyright Information — ESA/Hubble](https://esahubble.org/copyright/) | 日付不明 | CC BY 4.0、映像と離れない全文クレジット、音楽・ロゴ等の例外。 |
| S19 | [Zoom into Pillars of Creation — NASA, ESA/Hubble and the Hubble Heritage Team](https://esahubble.org/videos/heic1501f/) | 2015-01-05公開 | 個別クレジット、ID heic1501f、HD配布。対応動画1本は取得済みで、実在・サイズ一致を確認。 |
| S20 | [Frequently Asked Questions — NOAA Ocean Exploration](https://oceanexplorer.noaa.gov/faqs/) | 日付不明 | 著作権例外、元ページのクレジット保持、原則public domain。折り畳み質問のリンクを再取得して回答本文を確認。 |
| S21 | [Lava flow — USGS／Hawaiian Volcano Observatory](https://www.usgs.gov/media/videos/lava-flow) | 2003-06-07 | 個別のSources/Usage: Public Domain。全USGS掲載物への一般化はしない。 |
| S22 | [Summer Rainfall — NPS／Ally O’Rullian](https://npgallery.nps.gov/AssetDetail/4e87e5ab-61f0-4c8c-955f-80ae6c4d5b96) | 公開日未確定 | 個別のPublic domain: Full Granting Rightsとクレジット。人物・標識等の別権利は保証しない。 |
| S23 | [Attribution 4.0 International — Creative Commons](https://creativecommons.org/licenses/by/4.0/) | バージョン4.0、日付不明 | 帰属、ライセンスリンク、変更表示、追加制限禁止。 |
| S24 | [Web MIDI API — MDN／Mozilla contributors](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) | 2026-05-15更新 | ブラウザーの対応差、権限、安全なコンテキスト。機器接続成功の保証ではない。 |
| S25 | [getUserMedia() — MDN／Mozilla contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | 日付未採録 | マイク・カメラ入力の権限要件。APIの存在は本アプリのカメラ実装を意味しない。 |
| S26 | [MediaRecorder — MDN／Mozilla contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) | 日付未採録 | 録画形式の対応確認。音声トラックや上限はアプリ実装で決まる。 |
| S27 | [WebGL API — MDN／Mozilla contributors](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API) | 日付未採録 | GPU描画の仕組みと機器依存性。Surface／Chromebookの性能認証ではない。 |

## CanvaとVideoZeroの保存状況

[Canvaデザイン](https://www.canva.com/design/DAHUkLu0GjM/FE9xFwz7zZ9PYiCNG62QvA/edit)はFreeの「Hazragvir — Vjloop tunnel」（提供元表示Pixabay）を選択した10秒・1080pの動画です。画面上の書き出しは完了していますが、ローカルMP4は未取得です。

[VideoZeroプロジェクト](https://videozero.ai/view/?id=1c4c6876-0c65-45e8-a832-de1bdf17b65f)はオリジナルの軌道・幾何学映像で、無音8.1秒の内容をレビュー済みです。こちらもローカルMP4は未取得です。追加の生成用クレジットは使わない方針です。

どちらのURLも保存済み動画ファイルの代わりにはなりません。ローカルファイル、容量、SHA256、長さ、解像度、音声の有無を確認するまで、オフラインで利用できる本数には加算しません。

## 機能の範囲と本番前に残る確認

| 機能 | 現在の範囲 | 本番前に確認すること |
| --- | --- | --- |
| LIVEの歌詞同期 | テンポ比で進み、歌詞の次／前で表示位置を補正。ブラウザー操作で確認済み。 | 歌い出し、伸ばし、間奏、テンポ変化を全曲のリハーサルで調整。 |
| AUDIOの同期 | 伴奏音源の時刻が基準。歌詞の次／前は音源もシーク。ブラウザー操作で確認済み。 | PA・HDMIの音声経路、曲ごとの音源再リンクと歌詞ジャンプ。 |
| 音声反応 | 周波数帯ごとの音量へ反応。マイク解析と伴奏再生は同じ音声エンジンを切り替えて使用。 | マイク解析と伴奏再生を同時に行う構成は前提にせず、当日の入力方法を確認。 |
| 出力・合成 | A/Bの映像とCの重ね合わせ、別の投影ウィンドウ。BLACKOUTとMP4再生はブラウザー操作で確認済み。 | HDMIを拡張表示にし、操作画面と投影画面が分かれることを実機で確認。 |
| カメラ入力 | 未実装。 | 使用できる機能として案内しない。 |
| 録画 | 合成映像を音声なしWebMで録画。256 MiB（268,435,456 byte）の閾値超過後に停止し、再開は手動。 | 1秒ごとのデータ受領で判定するため上限ぴったりには止まらない。自動分割・各レイヤー別録画ではない。 |
| 保存・オフライン | セットJSON、ブラウザー自動保存・IndexedDB、Windowsの元動画参照に対応。 | 端末移行、元ファイル移動、ブラウザー保存領域の削除、音源の再リンク。 |
| 外部素材 | カタログ登録243本。参照先のハッシュ照合と全編デコードを検証済み。 | カタログ登録は全編レビューや全動画のUI再生試験を意味しない。使用素材を事前に再生。 |
| 未対応の同期・映像伝送方式 | MTC／LTC／NDI／Spoutは未対応。MIDI ClockとMTCは別の仕組み。 | MIDI／OSCを使う場合は実際の機器・接続で確認。 |

機能の根拠は既存の実装確認です。[音声・MIDI](../src/audio.ts)、[保存](../src/storage.ts)、[Windowsメイン](../desktop/main.cjs)、[ローカルサーバー・OSC](../desktop/server.cjs)、[単体HTMLビルド](../scripts/build-standalone.mjs)

## ファイルと検証の状況

[Windows用EXE](../Lumina-Live.exe)と[単一HTML](../web/Lumina-Live.html)を生成済みです。[GitHub](https://github.com/sakadosoutan-boop/lumina-live)は非公開リポジトリです。外部動画はローカルの `assets` に保存しています。

最新版は**自動テスト366件合格、型検査・本番ビルド・Windows版と単一HTMLの生成成功、npm auditの検出0件**です。ブラウザーではLIVE・AUDIO、実際のMP4再生、AUTOクロスフェード、別画面への出力、歌詞表示、BLACKOUTを操作して確認しました。

全243本の再生用動画に対し、FFmpegで全編をデコードする検査を実施しました。これはファイルの技術的な読み込み検査です。全編の内容レビュー、ループの見え方、本番端末での描画性能は別に確認してください。

Surface Pro 7+／Chromebookの実機、物理HDMI、Windows EXEの直接起動は未確認です。単一HTMLの `file://` 直接起動のUI検証はブラウザー操作ツールのURLポリシーでブロックされました。同じアプリのHTTP配信で確認した動作を、これらの実機試験の代わりにはしていません。
