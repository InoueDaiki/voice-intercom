# voice-intercom

翻訳つきのボイスインカムアプリ。設計は [docs/設計メモ.md](docs/設計メモ.md) を参照。

## 構成

| パス | 内容 | 開発する場所 |
| --- | --- | --- |
| `apps/mobile` | Flutter アプリ(iOS / Android) | ホスト |
| `apps/admin` | 管理コンソール(Vite + React) | devContainer |
| `services/agent` | LiveKit Agent(Python) | devContainer |
| `services/api` | API Gateway + Lambda(Python) | devContainer |
| `proto/` | データチャネルで流すメッセージの定義(Protobuf) | devContainer |
| `packages/schema/{python,ts,dart}` | `proto/` から生成した型。生成物もコミットする | 生成は devContainer |
| `infra/` | Terraform(`envs/dev`、`envs/prod`。同じ AWS アカウントで名前を分ける) | devContainer |

## セットアップ

### ホスト(Apple Silicon の Mac)

1. Docker Desktop と [mise](https://mise.jdx.dev) を入れる(`brew install mise`)。
2. `cp .env.example .env` を実行し、`DEV_HOST` と `OIDC_ISSUER` をホストの LAN の IP に書き換える。
3. `mise install` を実行する(ローカルの LiveKit サーバー用)。Flutter を使うときは `apps/mobile` でも `mise install` を実行する。
4. Flutter の iOS ビルドには Xcode が必要。初回は `sudo xcodebuild -license` で同意しておく。

### devContainer

VS Code で「Reopen in Container」を選ぶ。初回に `.devcontainer/post-create.sh` が、ツールと依存関係(`uv sync`、`pnpm install`)を入れる。

## よく使うコマンド

| コマンド | 内容 | 実行する場所 |
| --- | --- | --- |
| `mise run gen` | proto から Python / TypeScript / Dart の型を生成する | devContainer |
| `mise run lint` | buf lint、ruff、pyright、tsc | devContainer |
| `mise run fmt` | 整形 | devContainer |
| `mise run test` | pytest | devContainer |
| `mise run livekit` | ローカルの LiveKit サーバーを起動する(`--dev`、LAN に公開) | ホスト |

## ローカルの認証(模擬 OIDC サーバー)

本番は Cognito を標準の OIDC(認可コード + PKCE)で使う。ローカルでは、devContainer と一緒に起動する [mock-oauth2-server](https://github.com/navikt/mock-oauth2-server) に差し替える。

- issuer: `http://${DEV_HOST}:8090/default`(探索用の URL は `/.well-known/openid-configuration`)
- ログイン画面では任意のユーザー名と claims を入力できる。Cognito に寄せた claims の例:

  ```json
  { "cognito:groups": ["admin"], "token_use": "access", "client_id": "mobile" }
  ```

- client credentials(Agent から API を呼ぶとき)では、Cognito のアクセストークンと同じ形(`client_id`、`token_use`、`scope`)の claims を返す。設定は [.devcontainer/mock-oidc.json](.devcontainer/mock-oidc.json)。
- トークンの `iss` はリクエストの Host から決まる。そのため、クライアントは必ず `DEV_HOST` で接続する。コンテナ内から鍵(JWKS)を取るときは、`http://oidc:8090/default/jwks` を使う。
