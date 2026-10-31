import { beforeEach, describe, expect, it, vi } from "vitest";

// キーを描かず、マウントとアンマウントだけを再現する
const unmount = vi.hoisted(() => ({ run: (() => undefined) as () => void }));
vi.mock("react", () => ({
  useRef: <T>(current: T) => ({ current }),
  useEffect: (effect: () => () => void) => {
    unmount.run = effect();
  },
}));

const { useHoldKey } = await import("./useHoldKey.ts");

describe("useHoldKey", () => {
  const press = vi.fn<(value: boolean) => void>();

  beforeEach(() => {
    press.mockReset();
  });

  it("押して離す", () => {
    const key = useHoldKey(press);
    key.down();
    key.up();
    expect(press.mock.calls).toEqual([[true], [false]]);
  });

  it("押したままキーが消えたら離す", () => {
    const key = useHoldKey(press);
    key.down();
    unmount.run();
    expect(press.mock.calls).toEqual([[true], [false]]);
  });

  it("離した後にキーが消えても、もう一度は離さない", () => {
    const key = useHoldKey(press);
    key.down();
    key.up();
    unmount.run();
    expect(press).toHaveBeenCalledTimes(2);
  });

  it("押していないときにキーが消えても、離さない", () => {
    useHoldKey(press);
    unmount.run();
    expect(press).not.toHaveBeenCalled();
  });
});
