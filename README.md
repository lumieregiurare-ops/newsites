# GameLab Radar（gamelab.main.jp）

新しく公開されたゲーム関連の Web サイトを毎日自動で集めるサイト「GameLab Radar」のソースです。`docs/` がサイトルートで、そのままロリポップ（FTP）や GitHub Pages に置いて公開できます。

- `docs/index.html` — トップページ（新着ゲームサイト 8 件 / 新着スマホゲーム / リリーススケジュール / 事前登録 / AI でつくったゲーム / About / SNS リンク）
- `docs/radar/` — 新着ゲームサイトの全件一覧。公式サイト・ティザー・特設キャンペーン・周年・イベント・インディーゲームなどを種類別に表示
- `docs/schedule/` — **リリーススケジュール**: 向こう 120 日の新作発売予定と、発売日の決定・延期などの更新履歴
- `docs/prereg/` — **事前登録受付中**: 事前登録・予約注文中のスマホゲーム。配信日決定 / 未定 / App Store で予約可 で絞り込み（データはどちらも `docs/data/schedule.json`）

## 公開するデータファイル

ページごとに必要な分だけを読むよう分けています（全件の `schedule.json` は 450KB 前後あり、トップページで読むと表示が遅くなるため）。

| ファイル | 読む場所 | 目安 |
| --- | --- | --- |
| `docs/radar/data/sites.json` | トップ / `/radar/` | 約 160KB |
| `docs/data/schedule-top.json` | トップ（発売 14 件・事前登録 8 件・更新履歴 6 件） | 約 20KB |
| `docs/data/prereg.json` | `/prereg/` | 約 28KB |
| `docs/data/schedule.json` | `/schedule/` のみ | 約 450KB |
| `docs/data/trends.json` / `notes.json` | トップ | 各 10KB 以下 |

`/schedule/` は 600 件を超えるため、最初に 120 行だけ描画し「さらに表示」で追加します。

## いま遊ばれているゲーム（ランキング）

トップページに 2 つのランキングをタブで表示します（`docs/data/rankings.json`）。

| タブ | 取得元 | 内容 |
| --- | --- | --- |
| Steam | 公式 API `ISteamChartsService/GetMostPlayedGames` | 同時接続数の上位 10 件。順位の変動は API が返す先週の順位との比較。タイトル名と画像は `appdetails` から取得し `data/rankings-state.json` に記録（一度引いたら再取得しない） |
| App Store | 日本のゲーム無料ランキング RSS | 上位 10 件。アプリページの URL は `entry.id.label` から取り（`entry.link` は配列なので注意）、アイコンは 100px 版の URL を 246px 版に置き換えて使います |

**App Store の順位変動は本当の前日比です。** 収集は日中 2 時間おきに走るため、単純に前回と比べると数時間の差しか出ません。`data/rankings-state.json` に「今日の順位」と「比較の基準（前日の順位）」を分けて持ち、日付（日本時間）が変わったときだけ基準を繰り上げます。基準が無い初日は変動を出しません。

順位が上がったものは緑、下がったものは赤、前日 100 位圏外から入ったものは「NEW」で表示します。設定は `config.json` の `rankings`。

**Google トレンドは既定で無効**です（`trends.enabled: false`）。日本全体の急上昇を返す仕組みでカテゴリ指定ができず、ゲーム以外のキーワードが大半を占めたためです。コードは `scripts/lib/trends.mjs` に残してあるので、`true` にすれば `docs/data/trends.json` の生成だけは再開できます（表示側は撤去済み）。

## リリーススケジュール・事前登録のデータ源

| 情報 | 取得元 | 備考 |
| --- | --- | --- |
| Nintendo Switch / Switch 2 の発売予定 | 任天堂公式サイトの検索 API（`search.nintendo.jp`、発売予定・予約受付中） | タイトル・発売日・メーカー・パッケージ画像・ストアリンク。上限 500 件（`nintendoLimit`、実数は 440 件前後） |
| Steam の近日登場 | Steam ストアの「人気の近日登場」（`filter=popularcomingsoon`、日本語） | 上位 300 件を 100 件ずつページ送りで取得（`steamCount`）。人気順を `priority` として保持 |
| ニュースで発表された発売日 | 収集済みのゲームニュース見出しから「M月D日発売」「2027年春リリース」などを抽出 | グッズ・番組・書籍の発売は除外 |
| 事前登録受付中 | ① 4Gamer の事前登録情報ページ（RSS なし・EUC-JP、記事 50 件）を記事フィードと同じ経路で処理 ② ゲームニュース**記事本文の前半**の解析（受付中か終了か、特典、登録者数、App Store / Google Play の ID） ③ Game8 の事前登録一覧から**タイトル名だけ**を拾い、App Store 検索で予約注文中と確認できたものを掲載。確認できないもの（Android 専用など）は `preregLists.showUnverified: true` のとき「事前登録中・未確認」の破線バッジ付きで掲載し、公式サイトが分からない場合は Game8 の該当ページへリンク ④ ニュースに出たスマホゲームを App Store 検索で照会 | 公式サイトとストアへのリンク、特典・登録者数を併記。一覧ページの内容（順位・特典・日付）は転載せず、タイトル発見にだけ使う |

