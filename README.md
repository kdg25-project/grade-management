# SANSUN学園 成績管理システム

Bun workspacesで管理するNext.js + Honoのモノレポです。外部からのアクセスはNginxを入口とし、`/api/*` をHonoへ、それ以外をNext.jsへ転送します。

## 構成

- `apps/web`: Next.js App Router
- `apps/api`: Bun上で動作するHono API
- `packages/db`: Drizzle ORM / PostgreSQL
- `infra/nginx`: リバースプロキシ設定

## ローカル開発

```bash
cp .env.example .env
bun install
docker compose up -d postgres
bun run db:migrate
bun run dev
```

PostgreSQLは既定でホストの `localhost:5432` に公開され、`.env` の `DATABASE_URL` から接続できます。ホスト開発ではPostgreSQL起動後にmigrationを適用してください。Webは `http://localhost:3000`、APIは `http://localhost:3001/api/health` で起動します。Nginxを含む全サービスを使う場合は `docker compose up --build` を実行し、`http://localhost:8080` を開いてください。Composeでは`migrate`サービスがPostgreSQLの準備完了後にmigrationを適用し、成功した場合だけAPIを起動します。ホスト側の5432番ポートを使用中の場合は、`.env` の `POSTGRES_PORT` と `DATABASE_URL` のポートを同じ値へ変更してください。

## コマンド

```bash
bun run test
bun run typecheck
bun run build
bun run db:generate
bun run db:migrate
```

依存関係の再現性を保つため、パッケージのバージョンは固定し、コンテナ内では `bun install --frozen-lockfile` を使用します。

## 認証

Better Authのメールアドレス・パスワード認証はHonoの`/api/auth/*`で提供します。自己サインアップは無効です。`.env`の`BETTER_AUTH_SECRET`は、開発を開始する前に32文字以上のランダムな値へ必ず置き換えてください。

現段階では初期管理者の払い出し、パスワードリセットメールの配送、単一セッション制限は未実装です。管理者または講師アカウントを利用するには、別途安全な初期登録手段を実装する必要があります。
