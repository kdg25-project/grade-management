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
bun run dev
```

PostgreSQLは既定でホストの `localhost:5432` に公開され、`.env` の `DATABASE_URL` から接続できます。Webは `http://localhost:3000`、APIは `http://localhost:3001/api/health` で起動します。Nginxを含む全サービスを使う場合は `docker compose up --build` を実行し、`http://localhost:8080` を開いてください。ホスト側の5432番ポートを使用中の場合は、`.env` の `POSTGRES_PORT` と `DATABASE_URL` のポートを同じ値へ変更してください。

## コマンド

```bash
bun run test
bun run typecheck
bun run build
bun run db:generate
bun run db:migrate
```

依存関係の再現性を保つため、パッケージのバージョンは固定し、コンテナ内では `bun install --frozen-lockfile` を使用します。