### 配信日の扱い

事前登録の配信日は誤りが出やすいため、次の優先順で決め、**どこの情報かをカードに明示**します。

1. **App Store の予約ページ**の配信予定日（`App Store 2026年9月22日` と出典付きで表示）。開発者が随時更新する最新値のため最優先します。記事見出しの日付と食い違う場合は、ツールチップに「発表時は 9月24日リリース」と併記します。12/31・1/1 や 1 年以上先の日付は「未定」を埋めるための仮日付とみなして使いません。日付は実行環境の時差に左右されないよう日本時間で判定します
2. **掲載元の記事見出し**に書かれた日付（`9月24日リリース`）。記事本文からは取りません。本文の後半には関連記事や別タイトルの日付が混ざり、無関係な日付を拾ってしまうためです
3. どちらも無ければ **配信日未定**

見出しが「特別番組が9月17日20時より配信決定」のような場合は、作品自体の配信ではないため日付として採用しません（`番組` `放送` `生配信` `発表会` `ライブ` などを含む見出しは除外）。

### 配信済みのタイトルを外す判定

事前登録の根拠が古い記事 1 本だけだと配信開始後も載り続けるため、収集のたびに次を確認して外します。

1. 公式サイトの説明文（og:description）に「配信中」「好評配信中」「今すぐダウンロード」「now available」などがある
2. App Store で該当アプリが見つかり、予約注文ではなく配信済みになっている
3. App Store で確認できず記事だけが根拠のものは、記事の公開から `preregMaxAgeDays`（既定 45 日）を過ぎたら外す
4. 見出しから読み取った配信日が過去になっている

外した理由は `docs/data/schedule.json` の `stats.preregDropped` に残ります。
| 更新履歴 | 収集のたびに前回の状態と比較 | 新規・発売日決定・延期・前倒し・事前登録開始を直近 30 日分記録。掲載対象から外れたタイトルの履歴は表示せず、「事前登録開始」は受付中のタイトルにだけ出します |

トップページでは、ニュースで報じられた作品 → 任天堂の予約受付中 → Steam 人気順の優先度で 14 件を選び、日付順に表示します。`/schedule/` では全件を月ごとに一覧し、情報源・機種で絞り込めます。設定は `config.json` の `releases`（`daysAhead` / `nintendoLimit` / `steamCount` / `maxUndated` / `historyDays` / `appstoreMatch`）。

App Store の検索 API はレート制限が厳しいため、1 回の収集で最大 60 タイトル（`appstoreMatch.maxPerRun`）を `appstoreMatch.delayMs`（既定 1.2 秒）間隔で照会します。待つのは**実際に問い合わせた直後だけ**で、キャッシュに当たった語や最後の 1 件の後では待ちません（以前は一律 3 秒待っていて、1 回の収集で数十秒を無駄にしていました）。429 が返ったときだけ待ち時間を倍にして次に進みます。

検索結果は `data/schedule-state.json` の `appstoreSearch` に 72 時間キャッシュします。**見つからなかった語は `appstoreMatch.missTtlHours`（既定 336 時間 = 14 日）** と長めに覚えておきます。「App Store に無いタイトル」は次も無いことがほとんどで、72 時間ごとに引き直すと無駄な待ち時間になるためです。タイトルの状態（発売日・事前登録）も同じファイルに保存され、次回の収集で差分を取って更新履歴になります。**このファイルを消すと履歴がリセットされます。**

## ソースとビルド

