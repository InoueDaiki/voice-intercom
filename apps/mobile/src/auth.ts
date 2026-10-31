// 標準の OIDC(認可コード + PKCE)でログインする。本番は Cognito の mobile クライアント、ローカルは模擬 OIDC。
// ログインの画面は OS のブラウザ(iOS は ASWebAuthenticationSession)で開き、voiceintercom://callback で戻る。
// トークンは端末の安全な保管場所(Keychain / Keystore)に置き、アクセストークンの期限が近づいたらリフレッシュトークンで更新する
import { LoginRequiredError, loginLanguage, Observable } from "@voice-intercom/client-core";
import { useObservable } from "@voice-intercom/client-react";
import {
  AuthRequest,
  type DiscoveryDocument,
  exchangeCodeAsync,
  fetchDiscoveryAsync,
  makeRedirectUri,
  refreshAsync,
  revokeAsync,
  TokenError,
  TokenResponse,
  type TokenResponseConfig,
} from "expo-auth-session";
import { File, Paths } from "expo-file-system";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

import { config } from "./config.ts";
import { queryClient } from "./queryClient.ts";

// iOS の保管場所は1つの値が大きいと警告するので、トークンを分けて置く
const KEYS = {
  meta: "auth.meta",
  access: "auth.access",
  id: "auth.id",
  refresh: "auth.refresh",
} as const;

// 保管場所の削除を試す回数と間隔(ミリ秒)
const DELETE_ATTEMPTS = 3;
const DELETE_RETRY_MS = 200;

const SCOPES = ["openid", "email", "profile"];

const LOGIN_EXPIRED = "ログインの期限が切れました。ログインし直してください。";

// voiceintercom://callback(app.config.ts の scheme)
const redirectUri = makeRedirectUri({ scheme: "voiceintercom", path: "callback" });
// voiceintercom://signout(Cognito の mobile クライアントの logout_urls と同じ)
const logoutRedirectUri = makeRedirectUri({ scheme: "voiceintercom", path: "signout" });

export interface SignedInUser {
  // トークンの sub(LiveKit の identity、ルームの member_ids)
  sub: string;
  email?: string;
  groups: string[];
}

type AuthState =
  | { status: "loading" }
  | { status: "signedOut"; error?: string }
  | { status: "signingIn" }
  | { status: "signedIn"; user: SignedInUser };

// JWT の中身(署名は確かめない。API が確かめる)
function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  // UTF-8 の並びを、パーセントの形にしてから戻す(TextDecoder が無い環境でも動くように)
  const percent = Array.from(atob(base64), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
  return JSON.parse(decodeURIComponent(percent)) as Record<string, unknown>;
}

function userOf(token: TokenResponse): SignedInUser {
  const claims = decodeJwt(token.idToken ?? token.accessToken);
  const groups = claims["cognito:groups"];
  return {
    sub: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : undefined,
    groups: Array.isArray(groups) ? groups.map(String) : [],
  };
}

// Cognito の発行元か。ログアウトの画面は発行元ではなく、ホストされたログイン画面のドメインにある
function isCognitoIssuer(issuer: string): boolean {
  return /^https:\/\/cognito-idp\.[^/]+\.amazonaws\.com(\.cn)?\//.test(issuer);
}

// Cognito のログアウトの URL。ログインの窓口(<hosted_ui_url>/oauth2/authorize)と同じドメインの /logout
function cognitoLogoutUrl(authorizationEndpoint: string | undefined): string | undefined {
  const base = authorizationEndpoint?.match(/^(.+)\/oauth2\/authorize$/)?.[1];
  return base && `${base}/logout`;
}

// 「保管したトークンをログアウトで消し切れていない」目印。保管場所が失敗しているときにも残せるよう、
// 保管場所の外のファイルに置く。目印があれば、起動のときにトークンを使わず、消し直す
function signOutMark(): File {
  return new File(Paths.document, "auth-sign-out-pending");
}

function setSignOutMark(): void {
  try {
    signOutMark().create({ overwrite: true });
  } catch (e) {
    console.warn("ログアウトの目印を置けなかった", e);
  }
}

function clearSignOutMark(): void {
  try {
    const mark = signOutMark();
    if (mark.exists) {
      mark.delete();
    }
  } catch (e) {
    console.warn("ログアウトの目印を消せなかった", e);
  }
}

