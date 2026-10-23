"""画像・動画・ファイルのアップロードの API。

画像(IMAGE_CONTENT_TYPES)と動画(video/*)は表示・再生し、それ以外の形式はファイルとして
受け付ける(形式は問わない。上限は同じ 10GB)。ファイルはダウンロードだけにするため、
Content-Disposition: attachment(元のファイル名つき)でオブジェクトを置く。署名なしの
CloudFront の URL で配信するので、HTML や SVG をブラウザで開かせると、配信のドメインで
任意のページを見せられてしまうため(設計メモの「ファイルの送信」)。

1. アプリ(か管理コンソール)が uploads で署名付き URL をもらい、S3 に本体(とサムネイル)を
   直接 PUT する。本体が 16MB 以上ならマルチパートにし、パートの署名付き URL を parts で取って、
   パートを並べて PUT する(下の「マルチパート」)。
2. complete を呼ぶと、(マルチパートなら完了させてから)置かれたことと大きさを確かめ、履歴
   (kind media)に保存する。
   1回の PUT(本体が 16MB 未満、サムネイル)は仮置きのキーに置かせ、確かめてから配信するキーへ
   コピーし、仮置きを消す(下の「仮置き」)。
3. 保存した後に、今ルームにいる人へデータチャネル(topic "media")で知らせ、いない人には
   push 通知を送る(media_broadcast.py)。2回目からは、知らせ直すだけで push 通知は送らない。
4. 受け取った側は、履歴の media.url(CloudFront)で表示・再生する。

complete を呼べるのはアップロードした本人だけ。uploads のときに、アップロードした人を DynamoDB の
仮の行に書いておき、complete で照らし合わせる(timeline_store.py)。
- S3 のメタデータ(x-amz-meta-*)に入れる方法は、クライアントにもそのヘッダーを送らせる必要があり、
  付け忘れると 403 になるうえ、アプリと管理コンソールの両方の作りが増える。
- キーに sub を入れる方法は、公開する URL に sub が出るうえ、他人が complete したときに
  「本人ではない」(403)と「まだ置かれていない」(409)を見分けられない。
仮の行には Content-Type や大きさも持たせるので、complete でクライアントに送り直させずに済む。

仮置き(media_store.py のキー):
- 署名付き URL は期限まで何度でも PUT できる。配信するキーに直接向けると、complete の後や削除の
  後に PUT し直して、確かめていない中身に置き換えたり、消したものを戻したりできてしまう。
  仮置きのキーにすれば、置き直しは配信するキーに届かない(仮置きは CloudFront から読めない)。
- コピーは、HeadObject で確かめたときの ETag に合うときだけ行う(CopySourceIfMatch)。確かめた後に
  置き直されたら 409 にし、complete をやり直させる。
- 仮置きに無く配信するキーにあるのは、前の complete がコピーして仮置きを消した後、履歴を書く前に
  落ちた(か同時に呼ばれた)とき。配信するキーのものを確かめて進む。

マルチパート(docs/設計メモ.md の「画像・動画のアップロード」):
- 分けるかと、パートの大きさは API が決める(16MB 以上、パートは 8MB。10,000 個を超えるなら
  大きくする)。uploads で CreateMultipartUpload を呼び、UploadId は仮の行にだけ持つ。
- パートの署名付き URL は、parts で 100 個ずつ取る(期限は1時間。10GB で 1,280 個あり、
  全部を先に出すと、送り終わる前に切れうる)。
- complete では、クライアントが集めたパートの番号と ETag で CompleteMultipartUpload を呼ぶ。
  完了できない(パートが合わない、アップロードが無い)なら 410 にし、取りやめる。クライアントは
  uploads からやり直す。
"""

import urllib.parse
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Annotated

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import (
    ForbiddenError,
    NotFoundError,
    ServiceError,
)
from aws_lambda_powertools.event_handler.openapi.params import Body, Path

