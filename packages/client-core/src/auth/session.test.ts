import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createClientApi } from "../api.ts";
import { LoginRequiredError, RenewalRetry, storedUserChange, storedUserSub } from "./session.ts";

class Refused extends Error {}

function setup(renew: () => Promise<void>) {
  return new RenewalRetry({ renew, isRefused: (e) => e instanceof Refused, delaysMs: [100, 200] });
}

describe("RenewalRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("通信の失敗は間隔を空けてやり直し、できたら止まる", async () => {
    const renew = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue();
    const retry = setup(renew);

    retry.failed(new Error("offline"));
    expect(retry.retrying).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(retry.retrying).toBe(true);

    await vi.advanceTimersByTimeAsync(199);
    expect(renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(retry.retrying).toBe(false);
  });

  test("サーバーが断ったら、やり直さない", async () => {
    const renew = vi.fn(async () => {});
    const retry = setup(renew);
    retry.failed(new Refused());
    expect(retry.retrying).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(renew).not.toHaveBeenCalled();
  });

  test("やり直しの中でサーバーが断ったら止まる", async () => {
    const retry = setup(async () => {
      throw new Refused();
    });
    retry.failed(new Error("offline"));
    await vi.advanceTimersByTimeAsync(100);
    expect(retry.retrying).toBe(false);
  });

  test("リフレッシュトークンが無ければ止まる", () => {
    const retry = setup(async () => {});
    retry.failed(new LoginRequiredError());
    expect(retry.retrying).toBe(false);
  });

  test("wake ですぐ試す。やり直している途中でなければ何もしない", async () => {
    const renew = vi.fn(async () => {});
    const retry = setup(renew);
    retry.wake();
    expect(renew).not.toHaveBeenCalled();

    retry.failed(new Error("offline"));
    retry.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(retry.retrying).toBe(false);
  });

  test("別の経路で更新できたら、やり直しをやめる", async () => {
    const renew = vi.fn(async () => {});
    const retry = setup(renew);
    retry.failed(new Error("offline"));
    retry.succeeded();
    await vi.advanceTimersByTimeAsync(1000);
    expect(renew).not.toHaveBeenCalled();
  });

  test("dispose の後は試さない", async () => {
    const renew = vi.fn(async () => {});
    const retry = setup(renew);
    retry.failed(new Error("offline"));
    retry.dispose();
    retry.failed(new Error("offline"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(renew).not.toHaveBeenCalled();
  });
});

describe("別のタブが保存したログイン情報", () => {
  const stored = (sub: string) => JSON.stringify({ profile: { sub } });

  test("消されたらログアウト", () => {
    expect(storedUserChange("alice", null)).toBe("signedOut");
  });

  test("別の人に替わった", () => {
    expect(storedUserChange("alice", stored("bob"))).toBe("switched");
  });

  test("同じ人のトークンの更新、ログインしていなかった画面でのログイン", () => {
    expect(storedUserChange("alice", stored("alice"))).toBe("updated");
    expect(storedUserChange(undefined, stored("alice"))).toBe("updated");
    expect(storedUserChange(undefined, null)).toBe("updated");
  });

  test("読めない値は、利用者が替わったとはみなさない", () => {
    expect(storedUserSub("{")).toBeUndefined();
    expect(storedUserChange("alice", "{")).toBe("updated");
  });
});

describe("API の呼び出し", () => {
  test("アクセストークンを渡せないときは、通信の失敗にしない", async () => {
    const api = createClientApi({
      baseUrl: "http://api.invalid",
      getAccessToken: async () => {
        throw new LoginRequiredError();
      },
    });
    await expect(api.listRooms()).rejects.toBeInstanceOf(LoginRequiredError);
  });
});
