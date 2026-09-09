# LUMINA LIVE — 素材の出典と取得状況

外部動画の「候補発見」「許諾確認」「ダウンロード」「検証」「アプリへの収録」は別の段階である。内蔵96種類はオリジナルのGPU描画プリセットであり、96本の動画ファイルではない。素材の選び方と権利判断の根拠は[調査報告・27資料台帳](../research/report-source.md)、操作方法は[ライブガイド](../docs/live-guide.md)を参照する。

## 確認時点の実数

実ファイル集計日時：**2026-09-09 00:10 JST（2026-09-08 15:10 UTC）前後**。マニフェストの内容は07:18 JST、全73動画の実在・サイズとassets合計は07:23 JSTにも同じ値を確認した。収集担当が作業を継続しているため、以下は収集完了の宣言ではない。最終統合担当がマニフェストと実ファイルから再集計する。

| 区分 | 確認できた数・容量 | 状態と注意点 |
| --- | --- | --- |
| オリジナルGPUプリセット | 96種類＝12系統×8変種 | 動画ファイル数・取得バイト数に加算しない。カタログのアートワークはCC0宣言。 |
| Mantissa取得動画 | 73本、6,266,111,985 byte | 73本全ての実在・サイズ一致を今回確認。取得時記録は73本ともSHA256・probeあり。 |
| Mantissa未取得候補 | 54本 | open記録では127候補中54本がskipped-budget。配布元全作品の取得完了ではない。 |
| パックから検証済みの動画 | 0本 | pack-candidatesは空配列。ZIPの取得成功を動画の展開・検証成功と数えない。 |
| 保持されているパックZIP | 1ファイル、1,392,226,940 byte | four.color.process。展開処理のJSONエラーで停止した記録がある。 |
| ローカル動画＋パックZIP | 7,658,338,925 byte | 確認対象のmedia/open・media/packs・downloads/packsの合計。 |
| assetsフォルダー全体 | 76ファイル、7,658,542,708 byte | 上記に候補JSON等を含む実測。研究資料・ブラウザー保存・録画・別フォルダーのコピーは含まない。 |
| Canva | 1デザイン、10秒・1080pの引継ぎ記録 | UIでは書き出し完了。ローカル動画の存在・サイズ・ハッシュは未確認、取得本数への加算0。 |
| VideoZero | 1プロジェクト、無音8.1秒の引継ぎ記録 | レビュー済み。ローカルエクスポート未取得、取得本数への加算0。 |

根拠：[open候補JSON](../assets/open-candidates.json)、[open取得記録](../research/open-acquisition.json)、[pack候補JSON](../assets/pack-candidates.json)、[pack取得記録](../research/pack-acquisition.json)、[内蔵カタログ](../src/catalog.ts)。

open記録のupdatedAtは2026-09-08T01:13:15.315Z、pack記録は2026-09-08T00:35:23.992Z。openのrun.statusはrunningのままだが、これはプロセスが今も実行中である証拠にはならない。

open記録のmediaDiskBytesは6,405,007,583 byteで、今回の実在73本の合計とは138,895,598 byte異なる。過去の途中ファイル・進捗値を現在の容量へ加算し直さない。MANIFESTの過去のpartialBytes＝1,403,682,816も記録に残るが、今回の対象ディレクトリーではその.part実体を確認していない。現在のパックZIPはarchive-downloadedイベントと実サイズを参照し、古いdownloadedBytesの進捗値を使わない。

取得時probeではMantissa73本はいずれも2048×1152、音声なし。先頭フレームのデコード検査は全編検査ではなく、各ループの継ぎ目は未検証。今回動画全体の再ハッシュ・全編目視再生はしていない。sourceRightsの有無、取得成功、実機での安定再生を別々に確認する。

## 20 GBの上限

上限は **20,000,000,000 byte**。20 GiB（21,474,836,480 byte）へ読み替えない。確認時のassets全体との差は12,341,457,292 byteだが、これは今後使える容量を保証する値ではない。研究資料・他の取得担当・ブラウザーのIndexedDB複製・展開中のZIPと動画・プロキシ・録画も含め、重複保持のピークを親側で監査する。

現在の[open取得スクリプト](../scripts/collect-open.mjs)は6 GiB、[pack取得スクリプト](../scripts/collect-packs.mjs)は12 GiBの担当別枠を持つ。合計19,327,352,832 byteで、ユーザー上限との差は672,647,168 byte。これは固定の全体管理機構ではない。担当配分が変わった場合も全体の20,000,000,000 byteを維持する。

アプリの一般的な素材取り込みに、この20 GB全体上限の自動強制は確認できない。Windows版は元ファイルへの登録、ブラウザー版はIndexedDBへの複製を使うため、同じ動画でも必要容量が異なる。[Windows素材登録](../desktop/server.cjs)、[ブラウザー保存](../src/storage.ts)

## 配布元ごとの採用条件