from voice_intercom_api import deletion, media_broadcast, media_store, store, timeline_store
from voice_intercom_api.auth import CurrentUser
from voice_intercom_api.models import Room
from voice_intercom_api.routing import (
    AUTH,
    ROOM_WRITE_ERRORS,
    RoomIdPath,
    responses,
    writable_room,
)
from voice_intercom_api.timeline_models import (
    MAX_MEDIA_BYTES,
    MAX_UPLOAD_PARTS,
    MEDIA_ID_PATTERN,
    THUMBNAIL_CONTENT_TYPE,
    CompleteMediaUploadRequest,
    CreateMediaUploadRequest,
    CreateUploadPartUrlsRequest,
    MediaUpload,
    MultipartUpload,
    TimelineEvent,
    UploadPartUrl,
    UploadPartUrls,
    format_timestamp,
    media_type_of,
)

router = Router()

# サムネイルの上限。署名付き URL では大きさを縛れないので、complete で確かめる
MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024

_MIB = 1024 * 1024

# これ以上の本体はマルチパートにする。小さいものは1回の PUT のほうが、往復が少なく作りも簡単
MULTIPART_THRESHOLD = 16 * _MIB

# パートの大きさ(最小)。S3 の下限(最後以外 5MB)より大きくし、失敗したパートの送り直しが
# 小さく済むようにする(AWS CLI の既定と同じ 8MB)
MIN_PART_SIZE = 8 * _MIB

MediaIdPath = Annotated[
    str, Path(pattern=MEDIA_ID_PATTERN, description="uploads が返した media_id")
]


