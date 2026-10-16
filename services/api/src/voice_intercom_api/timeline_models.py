"""履歴(timeline)とメディアの REST API のモデル。OpenAPI とクライアントの生成元になる。

ルームとユーザーのモデル(models.py)と分けてある。
"""

import re
import unicodedata
from datetime import UTC, datetime
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, Field, model_validator

from voice_intercom_api.models import Language

# 画像として扱う Content-Type(アプリが表示できる形式)。サムネイルは image/jpeg に決めてある
IMAGE_CONTENT_TYPES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/heic"}
)
THUMBNAIL_CONTENT_TYPE = "image/jpeg"

# 送られたものの種類。image は IMAGE_CONTENT_TYPES、video は video/*、それ以外はすべて file
# (形式を問わず受け付け、ダウンロードだけにする。設計メモの「ファイルの送信」)
MediaType = Literal["image", "video", "file"]


def media_type_of(content_type: str) -> MediaType:
    if content_type in IMAGE_CONTENT_TYPES:
        return "image"
    if content_type.startswith("video/"):
        return "video"
    return "file"


# MIME タイプ(type/subtype。パラメーターは付けない)。RFC 6838 の名前に使える文字だけ
_MIME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$")


def _normalize_content_type(value: str) -> str:
    lowered = value.strip().lower()
    if not _MIME_PATTERN.fullmatch(lowered):
        raise ValueError("MIME タイプ(type/subtype)ではない")
    return lowered


MediaContentType = Annotated[
    str,
    AfterValidator(_normalize_content_type),
    Field(
        max_length=255,
        description="MIME タイプ(type/subtype。小文字にそろえる)。image/jpeg、image/png、"
        "image/webp、image/heic は画像、video/* は動画、それ以外はファイルとして扱う",
    ),
]

# ファイル名の上限(文字数)。多くのファイルシステムの上限(255 バイト)より緩いが、表示と
# Content-Disposition に使うだけなので文字数で数える
MAX_FILE_NAME_LENGTH = 255


def _normalize_file_name(value: str | None) -> str | None:
    """パスを除いた名前だけにし、制御文字を除く。空になれば None。"""
    if value is None:
        return None
    name = re.split(r"[/\\]", value)[-1]
    name = "".join(c for c in name if unicodedata.category(c)[0] != "C").strip()
    if name in ("", ".", ".."):
        return None
    if len(name) > MAX_FILE_NAME_LENGTH:
        raise ValueError(f"ファイル名は {MAX_FILE_NAME_LENGTH} 文字まで")
    return name


FileName = Annotated[
    str | None,
    AfterValidator(_normalize_file_name),
    Field(
        description="元のファイル名(パスは除く)。ファイルのダウンロードの名前と表示に使う。"
        "分からなければ null"
    ),
]

# 本体の上限(10GB)。大きいものはマルチパートで上げる(media.py)
MAX_MEDIA_BYTES = 10 * 1024 * 1024 * 1024

# マルチパートのパートの数の上限(S3 の上限)
MAX_UPLOAD_PARTS = 10_000

# パートの署名付き URL を1回で取れる数
MAX_PART_URLS_PER_REQUEST = 100

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
    media_type: MediaType | None = Field(
        description="media のときだけ、画像・動画・ファイルのどれか"
        "(「削除された画像」「削除された動画」「削除されたファイル」と出す)"
    )


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
    content_type: str = Field(description="MIME タイプ(uploads で送られたもの)")
    media_type: MediaType = Field(
        description="content_type から決めた種類。image と video は表示・再生し、"
        "file はダウンロードだけにする"
    )
    url: str = Field(
        description="表示・再生の URL(CloudFront)。file はダウンロードになる"
        "(Content-Disposition: attachment で置いてある)"
    )
    thumbnail_url: str | None = Field(description="サムネイルの URL。なければ null")
    size_bytes: int
    # 足す前に保存した履歴には無いので、どれも null がありうる
    width: MediaWidth = None
    height: MediaHeight = None
    duration_ms: MediaDurationMs = None
    file_name: str | None = Field(
        default=None, description="元のファイル名。送られなかった行(足す前の行など)は null"
    )