編集するのは `site/`（HTML / CSS / JS / 画像のソース）です。`npm run build` で JS・CSS を esbuild で圧縮し、HTML のコメントと空白を落として `docs/` に出力します。画像（jpg / png）は sharp で横幅 800px 上限に縮小・再圧縮します（`site/assets/noimage.jpg` は 1.5MB → 13KB）。元の画像は `site/` にそのまま残るので、差し替えるときは `site/assets/` のファイルを置き換えてください。**`docs/` 内の HTML / JS / CSS は直接編集しないでください**（次のビルドで上書きされます）。`docs/data/` と `docs/radar/data/` の JSON はビルドの対象外で、収集スクリプトと手編集（`site.json`）で管理します。

```bash
npm install      # 初回のみ（esbuild を入れる）
npm run build    # site/ → docs/
npm start        # build してからローカルサーバー起動
```

GitHub Actions では収集・デプロイのどちらのワークフローでも build を実行するので、`site/` を push すれば圧縮済みのファイルが公開されます。圧縮は「読みにくくする」効果しかなく、ブラウザで読める JS を完全に隠すことはできません。ソースそのものを見せたくない場合は、GitHub のリポジトリを Private にしてください（ロリポップへの FTP デプロイは Private でもそのまま動きます。GitHub Pages を使う場合は Private だと有料プランが必要です）。

## 収集にかかる時間

収集は 1 回あたり **10 秒前後**です。`data/last-run.json` の `timings` に各フェーズの秒数、`sources.*.sec` に収集元ごとの秒数が残るので、遅くなったときはそこを見てください。

速くするために次のようにしています。

- **収集結果に依存しない取得は先に始める**: note の記事・ランキング・事前登録一覧・任天堂／Steam の発売予定は、フィードの収集結果と関係がありません。`collect.mjs` の冒頭でまとめて開始し、必要になった場所で受け取ります。順番に待つと 10 秒近く損をします
- **App Store 検索の待ち時間**: 実際に問い合わせた直後だけ待ちます（前述）
- **Steam の発売予定**: 100 件ずつ 3 ページを同時に取ります
- **画像の再圧縮を省く**: `docs/` 側の画像が `site/` 側より新しければビルドで作り直しません。ビルドの banner にも日付を入れません。どちらも「中身が変わっていないのに差分が出て、収集のたびに無駄なコミットと FTP アップロードが走る」のを防ぐためです

`meta.concurrency`（OGP の同時取得数）と `meta.timeoutMs` は `config.json` で調整できます。応答の遅いサイトを長く待つより、短めに切って次回の収集で取り直すほうが全体は速く終わります。

## トップページの編集

| ファイル | 内容 |
| --- | --- |
| `docs/data/site.json` | サイト名と X / note のリンク先（ヘッダーとフッターに出ます）。`note` にアカウント URL を入れると、収集時に note の公式 RSS（`note.com/<user>/rss`）から記事一覧を取り、トップの「note の記事」セクションに新しい順で 6 件表示します（タイトル・サムネイル・冒頭のみ。本文は転載しない）。データは `docs/data/notes.json` |
| `site/index.html` | ヒーローの文言・About の本文（編集後に `npm run build`） |
| `site/assets/top.css` | 配色は `:root` の変数（`--cyan` / `--violet` / `--pink`）で変更 |

### 新着ゲームサイトの並び（`site/assets/top.js`）

トップの 8 枚は「**新着 5 件 + 直近 7 日からランダム 3 件**」です（`RADAR_NEWEST` / `ROTATE_DAYS`）。全件を新着順で切ると、次の収集が走るまで顔ぶれが変わらず、少し前に載ったサイトが誰の目にも触れないまま流れていくためです。先頭 5 件は新着順のままなので、最新のものを見に来た人の邪魔はしません。

### NEW バッジと「新着 n 件」

前回この端末で見た時刻を `localStorage`（キー `gamelab:visit`）に持ち、それ以降に載ったサイトへ NEW バッジを、Radar セクションの先頭に「新着 n 件」のバーを出します。**サーバーには何も送りません**し、保存できないブラウザ（プライベートモードなど）では単に何も出ません。

基準の時刻は**30 分以上あいたときだけ繰り上げます**（`VISIT_GAP_MS`）。ページを開くたびに基準を「今」にすると、少し前に戻ってきただけで NEW が全部消えてしまうためです。

## サイト名について

「GameLab Radar」を正式名称にしています。「GameLab」単独だと、ゲーム情報誌『ゲームラボ』（三才ブックス、現在も刊行中）やドコモ向けゲーム配信サービス「GAME LAB」と分野が重なり、混同のおそれがあるためです。表示名を変える場合は `docs/data/site.json` の `name` と、各 HTML の `<title>` / ロゴ / フッターを直してください（ドメインは変更不要です）。

