# LUMINA LIVE — 素材の出典と取得状況

基本操作は[ライブガイド](live-guide.md)、利用条件の根拠は[調査報告・一次資料27URL](../research/report-source.md)を参照してください。

## 現在の素材数

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

## ファイル検証と容量

[最終集計・検証記録](../research/library-audit.json)に、251本の原本と243本の再生用動画のSHA256照合、全編デコード結果、実容量、確認時刻を記録しています。カタログ登録待ちは0本です。保存容量は指定の20,000,000,000 byte以内です。

容量は `assets` 内の全ファイルと `research` 内の取得台帳・出典資料などを数えています。原本、変換版、サムネイル、ZIP・途中ファイルも対象です。集計JSONとデコードキャッシュ自体は別枠です。アプリ、開発用ライブラリ、別の端末やブラウザーへ後から取り込むコピーはこの素材容量に含めません。

取得処理には、open 8.5 GB、パック9.5 GB、変換版1.9 GBの枠を設け、展開中も上限を超えないよう管理しています。残ったMantissa候補とUbersketchは取得・展開用の枠に入らず未取得です。通常の素材取り込みは、全端末の保存容量を自動管理する機能ではありません。

原本一覧、カタログ、クレジット、取得台帳はローカルの `assets` と `research` にあります。動画本体とローカル取得台帳はGitHubにアップロードしていません。GitHub上で参照する際は、公開していないローカルファイルへのリンクが開かないことがあります。

MANIFESTの具象映像には `manual-cue` タグを付け、自動VJの候補から除外しています。通常の一覧にある素材は手動で選択できます。ORGYを名前に含む8本は、通常の一覧からも除外し、ローカルの `assets/excluded.json` に記録しています。

## 起動と確認状況