class TimelineEvent(BaseModel):
    """ルームの履歴の1件。"""

    room_id: str
    event_id: str = Field(
        description="`<occurred_at>#<source_id>`。文字列の順が時刻の順になる。"
        "ページングの before に渡す"
    )
    kind: TimelineKind = Field(
        description="utterance は音声の発話(字幕の区切りごとに1件)、text はテキスト入力、"
        "media は画像・動画・ファイル"
    )
    sender_id: SenderId
    occurred_at: str = Field(description="ISO 8601(UTC、ミリ秒まで。例 2026-10-10T00:00:00.000Z)")
    language: OriginalLanguage
    text: str = Field(description="原文。media では常に空文字(画像・動画には文を添えられない)")
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
    file_name: FileName = None
    size_bytes: int = Field(
        gt=0,
        le=MAX_MEDIA_BYTES,
        description="本体のバイト数(上限 10GB)。16MB 以上ならマルチパートになる。"
        "complete で、置かれた大きさがこれと違えば失敗にする",
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
        media_type = media_type_of(self.content_type)
        if self.duration_ms is not None and media_type != "video":
            raise ValueError("duration_ms は動画のときだけ")
        if media_type == "file" and (self.has_thumbnail or self.width is not None):
            raise ValueError("サムネイルと width・height は画像・動画のときだけ")
        return self


class MultipartUpload(BaseModel):
    """本体をパートに分けて PUT する(マルチパート)ときの分け方。"""

    part_size: int = Field(
        description="パートのバイト数。最後のパートだけは残り(これ以下)。"
        "パート n はファイルの (n-1)*part_size バイト目から"
    )
    part_count: int = Field(description="パートの数。番号は 1 から part_count")


class MediaUpload(BaseModel):
    media_id: str
    upload_url: str | None = Field(
        description="本体を1回で PUT する署名付き URL。Content-Type ヘッダーを content_type と"
        "同じにする(content_disposition があれば、Content-Disposition ヘッダーもその値にする)。"
        "マルチパート(multipart がある)なら null"
    )
    content_disposition: str | None = Field(
        default=None,
        description="ファイル(画像・動画でないもの)を upload_url に PUT するとき、"
        "Content-Disposition ヘッダーに付ける値(署名に含めてあり、違うと 403)。"
        "ダウンロードだけにするため。画像・動画とマルチパートでは null",
    )
    thumbnail_upload_url: str | None = Field(
        description="サムネイルを PUT する署名付き URL(Content-Type は image/jpeg)。"
        "has_thumbnail が false なら null"
    )
    expires_at: str = Field(description="署名付き URL の期限(ISO 8601、UTC)")
    multipart: MultipartUpload | None = Field(
        default=None,
        description="本体をマルチパートで上げるなら、その分け方。パートの署名付き URL は "
        "POST .../media/{media_id}/parts で取る",
    )


PartNumber = Annotated[int, Field(ge=1, le=MAX_UPLOAD_PARTS, description="パートの番号(1 から)")]


class CreateUploadPartUrlsRequest(BaseModel):
    part_numbers: list[PartNumber] = Field(
        default_factory=list[int],
        max_length=MAX_PART_URLS_PER_REQUEST,
        description=f"署名付き URL が要るパートの番号(1回で {MAX_PART_URLS_PER_REQUEST} 個まで)",
    )
    thumbnail: bool = Field(
        default=False, description="サムネイルの署名付き URL も取り直すなら true"
    )

    @model_validator(mode="after")
    def _unique(self) -> Self:
        if len(set(self.part_numbers)) != len(self.part_numbers):
            raise ValueError("part_numbers が重なっている")
        return self


class UploadPartUrl(BaseModel):
    part_number: int
    url: str = Field(
        description="パートを PUT する署名付き URL。Content-Type は要らない(付けても署名に"
        "入らない)。応答の ETag ヘッダーを complete に渡す"
    )


class UploadPartUrls(BaseModel):
    parts: list[UploadPartUrl]
    thumbnail_upload_url: str | None = Field(
        description="thumbnail が true で、サムネイルを上げるアップロードなら、その署名付き URL"
    )
    expires_at: str = Field(description="署名付き URL の期限(ISO 8601、UTC)")


class CompletedPart(BaseModel):
    part_number: PartNumber
    etag: str = Field(
        min_length=1, max_length=128, description="パートの PUT の応答の ETag ヘッダー(そのまま)"
    )


class CompleteMediaUploadRequest(BaseModel):
    parts: list[CompletedPart] | None = Field(
        default=None,
        max_length=MAX_UPLOAD_PARTS,
        description="マルチパートなら、全パートの番号と ETag(1 から part_count まで1つずつ)。"
        "1回の PUT なら送らない",
    )