## ロリポップへの公開

1. ロリポップの FTP 情報（サーバー・アカウント・パスワード）を GitHub の Settings → Secrets and variables → Actions に `LOLIPOP_FTP_SERVER` / `LOLIPOP_FTP_USER` / `LOLIPOP_FTP_PASSWORD` として登録
2. 同じ画面の Variables に `DEPLOY_TARGET` = `lolipop` を登録（これがないとアップロードはスキップされます）
3. `docs/` に変更を push すると `deploy.yml` が、毎日の収集後は `collect.yml` が、`docs/` の中身をサーバーの `pubhtml/`（公開フォルダ）へ FTPS でアップロードします
4. 手元から手動で上げる場合は、FTP クライアントで `docs/` の中身を `pubhtml/` 直下にコピーするだけです（Node は不要）

## Radar の機能

## 機能

- **自動収集（日中は 2 時間おき）**
  - ゲームニュース: 4Gamer（総合 + PC）/ Game*Spark / Inside / GameBusiness.jp / 電ファミニコゲーマー（総合 + スマートフォンタグ）/ AppBank（ゲーム）/ Appliv Games の記事（発表・ティザー・周年・事前登録・配信開始など）にリンクされた公式サイト・特設サイト。公式サイトが無いスマホゲームは App Store / Google Play のページで代替。東京ゲームショウや CEDEC などイベントポータルへのリンクは、記事がそのイベント自体を扱っている場合を除き作品の公式サイトとして採用しません
  - AppBank / Appliv Games は 1 日あたり数件しか増えません。両媒体の記事の多くはランキング・攻略・まとめで、告知記事でも公式サイトへのリンクが無いものが大半のためです（2026-09 時点の実測: AppBank 40 件中 4 件、Appliv 10 件中 1 件が採用対象。しかもその多くは 4Gamer・電ファミと重複）
  - App Store（日本）: ゲームカテゴリのランキング（無料 / 有料 / セールス）のうち直近 45 日以内にリリースされたタイトル。公式サイト（開発元 URL）があればそちら、無ければ App Store ページ。`config.json` の `appstore.days` で期間を変更
  - ニュース系フィードは直近 100 件程度しか持たないため、GitHub Actions は JST 07/09/11/13/15/17/19/21 時の 2 時間おきに収集します（1 回あたり 10 秒前後）
  - 国内デザインギャラリー: MUUUUU.ORG / SANKOU! / I/O 3000 / Web Design Clip / 1guu / Responsive Web Design JP のうちゲーム関連のもの（エンタメ・ゲーム・特設サイト系カテゴリフィードも取得）
  - 4Gamer は RSS（100 件）に加えて HTML の一覧ページ（ニュース・スマホ・Switch・PC・事前登録情報）も読み、RSS に載らない記事を拾います。電ファミは総合に加え「スマートフォン」「事前登録」「新作」タグのフィードを読みます
  - 海外（Product Hunt / Hacker News / Launching Next / PitchWall / One Page Love / minimal.gallery）と国内デザインギャラリー 6 サイトは、ゲーム特化後は掲載への寄与がほぼ無かったため **既定で OFF** にしています（`sources.*` で再有効化可）。itch.io も OFF
  - **ゲーム特化フィルタ**（`focus`）: ニュース系と Product Hunt の Games 以外は、タイトル・見出し・説明・タグがゲーム関連キーワードに当たるものだけを残します
  - **掲載 URL の正規化と絞り込み**（`siteFilter`）: 下記参照

## 掲載する URL の方針（siteFilter）

記事や細かい更新のページではなく、**ゲームの公式サイト（作品トップ）だけ**を載せるための処理です。

