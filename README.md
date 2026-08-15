# SANSUN学園 成績管理システム

Cloudflare Workers Static Assets、Hono、D1、Better Auth、Vite React SPAをBun workspacesで運用する成績管理システムです。単一Workerが`/api`と`/api/*`をHonoへ、それ以外（`/apiary`を含む）をSPAへ配信します。Nginx、Docker、PostgreSQLは使用しません。

## 実装済み機能

- Better Authによる専任職員・講師ログイン、初回パスワード変更、リセット、単一セッション
- 講師の担当科目・現在学期の成績入力、正確な整数分子による評価計算
- 専任職員による年度/学生/講師/科目管理、学期確定・再開、監査履歴
- 年度更新ウィザード、個別通常CSV取込、成績CSV/PDF出力
- owner-bound TTL snapshot、D1 batch、idempotency keyによる一括処理保護

PDF出力はCloudflare Browser Runの`BROWSER` bindingで実装済みです。A4横向きの帳票を生成し、確認時点のowner-bound TTL snapshotを一度だけ出力します。

## ローカル開発

```bash
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
# BETTER_AUTH_SECRET を32文字以上のローカル専用ランダム値に変更
bun run db:migrate
bun run dev:seed       # 任意: 画面確認用fixtureをlocal D1へ作成
bun run dev
```

`.dev.vars`はCloudflare Vite pluginが読み込み、`wrangler.jsonc`の本番varsをローカル専用値で上書きします。テンプレートにはlocalhostのBetter Auth URL/trusted origin、`no-reply@example.invalid`、`EMAIL_DELIVERY_ENABLED=false`を設定済みです。`BETTER_AUTH_SECRET`だけをローカル専用の32文字以上の値に変更してください。

`http://localhost:5173`を開きます。開発serverでは`/api/health`、`/apiary`、`/teacher/subjects`のようなdeep SPA routeも確認できます。`dev:seed`は**local D1専用**で、初回だけ開発admin/teacherの一時パスワードを出力します。2回目以降は既存アカウントを保持し、パスワードを再表示しません。共有環境やremote D1には使用できません。

`admin:create`と`dev:seed`はVite開発serverと同じlocal D1を操作します。SQLite lockを避けるため、実行時は`bun run dev`を停止してください。

ローカルでは`EMAIL_DELIVERY_ENABLED=false`です。パスワード再設定要求は送信成功と同じ経路でシミュレートされますが、実メールは送信せず、メール本文・URL・tokenをログに出力しません。

## コマンド

```bash
bun run test
bun run typecheck
bun run build
bun run db:generate
bun run db:migrate          # Vite開発serverが使うlocal D1へ適用
bun run dev:seed            # local fixtureのみ
bun run admin:create -- --name "専任職員名" --email staff@example.com
bun run deploy:dry-run
bun run validate:production # 本番設定だけを安全に検査
```

## ローカルE2E smoke

```bash
bun run e2e:test
```

このコマンドは、通常の開発用D1とは別の`apps/web/.wrangler/e2e-state`だけを削除・再作成し、migrationと最小fixtureを適用してから、Chromiumでログイン、初回パスワード変更、成績保存、学期確定・再開を順番に確認します。実行中は`4173`番ポートを専有するため、同じポートのserverを止めてください。生成される`.dev.vars.e2e`と`e2e/.credentials.json`はgit ignoreされ、E2E用の一時secret/パスワードを含みます。

このsmokeはローカルWorkerとD1の回帰検知用です。通常画面応答3秒・成績反映10秒をローカルで確認しますが、本番のSLA証跡ではありません。PDFはBrowser Run bindingを利用するため、ローカルE2Eには含めていません。

`bun run deploy:dry-run`はbuild後に生成されるWrangler redirectを使います。`wrangler.jsonc`や生成configを直接指定せず、このscriptを使ってください。

## Cloudflare初期設定とdeploy順序

実アカウントを変更するコマンドはCIまたは運用担当者だけが実行してください。

`wrangler.jsonc`には本番Worker origin（`https://grade-management.tah5882.workers.dev`）、認証済み送信元（`no-reply@grade-management.tah5882.dev`）、Email Sending有効化、Cloudflare account、既存D1 ID、R2 bucket（`grade-management-backups`）を設定済みです。remote D1にはmigration `0000`〜`0011`を適用済みで、migration前のR2 backup objectも確認済みです。`BETTER_AUTH_SECRET`は登録済みsecretであり、設定ファイルには保存しません。

`D1_REST_API_TOKEN`は未登録で、安全な作成が保留中です。このtokenがない間にD1 exportが失敗しないよう、`DailyBackupWorkflow`のbinding/classは維持しつつ自動scheduleを無効化しています。
通常の成績管理画面やD1バインディングによる読み書きに、このtokenは必要ありません。日次D1バックアップのscheduleを有効化する場合だけ必要です。

