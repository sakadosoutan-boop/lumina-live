# LUMINA LIVE — 素材とライブ運用の調査報告

対象：日本の非営利バンドライブで映像と歌詞を操作する担当者、および最終統合担当者。
範囲：Windows／Surface Pro 7+、またはChromebook、1920×1080のHDMI出力・プロジェクター1台。手動補正を伴う生演奏と、伴奏音源に同期する運用を扱う。素材容量の上限は **20,000,000,000 byte（20 GB、約18.63 GiB）**。追加購入・生成用クレジット消費は行わない。

## 結論

内蔵の96種類は、12系統×8変種のオリジナルGPU描画プリセットである。96本のレンダリング済み動画を取得・同梱したという意味ではない。[内蔵カタログ](../src/catalog.ts)と[描画実装](../src/renderer.ts)が根拠であり、カタログでは当該アートワークをCC0と宣言している。この宣言をアプリ全体・依存ライブラリ・外部素材のライセンスへ拡張しない。

外部素材は確認時点でMantissaの動画73本が取得候補台帳にあり、全73本の実在とバイト数一致を確認した。パック素材の候補台帳は0本。CanvaはUI上の書き出し完了、VideoZeroはプロジェクトのレビューまでという引継ぎがあり、どちらもローカル動画の取得完了には数えない。取得状況は変動するため、最終値は統合担当の監査で更新する。[素材台帳と容量](../docs/material-sources.md)

歌詞・曲の長さ・BPMだけでは歌唱位置を確定できない。現在の機能は文字量と小節に基づく粗い重み付き推定で、リハーサルのキュー記録またはLRC／SRTで補正して使う。LIVEでは現在BPM／基準のtimelineBpmでタイムラインの進行速度を変える。AUDIOでは音源のcurrentTimeが基準で、BPM変更による音源のタイムストレッチは行わない。ボーカルのAI音声認識、音素・単語単位のアラインメントは実装されていない。[同期処理](../src/sync.ts)、[ライブ時計](../src/live-clock.ts)、[操作実装](../src/App.tsx)

## 証拠の読み方

既存の取得記録・保存HTML・スクリプト・実装と、公式ページの現行条件を根拠にする。ローカル実測の基準は2026-09-09 00:10 JST前後、マニフェストとカタログ・配布物の有無は07:18 JST、73動画の実在・サイズとassets合計は07:23 JSTにも再確認した。数値は恒久的な在庫数ではない。

下の台帳は一次資料27URLを区別したもの。従前の27件の完全な一覧との対応は未確定である。27件は動画本数でも配布サイト数でもない。ローカルのsource-snapshots／pack-snapshotsにはHTMLを6ファイル確認したが、Beeple配布元HTMLの重複を含み、27資料全ての保存コピーが存在するとはいえない。保存コピーの有無と現行ページの閲覧は別に記載する。

| 証拠 | 確認できること | 確認できないこと |
| --- | --- | --- |
| 公式の現行規約 | 許諾条件・禁止事項・例外 | 個別素材の無欠陥保証、将来の規約維持 |
| 保存HTML＋SHA256 | 取得時の文面、今回計算したファイル同一性 | その後の規約変更がないこと |
| acquisition／candidates | 取得日時、状態、ハッシュ・probe記録 | 会場での連続再生、ループの継ぎ目 |
| 現在のソースコード | 処理・制限・設定の存在 | 配布物への反映、対象機の性能認証 |
| Canva／VideoZeroの引継ぎ観察 | 指定プロジェクトと観察済み段階 | この担当によるUI再検証、ローカル保存・全フレーム検査 |

既存の[open取得記録](../research/open-acquisition.json)にはMantissaとNASA 20249の出典記録がある。NASAには規約スナップショット欠落のエラーがあり、素材取得成功とは扱わない。[open取得スクリプト](../scripts/collect-open.mjs)にはNASA、ESO、ESA/Hubble、NOAA、USGS、NPS、Commons、Blenderなどの探索候補があるが、コードにURLや権利説明が存在するだけで取得・検証済みにはならない。[pack取得スクリプト](../scripts/collect-packs.mjs)のexpectedVideosも予定本数である。

保存HTMLの今回のSHA256再計算は以下。取得日時・HTTP情報は上記open記録と[pack取得記録](../research/pack-acquisition.json)を優先する。