1. **記事 URL をサイトのトップに寄せる**: `news` / `topics` / `press` / `blog` / `article` などのセグメントが現れたら、その手前までを掲載 URL にします。`https://umamusume.jp/news/detail.php?id=995` は `https://umamusume.jp/` に、`https://gundam-official.com/titles/rg-project/xarx-zero/news/detail/?id=x` は作品トップの `.../xarx-zero/` になります。`https://www.sega.jp/game/detail/kalanoro/` のような作品ページはそのまま残します。ストアページ（App Store / Google Play / Steam / itch.io）も個別ページのままにします。
2. **重複の統合**: `http`/`https`、`www` の有無、末尾の言語セグメント（`/ja-jp/` など）だけが違う URL は同じサイトとして 1 件にまとめます。
3. **ゲーム以外を除外**: EC・アパレル・飲料・アニメ制作会社・テレビ局・チケットなどのホスト（`excludeHosts`）、`news.` `press.` `support.` などのサブドメイン（`excludeHostPrefixes`）、ホスト名に `movie` / `film` / `museum` / `koubou` などを含むもの（`excludeHostPatterns`）を落とします。
4. **グッズ・アニメのみの記事を除外**: 見出しや説明が「一番くじ」「Tシャツ」「TVアニメ放送決定」「展覧会」などグッズ・アニメの話だけで、ゲームらしい語（Steam / Switch / 事前登録 / 配信開始 / DLC など）が無いものは載せません。リンク先がゲーム会社のドメイン（`gameHostPattern`）なら除外しません。
5. **海外ローンチ系の確認**: Show HN などの項目は、OGP の説明まで取得した時点でゲームらしい語が無ければ落とします（`requireGameSignalForLaunch`）。
6. **運営中タイトルの細かい更新を除外**: 「Ver.7.1 リリース」「新イベント開催」「ガチャ更新」のような、すでに運営中のゲームの更新記事は新着サイトではないため載せません（`updateOnlyWords`）。ただし「新作」「発表」「ティザー」「事前登録」「◯周年」など新規性を示す語があれば残します（`noveltySignals`）。
7. **古い記事の除外**: 公開から `maxArticleAgeDays`（既定 90 日）を過ぎた記事由来の項目は取り込みません。更新が止まったフィードが過去記事を返してくることがあるためです（Inside のスマホ向け RSS は 2022 年で更新が止まっていたため収集元から外しました）。

除外された項目は `data/last-run.json` の `offTopicItems` に理由付きで記録されるので、行き過ぎた除外がないか確認できます。`siteFilter.enabled` を `false` にすると全て無効になります。
- **種類別カテゴリ**: ティザー・カウントダウン / 事前登録・予約 / 周年・記念 / 特設・キャンペーン / イベント・大会・eスポーツ / 配信・発売 / インディー・個人開発 / ブラウザ・Web ゲーム / ゲーム会社・採用 / メディア・コミュニティ・ツール / グッズ・ストア / 公式サイト（該当なしの既定）
- **機種（プラットフォーム）フィルタ**: Switch / PlayStation / Xbox / PC・Steam / スマホ / ブラウザ / アーケード / VR を見出し・説明から検出
- **サムネイル・説明文は OGP のみ**: 各サイトが共有用に公開している `og:image` を参照（複製・保存はしない）、説明文は `og:description` を 120 字まで。ニュース記事の見出しはカード下部に 1 行、記事へのリンク付きで表示
- **国内 / 海外フィルタ**: `.jp` ドメイン・国内収集元・ページ言語で判定。カードに「JP」バッジ
- **アダルト系の除外**: キーワード（英・日）・TLD・ホスト（DLsite / FANZA など）のブロックリスト
- **お気に入り**: ブラウザの localStorage に保存（サーバー送信なし）。JSON の書き出し・読み込み可
- **UI**: ヒーロー＋統計、検索・期間・地域・機種・収集元・並び順、24 件ごとのページネーション、右下「先頭へ戻る」、ダークモード対応

## セットアップ

Node.js **20 以上**が必要です（依存パッケージはありません）。

```bash
node -v         # v20 以上を確認
```

`npm start` で `EADDRINUSE` が出る場合は、前に起動したサーバーが残っています。`netstat -ano | findstr :3210` で PID を調べて `taskkill /PID <PID> /F` で止めてから起動し直してください。

## 使い方

```bash
# 収集を 1 回実行 → docs/radar/data/sites.json を更新
npm run collect

# ローカル確認（http://localhost:3210、docs/ を配信）。毎日 07:00 に自動収集
npm start
```

## GitHub Pages で公開する

1. リポジトリを作成して push（`docs/` と `data/state.json` を含める）
2. Settings → Pages → Source を **Deploy from a branch**、Branch を `main` / `/docs` に設定
3. `.github/workflows/collect.yml` が JST 07 時〜21 時の 2 時間おきに収集して `docs/radar/data/sites.json` をコミットします（Actions の書き込み権限が必要: Settings → Actions → General → Workflow permissions → Read and write）
4. `config.json` の `site.contactUrl` に問い合わせ先（GitHub Issues の URL など）を入れると、フッターにリンクが出ます

GitHub Actions の IP からは Product Hunt のリダイレクト解決（Cloudflare）が通らない可能性が高く、その場合 Product Hunt の項目は増えません。他の収集元は問題なく動きます。

