// SPA の画面のパス(/rooms/abc など)に index.html を返す(CloudFront Function、viewer-request)。
// 最後の区切りに拡張子が無いものを画面のパスとみなす。ビルドの出力は index.html と assets/ の下の
// ファイルだけで、ルームの ID などには "." を使わない(services/api の RoomId)。
// 拡張子のあるパスはそのまま S3 に取りに行き、無いファイルは 403 になる(JS などに HTML を返さない)。
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.lastIndexOf(".") <= uri.lastIndexOf("/")) {
    request.uri = "/index.html";
  }
  return request;
}
