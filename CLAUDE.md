# CLAUDE.md

設計は `docs/設計メモ.md`、構成とセットアップは `README.md` を参照する。

## 開発環境

- Flutter(`apps/mobile`)はホストで開発する。devContainer に Flutter を入れない。
- それ以外(Python、TypeScript、Terraform、buf)は devContainer で動かす。ツールの版は `mise.toml` で固定する。
- ホストは Apple Silicon。ツールやイメージを足すときは、arm64 に対応しているか確かめる。
- コマンドは `mise run <task>`(gen / lint / fmt / test)を使う。

## 言語と規約

- サーバーサイドは Python 3.14 に揃える。uv の workspace(`services/*`、`packages/schema/python`)、ruff、pyright を使う。
- JS は pnpm の workspace。管理コンソールは Vite + React の SPA。
- 型の共有:
  - データチャネルのメッセージは `proto/` に定義し、`mise run gen` で生成する。生成物(`packages/schema/*`)は手で編集せず、コミットする。
  - REST API は Pydantic のモデルを正にして OpenAPI を出し、TypeScript と Dart のクライアントを生成する。
  - proto を変えたら `buf breaking` で互換性を確かめる。古いアプリが使われ続けるため、互換を壊す変更はしない。
- 認証は Cognito を標準の OIDC で使う。ローカルでは模擬 OIDC サーバーを使う(README を参照)。JWT は Lambda のコードの中でも検証する。
- IaC は Terraform。dev と prod は同じ AWS アカウントの中で、`voice-intercom-<env>` という名前の接頭辞で分ける。
- ドキュメントとコメントは日本語で書く。