## 設定（config.json）

| キー | 内容 |
| --- | --- |
| `site.title` / `tagline` / `contactUrl` / `contactLabel` | サイト名・リード文・問い合わせ先 |
| `port` / `host` / `schedule.*` | ローカルサーバーと日次収集の設定 |
| `retentionDays` | 一覧に残す日数（既定 60 日） |
| `meta.*` | OGP 取得の 1 回あたり上限・並列数・タイムアウト・説明文の長さ |
| `focus.enabled` / `focus.keywords` | ゲーム特化フィルタの ON/OFF とキーワード（正規表現）。OFF にすると汎用の新着サイト収集に戻る |
| `platforms[]` | 機種の検出ルール（`pattern` は正規表現） |
| `defaultCategoryBySourceKind` | どのカテゴリにも当たらないときの既定（news / gallery → 公式サイト、launch → インディー） |
| `sources.*` | 収集元ごとの ON/OFF |
| `producthunt.*` | カテゴリフィード、リダイレクト解決の間隔・上限（後述） |
| `hackernews.excludeHosts` | Show HN から除外するホスト（GitHub など） |
| `blocklist.words` / `tlds` / `hosts` | 除外キーワード / TLD / ホスト |
| `categories[]` | カテゴリ定義。`ph`（PH カテゴリ）→ `tags`（フィードのタグ）→ `keywords`（正規表現）の順で判定 |

ブロックされた項目は `data/last-run.json` の `blockedItems` に記録されます（非公開）。

### Product Hunt について

フィードに実サイトの URL が含まれないため `producthunt.com/r/p/ID` のリダイレクトを辿りますが、Cloudflare のボット判定で 403 になりやすいです。未解決の投稿だけを `resolveDelayMs`（既定 2 秒）間隔で `maxResolvePerRun`（既定 60 件）まで逐次解決し、`data/source-cache.json` にキャッシュします。3 回連続で拒否されたらその回は中断します。解決できた投稿だけを一覧に載せます。

## ディレクトリ

```
newsites/
  config.json            設定
  server.mjs             ローカル確認用サーバー + 日次スケジューラ
  scripts/
    collect.mjs          収集本体
    test-source.mjs      収集元を 1 つだけ試す開発ツール（node scripts/test-source.mjs 4gamer 10）
    lib/sources.mjs      収集元ごとの取得処理
    lib/meta.mjs         OGP 取得
    lib/filter.mjs       除外フィルタ
    lib/categorize.mjs   カテゴリ判定
    lib/xml.mjs          RSS/Atom パーサ（依存なし）
  docs/                  公開ディレクトリ（サイトルート）
    index.html           トップページ、assets/top.css・top.js、data/site.json
    radar/               Radar（index.html / app.js / style.css / data/sites.json）
  data/                  state.json（内部状態、コミット対象） / last-run.json / source-cache.json（非公開）
  .github/workflows/     日次収集の GitHub Actions
```

## 収集元を追加する

`scripts/lib/sources.mjs` に関数を追加し、`SOURCES` に登録して `config.json` の `sources` に ON/OFF を追加します。

```js
{ source, sourceKind: "launch" | "gallery" | "news", region?: "jp", sourceUrl, url, title, description, publishedAt, tags, phCategories, points }
```

WordPress 系の国内ギャラリーは `JP_GALLERIES`、ゲームニュースは `GAME_NEWS` にエントリを足すだけで追加できます。

## 検証したが使えなかった収集元（2026-09 時点）

- betalist / awwwards / land-book / lapa.ninja / indiehackers / uneed / godly / bookma / ikesai / 4db / S5-Style / straightline / ファミ通 / Gamer / gamebiz / GameWith: フィード廃止または HTML のみ
- siteinspire: 掲載ページが常に 429
- lp-web.com: 掲載ページに実サイトへのリンクなし
- PR TIMES: フィードは直近 200 件（約 40 分分）のみでジャンル絞り込み不可
- AUTOMATON / GAME Watch / IGN Japan / Gematsu / Siliconera / Nintendo Life / AppBank / indiegamesjp: フィードはあるが記事内に「公式サイト」と明示されたリンクがなく、抽出できない
- 電撃オンライン / ファミ通 / Gamer / gamebiz / GameWith / Game8 / 4Gamer のジャンル別: フィードなし
- Steam newreleases.xml: 古いニュースしか流れない
- AniList API: 403、reddit: 429 が頻発