| 保存資料 | 取得記録の時刻（UTC） | SHA256 |
| --- | --- | --- |
| [Mantissa](../research/source-snapshots/open-mantissa.html) | 2026-09-08 00:31:25.579（親が取得したHTMLを引継ぎ） | d961a72d913a218dad2bccd12b84962e89dc5166e38b138d48019d6521e2b3dd |
| [NASA 20249](../research/source-snapshots/open-nasa-20249.html) | 2026-09-08 01:13:15.303 | 09a6bd30ced99d066466f06b0a179a230736c23e1132c60fa6ab5460165d3eed |
| [Beeple配布元・MANIFEST時](../research/pack-snapshots/beeple-manifest-source.html) | 2026-09-07 22:27:25.939 | 190b56d2542b5f1c141f12e0cf4972b495f8ba92fb8f4ecf3bc61a5db392539a |
| [Beeple配布元・four.color.process時](../research/pack-snapshots/beeple-four-color-process-source.html) | 2026-09-08 00:30:17.688 | 190b56d2542b5f1c141f12e0cf4972b495f8ba92fb8f4ecf3bc61a5db392539a |
| [MANIFESTのホストページ](../research/pack-snapshots/beeple-manifest-host.html) | 2026-09-07 22:27:26.337 | 3bf2e5c721107a60aa16a7d5f6c72c469cb9d91d9eb3ac356320a7f88cd38ed9 |
| [four.color.processのホストページ](../research/pack-snapshots/beeple-four-color-process-host.html) | pack記録のhostEvidence参照 | 25600c60ae50f4d834e737f9cbeb38c53d9ebd26b5965c108f2d0a66902679c9 |

ホストページは配布先の証拠であり、追加の権利許諾の根拠には数えない。動画73本のSHA256と先頭フレーム検査は取得時の記録を参照した。今回73本を再ハッシュ・全編再生したわけではない。

## ライブ利用を決める条件

