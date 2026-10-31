import { beforeEach, describe, expect, it, vi } from "vitest";

// 端末の保管場所の代わり
const store = new Map<string, string>();
const mocks = vi.hoisted(() => ({
  refreshAsync: vi.fn(),
  revokeAsync: vi.fn(),
  fetchDiscoveryAsync: vi.fn(),
  exchangeCodeAsync: vi.fn(),
  promptAsync: vi.fn(),
  openAuthSessionAsync: vi.fn(),
  config: { oidcIssuer: "https://issuer", oidcClientId: "mobile", oidcLogoutUrl: "https://hosted/logout" as string | undefined },
}));

vi.mock("expo-auth-session", () => {
  class TokenResponse {
    accessToken: string;
    idToken?: string;
    refreshToken?: string;
    constructor(config: { accessToken: string; idToken?: string; refreshToken?: string }) {
      this.accessToken = config.accessToken;
      this.idToken = config.idToken;
      this.refreshToken = config.refreshToken;
    }
    shouldRefresh() {
      return this.accessToken.startsWith("old.");
    }
    static isTokenFresh(token: TokenResponse) {
      return !token.accessToken.startsWith("expired.");
    }
    getRequestConfig() {
      return { accessToken: this.accessToken, idToken: this.idToken, refreshToken: this.refreshToken };
    }
  }
  class TokenError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  class AuthRequest {
    codeVerifier = "verifier";
    promptAsync = mocks.promptAsync;
  }
  return {
    AuthRequest,
    TokenError,
    TokenResponse,
    exchangeCodeAsync: mocks.exchangeCodeAsync,
    fetchDiscoveryAsync: mocks.fetchDiscoveryAsync,
    makeRedirectUri: ({ scheme, path }: { scheme: string; path: string }) => `${scheme}://${path}`,
    refreshAsync: mocks.refreshAsync,
    revokeAsync: mocks.revokeAsync,
  };
});
vi.mock("expo-localization", () => ({ getLocales: () => [] }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}));
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: mocks.openAuthSessionAsync }));
vi.mock("@voice-intercom/client-react", () => ({ useObservable: () => undefined }));
vi.mock("./config.ts", () => ({ config: mocks.config }));

