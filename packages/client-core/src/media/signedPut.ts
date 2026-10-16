// 署名付き URL への PUT が失敗した(S3 の応答が 2xx でない)。
export class PutFailedError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body = "") {
    super(`PUT が ${status} で失敗した`);
    this.name = "PutFailedError";
    this.status = status;
    this.body = body;
  }
}

// 署名付き URL への PUT。端末に依る(本体の読み方、進み具合の取り方)ので各アプリが差し込む。
//
// - 本体の offset バイト目から length バイトを送り、応答の ETag を返す(無ければ undefined)。
//   ETag はマルチパートの complete に渡す。引用符を含めて、ヘッダーのまま返す。
// - contentType は署名に含まれるので、uploads に渡した content_type と同じにする
//   (違うと S3 も SeaweedFS も 403。charset なども付けない)。マルチパートのパートは
//   Content-Type を署名に含めないので、undefined にして付けない。
// - 2xx でなければ PutFailedError を投げる。
// - onProgress には送り出したバイト数を渡す。
export interface SignedPut<F> {
  putFile(
    url: string,
    file: F,
    options: {
      offset: number;
      length: number;
      contentType: string | undefined;
      onProgress?: (sent: number) => void;
    },
  ): Promise<string | undefined>;
  putBytes(url: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
