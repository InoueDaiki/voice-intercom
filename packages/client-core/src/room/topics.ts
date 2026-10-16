// データチャネルの topic(proto/voiceintercom/v1 のコメント)
export const captionTopic = "caption";
export const textTopic = "text";
// テキスト入力の受け付け・結果(TextStatus)。Agent が送信者だけに宛てて送る
export const textStatusTopic = "text_status";
// 画像・動画の配信(設計メモの「データチャネルの取り決め」)。API が Server API から送る
export const mediaTopic = "media";
// 送った本人が消した知らせ(proto/voiceintercom/v1/deletion.proto)。API が Server API から送る
export const deletionTopic = "deletion";