// sub だけを持つ JWT
function jwt(prefix: string, sub: string): string {
  return `${prefix}.${btoa(JSON.stringify({ sub }))}.sig`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// 保管したトークンで起動する。accessToken が old. で始まると更新が要る
async function signedIn(accessToken = jwt("fresh", "alice")) {
  store.set("auth.meta", "{}");
  store.set("auth.access", accessToken);
  store.set("auth.refresh", "refresh-alice");
  const { auth } = await import("./auth.ts");
  const { queryClient } = await import("./queryClient.ts");
  await auth.load();
  return { auth, queryClient };
}

// vi.resetModules で読み込み直すので、instanceof ではなく name で見る
describe("AuthStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    store.clear();
    mocks.config.oidcLogoutUrl = "https://hosted/logout";
    mocks.fetchDiscoveryAsync.mockResolvedValue({ revocationEndpoint: "https://issuer/revoke" });
    mocks.revokeAsync.mockResolvedValue(true);
    mocks.openAuthSessionAsync.mockResolvedValue({ type: "success" });
  });

  it("ログアウトは Cognito に登録した signout へ戻し、リフレッシュトークンを取り消す", async () => {
    const { auth } = await signedIn();
    await auth.signOut();

    const [url, redirect] = mocks.openAuthSessionAsync.mock.calls[0]!;
    expect(url).toContain(`logout_uri=${encodeURIComponent("voiceintercom://signout")}`);
    expect(redirect).toBe("voiceintercom://signout");
    await vi.waitFor(() =>
      expect(mocks.revokeAsync).toHaveBeenCalledWith(
        { token: "refresh-alice", clientId: "mobile" },
        { revocationEndpoint: "https://issuer/revoke" },
      ),
    );
    expect(auth.state).toEqual({ status: "signedOut" });
    expect(store.size).toBe(0);
  });

  it("取り消しに失敗しても、窓口が無くても、ログアウトは終わる", async () => {
    const { auth } = await signedIn();
    mocks.revokeAsync.mockRejectedValue(new Error("圏外"));
    await auth.signOut();
    expect(auth.state.status).toBe("signedOut");
    expect(mocks.openAuthSessionAsync).toHaveBeenCalledOnce();

    vi.resetModules();
    mocks.revokeAsync.mockClear();
    mocks.fetchDiscoveryAsync.mockResolvedValue({});
    const second = await signedIn();
    await second.auth.signOut();
    await vi.waitFor(() => expect(mocks.fetchDiscoveryAsync).toHaveBeenCalled());
    expect(mocks.revokeAsync).not.toHaveBeenCalled();
  });

  it("ログアウトで QueryClient を空にする", async () => {
    const { auth, queryClient } = await signedIn();
    queryClient.setQueryData(["me"], { display_name: "Alice" });
    await auth.signOut();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it("ログインの前に残っていたデータを、次の人に見せない", async () => {
    const { auth, queryClient } = await signedIn();
    await auth.signOut();
    queryClient.setQueryData(["me"], { display_name: "Alice" });
    mocks.promptAsync.mockResolvedValue({ type: "success", params: { code: "code" } });
    const { TokenResponse } = await import("expo-auth-session");
    mocks.exchangeCodeAsync.mockResolvedValue(new TokenResponse({ accessToken: jwt("fresh", "bob") }));

    await auth.signIn();

    expect(auth.state).toMatchObject({ status: "signedIn", user: { sub: "bob" } });
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it("更新の通信中にログアウトしても、トークンを復活させない", async () => {
    const { auth } = await signedIn(jwt("old", "alice"));
    const { TokenResponse } = await import("expo-auth-session");
    const response = deferred<InstanceType<typeof TokenResponse>>();
    mocks.refreshAsync.mockReturnValue(response.promise);

    const pending = auth.getAccessToken();
    await vi.waitFor(() => expect(mocks.refreshAsync).toHaveBeenCalled());
    await auth.signOut();
    response.resolve(new TokenResponse({ accessToken: jwt("fresh", "alice"), refreshToken: "refresh-next" }));

    await expect(pending).rejects.toMatchObject({ name: "LoginRequiredError" });
    expect(store.size).toBe(0);
    await expect(auth.getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
  });

  it("保管の途中でログアウトしても、書きかけのトークンを残さない", async () => {
    const { auth } = await signedIn(jwt("old", "alice"));
    const { TokenResponse } = await import("expo-auth-session");
    const SecureStore = await import("expo-secure-store");
    const blocked = deferred<void>();
    const setItem = vi.spyOn(SecureStore, "setItemAsync").mockImplementationOnce(async (k, v) => {
      await blocked.promise;
      store.set(k, v);
    });
    mocks.refreshAsync.mockResolvedValue(new TokenResponse({ accessToken: jwt("fresh", "alice"), refreshToken: "next" }));

    const pending = auth.getAccessToken();
    await vi.waitFor(() => expect(setItem).toHaveBeenCalled());
    const out = auth.signOut();
    blocked.resolve();
    await out;
    await pending.catch(() => undefined);

    expect(store.size).toBe(0);
  });

  it("前のログインの更新の失敗は、次の状態に触らない", async () => {
    const { auth } = await signedIn(jwt("old", "alice"));
    const { TokenError } = await import("expo-auth-session");
    const response = deferred<never>();
    mocks.refreshAsync.mockReturnValue(response.promise);

    const pending = auth.getAccessToken();
    await vi.waitFor(() => expect(mocks.refreshAsync).toHaveBeenCalled());
    await auth.signOut();
    response.reject(new (TokenError as unknown as new (code: string) => Error)("invalid_grant"));

    await expect(pending).rejects.toMatchObject({ name: "LoginRequiredError" });
    expect(auth.state).toEqual({ status: "signedOut" });
  });

  it("リフレッシュトークンを断られたら、ログインを終えて LoginRequiredError を投げる", async () => {
    const { auth } = await signedIn(jwt("old", "alice"));
    const { TokenError } = await import("expo-auth-session");
    mocks.refreshAsync.mockRejectedValue(new (TokenError as unknown as new (code: string) => Error)("invalid_grant"));

    await expect(auth.getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
    expect(auth.state).toEqual({ status: "signedOut", error: "ログインの期限が切れました。ログインし直してください。" });
    expect(store.size).toBe(0);
  });

  it("通信の失敗はそのまま投げ、ログインを保つ", async () => {
    const { auth } = await signedIn(jwt("old", "alice"));
    const failure = new Error("圏外");
    mocks.refreshAsync.mockRejectedValue(failure);

    await expect(auth.getAccessToken()).rejects.toBe(failure);
    expect(auth.state.status).toBe("signedIn");
    expect(store.get("auth.refresh")).toBe("refresh-alice");
  });

  it("リフレッシュトークンが無いまま期限が切れたら、ログインを終えて LoginRequiredError を投げる", async () => {
    store.set("auth.meta", "{}");
    store.set("auth.access", jwt("expired", "alice"));
    const { auth } = await import("./auth.ts");
    await auth.load();

    await expect(auth.getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
    expect(auth.state.status).toBe("signedOut");
    expect(store.size).toBe(0);
  });
});
