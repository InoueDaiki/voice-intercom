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

# 幅・高さの上限(ピクセル)。JPEG と HEIC の上限に合わせる
MAX_MEDIA_SIDE = 65535

# 動画の長さの上限(ミリ秒)。アプリの上限(3分)ではなく、明らかにおかしい値を弾くための値
MAX_MEDIA_DURATION_MS = 24 * 60 * 60 * 1000

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


MediaWidth = Annotated[
    int | None,
    Field(
        ge=1,
        le=MAX_MEDIA_SIDE,
        description="表示の幅(ピクセル。向きを反映した後。height と一緒に送る)。"
        "分からなければ null",
    ),
]
MediaHeight = Annotated[
    int | None,
    Field(
        ge=1,
        le=MAX_MEDIA_SIDE,
        description="表示の高さ(ピクセル。向きを反映した後。width と一緒に送る)。"
        "分からなければ null",
    ),
]
MediaDurationMs = Annotated[
    int | None,
    Field(
        ge=1,
        le=MAX_MEDIA_DURATION_MS,
        description="動画の長さ(ミリ秒。動画のときだけ)。画像と、分からないときは null",
    ),
]


class TimelineMedia(BaseModel):
    media_id: str
    content_type: MediaContentType
    url: str = Field(description="表示・再生の URL(CloudFront)")
    thumbnail_url: str | None = Field(description="サムネイルの URL。なければ null")
    size_bytes: int
    # 足す前に保存した履歴には無いので、どれも null がありうる
    width: MediaWidth = None
    height: MediaHeight = None
    duration_ms: MediaDurationMs = None


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
    text: str = Field(description="原文。media では常に空文字(画像・動画には文を添えられない)")
    translations: Translations
    utterance_id: UtteranceId
    segment_index: SegmentIndex
    media: TimelineMedia | None = Field(description="media のときだけ")


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

    @model_validator(mode="after")
    def _utterance_fields_only_for_utterance(self) -> Self:
        if self.kind != "utterance" and (
            self.utterance_id is not None or self.segment_index is not None
        ):
            raise ValueError("utterance_id と segment_index は utterance のときだけ")
        return self


class CreateMediaUploadRequest(BaseModel):
    content_type: MediaContentType
    size_bytes: int = Field(
        gt=0, le=MAX_MEDIA_BYTES, description="本体のバイト数(上限 100MB。マルチパートは未対応)"
    )
    has_thumbnail: bool = Field(
        default=False, description="サムネイル(image/jpeg)も上げるなら true"
    )
    # 送信者のアプリが、整えた後の本体で測った値。履歴と MediaMessage にそのまま入れる
    # (API は中身を読んで確かめない)。管理コンソールなど、測らないクライアントは送らない
    width: MediaWidth = None
    height: MediaHeight = None
    duration_ms: MediaDurationMs = None

    @model_validator(mode="after")
    def _check_dimensions(self) -> Self:
        if (self.width is None) != (self.height is None):
            raise ValueError("width と height は両方送るか、両方送らない")
        if self.duration_ms is not None and not self.content_type.startswith("video/"):
            raise ValueError("duration_ms は動画のときだけ")
        return self


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
