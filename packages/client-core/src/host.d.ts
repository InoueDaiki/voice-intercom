// ブラウザと React Native の両方にある API だけを宣言する(tsconfig で DOM の型を入れていない)。
// ここに無いもの(document、window、File、XMLHttpRequest など)は使わず、各アプリから差し込む

declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(id: unknown): void;

declare const console: {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

// React Native では react-native-get-random-values などで足す
declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T;
};