**Canvaの通常のFree素材は、条件を満たしてライブ映像に利用できる。** 規約§5の動画・舞台プレゼンテーションへの許諾を、今回のバンド投影へ適用した判断である。§2で素材情報の出典と区分を確認し、§4で書き出し時のライセンス発行、§6でFree素材の追加許諾を確認する。Freeの単体ダウンロードまで一律禁止と説明しない。再配布や素材ライブラリ化は別の条件があり、今回の用途は会場での投影に限定して評価する。[Canva規約](https://www.canva.com/policies/content-license-agreement/)、[公式解説](https://www.canva.com/licensing-explained/)

Canva for Educationで提供されるPro素材は、**教育目的かつ非商用**という制限がある。非営利バンドであることだけでは教育目的を満たさない。通常Free、Pro、Education Content、Branded Contentを混同せず、音楽にも映像素材の許諾を流用しない。「Pixabayという提供元・ブランド名が表示された」という引継ぎだけから、規約上の明示的なBranded Content区分であると断定しない。[Canva規約§2・§5B・§5C・§8](https://www.canva.com/policies/content-license-agreement/)

PexelsとPixabayは、明示許可のない大量・大規模・系統的コピーを禁止し、Mixkitはスクリプト／ボットによる大量取得を禁止している。無料利用の許諾は一括収集の許諾を意味しない。これらを自動収集の対象に追加しない。Mixkitでは動画のFreeとRestrictedを各素材で確認する。[Pexels規約§8](https://www.pexels.com/terms-of-service/)、[Pixabay規約](https://pixabay.com/service/terms/)、[Mixkit規約§9.10](https://mixkit.co/terms/)、[Mixkitライセンス区分](https://mixkit.co/license/)

Mantissaは配布元がCC0を明記し、商用・非商用に利用する根拠が明確である。BeepleとNeb Motionは広い商用・非商用利用を案内しているが、確認ページの「Creative Commons」だけから正確なCCバージョンや再配布条件を推定しない。Beepleのデモ音楽は別権利である。[Mantissa](https://mantissa.xyz/vj.html)、[CC0](https://creativecommons.org/publicdomain/zero/1.0/)、[Beeple](https://www.beeple-crap.com/vjloops)、[Neb Motion](https://nebmotion.co.uk/vj-loops/free/)

NASA SVSの原則的なpublic domainは例外表示と音楽を確認して適用し、米国著作権上の説明を世界中の全権利の保証に置き換えない。ESO／ESA/Hubbleでは個別の全文クレジットを見える形で付け、CC BY 4.0へのリンクと変更表示を保持する。ESOの規約には音楽について一般説明と除外・Music Archive例外が併記されているため、映像の許諾を全音楽へ拡張しない。[NASA SVS](https://svs.gsfc.nasa.gov/help/)、[NASA指針](https://www.nasa.gov/nasa-brand-center/images-and-media/)、[ESO](https://eso.org/public/outreach/copyright/)、[ESA/Hubble](https://esahubble.org/copyright/)、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## 主張と一次資料の台帳（27URL）

全行のアクセス日は2026-09-09 JST。「日付不明」は今回本文から公開・更新日を確定できなかったことを示す。検索結果のクロール日を公開日に代用していない。S番号はこの文書内の識別用である。

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
| S09 | [Free VJ Loops — Midge “Mantissa” Sinnaeve](https://mantissa.xyz/vj.html) | 日付不明 | CC0宣言を現行本文と保存HTMLで確認。127候補という数は保存HTMLの生成ロジック・スクリプトに由来。 |
| S10 | [CC0 1.0 Universal — Creative Commons](https://creativecommons.org/publicdomain/zero/1.0/) | バージョン1.0、日付不明 | 著作権等の放棄の説明。商標・肖像等を含む全権利保証ではない。 |
| S11 | [VJ LOOPS — Beeple／Mike Winkelmann](https://www.beeple-crap.com/vjloops) | 日付不明 | 商用・非商用利用、音楽別権利、配布パック案内。CC種別は特定できず。 |
| S12 | [Free VJ Loops — Neb Motion](https://nebmotion.co.uk/vj-loops/free/) | 日付不明 | 商用・非商用利用、任意クレジット、公式パックリンク。ローカル取得の証拠ではない。 |
| S13 | [Tutorials, Links, and Other Helpful Information — NASA SVS](https://svs.gsfc.nasa.gov/help/) | 2024-03-27更新 | 原則public domain、個別例外・別ライセンス音楽の除外。今回ウェブ閲覧、保存規約HTMLは未確認。 |
| S14 | [Images and Media Guidelines — NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) | 日付不明 | 第三者素材、人物、ロゴ、推薦・関係の誤認への条件。 |
| S15 | [Solar System Animation — NASA SVS／Adriana Manrique Gutierrez](https://svs.gsfc.nasa.gov/20249/) | 2016-09-20公開、2023-05-03更新 | ID 20249、1080p／4Kの配布とクレジット。保存HTMLあり、動画取得は未確認。 |
| S16 | [Copyright Notice — ESO](https://eso.org/public/outreach/copyright/) | 日付不明 | 映像のCC BY 4.0、見える全文クレジットと例外。音楽は一括許諾と扱わない。 |
| S17 | [Milky Way revealed — ESO／B. Tafreshi](https://www.eso.org/public/videos/uhd_yb_paranal_01/) | 2014-05-09公開 | 個別クレジットと動画の配布形式。候補であり取得済みではない。 |
| S18 | [Copyright Information — ESA/Hubble](https://esahubble.org/copyright/) | 日付不明 | CC BY 4.0、映像と離れない全文クレジット、音楽・ロゴ等の例外。 |
| S19 | [Zoom into Pillars of Creation — NASA, ESA/Hubble and the Hubble Heritage Team](https://esahubble.org/videos/heic1501f/) | 2015-01-05公開 | 個別クレジット、ID heic1501f、HD配布。候補であり取得済みではない。 |
| S20 | [Frequently Asked Questions — NOAA Ocean Exploration](https://oceanexplorer.noaa.gov/faqs/) | 日付不明 | 著作権例外、元ページのクレジット保持、原則public domain。折り畳み質問のリンクを再取得して回答本文を確認。 |
| S21 | [Lava flow — USGS／Hawaiian Volcano Observatory](https://www.usgs.gov/media/videos/lava-flow) | 2003-06-07 | 個別のSources/Usage: Public Domain。全USGS掲載物への一般化はしない。 |
| S22 | [Summer Rainfall — NPS／Ally O’Rullian](https://npgallery.nps.gov/AssetDetail/4e87e5ab-61f0-4c8c-955f-80ae6c4d5b96) | 公開日未確定 | 個別のPublic domain: Full Granting Rightsとクレジット。人物・標識等の別権利は保証しない。 |
| S23 | [Attribution 4.0 International — Creative Commons](https://creativecommons.org/licenses/by/4.0/) | バージョン4.0、日付不明 | 帰属、ライセンスリンク、変更表示、追加制限禁止。 |
| S24 | [Web MIDI API — MDN／Mozilla contributors](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) | 2026-05-15更新 | ブラウザーの対応差、権限、安全なコンテキスト。機器接続成功の保証ではない。 |
| S25 | [getUserMedia() — MDN／Mozilla contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | 日付未採録 | マイク・カメラ入力の権限要件。APIの存在は本アプリのカメラ実装を意味しない。 |
| S26 | [MediaRecorder — MDN／Mozilla contributors](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) | 日付未採録 | 録画形式の対応確認。音声トラックや上限はアプリ実装で決まる。 |
| S27 | [WebGL API — MDN／Mozilla contributors](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API) | 日付未採録 | GPU描画の仕組みと機器依存性。Surface／Chromebookの性能認証ではない。 |

## 実装上の判断と残る確認

| 論点 | 確認結果／確度 | 次の確認 |
| --- | --- | --- |
| LIVEの歌詞同期 | コード上確認。timelineBpmを保存し、BPM比で時計を進める。次／前はオフセットを変更。 | 歌い出し、伸ばし、テンポ変化を実演で記録。自動追唱とは呼ばない。 |
| AUDIOの同期 | コード上確認。音源時刻が基準。次／前の歌詞は音源位置もシークする。 | PA接続・HDMI音声先・曲ごとの再リンクを確認。 |
| 音声反応 | 周波数帯別レベル。マイク解析と伴奏再生は同じAudioEngineを切替。 | 同時のマイク解析＋伴奏再生は前提にしない。AIボーカルASRや自動採譜ではない。 |
| 出力・レイヤー | A/B＋C重ね、別出力ウィンドウをコードで確認。 | 1台のHDMIプロジェクターで拡張表示と操作画面分離を確認。 |
| カメラ | 現在は未実装。Asset種類にcameraがなく、音声入力はvideo:false、Windows権限もカメラを許可しない。 | 親側で追加された場合のみガイドを更新。 |
| 録画 | 操作側の合成canvasをWebM録画。音声なし。閾値256×1024×1024 byte。 | 1秒単位のデータ受領で閾値超過後に停止。自動連続分割・各レイヤー別録画ではない。 |
| 保存・オフライン | セットJSON、ブラウザー自動保存・IndexedDB、Windowsの素材参照登録あり。 | 別端末移行、元ファイル移動、ストレージ削除、音源の再リンクを確認。 |
| 外部素材の収録 | candidatesには73本、確認時assets/catalog.jsonは未存在。 | 統合カタログ作成・アプリ起動後のロードは親側の作業。 |
| 配布・性能 | 配布スクリプトあり。確認時releaseフォルダー未存在。実機認証なし。 | Windows成果物、Chromebook用HTML、実機の通しリハーサル。 |
| 未対応プロトコル等 | MTC／LTC／NDI／Spout、単語単位アラインメントを現在の実装で確認できない。 | 対応済みとして宣伝しない。MIDI ClockとMTCは別物。 |

詳しい操作は[ライブガイド](../docs/live-guide.md)。根拠は[音声・MIDI](../src/audio.ts)、[保存](../src/storage.ts)、[Windowsメイン](../desktop/main.cjs)、[ローカルサーバー・OSC](../desktop/server.cjs)、[単体HTMLビルド](../scripts/build-standalone.mjs)。

## 検証範囲と最終監査

統合担当から346件のテスト合格とビルド成功、CUAでの投影画面・歌詞・BLACKOUT確認が報告されている（2026-09-09 JST）。これは報告された試験結果であり、文書担当による再実行や、最終配布物・実機GPU・HDMIプロジェクターの認証を意味しない。検証結果の出所と工程は[PLAN](../PLAN.md)に記載する。

最終統合時には、件数・容量・catalog／releaseの実在・カメラの実装・Canva／VideoZeroの保存状態を再確認し、本文の時点情報と一致させる。未取得を取得済みへ変えるにはローカル実体、バイト数、SHA256、動画メタデータ、再生と出典条件の確認が必要である。
