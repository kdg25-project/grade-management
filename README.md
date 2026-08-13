# SANSUN学園 成績管理システム

Cloudflare Workers Static Assets、Hono、D1、Better Auth、Vite React SPAをBun workspacesで運用する成績管理システムです。単一Workerが`/api`と`/api/*`をHonoへ、それ以外（`/apiary`を含む）をSPAへ配信します。Nginx、Docker、PostgreSQLは使用しません。

## 実装済み機能

- Better Authによる専任職員・講師ログイン、初回パスワード変更、リセット、単一セッション
- 講師の担当科目・現在学期の成績入力、正確な整数分子による評価計算
- 専任職員による年度/学生/講師/科目管理、学期確定・再開、監査履歴
- 年度更新ウィザード、個別通常CSV取込、成績CSV出力
- owner-bound TTL snapshot、D1 batch、idempotency keyによる一括処理保護

PDFの帳票レイアウトは未確定のため、PDF出力は実装・固定していません。

## ローカル開発

```bash
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
# BETTER_AUTH_SECRET を32文字以上のローカル専用ランダム値に変更
bun run db:migrate
bun run dev:seed       # 任意: 画面確認用fixtureをlocal D1へ作成
bun run dev
```

`http://localhost:5173`を開きます。開発serverでは`/api/health`、`/apiary`、`/teacher/subjects`のようなdeep SPA routeも確認できます。`dev:seed`は**local D1専用**で、初回だけ開発admin/teacherの一時パスワードを出力します。2回目以降は既存アカウントを保持し、パスワードを再表示しません。共有環境やremote D1には使用できません。

`admin:create`と`dev:seed`はVite開発serverと同じlocal D1を操作します。SQLite lockを避けるため、実行時は`bun run dev`を停止してください。

ローカルでは`EMAIL_DELIVERY_ENABLED=false`です。再設定メールは送信せず、メール本文・URL・tokenをログに出力しません。

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

`bun run deploy:dry-run`はbuild後に生成されるWrangler redirectを使います。`wrangler.jsonc`や生成configを直接指定せず、このscriptを使ってください。

## Cloudflare初期設定とdeploy順序

実アカウントを変更するコマンドはCIまたは運用担当者だけが実行してください。

1. `wrangler d1 create grade-management`後、表示されたIDを`wrangler.jsonc`へ設定します。
2. `wrangler d1 migrations apply grade-management --remote --config wrangler.jsonc`で**先に**remote D1 migrationを適用します。
3. `wrangler secret put BETTER_AUTH_SECRET`で32文字以上のsecretを登録します。
4. Cloudflare Email Sendingで送信domain/addressをonboardし、`EMAIL_FROM`・`send_email.allowed_sender_addresses`・`EMAIL_DELIVERY_ENABLED`を本番値へ更新します。Email Sendingの本番送信には適切なWorkers planが必要です。
5. `bun run deploy:dry-run`を通し、`bun run validate:production`で本番用のURL・メール・D1 bindingを検査してから`bun run deploy`します。

`BETTER_AUTH_URL`と`BETTER_AUTH_TRUSTED_ORIGINS`は、本番ではlocalhostを含まないHTTPS originへ変更します。`EMAIL_FROM`は`.invalid`でない認証済みsenderにし、`send_email.allowed_sender_addresses`にも同じ値を登録、`EMAIL_DELIVERY_ENABLED=true`へ変更します。`bun run validate:production`はこれらとD1 IDを検査します。`BETTER_AUTH_SECRET`はWrangler secretのため設定ファイルからは検査できず、deploy前に `wrangler secret put BETTER_AUTH_SECRET` を確認してください。

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

成績CSV出力は確定済み成績行のみを対象にし、10,000行・5MBで上限を設けています。Excel formula injectionを防ぐエスケープを行います。

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

通常画面応答3秒、成績反映10秒、CSV処理1分を目標とします。D1の一括処理はrowごとのstatementを避け、JSON1集合SQLと上限でWorker/D1 budgetを保護します。
