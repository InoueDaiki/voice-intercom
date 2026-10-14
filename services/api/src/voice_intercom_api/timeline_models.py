"""履歴(timeline)とメディアの REST API のモデル。OpenAPI とクライアントの生成元になる。

ルームとユーザーのモデル(models.py)と分けてある。
"""

from datetime import UTC, datetime
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, Field, model_validator

from voice_intercom_api.models import Language

# 画像・動画の Content-Type。サムネイルは image/jpeg に決めてある
MediaContentType = Literal["image/jpeg", "image/png", "image/webp", "image/heic", "video/mp4"]
THUMBNAIL_CONTENT_TYPE = "image/jpeg"

# 本体の上限。これより大きいものはマルチパートにする予定で、まだ受け付けない(README)
MAX_MEDIA_BYTES = 100 * 1024 * 1024

SOURCE_ID_PATTERN = r"^[A-Za-z0-9_-]{1,128}$"
MEDIA_ID_PATTERN = r"^[0-9a-f]{32}$"

TimelineKind = Literal["utterance", "text", "media"]


def format_timestamp(dt: datetime) -> str:
    """UTC、ミリ秒まで、末尾 Z の形にする(例 2026-10-10T00:00:00.000Z)。

    event_id の先頭に使い、文字列の順が時刻の順になるよう、桁をそろえる。
    """
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _normalize_timestamp(value: str) -> str:
    # 同じ時刻なら同じ event_id になるよう、受け取った時刻の書き方をそろえる
    try:
        dt = datetime.fromisoformat(value)
    except ValueError as e:
        raise ValueError("ISO 8601 の時刻ではない") from e
    if dt.tzinfo is None:
        raise ValueError("タイムゾーンのない時刻は受け付けない")
    return format_timestamp(dt)


OccurredAt = Annotated[
    str,
    AfterValidator(_normalize_timestamp),
    Field(
        description="ISO 8601(UTC、ミリ秒まで。例 2026-10-10T00:00:00.000Z)。"
        "リクエストではタイムゾーンつきの ISO 8601 を受け付け、この形にそろえる"
    ),
]
SenderId = Annotated[
    str,
    Field(
        min_length=1,
        max_length=128,
        description="話者・送信者の Cognito の sub(LiveKit の identity と同じ)",
    ),
]
OriginalLanguage = Annotated[Language | None, Field(description="原文の言語。分からなければ null")]
Translations = Annotated[dict[str, str], Field(description="言語コード → 訳文。訳がなければ空")]
UtteranceId = Annotated[
    str | None,
    Field(max_length=128, description="発話の ID(utterance のときだけ。字幕の proto と同じ)"),
]
SegmentIndex = Annotated[
    int | None,
    Field(ge=0, description="発話の中の区切りの番号(utterance のときだけ。字幕の proto と同じ)"),
]
MessageId = Annotated[
    str | None,
    Field(
        max_length=128,
        description="テキスト入力のときだけ。送信者のアプリが振った TextMessage の message_id"
        "(字幕の Caption の message_id と同じ)。アプリが自分の送ったテキストの行を見つけるのに使う",
    ),
]

# 送った本人が消せる種類。音声の発話(utterance)は消せない
DELETABLE_KINDS: frozenset[str] = frozenset({"text", "media"})


class TimelineDeletion(BaseModel):
    """消した行の印(墓石)。消した行は本文・訳・URL を返さず、これだけを持つ。"""

    deleted_at: str = Field(description="消した時刻。ISO 8601(UTC、ミリ秒まで)")
    media_type: Literal["image", "video"] | None = Field(
        description="media のときだけ、画像か動画か(「削除された画像」「削除された動画」と出す)"
    )


class TimelineMedia(BaseModel):
    media_id: str
    content_type: MediaContentType
    url: str = Field(description="表示・再生の URL(CloudFront)")
    thumbnail_url: str | None = Field(description="サムネイルの URL。なければ null")
    size_bytes: int


class TimelineEvent(BaseModel):
    """ルームの履歴の1件。"""

    room_id: str
    event_id: str = Field(
        description="`<occurred_at>#<source_id>`。文字列の順が時刻の順になる。"
        "ページングの before に渡す"
    )
    kind: TimelineKind = Field(
        description="utterance は音声の発話(字幕の区切りごとに1件)、text はテキスト入力、"
        "media は画像・動画"
    )
    sender_id: SenderId
    occurred_at: str = Field(description="ISO 8601(UTC、ミリ秒まで。例 2026-10-10T00:00:00.000Z)")
    language: OriginalLanguage
    text: str = Field(description="原文。media では空文字か、添えた文")
    translations: Translations
    utterance_id: UtteranceId
    segment_index: SegmentIndex
    media: TimelineMedia | None = Field(description="media のときだけ。消した行では null")
    message_id: MessageId = None
    deleted: TimelineDeletion | None = Field(
        default=None,
        description="送った本人が消した行なら、その印。text、translations、media は空になる",
    )


class TimelinePage(BaseModel):
    items: list[TimelineEvent] = Field(description="新しい順")
    next_before: str | None = Field(
        description="続き(より古いもの)を取るときに before に渡す。続きがなければ null"
    )


class PutTimelineEventRequest(BaseModel):
    """Agent が発話とテキスト入力を保存するときの本文。"""

    kind: Literal["utterance", "text"]
    sender_id: SenderId
    occurred_at: OccurredAt
    language: OriginalLanguage
    text: str = Field(max_length=10000, description="原文")
    translations: Translations
    utterance_id: UtteranceId = None
    segment_index: SegmentIndex = None
    message_id: MessageId = None

    @model_validator(mode="after")
    def _utterance_fields_only_for_utterance(self) -> Self:
        if self.kind != "utterance" and (
            self.utterance_id is not None or self.segment_index is not None
        ):
            raise ValueError("utterance_id と segment_index は utterance のときだけ")
        if self.kind != "text" and self.message_id is not None:
            raise ValueError("message_id は text のときだけ")
        return self


class CreateMediaUploadRequest(BaseModel):
    content_type: MediaContentType
    size_bytes: int = Field(
        gt=0, le=MAX_MEDIA_BYTES, description="本体のバイト数(上限 100MB。マルチパートは未対応)"
    )
    has_thumbnail: bool = Field(
        default=False, description="サムネイル(image/jpeg)も上げるなら true"
    )


class MediaUpload(BaseModel):
    media_id: str
    upload_url: str = Field(
        description="本体を PUT する署名付き URL。Content-Type ヘッダーを content_type と同じにする"
    )
    thumbnail_upload_url: str | None = Field(
        description="サムネイルを PUT する署名付き URL(Content-Type は image/jpeg)。"
        "has_thumbnail が false なら null"
    )
    expires_at: str = Field(description="署名付き URL の期限(ISO 8601、UTC)")


class CompleteMediaUploadRequest(BaseModel):
    text: str = Field(default="", max_length=10000, description="画像・動画に添える文")