- この作業PC：[試用画面](http://127.0.0.1:4173/)。他のPCからは使えません。
- Windows：[Lumina-Live.exe](../Lumina-Live.exe)と同じ場所に `assets` を置きます。
- Chromebook：[単一HTML](../web/Lumina-Live.html)をChromeで開き、必要な動画を取り込みます。
- [GitHubの保存先](https://github.com/sakadosoutan-boop/lumina-live)は非公開です。HTMLは「Download raw file」で保存してください。

最新版は**自動テスト366件合格、型検査・本番ビルド・Windows版と単一HTMLの生成成功、npm auditの検出0件**です。ブラウザーではLIVE・AUDIO、実際のMP4再生、AUTOクロスフェード、別画面への出力、歌詞表示、BLACKOUTを操作して確認しました。

全243本の再生用動画に対し、FFmpegで全編をデコードする検査を実施しました。これはファイルの技術的な読み込み検査です。全編の内容レビュー、ループの見え方、本番端末での描画性能は別に確認してください。

Surface Pro 7+／Chromebookの実機、物理HDMI、Windows EXEの直接起動は未確認です。単一HTMLの `file://` 直接起動のUI検証はブラウザー操作ツールのURLポリシーでブロックされました。同じアプリのHTTP配信で確認した動作を、これらの実機試験の代わりにはしていません。

## 配布元ごとの利用条件

以下は既存の調査で整理した条件です。今回の文書更新ではネットワークで再調査しておらず、根拠のURLと確認範囲は[調査報告](../research/report-source.md)に残しています。

| 配布元 | ライブで使う際の要点 |
| --- | --- |
| [Mantissa](https://mantissa.xyz/vj.html) | CC0を明記。作者はMidge “Mantissa” Sinnaeve。クレジットは任意ですが、出典記録を残します。 |
| [Beeple](https://www.beeple-crap.com/vjloops) | 商用・非商用の動画利用を案内。作者はMike Winkelmann。正確なCCの種別は未確定なので、CC0と書いたり素材ファイルの再配布可否を推測したりしません。デモ音楽は別権利です。 |
| [Neb Motion](https://nebmotion.co.uk/vj-loops/free/) | 商用・非商用利用と任意クレジットを案内。配布ページのCC表記だけでCC0と判断しません。 |
| [NASA SVS](https://svs.gsfc.nasa.gov/help/) | 原則public domainですが、第三者素材などの例外があります。[NASAの利用指針](https://www.nasa.gov/nasa-brand-center/images-and-media/)と個別クレジットを確認します。音楽、人物、ロゴの条件は別です。 |
| [ESO](https://eso.org/public/outreach/copyright/)／[ESA/Hubble](https://esahubble.org/copyright/) | 映像は原則CC BY 4.0。素材に指定された全文クレジットを見える形で示し、[ライセンス](https://creativecommons.org/licenses/by/4.0/)と編集内容も記録します。音楽の許諾を映像から推測しません。 |
| [NOAA](https://oceanexplorer.noaa.gov/faqs/)／[USGSの溶岩動画](https://www.usgs.gov/media/videos/lava-flow)／[NPSの降雨動画](https://npgallery.nps.gov/AssetDetail/4e87e5ab-61f0-4c8c-955f-80ae6c4d5b96) | 原則または個別のpublic domain表示が根拠です。例外と出典表記を確認し、「政府サイトの全素材が自由」と一般化しません。 |
| [Pexels](https://www.pexels.com/terms-of-service/)／[Pixabay](https://pixabay.com/service/terms/) | 明示許可のない大量・大規模・系統的なコピーは禁止です。無料の素材でも、まとめて自動収集してよいとは限りません。 |
| [Mixkit](https://mixkit.co/terms/) | スクリプトやボットによる大量取得は禁止です。[動画のFree／Restricted](https://mixkit.co/license/)を素材ごとに確認します。未確認の条件を上映可として扱いません。 |

出典を記録することと、観客に必要なクレジットを見せることは別です。表示が必要な素材は、説明ファイルに書くだけで済ませず、投影映像や読めるエンドクレジットにも反映してください。バンドの歌詞、伴奏音源、公演の録画・配信については、映像素材とは別に使用権を確認します。

## Canvaの動画

[Canvaデザインを開く](https://www.canva.com/design/DAHUkLu0GjM/FE9xFwz7zZ9PYiCNG62QvA/edit)

選択した素材はFreeの「Hazragvir — Vjloop tunnel」で、提供元表示はPixabayです。10秒・1080pの書き出しは画面上で完了しています。ブラウザーからのダウンロード確認に制約があり、**手元の動画ファイルはまだ未取得**です。保存場所、サイズ、長さ、解像度、音声の有無を確認するまでは、オフラインで使える素材に数えません。

通常のFree素材は、条件を満たせばライブの映像・舞台プレゼンテーションに使えます。Free素材の単体ダウンロードまで一律に禁止されているわけではありません。提供元名のPixabayと、特別な制限がある「Branded Content」という区分を混同せず、素材情報で確認します。[Canva規約§2・§5・§6](https://www.canva.com/policies/content-license-agreement/)

**Canva for Educationで提供されるPro素材は、教育目的かつ非商用に限られます。非営利のバンドライブという理由だけでは、この条件を満たしません。** 通常のFree素材と教育用のPro素材を区別してください。[Canva公式解説](https://www.canva.com/licensing-explained/)、[規約§8](https://www.canva.com/policies/content-license-agreement/)

## VideoZeroの動画

[オリジナルの軌道・幾何学映像](https://videozero.ai/view/?id=1c4c6876-0c65-45e8-a832-de1bdf17b65f)

無音8.1秒の映像をレビュー済みです。動画ファイルのローカル保存は未取得のため、オフラインで使える素材には含めません。プロジェクトのURLは視聴・編集への参照で、保存済みの動画ファイルではありません。追加の生成用クレジットは使わない方針です。

## 本番で選ぶ前に

素材一覧に表示された動画をA/B/Cへ読み込み、全編とループのつなぎ目を確認してください。出典・クレジット・音声の条件を確かめてから、曲に合わせて選びます。大きな原本を軽量版に変換しても、出典や利用条件は変わりません。

「類似素材」やAUTO VJの候補選択には、タグ、色、動きの強さの目安を使います。準備済み動画では短いサンプルから色や動きの強さを算出しますが、曲の意味や映像全体の内容を理解する機能ではありません。手動で取り込んだ未解析の素材には初期値が使われるため、切替結果はリハーサルで確認してください。[素材の準備処理](../scripts/build-catalog.mjs)、[類似素材の選択](../src/sync.ts)
