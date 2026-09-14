# Game Sites Radar

新しく公開されたゲーム関連の Web サイト（公式サイト・ティザー・特設キャンペーン・周年・イベント・インディーゲームなど）を自動収集し、種類別に一覧表示する静的サイトです。`docs/` をそのまま GitHub Pages などに置いて公開できます。

## 機能

- **自動収集（1日1回）**
  - ゲームニュース: 4Gamer / Game*Spark / Inside / GameBusiness.jp / 電ファミニコゲーマー の記事（発表・ティザー・周年・事前登録・配信開始など）にリンクされた公式サイト・特設サイト
  - 国内デザインギャラリー: MUUUUU.ORG / SANKOU! / I/O 3000 / Web Design Clip / 1guu / Responsive Web Design JP のうちゲーム関連のもの（エンタメ・ゲーム・特設サイト系カテゴリフィードも取得）
  - 海外: Product Hunt の Games カテゴリ / Hacker News (Show HN) / Launching Next / PitchWall / One Page Love / minimal.gallery のうちゲーム関連のもの。itch.io の新着は `sources.itchio: true` で有効化
  - **ゲーム特化フィルタ**（`focus`）: ニュース系と Product Hunt の Games 以外は、タイトル・見出し・説明・タグがゲーム関連キーワードに当たるものだけを残します
- **種類別カテゴリ**: ティザー・カウントダウン / 事前登録・予約 / 周年・記念 / 特設・キャンペーン / イベント・大会・eスポーツ / 配信・発売 / インディー・個人開発 / ブラウザ・Web ゲーム / ゲーム会社・採用 / メディア・コミュニティ・ツール / グッズ・ストア / 公式サイト（該当なしの既定）
- **機種（プラットフォーム）フィルタ**: Switch / PlayStation / Xbox / PC・Steam / スマホ / ブラウザ / アーケード / VR を見出し・説明から検出
- **サムネイル・説明文は OGP のみ**: 各サイトが共有用に公開している `og:image` を参照（複製・保存はしない）、説明文は `og:description` を 120 字まで。ニュース記事の見出しはカード下部に 1 行、記事へのリンク付きで表示
- **国内 / 海外フィルタ**: `.jp` ドメイン・国内収集元・ページ言語で判定。カードに「JP」バッジ
- **アダルト系の除外**: キーワード（英・日）・TLD・ホスト（DLsite / FANZA など）のブロックリスト
- **お気に入り**: ブラウザの localStorage に保存（サーバー送信なし）。JSON の書き出し・読み込み可
- **UI**: ヒーロー＋統計、検索・期間・地域・機種・収集元・並び順、24 件ごとのページネーション、右下「先頭へ戻る」、ダークモード対応

## セットアップ

```bash
npm install     # 依存パッケージはありません（Node 20 以上）
```

## 使い方

```bash
# 収集を 1 回実行 → docs/data/sites.json を更新
npm run collect

# ローカル確認（http://localhost:3210、docs/ を配信）。毎日 07:00 に自動収集
npm start
```

## GitHub Pages で公開する

1. リポジトリを作成して push（`docs/` と `data/state.json` を含める）
2. Settings → Pages → Source を **Deploy from a branch**、Branch を `main` / `/docs` に設定
3. `.github/workflows/collect.yml` が毎日 JST 07:00 に収集して `docs/data/sites.json` をコミットします（Actions の書き込み権限が必要: Settings → Actions → General → Workflow permissions → Read and write）
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
  docs/                  公開ディレクトリ（index.html / app.js / style.css / data/sites.json）
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
