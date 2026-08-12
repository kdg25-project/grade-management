# SANSUN学園 成績管理システム

Cloudflare Workers Static Assets、Hono、D1、およびVite React SPAで構成するBun workspacesモノレポです。単一Workerが`/api/*`をHonoへ、その他のURLをSPAへ配信します。Nginx、Docker、PostgreSQLは使用しません。

## 構成

- `apps/web`: Vite + React Router SPA。既存の講師向けプロトタイプ画面を提供します。
- `apps/api`: Hono WorkerとBetter Auth。`/api/health`、`/api/auth/*`を提供します。
- `packages/db`: Drizzle SQLite schema とD1 migration。

## ローカル開発

```bash
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
# .dev.vars の BETTER_AUTH_SECRET を32文字以上のランダム値に変更
bun run db:migrate
bun run dev
```

`bun run dev`はCloudflare Vite pluginによるWorkers開発サーバーを起動します。`http://localhost:5173`を開き、`/api/health`またはSPAの深いURL（例: `/teacher/subjects/math-1/grades`）を確認できます。ローカルは`EMAIL_DELIVERY_ENABLED=false`のため、再設定メールは実送信せず、受信者だけを構造化ログへ疑似出力します。URLやトークンはログに出力しません。

### 旧ローカル状態からの移行

この手順は、旧PostgreSQL構成から移行する**開発者だけ**に必要です。過去のWrangler開発キャッシュに旧migration名が残っていると、D1の初期migrationと衝突します。本番D1や共有データには使わないでください。

開発サーバーを停止してから、存在するローカルキャッシュを任意の退避先へ移動するか、不要であることを確認して削除し、その後に`bun run db:migrate`を実行します。例えば、退避する場合は次のようにします。

```bash
mv .wrangler .wrangler.pre-d1-migration
mv apps/web/.wrangler apps/web/.wrangler.pre-d1-migration
bun run db:migrate
```

各ディレクトリが存在するときだけ実行してください。これらはgit管理外の開発用キャッシュであり、グリーンフィールドのD1 migrationが適用済みの環境では通常手順にこの作業は不要です。

## D1とCloudflareの初期設定

実アカウントを変更するコマンドは、このリポジトリでは実行しません。運用担当者は以下を実行してください。

```bash
wrangler d1 create grade-management
# 表示された database_id を wrangler.jsonc の database_id へ設定
wrangler d1 migrations apply grade-management --remote
wrangler secret put BETTER_AUTH_SECRET
bun x wrangler deploy
```

`wrangler.jsonc`の`BETTER_AUTH_URL`と`BETTER_AUTH_TRUSTED_ORIGINS`は、カスタムドメインを設定したらそのHTTPS originへ更新してください。`EMAIL_FROM`と`send_email.allowed_sender_addresses`も、実際にオンボーディング済みの送信元へそろえ、実送信する本番環境でだけ`EMAIL_DELIVERY_ENABLED`を`"true"`へ変更します。Cloudflare Email Sendingはドメインオンボーディングが必要で、送信にはPaid Workersプランが必要です。`wrangler.jsonc`内のID・送信元は安全なplaceholderであり、そのまま本番へdeployできません。

## コマンド

```bash
bun run test
bun run typecheck
bun run build
bun run db:generate
bun run db:migrate        # local D1のみ
bun run admin:create -- --name "専任職員名" --email staff@example.com
bun run deploy:dry-run    # buildとrootの自動redirect生成後に検証
bun run deploy            # 実行前にD1 ID/Email/secretを設定
```

Vite pluginは静的assetのdirectoryをbuild時に生成済みWrangler configへ注入します。build scriptはそのconfigへのredirectをrootの`.wrangler/deploy/config.json`にも生成するため、rootからの`wrangler deploy`が自動的に生成configを使います。dry-runにも`wrangler.jsonc`や生成configを直接指定せず、上記の`bun run deploy:dry-run`を使用してください。

### 専任職員アカウントの作成

サインアップは無効です。初回の専任職員（`role=admin`）は、運用担当者がローカルCLIから作成します。

```bash
# 開発用local D1（既定）
bun run admin:create -- --name "成績管理担当" --email staff@example.com

# 本番のリモートD1（確認に y と入力）
bun run admin:create -- --name "成績管理担当" --email staff@example.com --remote

# CIなどで、リモートD1への作成を明示的に承認する場合だけ
bun run admin:create -- --name "成績管理担当" --email staff@example.com --remote --yes
```

パスワードは引数で指定できません。成功時にだけ強い一時パスワードが1回表示されるため、本人へ安全な経路で渡し、受領後すぐに変更するよう運用してください。アカウントには`mustChangePassword=true`を登録しますが、現時点のWeb/APIにはその変更を強制するガードは未実装です。`--remote`は実データを変更するため、対象のCloudflareアカウントとD1データベースを必ず確認してください。

### Cloudflare Workers Builds

CloudflareダッシュボードのWorkers Buildsでは、次のコマンドを設定します。

- Build command: `bun run build`
- Deploy command: `bun x wrangler deploy`

Viteのroot（`apps/web`）配下で生成されるredirectだけでなく、build時にリポジトリrootの`.wrangler/deploy/config.json`も生成されます。そのため、ダッシュボードの既定のroot deployからでも静的assetを含むWorkers設定を自動検出できます。

## 認証とパスワード再設定

Better Auth 1.6.23のDrizzle SQLite adapterをD1へ接続します。サインアップは無効、リセットトークンは30分、セッションは600秒/更新間隔60秒です。パスワードリセット後は既存セッションをrevokeします。再設定申請画面はアカウントの有無を表示しません。

業務の成績データと確定処理は、現時点では画面確認用プロトタイプのままです。D1の複数操作を業務で追加する際は、`D1Database.batch()`と一意な冪等性キーを使い、論理的な一括処理を保護してください。