function hasSignOutMark(): boolean {
  try {
    return signOutMark().exists;
  } catch (e) {
    console.warn("ログアウトの目印を読めなかった", e);
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AuthStore extends Observable {
  state: AuthState = { status: "loading" };
  private token: TokenResponse | undefined;
  private discovery: DiscoveryDocument | undefined;
  // 同時に何度も更新しないよう、更新中の Promise を共有する
  private refreshing: Promise<TokenResponse> | undefined;
  // ログインを終えるたびに増やす。前の世代の更新は、結果を捨てる(トークンを復活させない)
  private generation = 0;
  // 保管場所への読み書きを順に行う(書いている途中のトークンが、消した後に残らないように)
  private storage: Promise<unknown> = Promise.resolve();

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.storage.then(task, task);
    this.storage = run.catch(() => undefined);
    return run;
  }

  private set(state: AuthState): void {
    this.state = state;
    this.changed();
  }

  private async getDiscovery(): Promise<DiscoveryDocument> {
    this.discovery ??= await fetchDiscoveryAsync(config.oidcIssuer);
    return this.discovery;
  }

  // 起動のときに、保管したトークンを読む
  async load(): Promise<void> {
    try {
      // 前のログアウトで消し切れなかった。残りを使わず、消し直す
      if (hasSignOutMark()) {
        await this.purge();
        this.set({ status: "signedOut" });
        return;
      }
      const meta = await SecureStore.getItemAsync(KEYS.meta);
      const accessToken = await SecureStore.getItemAsync(KEYS.access);
      if (!meta || !accessToken) {
        this.set({ status: "signedOut" });
        return;
      }
      const token = new TokenResponse({
        ...(JSON.parse(meta) as Omit<TokenResponseConfig, "accessToken">),
        accessToken,
        idToken: (await SecureStore.getItemAsync(KEYS.id)) ?? undefined,
        refreshToken: (await SecureStore.getItemAsync(KEYS.refresh)) ?? undefined,
      });
      this.token = token;
      this.set({ status: "signedIn", user: userOf(token) });
    } catch (e) {
      console.warn("保管したトークンを読めなかった", e);
      this.set({ status: "signedOut" });
    }
  }

  async signIn(): Promise<void> {
    this.set({ status: "signingIn" });
    try {
      const discovery = await this.getDiscovery();
      const request = new AuthRequest({
        clientId: config.oidcClientId,
        redirectUri,
        scopes: SCOPES,
        usePKCE: true,
        // ログインの画面を、端末の言語で出す(lang が無いと Cognito は英語で出す)
        extraParams: { lang: loginLanguage(getLocales().map((l) => l.languageTag)) },
      });
      const result = await request.promptAsync(discovery);
      if (result.type !== "success") {
        this.set({
          status: "signedOut",
          error: result.type === "error" ? (result.error?.message ?? "ログインできませんでした") : undefined,
        });
        return;
      }
      const token = await exchangeCodeAsync(
        {
          clientId: config.oidcClientId,
          code: String(result.params.code),
          redirectUri,
          extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
        },
        discovery,
      );
      const user = userOf(token);
      try {
        await this.save(token);
      } catch (e) {
        // 保管できなかった。書きかけを次の起動で使わないよう、ログインを終える
        await this.endSession({ status: "signedOut", error: e instanceof Error ? e.message : String(e) });
        void this.revoke(token.refreshToken);
        return;
      }
      // ログアウトの後に画面の取り直しが残したものも、次の人に見せない
      queryClient.clear();
      this.set({ status: "signedIn", user });
    } catch (e) {
      this.set({ status: "signedOut", error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ログインを終える。通信中の更新を無効にし、前の人のデータを画面から消してから、保管したトークンを消す
  private async endSession(state: AuthState): Promise<void> {
    this.generation += 1;
    this.token = undefined;
    this.refreshing = undefined;
    queryClient.clear();
    this.set(state);
    await this.purge();
  }

  // 保管したトークンを消す。失敗しても投げない(ログアウトの続きを止めない)。
  // 消し終えるまで目印を置くので、途中でアプリが終わっても、消し切れなくても、残りは次の起動で使われない
  private purge(): Promise<void> {
    return this.serial(async () => {
      setSignOutMark();
      let remaining: string[] = Object.values(KEYS);
      for (let attempt = 1; ; attempt += 1) {
        const keys = remaining;
        const results = await Promise.allSettled(keys.map((k) => SecureStore.deleteItemAsync(k)));
        remaining = keys.filter((_, i) => results[i]?.status === "rejected");
        if (remaining.length === 0) {
          clearSignOutMark();
          return;
        }
        if (attempt === DELETE_ATTEMPTS) {
          console.warn("保管したトークンを消せなかった。次の起動で消し直す", remaining, results);
          return;
        }
        await delay(DELETE_RETRY_MS);
      }
    });
  }

  // リフレッシュトークンを取り消す。届かなくてもログアウトは止めない(トークンは端末から消えている)。
  // 発行元が取り消しの窓口を持たないとき(模擬 OIDC など)は何もしない
  private async revoke(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    try {
      const discovery = await this.getDiscovery();
      if (discovery.revocationEndpoint) {
        await revokeAsync({ token: refreshToken, clientId: config.oidcClientId }, discovery);
      }
    } catch (e) {
      console.info("リフレッシュトークンを取り消せなかった", e);
    }
  }

  // ブラウザのログインを消す URL。指定が無ければ、Cognito では発行元の情報から導く。
  // 模擬 OIDC には無い(undefined)。Cognito で導けなければ、次のログインで同じ人に入ってしまうので警告する
  private async hostedLogoutUrl(): Promise<string | undefined> {
    if (config.oidcLogoutUrl || !isCognitoIssuer(config.oidcIssuer)) {
      return config.oidcLogoutUrl;
    }
    const url = cognitoLogoutUrl((await this.getDiscovery()).authorizationEndpoint);
    if (!url) {
      console.warn("Cognito のログアウトの URL が分からない。MOBILE_OIDC_LOGOUT_URL を渡す");
    }
    return url;
  }

  async signOut(): Promise<void> {
    const refreshToken = this.token?.refreshToken;
    await this.endSession({ status: "signedOut" });
    void this.revoke(refreshToken);
    // ブラウザに残ったログイン(Cognito のセッション)も消す。消さないと、次のログインで画面を出さずに同じ人で入る
    try {
      const logoutUrl = await this.hostedLogoutUrl();
      if (logoutUrl) {
        const url = `${logoutUrl}?client_id=${encodeURIComponent(config.oidcClientId)}&logout_uri=${encodeURIComponent(logoutRedirectUri)}`;
        await WebBrowser.openAuthSessionAsync(url, logoutRedirectUri);
      }
    } catch (e) {
      console.warn("ログイン画面のセッションを消せなかった", e);
    }
  }

  // API の呼び出しに付けるアクセストークン。期限が近ければ更新する。
  // ログインが切れていれば LoginRequiredError を投げる(通信の失敗はそのまま投げ、ログインを保つ)
  async getAccessToken(): Promise<string> {
    const token = this.token;
    if (!token) {
      throw new LoginRequiredError();
    }
    if (token.shouldRefresh() && token.refreshToken) {
      return (await this.refresh(token)).accessToken;
    }
    // リフレッシュトークンが無いまま期限が切れた。更新できないので、ログインし直してもらう
    if (!TokenResponse.isTokenFresh(token, 0)) {
      await this.endSession({ status: "signedOut", error: LOGIN_EXPIRED });
      throw new LoginRequiredError();
    }
    return token.accessToken;
  }

  private refresh(token: TokenResponse): Promise<TokenResponse> {
    const generation = this.generation;
    this.refreshing ??= (async () => {
      try {
        const next = await refreshAsync(
          { clientId: config.oidcClientId, refreshToken: token.refreshToken, scopes: SCOPES },
          await this.getDiscovery(),
        );
        // 更新の応答にリフレッシュトークンが無ければ、前のものを使い続ける
        next.refreshToken ??= token.refreshToken;
        if (!(await this.save(next, generation))) {
          // 更新の通信中にログアウトした。下の catch で LoginRequiredError にする
          throw new Error("ログアウトしたので、トークンの更新を取りやめた");
        }
        return next;
      } catch (e) {
        // ログアウトの後に届いた失敗は、次の人のログインに触らない
        if (generation !== this.generation) {
          throw new LoginRequiredError();
        }
        // サーバーが断ったとき(期限切れ(30日)、取り消し)だけログインし直してもらう。
        // 電波が切れたなどで届かなかったときは、ログインを保ち、次の呼び出しで更新し直す
        if (e instanceof TokenError && e.code === "invalid_grant") {
          console.info("リフレッシュトークンが断られた", e);
          await this.endSession({ status: "signedOut", error: LOGIN_EXPIRED });
          throw new LoginRequiredError();
        }
        console.warn("トークンを更新できなかった", e);
        throw e;
      } finally {
        if (generation === this.generation) {
          this.refreshing = undefined;
        }
      }
    })();
    return this.refreshing;
  }

  // generation の世代のログインがまだ続いているときだけ置く。置いたら true
  private save(token: TokenResponse, generation = this.generation): Promise<boolean> {
    return this.serial(async () => {
      if (generation !== this.generation) {
        return false;
      }
      this.token = token;
      const { accessToken, idToken, refreshToken, ...meta } = token.getRequestConfig();
      await SecureStore.setItemAsync(KEYS.meta, JSON.stringify(meta));
      await SecureStore.setItemAsync(KEYS.access, accessToken);
      await (idToken ? SecureStore.setItemAsync(KEYS.id, idToken) : SecureStore.deleteItemAsync(KEYS.id));
      await (refreshToken ? SecureStore.setItemAsync(KEYS.refresh, refreshToken) : SecureStore.deleteItemAsync(KEYS.refresh));
      // 前のログアウトの消し残しは、今のトークンで上書きした
      clearSignOutMark();
      return true;
    });
  }
}

export const auth = new AuthStore();

export function getAccessToken(): Promise<string> {
  return auth.getAccessToken();
}

// ログインの状態を読み、変わったら描き直す
export function useAuth(): AuthStore {
  useObservable(auth);
  return auth;
}