| 配布元 | 本番への扱い | 残す出典・制限 |
| --- | --- | --- |
| [Mantissa](https://mantissa.xyz/vj.html) | 取得済み候補の主力。CC0。 | 作者Midge “Mantissa” Sinnaeve、原ページ、SHA256を保持。クレジットは任意。 |
| [Beeple](https://www.beeple-crap.com/vjloops) | 動画の商用・非商用利用の案内あり。現在は検証済み展開動画0本。 | Mike Winkelmannと原ページを保持。CCの正確な種別は未確定。音楽は別権利。素材ファイルの再配布条件を推定しない。 |
| [Neb Motion](https://nebmotion.co.uk/vj-loops/free/) | 商用・非商用利用と任意クレジットの案内あり。今回ローカル取得は未確認。 | 公式パックリンクを利用。配布ページのCC表記だけでCC0と書かない。 |
| [NASA SVS](https://svs.gsfc.nasa.gov/help/) | 原則public domain、個別例外あり。候補のまま。 | [NASA指針](https://www.nasa.gov/nasa-brand-center/images-and-media/)と素材ごとのクレジット。音楽、第三者素材、人物、ロゴ・推薦の誤認を別途確認。 |
| [ESO](https://eso.org/public/outreach/copyright/)／[ESA/Hubble](https://esahubble.org/copyright/) | CC BY 4.0条件と個別クレジットを満たして利用。候補のまま。 | 見える全文クレジット、[ライセンスリンク](https://creativecommons.org/licenses/by/4.0/)、変更表示。音楽の許諾を映像から推定しない。 |
| [NOAA](https://oceanexplorer.noaa.gov/faqs/)／[USGSの溶岩動画](https://www.usgs.gov/media/videos/lava-flow)／[NPSの降雨動画](https://npgallery.nps.gov/AssetDetail/4e87e5ab-61f0-4c8c-955f-80ae6c4d5b96) | 公式の原則または個別public domain表示を確認。候補のまま。 | 個別ページの例外とクレジットを維持。「政府サイトなら全て自由」と一般化しない。 |
| [Pexels](https://www.pexels.com/terms-of-service/)／[Pixabay](https://pixabay.com/service/terms/) | 必要な個別素材の通常取得を検討する範囲。 | 明示許可のない大量・大規模・系統的コピー禁止。無料だから一括収集できるとはいえない。 |
| [Mixkit](https://mixkit.co/terms/) | 個別条件の確認が済むまで候補。 | スクリプト／ボットでの大量取得禁止。[動画Free／Restricted](https://mixkit.co/license/)を区別。今回のテキスト取得では展開式ライセンス全文は未確認。 |

素材が無料でも、バンド自身の楽曲・歌詞・録音や会場投影、公開配信・公演録画の権利まで一括して処理されるわけではない。映像の権利台帳と、自前で使用する歌詞・伴奏音源の管理を分ける。

## Canvaの具体的な状態

[Canvaデザインを開く](https://www.canva.com/design/DAHUkLu0GjM/FE9xFwz7zZ9PYiCNG62QvA/edit)

引継ぎ記録：Freeの「Hazragvir — Vjloop tunnel」、提供元表示はPixabay、10秒、1080p、UIのエクスポート状態はcomplete。元の観察日時は引継ぎに未記載。

ブラウザー自動化上の制約によりローカルダウンロードをまだ確認できていない。書き出し完了やダウンロード操作の成功表示だけで、保存済み・アプリへ収録済みとはしない。保存パス、実体、バイト数、SHA256、解像度・長さ・音声有無を確認した段階で台帳を更新する。

通常のFree素材は、出典区分と条件を満たせばライブの映像・舞台プレゼンテーションに使える。Free素材の単体ダウンロードを一律禁止と説明しない。素材情報にある提供元名Pixabayと、規約上のBranded Contentという明示区分は同一ではない。採用時にはFree／Pro／Education／Brandedの表示を確認する。[Canva規約§2・§5・§6](https://www.canva.com/policies/content-license-agreement/)

**教育アカウントで得たPro素材には教育目的かつ非商用の制限があり、非営利バンドという理由だけでは足りない。** 今回の通常Freeという観察と、教育Proの条件を混ぜない。Free／Proの見分け方は[Canva公式解説](https://www.canva.com/licensing-explained/)、正式条件は[Canva規約§8](https://www.canva.com/policies/content-license-agreement/)を参照する。

## VideoZeroの具体的な状態

[VideoZeroのオリジナル軌道幾何プロジェクト](https://videozero.ai/view/?id=1c4c6876-0c65-45e8-a832-de1bdf17b65f)

引継ぎ記録：オリジナルの軌道・幾何学アニメーション、無音、8.1秒、レビュー済み。ローカルの動画エクスポートは未取得。プロジェクトURLは視聴・作業への参照で、ローカルMP4の保存先ではない。既存プロジェクトを保存・確認する次の段階でも追加使用クレジットを前提にしない。サービス全体のライセンス保証や第三者素材の権利処理済みを、この引継ぎだけから付け加えない。

## アプリ収録前と最終監査

確認時点では、起動時に参照する統合catalog.jsonは未存在だった。open-candidatesに73本あっても、初期画面に73本追加済みとは限らない。収集担当による統合作業中として扱う。素材はライブラリに現れた後、A/B/Cへロードし、実際の映像・長さ・継ぎ目・色・音声状態を確認する。

最終担当は各素材について、配布元URL、作者と表示すべきクレジット、ライセンスURL・区分、確認日時、保存パス、bytes、SHA256、解像度、fps、duration、audioPresent、probeの実施範囲、取得状態を照合する。過去の失敗記録は現在の実体と照合し、予定本数を成功本数に足さない。重複はハッシュを基準に確認する。

類似素材・AUTO VJはタグ、登録されたenergy・hueによる候補選択である。取得動画のenergy・hueは中立の仮値を含み、全動画を映像解析した測定値ではない。繋がりの良さは担当者が試して確定する。[類似素材処理](../src/sync.ts)
