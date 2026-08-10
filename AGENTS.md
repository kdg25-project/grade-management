# SANSUN学園 成績管理プロジェクト指針

## 概要と正本

SANSUN学園の成績管理システム。Bun workspacesで`apps/web`(Vite React SPA)、`apps/api`(Hono Cloudflare Worker)、`packages/db`(Drizzle ORM/D1)を管理する。単一Cloudflare Workers Static Assets deploymentが`/api`をHono、それ以外をSPAへ送る。

正本は、最新のユーザー指示、[Notion設計書](https://www.notion.so/39071dd9822680d1a1d0f0ca24190a29)、その「要ヒアリング」を補完する[Google Docs](https://docs.google.com/document/d/1w8hqH-rOxjK-6K1TMJVXxI1zRHiqpJi2_-stpItttQM/edit?usp=sharing)の順で優先する。業務ロジック、権限、成績計算、CSV、年度更新に触れる前に`$grade-management-domain`を読む。外部仕様の全文や秘密情報は転記しない。

## 開発とCloudflare

```bash
bun install --frozen-lockfile
bun run dev
bun run test
bun run typecheck
bun run build
bun run db:generate
bun run db:migrate
bun run deploy:dry-run
```

`cp .dev.vars.example .dev.vars`後に`bun run db:migrate`、`bun run dev`でlocal D1とWorker/Vite開発環境を起動する。既定は`http://localhost:5173`。

## 実装規約

- TypeScriptの型を保ち、既存の構成と命名に従い、変更を必要最小限にする。
- Honoのルート連鎖から`AppType`をexportし、Vite SPAは同一origin `/api`に対して`hc<AppType>`のHono RPCを使う。
- DBスキーマは`packages/db`に集約し、変更時はD1 migrationを生成する。CSVはD1 `batch()`と一意な冪等性キーで保護する。
- 認証はBetter AuthをAPIに統合し、Webは`auth-client`を使う方針。Worker bindingはrequest scopeで読む。未確定仕様を独自に固定しない。
- `.env`、資格情報、トークン、個人情報をコミットしない。既存のユーザー変更と無関係な差分は編集・破棄しない。

## 作業と完了条件

非トリビアルな変更は`scout`の調査→`coder`の実装→独立した`reviewer`の検証とする。公式仕様は`docs-researcher`が一次資料を調査する。変更に応じたテストを追加し、完了前に`$verify-monorepo`でtest、typecheck、build、local D1 migration、Workers dry-runを検証する。失敗を隠したり、無関係な既存差分を修正したりしない。コミットや破壊的操作は明示依頼時のみ行う。