1. Cloudflare dashboardで、account scopeのD1 Read権限だけを持つAccount API Tokenを作成します。
2. 運用担当者が `wrangler secret put D1_REST_API_TOKEN` でtokenを登録します。
3. `wrangler.jsonc`の`DAILY_BACKUP_WORKFLOW`に `"schedules": ["0 17 * * *"]` を戻し、`bun run deploy:dry-run`と`bun run validate:production`を通してからdeployします。

## 日次D1バックアップ

`DailyBackupWorkflow` はD1 export APIをpolling形式で実行し、R2へ `daily/YYYY-MM-DD/<scheduled Unix seconds>.sql` として保存します。R2 objectが既にある場合は再ダウンロードせず、D1には日時・object key・bookmark hash・etag・sizeだけを記録します。token、signed URL、raw bookmark、SQL内容はD1/ログへ保存しません。現在は`D1_REST_API_TOKEN`未登録のためscheduleを無効化しており、上記のtoken登録後に毎日 `0 17 * * *`（UTC、JST翌日02:00）へ戻します。

Cloudflare D1 Time Travelは短期の復旧手段（プランにより7日または30日）であり、日次R2 backupの代替ではありません。R2 backupの30年保管方針はユーザー判断により保留中です。R2 lifecycleと削除期間は運用担当が別途決定し、このアプリはR2 object・`backup_runs`の削除を実装しません。

復旧時は、(1) 対象R2 objectを確認、(2) 新しいD1 databaseへimport、(3) migrationとアプリを検証、(4) bindingを切り替える順に行います。既存D1への上書きrestoreは行いません。四半期ごとを目安にrestore drillを実施し、RTO 24時間以内の結果・証跡を運用記録へ残してください。

Vite buildはStatic Assets directoryを生成Wrangler configへ注入し、rootの`.wrangler/deploy/config.json`へredirectも作成します。そのためCloudflare Workers Buildsは以下で構成します。

- Build command: `bun run build`
- Deploy command: `bun run validate:production && bun x wrangler deploy`

## 専任職員アカウント

サインアップは無効です。最初の専任職員はCLIで作成します。

```bash
# local D1
bun run admin:create -- --name "成績管理担当" --email staff@example.com

# remote D1（対話確認あり）
bun run admin:create -- --name "成績管理担当" --email staff@example.com --remote
```

パスワードは引数で指定できず、成功時だけ一度表示されます。安全な経路で本人へ渡し、初回ログイン時に変更させてください。`--remote --yes`はCIなど明示的に非対話承認できる場合だけ使用します。

## CSV運用上の注意

通常CSV取込と年度更新は別機能です。通常取込は学生・講師・専任職員・科目の**いずれか1種類**を選び、確認snapshotとidempotency keyで個別に反映します。科目CSVは画面で対象学年（1〜3年）を選択します。CSVはUTF-8、600KB/1,000行までです。学生CSVに載っていない学生は削除・退学・更新しません。

実サンプルと同じ正確なheaderを使用してください。学生は`学籍番号,氏名,氏名（ひらがな）,年齢,生年月日,性別,メールアドレス,電話番号,郵便番号,住所,専攻`（生年月日は`2004年11月19日`形式）、講師・専任職員は`氏名,氏名（ひらがな）,年齢,性別,メールアドレス`、科目は`専攻,科目名,担当講師`です。

CSV取込で新規利用者を作る場合、一時パスワードは成功レスポンス/画面で**一度だけ**返ります。監査、idempotency result、snapshotには保存しません。通信切断などで受領に失敗した場合は、既存の管理者によるパスワード再設定手順で対応してください。画面表示した一時パスワードCSVは安全な場所へ保存し、端末に残さないでください。

成績出力は、年度・全学生、直近3年度、前年度、確定済み累計3年度、年度・学期別の5パターンと専攻・学年・科目の絞り込みを共通で使います。確定済みの最新受験成績行だけを対象にし、確認時点のowner-bound TTL snapshotをCSVまたはPDFで一度だけ出力します。CSVは10,000行・5MBで上限を設け、Excel formula injectionを防ぐエスケープを行います。PDFはCloudflare Browser Runの`BROWSER` bindingでA4横向きに生成します。remote Browser Runでの実PDF smokeは2.632秒でしたが、本番SLAの証跡ではありません。ローカル開発ではQuick Actionを利用できないためモック検証のみを行い、deploy後に本番環境で出力確認してください。

## バックアップ・復旧

deploy前にremote D1をexport/backupし、migration SQLをレビューしてください。D1 migrationは原則前進のみです。アプリ不具合時はWorkerを直前のversionへrollbackできますが、既に適用したDB migrationを自動で戻してはいけません。復旧はbackupから別D1へ復元して検証後に切り替える手順を運用担当が実施します。個人情報を含むCSV、D1 export、ログをissueやgitへ保存しないでください。

## 検証

```bash
bun run test
bun run typecheck
bun run build
bun run db:generate
bun run db:migrate
bun run deploy:dry-run
```

通常画面応答3秒、成績反映10秒、PDF生成10秒、CSV処理1分を目標とします。D1の一括処理はrowごとのstatementを避け、JSON1集合SQLと上限でWorker/D1 budgetを保護します。
