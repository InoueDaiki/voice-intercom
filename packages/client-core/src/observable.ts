// 状態が変わったことを画面に知らせる。画面は subscribe で知り、プロパティを読み直す。
// React なら useSyncExternalStore(subscribe, () => version) で描き直す。
export class Observable {
  private readonly listeners = new Set<() => void>();
  // 変わるたびに増える。描き直すかどうかの比較に使う
  version = 0;

  // 解除する関数を返す
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getVersion = (): number => this.version;

  protected changed(): void {
    this.version++;
    for (const l of [...this.listeners]) {
      l();
    }
  }
}