def part_size_for(size_bytes: int) -> int | None:
    """マルチパートのパートの大きさ。1回の PUT にするなら None。

    パートの数が 10,000 を超えないよう、超えるなら 1MB 単位で大きくする(10GB では超えない)。
    """
    if size_bytes < MULTIPART_THRESHOLD:
        return None
    needed = -(-size_bytes // MAX_UPLOAD_PARTS)
    return max(MIN_PART_SIZE, -(-needed // _MIB) * _MIB)


def content_disposition(file_name: str | None) -> str:
    """ファイルをダウンロードさせる Content-Disposition。

    filename は ASCII だけの代わりの名前、filename* は UTF-8 の元の名前(RFC 6266)。
    """
    name = file_name or "file"
    fallback = "".join(c if 0x20 <= ord(c) < 0x7F and c not in '"\\;' else "_" for c in name)
    encoded = urllib.parse.quote(name, safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def _conflict(message: str) -> ServiceError:
    return ServiceError(HTTPStatus.CONFLICT, message)


def _gone(message: str) -> ServiceError:
    return ServiceError(HTTPStatus.GONE, message)


def _unprocessable(message: str) -> ServiceError:
    return ServiceError(HTTPStatus.UNPROCESSABLE_ENTITY, message)


def _thumbnail_url(room_id: str, media_id: str) -> str:
    return media_store.presign_put(
        media_store.staging_thumbnail_key(room_id, media_id), THUMBNAIL_CONTENT_TYPE
    )


@dataclass(frozen=True)
class _Uploaded:
    """1回の PUT で置かれたもの。staging_key が None なら、もう配信するキーにある。"""

    info: media_store.ObjectInfo
    key: str
    staging_key: str | None


def _find_uploaded(staging_key: str, key: str) -> _Uploaded | None:
    """1回の PUT で置かれたものを、仮置きのキー、配信するキーの順に探す。無ければ None。

    配信するキーにだけあるのは、前の complete がコピーして仮置きを消した後に、履歴を書く前に
    落ちた(か同時に呼ばれた)とき。
    """
    info = media_store.head(staging_key)
    if info is not None:
        return _Uploaded(info, key, staging_key)
    info = media_store.head(key)
    return None if info is None else _Uploaded(info, key, None)


def _publish(uploaded: _Uploaded) -> None:
    """確かめた仮置きのものを配信するキーへコピーし、仮置きを消す。

    確かめた後に置き直されていたら 409。元が無いのは、同時に呼ばれた complete がコピーして
    消した後なので、そのまま進む。
    """
    if uploaded.staging_key is None:
        return
    try:
        copied = media_store.copy(uploaded.staging_key, uploaded.key, etag=uploaded.info.etag)
    except media_store.ChangedError as e:
        raise _conflict("確かめている間に置き直された。complete をやり直す") from e
    if copied:
        media_store.delete([uploaded.staging_key])


def _own_pending(room_id: str, media_id: str, user_sub: str) -> timeline_store.PendingUpload:
    pending = timeline_store.get_pending_upload(room_id, media_id)
    if pending is None:
        raise NotFoundError("アップロードがない")
    if pending.uploader_id != user_sub:
        raise ForbiddenError("アップロードした本人ではない")
    return pending


@router.post(
    "/rooms/<room_id>/media/uploads",
    summary="画像・動画・ファイルをアップロードする署名付き URL を発行する(メンバー)",
    description="PUT するときは Content-Type ヘッダーを content_type(サムネイルは image/jpeg)と"
    "同じにする。違うと S3 が 403 を返す。ファイル(画像・動画でないもの)は、応答の "
    "content_disposition を Content-Disposition ヘッダーに付ける。"
    "アップロードしたら complete を呼ぶ。"
    "size_bytes が 16MB 以上なら、upload_url は null で、multipart(パートの大きさと数)を返す。"
    "パートの署名付き URL は parts で取る。"
    "width・height・duration_ms は、送信者が測った値をそのまま履歴に入れる(API は確かめない)。",
    operation_id="createMediaUpload",
    tags=["media"],
    security=AUTH,
    responses=responses(MediaUpload, errors=ROOM_WRITE_ERRORS),
)
def create_media_upload(
    room_id: RoomIdPath, body: Annotated[CreateMediaUploadRequest, Body()], user: CurrentUser
) -> MediaUpload:
    writable_room(room_id, user)
    media_id = uuid.uuid4().hex
    expires_at = datetime.now(UTC) + media_store.UPLOAD_URL_TTL
    key = media_store.media_key(room_id, media_id)
    part_size = part_size_for(body.size_bytes)
    disposition = (
        content_disposition(body.file_name) if media_type_of(body.content_type) == "file" else None
    )
    # Content-Type と Content-Disposition は、マルチパートを始めるときに決まる
    # (パートの PUT には要らない)
    upload_id = (
        None
        if part_size is None
        else media_store.create_multipart(key, body.content_type, disposition)
    )
    timeline_store.create_pending_upload(
        room_id,
        media_id,
        uploader_id=user.sub,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        has_thumbnail=body.has_thumbnail,
        width=body.width,
        height=body.height,
        duration_ms=body.duration_ms,
        upload_id=upload_id,
        part_size=part_size,
        file_name=body.file_name,
    )
    return MediaUpload(
        media_id=media_id,
        # 1回の PUT は仮置きのキーに置かせる(complete で確かめてから配信するキーへコピーする)
        upload_url=media_store.presign_put(
            media_store.staging_media_key(room_id, media_id), body.content_type, disposition
        )
        if part_size is None
        else None,
        content_disposition=disposition if part_size is None else None,
        thumbnail_upload_url=_thumbnail_url(room_id, media_id) if body.has_thumbnail else None,
        expires_at=format_timestamp(expires_at),
        multipart=None
        if part_size is None
        else MultipartUpload(part_size=part_size, part_count=-(-body.size_bytes // part_size)),
    )


@router.post(
    "/rooms/<room_id>/media/<media_id>/parts",
    summary="マルチパートのパートを PUT する署名付き URL を発行する(アップロードした本人)",
    description="1回で 100 個まで。期限は1時間なので、送る少し前に取る。"
    "期限が近づいたら、同じパートの URL を取り直してよい。"
    "thumbnail が true なら、サムネイルの署名付き URL も取り直す。"
    "マルチパートでないアップロードと、保存した後は 409。part_count より大きい番号は 422。",
    operation_id="createUploadPartUrls",
    tags=["media"],
    security=AUTH,
    responses=responses(
        UploadPartUrls,
        errors={
            404: "ルームか、アップロード(media_id)がない",
            409: "マルチパートではない、またはもう保存した",
        },
    ),
)
def create_upload_part_urls(
    room_id: RoomIdPath,
    media_id: MediaIdPath,
    body: Annotated[CreateUploadPartUrlsRequest, Body()],
    user: CurrentUser,
) -> UploadPartUrls:
    writable_room(room_id, user)
    pending = _own_pending(room_id, media_id, user.sub)
    if pending.completed_event_id is not None:
        raise _conflict("もう保存した")
    upload_id, part_count = pending.upload_id, pending.part_count
    if upload_id is None or part_count is None:
        raise _conflict("マルチパートではない")
    if any(n > part_count for n in body.part_numbers):
        raise _unprocessable(f"パートの番号は {part_count} まで")
    expires_at = datetime.now(UTC) + media_store.UPLOAD_URL_TTL
    key = media_store.media_key(room_id, media_id)
    return UploadPartUrls(
        parts=[
            UploadPartUrl(part_number=n, url=media_store.presign_upload_part(key, upload_id, n))
            for n in body.part_numbers
        ],
        thumbnail_upload_url=_thumbnail_url(room_id, media_id)
        if body.thumbnail and pending.has_thumbnail
        else None,
        expires_at=format_timestamp(expires_at),
    )


@router.post(
    "/rooms/<room_id>/media/<media_id>/complete",
    summary="アップロードした画像・動画・ファイルを履歴に保存する(アップロードした本人)",
    description="本体(とサムネイル)が置かれていなければ 409。"
    "置かれた本体の大きさが uploads の size_bytes と違えば 409(マルチパートでは 410)。"
    "確かめている間に PUT し直されたときも 409(complete をやり直す)。"
    "マルチパートなら、本文の parts に全パートの番号と ETag を入れる(完了させてから確かめる)。"
    "完了できない(ETag が合わない、アップロードが取りやめられた・期限で消えた)なら 410 で、"
    "uploads からやり直す。"
    "2回目からは、最初に保存した履歴を返す。"
    "保存した後に、今ルームにいる人へデータチャネル(topic media、MediaMessage)で配信し、"
    "最初の complete のときだけ、ルームにいないメンバーへ push 通知を送る。"
    "配信や通知に失敗しても、履歴を 200 で返す。2回目でも配信はやり直す。"
    "1回の PUT なら本文は要らない(画像・動画には文を添えられない)。"
    "前のクライアントが送る本文(text など)は無視する。",
    operation_id="completeMediaUpload",
    tags=["media"],
    security=AUTH,
    responses=responses(
        TimelineEvent,
        errors={
            404: "ルームか、アップロード(media_id)がない",
            409: "本体かサムネイルがまだ置かれていない、または大きさが違う",
            410: "マルチパートを完了できない。uploads からやり直す",
            422: "マルチパートなのに parts がそろっていない",
        },
    ),
)
def complete_media_upload(
    room_id: RoomIdPath,
    media_id: MediaIdPath,
    user: CurrentUser,
    body: Annotated[CompleteMediaUploadRequest | None, Body()] = None,
) -> TimelineEvent:
    room = writable_room(room_id, user)
    pending = _own_pending(room_id, media_id, user.sub)
    if pending.completed_event_id is not None:
        return _announce_again(room, _completed_event(room_id, pending.completed_event_id))

    thumbnail: _Uploaded | None = None
    if pending.has_thumbnail:
        # マルチパートの完了は取り消せないので、サムネイルを先に確かめる
        thumbnail = _find_uploaded(
            media_store.staging_thumbnail_key(room_id, media_id),
            media_store.thumbnail_key(room_id, media_id),
        )
        if thumbnail is None:
            raise _conflict("サムネイルがまだ置かれていない")
        if thumbnail.info.size_bytes > MAX_THUMBNAIL_BYTES:
            raise _conflict("サムネイルが上限(10MB)より大きい")
    multipart = pending.upload_id is not None
    key = media_store.media_key(room_id, media_id)
    single: _Uploaded | None = None
    if multipart:
        _complete_multipart(pending, body)
        original = media_store.head(key)
        if original is None:
            raise _gone("マルチパートのアップロードが無い(取りやめた、期限で消えた)")
    else:
        single = _find_uploaded(media_store.staging_media_key(room_id, media_id), key)
        if single is None:
            raise _conflict("本体がまだ置かれていない")
        original = single.info
    # 署名付き URL では大きさを縛れないので、申告どおりかを確かめる(上限は uploads で確かめた)
    if original.size_bytes != pending.size_bytes or original.size_bytes > MAX_MEDIA_BYTES:
        if multipart:
            # 完了した後なので、同じアップロードには置き直せない。消して uploads からやり直させる
            media_store.delete([key])
            raise _gone("本体の大きさが uploads の size_bytes と違う")
        raise _conflict("本体の大きさが uploads の size_bytes と違う")

    # 確かめたので、配信するキーへ移す
    if thumbnail is not None:
        _publish(thumbnail)
    if single is not None:
        _publish(single)

    # push 通知の本文に表示名を使う
    profile = store.get_user(user.sub)
    try:
        event = timeline_store.complete_upload(
            pending, sender_id=user.sub, occurred_at=format_timestamp(datetime.now(UTC))
        )
    except timeline_store.AlreadyCompletedError as e:
        # 同時に呼ばれた別の complete が先に保存した。push 通知はそちらが送る
        return _announce_again(room, _completed_event(room_id, e.event_id))
    media_broadcast.announce(room, event, profile, first=True)
    return event


def _complete_multipart(
    pending: timeline_store.PendingUpload, body: CompleteMediaUploadRequest | None
) -> None:
    """クライアントが集めたパートの ETag で、マルチパートを完了する。

    もう完了していた(前の complete が完了させた後に応答を失った、同時に呼ばれた)なら、
    S3 は NoSuchUpload を返すことがある。そのときは本体があるかで決める(呼び出し元の HeadObject)。
    """
    upload_id, part_count = pending.upload_id, pending.part_count
    if upload_id is None or part_count is None:
        raise ValueError("マルチパートではない")
    given = body.parts if body is not None and body.parts is not None else []
    parts = sorted((p.part_number, p.etag.strip()) for p in given)
    if [n for n, _ in parts] != list(range(1, part_count + 1)):
        raise _unprocessable(f"parts に 1 から {part_count} までのパートを1つずつ入れる")
    key = media_store.media_key(pending.room_id, pending.media_id)
    try:
        media_store.complete_multipart(key, upload_id, parts)
    except media_store.MultipartGoneError:
        return
    except media_store.InvalidPartsError as e:
        media_store.abort_multipart(key, upload_id)
        raise _gone(f"パートが合わないので完了できない({e})") from e


def _announce_again(room: Room, event: TimelineEvent) -> TimelineEvent:
    """2回目からの complete。配信だけをやり直す(push 通知は送らない)。

    送った本人が消した後なら、配信もせず墓石を返す。このとき S3 の後始末(本体とサムネイルと
    仮置きを消す、マルチパートを取りやめる)もやり直す。同時に呼ばれた complete が、削除の後に
    CompleteMultipartUpload で本体を置き直したかもしれないため。CloudFront の無効化は DELETE で
    済んでいるので、やり直さない。
    """
    if event.deleted is None:
        media_broadcast.announce(room, event, None, first=False)
    else:
        deletion.purge_media(event, invalidate=False)
    return event


def _completed_event(room_id: str, event_id: str) -> TimelineEvent:
    event = timeline_store.get_event(room_id, event_id)
    if event is None:
        # 仮の行には completed_event_id があるのに、履歴がない(手で消したなど)
        raise NotFoundError("保存した履歴がない")
    return event
