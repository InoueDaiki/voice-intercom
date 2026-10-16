# CLAUDE.md

設計は `docs/設計メモ.md`、構成とセットアップは `README.md` を参照する。

## 開発環境

- Python、TypeScript、Terraform、buf は devContainer で動かす。
- モバイル版(React Native、`apps/mobile`。Web 版がある程度できてから作る)は、iOS / Android のビルドがあるのでホストで開発する。ツールの版は `mise.toml` で固定する。
- ホストは Apple Silicon。ツールやイメージを足すときは、arm64 に対応しているか確かめる。
- コマンドは `mise run <task>`(gen / lint / fmt / test)を使う。

## 言語と規約

- サーバーサイドは Python 3.14 に揃える。uv の workspace(`services/*`、`packages/schema/python`)、ruff、pyright を使う。
- JS は pnpm の workspace。アプリは3つ: 管理コンソール(`apps/admin`、Vite + React の SPA)、Web 版クライアント(`apps/web`、Vite + React の SPA)、モバイル版クライアント(`apps/mobile`、React Native)。
- 管理コンソールと Web 版のルーティングは、React Router の framework モードを SPA(`ssr: false`)で使い、`src/routes` のファイル名でルートを書く(`@react-router/fs-routes`)。Next.js は使わない。
- クライアントの処理(ルームの状態、字幕、メディアの送受信など)は画面から切り離して共有のパッケージ(`packages/client-core`)に置き、Web 版とモバイル版で使い回す。Web 版を先に作り、モバイル版は後から足す。
  - `packages/client-core` では DOM の API を使わない(`lib` に DOM を入れていない)。端末に依るところ(音声の出し方、ファイルの読み方、動画の変換、ログイン)はインターフェースにして、各アプリから差し込む。
  - テストは Vitest(`mise run test` が pytest と一緒に動かす)。
- 型の共有:
  - データチャネルのメッセージは `proto/` に定義し、`mise run gen` で生成する。生成物(`packages/schema/*`)は手で編集せず、コミットする。
  - REST API は Pydantic のモデルを正にして OpenAPI を出し、TypeScript のクライアントを生成する。
  - proto を変えたら `buf breaking` で互換性を確かめる。古いアプリが使われ続けるため、互換を壊す変更はしない。
- 認証は Cognito を標準の OIDC で使う。ローカルでは模擬 OIDC サーバーを使う(README を参照)。JWT は Lambda のコードの中でも検証する。
- IaC は Terraform。dev と prod は同じ AWS アカウントの中で、`voice-intercom-<env>` という名前の接頭辞で分ける。
- ドキュメントとコメントは日本語で書く。
